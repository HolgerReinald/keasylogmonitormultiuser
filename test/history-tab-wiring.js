// Statische Verdrahtungs-Pruefung des Historie-Tabs (kein Server noetig).
//
// Die Fehlerklasse hier ist eigen: der Tab wird nicht aus eigenen Daten
// gefuellt, sondern aus der gerenderten README — die Historie wird beim
// Aufbereiten aus dem Doku-Tab herausgehoben. Das kann auf drei Weisen
// schiefgehen, und alle drei sind im Browser nicht als Fehler zu sehen,
// sondern nur als leerer oder doppelter Inhalt:
//   1. der Tab loest den Abruf nicht aus → leer, wenn man die Doku nie geoeffnet hat
//   2. das Umhaengen passiert nach dem Inhaltsverzeichnis → Historie steht doppelt drin
//   3. "Alle zu" ist nicht auf einen Behaelter begrenzt → schaltet den anderen Tab mit
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let failed = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const bad = (name, detail) => { console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); failed++; };
const check = (name, cond, detail) => cond ? ok(name) : bad(name, detail);

const html = read('public/index.html');
const css = read('public/style.css');
const docs = read('public/js/docsPanel.js');
const cfg = read('public/js/configPanel.js');

console.log('\n1) Tab und Abschnitt existieren');
{
  check('Tab-Knopf ruft switchConfigTab(\'history\')', html.includes("switchConfigTab('history')"));
  check('Abschnitt id="config-history"', html.includes('id="config-history"'),
    'switchConfigTab baut die ID als #config-<tab> zusammen');
  for (const id of ['historyContent', 'historySearch', 'historyCount']) {
    check(`#${id}`, html.includes(`id="${id}"`));
  }
  // Reihenfolge: der Tab soll hinter der Dokumentation stehen
  check('Tab steht nach Dokumentation',
    html.indexOf("switchConfigTab('docs')") < html.indexOf("switchConfigTab('history')"));
}

console.log('\n2) Inline-Handler sind window-Globals');
{
  const globals = (docs.match(/Object\.assign\(window, \{([\s\S]*?)\}\)/) || [, ''])[1];
  for (const fn of ['filterHistory', 'toggleAllHistory']) {
    check(`${fn} exportiert`, new RegExp('\\b' + fn + '\\b').test(globals),
      `${fn} wird im HTML per Inline-Handler aufgerufen`);
    check(`${fn} im HTML verwendet`, html.includes(fn + '('));
  }
}

console.log('\n3) Der Tab loest den Abruf selbst aus');
{
  // Beide Tabs haengen an /api/docs. Ohne 'history' im Zweig bleibt der Tab
  // leer, solange man die Doku nicht vorher geoeffnet hat.
  check('loadDocs() auch fuer tab === history',
    /tab === 'docs' \|\| tab === 'history'[\s\S]{0,120}loadDocs\(\)/.test(cfg),
    'Sonst ist der Historie-Tab leer, wenn er als erster geoeffnet wird');
  check('Speichern-Knoepfe im Historie-Tab ausgeblendet',
    /configActions\.style\.display = \([^)]*tab === 'history'/.test(cfg),
    'Der Tab hat kein Config-Formular');
}

console.log('\n4) Umhaengen passiert vor dem Inhaltsverzeichnis');
{
  check('moveHistoryToTab existiert', /function moveHistoryToTab\(/.test(docs));
  const iWrap = docs.indexOf('wrapH2Sections(content)');
  const iMove = docs.indexOf('moveHistoryToTab(content)');
  const iToc = docs.indexOf('buildDocsToc(content)');
  check('Aufruf-Reihenfolge wrap → move → toc',
    iWrap > -1 && iMove > iWrap && iToc > iMove,
    'Nach dem Verzeichnis umgehaengt = Historie steht doppelt drin (Tab + Doku-Verzeichnis)');
  check('nur der Inhalt wandert, nicht die <details>-Huelle',
    /\.docs-section-body/.test(docs) && /sec\.remove\(\)/.test(docs),
    'Die Huelle wuerde eine zweite Klapp-Ebene erzeugen — ein Klick fuer nichts');
}

console.log('\n5) Auf-/Zuklappen ist auf einen Behaelter begrenzt');
{
  check('toggleAllIn nimmt einen Behaelter', /function toggleAllIn\(rootId/.test(docs));
  const docsFn = (docs.match(/function toggleAllDocs\([\s\S]*?\n}/) || [''])[0];
  const histFn = (docs.match(/function toggleAllHistory\([\s\S]*?\n}/) || [''])[0];
  check('toggleAllDocs → docsContent', /docsContent/.test(docsFn) && !/historyContent/.test(docsFn));
  check('toggleAllHistory → historyContent', /historyContent/.test(histFn) && !/docsContent/.test(histFn),
    'Sonst schaltet ein "Alle zu" den jeweils anderen Tab mit');
}

console.log('\n6) Suche filtert Eintraege und sagt, wie viele');
{
  const fn = (docs.match(/function filterHistory\([\s\S]*?\n}/) || [''])[0];
  check('filterHistory filtert .docs-collapsible', /docs-collapsible/.test(fn),
    'Im Tab liegt genau eine Ebene — die Eintraege selbst');
  check('Treffer werden aufgeklappt', /entry\.open = true/.test(fn),
    'Ein Treffer in einem zugeklappten Eintrag ist unsichtbar');
  check('Trefferzahl wird gesetzt', /setHistoryCount\(/.test(fn),
    'Eine leergefilterte Liste ist sonst nicht von einem Fehler zu unterscheiden');
  check('.docs-hits im CSS', /\.docs-hits\s*\{/.test(css));
}

console.log('\n7) Tab-Beschriftung gekuerzt');
{
  check('Tab heisst "Regeln"', /📋 Regeln<\/button>/.test(html));
  check('alte Beschriftung ist weg', !/Monitor-Einstellungen<\/button>/.test(html));
  check('Kennung monitorsettings unveraendert',
    html.includes("switchConfigTab('monitorsettings')") && html.includes('id="config-monitorsettings"'),
    'Die Kennung steht in CSS, Tab-Logik und im Hinweis-Test — Umbenennen waere Aufwand ohne Nutzen');
}

console.log(failed === 0 ? '\n✅ Verdrahtung vollstaendig\n' : `\n❌ ${failed} Problem(e)\n`);
process.exit(failed === 0 ? 0 : 1);
