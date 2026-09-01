// Statische Verdrahtungs-Pruefung der Prioritaetsregeln (kein Server noetig).
// Faengt genau die Fehlerklasse, die bei Vanilla-JS ohne Bundler realistisch ist:
// getElementById auf eine ID, die es im HTML nicht gibt, und Aufrufe von
// Funktionen/Namespaces, die nirgends definiert oder nicht geladen sind.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let failed = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const bad = (name, detail) => { console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); failed++; };
const check = (name, cond, detail) => cond ? ok(name) : bad(name, detail);

const html = read('public/index.html');
const priorityPanel = read('public/js/priorityPanel.js');
const configPanel = read('public/js/configPanel.js');
const render = read('public/js/render.js');
const utils = read('public/js/utils.js');
const state = read('public/js/state.js');
const boot = read('public/js/boot.js');
const wsClient = read('public/js/wsClient.js');
const logParser = read('server/logParser.js');
const serverJs = read('server.js');
const toolExportSrv = read('server/toolExport.js');
const toolExportCli = read('public/js/toolExport.js');
const emailSrv = read('server/emailService.js');

console.log('\n1) DOM-IDs, die der neue Code anspricht, existieren im HTML');
for (const id of ['cfg-priority-list', 'cfg-criticalDedupeMin', 'cfg-threshold-list', 'totalCount']) {
  check(`#${id}`, html.includes(`id="${id}"`), `id="${id}" fehlt in index.html`);
}

console.log('\n2) Inline-onclick-Handler sind als window-Globals registriert');
for (const fn of ['addPriorityRule', 'removePriorityRule', 'movePriorityRule']) {
  const usedInHtml = html.includes(`${fn}(`);
  const usedInPanel = priorityPanel.includes(`${fn}(`);
  const exported = /Object\.assign\(window, \{[^}]*\}/s.test(priorityPanel) && priorityPanel.match(/Object\.assign\(window, \{([^}]*)\}/s)[1].includes(fn);
  check(`${fn} als Global exportiert`, exported, `${fn} fehlt in Object.assign(window, {...}) von priorityPanel.js`);
  if (usedInHtml || usedInPanel) ok(`${fn} wird verwendet`);
}

console.log('\n3) Script-Ladereihenfolge (priorityPanel vor configPanel, utils zuerst)');
{
  const order = [...html.matchAll(/<script src="js\/([\w.]+)\.js" defer>/g)].map(m => m[1]);
  const idx = n => order.indexOf(n);
  check('priorityPanel.js eingebunden', idx('priorityPanel') !== -1);
  check('priorityPanel vor configPanel', idx('priorityPanel') < idx('configPanel'),
    `Reihenfolge: ${order.join(' → ')}`);
  check('utils vor priorityPanel (severityMeta)', idx('utils') < idx('priorityPanel'));
  check('state vor priorityPanel (configPriorityRules)', idx('state') < idx('priorityPanel'));
  check('render vor boot (updateBrowserTitle)', idx('render') < idx('boot'));
  check("utils vor wsClient (capKeepCritical)", idx("utils") < idx("wsClient"));
}

