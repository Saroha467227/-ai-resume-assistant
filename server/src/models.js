import mongoose from 'mongoose';

const { Schema, model } = mongoose;
const reference = (ref) => ({ type: Schema.Types.ObjectId, ref, required: true });
const timestamps = { timestamps: true };

const userSchema = new Schema({
  name: String,
  email: { type: String, unique: true, required: true },
  passwordHash: { type: String, select: false },
  password: { type: String, select: false },
  targetRole: { type: String, default: '' },
  workspaceRevision: { type: Number, select: false }
}, timestamps);

const resumeSchema = new Schema({
  userId: reference('User'),
  fileName: String,
  mimeType: String,
  rawText: { type: String, select: false },
  textHash: String,
  parsed: Schema.Types.Mixed
}, timestamps);
resumeSchema.index({ userId: 1, createdAt: -1 });
resumeSchema.index({ userId: 1, textHash: 1 }, { unique: true });

const jobSchema = new Schema({
  userId: reference('User'),
  title: String,
  company: String,
  rawText: { type: String, select: false },
  requiredSkills: [String],
  preferredSkills: [String],
  minimumYears: Number,
  educationRequirements: [String],
  seniority: String,
  extractionSource: String
}, timestamps);
jobSchema.index({ userId: 1, createdAt: -1 });

const reportSchema = new Schema({
  userId: reference('User'),
  resumeId: reference('Resume'),
  jdId: reference('JobDescription'),
  score: Number,
  breakdown: Schema.Types.Mixed,
  matched: [String],
  missing: [String],
  missingPreferred: [String],
  suggestions: [String]
}, timestamps);
reportSchema.index({ userId: 1, resumeId: 1, jdId: 1 }, { unique: true });
reportSchema.index({ userId: 1, updatedAt: -1, _id: -1 });
reportSchema.index({ userId: 1, score: -1 });

const evaluationSchema = new Schema({
  score: { type: Number, min: 1, max: 5 },
  feedback: String,
  weakAreas: [String],
  source: String
}, { _id: false });

const turnSchema = new Schema({
  questionId: String,
  type: { type: String, enum: ['core', 'gap', 'claim', 'followup'] },
  text: String,
  parentId: String,
  answer: String,
  evaluation: evaluationSchema
}, { _id: false });

const interviewSchema = new Schema({
  userId: reference('User'),
  resumeId: reference('Resume'),
  jdId: reference('JobDescription'),
  status: { type: String, enum: ['active', 'complete'], default: 'active' },
  turns: [turnSchema],
  summary: Schema.Types.Mixed
}, { ...timestamps, optimisticConcurrency: true });
interviewSchema.index({ userId: 1, createdAt: -1 });
interviewSchema.index({ userId: 1, updatedAt: -1, _id: -1 });

const questionSchema = new Schema({
  text: { type: String, unique: true },
  skillTags: [String],
  type: { type: String, default: 'core' },
  difficulty: String,
  source: { type: String, default: 'curated' }
});
questionSchema.index({ skillTags: 1 });

const quotaSchema = new Schema({
  _id: String,
  count: Number,
  expiresAt: Date
});
quotaSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const User = model('User', userSchema);
export const Resume = model('Resume', resumeSchema);
export const JobDescription = model('JobDescription', jobSchema);
export const FitReport = model('FitReport', reportSchema);
export const InterviewSession = model('InterviewSession', interviewSchema);
export const QuestionBank = model('QuestionBank', questionSchema);
export const LlmQuota = model('LlmQuota', quotaSchema);

export const models = [User, Resume, JobDescription, FitReport, InterviewSession, QuestionBank, LlmQuota];
