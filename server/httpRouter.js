/**
 * Keasy Log Monitor — HTTP Router (Dispatcher)
 * Statische Dateien + Route-Map-Lookup.
 */

const fs = require('fs');
const path = require('path');
const { getEffectiveSession } = require('./sessionMiddleware');

// --- Auth-Guard Konfiguration ---

const PUBLIC_ROUTES = new Set([
  'POST /api/auth/login',
  'GET /api/auth/me'
]);

const ADMIN_ONLY_ROUTES = new Set([
  // 'POST /api/config' — erlaubt für alle (User-Felder werden gesplittet, globale Config nur für Admins)
  'POST /api/style',
  'POST /api/docs',
  'POST /api/stop-server',
  'POST /api/restart-watcher',
  'POST /api/update-docs',
  'DELETE /api/email-log',
  'POST /api/backup/run',
  'POST /api/backup/delete',
  'POST /api/backup/test-connection',
  'POST /api/backup/preview',
  'POST /api/backup/restore',
  'POST /api/backup/local/add',
  'POST /api/backup/local/remove',
  'POST /api/export-copilot-context',
  'POST /api/system-check/run',
  'GET /api/users',
  'POST /api/users',
  'POST /api/users/update',
  'POST /api/users/delete'
]);

// --- Route-Map Merge mit Duplicate-Key-Schutz ---

function mergeRoutes(...maps) {
  const merged = {};
  for (const m of maps) {
    for (const key of Object.keys(m)) {
      if (merged[key]) throw new Error(`Duplicate route: ${key}`);
      merged[key] = m[key];
    }
  }
  return merged;
}

// --- Router Factory ---

module.exports = function createRouter(deps) {
  const publicDir = path.resolve(__dirname, '..', 'public');

  const routes = mergeRoutes(
    require('./routes/authRoutes')(),
    require('./routes/userRoutes')(),
    require('./routes/processRoutes')(deps),
    require('./routes/trashRoutes')(deps),
    require('./routes/backupRoutes')(deps),
    require('./routes/analysisRoutes')(deps),
    require('./routes/configRoutes')(deps)
  );

  return function handleRequest(req, res) {
    // Statische Dateien aus public/ (mit Path-Traversal-Schutz)
    const staticExtensions = { '.css': 'text/css', '.js': 'application/javascript' };
    const ext = path.extname(req.url);
    if (staticExtensions[ext] && !req.url.startsWith('/api/')) {
      let urlPath;
      try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
      catch { res.writeHead(400); res.end('Bad Request'); return; }
      const filePath = path.resolve(publicDir, urlPath.replace(/^\/+/, ''));
      if (!filePath.startsWith(publicDir + path.sep) && filePath !== publicDir) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': staticExtensions[ext] + '; charset=utf-8' });
        res.end(data);
      });
      return;
    }

    // index.html
    if (req.url === '/' || req.url === '/index.html') {
      const htmlPath = path.join(publicDir, 'index.html');
      fs.readFile(htmlPath, 'utf8', (err, data) => {
        if (err) {
          res.writeHead(500);
          res.end('Fehler beim Laden der Seite');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
      return;
    }

    // API-Route-Lookup
    let urlPath;
    try { urlPath = req.url.split('?')[0]; }
    catch { res.writeHead(400); res.end('Bad Request'); return; }
    const key = req.method + ' ' + urlPath;
    const handler = routes[key];
    if (handler) {
      // Auth-Guard: Prüfe Authentifizierung und Berechtigung
      if (!PUBLIC_ROUTES.has(key)) {
        const session = getEffectiveSession(req);
        if (!session) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Nicht angemeldet' }));
          return;
        }
        req.session = session;
        if (ADMIN_ONLY_ROUTES.has(key) && session.role !== 'admin') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Nur für Administratoren' }));
          return;
        }
      }
      try {
        const result = handler(req, res);
        if (result && typeof result.catch === 'function') {
          result.catch(err => {
            console.error(`⚠️  Route-Fehler [${key}]:`, err.message);
            if (!res.headersSent) { res.writeHead(500); res.end('Internal Server Error'); }
          });
        }
      } catch (err) {
        console.error(`⚠️  Route-Fehler [${key}]:`, err.message);
        if (!res.headersSent) { res.writeHead(500); res.end('Internal Server Error'); }
      }
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  };
};
