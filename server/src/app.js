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
import { handleError, HttpError, owned, pairInput, publicUser, sessionMiddleware } from './http.js';
import { applyEvaluation, evaluateAnswer, makeQuestions, questionBank } from './interview.js';
import { createLlm } from './llm.js';
import { FitReport, InterviewSession, JobDescription, LlmQuota, QuestionBank, Resume, User } from './models.js';
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
  app.use('/api', cors({ origin: (origin, callback) => callback(null, Boolean(origin && origins.has(origin))), credentials: true }));
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
    const userFilter = { userId: user._id };
    await Promise.all([Resume, JobDescription, FitReport, InterviewSession].map((model) => model.deleteMany(userFilter)));
    await LlmQuota.deleteMany({ _id: { $regex: '^' + user.id + ':' } });
    await user.deleteOne();
    session.clear(res);
    res.sendStatus(204);
  });

  api.get('/resumes', async (req, res) => {
    res.json(await Resume.find({ userId: req.user._id }).select('fileName mimeType parsed createdAt').sort('-createdAt'));
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
      result = await Resume.findOneAndUpdate(
        { userId, textHash },
        { $setOnInsert: { userId, textHash, fileName, mimeType, rawText, parsed, createdAt: new Date(), updatedAt: new Date() } },
        { upsert: true, returnDocument: 'after', includeResultMetadata: true, timestamps: false,
          select: 'fileName mimeType parsed createdAt',
          setDefaultsOnInsert: false,
          runValidators: true }
      );
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
    const resume = await owned(Resume, userId, req.params.id);
    const filter = { userId, resumeId: resume._id };
    await Promise.all([FitReport.deleteMany(filter), InterviewSession.deleteMany(filter)]);
    await resume.deleteOne();
    res.sendStatus(204);
  });

  api.get('/job-descriptions', async (req, res) => {
    res.json(await JobDescription.find({ userId: req.user._id }).sort('-createdAt'));
  });
  api.get('/job-descriptions/:id', async (req, res) => {
    res.json(await owned(JobDescription, req.user._id, req.params.id, '+rawText'));
  });
  api.post('/job-descriptions', workLimit, async (req, res) => {
    const data = jobInput.parse(req.body);
    const userId = req.user._id;
    const extracted = await extractJob(data.rawText, generate, userId);
    const doc = await JobDescription.create({ userId, ...data, ...extracted });
    const { rawText, ...job } = doc.toObject();
    res.status(201).json(job);
  });
  api.delete('/job-descriptions/:id', async (req, res) => {
    const userId = req.user._id;
    const job = await owned(JobDescription, userId, req.params.id);
    const filter = { userId, jdId: job._id };
    await Promise.all([FitReport.deleteMany(filter), InterviewSession.deleteMany(filter)]);
    await job.deleteOne();
    res.sendStatus(204);
  });

  async function loadPair(req) {
    const { resumeId, jdId } = pairInput.parse(req.body);
    const userId = req.user._id;
    const [resume, job] = await Promise.all([owned(Resume, userId, resumeId), owned(JobDescription, userId, jdId)]);
    return { resume, job, filter: { userId, resumeId, jdId } };
  }

  api.get('/analyses', async (req, res) => {
    res.json(await FitReport.find({ userId: req.user._id }).sort('-updatedAt'));
  });
  api.post('/analyses', async (req, res) => {
    const { resume, job, filter } = await loadPair(req);
    const fit = scoreFit(resume.parsed, job);
    const report = await FitReport.findOneAndUpdate(filter, { $set: fit }, { upsert: true, returnDocument: 'after' });
    res.json(report);
  });

  api.get('/interviews', async (req, res) => {
    const sessions = await InterviewSession.find({ userId: req.user._id })
      .select('resumeId jdId status turns.questionId turns.evaluation.score summary.score createdAt updatedAt').sort('-updatedAt');
    res.json(sessions);
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
    res.status(201).json(await InterviewSession.create({ ...filter, turns }));
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
    applyEvaluation(interview, turn, answer, result);
    await interview.save();
    return res.json(interview);
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'This endpoint could not be found.')));
  if (config.serveClient !== false && existsSync(clientIndex)) {
    app.use(express.static(clientDist));
    app.get('/{*path}', (_req, res) => res.sendFile(clientIndex));
  }
  app.use((error, req, res, next) => handleError(error, req, res, next, maxResumeMb));
  return app;
}
