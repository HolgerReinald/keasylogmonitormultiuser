/**
 * Keasy Log Monitor — Backup Routes
 * backup run/list/delete/status/test-connection/preview/restore
 */

const parseJsonBody = require('../parseJsonBody');
const backupService = require('../backupService');

module.exports = function backupRoutes(deps) {
  return {
    'POST /api/backup/run': (req, res) => {
      backupService.runBackup().then(result => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      }).catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: err.message }));
      });
    },

    'GET /api/backup/list': (req, res) => {
      backupService.listBackups().then(list => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(list));
      }).catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: err.message }));
      });
    },

    'POST /api/backup/delete': (req, res) => {
      parseJsonBody(req, (body) => {
        if (!body || !body.source || !body.filename) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'source+filename fehlt' })); return; }
        backupService.deleteBackup(body.source, body.sourceId, body.filename).then(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        }).catch(err => {
          const status = err.statusCode || 500;
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        });
      });
    },

    'GET /api/backup/status': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(backupService.readStatus()));
    },

    'POST /api/backup/test-connection': (req, res) => {
      parseJsonBody(req, (body) => {
        if (!body || !body.target) { res.writeHead(400); res.end('target fehlt'); return; }
        backupService.testConnection(body.target, body).then(result => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        }).catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        });
      });
    },

    'POST /api/backup/preview': (req, res) => {
      parseJsonBody(req, (body) => {
        if (!body || !body.source || !body.filename) { res.writeHead(400); res.end('source+filename fehlt'); return; }
        backupService.previewRestore(body.source, body.filename, body.sourceId).then(result => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        }).catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: err.message }));
        });
      });
    },

    'POST /api/backup/restore': (req, res) => {
      parseJsonBody(req, (body) => {
        if (!body || !body.source || !body.filename) { res.writeHead(400); res.end('source+filename fehlt'); return; }
        backupService.restoreBackup(body.source, body.filename, body.sourceId).then(result => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          if (result.ok) {
            console.log('[Backup] Restore erfolgreich — Server wird in 1s neu gestartet');
            setTimeout(() => process.exit(0), 1000);
          }
        }).catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: err.message }));
        });
      });
    },
  };
};
