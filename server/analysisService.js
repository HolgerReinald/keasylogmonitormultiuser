/**
 * Keasy Log Monitor — Analysis Service
 * Log-Analyse: Streaming-Einlesen, Datei-Sammlung, Ergebnis-Verwaltung.
 * Analyse ist per-user isoliert (eigener Store, runId, Broadcasts).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { getOrCreateAnalyzeUser } = require('./runtimeStore');
const { broadcastToUser } = require('./wsBroadcast');
const { matchesFilter, limitStackTrace, parseLogEntries } = require('./logParser');

function getAnalyzeErrors(username) {
  if (!username) return {};
  const au = getOrCreateAnalyzeUser(username);
  const result = {};
  for (const [filePath, errors] of au.store) {
    result[filePath] = { label: au.labelMap.get(filePath) || '', errors };
  }
  return result;
}

async function analyzeFile(filePath, label, maxErrorsPerFile, username, runId) {
  const au = getOrCreateAnalyzeUser(username);
  return new Promise((resolve) => {
    const logTimestampRegex = /^\s*(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;
    let errorCount = 0;
    let chunks = '';

    function isStale() {
      return au.aborted || au.runId !== runId;
    }

    function emitAnalyzeErrors(entries) {
      for (const entry of entries) {
        if (isStale() || errorCount >= maxErrorsPerFile) return true;
        if (!entry.trim() || !matchesFilter(entry)) continue;
        const limited = limitStackTrace(entry.trim());
        let timestamp = new Date().toISOString();
        const tsMatch = entry.match(logTimestampRegex);
        if (tsMatch) {
          const [, dd, MM, yy, HH, mm, ss, ms] = tsMatch;
          const year = 2000 + parseInt(yy);
          timestamp = new Date(year, parseInt(MM) - 1, parseInt(dd), parseInt(HH), parseInt(mm), parseInt(ss), parseInt(ms)).toISOString();
        }
        const error = { timestamp, line: limited, file: path.basename(filePath) };
        if (!au.store.has(filePath)) au.store.set(filePath, []);
        au.store.get(filePath).push(error);
        au.labelMap.set(filePath, label);
        errorCount++;
        broadcastToUser(username, { type: 'analyze-error', data: { filePath, error, label } });
      }
      return isStale() || errorCount >= maxErrorsPerFile;
    }

    try {
      if (!fs.existsSync(filePath)) { resolve(0); return; }
      const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      stream.on('error', (err) => {
        console.error(`Analyse Stream-Fehler: ${filePath}: ${err.message}`);
        rl.close();
        resolve(errorCount);
      });

      rl.on('line', (line) => {
        if (isStale() || errorCount >= maxErrorsPerFile) {
          rl.close();
          stream.destroy();
          return;
        }
        chunks += (chunks ? '\n' : '') + line;
        if (chunks.split('\n').length >= 200) {
          const { entries, pending } = parseLogEntries(chunks, { flushFinal: false });
          chunks = pending || '';
          if (emitAnalyzeErrors(entries)) { rl.close(); stream.destroy(); }
        }
      });

      rl.on('close', () => {
        if (chunks && !isStale()) {
          const { entries } = parseLogEntries(chunks, { flushFinal: true });
          emitAnalyzeErrors(entries);
        }
        resolve(errorCount);
      });

      rl.on('error', (err) => {
        console.error(`Analyse-Fehler: ${filePath}: ${err.message}`);
        resolve(errorCount);
      });
    } catch (err) {
      console.error(`Analyse-Fehler: ${filePath}: ${err.message}`);
      resolve(0);
    }
  });
}

async function collectLogFiles(inputPaths) {
  const seen = new Set();
  const logFiles = [];
  const skippedPaths = [];
  for (const p of inputPaths) {
    try {
      const resolved = path.resolve(p);
      const stat = fs.statSync(resolved);
      if (stat.isFile() && resolved.toLowerCase().endsWith('.log')) {
        const norm = resolved.toLowerCase();
        if (!seen.has(norm)) { seen.add(norm); logFiles.push(resolved); }
      } else if (stat.isDirectory()) {
        collectLogsRecursive(resolved, logFiles, seen);
      } else {
        skippedPaths.push({ path: p, reason: 'Keine .log-Datei' });
      }
    } catch (err) {
      skippedPaths.push({ path: p, reason: err.code === 'ENOENT' ? 'Pfad nicht gefunden' : err.message });
    }
  }
  return { logFiles, skippedPaths };
}

function collectLogsRecursive(dir, result, seen) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectLogsRecursive(fullPath, result, seen);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.log')) {
        const norm = fullPath.toLowerCase();
        if (!seen.has(norm)) { seen.add(norm); result.push(fullPath); }
      }
    }
  } catch (err) {
    // Zugriffsfehler überspringen
  }
}

async function runAnalysis(inputPaths, maxErrorsPerFile = 100, username = '') {
  const au = getOrCreateAnalyzeUser(username);

  // Neuen Lauf starten: Store leeren, runId inkrementieren
  au.store.clear();
  au.labelMap.clear();
  au.aborted = false;
  au.running = true;
  au.runId++;
  const currentRunId = au.runId;

  try {
    const { logFiles, skippedPaths } = await collectLogFiles(inputPaths);
    broadcastToUser(username, { type: 'analyze-start', data: { total: logFiles.length, skippedPaths, username } });
    console.log(`\n📂 Log-Analyse gestartet von ${username || '?'}: ${logFiles.length} Dateien`);
    if (skippedPaths.length > 0) {
      for (const s of skippedPaths) console.log(`  ⚠️ Übersprungen: ${s.path} (${s.reason})`);
    }

    let totalErrors = 0;
    for (let i = 0; i < logFiles.length; i++) {
      if (au.aborted || au.runId !== currentRunId) {
        console.log(`📂 Log-Analyse abgebrochen (${username}).`);
        broadcastToUser(username, { type: 'analyze-done', data: { total: logFiles.length, processed: i, errors: totalErrors, aborted: true, username } });
        return;
      }

      const filePath = logFiles[i];
      const label = '📂 ' + path.basename(path.dirname(filePath));
      const errCount = await analyzeFile(filePath, label, maxErrorsPerFile, username, currentRunId);
      totalErrors += errCount;

      if (au.runId === currentRunId) {
        broadcastToUser(username, {
          type: 'analyze-progress',
          data: { current: i + 1, total: logFiles.length, file: path.basename(filePath), errors: totalErrors }
        });
      }
      console.log(`  📂 ${i + 1}/${logFiles.length}: ${path.basename(filePath)} (${errCount} Fehler)`);

      await new Promise(r => setImmediate(r));
    }

    console.log(`📂 Log-Analyse abgeschlossen (${username}): ${totalErrors} Fehler in ${logFiles.length} Dateien`);
    if (au.runId === currentRunId) {
      broadcastToUser(username, { type: 'analyze-done', data: { total: logFiles.length, processed: logFiles.length, errors: totalErrors, aborted: false, username } });
    }
  } finally {
    // Garantiert: running=false nur wenn dies noch der aktuelle Lauf ist
    if (au.runId === currentRunId) {
      au.running = false;
      au.aborted = false;
    }
  }
}

module.exports = { runAnalysis, collectLogFiles, getAnalyzeErrors };
