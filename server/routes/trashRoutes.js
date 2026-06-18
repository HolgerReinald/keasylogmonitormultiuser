/**
 * Keasy Log Monitor — Trash Routes
 * Papierkorb: list, restore, restore-all, empty, empty-source
 */

const parseJsonBody = require('../parseJsonBody');
const { errorStore, fileLabelMap, state: rState, trashStore } = require('../runtimeStore');
const { broadcast, broadcastTrash } = require('../wsBroadcast');
const { getTrashSnapshot, getTrashTotalCount } = require('../trashService');
const { getAllErrors } = require('../watchService');
const { canAccessLabel } = require('../userConfigStore');

module.exports = function trashRoutes(deps) {
  return {
    'GET /api/trash': (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getTrashSnapshot()));
    },

    'POST /api/trash-restore': (req, res) => {
      parseJsonBody(req, (body) => {
        if (rState.trashLocked) { res.writeHead(409); res.end(JSON.stringify({ ok: false, message: 'Papierkorb wird gerade verarbeitet' })); return; }
        rState.trashLocked = true;
        try {
          const batchId = body && body.batchId;
          const label = body && body.label;
          let restoredCount = 0;
          if (batchId) {
            for (const [lbl, source] of trashStore) {
              const idx = source.batches.findIndex(b => b.batchId === batchId);
              if (idx !== -1) {
                const batch = source.batches.splice(idx, 1)[0];
                for (const [filePath, entries] of batch.files) {
                  const existing = errorStore.get(filePath) || [];
                  errorStore.set(filePath, existing.concat(entries).sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || '')));
                  if (!fileLabelMap.has(filePath)) fileLabelMap.set(filePath, lbl);
                  restoredCount += entries.length;
                }
                if (source.batches.length === 0) trashStore.delete(lbl);
                break;
              }
            }
          } else if (label) {
            if (!canAccessLabel(req.session, label)) { res.writeHead(403); res.end(JSON.stringify({ ok: false, message: 'Kein Zugriff auf diesen Pfad' })); rState.trashLocked = false; return; }
            const source = trashStore.get(label);
            if (source) {
              for (const batch of source.batches) {
                for (const [filePath, entries] of batch.files) {
                  const existing = errorStore.get(filePath) || [];
                  errorStore.set(filePath, existing.concat(entries).sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || '')));
                  if (!fileLabelMap.has(filePath)) fileLabelMap.set(filePath, label);
                  restoredCount += entries.length;
                }
              }
              trashStore.delete(label);
            }
          }
          if (restoredCount > 0) {
            broadcast({ type: 'errors-restored', data: getAllErrors() });
            broadcastTrash();
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, restoredCount }));
        } finally { rState.trashLocked = false; }
      });
    },

    'POST /api/trash-restore-all': (req, res) => {
      if (rState.trashLocked) { res.writeHead(409); res.end(JSON.stringify({ ok: false, message: 'Papierkorb wird gerade verarbeitet' })); return; }
      rState.trashLocked = true;
      try {
        let restoredCount = 0;
        const labelsToDelete = [];
        for (const [label, source] of trashStore) {
          if (!canAccessLabel(req.session, label)) continue;
          for (const batch of source.batches) {
            for (const [filePath, entries] of batch.files) {
              const existing = errorStore.get(filePath) || [];
              errorStore.set(filePath, existing.concat(entries).sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || '')));
              if (!fileLabelMap.has(filePath)) fileLabelMap.set(filePath, label);
              restoredCount += entries.length;
            }
          }
          labelsToDelete.push(label);
        }
        for (const label of labelsToDelete) trashStore.delete(label);
        if (restoredCount > 0) {
          broadcast({ type: 'errors-restored', data: getAllErrors() });
          broadcastTrash();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, restoredCount }));
      } finally { rState.trashLocked = false; }
    },

    'POST /api/trash-empty': (req, res) => {
      if (rState.trashLocked) { res.writeHead(409); res.end(JSON.stringify({ ok: false, message: 'Papierkorb wird gerade verarbeitet' })); return; }
      rState.trashLocked = true;
      try {
        let removedCount = 0;
        if (req.session && req.session.role === 'admin') {
          removedCount = getTrashTotalCount();
          trashStore.clear();
        } else {
          for (const [label, source] of trashStore) {
            if (!canAccessLabel(req.session, label)) continue;
            for (const batch of source.batches) {
              for (const entries of batch.files.values()) removedCount += entries.length;
            }
            trashStore.delete(label);
          }
        }
        broadcastTrash();
        console.log(`🗑️ Papierkorb geleert (${removedCount} Einträge)`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, removedCount }));
      } finally { rState.trashLocked = false; }
    },

    'POST /api/trash-empty-source': (req, res) => {
      parseJsonBody(req, (body) => {
        if (rState.trashLocked) { res.writeHead(409); res.end(JSON.stringify({ ok: false, message: 'Papierkorb wird gerade verarbeitet' })); return; }
        rState.trashLocked = true;
        try {
          const label = body && body.label;
          if (!label) { res.writeHead(400); res.end('label fehlt'); return; }
          if (!canAccessLabel(req.session, label)) { res.writeHead(403); res.end(JSON.stringify({ ok: false, message: 'Kein Zugriff auf diesen Pfad' })); return; }
          let removedCount = 0;
          const source = trashStore.get(label);
          if (source) {
            for (const batch of source.batches) {
              for (const entries of batch.files.values()) removedCount += entries.length;
            }
            trashStore.delete(label);
          }
          broadcastTrash();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, removedCount }));
        } finally { rState.trashLocked = false; }
      });
    },
  };
};
