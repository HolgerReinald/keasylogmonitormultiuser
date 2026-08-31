// Statische Pruefung: die Tab-Tabelle im README-Abschnitt "Konfiguration"
// gegen die tatsaechlichen Tabs in index.html.
//
// Anlass: die Tabelle war ueber Monate unbemerkt verrottet — sie nannte neun
// Tabs statt zwoelf, fuehrte "WatchPaths" (heisst laengst "Monitor") und einen
// Tab "Log-Analyse", den es dort nie gab (eigenes Panel), und es fehlten
// Regeln, Historie, Weitergabe und Benutzer. Solche Abweichungen faellt beim
// Lesen niemandem auf, weil beide Seiten fuer sich plausibel aussehen.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let failed = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const bad = (name, detail) => { console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); failed++; };
const check = (name, cond, detail) => cond ? ok(name) : bad(name, detail);

const html = read('public/index.html');
const readme = read('README.md');

// --- Ist-Zustand aus dem Markup ---
const uiTabs = [...html.matchAll(
  /<button class="config-tab[^"]*"[^>]*onclick="switchConfigTab\('([^']+)'\)"([^>]*)>([^<]+)<\/button>/g
)].map(m => ({
  key: m[1],
  label: m[3].trim(),
  adminOnly: /data-admin-only/.test(m[2])
}));

// --- Soll-Zustand aus der README-Tabelle im Abschnitt "Konfiguration" ---
// Begrenzt auf den Abschnitt, damit Tabellen anderer Abschnitte (und die
// Historie, die alte Zustaende beschreibt) nicht mitgelesen werden.
const kStart = readme.indexOf('\n## Konfiguration\n');
const kEnd = readme.indexOf('\n## ', kStart + 5);
const konfig = readme.slice(kStart, kEnd === -1 ? readme.length : kEnd);
const docTabs = [...konfig.matchAll(/^\| \*\*([^*]+)\*\*( 🔒)? \|/gm)].map(m => ({
  label: m[1].trim(),
  adminOnly: !!m[2]
}));

console.log('\n1) Tabelle gefunden');
check('Abschnitt "Konfiguration" vorhanden', kStart > -1);
check(`${docTabs.length} Zeilen in der Tab-Tabelle`, docTabs.length > 0,
  'Format erwartet: | **⚙️ Allgemein** | … |  (🔒 hinter dem Namen fuer Admin-Tabs)');

console.log('\n2) Gleiche Tabs, gleiche Reihenfolge');
{
  const uiNames = uiTabs.map(t => t.label);
  const docNames = docTabs.map(t => t.label);
  check(`Anzahl stimmt (${uiNames.length})`, uiNames.length === docNames.length,
    `index.html: ${uiNames.length}, README: ${docNames.length}`);

  const missing = uiNames.filter(n => !docNames.includes(n));
  const extra = docNames.filter(n => !uiNames.includes(n));
  check('kein Tab fehlt in der Doku', missing.length === 0, 'fehlt: ' + missing.join(', '));
  check('kein Tab in der Doku, den es nicht gibt', extra.length === 0, 'ueberzaehlig: ' + extra.join(', '));

  const sameOrder = uiNames.length === docNames.length && uiNames.every((n, i) => n === docNames[i]);
  check('Reihenfolge wie im Panel', sameOrder,
    'Die Tabelle sagt "in der Reihenfolge, in der sie dort stehen" — dann muss sie es auch tun.\n' +
    '       Panel:  ' + uiNames.join(' · ') + '\n' +
    '       README: ' + docNames.join(' · '));
}

console.log('\n3) Admin-Kennzeichnung stimmt');
for (const t of uiTabs) {
  const d = docTabs.find(x => x.label === t.label);
  if (!d) continue;
  check(`${t.label}${t.adminOnly ? ' 🔒' : ''}`, d.adminOnly === t.adminOnly,
    t.adminOnly
      ? 'Tab traegt data-admin-only, in der Doku fehlt das 🔒'
      : 'Doku sagt 🔒, das Markup hat kein data-admin-only');
}

console.log('\n4) Log-Analyse wird nicht als Tab dieses Panels behauptet');
{
  check('kein Tab-Knopf fuer die Analyse', !html.includes("switchConfigTab('analyze')"),
    'Die Analyse hat ein eigenes Panel (toggleAnalyzePanel), keinen Tab');
  check('Doku stellt das klar', /Log-Analyse ist kein Tab/i.test(konfig),
    'Der Hinweis verhindert, dass die Zeile wieder in die Tabelle wandert');
}

console.log('\n5) Wegbeschreibungen zeigen auf Tabs, die es gibt');
{
  // Saetze der Form "Einstellungen → Monitor → Polling" sind Anweisungen fuer
  // heute. Der Abschnitt Historie ist ausgenommen: dort beschreiben sie einen
  // damaligen Zustand und waren korrekt, als sie geschrieben wurden.
  const hS = readme.indexOf('\n## Historie\n');
  const hE = readme.indexOf('\n## ', hS + 5);
  const current = readme.slice(0, hS) + (hE === -1 ? '' : readme.slice(hE));
  const bare = uiTabs.map(t => t.label.replace(/^[^\wÄÖÜäöüß]+\s*/, ''));

  const paths = [...current.matchAll(/Einstellungen\s*→\s*([A-Za-zÄÖÜäöüß\- ]+)/g)]
    .map(m => m[1].trim().split(/\s+→|\s{2,}/)[0].trim());
  check(`${paths.length} Wegbeschreibung(en) gefunden`, paths.length > 0);
  for (const p of paths) {
    const hit = bare.some(l => l === p || p.startsWith(l) || l.startsWith(p));
    check(`"Einstellungen → ${p}"`, hit,
      'Kein Tab dieses Namens. Vorhanden: ' + bare.join(' · '));
  }
}

