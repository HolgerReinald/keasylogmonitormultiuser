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
  return filterRegex.test(text) || matchesThresholdRule(text) !== null;
}

function rebuildFilterRegex(patterns) {
  filterRegex = new RegExp(
    patterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'i'
  );
}

function rebuildThresholdRules(rules) {
  thresholdRules = rules || [];
}

// Regex: Neuer Log-Eintrag beginnt mit Timestamp (DD.MM.YY HH:MM:SS.mmm)
const timestampRegex = /^\s*\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}/;

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

module.exports = { matchesFilter, matchesThresholdRule, rebuildFilterRegex, rebuildThresholdRules, timestampRegex, limitStackTrace, parseLogEntries };