console.log('\n4) Frontend-Querverweise zeigen auf existierende Definitionen');
check('Keasy.priority wird registriert', /Keasy\.priority\s*=\s*\{/.test(priorityPanel));
for (const fn of ['renderPriorityRules', 'getPriorityRulesFromForm']) {
  check(`Keasy.priority.${fn} definiert`, new RegExp(`function ${fn}\\b`).test(priorityPanel));
  check(`Keasy.priority.${fn} in configPanel genutzt`, configPanel.includes(`Keasy.priority.${fn}`));
}
check('utils.entryLevel definiert', /entryLevel\(entry\)\s*\{/.test(utils));
check('utils.severityMeta definiert', /severityMeta\(level\)\s*\{/.test(utils));
check('utils.capKeepCritical definiert', /capKeepCritical\(entries, max\)/.test(utils));
check('render nutzt entryLevel', render.includes('Keasy.utils.entryLevel'));
check('render nutzt severityMeta', render.includes('Keasy.utils.severityMeta'));
check('priorityPanel nutzt severityMeta', priorityPanel.includes('Keasy.utils.severityMeta'));
check('boot nutzt entryLevel', boot.includes('Keasy.utils.entryLevel'));
check('wsClient nutzt capKeepCritical', wsClient.includes('Keasy.utils.capKeepCritical'));
check('render exportiert updateBrowserTitle', /Keasy\.render = \{[^}]*updateBrowserTitle/.test(render));
check('boot nutzt den Export statt eigener Titel-Logik', boot.includes('Keasy.render.updateBrowserTitle()'));
check('boot setzt document.title nicht mehr selbst', !/function notifyNewError[\s\S]{0,400}document\.title\s*=/.test(boot));

console.log('\n5) State-Slots vorhanden');
for (const slot of ['configPriorityRules', 'criticalErrors', 'lastCriticalNotificationTime']) {
  check(`state.${slot}`, new RegExp(`${slot}:`).test(state));
}

console.log('\n6) Server: Klassifizierung verdrahtet');
for (const fn of ['classifySeverity', 'rebuildPriorityRules', 'sanitizePriorityRules']) {
  check(`logParser.${fn} definiert`, new RegExp(`function ${fn}\\b`).test(logParser));
}
check('logParser exportiert classifySeverity', /module\.exports = \{[^}]*classifySeverity/.test(logParser));
check('logParser exportiert rebuildPriorityRules', /module\.exports = \{[^}]*rebuildPriorityRules/.test(logParser));
check('matchesFilter unveraendert (nur boolescher Rueckgabewert)',
  /function matchesFilter\(text\) \{\s*if \(excludeRegex && excludeRegex\.test\(text\)\) return false;\s*return filterRegex\.test\(text\) \|\| matchesThresholdRule\(text\) !== null;\s*\}/.test(logParser));
check('server.js ruft rebuildPriorityRules in applyConfigChanges',
  /rebuildPriorityRules\(newConfig\.priorityRules\)/.test(serverJs));
check('watchService: level am Fehler-Eintrag', read('server/watchService.js').includes('level: classifySeverity(limited)'));
check('analysisService: level am Fehler-Eintrag', read('server/analysisService.js').includes('level: classifySeverity(limited)'));
check('Gap-Eintraege bekommen KEIN level (watchService)',
  !/gapSeconds,[\s\S]{0,120}level:/.test(read('server/watchService.js')));
check('Gap-Eintraege bekommen KEIN level (analysisService)',
  !/gapSeconds,[\s\S]{0,120}level:/.test(read('server/analysisService.js')));

console.log('\n7) Tool-Export: Sektion beidseitig registriert');
// Prioritaetsregeln haben keine eigene Sektion mehr: der Regeln-Tab hat vier
// Karten, der Export hatte drei Haken -- einer davon fasste zwei zusammen, ohne
// erkennbaren Grund. Seit 2026-09-01 deckt "rules" alle vier ab, passend zum
// Einrichtungsassistenten, der sie ebenfalls als EINEN Punkt fuehrt.
check('Server fuehrt priorityRules in der Sektion "rules"',
  /rules: \[[^\]]*'priorityRules'[^\]]*\]/.test(toolExportSrv));
check('Server-Default priorityRules: []', /priorityRules: \[\]/.test(toolExportSrv));
check('Client kennt Sektion "rules"', /id: 'rules'/.test(toolExportCli));
check('keine Einzelsektion "priorities" mehr',
  !/id: 'priorities'/.test(toolExportCli) && !/priorities: \[/.test(toolExportSrv),
  'Zwei Aufteilungen desselben Themas sind schwerer zu erklaeren als eine');

console.log('\n8) E-Mail: Sofortversand und Stufen-Dedupe');
check('sendBufferedEmails nimmt onlyLabel', /async function sendBufferedEmails\(onlyLabel, isCriticalTrigger\)/.test(emailSrv));
check('isDuplicate kennt die Stufe', /function isDuplicate\(label, errorLine, level\)/.test(emailSrv));
check('dedupeMinutesFor definiert', /function dedupeMinutesFor\(level\)/.test(emailSrv));
check('Hash-Cleanup nutzt das laengere Fenster', /Math\.max\(dedupeMinutesFor\('normal'\), dedupeMinutesFor\('kritisch'\)\)/.test(emailSrv));
check('Preload-Schutz vorhanden', /function isHistoricalError\(error\)/.test(emailSrv) && emailSrv.includes('preload.running'));
check('Buendelung (Debounce + Sperre)', emailSrv.includes('IMMEDIATE_DEBOUNCE_MS') && emailSrv.includes('IMMEDIATE_MIN_GAP_MS'));
check('Sofortversand nur bei kritisch + frisch', /level === 'kritisch' && !isHistoricalError\(error\)/.test(emailSrv));
check('preload aus runtimeStore importiert', /require\('\.\/runtimeStore'\)/.test(emailSrv) && /preload\s*\}/.test(emailSrv));
check('Timer-Aufraeumung bei deaktivierter E-Mail', /immediateTimers\.clear\(\)/.test(emailSrv));
check('criticalDeduplicateMinutes im Config-Formular',
  configPanel.includes('criticalDeduplicateMinutes') && configPanel.includes('cfg-criticalDedupeMin'));

console.log('\n9) CSS: Variablen in allen drei Themes + Regeln vorhanden');
{
  const css = read('public/style.css');
  const themes = ['theme-light', 'theme-dark', 'theme-blue'];
  for (const t of themes) {
    const block = css.split(`body.${t} {`)[1]?.split('}')[0] || '';
    check(`--sev-critical in ${t}`, block.includes('--sev-critical:'), `Variable fehlt im ${t}-Block`);
    check(`--sev-critical-bg in ${t}`, block.includes('--sev-critical-bg:'));
    check(`--sev-critical-fg in ${t}`, block.includes('--sev-critical-fg:'));
  }
  check('.error-entry.sev-kritisch', css.includes('.error-entry.sev-kritisch'));
  check('.sev-badge-kritisch', css.includes('.sev-badge-kritisch'));
  check('.error-entry.sev-gering', css.includes('.error-entry.sev-gering'));
  check('keine harte Farbe im sev-Block (nur Variablen)',
    !/\.error-entry\.sev-kritisch \{[^}]*#[0-9a-f]{3,6}/i.test(css));
}

console.log('\n10) Regressionsschutz: "normal" erzeugt kein Markup');
check('kein sev-badge-normal im Render', !render.includes('sev-badge-normal'));
check('severityMeta.normal hat leere cls/icon', /normal: \{ icon: '', label: 'Normal', cls: '' \}/.test(utils));

console.log('\n11) 🚨 Alarmknopf statt Rollup-Badge');
{
  const actions = read('public/js/actions.js');
  const css = read('public/style.css');
  check('buildAlarmButtonHtml definiert', /function buildAlarmButtonHtml\(criticalCount, label\)/.test(render));
  check('Knopf steht auch im Ruhezustand (Ausrichtung!)', /alarm-btn is-idle/.test(render),
    'Ohne Ruhezustand-Knopf wandern die Spalten wieder');
  check('Ruhezustand ist disabled', /is-idle[^`]*disabled/.test(render));
  check('kein Rollup-Badge mehr im Render', !/sev-badge-kritisch">🔴/.test(render),
    'Die alten 🔴-n-Badges auf Datei-/Quellen-Ebene sollten ersetzt sein');
  check('Datei-Ebene nutzt den Knopf', (render.match(/buildAlarmButtonHtml\(fileCriticalCount\)/g) || []).length === 2,
    'Erwartet je einmal im Live- und im Analyse-Block');
  check('Quellen-Ebene übergibt ein Label', /buildAlarmButtonHtml\(groupCriticalCount, (label|collapseKey)\)/.test(render));
  check('has-kritisch wird gesetzt', (render.match(/has-kritisch/g) || []).length >= 2);
  check('Gap-Eintrag bekommt keinen Alarmknopf', !/buildGapEntryHtml[\s\S]{0,300}alarm-btn/.test(render));

  check('jumpToCritical definiert', /function jumpToCritical\(btn, event, label\)/.test(actions));
  check('jumpToCritical als Global exportiert', /Object\.assign\(window, \{[\s\S]*?jumpToCritical[\s\S]*?\}\)/.test(actions));
  check('stopPropagation (Header klappt nicht zu)', /function jumpToCritical[\s\S]{0,200}event\.stopPropagation\(\)/.test(actions));
  check('Quelle wird über toggleSource aufgeklappt (Zustand bleibt gemerkt)',
    /jumpToCritical[\s\S]{0,1600}toggleSource\(sourceGroup\.querySelector/.test(actions),
    'Der Abstand waechst mit jedem Zweig in jumpToCritical — der Aufruf selbst muss bleiben');
  check('springt auf .error-entry.sev-kritisch', /querySelector\('\.error-entry\.sev-kritisch'\)/.test(actions));

  check('.alarm-btn im Stylesheet', css.includes('.alarm-btn'));
  check('.file-group.has-kritisch schlägt .file-group-newest (2 Klassen)', css.includes('.file-group.has-kritisch'));
  check('has-kritisch-Regel steht NACH file-group-newest',
    css.indexOf('.file-group.has-kritisch') > css.indexOf('.file-group-newest'),
    'Bei gleicher Spezifität entscheidet die Reihenfolge — hier ist sie höher, aber die Reihenfolge bleibt die sichere Variante');
  check('kein !important nötig', !/\.file-group\.has-kritisch[^}]*!important/.test(css));
  check('.jump-flash vorhanden', css.includes('.jump-flash'));
  check('keine Dauer-Animation am Alarmknopf', !/\.alarm-btn[^}]*animation:/.test(css),
    'renderAll() baut das HTML staendig neu — eine Animation wuerde dauernd neu starten');
}

console.log(failed === 0 ? '\n✅ Verdrahtung vollstaendig\n' : `\n❌ ${failed} Problem(e)\n`);
process.exit(failed === 0 ? 0 : 1);
