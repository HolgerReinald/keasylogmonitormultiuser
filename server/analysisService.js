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
const { matchesFilter, classifySeverity, limitStackTrace, parseLogEntries, parseJsonLogEntries, evaluateJsonEntry, parseEntryTimestamp, evaluateGap } = require('./logParser');

function getAnalyzeErrors(username) {
  if (!username) return {};
  const au = getOrCreateAnalyzeUser(username);
  const result = {};
  for (const [filePath, errors] of au.store) {
    result[filePath] = { label: au.labelMap.get(filePath) || '', errors };
  }
  return result;
}

async function analyzeFile(filePath, label, maxErrorsPerFile, username, runId, gapOpts) {
  const au = getOrCreateAnalyzeUser(username);
  return new Promise((resolve) => {
    let errorCount = 0;
    let chunks = '';
    // Gap-Erkennung: letzter Eintrags-Timestamp und eigener Zähler pro Datei
    // (Lücken zählen nicht in errorCount, damit sie keine Fehler verdrängen)
    const gapWarnSeconds = gapOpts && Number(gapOpts.gapWarnSeconds) || 0;
    const gapIdleMinutes = gapOpts && Number(gapOpts.gapIdleMinutes) || 30;
    let lastTs = null;
    let gapCount = 0;

    function isStale() {
      return au.aborted || au.runId !== runId;
    }

    function trackGapAt(ts, firstLine) {
      if (!ts) return;
      const prev = lastTs;
      lastTs = ts;
      if (!prev || gapWarnSeconds <= 0 || gapCount >= maxErrorsPerFile) return;
      const gapSeconds = evaluateGap(prev, ts, gapWarnSeconds, gapIdleMinutes);
      if (gapSeconds === null) return;
      const gapEntry = {
        timestamp: ts.toISOString(),
        prevTimestamp: prev.toISOString(),
        gapSeconds,
        line: firstLine,
        file: path.basename(filePath)
      };
      if (!au.store.has(filePath)) au.store.set(filePath, []);
      au.store.get(filePath).push(gapEntry);
      au.labelMap.set(filePath, label);
      gapCount++;
      broadcastToUser(username, { type: 'analyze-error', data: { filePath, error: gapEntry, label } });
    }

    function trackGap(entry) {
      trackGapAt(parseEntryTimestamp(entry), entry.trim().split('\n')[0]);
    }

    function emitAnalyzeErrors(entries) {
      for (const entry of entries) {
        if (isStale() || errorCount >= maxErrorsPerFile) return true;
        if (!entry.trim()) continue;
        trackGap(entry);
        if (!matchesFilter(entry)) continue;
        const limited = limitStackTrace(entry.trim());
        const parsedTs = parseEntryTimestamp(entry);
        const timestamp = (parsedTs || new Date()).toISOString();
        const error = { timestamp, line: limited, file: path.basename(filePath), level: classifySeverity(limited) };
        if (!au.store.has(filePath)) au.store.set(filePath, []);
        au.store.get(filePath).push(error);
        au.labelMap.set(filePath, label);
        errorCount++;
        broadcastToUser(username, { type: 'analyze-error', data: { filePath, error, label } });
      }
      return isStale() || errorCount >= maxErrorsPerFile;
    }

    // JSON-Logs (KI-Schnittstelle) werden strukturell ausgewertet, nicht über den
    // Textfilter — genauso wie im Watcher. Der generische Filter würde in
    // Prompt-/Antworttexten dauernd anschlagen ("fehler":null usw.), deshalb
    // entscheidet evaluateJsonEntry anhand von Error-Objekt bzw. Success:false.
    function emitJsonErrors(entries) {
      for (const block of entries) {
        if (isStale() || errorCount >= maxErrorsPerFile) return true;
        if (!block.trim()) continue;
        const { report, line, timestamp } = evaluateJsonEntry(block);
        // Für die Lückenerkennung ist der Timestamp aus dem JSON-Feld die
        // genauere Quelle als eine Textsuche über den Block.
        trackGapAt(timestamp, (line || '').split('\n')[0]);
        if (!report) continue;
        const limited = limitStackTrace((line || block).trim());
        const error = {
          timestamp: (timestamp || new Date()).toISOString(),
          line: limited,
          file: path.basename(filePath),
          level: classifySeverity(limited)
        };
        if (!au.store.has(filePath)) au.store.set(filePath, []);
        au.store.get(filePath).push(error);
        au.labelMap.set(filePath, label);
        errorCount++;
        broadcastToUser(username, { type: 'analyze-error', data: { filePath, error, label } });
      }
      return isStale() || errorCount >= maxErrorsPerFile;
    }

    // Ein Umschalter statt zweier Codepfade durch die Stream-Behandlung
    const isJson = path.extname(filePath).toLowerCase() === '.json';
    const parseChunk = (text, opts) => isJson ? parseJsonLogEntries(text, opts) : parseLogEntries(text, opts);
    const emitEntries = (entries) => isJson ? emitJsonErrors(entries) : emitAnalyzeErrors(entries);

    try {
      if (!fs.existsSync(filePath)) { resolve({ errors: 0, gaps: 0 }); return; }
      const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      stream.on('error', (err) => {
        console.error(`Analyse Stream-Fehler: ${filePath}: ${err.message}`);
        rl.close();
        resolve({ errors: errorCount, gaps: gapCount });
      });

      rl.on('line', (line) => {
        if (isStale() || errorCount >= maxErrorsPerFile) {
          rl.close();
          stream.destroy();
          return;
        }
        chunks += (chunks ? '\n' : '') + line;
        if (chunks.split('\n').length >= 200) {
          const { entries, pending } = parseChunk(chunks, { flushFinal: false });
          chunks = pending || '';
          if (emitEntries(entries)) { rl.close(); stream.destroy(); }
        }
      });

      rl.on('close', () => {
        if (chunks && !isStale()) {
          const { entries } = parseChunk(chunks, { flushFinal: true });
          emitEntries(entries);
        }
        resolve({ errors: errorCount, gaps: gapCount });
      });

      rl.on('error', (err) => {
        console.error(`Analyse-Fehler: ${filePath}: ${err.message}`);
        resolve({ errors: errorCount, gaps: gapCount });
      });
    } catch (err) {
      console.error(`Analyse-Fehler: ${filePath}: ${err.message}`);
      resolve({ errors: 0, gaps: 0 });
    }
  });
}

