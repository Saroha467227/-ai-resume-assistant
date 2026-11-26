import mongoose from 'mongoose';
import { createApp } from '../server/src/app.js';
import { models } from '../server/src/models.js';

// Express and Multer read the request stream.
export const config = { api: { bodyParser: false } };

let app;
let connection;

function hostedApp() {
  const clientOrigins = (process.env.CLIENT_ORIGIN || '').split(',').map((url) => url.trim()).filter(Boolean);
  for (const key of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
    const hostname = process.env[key];
    if (hostname) clientOrigins.push('https://' + hostname);
  }
  return createApp({
    clientOrigins,
    jwtSecret: process.env.JWT_SECRET,
    secureCookies: true,
    trustProxyHops: 1,
    serveClient: false,
    maxResumeMb: 4,
    llm: {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
      dailyLimit: Math.max(1, Number(process.env.LLM_DAILY_LIMIT) || 40)
    }
  });
}

async function connectDatabase() {
  if (!connection) {
    connection = mongoose.connect(process.env.MONGODB_URI, {
      dbName: process.env.MONGODB_DB_NAME || 'resume_studio',
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
      maxIdleTimeMS: 30_000
    }).then(() => Promise.all(models.map((model) => model.init()))).catch(async (error) => {
      try {
        await mongoose.disconnect();
      } finally {
        connection = undefined;
      }
      throw error;
    });
  }
  return connection;
}

function unavailable(res, message) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = 503;
  return res.end(JSON.stringify({ message }));
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/backend') {
    const route = url.searchParams.get('__resume_api_path');
    if (route && /^[a-z\d/_-]+$/i.test(route)) {
      url.searchParams.delete('__resume_api_path');
      req.url = '/api/' + route + url.search;
    }
  }
  if (!process.env.MONGODB_URI || Buffer.byteLength(process.env.JWT_SECRET || '') < 32) {
    return unavailable(res, 'The deployment is awaiting database and session configuration.');
  }
  try {
    await connectDatabase();
    if (mongoose.connection.readyState !== 1) return unavailable(res, 'Database unavailable. Try again shortly.');
  } catch (error) {
    console.error('Database unavailable:', error.name);
    return unavailable(res, 'Database unavailable. Try again shortly.');
  }
  app ??= hostedApp();
  return app(req, res);
}
