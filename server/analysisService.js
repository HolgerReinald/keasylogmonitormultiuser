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
    // truncated nur setzen, wenn vorhanden — sonst traegt jeder Eintrag im
    // init-Snapshot ein leeres Feld mit sich.
    const t = au.truncated.get(filePath);
    result[filePath] = { label: au.labelMap.get(filePath) || '', errors, ...(t ? { truncated: t } : {}) };
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

    // Das Limit hat das Lesen beendet: einmal pro Datei vermerken und melden.
    // lastTs ist der Zeitstempel des letzten gelesenen Eintrags — genau die
    // Stelle, bis zu der die Datei geprueft wurde. Er wird fuer die
    // Gap-Erkennung ohnehin mitgefuehrt.
    let truncatedReported = false;
    function markTruncated() {
      if (truncatedReported || isStale()) return;
      truncatedReported = true;
      const info = { limit: maxErrorsPerFile, lastTimestamp: lastTs ? lastTs.toISOString() : null };
      au.truncated.set(filePath, info);
      broadcastToUser(username, { type: 'analyze-truncated', data: { filePath, label, ...info } });
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
        if (isStale()) return true;
        if (errorCount >= maxErrorsPerFile) { markTruncated(); return true; }
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
      if (isStale()) return true;
      if (errorCount >= maxErrorsPerFile) { markTruncated(); return true; }
      return false;
    }

    // JSON-Logs (KI-Schnittstelle) werden strukturell ausgewertet, nicht über den
    // Textfilter — genauso wie im Watcher. Der generische Filter würde in
    // Prompt-/Antworttexten dauernd anschlagen ("fehler":null usw.), deshalb
    // entscheidet evaluateJsonEntry anhand von Error-Objekt bzw. Success:false.
    function emitJsonErrors(entries) {
      for (const block of entries) {
        if (isStale()) return true;
        if (errorCount >= maxErrorsPerFile) { markTruncated(); return true; }
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
      if (isStale()) return true;
      if (errorCount >= maxErrorsPerFile) { markTruncated(); return true; }
      return false;
    }

    // Ein Umschalter statt zweier Codepfade durch die Stream-Behandlung
    const isJson = path.extname(filePath).toLowerCase() === '.json';
    const parseChunk = (text, opts) => isJson ? parseJsonLogEntries(text, opts) : parseLogEntries(text, opts);
    const emitEntries = (entries) => isJson ? emitJsonErrors(entries) : emitAnalyzeErrors(entries);

    try {
      if (!fs.existsSync(filePath)) { resolve({ errors: 0, gaps: 0, truncated: false }); return; }
      const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      stream.on('error', (err) => {
        console.error(`Analyse Stream-Fehler: ${filePath}: ${err.message}`);
        rl.close();
        resolve({ errors: errorCount, gaps: gapCount, truncated: truncatedReported });
      });

      rl.on('line', (line) => {
        if (isStale() || errorCount >= maxErrorsPerFile) {
          if (!isStale() && errorCount >= maxErrorsPerFile) markTruncated();
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
        resolve({ errors: errorCount, gaps: gapCount, truncated: truncatedReported });
      });

      rl.on('error', (err) => {
        console.error(`Analyse-Fehler: ${filePath}: ${err.message}`);
        resolve({ errors: errorCount, gaps: gapCount, truncated: truncatedReported });
      });
    } catch (err) {
      console.error(`Analyse-Fehler: ${filePath}: ${err.message}`);
      resolve({ errors: 0, gaps: 0, truncated: false });
    }
  });
}

// Was gilt als Log? `.log` und `.json` — Letzteres, weil Schnittstellen reine
// JSON-Logs schreiben und ein Ordner voll davon sonst als „keine Log-Dateien"
// gemeldet würde.
//
// Die frühere Einschränkung („.json nur für abgelegte Dateien") sollte
// verhindern, dass in einem Projektordner jede package.json als Log gilt. Das
// Argument war schwächer als gedacht: JSON wird **strukturell** bewertet
// (evaluateJsonEntry), eine package.json hat kein Error-Objekt, kein
// `success: false` und keinen `code >= 400` — sie erzeugt also gar keine
// Meldung. Der einzige echte Preis war Lesezeit, und die wird nur in
// node_modules teuer. Genau das wird jetzt gezielt übersprungen.
function isLogFile(name) {
  const n = name.toLowerCase();
  return n.endsWith('.log') || n.endsWith('.json');
}

// Verzeichnisse, die nie Logs enthalten, aber tausende JSON-Dateien.
const SKIP_DIRS = new Set(['node_modules', '.git']);

// inputPaths: Strings oder { path } — gemischt erlaubt.
async function collectLogFiles(inputPaths) {
  const seen = new Set();
  const logFiles = [];
  const skippedPaths = [];
  for (const item of inputPaths) {
    const p = typeof item === 'string' ? item : (item && item.path);
    if (!p) continue;
    try {
      const resolved = path.resolve(p);
      const stat = fs.statSync(resolved);
      if (stat.isFile() && isLogFile(resolved)) {
        const norm = resolved.toLowerCase();
        if (!seen.has(norm)) { seen.add(norm); logFiles.push(resolved); }
      } else if (stat.isDirectory()) {
        collectLogsRecursive(resolved, logFiles, seen);
      } else {
        skippedPaths.push({ path: p, reason: 'Keine .log/.json-Datei' });
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
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
        collectLogsRecursive(fullPath, result, seen);
      } else if (entry.isFile() && isLogFile(entry.name)) {
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
  au.truncated.clear();
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
    let truncatedFiles = 0;
    for (let i = 0; i < logFiles.length; i++) {
      if (au.aborted || au.runId !== currentRunId) {
        console.log(`📂 Log-Analyse abgebrochen (${username}).`);
        broadcastToUser(username, { type: 'analyze-done', data: { total: logFiles.length, processed: i, errors: totalErrors, gaps: totalGaps, truncatedFiles, aborted: true, username } });
        return;
      }

      const filePath = logFiles[i];
      const label = '📂 ' + path.basename(path.dirname(filePath));
      const result = await analyzeFile(filePath, label, maxErrorsPerFile, username, currentRunId, gapOpts);
      totalErrors += result.errors;
      totalGaps += result.gaps;
      if (result.truncated) truncatedFiles++;

      if (au.runId === currentRunId) {
        broadcastToUser(username, {
          type: 'analyze-progress',
          data: { current: i + 1, total: logFiles.length, file: path.basename(filePath), errors: totalErrors, gaps: totalGaps, truncatedFiles }
        });
      }
      console.log(`  📂 ${i + 1}/${logFiles.length}: ${path.basename(filePath)} (${result.errors} Fehler${result.gaps ? `, ${result.gaps} ⏱️ Gaps` : ''}${result.truncated ? ` — ⚠️ Limit ${maxErrorsPerFile} erreicht, Datei nur teilweise gelesen` : ''})`);

      await new Promise(r => setImmediate(r));
    }

    console.log(`📂 Log-Analyse abgeschlossen (${username}): ${totalErrors} Fehler${totalGaps ? `, ${totalGaps} ⏱️ Gaps` : ''} in ${logFiles.length} Dateien`);
    if (truncatedFiles > 0) {
      console.log(`   ⚠️ ${truncatedFiles} Datei(en) unvollständig gelesen — Limit ${maxErrorsPerFile} erreicht.`);
    }
    if (au.runId === currentRunId) {
      broadcastToUser(username, { type: 'analyze-done', data: { total: logFiles.length, processed: logFiles.length, errors: totalErrors, gaps: totalGaps, truncatedFiles, limit: maxErrorsPerFile, aborted: false, username } });
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
