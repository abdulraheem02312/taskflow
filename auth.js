import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import db from './db.js';

const SESSION_DAYS = 7;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function checkPassword(password, stored) {
  if (!stored) return false; // Google-only accounts have no password
  const [salt, hash] = stored.split(':');
  const test = scryptSync(password, salt, 64);
  return timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

export async function createSession(res, userId) {
  const token = randomBytes(32).toString('hex');
  const maxAge = SESSION_DAYS * 24 * 60 * 60 * 1000;
  await db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, Date.now() + maxAge);
  // Live site runs on https, so the cookie is never sent over plain http there
  res.cookie('session', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge });
}

export async function destroySession(req, res) {
  const token = readCookie(req, 'session');
  if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie('session');
}

// Log out every other browser/device, keep the one making this request. Returns how many.
export async function destroyOtherSessions(req, userId) {
  const token = readCookie(req, 'session') || '';
  return (await db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, token)).changes;
}

export async function destroyAllSessions(userId) {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export async function currentUser(req) {
  const token = readCookie(req, 'session');
  if (!token) return null;
  const row = await db.prepare(`
    SELECT users.id, users.name, users.email, sessions.expires_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token = ?
  `).get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { id: row.id, name: row.name, email: row.email };
}

// For API routes: reply 401 if not logged in
export async function requireUser(req, res, next) {
  req.user = await currentUser(req);
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
