// Statische Verdrahtungs-Pruefung: Ansicht bleibt beim Lesen stehen (Stufe 1+2).
//
// Anlass: wer einen Fehler gelesen hat und dabei einen neuen Fehler bekam,
// verlor die Stelle -- alle aufgeklappten Dateien fielen zu und die Seite stand
// woanders. Die Ursache war zweigeteilt: buildFileGroupHtml() baute die
// Eintragsliste immer zugeklappt auf, und renderAll() ersetzt das komplette
// HTML des Containers.
//
// Geprueft werden die Stellen, an denen das im Browser stillschweigend kaputt
// waere -- in Node ist das Verhalten selbst nicht nachstellbar (kein DOM):
//   1. jede Aufrufstelle hat einen EIGENEN Klapp-Schluessel (sonst klappen
//      Live, Performance und Analyse derselben Datei gemeinsam)
//   2. die Sprungziele (Alarmknopf, Fehler-Index) fuellen dasselbe Gedaechtnis
//      -- am DOM gedreht waere ihr Aufklappen beim naechsten Fehler wieder weg
//   3. gespeichert werden nur die OFFENEN Bloecke (invertiertes Muster)
//   4. der Anker wird VOR dem Leeren von state.navEntries genommen und findet
//      ueber die Objektreferenz zurueck, nicht ueber die Element-ID
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
const stateJs = read('public/js/state.js');

console.log('\n1) Der Auf-/Zu-Zustand der Datei-Bloecke wird ueberhaupt gemerkt');
{
  check('state.openFiles vorhanden',
    /openFiles: JSON\.parse\(localStorage\.getItem\('keasy-open-files'\)/.test(stateJs),
    'Ohne eigenen Speicher faellt jede aufgeklappte Datei beim naechsten Fehler wieder zu');
  check('buildFileGroupHtml nimmt einen openKey',
    /function buildFileGroupHtml\([^)]*openKey = filePath\)/.test(render));
  check('Schluessel steht als data-open-key im Kopf',
    /class="file-header" data-open-key=/.test(render),
    'toggleGroup() liest den Schluessel vom Kopf -- ohne Attribut klappt der Block ohne Gedaechtnis');
  check('Anzeige haengt am gemerkten Zustand',
    /class="error-list" style="display:\$\{isOpen \? 'block' : 'none'\}"/.test(render),
    'Ein hartes display:none baut den Block bei jedem renderAll() wieder zugeklappt auf');
}

console.log('\n2) Jede Aufrufstelle hat ihren eigenen Schluessel');
{
  // Dieselbe Datei kann gleichzeitig unter Live, Performance und Analyse stehen.
  // Ohne Praefix teilen sich alle drei Bloecke einen Schluessel und klappen
  // gemeinsam -- fuer den Anwender sieht das nach einem Fehler aus.
  const aufrufe = (render.match(/buildFileGroupHtml\(/g) || []).length - 1; // minus Definition
  check('drei Aufrufstellen (Live, Performance, Analyse)', aufrufe === 3,
    'gefunden: ' + aufrufe + ' -- kommt eine dazu, braucht sie einen eigenen Schluessel');
  check('Performance mit eigenem Praefix', /'perf:' \+ filePath\)/.test(render));
  check('Analyse mit eigenem Praefix', /'analyze:' \+ filePath\)/.test(render));
  check('Live nutzt die Vorgabe (Dateipfad)',
    /entriesHtml, newestClass \+ critClass\);/.test(render),
    'Die Vorgabe openKey = filePath deckt den Live-Fall ab -- ein dritter Praefix waere doppelt gemoppelt');
}

