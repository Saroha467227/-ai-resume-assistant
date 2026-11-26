import assert from 'node:assert/strict';
import { test } from 'node:test';
import { docxWithText, pdfWithText, resumeLines } from '../fixtures/resume-documents.js';
import { extractJob, extractResume } from '../src/extraction.js';
import { applyEvaluation, makeQuestions } from '../src/interview.js';
import { parseResume } from '../src/parser.js';
import { scoreFit } from '../src/scoring.js';
import { findSkills, redactContact } from '../src/skills.js';

const local = async () => null;
const pdf = (buffer) => ({ originalname: 'resume.pdf', mimetype: 'application/pdf', buffer });
const docx = (buffer) => ({
  originalname: 'resume.docx',
  mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  buffer
});

test('extracts text from three differently structured PDF resumes', async () => {
  for (const lines of [
    resumeLines,
    ['Jordan Lee', 'Data Engineer, Boston', 'Python, PostgreSQL and Apache Spark'],
    ['Sam Diaz (Designer)', 'Projects', 'Figma, UX research and responsive design']
  ]) {
    const result = await parseResume(pdf(pdfWithText(lines)));
    assert.ok(result.rawText.includes(lines.at(-1)));
  }
});

test('extracts text from a DOCX resume', async () => {
  const result = await parseResume(docx(docxWithText(resumeLines)));
  assert.ok(result.rawText.includes('Backend developer'));
  assert.equal(result.fileName, 'resume.docx');
});

test('returns an actionable message for a PDF without a text layer', async () => {
  await assert.rejects(parseResume(pdf(pdfWithText([]))), { status: 422, message: /text layer/ });
});

test('validates PDF and DOCX signatures and rejects mislabeled files', async () => {
  await assert.rejects(parseResume(pdf(Buffer.from('pretend this is a PDF document'))), { status: 415 });
  await assert.rejects(parseResume(docx(Buffer.from('PK\x03\x04' + 'bad archive'))), { status: 422 });
  await assert.rejects(parseResume({ ...pdf(pdfWithText(resumeLines)), mimetype: 'image/jpeg' }), { status: 415 });
});

test('normalizes skill aliases, captures evidence, and removes contact details', () => {
  const result = findSkills('Skills: Mongo, React Native, C++, R\nMade with NodeJS. me@example.com');
  assert.deepEqual(result.map((skill) => skill.name).sort(), ['C++', 'MongoDB', 'Node.js', 'R', 'React Native']);
  assert.ok(result.every(({ evidence }) => !evidence.includes('me@example.com')));
  const redacted = redactContact('Address: 42 Example Street\nperson@example.com\n+91 98765 43210');
  assert.doesNotMatch(redacted, /Example Street|person@|98765/);
});

test('extracts grounded resume fields and merges overlapping job dates', async () => {
  const result = await extractResume([
    ...resumeLines.slice(0, 4), 'Developer | Jan 2023 - Jan 2024', ...resumeLines.slice(4)
  ].join('\n'), async () => ({
    extraSkills: [{ name: 'Kubernetes', evidence: 'Kubernetes' }],
    education: [], projects: [], experience: []
  }));
  assert.equal(result.totalYears, 3.1);
  assert.ok(result.credentials.includes('Bachelor’s degree'));
  assert.ok(result.projects.length);
  assert.ok(!result.skills.some((skill) => skill.name === 'Kubernetes'));
});

test('separates job skills and computes the documented weighted fit score', async () => {
  const job = await extractJob('Required: Node.js, MongoDB, Redis, and 4+ years of experience.\nBachelor degree.\nPreferred: Docker and GraphQL.', local);
  assert.deepEqual(job.requiredSkills, ['Node.js', 'MongoDB', 'Redis']);
  assert.deepEqual(job.preferredSkills, ['Docker', 'GraphQL']);
  assert.equal(job.minimumYears, 4);
  const report = scoreFit({
    skills: [{ name: 'NodeJS' }, { name: 'Mongo' }, { name: 'Docker' }],
    totalYears: 2,
    credentials: ['Master’s degree']
  }, job);
  assert.equal(report.score, 63);
  assert.deepEqual(report.missing, ['Redis']);
  assert.deepEqual(report.missingPreferred, ['GraphQL']);
});

test('redistributes unspecified weights and returns no score without requirements', () => {
  assert.equal(scoreFit({ skills: [{ name: 'Python' }] }, { requiredSkills: ['Python'] }).score, 100);
  assert.equal(scoreFit({ skills: [] }, {}).score, null);
  assert.equal(scoreFit({ skills: [] }, { requiredSkills: ['Python'] }).score, 0);
});

test('restores required skill extraction after a Responsibilities section', async () => {
  const job = await extractJob('Responsibilities\nBuild backend features.\nRequirements\nNode.js and MongoDB expertise required.\nPreferred\nDocker', local);
  assert.deepEqual(job.requiredSkills, ['Node.js', 'MongoDB']);
  assert.deepEqual(job.preferredSkills, ['Docker']);
});

test('queues gap and claim questions and caps follow-ups at two per original question', async () => {
  const turns = await makeQuestions({ projects: ['Built a storefront API'], experience: [] },
    { title: 'Backend Engineer' }, { missing: ['Redis'] }, [], local);
  assert.equal(turns.length, 5);
  assert.deepEqual(turns.slice(0, 2).map((item) => item.type), ['gap', 'claim']);
  const original = turns[0];
  const session = { status: 'active', turns };
  const weak = { evaluation: { score: 1, feedback: 'Give an example.', weakAreas: ['Specificity'], source: 'local' } };
  for (let index = 0; index < 3; index++) {
    applyEvaluation(session, session.turns.find((turn) => !turn.answer), 'A little.', weak);
  }
  assert.equal(turns.filter((turn) => turn.parentId === original.questionId).length, 2);
  assert.equal(turns.find((turn) => !turn.answer).type, 'claim');
  for (const turn of turns.filter((item) => !item.answer)) {
    applyEvaluation(session, turn, 'I built it and tested it.', { evaluation: { score: 4, weakAreas: [] } });
  }
  assert.equal(session.status, 'complete');
  assert.equal(session.summary.improvements.length, 3);
});
