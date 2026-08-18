// Kopfloser Test des Fehler-Index gegen echte Logdateien.
// Prueft zwei Dinge, die eine statische Verdrahtungspruefung nicht kann:
//   1. laeuft errorIndexPanel.js ueberhaupt durch (Laufzeitfehler)?
//   2. sind die Beschriftungen aus echten Keasy-Eintraegen lesbar?
// Ausgabe nur auf der Konsole — nichts verlaesst den Rechner.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

// --- minimales DOM ---
const el = () => ({
  innerHTML: '', textContent: '', scrollTop: 0, clientHeight: 400, dataset: {},
  setAttribute() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  querySelectorAll: () => [], querySelector: () => null
});
const nodes = {};
global.document = {
  getElementById: id => (nodes[id] = nodes[id] || el()),
  querySelector: () => null,
  querySelectorAll: () => []
};
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); }
};
global.window = global;

// --- App-Module laden ---
for (const f of ['public/js/utils.js', 'public/js/state.js', 'public/js/errorIndexPanel.js']) {
  new Function(fs.readFileSync(path.join(root, f), 'utf8'))();
}

// --- echte Logdateien einlesen ---
// config.js ist nicht versioniert — auf einer frischen Kopie fehlt sie. Dann
// entfaellt nur die Stichprobe an echten Logs, der Panel-Durchlauf laeuft weiter.
let config = null;
try { config = require(path.join(root, 'config.js')); } catch (e) { /* siehe unten */ }
const tsRe = /^\d{2}\.\d{2}\.\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}/;

function collectFiles(dir, out, depth) {
  if (out.length >= 6 || (depth || 0) > 2) return out;
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) collectFiles(p, out, (depth || 0) + 1);
    else if (/\.log$/i.test(it.name)) {
      try { if (fs.statSync(p).size < 4 * 1024 * 1024) out.push(p); } catch (e) { /* ignorieren */ }
    }
    if (out.length >= 6) break;
  }
  return out;
}

// Mehrzeilige Eintraege zusammenfassen — wie der Server zwischen zwei Zeitstempeln
function splitEntries(text, limit) {
  const out = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (tsRe.test(line)) {
      if (cur) out.push(cur);
      if (out.length >= limit) break;
      cur = line;
    } else if (cur !== null) {
      cur += '\n' + line;
    }
  }
  if (cur && out.length < limit) out.push(cur);
  return out;
}

