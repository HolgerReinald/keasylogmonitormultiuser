// Statische Verdrahtungs-Pruefung des Fehler-Index (kein Server noetig).
// Faengt die Fehlerklasse, die bei Vanilla-JS ohne Bundler realistisch ist:
// getElementById auf eine ID, die es im HTML nicht gibt, Inline-onclick auf
// Funktionen, die nirgends als window-Global stehen, und ein vergessenes
// <script>-Tag in der Ladereihenfolge.
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
const render = read('public/js/render.js');
const actions = read('public/js/actions.js');
const utils = read('public/js/utils.js');
const state = read('public/js/state.js');
const boot = read('public/js/boot.js');
const panel = read('public/js/errorIndexPanel.js');

console.log('\n1) DOM-IDs, die errorIndexPanel.js anspricht, existieren im HTML');
for (const id of ['appMain', 'errorIndex', 'indexScroll', 'indexTotal',
                  'indexFilterAll', 'indexFilterCrit', 'indexToggleBtn', 'container']) {
  check(`#${id}`, html.includes(`id="${id}"`), `id="${id}" fehlt in index.html`);
}

console.log('\n2) Inline-onclick-Handler sind als window-Globals registriert');
{
  const globals = (panel.match(/Object\.assign\(window, \{([\s\S]*?)\}\)/) || [, ''])[1];
  for (const fn of ['toggleIndexPanel', 'swapIndexSide', 'setIndexSeverity', 'toggleIndexGroup']) {
    check(`${fn} exportiert`, globals.includes(fn), `${fn} fehlt in Object.assign(window, {...})`);
    check(`${fn} im HTML/Panel verwendet`, html.includes(`${fn}(`) || panel.includes(`${fn}(`));
  }
  const actionGlobals = (actions.match(/Object\.assign\(window, \{([\s\S]*?)\}\)/) || [, ''])[1];
  check('jumpToEntry exportiert', actionGlobals.includes('jumpToEntry'),
    'Die Index-Zeilen rufen jumpToEntry per Inline-onclick auf');
  check('jumpToEntry wird im Index verwendet', panel.includes('jumpToEntry('));
}

console.log('\n3) Script-Ladereihenfolge');
{
  const order = [...html.matchAll(/<script src="js\/([\w.]+)\.js" defer>/g)].map(m => m[1]);
  check('errorIndexPanel.js eingebunden', order.includes('errorIndexPanel'),
    'Ohne <script>-Tag laeuft renderErrorIndex() ins Leere');
  check('utils vor errorIndexPanel', order.indexOf('utils') < order.indexOf('errorIndexPanel'));
  check('state vor errorIndexPanel', order.indexOf('state') < order.indexOf('errorIndexPanel'));
  check('boot.js zuletzt', order[order.length - 1] === 'boot');
}

