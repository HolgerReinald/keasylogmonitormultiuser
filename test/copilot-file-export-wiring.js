// Statische Verdrahtungs-Pruefung: komplette Log-Datei ins Copilot-Verzeichnis.
//
// Die Fehlerklassen hier sind zwei — und beide sehen im Browser nicht wie ein
// Fehler aus, sondern wie "der Knopf tut nichts":
//   1. Inline-onclick auf eine Funktion, die nicht als window-Global steht
//   2. Route fehlt in der Route-Map oder in ADMIN_ONLY_ROUTES
// Dazu zwei inhaltliche Zusagen, die man beim Aufraeumen leicht zerstoert:
//   3. Der Dateiinhalt darf NICHT durch den JSON-Body (1-MB-Deckel)
//   4. Der Zielname ist der eigene Dateiname, nicht copilot-error-context.md
//      (sonst ueberschreibt der Datei-Export den Einzelfehler-Export)
//   5. Der gesendete Pfad wird geprueft — ohne das waere es ein Leseloch
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let failed = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const bad = (name, detail) => { console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); failed++; };
const check = (name, cond, detail) => cond ? ok(name) : bad(name, detail);

const render = read('public/js/render.js');
const actions = read('public/js/actions.js');
const routes = read('server/routes/configRoutes.js');
const router = read('server/httpRouter.js');
const css = read('public/style.css');

console.log('\n1) Knoepfe in der Datei-Kopfzeile');
{
  const fn = (render.match(/function buildOpenButtonsHtml\([\s\S]*?\n}/) || [''])[0];
  check('buildOpenButtonsHtml gefunden', fn.length > 0);
  for (const target of ['develop', 'release']) {
    check(`Knopf fuer ${target}`, fn.includes(`exportFileToCopilot('\${escapeJs(filePath)}', '${target}', event)`),
      'Der Pfad muss durch escapeJs laufen und event mitgehen');
  }
  check('Klassen wie am Fehlereintrag', /copilot-btn/.test(fn) && /copilot-release-btn/.test(fn),
    'Gleiche Optik wie die vorhandenen Copilot-Knoepfe');
  check('CSS dafuer vorhanden', /\.copilot-btn/.test(css) && /\.copilot-release-btn/.test(css));
  // buildOpenButtonsHtml wird von Live, Performance und Analyse genutzt
  check('von drei Bereichen genutzt', (render.match(/buildOpenButtonsHtml\(/g) || []).length === 4,
    'Definition + drei Aufrufe (Live, Performance, Analyse) — gefunden: ' +
    (render.match(/buildOpenButtonsHtml\(/g) || []).length);
}

console.log('\n2) Handler ist als window-Global registriert');
{
  check('exportFileToCopilot definiert', /async function exportFileToCopilot\(filePath, target, event\)/.test(actions));
  const globals = (actions.match(/Object\.assign\(window, \{([\s\S]*?)\n\}\)/) || [, ''])[1];
  const ns = (actions.match(/window\.Keasy\.actions = \{([\s\S]*?)\n\};/) || [, ''])[1];
  check('im window-Global', /\bexportFileToCopilot\b/.test(globals),
    'Ohne das wirft das Inline-onclick "is not defined"');
  check('im Namespace Keasy.actions', /\bexportFileToCopilot\b/.test(ns),
    'Beide Listen werden im Projekt gleich gepflegt');
  const fn = (actions.match(/async function exportFileToCopilot\([\s\S]*?\n}/) || [''])[0];
  check('stopPropagation als erstes', /if \(event\) event\.stopPropagation\(\);/.test(fn),
    'Sonst klappt die Kopfzeile beim Klick zu');
  check('Knopf waehrend des Requests gesperrt', /btn\.disabled = true/.test(fn) && /btn\.disabled = false/.test(fn));
}

console.log('\n3) Der Dateiinhalt geht NICHT durch den Body');
{
  const fn = (actions.match(/async function exportFileToCopilot\([\s\S]*?\n}/) || [''])[0];
  check('Body enthaelt nur Pfad und Ziel', /JSON\.stringify\(\{ filePath, target \}\)/.test(fn),
    'parseJsonBody deckelt bei 1 MB — Inhalt im Body waere nicht tragfaehig');
  check('kein Dateiinhalt im Client gelesen', !/FileReader|readAsText/.test(fn));
  check('Server kopiert die Datei', /fs\.copyFileSync\(source, outputPath\)/.test(routes),
    'copyFileSync haelt den Rohzustand exakt');
}

console.log('\n4) Zielname ist der eigene Dateiname');
{
  check('Zielname aus basename', /path\.join\(dirInfo\.dir, path\.basename\(source\)\)/.test(routes),
    'Mit copilot-error-context.md wuerde der Datei-Export den Einzelfehler-Export ueberschreiben');
  check('Einzelfehler-Export behaelt seinen festen Namen',
    /path\.join\(dirInfo\.dir, 'copilot-error-context\.md'\)/.test(routes));
}

console.log('\n5) Pfadpruefung und Rechte');
{
  check('isKnownLogFile vorhanden', /function isKnownLogFile\(filePath, username\)/.test(routes),
    'Ohne Pruefung koennte jede Datei des Servers abgeholt werden');
  const fn = (routes.match(/function isKnownLogFile\([\s\S]*?\n}/) || [''])[0];
  for (const src of ['errorStore', 'performanceStore', 'getAnalyzeErrors', 'dropStore.userDir']) {
    check(`prueft ${src}`, fn.includes(src), 'Alle vier Quellen zeigen Dateien im Dashboard an');
  }
  check('Route ruft die Pruefung auf', /if \(!isKnownLogFile\(filePath, username\)\)/.test(routes));
  check('Sichtbarkeit der Quelle wird geprueft', /canAccessLabel\(req\.session, srcLabel\)/.test(routes),
    'Wie bei pause-source: keine fremde Quelle exportieren');
  check('Obergrenze maxLogFileSizeMB', /config\.maxLogFileSizeMB/.test(routes) && /groesser als \$\{maxMB\} MB/.test(routes));
}

console.log('\n6) Route ist eingehaengt und gleich berechtigt');
{
  check("Route 'POST /api/export-copilot-file'", routes.includes("'POST /api/export-copilot-file'"));
  check('in ADMIN_ONLY_ROUTES', router.includes("'POST /api/export-copilot-file',"),
    'Gleiche Behandlung wie der Einzelfehler-Export');
  check('Client ruft dieselbe Route', actions.includes("fetch('/api/export-copilot-file'"));
}

console.log('\n7) Zielverzeichnis-Logik wird geteilt, nicht kopiert');
{
  check('resolveCopilotDir vorhanden', /function resolveCopilotDir\(req, target\)/.test(routes));
  check('von beiden Routen genutzt', (routes.match(/resolveCopilotDir\(req, target\)/g) || []).length === 3,
    'Definition + zwei Aufrufe — gefunden: ' + (routes.match(/resolveCopilotDir\(req, target\)/g) || []).length);
  check('Pfad kommt pro Benutzer', /getUserConfig\(username\)/.test(routes),
    'Die Copilot-Pfade sind Benutzer-Einstellungen, keine globalen');
}

console.log(failed === 0 ? '\n✅ Verdrahtung vollstaendig\n' : `\n❌ ${failed} Problem(e)\n`);
process.exit(failed === 0 ? 0 : 1);