console.log('\n3) Die Sprungziele fuellen dasselbe Gedaechtnis');
{
  check('openFileList schreibt Zustand und localStorage',
    /function openFileList\(list\)[\s\S]{0,300}state\.openFiles\[key\] = true;[\s\S]{0,80}persistOpenFiles\(\);/.test(actions));
  check('toggleGroup geht ueber openFileList/closeFileList',
    /function toggleGroup\(header\)[\s\S]{0,200}openFileList\(list\)[\s\S]{0,80}closeFileList\(list\)/.test(actions));
  check('Alarmknopf: expandAndFindCritical nutzt openFileList',
    /function expandAndFindCritical\(fileGroup\)[\s\S]{0,200}openFileList\(fileGroup\.querySelector/.test(actions),
    'Am DOM gedreht faellt die gerade angesprungene Datei beim naechsten Fehler wieder zu');
  check('Fehler-Index: focusEntry nutzt openFileList',
    /function focusEntry\(target\)[\s\S]{0,300}openFileList\(target\.closest/.test(actions),
    'focusEntry ist die gemeinsame Endstelle aller Spruenge -- hier und nicht in den Aufrufern');

  // Wer kuenftig wieder direkt am DOM dreht, faellt hier auf.
  const direkt = (actions.match(/\.style\.display = 'block'/g) || []).length;
  check('kein direktes Aufklappen am DOM mehr', direkt === 1,
    'gefunden: ' + direkt + ' -- erlaubt ist genau eine Stelle, naemlich in openFileList selbst');
}

console.log('\n4) Gespeichert werden nur die OFFENEN Bloecke');
{
  check('Zuklappen loescht den Eintrag',
    /function closeFileList\(list\)[\s\S]{0,300}delete state\.openFiles\[key\];/.test(actions),
    'Wuerde false gespeichert, waechst der Speicher um lauter Selbstverstaendlichkeiten');
  check('Aufklappen nur bei === true', /state\.openFiles\[openKey\] === true/.test(render),
    'Mit einer weichen Pruefung waeren Bloecke ohne gemerkten Zustand offen -- das Gegenteil der Vorgabe');
  check('Bloecke ohne Schluessel steigen aus (Papierkorb)',
    (actions.match(/if \(!key\) return;/g) || []).length === 2,
    'Der Papierkorb baut sein Markup selbst und hat kein data-open-key -- ohne diesen Ausstieg landet undefined im Speicher');
}

console.log('\n5) Der Anker haelt die Ansicht');
{
  check('captureViewAnchor vorhanden', /function captureViewAnchor\(\)/.test(render));
  check('restoreViewAnchor vorhanden', /function restoreViewAnchor\(anchor\)/.test(render));

  // Die Reihenfolge ist der Kern: state.navEntries traegt die Zuordnung
  // id -> Fehlerobjekt des NOCH STEHENDEN Aufbaus. Wird erst geleert und dann
  // gemerkt, findet der Anker nichts und die Seite springt weiter wie zuvor.
  check('Anker wird VOR dem Leeren von navEntries genommen',
    /function renderAll\(\)[\s\S]{0,600}?const anchor = captureViewAnchor\(\);[\s\S]{0,400}?state\.navEntries = \[\];/.test(render),
    'Nach dem Leeren gemerkt liefert captureViewAnchor() nie einen Treffer -- der Anker waere still wirkungslos');
  check('Wiederherstellen am Ende von renderAll',
    /restoreViewAnchor\(anchor\);\s*\}\s*\n\s*function renderTrash/.test(render),
    'Frueher aufgerufen stimmen die Hoehen noch nicht -- Papierkorb und Seitenleiste kommen danach');

  check('gemerkt wird die Objektreferenz, nicht die ID',
    /return \{ ref: nav\.ref, top: rect\.top \}/.test(render),
    'Element-IDs werden bei jedem renderAll() neu vergeben und taugen nicht als Wiedererkennung');
  check('wiedergefunden ueber die Referenz',
    /state\.navEntries\.find\(n => n\.ref === anchor\.ref\)/.test(render));
  check('Datei-Kopf als Ersatzanker',
    /\{ fileKey: el\.dataset\.openKey, top: rect\.top \}/.test(render),
    'Bei zugeklappten Dateien gibt es keine Eintraege, an denen man sich festhalten koennte');

  check('ganz oben wird nicht verankert', /if \(window\.scrollY <= 4\) return null;/.test(render),
    'Wer oben steht, liest live mit -- dort soll der neueste Fehler erscheinen duerfen');
  check('unsichtbares Ziel wird nicht angesprungen',
    /if \(!el \|\| el\.offsetParent === null\) return;/.test(render),
    'Weggefiltert oder in einer zugeklappten Quelle: dann gibt es nichts, worauf man zurueckspringen koennte');
  check('verschoben wird um die Differenz, nicht auf einen Absolutwert',
    /const delta = el\.getBoundingClientRect\(\)\.top - anchor\.top;[\s\S]{0,80}window\.scrollBy\(0, delta\)/.test(render),
    'Ein gemerkter Scrollwert ginge daneben, sobald ein neuer Fehler die Sortierung oberhalb verschiebt');
}

console.log(failed === 0 ? '\n✅ Ansicht bleibt beim Lesen stehen\n' : `\n❌ ${failed} Problem(e)\n`);
process.exit(failed === 0 ? 0 : 1);
