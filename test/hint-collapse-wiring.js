// Statische Verdrahtungs-Pruefung der einklappbaren Hinweistexte (kein Server
// noetig). Faengt genau die Fehlerklasse, die hier realistisch ist: ein
// Inline-onclick auf eine Funktion, die nicht als window-Global steht, ein
// data-hint ohne Gegenstueck im CSS, und ein Hinweistext, der nach dem Umbau
// ausserhalb des einklappbaren Containers haengengeblieben ist (dann waere er
// dauerhaft sichtbar und der Umbau haette nichts gebracht).
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
const cfg = read('public/js/configPanel.js');
const state = read('public/js/state.js');
const boot = read('public/js/boot.js');

const KEYS = ['filter', 'exclude', 'threshold', 'priority'];

console.log('\n1) Jede Regel-Karte hat einen einklappbaren Hinweisblock');
for (const key of KEYS) {
  check(`data-hint="${key}"`, html.includes(`data-hint="${key}"`),
    `Der Hinweisblock der Karte "${key}" fehlt in index.html`);
  check(`toggleHint('${key}') verdrahtet`, html.includes(`toggleHint('${key}')`),
    'Ohne onclick klappt die Zeile nicht auf');
}

console.log('\n2) Kein Hinweistext der Regel-Karten haengt ausserhalb des Containers');
{
  // Ein .config-hint-text ohne umschliessendes .config-hint bleibt dauerhaft
  // sichtbar — dann haette der Umbau fuer diese Karte nichts gebracht.
  const tab = (html.match(/<div class="config-section" id="config-monitorsettings">[\s\S]*?\n    <\/div>/) || [''])[0];
  check('Tab-Abschnitt gefunden', tab.length > 0, 'id="config-monitorsettings" nicht gefunden');

  const cards = tab.split('<div class="config-filter-section').slice(1);
  check(`${cards.length} Karten im Tab`, cards.length === 5,
    'Erwartet: vier Regel-Karten plus Copilot-Export');

  for (const card of cards) {
    const title = (card.match(/config-column-title">([^<]*)</) || [, '?'])[1].trim();
    const hints = (card.match(/<p class="config-hint-text">/g) || []).length;
    const inside = /<div class="config-hint" data-hint="[^"]+">[\s\S]*?<p class="config-hint-text">/.test(card);
    // Copilot-Export ist die bewusste Ausnahme: ein einzelner kurzer Satz in
    // einer Karte ueber die volle Breite — er kostet eine Zeile, kein Absatz.
    if (/Copilot/.test(title)) {
      check(`"${title}" bewusst ohne Einklapper`, hints === 1 && !inside,
        'Ein Satz rechtfertigt kein Bedienelement');
    } else {
      check(`"${title}" Hinweis liegt im .config-hint`, hints === 1 && inside,
        'Ohne umschliessendes .config-hint bleibt der Text immer sichtbar');
    }
  }
}

console.log('\n3) Inline-onclick ist als window-Global registriert');
{
  const globals = (cfg.match(/Object\.assign\(window, \{([\s\S]*?)\}\)/) || [, ''])[1];
  check('toggleHint exportiert', /\btoggleHint\b/.test(globals),
    'toggleHint fehlt in Object.assign(window, {...}) von configPanel.js');
  const ns = (cfg.match(/window\.Keasy\.config = \{([\s\S]*?)\};/) || [, ''])[1];
  check('applyAllHints im Namespace', /\bapplyAllHints\b/.test(ns),
    'boot.js ruft Keasy.config.applyAllHints() auf');
  check('boot.js wendet den Zustand an', /Keasy\.config\.applyAllHints\(\)/.test(boot),
    'Ohne Aufruf starten gemerkt-offene Karten trotzdem zugeklappt');
}

console.log('\n4) Zustand wird gemerkt, Vorgabe ist eingeklappt');
{
  check('hintsOpen im State', /hintsOpen:\s*JSON\.parse\(localStorage\.getItem\('keasy-hints-open'\)/.test(state),
    'Der Auf-/Zu-Zustand muss den Reload ueberleben');
  check('Vorgabe ist leer = alles zu', /'keasy-hints-open'\) \|\| '\{\}'/.test(state),
    'Nur offene Karten werden gespeichert — sonst braucht die Vorgabe einen Sonderfall');
  check('Schreiben ist gegen privaten Modus abgesichert',
    /function persistHints\(\)[\s\S]{0,200}catch/.test(cfg),
    'localStorage.setItem wirft im privaten Modus');
  check('Zuklappen loescht den Schluessel',
    /if \(state\.hintsOpen\[key\]\) delete state\.hintsOpen\[key\]/.test(cfg),
    'Sonst waechst der gespeicherte Eintrag mit jedem Umschalten');
}

console.log('\n5) Verstecken macht CSS, nicht JS — ein Zustand, kein zweiter');
{
  check('.config-hint .config-hint-text ist versteckt',
    /\.config-hint \.config-hint-text\s*\{[^}]*display:\s*none/.test(css),
    'Ohne CSS-Vorgabe blitzt der volle Text auf, bevor das JS laeuft');
  check('.is-open zeigt ihn wieder',
    /\.config-hint\.is-open \.config-hint-text\s*\{[^}]*display:\s*block/.test(css));
  check('kein style.display im JS', !/hint[\s\S]{0,80}style\.display/i.test(cfg),
    'Zwei Zustaende (Klasse + Inline-Style) laufen auseinander');
  check('Pfeil dreht sich ueber die Klasse',
    /\.config-hint\.is-open \.hint-chevron\s*\{[^}]*rotate/.test(css));
}

console.log('\n6) Die Beschriftung sagt, was drinsteht');
{
  // Der Sinn der Variante: eingeklappt traegt die Zeile noch Information.
  // Ein nacktes ℹ️ waere ein Bedienelement, das man suchen muss.
  const labels = [...html.matchAll(/class="config-hint-toggle"[^>]*>([\s\S]*?)<\/button>/g)]
    .map(m => m[1].replace(/<[^>]+>/g, '').replace(/[▸▾]/g, '').trim());
  check(`${labels.length} Beschriftungen gefunden`, labels.length === KEYS.length);
  for (const l of labels) {
    check(`"${l}" ist beschriftet`, l.replace(/[^\wÄÖÜäöüß]/g, '').length >= 6,
      'Eine Zeile ohne Text ist ein Symbol, das man deuten muss');
  }
  check('Warnung steht schon eingeklappt da',
    /class="config-hint-toggle"[^>]*>[\s\S]{0,120}kompletten[\s\S]{0,40}<\/button>/.test(html),
    'Bei den Ausschluss-Patterns ist die Warnung der Grund fuer die Beschriftung');
}

console.log(failed === 0 ? '\n✅ Verdrahtung vollstaendig\n' : `\n❌ ${failed} Problem(e)\n`);
process.exit(failed === 0 ? 0 : 1);
