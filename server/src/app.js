import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import mongoose from 'mongoose';
import multer from 'multer';
import { z } from 'zod';
import { extractJob, extractResume } from './extraction.js';
import { handleError, HttpError, objectId, owned, pairInput, publicUser, sessionMiddleware } from './http.js';
import { applyEvaluation, evaluateAnswer, makeQuestions, questionBank } from './interview.js';
import { createLlm } from './llm.js';
import { FitReport, InterviewSession, JobDescription, LlmQuota, QuestionBank, Resume, User } from './models.js';
import { mutateWorkspace } from './mutations.js';
import { parseResume } from './parser.js';
import { scoreFit } from './scoring.js';

const email = z.email().max(254).transform((value) => value.toLowerCase());
const name = z.string().trim().min(2).max(80);
const password = z.string().min(8, 'Use at least 8 characters for your password.')
  .refine((value) => Buffer.byteLength(value) <= 72, 'Use a password no longer than 72 bytes.');
const profileInput = z.object({ name, targetRole: z.string().trim().max(100) });
const jobInput = z.object({
  title: z.string().trim().min(2).max(140),
  company: z.string().trim().max(140).default(''),
  rawText: z.string().trim().min(40, 'Paste at least 40 characters of the job description.').max(20_000)
});
const answerInput = z.object({ questionId: z.uuid(), answer: z.string().trim().min(1).max(5000) });
const pageInput = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).max(1000000).default(0)
});

async function sendPage(req, res, model, projection, sort) {
  const { limit, offset } = pageInput.parse(req.query);
  const filter = { userId: req.user._id };
  const query = model.find(filter).select(projection).sort({ [sort]: -1, _id: -1 });
  if (!limit) return res.json(await query);
  const [items, total] = await Promise.all([query.skip(offset).limit(limit).lean(), model.countDocuments(filter)]);
  res.set('X-Total-Count', String(total));
  if (model === FitReport) {
    const best = await model.findOne({ ...filter, score: { $type: 'number' } }).sort('-score').select('score');
    if (best) res.set('X-Best-Score', String(best.score));
  }
  if (model !== FitReport && model !== InterviewSession) return res.json(items);
  const jobs = await JobDescription.find({ ...filter, _id: { $in: items.map((item) => item.jdId) } }).select('title').lean();
  const titles = new Map(jobs.map((job) => [String(job._id), job.title]));
  return res.json(items.map((item) => ({ ...item, jobTitle: titles.get(String(item.jdId)) })));
}

const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
const clientIndex = fileURLToPath(new URL('../../client/dist/index.html', import.meta.url));

