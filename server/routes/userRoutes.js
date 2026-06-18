/**
 * Keasy Log Monitor — User Routes
 * CRUD für Benutzerverwaltung (nur Admin).
 */

const parseJsonBody = require('../parseJsonBody');
const userStore = require('../userStore');
const { getUserConfig, saveUserConfig } = require('../userConfigStore');
const { disconnectUser } = require('../wsBroadcast');

module.exports = function userRoutes() {
  return {
    'GET /api/users': (req, res) => {
      const users = userStore.listUsers().map(u => {
        const cfg = getUserConfig(u.username);
        return { ...u, visibleLabels: cfg ? (cfg.visibleLabels !== undefined ? cfg.visibleLabels : null) : null };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, users }));
    },

    'POST /api/users': (req, res) => {
      parseJsonBody(req, async (body) => {
        if (!body || !body.username || !body.password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Benutzername und Passwort erforderlich' }));
          return;
        }
        try {
          const user = await userStore.createUser(body.username.trim(), body.password, body.role || 'user');
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, user }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: err.message }));
        }
      });
    },

    'POST /api/users/update': (req, res) => {
      parseJsonBody(req, async (body) => {
        if (!body || !body.username) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Benutzername erforderlich' }));
          return;
        }
        try {
          const user = await userStore.updateUser(body.username, {
            password: body.password || undefined,
            role: body.role || undefined
          });

          // visibleLabels in User-Config speichern
          if (body.visibleLabels !== undefined) {
            const cfg = getUserConfig(body.username) || {};
            cfg.visibleLabels = body.visibleLabels; // null = alle, [] = keine, [...] = Auswahl
            saveUserConfig(body.username, cfg);
            // WS-Verbindung trennen → Client reconnected mit neuen Rechten
            disconnectUser(body.username);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, user }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: err.message }));
        }
      });
    },

    'POST /api/users/delete': (req, res) => {
      parseJsonBody(req, (body) => {
        if (!body || !body.username) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Benutzername erforderlich' }));
          return;
        }
        // Letzten Admin nicht löschen
        const users = userStore.listUsers();
        const admins = users.filter(u => u.role === 'admin');
        const target = users.find(u => u.username === body.username);
        if (target && target.role === 'admin' && admins.length <= 1) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Der letzte Admin kann nicht gelöscht werden' }));
          return;
        }
        try {
          userStore.deleteUser(body.username);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: err.message }));
        }
      });
    },

    'POST /api/users/change-password': (req, res) => {
      parseJsonBody(req, async (body) => {
        if (!body || !body.oldPassword || !body.newPassword) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Altes und neues Passwort erforderlich' }));
          return;
        }
        try {
          const session = req.session;
          const verified = await userStore.verifyPassword(session.username, body.oldPassword);
          if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, message: 'Altes Passwort ist falsch' }));
            return;
          }
          await userStore.updateUser(session.username, { password: body.newPassword });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: 'Passwort geändert' }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: err.message }));
        }
      });
    }
  };
};