// Welche Dateien gelten als Log? .json nur dort, wo es ausdrücklich erlaubt ist —
// bei einem konfigurierten Ordner würde sonst jede package.json, tsconfig.json
// oder Einstellungsdatei im Baum als Log ausgewertet. Erlaubt ist es deshalb nur
// für abgelegte Dateien: die hat der Anwender einzeln ausgewählt.
function isLogFile(name, allowJson) {
  const n = name.toLowerCase();
  return n.endsWith('.log') || (allowJson && n.endsWith('.json'));
}

// inputPaths: Strings (wie bisher) oder { path, includeJson } — gemischt erlaubt.
async function collectLogFiles(inputPaths) {
  const seen = new Set();
  const logFiles = [];
  const skippedPaths = [];
  for (const item of inputPaths) {
    const p = typeof item === 'string' ? item : (item && item.path);
    const allowJson = typeof item === 'string' ? false : !!(item && item.includeJson);
    if (!p) continue;
    try {
      const resolved = path.resolve(p);
      const stat = fs.statSync(resolved);
      if (stat.isFile() && isLogFile(resolved, allowJson)) {
        const norm = resolved.toLowerCase();
        if (!seen.has(norm)) { seen.add(norm); logFiles.push(resolved); }
      } else if (stat.isDirectory()) {
        collectLogsRecursive(resolved, logFiles, seen, allowJson);
      } else {
        skippedPaths.push({ path: p, reason: allowJson ? 'Keine .log/.json-Datei' : 'Keine .log-Datei' });
      }
    } catch (err) {
      skippedPaths.push({ path: p, reason: err.code === 'ENOENT' ? 'Pfad nicht gefunden' : err.message });
    }
  }
  return { logFiles, skippedPaths };
}

function collectLogsRecursive(dir, result, seen, allowJson) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectLogsRecursive(fullPath, result, seen, allowJson);
      } else if (entry.isFile() && isLogFile(entry.name, allowJson)) {
        const norm = fullPath.toLowerCase();
        if (!seen.has(norm)) { seen.add(norm); result.push(fullPath); }
      }
    }
  } catch (err) {
    // Zugriffsfehler überspringen
  }
}

async function runAnalysis(inputPaths, maxErrorsPerFile = 100, username = '', gapOpts = null) {
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
    let totalGaps = 0;
    for (let i = 0; i < logFiles.length; i++) {
      if (au.aborted || au.runId !== currentRunId) {
        console.log(`📂 Log-Analyse abgebrochen (${username}).`);
        broadcastToUser(username, { type: 'analyze-done', data: { total: logFiles.length, processed: i, errors: totalErrors, gaps: totalGaps, aborted: true, username } });
        return;
      }

      const filePath = logFiles[i];
      const label = '📂 ' + path.basename(path.dirname(filePath));
      const result = await analyzeFile(filePath, label, maxErrorsPerFile, username, currentRunId, gapOpts);
      totalErrors += result.errors;
      totalGaps += result.gaps;

      if (au.runId === currentRunId) {
        broadcastToUser(username, {
          type: 'analyze-progress',
          data: { current: i + 1, total: logFiles.length, file: path.basename(filePath), errors: totalErrors, gaps: totalGaps }
        });
      }
      console.log(`  📂 ${i + 1}/${logFiles.length}: ${path.basename(filePath)} (${result.errors} Fehler${result.gaps ? `, ${result.gaps} ⏱️ Gaps` : ''})`);

      await new Promise(r => setImmediate(r));
    }

    console.log(`📂 Log-Analyse abgeschlossen (${username}): ${totalErrors} Fehler${totalGaps ? `, ${totalGaps} ⏱️ Gaps` : ''} in ${logFiles.length} Dateien`);
    if (au.runId === currentRunId) {
      broadcastToUser(username, { type: 'analyze-done', data: { total: logFiles.length, processed: logFiles.length, errors: totalErrors, gaps: totalGaps, aborted: false, username } });
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
