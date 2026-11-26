import mongoose from 'mongoose';
import { QuestionBank } from './models.js';
import { questionBank } from './interview.js';

try {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/resume_studio', { serverSelectionTimeoutMS: 5000 });
  await QuestionBank.init();
  await QuestionBank.bulkWrite(questionBank.map((question) => ({
    updateOne: {
      filter: { text: question.text },
      update: { $setOnInsert: { ...question, source: 'curated', type: 'core' } },
      upsert: true
    }
  })));
  console.log('Seeded ' + questionBank.length + ' curated interview questions.');
} finally {
  await mongoose.disconnect();
}
