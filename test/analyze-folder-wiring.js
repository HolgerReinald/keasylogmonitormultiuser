// Statische Verdrahtungs-Pruefung der Ordner-Uebergabe (kein Server noetig).
// Faengt die Fehlerklassen, die hier realistisch sind: ein Inline-onclick auf
// eine Funktion, die in der IIFE steckt und nicht als window-Global steht; ein
// verstecktes Feld ohne webkitdirectory (der Browser oeffnet dann stumm eine
// Dateiauswahl); eine fehlende Obergrenze; und die stille Abweisung, die
// versehentlich auch fuer einzeln abgelegte Dateien gilt.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let failed = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const bad = (name, detail) => { console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); failed++; };
const check = (name, cond, detail) => cond ? ok(name) : bad(name, detail);

const html = read('public/index.html');
const js = read('public/js/analyzePanel.js');
const css = read('public/style.css');
const state = read('public/js/state.js');

console.log('\n1) Einstieg: eigener Knopf, nicht in der Ablageflaeche');
{
  check('Knopf "📁 Ordner" vorhanden', /pickAnalyzeLogFolder\(\)[^>]*>📁 Ordner</.test(html),
    'Der Einstieg wurde als eigener Knopf beschlossen, nicht als zweite Zeile im Drop-Bereich');
  check('Knopf steht neben dem Import-Knopf',
    html.indexOf('toggleAnalyzeImport()') < html.indexOf('pickAnalyzeLogFolder()')
      && html.indexOf('pickAnalyzeLogFolder()') - html.indexOf('toggleAnalyzeImport()') < 400,
    'Beide gehoeren in dieselbe Knopfreihe');
  check('Ablageflaeche unveraendert (kein zweites Klickziel darin)',
    !/id="analyzeLogDrop"[\s\S]*?drop-or/.test(html),
    'Die Flaeche reagiert bereits auf Klick — ein zweites Ziel darin waere nicht sauber zu treffen');
}

console.log('\n2) Das versteckte Feld laeuft den Ordner ab');
{
  const inp = (html.match(/<input[^>]*id="analyzeLogFolderPicker"[^>]*>/) || [''])[0];
  check('Feld analyzeLogFolderPicker vorhanden', inp.length > 0, 'Ohne das Feld gibt es keine Ordnerauswahl');
  check('webkitdirectory gesetzt', /webkitdirectory/.test(inp),
    'Ohne webkitdirectory oeffnet der Browser stumm eine gewoehnliche Dateiauswahl');
  check('multiple gesetzt', /multiple/.test(inp), 'Sonst kommt nur eine Datei zurueck');
  check('versteckt', /display:\s*none/.test(inp), 'Das Feld wird ueber den Knopf ausgeloest');
  check('Datei-Picker daneben unveraendert', /id="analyzeLogPicker"[^>]*accept="\.log,\.json,\.zip"/.test(html),
    'Der Einzeldatei-Weg bleibt wie er war');
}

console.log('\n3) Inline-onclick sind window-Globals (die Datei liegt in einer IIFE)');
{
  const globals = (js.match(/Object\.assign\(window,\s*\{[\s\S]*?\}\)/) || [''])[0];
  ['pickAnalyzeLogFolder', 'toggleDroppedSkipped', 'dismissDroppedSkipped'].forEach(fn => {
    check(`${fn} als window-Global`, globals.includes(fn),
      'Ohne Object.assign(window, …) laeuft das Inline-onclick ins Leere');
    check(`${fn} im Namespace Keasy.analyze`, new RegExp('Keasy\\.analyze = \\{[\\s\\S]*?' + fn).test(js),
      'Namespace und window-Globals werden zusammen gepflegt');
  });
  check('pickAnalyzeLogFolder wird im HTML verwendet', html.includes('pickAnalyzeLogFolder()'), null);
  check('toggleDroppedSkipped wird im Render verwendet', js.includes('onclick="toggleDroppedSkipped()"'), null);
}