export function createApp(config) {
  const app = express();
  const api = express.Router();
  const session = sessionMiddleware(config);
  const generate = config.generate || createLlm(config.llm);
  const maxResumeMb = config.maxResumeMb ?? 5;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: maxResumeMb * 1024 * 1024, fields: 0, parts: 2 }
  });
  const origins = new Set(config.clientOrigins);
  const authLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Too many sign-in attempts. Try again in a few minutes.' }
  });
  const workLimit = rateLimit({
    windowMs: 60_000,
    limit: 18,
    keyGenerator: (req) => req.user.id,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Too many requests. Try again in a minute.' }
  });

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops || false);
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: config.secureCookies ? [] : null } } }));
  app.use('/api', cors({ origin: (origin, callback) => callback(null, Boolean(origin && origins.has(origin))), credentials: true, exposedHeaders: ['X-Total-Count', 'X-Best-Score'] }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const origin = req.get('origin');
    const readOnly = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (!readOnly && origin && !origins.has(origin)) throw new HttpError(403, 'This request origin is unavailable.');
    next();
  });
  app.use('/api', express.json({ limit: '120kb' }), cookieParser(), api);

  api.get('/health', (_req, res) => {
    const connected = mongoose.connection.readyState === 1;
    res.status(connected ? 200 : 503).json({ status: connected ? 'ok' : 'database unavailable' });
  });

  api.post('/auth/register', authLimit, async (req, res) => {
    const data = z.object({ name, email, password }).parse(req.body);
    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await User.create({ name: data.name, email: data.email, passwordHash });
    session.set(res, user);
    res.status(201).json(publicUser(user));
  });

  api.post('/auth/login', authLimit, async (req, res) => {
    const data = z.object({ email, password: z.string().min(1).max(72) }).parse(req.body);
    const user = await User.findOne({ email: data.email }).select('+passwordHash +password');
    const hash = user?.passwordHash || user?.password;
    if (!hash || !await bcrypt.compare(data.password, hash)) {
      throw new HttpError(401, 'Email or password is incorrect.');
    }
    if (!user.passwordHash) {
      user.passwordHash = await bcrypt.hash(data.password, 12);
      user.password = undefined;
      await user.save();
    }
    session.set(res, user);
    res.json(publicUser(user));
  });

  api.post('/auth/logout', (_req, res) => {
    session.clear(res);
    res.sendStatus(204);
  });

  api.use(session.require);
  api.get('/auth/me', (req, res) => res.json(publicUser(req.user)));
  api.patch('/auth/me', async (req, res) => {
    req.user.set(profileInput.parse(req.body));
    await req.user.save();
    res.json(publicUser(req.user));
  });

  api.delete('/auth/me', authLimit, async (req, res) => {
    const { password: input } = z.object({ password: z.string().min(1).max(72) }).parse(req.body);
    const user = await User.findById(req.user._id).select('+passwordHash +password');
    const hash = user?.passwordHash || user?.password;
    if (!hash || !await bcrypt.compare(input, hash)) throw new HttpError(401, 'Password is incorrect.');
    await mutateWorkspace(user._id, async () => {
      const userFilter = { userId: user._id };
      for (const model of [FitReport, InterviewSession, Resume, JobDescription]) {
        await model.deleteMany(userFilter);
      }
      await LlmQuota.deleteMany({ _id: { $regex: '^' + user.id + ':' } });
      await User.deleteOne({ _id: user._id });
    });
    session.clear(res);
    res.sendStatus(204);
  });

  api.get('/resumes', async (req, res) => {
    await sendPage(req, res, Resume, 'fileName mimeType parsed createdAt', 'createdAt');
  });
  api.get('/resumes/:id', async (req, res) => {
    res.json(await owned(Resume, req.user._id, req.params.id, 'fileName mimeType parsed createdAt'));
  });
  api.post('/resumes', workLimit, upload.single('resume'), async (req, res) => {
    const { fileName, mimeType, rawText } = await parseResume(req.file);
    const textHash = createHash('sha256').update(rawText).digest('hex');
    const userId = req.user._id;
    const existing = await Resume.findOne({ userId, textHash }).select('fileName mimeType parsed createdAt');
    if (existing) return res.status(200).json(existing);
    const parsed = await extractResume(rawText, generate, userId);
    let result;
    try {
      result = await mutateWorkspace(userId, () => Resume.findOneAndUpdate(
        { userId, textHash },
        { $setOnInsert: { userId, textHash, fileName, mimeType, rawText, parsed, createdAt: new Date(), updatedAt: new Date() } },
        { upsert: true, returnDocument: 'after', includeResultMetadata: true, timestamps: false,
          select: 'fileName mimeType parsed createdAt',
          setDefaultsOnInsert: false,
          runValidators: true }
      ));
    } catch (error) {
      if (error.code !== 11000) throw error;
      const saved = await Resume.findOne({ userId, textHash }).select('fileName mimeType parsed createdAt');
      if (!saved) throw error;
      return res.status(200).json(saved);
    }
    return res.status(result.lastErrorObject.updatedExisting ? 200 : 201).json(result.value);
  });
  api.delete('/resumes/:id', async (req, res) => {
    const userId = req.user._id;
    const id = objectId.parse(req.params.id);
    await mutateWorkspace(userId, async () => {
      const filter = { userId, resumeId: id };
      await FitReport.deleteMany(filter);
      await InterviewSession.deleteMany(filter);
      await Resume.deleteOne({ _id: id, userId });
    });
    res.sendStatus(204);
  });

  api.get('/job-descriptions', async (req, res) => {
    await sendPage(req, res, JobDescription, '', 'createdAt');
  });
  api.get('/job-descriptions/:id', async (req, res) => {
    res.json(await owned(JobDescription, req.user._id, req.params.id, '+rawText'));
  });
  api.post('/job-descriptions', workLimit, async (req, res) => {
    const data = jobInput.parse(req.body);
    const userId = req.user._id;
    const extracted = await extractJob(data.rawText, generate, userId);
    const doc = await mutateWorkspace(userId, () => JobDescription.create({ userId, ...data, ...extracted }));
    const { rawText, ...job } = doc.toObject();
    res.status(201).json(job);
  });
  api.delete('/job-descriptions/:id', async (req, res) => {
    const userId = req.user._id;
    const id = objectId.parse(req.params.id);
    await mutateWorkspace(userId, async () => {
      const filter = { userId, jdId: id };
      await FitReport.deleteMany(filter);
      await InterviewSession.deleteMany(filter);
      await JobDescription.deleteOne({ _id: id, userId });
    });
    res.sendStatus(204);
  });

  async function loadPair(req) {
    const { resumeId, jdId } = pairInput.parse(req.body);
    const userId = req.user._id;
    const resume = await owned(Resume, userId, resumeId);
    const job = await owned(JobDescription, userId, jdId);
    return { resume, job, filter: { userId, resumeId, jdId } };
  }

  api.get('/analyses', async (req, res) => {
    await sendPage(req, res, FitReport, '', 'updatedAt');
  });
  api.get('/analyses/:id', async (req, res) => {
    res.json(await owned(FitReport, req.user._id, req.params.id));
  });
  api.post('/analyses', async (req, res) => {
    const report = await mutateWorkspace(req.user._id, async () => {
      const { resume, job, filter } = await loadPair(req);
      const fit = scoreFit(resume.parsed, job);
      return FitReport.findOneAndUpdate(filter, { $set: fit }, { upsert: true, returnDocument: 'after' });
    });
    res.json(report);
  });

  api.get('/interviews', async (req, res) => {
    await sendPage(req, res, InterviewSession,
      'resumeId jdId status turns.questionId turns.evaluation.score summary.score createdAt updatedAt', 'updatedAt');
  });
  api.get('/interviews/:id', async (req, res) => {
    res.json(await owned(InterviewSession, req.user._id, req.params.id));
  });
  api.post('/interviews', workLimit, async (req, res) => {
    const { resume, job, filter } = await loadPair(req);
    const skillTags = [...job.requiredSkills, ...job.preferredSkills];
    const stored = await QuestionBank.find({ skillTags: { $in: skillTags } }).sort('_id').limit(5);
    const curated = stored.length ? stored : questionBank.filter((item) => item.skillTags.some((skill) => skillTags.includes(skill)));
    const turns = await makeQuestions(resume.parsed, job, scoreFit(resume.parsed, job), curated, generate, req.user._id);
    const interview = await mutateWorkspace(req.user._id, async () => {
      await loadPair(req);
      return InterviewSession.create({ ...filter, turns });
    });
    res.status(201).json(interview);
  });
  api.post('/interviews/:id/answers', workLimit, async (req, res) => {
    const { questionId, answer } = answerInput.parse(req.body);
    const interview = await owned(InterviewSession, req.user._id, req.params.id);
    const saved = interview.turns.find((turn) => turn.questionId === questionId);
    if (saved?.answer === answer) return res.json(interview);
    const turn = interview.turns.find((item) => !item.answer);
    if (!turn || turn.questionId !== questionId) throw new HttpError(409, 'That question is no longer awaiting an answer.');
    const original = interview.turns.find((item) => item.questionId === turn.parentId) || turn;
    const job = await owned(JobDescription, req.user._id, String(interview.jdId));
    const result = await evaluateAnswer({ turn, original, answer, jobTitle: job.title, generate, userId: req.user._id });
    const updated = await mutateWorkspace(req.user._id, async () => {
      const current = await owned(InterviewSession, req.user._id, req.params.id);
      const answered = current.turns.find((item) => item.questionId === questionId);
      if (answered?.answer === answer) return current;
      const next = current.turns.find((item) => !item.answer);
      if (next?.questionId !== questionId) throw new HttpError(409, 'That question is no longer awaiting an answer.');
      applyEvaluation(current, next, answer, result);
      return current.save();
    });
    return res.json(updated);
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'This endpoint could not be found.')));
  if (config.serveClient !== false && existsSync(clientIndex)) {
    app.use(express.static(clientDist));
    app.get('/{*path}', (_req, res) => res.sendFile(clientIndex));
  }
  app.use((error, req, res, next) => handleError(error, req, res, next, maxResumeMb));
  return app;
}
