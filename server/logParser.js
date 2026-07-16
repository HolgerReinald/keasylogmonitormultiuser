/**
 * Keasy Log Monitor — Log Parser
 * Filter-Regex, Timestamp-Parsing und Log-Entry-Splitting.
 */

const { config } = require('./configStore');

// Filter-Regex aus Config initialisieren
let filterRegex = new RegExp(
  config.filterPatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i'
);

// Ausschluss-Regex aus Config initialisieren (leere Liste ⇒ null, sonst würde RegExp('') alles matchen)
function buildExcludeRegex(patterns) {
  const list = (patterns || []).filter(p => p && p.trim());
  if (list.length === 0) return null;
  return new RegExp(list.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
}
let excludeRegex = buildExcludeRegex(config.excludePatterns);

// Schwellwert-Regeln aus Config
let thresholdRules = config.thresholdRules || [];

function extractNumber(line, contains, before) {
  const idx = line.toLowerCase().indexOf(contains.toLowerCase());
  if (idx === -1) return null;
  let rest = line.substring(idx + contains.length);
  if (before) {
    const endIdx = rest.indexOf(before);
    if (endIdx === -1) return null;
    rest = rest.substring(0, endIdx);
  }
  const match = rest.match(/([\d.,]+)/);
  if (!match) return null;
  return parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
}

function matchesThresholdRule(text) {
  const textLower = text.toLowerCase();
  for (const rule of thresholdRules) {
    if (!textLower.includes(rule.contains.toLowerCase())) continue;
    const num = extractNumber(text, rule.contains, rule.before);
    if (num === null) continue;
    switch (rule.operator) {
      case '>':  if (num > rule.value)  return rule; break;
      case '<':  if (num < rule.value)  return rule; break;
      case '>=': if (num >= rule.value) return rule; break;
      case '<=': if (num <= rule.value) return rule; break;
      case '=':  if (Math.abs(num - rule.value) < 0.01) return rule; break;
    }
  }
  return null;
}

function matchesFilter(text) {
  if (excludeRegex && excludeRegex.test(text)) return false;
  return filterRegex.test(text) || matchesThresholdRule(text) !== null;
}

function rebuildFilterRegex(patterns) {
  filterRegex = new RegExp(
    patterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'i'
  );
}

function rebuildExcludeRegex(patterns) {
  excludeRegex = buildExcludeRegex(patterns);
}

function rebuildThresholdRules(rules) {
  thresholdRules = rules || [];
}

// Regex: Neuer Log-Eintrag beginnt mit Timestamp (DD.MM.YY HH:MM:SS.mmm)
const timestampRegex = /^\s*\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}/;

// Capturing-Variante für die Timestamp-Extraktion
const timestampCaptureRegex = /^\s*(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;

// Timestamp eines Log-Eintrags als Date — null, wenn keiner vorhanden (bewusst KEIN Wall-Clock-Fallback,
// damit die Gap-Erkennung Einträge ohne Timestamp überspringen kann)
function parseEntryTimestamp(entry) {
  const m = entry.match(timestampCaptureRegex);
  if (!m) return null;
  const [, dd, MM, yy, HH, mm, ss, ms] = m;
  return new Date(2000 + parseInt(yy), parseInt(MM) - 1, parseInt(dd), parseInt(HH), parseInt(mm), parseInt(ss), parseInt(ms));
}

// Lücke zwischen zwei Einträgen bewerten: Sekunden zurückgeben, wenn sie die Warn-Schwelle erreicht
// und unter der Idle-Grenze liegt (längere Lücken = Leerlauf/Nacht, kein Performance-Problem)
function evaluateGap(prevDate, curDate, warnSeconds, idleMinutes) {
  if (!prevDate || !curDate || !warnSeconds || warnSeconds <= 0) return null;
  const gapSeconds = (curDate.getTime() - prevDate.getTime()) / 1000;
  if (gapSeconds < warnSeconds) return null;
  const idle = (idleMinutes && idleMinutes > 0 ? idleMinutes : 30) * 60;
  if (gapSeconds >= idle) return null;
  return Math.round(gapSeconds * 10) / 10;
}

function limitStackTrace(text, maxLines = 5) {
  const lines = text.split('\n');
  const result = [];
  let stackCount = 0;
  let truncated = false;

  for (const line of lines) {
    if (/^\s+at\s/.test(line)) {
      stackCount++;
      if (stackCount <= maxLines) {
        result.push(line);
      } else {
        truncated = true;
      }
    } else {
      if (truncated) {
        result.push('    ... (weitere Stack-Trace-Zeilen ausgeblendet)');
        truncated = false;
      }
      result.push(line);
    }
  }
  if (truncated) {
    result.push('    ... (weitere Stack-Trace-Zeilen ausgeblendet)');
  }
  return result.join('\n');
}

function parseLogEntries(text, opts = {}) {
  const flushFinal = opts.flushFinal !== undefined ? opts.flushFinal : false;
  const lines = text.split(/\r?\n/);
  const entries = [];
  let currentEntry = null;

  for (const line of lines) {
    if (timestampRegex.test(line)) {
      if (currentEntry !== null) {
        entries.push(currentEntry);
      }
      currentEntry = line;
    } else {
      if (currentEntry !== null) {
        currentEntry += '\n' + line;
      } else {
        currentEntry = line;
      }
    }
  }

  let pending = null;
  if (currentEntry !== null) {
    if (flushFinal) {
      entries.push(currentEntry);
    } else {
      pending = currentEntry;
    }
  }

  return { entries, pending };
}

module.exports = { matchesFilter, matchesThresholdRule, rebuildFilterRegex, rebuildExcludeRegex, rebuildThresholdRules, timestampRegex, limitStackTrace, parseLogEntries, parseEntryTimestamp, evaluateGap };