console.log('\n4) Ordner-Durchlauf hat eine Obergrenze');
{
  check('DROP_FOLDER_MAX definiert', /const DROP_FOLDER_MAX = \d+/.test(js), null);
  const max = parseInt((js.match(/const DROP_FOLDER_MAX = (\d+)/) || [, '0'])[1], 10);
  check(`Obergrenze ist ${max}`, max === 200, 'Beschlossen waren 200');
  check('Grenze wird beim Sammeln geprueft', /usable\.length >= DROP_FOLDER_MAX/.test(js),
    'Sonst laeuft ein versehentlich gewaehlter Downloads-Ordner ungebremst durch');
  check('Ueberzaehlige werden gemeldet, nicht verschluckt',
    /über der Obergrenze/.test(js), 'Stilles Abschneiden waere die schlechtere Variante');
  // Der Ordner-Block: alles zwischen "if (fromFolder) {" und dem Beginn des
  // Uploads. indexOf auf den blossen Namen taugt hier nicht — die Konstante
  // steht oben in der Datei und kommt damit immer zuerst.
  const folderBlock = (js.match(/if \(fromFolder\) \{[\s\S]*?state\.analyzeDroppedBusy = true;/) || [''])[0];
  check('Grenze steht im Ordner-Block', folderBlock.includes('DROP_FOLDER_MAX'),
    'Sie darf nur auf dem Ordner-Weg greifen');
  const singleBlock = (js.match(/if \(!fromFolder\) \{[\s\S]*?\n    \}/) || [''])[0];
  check('Einzeln abgelegte Dateien bleiben unbegrenzt', !singleBlock.includes('DROP_FOLDER_MAX'),
    'Wer vier Dateien zieht, soll keine Obergrenze spueren');
}

console.log('\n5) Abweisung: still im Ordner, laut beim Ablegen');
{
  check('dropSkipReason ist die eine Beurteilungsstelle', /function dropSkipReason/.test(js),
    'Beide Wege muessen nach denselben Regeln urteilen');
  check('Ordner-Fund landet in analyzeDroppedSkipped',
    /fromFolder[\s\S]{0,600}analyzeDroppedSkipped\.push/.test(js), null);
  check('Einzeln abgelegt landet in analyzeDroppedRejected',
    /if \(!fromFolder\)[\s\S]{0,300}analyzeDroppedRejected\.push/.test(js), null);
  check('Fehlgeschlagener Upload bleibt in beiden Faellen laut',
    /catch \(err\) \{\s*state\.analyzeDroppedRejected\.push/.test(js),
    '"ist kein Log" ist eine Auskunft, "ging schief" ist ein Problem');
  check('Zusammenfassung nennt eine Zahl',
    /Datei\$\{skipped\.length === 1 \? '' : 'en'\} im Ordner übersprungen/.test(js)
      || /skipped\.length \+ ' Datei/.test(js)
      || /\$\{skipped\.length\}/.test(js), null);
  check('Aufklapper vorhanden', /toggleDroppedSkipped/.test(js) && /aria-expanded/.test(js), null);
  check('CSS fuer die Zusammenfassungszeile', /\.dropped-skipped \{/.test(css), null);
  check('Aufklapper-Knopf hat einen Fokusring', /\.dropped-group \.link-btn:focus-visible/.test(css), null);
}

console.log('\n6) Namensfaltung');
{
  check('foldDroppedName vorhanden', /function foldDroppedName/.test(js), null);
  check('nutzt webkitRelativePath', /webkitRelativePath/.test(js),
    'Nur daraus ergibt sich der Ordnername');
  check('faltet den direkten Ordner mit Tilde', /parent \+ '~' \+ f\.name/.test(js),
    'Beschlossen: nur der direkte Ordner, Trenner ~');
  check('Datei ohne Relativpfad behaelt ihren Namen', /if \(!rel\) return f\.name/.test(js),
    'Einzeln abgelegte Dateien duerfen keinen Praefix bekommen');
  check('gefalteter Name geht in den Header', /'X-Filename': encodeURIComponent\(target\)/.test(js),
    'Sonst kommt der ungefaltete Name am Server an');
  check('Faltung nur beim Ordner-Weg', /const target = fromFolder \? foldDroppedName\(f\) : f\.name/.test(js), null);
}

console.log('\n7) State-Slots und Fortschritt');
{
  ['analyzeDroppedSkipped', 'analyzeDroppedSkippedOpen', 'analyzeDroppedProgress'].forEach(k => {
    check(`state.${k}`, new RegExp(k + ':').test(state), null);
  });
  check('Fortschritt zaehlt beim Ordner-Upload mit', /analyzeDroppedProgress = fromFolder \?/.test(js),
    '80 Uploads ohne Zaehler sehen aus wie ein Haenger');
  check('Fortschritt wird angezeigt', /übertrage \$\{p \?/.test(js), null);
  check('Alle entfernen raeumt auch die Zusammenfassung ab',
    /analyzeDroppedSkipped = \[\];[\s\S]{0,120}await loadDroppedFiles\(\)/.test(js),
    'Sonst bleibt die Zeile nach dem Leeren stehen');
}

console.log('\n8) Die Ablage wird auch ohne konfigurierten Pfad gezeichnet');
{
  // Der Fehler, der Variante A beim ersten Versuch wie tot aussehen liess:
  // renderAnalyzePaths() stieg bei leerer Pfadliste aus, bevor die abgelegten
  // Dateien angehaengt wurden. Der Upload lief durch, die Dateien lagen in
  // temp-analyze/<benutzer>/ — zu sehen war nichts.
  const fn = (js.match(/function renderAnalyzePaths\(\) \{[\s\S]*?\n\}/) || [''])[0];
  check('renderAnalyzePaths gefunden', fn.length > 0, null);
  const emptyBranch = (fn.match(/if \(state\.analyzePaths\.length === 0\) \{[\s\S]*?\n  \}/) || [''])[0];
  check('leerer Zweig haengt die Ablage an', /dropped/.test(emptyBranch),
    'Ohne das sieht ein Ordner-Upload ohne konfigurierten Pfad aus, als waere nichts passiert');
  // Auf den Teil NACH dem leeren Zweig eingegrenzt statt auf die genaue
  // Schreibweise: der Check hing an ").join('') + dropped;" und wurde rot,
  // als die Pfadliste 2026-09-02 in .analyze-path-box gefasst wurde --
  // obwohl die gepruefte Sache unveraendert stimmte.
  const vollerZweig = fn.slice(fn.indexOf(emptyBranch) + emptyBranch.length);
  check('voller Zweig haengt die Ablage an', /\+ dropped;/.test(vollerZweig), null);
  check('renderDroppedGroup wird nur einmal gerufen',
    (fn.match(/renderDroppedGroup\(\)/g) || []).length === 1,
    'Zwei Aufrufe waeren zwei Zustaende');
  check('Start-Knopf kennt den Fall ebenfalls',
    /state\.analyzePaths\.length > 0 \|\| \(state\.analyzeDropped \|\| \[\]\)\.length > 0/.test(js),
    '"nur Abgelegtes, kein Pfad" ist ein gueltiger Lauf');
}

console.log('\n9) Lesbarkeit: Groessen liegen im CSS, nicht im JS');
{
  // Anlass 2026-09-02: Pfade und Dateinamen waren mit 13,6 px die kleinste
  // Schrift im Panel -- obwohl sie das sind, was hier gelesen wird. Geprueft
  // wird nicht der px-Wert (der ist Geschmack und wuerde bei jeder Anpassung
  // rot), sondern WO er steht und dass Markup und Regel zueinander passen.
  const fn = (js.match(/function renderAnalyzePaths\(\) \{[\s\S]*?\n\}/) || [''])[0];
  check('renderAnalyzePaths setzt keine font-size mehr', !/font-size/.test(fn),
    'Inline gewinnt gegen jede Klasse: die Groesse waere wieder in einer ' +
    'JS-Datei versteckt und .analyze-path-row still ausgehebelt');
  check('Pfadzeile nutzt die Klasse', /class="analyze-path-row"/.test(fn), null);
  check('.analyze-path-row code definiert', /\.analyze-path-row code \{/.test(css),
    'Ohne die Regel faellt die Liste auf die Browser-Vorgabe fuer <code> zurueck');
  check('.analyze-path-empty definiert', /\.analyze-path-empty \{/.test(css),
    'Der Leerzustand hat sein Inline-Styling abgegeben und braucht die Klasse');

  // Der Kasten um die Pfadliste (Variante B): er darf NUR die Pfade fassen.
  // Waere die Ablage mit drin, sagte das Bild "gehoert zur Konfiguration" --
  // sie ist aber temporaer und steht ausdruecklich nicht in der Config.
  for (const klasse of ['.analyze-path-box', '.analyze-path-head', '.analyze-path-count']) {
    check(`${klasse} definiert`, new RegExp('\\' + klasse + ' \\{').test(css), null);
  }
  check('Kasten wird gezeichnet', /class="analyze-path-box"/.test(fn), null);
  check('Ablage bleibt ausserhalb des Kastens',
    /<\/div>` \+ dropped;/.test(fn),
    'Das schliessende </div> des Kastens muss VOR dem Anhaengen der Ablage stehen');
  check('Kopfzeile nennt die Anzahl',
    /analyze-path-count">\$\{state\.analyzePaths\.length\}/.test(fn),
    'Eine feste Zahl oder ein fehlender Zaehler macht die Kopfzeile wertlos');
  check('Kasten nur bei vorhandenen Pfaden',
    !/analyze-path-box/.test((fn.match(/if \(state\.analyzePaths\.length === 0\) \{[\s\S]*?\n  \}/) || [''])[0]),
    'Ein leerer Kasten mit einer 0 darin ist Ballast');

  // Icon: beides oder keins. Ein 📄 ohne Regel ist ein normal grosses Emoji
  // in eigener Zeile, eine Regel ohne Markup ist toter Code.
  const imMarkup = /class="drop-icon"/.test(html);
  const imCss = /\.drop-logs \.drop-icon \{/.test(css);
  check('drop-icon steht in Markup UND CSS', imMarkup && imCss,
    `Markup: ${imMarkup ? 'ja' : 'NEIN'}, CSS: ${imCss ? 'ja' : 'NEIN'}`);
  check('Icon nicht doppelt: Titel traegt kein Emoji mehr',
    !/class="drop-title">📄/.test(html),
    'Sonst stehen zwei Blaetter uebereinander');

  // Der Ruhezustand der Ablageflaeche muss ungefuellt bleiben, sonst ist die
  // Rueckmeldung beim Ziehen (.is-over setzt background) nicht mehr sichtbar.
  const ruhe = (css.match(/\.drop-logs \{[\s\S]*?\n\}/) || [''])[0];
  check('.drop-logs ohne eigenen Hintergrund', !/\bbackground:/.test(ruhe),
    'Mit Fuellung im Ruhezustand ist .is-over beim Ziehen nicht mehr zu erkennen');

  // Gemeinsame Trefferflaeche fuer beide Listen -- zweimal dasselbe waere
  // die Stelle, an der eine der beiden beim naechsten Mal vergessen wird.
  check('Emoji-Knoepfe haben eine Trefferflaeche',
    /\.analyze-path-row \.x-btn,\s*\.dropped-group \.x-btn \{[\s\S]*?min-height/.test(css),
    'Vorher war nur die Glyphe klickbar (~14 px)');
  check('und einen Tastatur-Fokusring',
    /\.x-btn:focus-visible/.test(css), null);
}

console.log(failed ? `\n❌ ${failed} Problem(e)\n` : '\n✅ Verdrahtung vollstaendig\n');
process.exit(failed ? 1 : 0);
