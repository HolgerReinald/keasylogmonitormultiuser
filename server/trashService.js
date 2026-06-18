/**
 * Keasy Log Monitor — Trash Service
 * Papierkorb-Verwaltung: Batches, Eviction, Snapshots.
 */

const { trashStore, state: rState } = require('./runtimeStore');
const { setTrashSnapshotFn } = require('./wsBroadcast');

function generateBatchId() {
  return `batch-${Date.now()}-${++rState.trashBatchCounter}`;
}

function moveToTrash(filePath, entries, label) {
  if (!entries || entries.length === 0) return;
  if (!trashStore.has(label)) {
    trashStore.set(label, { batches: [] });
  }
  const source = trashStore.get(label);
  let batch = source.batches[source.batches.length - 1];
  if (!batch || batch._sealed) {
    batch = { batchId: generateBatchId(), deletedAt: new Date().toISOString(), files: new Map() };
    source.batches.push(batch);
  }
  const existing = batch.files.get(filePath) || [];
  batch.files.set(filePath, existing.concat(entries));
}

function sealCurrentBatch(label) {
  const source = trashStore.get(label);
  if (source && source.batches.length > 0) {
    source.batches[source.batches.length - 1]._sealed = true;
  }
}

function enforceTrashLimit() {
  let total = getTrashTotalCount();
  while (total > 1000) {
    let oldestLabel = null;
    let oldestTime = null;
    for (const [label, source] of trashStore) {
      if (source.batches.length > 0) {
        const t = source.batches[0].deletedAt;
        if (!oldestTime || t < oldestTime) {
          oldestTime = t;
          oldestLabel = label;
        }
      }
    }
    if (!oldestLabel) break;
    const source = trashStore.get(oldestLabel);
    const removed = source.batches.shift();
    if (source.batches.length === 0) trashStore.delete(oldestLabel);
    let removedCount = 0;
    for (const entries of removed.files.values()) removedCount += entries.length;
    total -= removedCount;
    console.log(`🗑️ Trash-Eviction: Batch ${removed.batchId} entfernt (${removedCount} Einträge)`);
  }
}

function getTrashTotalCount() {
  let total = 0;
  for (const [, source] of trashStore) {
    for (const batch of source.batches) {
      for (const entries of batch.files.values()) total += entries.length;
    }
  }
  return total;
}

function getTrashSnapshot() {
  const result = {};
  for (const [label, source] of trashStore) {
    result[label] = source.batches.map(b => {
      const files = {};
      for (const [fp, entries] of b.files) {
        files[fp] = entries;
      }
      return { batchId: b.batchId, deletedAt: b.deletedAt, files };
    });
  }
  return { revision: rState.trashRevision, data: result, totalCount: getTrashTotalCount() };
}

// Side-Effect: getTrashSnapshot bei wsBroadcast registrieren
setTrashSnapshotFn(getTrashSnapshot);

module.exports = { moveToTrash, sealCurrentBatch, enforceTrashLimit, getTrashTotalCount, getTrashSnapshot };
