// Statische Verdrahtungs-Pruefung: komplette Log-Datei ins KI-Verzeichnis.
//
// Die Fehlerklassen hier sind zwei — und beide sehen im Browser nicht wie ein
// Fehler aus, sondern wie "der Knopf tut nichts":
//   1. Inline-onclick auf eine Funktion, die nicht als window-Global steht
//   2. Route fehlt in der Route-Map oder in ADMIN_ONLY_ROUTES
// Dazu zwei inhaltliche Zusagen, die man beim Aufraeumen leicht zerstoert:
//   3. Der Dateiinhalt darf NICHT durch den JSON-Body (1-MB-Deckel)
//   4. Der Zielname ist der eigene Dateiname, nicht ki-error-context.md
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
    check(`Knopf fuer ${target}`, fn.includes(`buildCopilotBtnHtml('${target}'`),
      'Beide Copilot-Knoepfe kommen aus demselben Bauer');
    check(`${target} uebergibt Pfad und event`,
      fn.includes(`exportFileToCopilot('\${escapeJs(filePath)}', '${target}', event)`),
      'Der Pfad muss durch escapeJs laufen und event mitgehen');
  }
  // Die Klassen liegen jetzt im Bauer, nicht mehr ausgeschrieben an jeder Stelle
  const builder = (render.match(/function buildCopilotBtnHtml\([\s\S]*?\n}/) || [''])[0];
  check('Klassen wie am Fehlereintrag', /copilot-release-btn/.test(builder) && /copilot-btn/.test(builder),
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
    'Mit ki-error-context.md wuerde der Datei-Export den Einzelfehler-Export ueberschreiben');
  check('Einzelfehler-Export behaelt seinen festen Namen',
    /path\.join\(dirInfo\.dir, 'ki-error-context\.md'\)/.test(routes));
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

console.log('\n8) ↗️ an den Copilot-Pfaden (Einstellungen)');
{
  const html = read('public/index.html');
  const cfg = read('public/js/configPanel.js');
  for (const t of ['Develop', 'Release']) {
    check(`Knopf am Feld ${t}`,
      html.includes(`openConfigPath('cfg-copilotWorkingPath${t}', event)`),
      'Ohne den Knopf muss man den Pfad zum Nachsehen von Hand kopieren');
  }
  check('openConfigPath definiert', /function openConfigPath\(inputId, event\)/.test(cfg));
  const fn = (cfg.match(/function openConfigPath\([\s\S]*?\n}/) || [''])[0];
  check('delegiert an openFolder', /openFolder\(value, event\)/.test(fn),
    'Kein vierter fetch auf /api/open-folder — die Route bedienen schon Fehlereintraege, ' +
    'Backup-Ziele und Analyse-Pfade');
  check('kein eigener fetch', !/fetch\(/.test(fn));
  check('leeres Feld gibt Rueckmeldung', /showToast\('Kein Pfad eingetragen'/.test(fn),
    'Sonst passiert bei leerem Feld sichtbar nichts');
  const globals = (cfg.match(/Object\.assign\(window, \{([\s\S]*?)\n\}\)/) || [, ''])[1];
  const ns = (cfg.match(/window\.Keasy\.config = \{([\s\S]*?)\n\};/) || [, ''])[1];
  check('im window-Global', /\bopenConfigPath\b/.test(globals));
  check('im Namespace Keasy.config', /\bopenConfigPath\b/.test(ns));
}

console.log('\n9) Leerer Pfad sperrt den Knopf');
{
  const server = read('server.js');
  const ws = read('public/js/wsClient.js');
  const st = read('public/js/state.js');
  const cfg = read('public/js/configPanel.js');
  const builder = (render.match(/function buildCopilotBtnHtml\([\s\S]*?\n}/) || [''])[0];

  // Der Client kann die Pfade nicht selbst kennen: sie stehen pro Benutzer in
  // users/<name>/config.json und werden erst beim Oeffnen der Einstellungen
  // geholt. Deshalb kommen zwei Merker mit der init-Nachricht.
  check('init schickt beide Merker',
    /copilotDevelopSet: !!copilotCfg\.copilotWorkingPathDevelop/.test(server) &&
    /copilotReleaseSet: !!copilotCfg\.copilotWorkingPathRelease/.test(server),
    'Sonst weiss die Anzeige beim ersten Rendern nichts von den Pfaden');
  check('init liest die Benutzer-Config', /mergeConfigForUser\(config, session\.username\)/.test(server),
    'Die Copilot-Pfade sind pro Benutzer, nicht global');
  check('nur Merker, nicht die Pfade selbst', !/copilotWorkingPathDevelop:/.test(server),
    'Der Pfad selbst gehoert nicht in jede init-Nachricht');
  check('State kennt die Merker', /copilotDevelopSet: false/.test(st) && /copilotReleaseSet: false/.test(st));
  check('wsClient uebernimmt sie', /state\.copilotDevelopSet = !!msg\.copilotDevelopSet/.test(ws));

  check('Bauer sperrt bei leerem Pfad', /isSet \? '' : ' disabled'/.test(builder),
    'Ohne disabled kommt die Absage erst nach dem Klick');
  check('Titel nennt den Grund', /ist nicht konfiguriert/.test(builder),
    'Ein gesperrter Knopf ohne Begruendung ist schlimmer als einer, der meckert');

  // Das ↗️ haengt am Feldinhalt, nicht am gespeicherten Stand
  check('↗️ folgt dem Feldinhalt', /function updateCopilotPathButtons\(\)/.test(cfg) &&
    /btn\.disabled = !input\.value\.trim\(\)/.test(cfg),
    'Wer einen Pfad eintippt, darf ihn vor dem Speichern nachsehen');
  check('↗️ reagiert auf Tippen', /addEventListener\('input', updateCopilotPathButtons\)/.test(cfg));
  check('IDs der ↗️-Knoepfe im HTML',
    read('public/index.html').includes('id="btn-openCopilotDevelop"') &&
    read('public/index.html').includes('id="btn-openCopilotRelease"'));
  check('Anzeige-Knoepfe folgen dem gespeicherten Stand',
    /state\.copilotDevelopSet = devSet/.test(cfg) && /renderAll\(\)/.test(cfg),
    'saveConfig ruft loadConfig nach — damit greift eine Aenderung ohne Neuladen');
}

console.log(failed === 0 ? '\n✅ Verdrahtung vollstaendig\n' : `\n❌ ${failed} Problem(e)\n`);
process.exit(failed === 0 ? 0 : 1);
