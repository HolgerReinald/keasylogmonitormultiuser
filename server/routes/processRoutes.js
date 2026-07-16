/**
 * Keasy Log Monitor — Process Routes
 * errors, open-folder/file, pause/resume, clear, stop, restart, email-toggle
 */

const fs = require('fs');
const { execFile } = require('child_process');
const parseJsonBody = require('../parseJsonBody');
const { errorStore, fileLabelMap, pausedLabels, emailDisabledLabels, trashStore, state: rState, resetWatcherRuntime, performanceStore } = require('../runtimeStore');
const { broadcast, broadcastTrash } = require('../wsBroadcast');
const { moveToTrash, sealCurrentBatch, enforceTrashLimit } = require('../trashService');
const { getAllErrors, startWatching, getLabelForFile } = require('../watchService');
const { canAccessLabel } = require('../userConfigStore');

module.exports = function processRoutes(deps) {
  const { activeWatchersRef } = deps;

  return {
    'GET /api/errors': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(getAllErrors()));
    },

    'POST /api/open-folder': (req, res) => {
      parseJsonBody(req, (body) => {
        const filePath = body && body.filePath;
        if (!filePath) {
          res.writeHead(400);
          res.end('filePath fehlt');
          return;
        }
        execFile('explorer.exe', ['/select,' + filePath], () => {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    },

    'POST /api/open-file': (req, res) => {
      parseJsonBody(req, (body) => {
        const filePath = body && body.filePath;
        if (!filePath) {
          res.writeHead(400);
          res.end('filePath fehlt');
          return;
        }
        execFile('explorer.exe', [filePath], () => {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    },

    'POST /api/pause-source': (req, res) => {
      parseJsonBody(req, (body) => {
        const label = body && body.label;
        if (!label) { res.writeHead(400); res.end('label fehlt'); return; }
        if (!canAccessLabel(req.session, label)) { res.writeHead(403); res.end(JSON.stringify({ ok: false, message: 'Kein Zugriff auf diesen Pfad' })); return; }
        pausedLabels.add(label);
        broadcast({ type: 'source-paused', data: { label } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    },

    'POST /api/resume-source': (req, res) => {
      parseJsonBody(req, (body) => {
        const label = body && body.label;
        if (!label) { res.writeHead(400); res.end('label fehlt'); return; }
        if (!canAccessLabel(req.session, label)) { res.writeHead(403); res.end(JSON.stringify({ ok: false, message: 'Kein Zugriff auf diesen Pfad' })); return; }
        pausedLabels.delete(label);
        broadcast({ type: 'source-resumed', data: { label } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    },

    'POST /api/clear-source': (req, res) => {
      parseJsonBody(req, (body) => {
        const label = body && body.label;
        const dateFrom = body && body.dateFrom;
        const dateTo = body && body.dateTo;
        const cutoff = body && body.cutoff;
        if (!label) { res.writeHead(400); res.end('label fehlt'); return; }
        if (!canAccessLabel(req.session, label)) { res.writeHead(403); res.end(JSON.stringify({ ok: false, message: 'Kein Zugriff auf diesen Pfad' })); return; }

        let movedCount = 0;
        for (const [filePath, lbl] of fileLabelMap) {
          if (lbl === label) {
            if (dateFrom || dateTo || cutoff) {
              const errors = errorStore.get(filePath);
              if (errors) {
                const fromDate = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
                const toDate = dateTo ? new Date(dateTo + 'T23:59:59.999') : null;
                const cutoffDate = cutoff ? new Date(cutoff) : null;
                const remaining = [];
                const toTrash = [];
                for (const e of errors) {
                  const t = new Date(e.timestamp);
                  let keep = false;
                  if (cutoffDate && t < cutoffDate) keep = true;
                  if (fromDate && t < fromDate) keep = true;
                  if (toDate && t > toDate) keep = true;
                  if (keep) remaining.push(e); else toTrash.push(e);
                }
                moveToTrash(filePath, toTrash, label);
                movedCount += toTrash.length;
                if (remaining.length === 0) {
                  errorStore.delete(filePath);
                } else {
                  errorStore.set(filePath, remaining);
                }
              }
            } else {
              const errors = errorStore.get(filePath);
              if (errors) {
                moveToTrash(filePath, errors, label);
                movedCount += errors.length;
              }
              errorStore.delete(filePath);
            }
          }
        }
        sealCurrentBatch(label);
        enforceTrashLimit();
        broadcast({ type: 'source-cleared', data: { label, dateFrom, dateTo, cutoff } });
        if (movedCount > 0) broadcastTrash();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, movedToTrash: movedCount }));
      });
    },

    'POST /api/performance-clear-source': (req, res) => {
      parseJsonBody(req, (body) => {
        const label = body && body.label;
        if (!label) { res.writeHead(400); res.end('label fehlt'); return; }
        if (!canAccessLabel(req.session, label)) { res.writeHead(403); res.end(JSON.stringify({ ok: false, message: 'Kein Zugriff auf diesen Pfad' })); return; }

        // Direktes Löschen ohne Papierkorb — Performance-Einträge sind aus den Logs reproduzierbar
        for (const filePath of [...performanceStore.keys()]) {
          const lbl = fileLabelMap.get(filePath) || getLabelForFile(filePath) || '';
          if (lbl === label) performanceStore.delete(filePath);
        }
        broadcast({ type: 'performance-source-cleared', data: { label } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    },

    'POST /api/clear-all': (req, res) => {
      parseJsonBody(req, (body) => {
        const dateFrom = body && body.dateFrom;
        const dateTo = body && body.dateTo;
        const cutoff = body && body.cutoff;
        let movedCount = 0;
        if (dateFrom || dateTo || cutoff) {
          const fromDate = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
          const toDate = dateTo ? new Date(dateTo + 'T23:59:59.999') : null;
          const cutoffDate = cutoff ? new Date(cutoff) : null;
          for (const [filePath, errors] of errorStore) {
            const label = fileLabelMap.get(filePath) || getLabelForFile(filePath) || 'Sonstige';
            if (!canAccessLabel(req.session, label)) continue;
            const remaining = [];
            const toTrash = [];
            for (const e of errors) {
              const t = new Date(e.timestamp);
              let keep = false;
              if (cutoffDate && t < cutoffDate) keep = true;
              if (fromDate && t < fromDate) keep = true;
              if (toDate && t > toDate) keep = true;
              if (keep) remaining.push(e); else toTrash.push(e);
            }
            moveToTrash(filePath, toTrash, label);
            movedCount += toTrash.length;
            if (remaining.length === 0) {
              errorStore.delete(filePath);
            } else {
              errorStore.set(filePath, remaining);
            }
          }
        } else {
          for (const [filePath, errors] of errorStore) {
            const label = fileLabelMap.get(filePath) || getLabelForFile(filePath) || 'Sonstige';
            if (!canAccessLabel(req.session, label)) continue;
            moveToTrash(filePath, errors, label);
            movedCount += errors.length;
            errorStore.delete(filePath);
          }
        }
        for (const label of trashStore.keys()) sealCurrentBatch(label);
        enforceTrashLimit();
        broadcast({ type: 'all-cleared', data: { dateFrom, dateTo, cutoff } });
        if (movedCount > 0) broadcastTrash();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, movedToTrash: movedCount }));
      });
    },

    'POST /api/open-file-at-line': (req, res) => {
      parseJsonBody(req, (body) => {
        const filePath = body && body.filePath;
        const searchText = body && body.searchText;
        if (!filePath) { res.writeHead(400); res.end('filePath fehlt'); return; }

        let lineNumber = 1;
        try {
          if (searchText) {
            const content = fs.readFileSync(filePath, 'utf8');
            const lines = content.split(/\r?\n/);
            const firstLine = searchText.split('\n')[0].trim();
            for (let i = lines.length - 1; i >= 0; i--) {
              if (lines[i].includes(firstLine)) {
                lineNumber = i + 1;
                break;
              }
            }
          }
        } catch { }

        execFile('code', ['-g', `${filePath}:${lineNumber}`], (err) => {
          if (err) {
            execFile('C:\\Program Files\\Notepad++\\notepad++.exe', [`-n${lineNumber}`, filePath], (err2) => {
              if (err2) {
                execFile('notepad.exe', [filePath], () => {});
              }
            });
          }
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, lineNumber }));
      });
    },

    'POST /api/email-disable-source': (req, res) => {
      parseJsonBody(req, (body) => {
        const label = body && body.label;
        if (!label) { res.writeHead(400); res.end('label fehlt'); return; }
        emailDisabledLabels.add(label);
        broadcast({ type: 'email-disabled', data: { label } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    },

    'POST /api/email-enable-source': (req, res) => {
      parseJsonBody(req, (body) => {
        const label = body && body.label;
        if (!label) { res.writeHead(400); res.end('label fehlt'); return; }
        emailDisabledLabels.delete(label);
        broadcast({ type: 'email-enabled', data: { label } });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    },

    'POST /api/stop-server': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      console.log('\nLog Monitor wird über Dashboard beendet...');
      setTimeout(() => { process.exit(0); }, 200);
    },

    'POST /api/restart-watcher': (req, res) => {
      activeWatchersRef.current.forEach(w => w.close());
      console.log('FileWatcher wird neu gestartet...');
      resetWatcherRuntime();
      activeWatchersRef.current = startWatching();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    },

    'GET /api/paused-sources': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify([...pausedLabels]));
    },
  };
};
