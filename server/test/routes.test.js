import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import mongoose from 'mongoose';
import request from 'supertest';
import { pdfWithText, resumeLines } from '../fixtures/resume-documents.js';
import { createApp } from '../src/app.js';
import { models } from '../src/models.js';

const dbUri = process.env.TEST_MONGODB_URI;
const testConfig = {
  jwtSecret: 'integration-testing-only-secret-with-length',
  clientOrigins: ['http://localhost:5173'],
  secureCookies: false,
  generate: async () => null
};

test('rejects cross-origin writes, invalid auth data and missing sessions', async () => {
  const app = createApp(testConfig);
  await request(app).post('/api/auth/register').set('Origin', 'http://untrusted.example').send({}).expect(403);
  await request(app).post('/api/auth/register').send({}).expect(400);
  await request(app).get('/api/resumes').expect(401);
});

test('persists the full job-seeker flow and enforces ownership', { skip: !dbUri }, async () => {
  const dbName = 'resume_studio_test_' + randomUUID().replaceAll('-', '');
  await mongoose.connect(dbUri, { dbName, serverSelectionTimeoutMS: 5000 });
  try {
    await Promise.all(models.map((model) => model.init()));
    const app = createApp(testConfig);
    const owner = request.agent(app);
    const other = request.agent(app);
    const password = 'test-password-123';
    const register = (agent, email) => agent.post('/api/auth/register').send({ email, name: 'Alex Morgan', password }).expect(201);
    const registered = await register(owner, 'alex@example.com');
    assert.ok(registered.headers['set-cookie'][0].includes('HttpOnly'));
    assert.ok(!('passwordHash' in registered.body));
    await register(other, 'other@example.com');
    await owner.patch('/api/auth/me').send({ name: 'Alex Morgan', targetRole: 'Backend Engineer' }).expect(200);
    await owner.post('/api/resumes').attach('resume', Buffer.alloc(5 * 1024 * 1024 + 1), 'big.pdf').expect(413);

    const upload = () => owner.post('/api/resumes').attach('resume', pdfWithText(resumeLines), 'candidate.pdf');
    const { body: resume } = await upload().expect(201);
    assert.ok(resume.createdAt);
    assert.ok(!('rawText' in resume));
    assert.equal((await upload().expect(200)).body._id, resume._id);
    await other.get('/api/resumes/' + resume._id).expect(404);
    const { body: job } = await owner.post('/api/job-descriptions').send({
      title: 'Backend Engineer',
      rawText: 'Required: Node.js, Express, MongoDB, Redis, and 3 years of experience.\nPreferred: Docker.'
    }).expect(201);
    const pair = { resumeId: resume._id, jdId: job._id };
    await other.post('/api/analyses').send(pair).expect(404);
    const { body: report } = await owner.post('/api/analyses').send(pair).expect(200);
    assert.equal(report.score, 64);
    assert.deepEqual(report.missing, ['Redis']);
    assert.equal((await owner.post('/api/analyses').send(pair).expect(200)).body._id, report._id);

    let interview = (await owner.post('/api/interviews').send(pair).expect(201)).body;
    const route = '/api/interviews/' + interview._id;
    await other.get(route).expect(404);
    assert.equal(interview.turns[0].type, 'gap');
    await owner.post(route + '/answers').send({ questionId: interview.turns[1].questionId, answer: 'Skipped.' }).expect(409);
    const send = async (questionId, answer) => (await owner.post(route + '/answers').send({ questionId, answer }).expect(200)).body;
    const original = interview.turns[0].questionId;
    interview = await send(original, 'A little.');
    assert.equal(interview.turns[1].type, 'followup');
    assert.equal((await send(original, 'A little.')).turns.length, interview.turns.length);
    interview = await send(interview.turns[1].questionId, 'A little.');
    interview = await send(interview.turns[2].questionId, 'A little.');
    assert.equal(interview.turns.filter((turn) => turn.parentId === original).length, 2);
    while (interview.status === 'active') {
      const current = interview.turns.find((turn) => !turn.answer);
      interview = await send(current.questionId, 'I built a small prototype because we needed to test whether the new approach worked. I compared it against the previous process and measured the time difference across several runs.');
    }
    assert.equal(interview.summary.improvements.length, 3);
    assert.equal((await owner.get('/api/interviews').expect(200)).body[0].status, 'complete');
    const newest = await owner.post('/api/interviews').send(pair).expect(201);
    const firstPage = await owner.get('/api/interviews?limit=1').expect(200);
    assert.equal(firstPage.headers['x-total-count'], '2');
    assert.equal(firstPage.body[0]._id, newest.body._id);
    const secondPage = await owner.get('/api/interviews?limit=1&offset=1').expect(200);
    assert.equal(secondPage.body[0]._id, interview._id);
    await owner.get('/api/interviews?limit=51').expect(400);
    await other.get('/api/analyses/' + report._id).expect(404);
    await owner.get('/api/analyses/' + report._id).expect(200);
    const [created, deleted] = await Promise.all([
      owner.post('/api/interviews').send(pair),
      owner.delete('/api/job-descriptions/' + job._id)
    ]);
    assert.ok([201, 404].includes(created.status));
    assert.equal(deleted.status, 204);
    await owner.delete('/api/job-descriptions/' + job._id).expect(204);
    assert.deepEqual((await owner.get('/api/interviews').expect(200)).body, []);
    assert.deepEqual((await owner.get('/api/analyses').expect(200)).body, []);
    await owner.post('/api/auth/logout').expect(204);
    await owner.get('/api/auth/me').expect(401);
    await owner.post('/api/auth/login').send({ email: 'alex@example.com', password }).expect(200);
    await owner.delete('/api/auth/me').send({ password }).expect(204);
    await owner.get('/api/auth/me').expect(401);
    await register(owner, 'alex@example.com');
    assert.deepEqual((await owner.get('/api/interviews').expect(200)).body, []);
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
