/**
 * Keasy Log Monitor — Watch Service
 * File-Watcher, Tail-Logik, Preload-Koordination.
 */

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { errorStore, filePositions, pendingBuffers, pendingFlushTimers, fileLabelMap, pausedLabels, normalizedWatchPaths, preload, oversizedFiles } = require('./runtimeStore');
const { broadcast, broadcastFiltered } = require('./wsBroadcast');
const { config } = require('./configStore');
const { matchesFilter, limitStackTrace, parseLogEntries } = require('./logParser');
const { bufferErrorForEmail } = require('./emailService');

// --- Tail-Logik ---

function processNewLines(filePath, changeDetectedAt, flushDelay) {
  const label = fileLabelMap.get(filePath) || '';
  if (pausedLabels.has(label)) return;
  if (!flushDelay) flushDelay = 500;

  try {
    const stat = fs.statSync(filePath);
    const previousPos = filePositions.get(filePath) || 0;

    let readPos = previousPos;
    if (stat.size < previousPos) {
      readPos = 0;
      pendingBuffers.delete(filePath);
    }

    if (stat.size === readPos) return;

    const bufferSize = stat.size - readPos;
    const buffer = Buffer.alloc(bufferSize);
    let fd;
    try {
      fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, bufferSize, readPos);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    filePositions.set(filePath, stat.size);

    const pending = pendingBuffers.get(filePath) || '';
    const newContent = pending + buffer.toString('utf8');
    pendingBuffers.delete(filePath);

    const parsed = parseLogEntries(newContent, { flushFinal: false });

    if (parsed.pending !== null) {
      pendingBuffers.set(filePath, parsed.pending);
    }

    if (pendingBuffers.has(filePath)) {
      if (pendingFlushTimers.has(filePath)) clearTimeout(pendingFlushTimers.get(filePath));
      pendingFlushTimers.set(filePath, setTimeout(() => {
        pendingFlushTimers.delete(filePath);
        const buffered = pendingBuffers.get(filePath);
        if (buffered) {
          pendingBuffers.delete(filePath);
          if (buffered.trim() && matchesFilter(buffered)) {
            emitError(filePath, buffered, changeDetectedAt);
          }
        }
      }, flushDelay));
    }

    for (const entry of parsed.entries) {
      if (entry.trim() && matchesFilter(entry)) {
        emitError(filePath, entry, changeDetectedAt);
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Fehler beim Lesen von ${filePath}:`, err.message);
    }
  }
}

function emitError(filePath, entry, changeDetectedAt) {
  const logTimestampRegex = /^\s*(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;
  const limited = limitStackTrace(entry.trim());
  let timestamp = new Date().toISOString();
  const tsMatch = entry.match(logTimestampRegex);
  if (tsMatch) {
    const [, dd, MM, yy, HH, mm, ss, ms] = tsMatch;
    const year = 2000 + parseInt(yy);
    timestamp = new Date(year, parseInt(MM) - 1, parseInt(dd), parseInt(HH), parseInt(mm), parseInt(ss), parseInt(ms)).toISOString();
  }
  const error = {
    timestamp,
    line: limited,
    file: path.basename(filePath)
  };

  if (!errorStore.has(filePath)) {
    errorStore.set(filePath, []);
  }
  const errors = errorStore.get(filePath);
  errors.push(error);

  while (errors.length > config.maxErrorsPerFile * 2) {
    errors.shift();
  }

  broadcastFiltered({
    type: 'error',
    data: { filePath, error, label: fileLabelMap.get(filePath) || getLabelForFile(filePath) || '' }
  }, (msg, visibleLabels) => {
    if (!visibleLabels) return msg;
    return visibleLabels.includes(msg.data.label) ? msg : null;
  });
  if (changeDetectedAt && config.debugLogging) {
    console.log(`  [TIMING] change-Event → broadcast: ${Date.now() - changeDetectedAt}ms | ${path.basename(filePath)}`);
  }

  bufferErrorForEmail(fileLabelMap.get(filePath) || getLabelForFile(filePath) || '', error);
}

// --- File Watcher ---

function getLabelForFile(filePath) {
  const normalized = path.resolve(filePath).toLowerCase();
  for (const wp of normalizedWatchPaths) {
    const wpNorm = path.resolve(wp.path).toLowerCase();
    const wpNormWithSep = wpNorm.endsWith(path.sep) ? wpNorm : wpNorm + path.sep;
    if (normalized === wpNorm || normalized.startsWith(wpNormWithSep)) {
      return wp.label;
    }
  }
  return '';
}

function isNetworkDriveSync(drivePath) {
  if (drivePath.startsWith('\\\\')) return true;
  return false;
}

function checkNetworkDriveAsync(drivePath) {
  return new Promise((resolve) => {
    if (drivePath.startsWith('\\\\')) return resolve(true);
    const resolved = path.resolve(drivePath);
    if (!/^[A-Z]:\\/i.test(resolved)) return resolve(false);
    const drive = resolved.substring(0, 2);
    const { execFile } = require('child_process');
    execFile('cmd', ['/c', `net use ${drive} 2>nul`], { encoding: 'utf8', timeout: 2000 }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(stdout.includes('OK') || stdout.includes('Microsoft Windows Network'));
    });
  });
}

// --- Globaler Preload-Koordinator ---

function preloadRegisterWatcher() {
  preload.watchersTotal++;
}

function preloadAddFile(filePath, label, flushDelay) {
  preload.queue.push({ filePath, label, flushDelay });
}

function preloadWatcherReady() {
  preload.watchersReady++;
  if (preload.readyTimer) clearTimeout(preload.readyTimer);
  if (preload.watchersReady >= preload.watchersTotal && !preload.running && preload.queue.length > 0) {
    preload.readyTimer = setTimeout(() => startPreloadProcessing(), 100);
  } else {
    preload.readyTimer = setTimeout(() => {
      if (!preload.running && preload.queue.length > 0) {
        startPreloadProcessing();
      }
    }, 5000);
  }
}

function startPreloadProcessing() {
  preload.running = true;
  // Große Dateien zuletzt einlesen: Defer-Queue ans Ende der Hauptqueue hängen
  if (preload.deferredQueue.length) {
    preload.queue.push(...preload.deferredQueue);
    preload.deferredQueue.length = 0;
  }
  const generation = preload.generation;
  const total = preload.queue.length;
  let current = 0;
  let totalErrorsFound = 0;
  preload.lastBroadcast = 0;

  const labelCounts = {};
  for (const item of preload.queue) {
    labelCounts[item.label] = (labelCounts[item.label] || 0) + 1;
  }
  const labelSummary = Object.entries(labelCounts).map(([l, c]) => `[${l}] ${c}`).join(', ');
  console.log(`\n📥 Bestehende Fehler einlesen: ${total} Dateien (${labelSummary})`);
  broadcast({ type: 'preload-start', data: { total, labels: labelCounts } });

  const labelErrors = {};

  function preloadNext() {
    if (generation !== preload.generation) {
      console.log(`📥 Einlesen abgebrochen (Watcher-Neustart)`);
      broadcast({ type: 'preload-done', data: { total: current, errorsFound: totalErrorsFound, labelErrors, aborted: true } });
      preload.running = false;
      return;
    }
    if (preload.queue.length === 0) {
      console.log(`📥 Einlesen abgeschlossen: ${totalErrorsFound} Fehler in ${total} Dateien`);
      for (const [label, count] of Object.entries(labelErrors)) {
        if (count > 0) console.log(`   [${label}] ${count} Fehler`);
      }
      broadcast({ type: 'preload-done', data: { total, errorsFound: totalErrorsFound, labelErrors } });
      preload.running = false;
      return;
    }
    const { filePath, label, flushDelay } = preload.queue.shift();
    const errorsBefore = (errorStore.get(filePath) || []).length;
    processNewLines(filePath, null, flushDelay);
    const errorsAfter = (errorStore.get(filePath) || []).length;
    const max = config.maxErrorsPerFile || 10;
    const errorsInFile = Math.min(errorsAfter - errorsBefore, max);
    totalErrorsFound += errorsInFile;
    labelErrors[label] = (labelErrors[label] || 0) + errorsInFile;
    current++;
    const percent = Math.round((current / total) * 100);
    const now = Date.now();
    if (now - preload.lastBroadcast >= 500 || percent === 100) {
      broadcast({ type: 'preload-progress', data: { label, current, total, percent, file: path.basename(filePath) } });
      preload.lastBroadcast = now;
    }
    setImmediate(preloadNext);
  }
  setImmediate(preloadNext);
}

function preloadReset() {
  preload.generation++;
  preload.queue.length = 0;
  preload.deferredQueue.length = 0;
  preload.watchersReady = 0;
  preload.watchersTotal = 0;
  preload.running = false;
  if (preload.readyTimer) clearTimeout(preload.readyTimer);
  preload.readyTimer = null;
}

function registerWatcherHandlers(watcher, wp, flushDelay, options) {
  const pendingChanges = new Map();
  if (!flushDelay) flushDelay = 500;
  const skipPreload = options && options.skipPreload;
  let initialScanDone = false;

  if (!skipPreload) preloadRegisterWatcher();

  watcher.on('add', (filePath) => {
    try {
      const stat = fs.statSync(filePath);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (stat.mtime < today) {
        filePositions.set(filePath, stat.size);
        return;
      }

      // Duplikat-Erkennung: gleiche Datei nicht doppelt registrieren
      if (fileLabelMap.has(filePath)) return;

      const label = getLabelForFile(filePath);
      fileLabelMap.set(filePath, label);
      console.log(`  Neue Datei erkannt: [${label}] ${path.basename(filePath)}`);

      const maxSizeBytes = Math.max(1, config.maxLogFileSizeMB || 6) * 1024 * 1024;
      const doLoad = !skipPreload && config.loadExistingErrors !== false;

      if (doLoad && stat.size > maxSizeBytes) {
        // Große Datei: nicht überspringen, sondern verzögert (zuletzt) einlesen
        const sizeMB = +(stat.size / 1024 / 1024).toFixed(1);
        oversizedFiles.set(filePath, sizeMB);
        filePositions.set(filePath, 0);
        if (!initialScanDone) {
          preload.deferredQueue.push({ filePath, label, flushDelay });
        }
        console.log(`  Große Datei (${sizeMB} MB > ${config.maxLogFileSizeMB || 6} MB), wird zuletzt eingelesen: ${path.basename(filePath)}`);
        broadcastOversized();
      } else if (doLoad) {
        // Normale Datei: ab Position 0 einlesen (Preload beim Initial-Scan, sonst beim nächsten change)
        filePositions.set(filePath, 0);
        if (!initialScanDone) {
          preloadAddFile(filePath, label, flushDelay);
        }
      } else {
        // loadExistingErrors=false oder skipPreload: nur ab jetzt überwachen
        filePositions.set(filePath, stat.size);
      }
    } catch { }
  });

  watcher.on('change', (filePath) => {
    const changeDetectedAt = Date.now();
    if (!fileLabelMap.has(filePath)) {
      const label = getLabelForFile(filePath);
      fileLabelMap.set(filePath, label);
      console.log(`  Datei aktiviert: [${label}] ${path.basename(filePath)}`);
    }
    if (pendingChanges.has(filePath)) clearTimeout(pendingChanges.get(filePath));
    pendingChanges.set(filePath, setTimeout(() => {
      pendingChanges.delete(filePath);
      if (config.debugLogging) {
        console.log(`  [TIMING] change-Event → processNewLines: ${Date.now() - changeDetectedAt}ms | ${path.basename(filePath)}`);
      }
      processNewLines(filePath, changeDetectedAt, flushDelay);
    }, 100));
  });

  watcher.on('unlink', (filePath) => {
    console.log(`  Datei entfernt: [${getLabelForFile(filePath)}] ${path.basename(filePath)}`);
    if (pendingFlushTimers.has(filePath)) {
      clearTimeout(pendingFlushTimers.get(filePath));
      pendingFlushTimers.delete(filePath);
    }
    if (pendingChanges.has(filePath)) {
      clearTimeout(pendingChanges.get(filePath));
      pendingChanges.delete(filePath);
    }
    filePositions.delete(filePath);
    pendingBuffers.delete(filePath);
    fileLabelMap.delete(filePath);
    if (oversizedFiles.delete(filePath)) broadcastOversized();
  });

  let errorCount = 0;
  watcher.on('error', (err) => {
    errorCount++;
    if (errorCount <= 3) {
      console.error(`Watcher Fehler [${wp.label}]:`, err.message);
    }
    if (errorCount === 3) {
      console.error(`  → Weitere Fehler für [${wp.label}] werden unterdrückt.`);
      if (!wp.usePolling) {
        console.error(`  → Tipp: Polling aktivieren für Netzlaufwerke (Einstellungen → WatchPaths → Polling ✓)`);
      }
    }
  });

  watcher.on('ready', () => {
    initialScanDone = true;
    if (!skipPreload) preloadWatcherReady();
  });
}

function startWatching() {
  console.log('Überwache Log-Verzeichnisse:');
  const watchers = [];

  for (const wp of normalizedWatchPaths) {
    const resolved = path.resolve(wp.path);
    const isObviousNetwork = resolved.startsWith('\\\\');

    const usePolling = wp.usePolling !== false;
    const initialPolling = usePolling || isObviousNetwork;

    if (!usePolling && wp.usePolling === false) {
      console.log(`  → [${wp.label}] ${wp.path} (native Events — usePolling: false in Config)`);
    } else if (isObviousNetwork) {
      console.log(`  → [${wp.label}] ${wp.path} (Polling: 5s, Netzlaufwerk)`);
    } else {
      console.log(`  → [${wp.label}] ${wp.path} (Polling: 2s)`);
    }

    const globPattern = path.join(wp.path, config.filePattern);
    const pollInterval = (isObviousNetwork || wp._isNetworkDrive) ? 5000 : 2000;
    const flushDelay = initialPolling ? pollInterval + 200 : 500;

    const watcher = chokidar.watch(globPattern, {
      persistent: true,
      ignoreInitial: false,
      usePolling: initialPolling,
      ...(initialPolling ? { interval: pollInterval } : {})
    });

    const skipPreload = config.loadExistingErrors === false;
    registerWatcherHandlers(watcher, wp, flushDelay, skipPreload ? { skipPreload: true } : undefined);

    if (!initialPolling && /^[A-Z]:\\/i.test(resolved)) {
      checkNetworkDriveAsync(wp.path).then(isNetwork => {
        if (isNetwork) {
          console.log(`  → [${wp.label}] Netzlaufwerk erkannt, wechsle auf Polling...`);
          const pollingWatcher = chokidar.watch(globPattern, {
            persistent: true,
            ignoreInitial: false,
            usePolling: true,
            interval: 5000
          });
          registerWatcherHandlers(pollingWatcher, wp, 5200, { skipPreload: true });
          pollingWatcher.on('ready', () => {
            watcher.close();
          });
          const idx = watchers.indexOf(watcher);
          if (idx !== -1) watchers[idx] = pollingWatcher;
          wp._isNetworkDrive = true;
        }
      });
    }

    watchers.push(watcher);
  }

  console.log(`Filter: ${config.filterPatterns.join(', ')}`);
  console.log('');
  return watchers;
}

function getAllErrors() {
  const result = {};
  for (const [filePath, errors] of errorStore) {
    result[filePath] = {
      errors: errors.slice(-config.maxErrorsPerFile),
      label: fileLabelMap.get(filePath) || getLabelForFile(filePath) || ''
    };
  }
  return result;
}

function getOversizedFiles() {
  const result = {};
  for (const [filePath, sizeMB] of oversizedFiles) {
    result[filePath] = { sizeMB, label: fileLabelMap.get(filePath) || getLabelForFile(filePath) || '' };
  }
  return result;
}

function broadcastOversized() {
  broadcastFiltered(
    { type: 'oversized-files', data: getOversizedFiles() },
    (msg, visibleLabels) => {
      if (!visibleLabels) return msg; // null = alle sichtbar
      const data = {};
      for (const [fp, info] of Object.entries(msg.data)) {
        if (visibleLabels.includes(info.label)) data[fp] = info;
      }
      return { type: 'oversized-files', data };
    }
  );
}

// Markierung großer Dateien gegen den aktuellen Schwellwert neu bewerten
// (z. B. nach Config-Änderung von maxLogFileSizeMB — ohne Watcher-Neustart).
// Liest bereits importierte Dateien NICHT neu ein, aktualisiert nur Markierung/Tooltip.
function reevaluateOversized() {
  const maxSizeBytes = Math.max(1, config.maxLogFileSizeMB || 6) * 1024 * 1024;
  let changed = false;
  for (const filePath of fileLabelMap.keys()) {
    let size;
    try {
      size = fs.statSync(filePath).size;
    } catch {
      // Datei nicht mehr lesbar → aus oversized entfernen falls vorhanden
      if (oversizedFiles.delete(filePath)) changed = true;
      continue;
    }
    if (size > maxSizeBytes) {
      const sizeMB = +(size / 1024 / 1024).toFixed(1);
      if (oversizedFiles.get(filePath) !== sizeMB) {
        oversizedFiles.set(filePath, sizeMB);
        changed = true;
      }
    } else if (oversizedFiles.delete(filePath)) {
      changed = true;
    }
  }
  if (changed) broadcastOversized();
}

module.exports = { startWatching, getLabelForFile, getAllErrors, getOversizedFiles, reevaluateOversized, preloadReset };
