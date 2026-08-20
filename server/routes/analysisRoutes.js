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
const dropStore = require('../analyzeDropStore');
const { config } = require('../configStore');
const { canAccessLabel } = require('../userConfigStore');

module.exports = function analysisRoutes(deps) {
  return {
    'POST /api/analyze-logs': (req, res) => {
      parseJsonBody(req, (body) => {
        const paths = body && body.paths;
        // Abgelegte Dateien haengt der Server selbst an: der Client kennt den
        // Ablage-Pfad nicht und soll ihn auch nicht schicken.
        const username0 = req.session ? req.session.username : 'unbekannt';
        const droppedFiles = dropStore.list(username0);
        const dropInput = droppedFiles.length ? [dropStore.userDir(username0)] : [];
        const maxErrors = (body && body.maxErrorsPerFile) || 100;
        const gapOpts = {
          gapWarnSeconds: (body && Number(body.gapWarnSeconds)) || 0,
          gapIdleMinutes: (body && Number(body.gapIdleMinutes)) || 30
        };
        // Nur abgelegte Dateien ohne konfigurierten Pfad ist ein gueltiger Fall.
        if ((!paths || !Array.isArray(paths) || paths.length === 0) && dropInput.length === 0) {
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
        runAnalysis([...(Array.isArray(paths) ? paths : []), ...dropInput], maxErrors, username, gapOpts).catch(err => {
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
        // Laeuft gerade nichts, sendet runAnalysis auch nichts — der Client
        // bliebe im "laeuft"-Zustand haengen und Abbrechen waere ohne jede
        // Wirkung. Genau so ist am 2026-08-20 eine Anzeige klebengeblieben,
        // die nur ein Reload wieder loesen konnte. Deshalb hier selbst ein
        // Ende schicken.
        if (!au.running) {
          broadcastToUser(username, {
            type: 'analyze-done',
            data: { total: 0, processed: 0, errors: 0, gaps: 0, aborted: true, username }
          });
        }
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
        // Abgelegte Dateien gehoeren zum Ergebnis: "Ergebnisse loeschen" raeumt
        // sie deshalb mit weg. Sonst liegen Uploads unbemerkt weiter herum und
        // tauchen beim naechsten Lauf wieder auf.
        dropStore.clear(username);
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

    // === Ablage fuer per Drag & Drop uebergebene Log-Dateien ===
    //
    // Der Upload nimmt den ROHEN Body, nicht JSON: parseJsonBody deckelt bei
    // 1 MB, Logs duerfen laut maxLogFileSizeMB aber deutlich groesser sein.
    // Eine Datei pro Anfrage — dadurch gibt es Fortschritt je Datei, und eine
    // abgewiesene Datei reisst nicht den ganzen Stapel mit.
    'POST /api/analyze-upload': (req, res) => {
      const username = req.session ? req.session.username : '';
      const name = dropStore.safeName(req.headers['x-filename']);
      const send = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(obj));
      };
      if (!name) {
        req.resume();
        send(400, { ok: false, message: 'Nur ' + dropStore.ALLOWED.join(', ') + ' erlaubt' });
        return;
      }
      const maxBytes = Math.max(1, Number(config.maxLogFileSizeMB) || 6) * 1024 * 1024;
      let dir;
      try {
        dir = dropStore.ensureDir(username);
      } catch (err) {
        req.resume();
        send(500, { ok: false, message: 'Ablage nicht schreibbar: ' + err.message });
        return;
      }
      const target = dropStore.uniqueTarget(dir, name);
      const out = fs.createWriteStream(target);
      let written = 0;
      let failed = false;
      const abort = (code, message) => {
        if (failed) return;
        failed = true;
        out.destroy();
        fs.rm(target, { force: true }, () => {});
        req.destroy();
        send(code, { ok: false, name, message });
      };
      req.on('data', chunk => {
        written += chunk.length;
        // Grenze waehrend des Empfangs pruefen, nicht danach: eine 500-MB-Datei
        // soll nicht erst vollstaendig auf die Platte laufen.
        if (written > maxBytes) abort(413, 'groesser als ' + (maxBytes / 1024 / 1024) + ' MB');
      });
      req.on('error', () => abort(400, 'Uebertragung abgebrochen'));
      req.pipe(out);
      out.on('error', (err) => abort(500, err.message));
      out.on('finish', () => {
        if (failed) return;
        if (written === 0) {
          fs.rm(target, { force: true }, () => {});
          send(400, { ok: false, name, message: 'leer' });
          return;
        }
        // ZIP wird entpackt und selbst verworfen — analysiert werden die
        // enthaltenen .log/.json, nicht das Archiv.
        if (path.extname(target).toLowerCase() === '.zip') {
          const { added, skipped } = dropStore.extractZip(target, dir);
          fs.rm(target, { force: true }, () => {});
          send(200, { ok: added.length > 0, zip: true, name, added, skipped,
            message: added.length ? '' : 'Keine .log/.json im Archiv' });
          return;
        }
        send(200, { ok: true, name: path.basename(target), size: written });
      });
    },

    'GET /api/analyze-dropped': (req, res) => {
      const username = req.session ? req.session.username : '';
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, files: dropStore.list(username) }));
    },

    'POST /api/analyze-drop-remove': (req, res) => {
      parseJsonBody(req, (body) => {
        const username = req.session ? req.session.username : '';
        const done = body && body.all
          ? (dropStore.clear(username), true)
          : dropStore.remove(username, body && body.name);
        res.writeHead(done ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: done, files: dropStore.list(username) }));
      });
    },

    'GET /api/analyze-errors': (req, res) => {
      const username = req.session ? req.session.username : '';
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(getAnalyzeErrors(username)));
    },
  };
};
