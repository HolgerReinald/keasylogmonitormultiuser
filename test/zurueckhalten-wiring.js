// Statische Verdrahtungs-Pruefung: neue Eintraege zurueckhalten (Stufe 3a+3c).
//
// Solange der Anwender nicht ganz oben steht, wird bei eingehenden Eintraegen
// nicht mehr aufgebaut — eine Pille sammelt sie, der Klick baut ein.
//
// Geprueft werden die Stellen, an denen das im Browser stillschweigend kaputt
// waere — in Node ist das Verhalten selbst nicht nachstellbar (kein DOM):
//   1. NUR der Empfangspfad wird zurueckgehalten (sonst wirkt kein Filter mehr)
//   2. der Zaehler wird in renderAll() selbst zurueckgesetzt, vor dem ersten
//      return — sonst bleibt die Pille im Leerzustand stehen oder luegt
//   3. Anker und Zurueckhalten benutzen DIESELBE Schwelle
//   4. der Scroll-Listener haengt einmal am Start, nicht in renderAll()
//   5. die Pille ist fixiert — im Seitenfluss wuerde sie alles verschieben
//   6. ⏸️ Pause hat Vorrang
//   7. der Schalter merkt sich seinen Zustand und baut beim Abschalten ein
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let failed = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const bad = (name, detail) => { console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); failed++; };
const check = (name, cond, detail) => cond ? ok(name) : bad(name, detail);

const ws = read('public/js/wsClient.js');
const render = read('public/js/render.js');
const actions = read('public/js/actions.js');
const boot = read('public/js/boot.js');
const stateJs = read('public/js/state.js');
const html = read('public/index.html');
const css = read('public/style.css');

// Rumpf eines WS-Zweigs herausschneiden
function zweig(typ) {
  const i = ws.indexOf(`msg.type === '${typ}'`);
  if (i === -1) return '';
  const rest = ws.slice(i);
  const j = rest.indexOf('} else if (msg.type ===');
  return rest.slice(0, j === -1 ? rest.length : j);
}

