import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { z } from 'zod';
import { User } from './models.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid record ID.');
export const pairInput = z.object({ resumeId: objectId, jdId: objectId });
export const sessionCookie = 'resume_session';

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name || user.email.split('@')[0],
    email: user.email,
    targetRole: user.targetRole || ''
  };
}

export function sessionMiddleware({ jwtSecret, secureCookies }) {
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/' };
  return {
    set(res, user) {
      const token = jwt.sign({}, jwtSecret, {
        algorithm: 'HS256',
        subject: user.id,
        issuer: 'resume-studio',
        expiresIn: '8h'
      });
      res.cookie(sessionCookie, token, { ...cookieOptions, maxAge: 8 * 60 * 60 * 1000 });
    },
    clear(res) {
      res.clearCookie(sessionCookie, cookieOptions);
    },
    async require(req, _res, next) {
      let claims;
      try {
        claims = jwt.verify(req.cookies[sessionCookie] || '', jwtSecret, {
          algorithms: ['HS256'],
          issuer: 'resume-studio'
        });
      } catch {
        throw new HttpError(401, 'Sign in to continue.');
      }
      req.user = await User.findById(claims.sub);
      if (!req.user) throw new HttpError(401, 'Sign in to continue.');
      next();
    }
  };
}

export async function owned(model, userId, id, projection) {
  const item = await model.findOne({ _id: objectId.parse(id), userId }).select(projection || '');
  if (!item) throw new HttpError(404, 'This record could not be found.');
  return item;
}

export function handleError(error, _req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof z.ZodError) {
    return res.status(400).json({ message: error.issues[0]?.message || 'Check your input.' });
  }
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ message: 'Upload a resume of 5 MB or less.' });
  }
  if (error.name === 'MulterError') {
    return res.status(400).json({ message: 'Upload exactly one resume file.' });
  }
  if (error.code === 11000) {
    return res.status(409).json({ message: 'This record already exists.' });
  }
  if (error instanceof mongoose.Error.VersionError) {
    return res.status(409).json({ message: 'This interview changed. Reload it and try again.' });
  }
  if (error instanceof HttpError || (error.status >= 400 && error.status < 500)) {
    return res.status(error.status).json({ message: error instanceof HttpError ? error.message : 'Invalid request.' });
  }
  console.error('Request failed:', error.name);
  return res.status(500).json({ message: 'Something went wrong. Please try again.' });
}
