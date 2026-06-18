/**
 * Keasy Log Monitor — Analysis Routes
 * analyze-logs/cancel/clear/clear-source/validate-path, analyze-errors
 * Alle Operationen sind per-user isoliert.
 */

const fs = require('fs');
const path = require('path');
const parseJsonBody = require('../parseJsonBody');
const { getOrCreateAnalyzeUser } = require('../runtimeStore');
const { broadcastToUser } = require('../wsBroadcast');
const { runAnalysis, getAnalyzeErrors } = require('../analysisService');
const { canAccessLabel } = require('../userConfigStore');

module.exports = function analysisRoutes(deps) {
  return {
    'POST /api/analyze-logs': (req, res) => {
      parseJsonBody(req, (body) => {
        const paths = body && body.paths;
        const maxErrors = (body && body.maxErrorsPerFile) || 100;
        if (!paths || !Array.isArray(paths) || paths.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'paths Array fehlt' }));
          return;
        }
        const username = req.session ? req.session.username : 'unbekannt';
        const au = getOrCreateAnalyzeUser(username);
        if (au.running) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Analyse läuft bereits' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        runAnalysis(paths, maxErrors, username).catch(err => {
          console.error('⚠️  Analyse-Fehler:', err.message);
          broadcastToUser(username, { type: 'analyze-done', data: { total: 0, processed: 0, errors: 0, aborted: true, error: err.message } });
        });
      });
    },

    'POST /api/analyze-cancel': (req, res) => {
      const username = req.session ? req.session.username : '';
      if (username) {
        const au = getOrCreateAnalyzeUser(username);
        au.aborted = true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    },

    'POST /api/analyze-clear': (req, res) => {
      const username = req.session ? req.session.username : '';
      if (username) {
        const au = getOrCreateAnalyzeUser(username);
        au.runId++;
        au.running = false;
        au.aborted = false;
        au.store.clear();
        au.labelMap.clear();
        broadcastToUser(username, { type: 'analyze-cleared' });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    },

    'POST /api/analyze-clear-source': (req, res) => {
      parseJsonBody(req, (body) => {
        const label = body && body.label;
        if (!label) { res.writeHead(400); res.end('label fehlt'); return; }
        // Kein canAccessLabel-Check nötig: Analyse ist per-user isoliert
        const username = req.session ? req.session.username : '';
        if (username) {
          const au = getOrCreateAnalyzeUser(username);
          for (const [filePath, lbl] of au.labelMap) {
            if (lbl === label) {
              au.store.delete(filePath);
              au.labelMap.delete(filePath);
            }
          }
          broadcastToUser(username, { type: 'analyze-source-cleared', data: { label } });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    },

    'POST /api/analyze-validate-path': (req, res) => {
      parseJsonBody(req, (body) => {
        const p = body && body.path;
        if (!p || typeof p !== 'string' || !p.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Kein Pfad angegeben' }));
          return;
        }
        try {
          const resolved = path.resolve(p.trim());
          if (!fs.existsSync(resolved)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, message: 'Pfad existiert nicht: ' + resolved }));
            return;
          }
          const stat = fs.statSync(resolved);
          const type = stat.isDirectory() ? 'directory' : 'file';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, resolved, type }));
        } catch (err) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Zugriffsfehler: ' + err.message }));
        }
      });
    },

    'GET /api/analyze-errors': (req, res) => {
      const username = req.session ? req.session.username : '';
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(getAnalyzeErrors(username)));
    },
  };
};
