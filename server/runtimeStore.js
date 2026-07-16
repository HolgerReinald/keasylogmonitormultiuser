/**
 * Keasy Log Monitor — Runtime Store
 * Gemeinsame Runtime-Datenstrukturen für alle Server-Module.
 */

const path = require('path');

// watchPaths normalisieren: String-Fallback → { path, label }
const config = require('../config');
const normalizedWatchPaths = config.watchPaths.map(entry => {
  if (typeof entry === 'string') {
    return { path: entry, label: path.basename(entry) || entry, emailTo: null };
  }
  return { ...entry };
});

// --- Maps/Sets (Referenztypen) ---

const errorStore = new Map();           // filePath → Array<{timestamp, line, context}>
const filePositions = new Map();        // filePath → byteOffset
const pendingBuffers = new Map();       // filePath → unvollständige Zeile
const pendingFlushTimers = new Map();   // filePath → Timer-ID
const fileLabelMap = new Map();         // filePath → label
const pausedLabels = new Set();         // Set von pausierten Labels
const analyzeStore = new Map();         // DEPRECATED — nur noch Rückwärtskompatibilität
const analyzeLabelMap = new Map();      // DEPRECATED
const oversizedFiles = new Map();       // filePath → sizeMB (Dateien > maxLogFileSizeMB)
const performanceStore = new Map();     // filePath → Array<{timestamp, prevTimestamp, gapSeconds, line, file}>
const lastEntryTimestamps = new Map();  // filePath → Date des letzten Log-Eintrags (Gap-Erkennung)
// Per-User Analyse: Map<username, { store: Map, labelMap: Map, running, aborted, runId }>
const analyzeUsers = new Map();

function getOrCreateAnalyzeUser(username) {
  if (!analyzeUsers.has(username)) {
    analyzeUsers.set(username, {
      store: new Map(),       // filePath → errors[]
      labelMap: new Map(),    // filePath → label
      running: false,
      aborted: false,
      runId: 0,
    });
  }
  return analyzeUsers.get(username);
}
const trashStore = new Map();           // label → { batches: [...] }
const emailDisabledLabels = new Set();
const emailBuffer = new Map();          // label → Array<{timestamp, line, file}>
const sentHashes = new Map();           // hash → timestamp

// --- Mutable state (als Objekt, damit Zuweisungen über Referenz funktionieren) ---
const state = {
  analyzeAborted: false,
  analyzeRunning: false,
  trashAutoCleanupHours: config.trashAutoCleanupHours || 48,
  trashRevision: 0,
  trashLocked: false,
  trashBatchCounter: 0,
};

// --- Preload-State ---
const preload = {
  queue: [],                 // { filePath, label, flushDelay }
  deferredQueue: [],         // { filePath, label, flushDelay } — große Dateien, zuletzt eingelesen
  watchersReady: 0,
  watchersTotal: 0,
  running: false,
  generation: 0,
  readyTimer: null,
  lastBroadcast: 0,
};

// --- Hilfsfunktionen ---

function resetWatcherRuntime() {
  // Timer clearen
  for (const timer of pendingFlushTimers.values()) {
    clearTimeout(timer);
  }
  pendingFlushTimers.clear();
  pendingBuffers.clear();
  filePositions.clear();
  fileLabelMap.clear();
  errorStore.clear();
  oversizedFiles.clear();
  performanceStore.clear();
  lastEntryTimestamps.clear();
  // Preload resetten
  preload.generation++;
  preload.queue.length = 0;
  preload.deferredQueue.length = 0;
  preload.watchersReady = 0;
  preload.watchersTotal = 0;
  preload.running = false;
  if (preload.readyTimer) clearTimeout(preload.readyTimer);
  preload.readyTimer = null;
}

module.exports = {
  // Maps/Sets direkt
  errorStore,
  filePositions,
  pendingBuffers,
  pendingFlushTimers,
  fileLabelMap,
  pausedLabels,
  analyzeStore,
  analyzeLabelMap,
  oversizedFiles,
  performanceStore,
  lastEntryTimestamps,
  analyzeUsers,
  getOrCreateAnalyzeUser,
  trashStore,
  emailDisabledLabels,
  emailBuffer,
  sentHashes,
  normalizedWatchPaths,
  // Mutable state als Objekt
  state,
  preload,
  // Funktionen
  resetWatcherRuntime,
};
