import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { redactContact } from './skills.js';

const questionsSchema = z.object({
  questions: z.array(z.string().min(12).max(320)).min(1).max(4)
});
const evaluationSchema = z.object({
  score: z.number().int().min(1).max(5),
  feedback: z.string().min(1).max(650),
  weakAreas: z.array(z.string().min(1).max(100)).max(4),
  followup: z.string().max(320)
});

export const questionBank = [
  { skillTags: ['Node.js', 'JavaScript'], text: 'What does the event loop do in Node.js, and how would you diagnose a blocked event loop?', difficulty: 'medium' },
  { skillTags: ['Express', 'REST'], text: 'How would you structure validation and error handling for an Express API endpoint?', difficulty: 'medium' },
  { skillTags: ['MongoDB'], text: 'How would you decide whether a MongoDB query needs an index, and how would you verify the change?', difficulty: 'medium' },
  { skillTags: ['React'], text: 'Walk me through how you would diagnose unnecessary re-renders in a React page.', difficulty: 'medium' },
  { skillTags: ['Docker'], text: 'How would you debug a container that works locally but exits in production?', difficulty: 'medium' },
  { skillTags: ['SQL', 'PostgreSQL', 'MySQL'], text: 'How do you approach diagnosing a query that gets slower as its tables grow?', difficulty: 'medium' },
  { skillTags: ['Python'], text: 'Describe a time you had to choose between iterating over a generator and building a list in Python.', difficulty: 'medium' },
  { skillTags: ['Git'], text: 'How would you identify which change introduced a regression across several commits?', difficulty: 'medium' }
];
const general = [
  'Describe a challenging problem relevant to this role. What did you try first, and what trade-off drove your final choice?',
  'Tell me about a project you owned. How did you measure whether your contribution made a difference?',
  'Walk me through a time you received feedback that changed your approach. What did you do afterward?',
  'Describe a situation where you had to learn quickly. How did you check that you understood enough to apply what you learned?',
  'Tell me about a disagreement on a team. How did you reach a decision and communicate it?'
];

function makeTurn(type, text, parentId) {
  return { questionId: randomUUID(), type, text, parentId };
}

export async function makeQuestions(resume, job, fit, curated, generate, userId) {
  const gaps = fit.missing.slice(0, 2);
  const claims = (resume.projects.length ? resume.projects : resume.experience)
    .filter((line) => line.length > 12 && /[a-z]{4}/i.test(line)).slice(0, 2)
    .map((line) => redactContact(line).slice(0, 145));
  const drafts = [
    ...gaps.map((skill) => ({ type: 'gap', text: 'How would you use ' + skill + ' in this role? Describe the problem it would solve and how you would verify your approach.' })),
    ...claims.map((claim) => ({ type: 'claim', text: 'Your resume says “' + claim + '”. What did you personally contribute, and how did you measure the result?' }))
  ];
  const custom = drafts.length ? await generate({
    userId,
    instruction: 'Rewrite each practice question for the job title, keeping the same order, count and intent. Preserve the specific skill or resume claim. Do not disclose contact details or assume facts outside the supplied data.',
    data: { jobTitle: redactContact(job.title), questions: drafts },
    schema: questionsSchema,
    temperature: 0.7
  }) : null;
  const questions = drafts.map(({ type, text }, index) => {
    const subject = index < gaps.length ? gaps[index] : claims[index - gaps.length];
    const rewritten = custom?.questions[index];
    const anchor = type === 'gap' ? subject : subject.split(/\s+/).slice(0, 4).join(' ');
    return makeTurn(type, rewritten?.toLowerCase().includes(anchor.toLowerCase()) ? rewritten : text);
  });
  const core = [...new Set([...curated.map((item) => item.text), ...general])];
  return [...questions, ...core.slice(0, 5 - questions.length).map((text) => makeTurn('core', text))];
}

function localEvaluation(answer) {
  const words = answer.trim().split(/\s+/).length;
  const action = /\b(?:i (?:built|tested|measured|used|chose|designed|implemented|changed|added|wrote|ran|checked)|because|first|then|we used)\b/i.test(answer);
  const outcome = /\b(?:result(?:ed)?|outcome|improved|reduced|increased|verified|compared|learned|measured)\b|\d+\s*(?:%|ms\b)/i.test(answer);
  const weakAreas = [];
  if (words < 25) weakAreas.push('Concrete example');
  if (!action) weakAreas.push('Your specific actions');
  if (!outcome) weakAreas.push('Outcome or verification');
  const score = words < 8 ? 1 : words < 25 ? 2 : 3 + Number(action) + Number(outcome);
  return {
    score,
    weakAreas,
    feedback: weakAreas.length ? 'Strengthen this answer with ' + weakAreas.map((item) => item.toLowerCase()).join(', ') + '. Give one example and explain your reasoning.'
      : 'You described your actions and included an outcome. In a live interview, be ready to explain the trade-offs and how you verified the result.',
    source: 'local'
  };
}

export async function evaluateAnswer({ turn, original, answer, jobTitle, generate, userId }) {
  const output = await generate({
    userId,
    instruction: 'Evaluate a job seeker’s answer for relevance, accuracy, specificity and evidence. Score 1 (missing) to 5 (strong). Give concise, constructive feedback. If score is 1 or 2, ask one focused follow-up addressing the main gap. Never repeat the same question or reveal personal contact details.',
    data: { jobTitle: redactContact(jobTitle), question: redactContact(turn.text), originalQuestion: redactContact(original.text), answer: redactContact(answer) },
    schema: evaluationSchema
  });
  if (!output) return { evaluation: localEvaluation(answer) };
  const { followup, ...evaluation } = output;
  return { evaluation: { ...evaluation, source: 'gemini' }, followup };
}

export function applyEvaluation(session, turn, answer, { evaluation, followup }) {
  const parentId = turn.parentId || turn.questionId;
  const followups = session.turns.filter((item) => item.parentId === parentId);
  turn.answer = answer;
  turn.evaluation = evaluation;
  if (evaluation.score <= 2 && followups.length < 2) {
    const fallback = followups.length
      ? 'What would you measure, test, or observe to show that your approach worked?'
      : 'Can you give one concrete example and walk me through the steps you personally took?';
    const asked = session.turns.some((item) => item.text.toLowerCase() === followup?.trim().toLowerCase());
    const next = makeTurn('followup', followup?.trim() && !asked ? followup.trim() : fallback, parentId);
    const index = session.turns.indexOf(turn);
    session.turns.splice(index + 1, 0, next);
  }
  if (session.turns.every((item) => item.answer)) {
    session.status = 'complete';
    const evaluations = session.turns.map((item) => item.evaluation);
    const weakAreas = [...new Set(evaluations.flatMap((item) => item.weakAreas))];
    session.summary = {
      score: Math.round(evaluations.reduce((sum, item) => sum + item.score, 0) / evaluations.length * 10) / 10,
      weakAreas,
      improvements: [...new Set([
        ...weakAreas.map((area) => 'Practice an answer that demonstrates ' + area.toLowerCase() + '.'),
        'Prepare one recent example using situation, task, action and result.',
        'Rehearse explaining one technical trade-off and how you validated it.',
        'Add a measurable outcome or a clear observation to each project example.'
      ])].slice(0, 3)
    };
  }
}