console.log('\n6) Bedienelemente des Analyse-Panels stehen in der Doku');
{
  // Anlass: der Abschnitt "Log-Analyse" beschrieb monatelang nur Pfade,
  // Streaming und Limit -- waehrend Datei-Ablage, Import, Ordner-Uebergabe und
  // die Gap-Warnung dazugekommen waren. Die Historie hatte jeden Zubau brav
  // vermerkt, die Doku wusste von keinem. Dieselbe Verrottung wie bei der
  // Tab-Tabelle (siehe Kopf dieser Datei), nur eine Stelle weiter.
  //
  // Mechanik: JEDER Knopf im Panel muss entweder in der Doku vorkommen oder
  // hier begruendet ausgenommen sein. So kann auch ein NEUER Knopf nicht
  // unbemerkt durchrutschen -- er steht in keiner der beiden Listen.
  const pStart = html.indexOf('id="analyzePanel"');
  const pEnd = html.indexOf('id="configPanel"');
  const panel = html.slice(pStart, pEnd === -1 ? html.length : pEnd);
  check('Analyse-Panel im Markup gefunden', pStart !== -1 && panel.length > 500);

  // Doku-Abschnitt ohne Historie: er endet an der naechsten h2.
  const dStart = readme.indexOf('Log-Analyse (einmalige Auswertung)');
  const dEnd = readme.indexOf('\n## ', dStart + 5);
  const doku = readme.slice(dStart, dEnd === -1 ? readme.length : dEnd);
  check('Doku-Abschnitt "Log-Analyse" gefunden', dStart !== -1 && doku.length > 500);

  // Bewusst nicht in der Doku -- mit Grund, sonst ist die Ausnahme wertlos.
  const AUSGENOMMEN = {
    'Importieren': 'Knopf im Import-Bereich, dessen Zweck dort beschrieben ist'
  };

  const buttons = [...panel.matchAll(/<button[^>]*>([^<]+)<\/button>/g)]
    .map(m => m[1].trim())
    .filter(t => t.length > 0);
  check(buttons.length + ' Knoepfe im Panel gefunden', buttons.length >= 8);

  for (const label of buttons) {
    // Wortteil pruefen: Emoji-Varianten (mit/ohne Variantenselektor) sind
    // unsichtbar verschieden codiert, der Text dahinter nicht.
    const wort = label.replace(/^[^\wAEIOUaeiouÄÖÜäöüß]+/, '').trim();
    if (!wort) { ok('"' + label + '" ist ein reiner Symbol-Knopf (kein Text zu pruefen)'); continue; }
    if (AUSGENOMMEN[wort] !== undefined) {
      ok('"' + wort + '" bewusst ausgenommen (' + AUSGENOMMEN[wort] + ')');
      continue;
    }
    check('"' + label + '" in der Doku erwaehnt', doku.includes(wort),
      '"' + wort + '" kommt im Abschnitt "Log-Analyse" nicht vor. Entweder dort ' +
      'beschreiben oder in AUSGENOMMEN dieses Tests begruenden.');
  }

  // Die Zahlenfelder: ihr Label im Panel muss auch in der Doku stehen.
  for (const id of ['analyzeMaxErrors', 'analyzeGapWarnSeconds', 'analyzeGapIdleMinutes']) {
    const re = new RegExp('<label[^>]*>([^<]+)</label>\\s*<input[^>]*id="' + id + '"');
    const m = panel.match(re);
    if (!m) { bad('Label zu #' + id + ' im Panel gefunden', 'Markup umgebaut?'); continue; }
    // Ohne Doppelpunkt und ohne Klammerzusatz wie "(Sek., 0 = aus)": die Doku
    // formuliert freier, der Feldname selbst muss wiedererkennbar bleiben.
    const kern = m[1].replace(/:\s*$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    check('Feld "' + kern + '" in der Doku erwaehnt', doku.includes(kern),
      'Das Feld heisst im Panel "' + kern + '", der Doku-Abschnitt nennt es nicht.');
  }
}

console.log('\n7) Der neueste Historie-Eintrag nennt die geaenderten Dateien');
{
  // 92 von 109 Eintraegen enden mit einer Zeile "**Dateien:**" -- bei den
  // letzten drei war das eingeschlafen, weil die Konvention nirgends stand.
  // Geprueft wird nur der NEUESTE Eintrag: die Historie wird nicht rueckwirkend
  // umgeschrieben, aber ein neuer Eintrag soll die Zeile nicht vergessen.
  const hStart = readme.indexOf('\n## Historie\n');
  const hEnd = readme.indexOf('\n## ', hStart + 5);
  const historie = readme.slice(hStart, hEnd === -1 ? readme.length : hEnd);

  const ersterEintrag = historie.indexOf('\n### ');
  const zweiterEintrag = historie.indexOf('\n### ', ersterEintrag + 5);
  const neuester = historie.slice(ersterEintrag, zweiterEintrag === -1 ? historie.length : zweiterEintrag);

  const titel = (neuester.split('\n')[1] || '').replace(/^### /, '').slice(0, 60);
  check('neuesten Historie-Eintrag gefunden', neuester.length > 100, 'Abschnitt Historie umgebaut?');
  check(`"${titel}" nennt seine Dateien`, /\n\*\*Dateien:\*\* \S/.test(neuester),
    'Am Ende des Eintrags fehlt die Zeile "**Dateien:** pfad/a.js, pfad/b.js" ' +
    '-- sie macht nachvollziehbar, was der Eintrag angefasst hat.');
}

console.log(failed === 0 ? '\n✅ Doku und Oberflaeche stimmen ueberein\n' : `\n❌ ${failed} Problem(e)\n`);
process.exit(failed === 0 ? 0 : 1);