console.log('\n1) Nur der Empfangspfad wird zurueckgehalten');
{
  check('scheduleRenderForNewEntry existiert', /function scheduleRenderForNewEntry\(art, gedrosselt\)/.test(ws));

  const fehler = zweig('error');
  check('Fehler-Empfang geht darueber', /scheduleRenderForNewEntry\(/.test(fehler));
  check('Fehler-Empfang ruft scheduleRender NICHT direkt', !/\bscheduleRender\(\)/.test(fehler),
    'Ein direkter Aufruf umgeht das Zurueckhalten stillschweigend');
  check('kritisch wird unterschieden', /entryLevel\(error\) === 'kritisch'/.test(fehler));

  const perf = zweig('performance');
  check('⏱️-Empfang geht darueber', /scheduleRenderForNewEntry\('gap', true\)/.test(perf));
  check('⏱️-Empfang ruft schedulePerformanceRender NICHT direkt',
    !/schedulePerformanceRender\(\)/.test(perf),
    'Durch die 300-ms-Drossel zu zaehlen macht aus mehreren Luecken eine einzige');

  // Alles andere ist vom Anwender ausgeloest und muss sofort wirken.
  check('Filter/Suche/Analyse bleiben unangetastet',
    (ws.match(/scheduleRenderForNewEntry\(/g) || []).length === 3,
    'gefunden: ' + (ws.match(/scheduleRenderForNewEntry\(/g) || []).length +
    ' — erwartet 3 (Definition + zwei Empfangspfade)');

  check('Benachrichtigung geht trotzdem sofort raus',
    /scheduleRenderForNewEntry[\s\S]{0,300}notifyNewError\(/.test(fehler),
    'Wer nicht hinsieht, soll vom Fehler trotzdem erfahren');
}

console.log('\n2) Der Zaehler wird in renderAll() selbst zurueckgesetzt');
{
  const r = render.slice(render.indexOf('function renderAll()'));
  const bisReturn = r.slice(0, r.indexOf('return;'));
  check('Reset steht in renderAll', /state\.pendingNew = \{ errors: 0, gaps: 0, critical: 0 \};/.test(r));
  check('Reset steht VOR dem ersten return',
    /state\.pendingNew = \{ errors: 0/.test(bisReturn),
    'Sonst bleibt die Pille im Leerzustand ("Keine Fehler") stehen');
  check('Pille wird gleich mit neu gezeichnet', /state\.pendingNew = \{[^}]*\};\s*\n\s*renderPendingPill\(\);/.test(r));

  // Der Reset gehoert NICHT in den Klick-Handler: dort wuerde ihn jeder andere
  // Weg (Filter, Suche, Loeschen) umgehen und die Pille bliebe als Luege stehen.
  check('kein zweiter Reset im Klick-Handler',
    /function neueEintraegeAnzeigen\(\)\s*\{\s*renderAll\(\);\s*\}/.test(actions),
    'Der Klick soll nichts weiter tun als aufbauen — renderAll raeumt selbst auf');
}

console.log('\n3) Anker und Zurueckhalten fragen dieselbe Schwelle');
{
  check('liestGeradeOben() als eigene Funktion', /function liestGeradeOben\(\)/.test(render));
  check('der Anker benutzt sie', /function captureViewAnchor\(\)[\s\S]{0,200}if \(liestGeradeOben\(\)\) return null;/.test(render),
    'Eine eigene Schwelle im Anker liefe mit der des Zurueckhaltens auseinander');
  check('das Zurueckhalten benutzt sie', /Keasy\.render\.liestGeradeOben\(\)/.test(ws));
  check('der Scroll-Listener benutzt sie', /Keasy\.render\.liestGeradeOben\(\)/.test(boot));
  check('nur EINE Schwellenzahl im Code',
    (render.match(/window\.scrollY <= 4/g) || []).length === 1,
    'gefunden: ' + (render.match(/window\.scrollY <= 4/g) || []).length + ' — die Zahl gehoert an genau eine Stelle');
  check('wird exportiert', /renderPendingPill, liestGeradeOben \}/.test(render));
}

console.log('\n4) Der Scroll-Listener haengt einmal am Start');
{
  check('in boot.js gesetzt', /window\.addEventListener\('scroll'/.test(boot));
  check('NICHT in render.js', !/addEventListener\('scroll'/.test(render),
    'In renderAll() gesetzt haenge er sich bei jedem Aufbau erneut an');
  check('ueber rAF gedrosselt', /addEventListener\('scroll'[\s\S]{0,400}requestAnimationFrame/.test(boot),
    'scroll feuert sonst dutzendfach pro Sekunde');
  check('passive: true', /addEventListener\('scroll'[\s\S]{0,600}\{ passive: true \}/.test(boot));
  check('baut nur ein, wenn etwas anliegt',
    /addEventListener\('scroll'[\s\S]{0,600}p\.errors > 0 \|\| p\.gaps > 0/.test(boot));
}

console.log('\n5) Die Pille verschiebt nichts');
{
  check('#neuHost im Markup', /<div id="neuHost" aria-live="polite">/.test(html));
  check('steht vor der Anzeige', html.indexOf('id="neuHost"') < html.indexOf('id="appMain"'));
  check('#neuHost ist fixiert', /#neuHost \{[^}]*position: fixed/.test(css),
    'Im Seitenfluss wuerde die Pille beim Erscheinen alles nach unten druecken — das Gegenteil der Absicht');
  check('unter Dialogen und Toasts', /#neuHost \{[^}]*z-index: 120/.test(css));
  check('.neu-pille ist bedienbar (pointer-events)', /\.neu-pille \{[^}]*pointer-events: auto/.test(css),
    'Der Host ist pointer-events: none, damit er nichts blockiert — die Pille muss es zuruecknehmen');
  check('Host blockiert nichts', /#neuHost \{[^}]*pointer-events: none/.test(css));
  check('kritisch faerbt', /\.neu-pille\.is-kritisch \{[^}]*var\(--sev-critical\)/.test(css));

  // Kritisch faerbt, bricht aber nicht durch.
  check('kritisch baut NICHT sofort auf',
    !/critical[\s\S]{0,120}scheduleRender\(\)/.test(ws),
    'Ein kritischer Fehler, der die Ansicht umbaut, ist genau die Stoerung, um die es hier geht');
  check('⏱️-Luecken heissen nicht "Fehler"', /neue Lücke|neue Lücken/.test(render),
    'Luecken sind keine Fehler und duerfen in der Pille nicht so aussehen');
}

console.log('\n6) ⏸️ Pause hat Vorrang');
{
  const fehler = zweig('error');
  const perf = zweig('performance');
  check('Fehler: Zaehlen nur ausserhalb der Pause', /if \(!state\.paused\) \{[\s\S]{0,200}scheduleRenderForNewEntry/.test(fehler));
  check('⏱️: Zaehlen nur ausserhalb der Pause', /if \(!state\.paused\) scheduleRenderForNewEntry/.test(perf));
}

console.log('\n7) Der Schalter (Stufe 3c)');
{
  check('Knopf in der Werkzeugleiste', /id="holdToggle" onclick="toggleHoldNewErrors\(\)"/.test(html));
  check('steht bei den anderen persoenlichen Schaltern',
    html.indexOf('id="indexToggleBtn"') < html.indexOf('id="holdToggle"') &&
    html.indexOf('id="holdToggle"') < html.indexOf('id="searchInput"'));
  check('Zustand im localStorage wie 🔔 und 🧭',
    /holdNewErrors: localStorage\.getItem\('keasy-hold-new'\) !== 'off'/.test(stateJs),
    'Vorgabe an: ohne gespeicherte Abweichung wird festgehalten');
  check('Umschalten speichert', /localStorage\.setItem\('keasy-hold-new'/.test(actions));
  check('Knopfzustand wird beim Start gesetzt', /updateHoldButton\(\);/.test(boot));

  // Die Zeile, die man beim Nachruesten vergisst.
  check('Abschalten baut SOFORT ein',
    /function toggleHoldNewErrors[\s\S]{0,700}if \(!state\.holdNewErrors && \(p\.errors > 0 \|\| p\.gaps > 0\)\) renderAll\(\);/.test(actions),
    'Sonst verschwindet die Pille und die gesammelten Eintraege blieben unsichtbar bis zum naechsten Ereignis');
  check('abgeschaltet wird nicht zurueckgehalten',
    /if \(!state\.holdNewErrors \|\| Keasy\.render\.liestGeradeOben\(\)\)/.test(ws));
  check('Inline-onclick sind window-Globals (Datei liegt in einer IIFE)',
    /Object\.assign\(window, \{[\s\S]{0,900}neueEintraegeAnzeigen, toggleHoldNewErrors, updateHoldButton/.test(actions),
    'Ohne window-Global tut der Klick auf Pille und Schalter nichts');
}

console.log(failed === 0 ? '\n✅ Zurueckhalten ist korrekt verdrahtet\n' : `\n❌ ${failed} Problem(e)\n`);
process.exit(failed === 0 ? 0 : 1);