const filterRe = config
  ? new RegExp(config.filterPatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i')
  : null;

const files = [];
if (config) for (const wp of config.watchPaths) collectFiles(wp.path, files);

console.log('\n=== Beschriftungen aus echten Logdateien ===');
if (!config) {
  console.log('  Uebersprungen: keine config.js vorhanden (frische Kopie / Tool-Export).');
} else if (files.length === 0) {
  console.log('  Keine lesbaren Logdateien gefunden (Netzlaufwerke X:/Y: ggf. nicht erreichbar).');
}

let shown = 0, empty = 0, startsWithTimestamp = 0, onlySeparator = 0, announcementOnly = 0;
for (const file of files) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }
  const entries = splitEntries(text, 400).filter(e => filterRe.test(e));
  if (entries.length === 0) continue;

  console.log('\n  ' + path.basename(file) + '  (' + entries.length + ' Treffer)');
  for (const entry of entries.slice(-4)) {
    const summary = Keasy.utils.entrySummary(entry, 120);
    if (!summary) empty++;
    if (/^\d{1,2}\.\d{1,2}\.\d{2,4}/.test(summary)) startsWithTimestamp++;
    if (/^[=\-_*#~+.]+$/.test(summary)) onlySeparator++;
    if (/^Der folgende .?Fehler ist aufgetreten:$/.test(summary)) announcementOnly++;
    console.log('    → ' + summary);
    shown++;
  }
}

console.log('\n=== Auswertung ===');
console.log('  geprueft:                 ' + shown);
console.log('  leer:                     ' + empty);
console.log('  beginnt mit Zeitstempel:  ' + startsWithTimestamp);
console.log('  nur Trennlinie:           ' + onlySeparator);
console.log('  nur Ankuendigungszeile:   ' + announcementOnly);

// --- Panel-Durchlauf ---
console.log('\n=== Panel-Durchlauf (Laufzeitfehler?) ===');
Keasy.state.navEntries = [
  { id: 'err-0', ref: {}, filePath: 'Y:\\a.log', isAnalyze: false, label: 'VFMService Dienst',
    collapseKey: 'VFMService Dienst', level: 'kritisch', time: '13:28:02',
    file: 'KeasyServerService_2026-08-18.log', summary: 'SMTP: Failure sending mail.' },
  { id: 'err-1', ref: {}, filePath: 'Y:\\a.log', isAnalyze: false, label: 'VFMService Dienst',
    collapseKey: 'VFMService Dienst', level: 'normal', time: '13:31:56',
    file: 'KeasyServerService_2026-08-18.log', summary: 'TimeoutException' },
  { id: 'err-2', ref: {}, filePath: 'D:\\alt.log', isAnalyze: true, label: '📂 Analyse',
    collapseKey: 'analyze:📂 Analyse', level: 'normal', time: '09:44:02',
    file: 'alt_2026-07-14.log', summary: 'SqlException' }
];

let failed = 0;
try {
  Keasy.errorIndex.renderErrorIndex();
  const html = nodes.indexScroll.innerHTML;
  const checks = [
    ['Gruppenkopf je Quelle', (html.match(/idx-group-head/g) || []).length === 2],
    ['Analyse-Gruppe abgesetzt', html.includes('is-analyze')],
    ['drei Zeilen gerendert', (html.match(/idx-row/g) || []).length === 3],
    // Auf die Nummern-Spalte einschraenken: ">1</span>" trifft sonst auch den
    // Zaehler einer Gruppe mit genau einem Eintrag.
    ['Nummerierung je Quelle neu', (html.match(/class="idx-nr">1</g) || []).length === 2],
    ['kritische Zeile markiert', html.includes('lvl-kritisch')],
    ['jumpToEntry verdrahtet', html.includes("jumpToEntry('err-0'")],
    ['Zaehler gesetzt', nodes.indexTotal.textContent === 3]
  ];
  for (const [name, cond] of checks) {
    console.log((cond ? '  ok   ' : '  FAIL ') + name);
    if (!cond) failed++;
  }

  Keasy.errorIndex.setIndexSeverity(true);
  const critOnly = (nodes.indexScroll.innerHTML.match(/idx-row/g) || []).length === 1;
  console.log((critOnly ? '  ok   ' : '  FAIL ') + 'Filter "nur kritische" laesst eine Zeile uebrig');
  if (!critOnly) failed++;

  Keasy.errorIndex.setIndexSeverity(false);
  Keasy.errorIndex.toggleIndexGroup('VFMService Dienst');
  const collapsed = (nodes.indexScroll.innerHTML.match(/idx-row/g) || []).length === 1;
  console.log((collapsed ? '  ok   ' : '  FAIL ') + 'zugeklappte Quelle blendet ihre Zeilen aus');
  if (!collapsed) failed++;

  Keasy.state.navEntries = [];
  Keasy.errorIndex.renderErrorIndex();
  const emptyOk = nodes.indexScroll.innerHTML.includes('idx-empty');
  console.log((emptyOk ? '  ok   ' : '  FAIL ') + 'leerer Zustand faengt sich ab');
  if (!emptyOk) failed++;
} catch (e) {
  console.log('  FAIL Laufzeitfehler: ' + e.message);
  failed++;
}

const summaryBad = empty + startsWithTimestamp + onlySeparator + announcementOnly;
if (summaryBad > 0) { console.log('\n  FAIL ' + summaryBad + ' unbrauchbare Beschriftung(en)'); failed++; }

console.log(failed === 0 ? '\n✅ Kopfloser Test bestanden\n' : `\n❌ ${failed} Problem(e)\n`);
process.exit(failed === 0 ? 0 : 1);
