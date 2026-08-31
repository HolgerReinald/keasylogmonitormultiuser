// Statische Verdrahtungs-Pruefung des Analyse-Sammelblocks (QuickWin B).
//
// Anlass: die Analyse-Ergebnisse hingen als gleichrangige Quellgruppen HINTER
// den Live-Quellen. Bei einem Ordner-Lauf ueber mehrere Unterordner standen dort
// schnell ein Dutzend Gruppen, und die Analyse war immer die letzte -- also die,
// fuer die man am weitesten scrollen musste, obwohl man sie gerade angefordert
// hatte. Jetzt liegen sie gebuendelt in einem Sammelblock darueber.
//
// Geprueft werden die Stellen, an denen das im Browser stillschweigend kaputt
// waere -- in Node ist das Verhalten selbst nicht nachstellbar (kein DOM):
//   1. der Block wird VOR die Live-Gruppen gesetzt (html = wrap + html)
//   2. der Klapp-Zustand nutzt das invertierte Muster (Standard: zu)
//   3. "Alle zu/auf" und der Knopf-Zustand kennen den Block
//   4. der Alarmknopf im Kopf ist kein Blindgaenger
//   5. die CSS-Klassen existieren, insbesondere .analyze-wrap-body.collapsed --
//      toggleSource() schaltet 'collapsed', ohne die Regel bliebe der Block
//      sichtbar und der Klick waere wirkungslos
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
const css = read('public/style.css');

console.log('\n1) Der Sammelblock steht vor den Live-Gruppen');
{
  check('Analyse-HTML wird gesammelt statt direkt angehaengt',
    /let analyzeHtml = '';/.test(render) && /analyzeHtml \+= `/.test(render),
    'Ohne eigene Variable landet die Analyse wieder im Fluss hinter den Live-Gruppen');
  check('kein "html +=" mehr im Analyse-Block',
    !/html \+= `\s*\n\s*<div class="source-group analyze-source">/.test(render));
  check('Block wird vorangestellt (wrap + html)', /<\/div>`\s*\+ html;/.test(render),
    'Steht der Block nicht vorne, ist das ganze Feature wirkungslos');
}

console.log('\n2) Klapp-Zustand: Standard zu, Suche klappt auf');
{
  check('Schluessel als Konstante', /const ANALYZE_WRAP_KEY = 'analyze-wrap';/.test(render),
    'Der Schluessel taucht in Markup, onclick und Zustandsabfrage auf -- ein ' +
    'Tippfehler dort fuehrt zu einem Block, der seinen Zustand vergisst');
  check('invertiertes Muster: !== false (Standard zugeklappt)',
    /collapsedSources\[ANALYZE_WRAP_KEY\] !== false/.test(render),
    'Mit "=== true" waere der Block standardmaessig offen -- das Gegenteil der Absicht');
  check('bei aktiver Suche offen', /state\.searchTerm \? false :/.test(render),
    'Sonst sucht man in einem zugeklappten Block, der nichts anzeigt');
  check('data-collapse-key im Kopf', /class="analyze-wrap-head" data-collapse-key=/.test(render));
  check('onclick ruft toggleSource', /onclick="toggleSource\(this, '\$\{escapeJs\(ANALYZE_WRAP_KEY\)\}'\)"/.test(render),
    'Eigener Handler waere ein zweiter Weg fuer dasselbe -- toggleSource merkt sich den Zustand bereits');
}

console.log('\n3) "Alle zu/auf" nimmt den Block mit');
{
  const treffer = actions.match(/\.source-header\[data-collapse-key\], \.analyze-wrap-head\[data-collapse-key\]/g) || [];
  check('beide Selektoren erweitert (toggleAllSources + updateCollapseAllButton)',
    treffer.length === 2, 'gefunden: ' + treffer.length + ' von 2 -- bleibt einer alt, ' +
    'klappt alles zu und der Analyse-Block steht offen daneben');
}

console.log('\n4) Der Alarmknopf im Kopf springt wirklich');
{
  // Der Knopf sitzt ausserhalb der .source-group; ohne eigenen Zweig liefert
  // closest('.source-group') null und jumpToCritical steigt still aus.
  check('jumpToCritical kennt den Sammelblock-Kopf',
    /btn\.closest\('\.analyze-wrap-head'\)/.test(actions),
    'Ohne diesen Zweig ist der Alarmknopf im Kopf ein Blindgaenger: ' +
    "closest('.source-group') findet vom Kopf aus nichts");
  check('sucht die kritische Datei im Block',
    /body\.querySelector\('\.file-group\.has-kritisch'\)/.test(actions));

  // Das Sichtbarmachen sitzt in focusEntry, der gemeinsamen Endstelle aller
  // Spruenge -- damit gilt es auch fuer den Klick im Fehler-Index. Ohne das
  // springt man bei zugeklapptem Block in ein display:none-Element und es
  // passiert scheinbar nichts (so gebaut und beim Testen aufgefallen).
  check('expandAnalyzeWrap vorhanden', /function expandAnalyzeWrap\(target\)/.test(actions));
  check('von focusEntry aufgerufen (deckt auch den Index-Sprung)',
    /function focusEntry\(target\)[\s\S]{0,200}expandAnalyzeWrap\(target\)/.test(actions),
    'In den einzelnen Aufrufern statt hier waere es beim naechsten Sprungweg wieder vergessen');
  check('klappt ueber toggleSource auf (Zustand bleibt gemerkt)',
    /function expandAnalyzeWrap[\s\S]{0,400}toggleSource\(head, head\.dataset\.collapseKey\)/.test(actions),
    'Direkt am DOM gedreht waere der Zustand nach dem naechsten renderAll wieder weg');
}

console.log('\n5) CSS ist vorhanden');
{
  for (const klasse of ['.analyze-wrap', '.analyze-wrap-head', '.analyze-wrap-title',
                        '.analyze-wrap-meta', '.analyze-wrap-body']) {
    check(`${klasse} definiert`, new RegExp('\\' + klasse + '\\s*\\{').test(css));
  }
  check('.analyze-wrap-body.collapsed blendet aus',
    /\.analyze-wrap-body\.collapsed\s*\{[^}]*display:\s*none/.test(css),
    'toggleSource schaltet die Klasse "collapsed" -- ohne diese Regel bleibt ' +
    'der Block sichtbar und der Klick wirkungslos');
}

console.log(failed === 0 ? '\n✅ Sammelblock ist korrekt verdrahtet\n' : `\n❌ ${failed} Problem(e)\n`);
process.exit(failed === 0 ? 0 : 1);
