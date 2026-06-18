/**
 * Keasy Log Monitor — Auth Routes
 * Login, Logout, Session-Info.
 */

const parseJsonBody = require('../parseJsonBody');
const { verifyPassword } = require('../userStore');
const { createSession, destroySession, getSession } = require('../sessionMiddleware');

module.exports = function authRoutes() {
  return {
    'POST /api/auth/login': (req, res) => {
      parseJsonBody(req, async (body) => {
        if (!body || !body.username || !body.password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Benutzername und Passwort erforderlich' }));
          return;
        }

        try {
          const user = await verifyPassword(body.username.trim(), body.password);
          if (!user) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, message: 'Benutzername oder Passwort falsch' }));
            return;
          }

          createSession(res, user.username, user.role);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, user: { username: user.username, role: user.role } }));
        } catch (err) {
          console.error('[Auth] Login-Fehler:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Serverfehler beim Login' }));
        }
      });
    },

    'POST /api/auth/logout': (req, res) => {
      destroySession(req, res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    },

    'GET /api/auth/me': (req, res) => {
      const session = getSession(req);
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'Nicht angemeldet' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, user: { username: session.username, role: session.role } }));
    }
  };
};
