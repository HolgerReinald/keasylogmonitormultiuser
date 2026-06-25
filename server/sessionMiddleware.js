/**
 * Keasy Log Monitor — Session Middleware
 * In-Memory Cookie-Sessions mit HttpOnly + SameSite=Strict.
 */

const crypto = require('crypto');
const configStore = require('./configStore');

const sessions = new Map();
const SESSION_COOKIE = 'keasy-session';
const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 Stunden

// Implizite Admin-Session für den Auth-Off-Modus (Einzelbenutzer-Verhalten).
const IMPLICIT_ADMIN = { username: 'admin', role: 'admin' };

// Effektive Session: bei deaktiviertem Rechtesystem immer impliziter Admin,
// sonst die echte Cookie-Session. Zentral, damit HTTP- und WS-Pfad identisch sind.
function getEffectiveSession(req) {
  if (!configStore.isAuthEnabled()) return IMPLICIT_ADMIN;
  return getSession(req);
}

// --- Session erstellen ---

function createSession(res, username, role) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, role, createdAt: Date.now() });

  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`
  );
  return token;
}

// --- Session löschen ---

function destroySession(req, res) {
  const token = getToken(req);
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
  );
}

// --- Session lesen ---

function getSession(req) {
  const token = getToken(req);
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;

  // Timeout prüfen
  if (Date.now() - session.createdAt > SESSION_TIMEOUT_MS) {
    sessions.delete(token);
    return null;
  }

  return session;
}

// --- Cookie-Token extrahieren ---

function getToken(req) {
  const cookie = req.headers.cookie;
  if (!cookie) return null;

  const match = cookie.split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(SESSION_COOKIE + '='));

  return match ? match.split('=')[1] : null;
}

// --- Auth-Guard Helper ---

function requireAuth(req) {
  return getSession(req);
}

function requireAdmin(req) {
  const session = getSession(req);
  if (!session) return null;
  return session.role === 'admin' ? session : false;
}

module.exports = { createSession, destroySession, getSession, getEffectiveSession, requireAuth, requireAdmin, IMPLICIT_ADMIN };