console.log('\n4) Eine Textaufbereitung, nicht zwei');
{
  check('entrySummary in utils.js', /entrySummary\(text, maxLen\)/.test(utils));
  check('stripLeadingTimestamp in utils.js', /stripLeadingTimestamp\(line\)/.test(utils));
  check('boot.js hat keine eigene stripLeadingTimestamp mehr',
    !/function stripLeadingTimestamp/.test(boot),
    'Zwei Implementierungen laufen auseinander — dann steht in der Benachrichtigung etwas anderes als im Index');
  check('Benachrichtigung nutzt entrySummary', /buildNotificationBody[\s\S]{0,300}Keasy\.utils\.entrySummary/.test(boot));
  check('Index nutzt dieselbe Funktion (ueber render.js)', /Keasy\.utils\.entrySummary\(err\.line/.test(render));
}

console.log('\n5) Index-Daten entstehen im vorhandenen Render-Durchlauf');
{
  check('navEntries im State', /navEntries: \[\]/.test(state));
  check('navEntries wird pro renderAll geleert', /state\.navEntries = \[\]/.test(render));
  check('Eintraege bekommen eine ID', /id="\$\{entryId\}"/.test(render));
  check('navEntries wird in buildErrorEntryHtml gefuellt',
    /buildErrorEntryHtml[\s\S]{0,900}state\.navEntries\.push/.test(render));
  check('kein zweiter Durchlauf ueber die Daten', (render.match(/state\.navEntries\.push/g) || []).length === 1,
    'Die Schleifen ueber die gefilterten Eintraege existieren bereits — ein zweiter Durchlauf koennte abweichen');
  check('collapseKey mitgefuehrt', /collapseKey:/.test(render),
    'jumpToEntry braucht ihn, um die Quelle ueber toggleSource aufzuklappen');
  check('Gap-Eintraege kommen NICHT in den Index',
    !/buildGapEntryHtml[\s\S]{0,600}navEntries\.push/.test(render),
    'Luecken sind keine Fehler und haben keine Dringlichkeitsstufe');
  check('renderErrorIndex an allen drei Ausgaengen von renderAll',
    (render.match(/renderErrorIndex\(\);/g) || []).length === 3,
    'Leerer Zustand, kein Treffer und Normalfall muessen alle den Index aktualisieren');
}

console.log('\n6) Eine Sprungmechanik, nicht zwei');
{
  check('focusEntry definiert', /function focusEntry\(target\)/.test(actions));
  check('jumpToCritical nutzt focusEntry', /function jumpToCritical[\s\S]*?focusEntry\(target\)/.test(actions));
  check('jumpToEntry nutzt focusEntry', /function jumpToEntry[\s\S]*?focusEntry\(target\)/.test(actions));
  check('nur eine Stelle scrollt', (actions.match(/scrollIntoView/g) || []).length === 1,
    'Zwei Sprungmechaniken laufen auseinander');
  check('Quelle wird ueber toggleSource aufgeklappt',
    /function jumpToEntry[\s\S]{0,600}toggleSource\(/.test(actions),
    'Direkt am DOM zu drehen wuerde den gemerkten Auf-/Zu-Zustand umgehen');
}

console.log('\n7) Markierung ueberlebt den Neuaufbau');
{
  check('currentEntry im State', /currentEntry: null/.test(state));
  check('Markierung ueber die Objektreferenz, nicht ueber die ID',
    /n\.ref === state\.currentEntry\.ref/.test(panel),
    'IDs werden bei jedem renderAll neu vergeben');
  check('Scrollposition wird gesichert', /scrollTop/.test(panel) && /scroll\.scrollTop = scrollTop/.test(panel),
    'Sonst springt die Liste im Live-Betrieb bei jedem Fehler an den Anfang');
  check('applyCurrentEntry wird nach dem Rendern aufgerufen',
    /scroll\.innerHTML = html[\s\S]{0,200}applyCurrentEntry\(\)/.test(panel));
}

console.log('\n8) Sprungziel ist nicht rot codiert');
{
  check('.error-entry.is-current im Stylesheet', css.includes('.error-entry.is-current'));
  check('is-current steht NACH sev-kritisch',
    css.indexOf('.error-entry.is-current') > css.indexOf('.error-entry.sev-kritisch'),
    'Bei gleicher Spezifitaet entscheidet die Reihenfolge');
  const cur = (css.match(/\.error-entry\.is-current \{[^}]*\}/) || [''])[0];
  // Auf den Regelblock pruefen, nicht auf den Dateitext: der Kommentar darueber
  // erwaehnt "!important" selbst, ein Treffer dort waere ein Fehlalarm.
  check('kein !important noetig', !cur.includes('!important'));
  check('is-current nutzt den Akzent, nicht sev-critical',
    cur.includes('var(--accent)') && !cur.includes('var(--sev-critical)'),
    'Roter Rahmen auf rotem Grund traegt keine Information');
  check('Helligkeitssignal vorhanden (wirkt auch in Graustufen)', cur.includes('var(--bg-tertiary)'));
  check('Formsignal vorhanden (Rahmen rundum)', cur.includes('outline:'));
  check('Aufblitzen ebenfalls im Akzent',
    /@keyframes jumpFlashAccent[\s\S]{0,160}var\(--accent\)/.test(css));
  check('alter roter Aufblitz-Effekt entfernt',
    !/@keyframes jumpFlash \{/.test(css));
  check('prefers-reduced-motion beruecksichtigt',
    /prefers-reduced-motion[\s\S]{0,200}jump-flash[\s\S]{0,60}animation: none/.test(css));
}

console.log('\n9) Layout und Themes');
{
  check('.app-main als Flex-Wrapper', /\.app-main \{[\s\S]{0,120}display: flex/.test(css));
  check('Seite umschaltbar', css.includes('.app-main[data-side="right"]'));
  check('Seitenleiste ausblendbar', css.includes('.app-main[data-side="off"]'));
  check('#container schrumpft nicht ueber seinen Inhalt hinaus',
    /#container \{[^}]*min-width: 0/.test(css),
    'Ohne min-width:0 sprengen lange Log-Zeilen das Flex-Layout');
  check('Zeitspalte nicht fest in Pixeln',
    /\.idx-row \{[\s\S]{0,200}grid-template-columns: 20px max-content 1fr/.test(css),
    'Feste Breiten brechen, sobald die Schriftgroesse ueber den CSS-Editor geaendert wird');
  check('keine festen Farbwerte im Index-Abschnitt',
    !/\.(idx-|index-)[\w-]*[^}]*:\s*#[0-9a-fA-F]{3,6}/.test(css.slice(css.indexOf('Fehler-Index (Seitenleiste)'))),
    'Alle drei Themes laufen ueber CSS-Variablen');
  check('Quellen-Kopf bleibt beim Scrollen stehen',
    /\.idx-group-head \{[\s\S]{0,120}position: sticky/.test(css),
    'Sonst ist nach ein paar Zeilen unklar, in welchem Watchpath man liest');
}

console.log('\n10) Ein Auf-/Zu-Zustand je Quelle, nicht zwei');
{
  check('kein eigenes indexCollapsed mehr', !/indexCollapsed/.test(state) && !/indexCollapsed/.test(panel),
    'Zwei Gedaechtnisse liefen auseinander — Hauptansicht und Index zeigten Verschiedenes');
  check('Index liest collapsedSources', /state\.collapsedSources\[key\]/.test(panel));
  check('toggleSource rendert den Index mit',
    /function toggleSource[\s\S]{0,700}Keasy\.errorIndex\.renderErrorIndex\(\)/.test(actions),
    'Klick auf den Watchpath in der Hauptansicht muss die Seitenleiste mitnehmen');
  check('Index-Gruppe ruft toggleSource auf',
    /function toggleIndexGroup[\s\S]{0,500}toggleSource\(header, key\)/.test(actions + panel),
    'Sonst wird der Zustand an zwei Stellen gepflegt');
  check('Quellen-Koepfe tragen data-collapse-key',
    (render.match(/data-collapse-key=/g) || []).length === 4,
    'Live, Performance, Analyse-Quellen und der Analyse-Sammelblock. Ueber dieses ' +
    'Attribut findet der Index den Kopf wieder; beim Sammelblock haengt zusaetzlich ' +
    '"Alle zu/auf" daran (Selektor in actions.js).');
}

console.log('\n11) Alle Quellen auf einen Schlag');
{
  check('#collapseAllBtn im HTML', html.includes('id="collapseAllBtn"'));
  check('toggleAllSources exportiert',
    (actions.match(/Object\.assign\(window, \{([\s\S]*?)\}\)/) || [, ''])[1].includes('toggleAllSources'));
  check('Zielzustand haengt davon ab, ob irgendeine Quelle offen ist',
    /function toggleAllSources[\s\S]{0,400}\.some\(h => !h\.nextElementSibling\.classList\.contains\('collapsed'\)\)/.test(actions));
  check('nur einmal in den localStorage geschrieben',
    (((actions.match(/function toggleAllSources[\s\S]*?\n\}/) || [''])[0]).match(/localStorage\.setItem/g) || []).length === 1,
    'Ein Schreibvorgang je Klick, nicht einer je Quelle');
  check('Beschriftung wird nach dem Rendern aktualisiert',
    (render.match(/updateCollapseAllButton\(\);/g) || []).length === 3,
    'Sonst zeigt der Knopf nach neuen Fehlern das Falsche an');
}

console.log('\n12) Klebende Koepfe');
{
  check('Quellen-Kopf klebt', /\.source-header \{[\s\S]{0,120}position: sticky/.test(css));
  check('deckender Hintergrund vorhanden',
    /\.source-header \{[\s\S]{0,220}background: var\(--accent\)/.test(css),
    'Durchscheinender Kopf liesse den Text darunter hindurchlaufen');
  check('Steuerleiste bleibt beweglich', !/\.controls \{[^}]*position: sticky/.test(css),
    'Sie bricht auf schmalen Fenstern um und wuerde klebend zu viel Hoehe fressen');
  check('Datei-Kopf bleibt beweglich', !/\.file-header \{[^}]*position: sticky/.test(css),
    'Drei gestapelte klebende Ebenen fressen spuerbar Bildschirmhoehe');
}

console.log('\n13) Lesemarke folgt dem Scrollen');
{
  check('IntersectionObserver statt Scroll-Handler', /new IntersectionObserver/.test(panel),
    'Ein Scroll-Listener wuerde bei jedem Frame ueber alle Eintraege laufen');
  check('faengt fehlenden IntersectionObserver ab',
    /typeof IntersectionObserver === 'undefined'/.test(panel));
  check('Leseband statt voller Sichtbarkeit', /rootMargin:/.test(panel),
    'Ohne Band waeren bei langen Stack-Traces mehrere Eintraege gleichzeitig sichtbar');
  check('Beobachter wird nach jedem Neuaufbau neu gesetzt',
    /scroll\.innerHTML = html[\s\S]{0,400}observeEntries\(\)/.test(panel),
    'renderAll() ersetzt alle Eintrags-Elemente — alte Beobachtungen zeigen ins Leere');
  check('alter Beobachter wird vorher getrennt',
    /function observeEntries[\s\S]{0,200}spyObserver\.disconnect\(\)/.test(panel),
    'Sonst sammeln sich mit jedem Fehler weitere Beobachter an');
  check('Lesemarke haengt an der Objektreferenz, nicht an der ID',
    /inViewRef/.test(panel) && /n\.ref === inViewRef/.test(panel),
    'IDs werden bei jedem renderAll neu vergeben');
  // Auf den Aufruf mit Klammern pruefen: der Kommentar darueber nennt
  // scrollIntoView selbst, ein Treffer darauf waere ein Fehlalarm.
  check('Seitenleiste scrollt ueber scrollTop, nicht scrollIntoView',
    /function setActiveRow[\s\S]*?scroll\.scrollTop =/.test(panel) &&
    !/scrollIntoView\(/.test(panel),
    'scrollIntoView wuerde die Seite darunter mitscrollen und den Blick wegreissen');
  check('Rahmen im Fehlertext folgt dem Scrollen NICHT',
    !/function observeEntries[\s\S]*?is-current/.test(panel),
    'Ein mitwandernder Rahmen im Lesebereich waere Unruhe — die Seitenleiste traegt die Auskunft');
}

console.log(failed === 0 ? '\n✅ Verdrahtung vollstaendig\n' : `\n❌ ${failed} Problem(e)\n`);
process.exit(failed === 0 ? 0 : 1);
