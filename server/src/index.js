import mongoose from 'mongoose';
import { createApp } from './app.js';
import { models } from './models.js';

const {
  MONGODB_URI = 'mongodb://127.0.0.1:27017/resume_studio',
  JWT_SECRET,
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-3.5-flash',
  LLM_DAILY_LIMIT = '40',
  CLIENT_ORIGIN = 'http://localhost:5173',
  PORT = '5000',
  TRUST_PROXY_HOPS = '0',
  NODE_ENV = 'development'
} = process.env;

if (!JWT_SECRET || Buffer.byteLength(JWT_SECRET) < 32) {
  console.error('Set JWT_SECRET to at least 32 bytes in server/.env. See the README for setup.');
  process.exit(1);
}
const port = Number(PORT);
const clientOrigins = CLIENT_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
if (NODE_ENV !== 'production') {
  clientOrigins.push('http://localhost:' + port, 'http://127.0.0.1:' + port, 'http://127.0.0.1:5173');
}

try {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await Promise.all(models.map((model) => model.init()));
} catch (error) {
  console.error('MongoDB connection or initialization failed. Check MONGODB_URI and start MongoDB.', error.name);
  await mongoose.disconnect();
  process.exit(1);
}

const app = createApp({
  clientOrigins,
  jwtSecret: JWT_SECRET,
  secureCookies: NODE_ENV === 'production',
  trustProxyHops: Number(TRUST_PROXY_HOPS),
  llm: { apiKey: GEMINI_API_KEY, model: GEMINI_MODEL, dailyLimit: Math.max(1, Number(LLM_DAILY_LIMIT) || 40) }
});
const server = app.listen(port, NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1', () => {
  console.log('Resume Studio API listening at http://127.0.0.1:' + port);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  }));
}
