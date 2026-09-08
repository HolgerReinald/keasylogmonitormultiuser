// Verwaiste Dateien und Trennzeilen.
//
// Anlass: im Dashboard standen ⏱️-Einträge zu Log-Dateien, die es nicht mehr
// gibt — Keasy räumt seine Sitzungslogs ab. Die Einträge wirkten wie Phantome,
// und 📂/📝/↗ taten beim Klick gar nichts.
//
// Drei Dinge werden geprüft:
//   1. Trennzeilen sind keine Aktivität (echter Funktionstest)
//   2. verschwundene Dateien werden GEKENNZEICHNET, nicht stillschweigend
//      geleert — die gesammelten Funde bleiben stehen
//   3. die Öffnen-Endpunkte melden einen Fehlschlag, statt "ok" zu behaupten
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let failed = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const bad = (name, detail) => { console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); failed++; };
const check = (name, cond, detail) => cond ? ok(name) : bad(name, detail);

const watch = read('server/watchService.js');
const analysis = read('server/analysisService.js');
const runtime = read('server/runtimeStore.js');
const routes = read('server/routes/processRoutes.js');
const serverJs = read('server.js');
const render = read('public/js/render.js');
const actions = read('public/js/actions.js');
const wsClient = read('public/js/wsClient.js');
const stateJs = read('public/js/state.js');
const css = read('public/style.css');

console.log('\n1) Trennzeilen sind keine Aktivität (Funktionstest)');
{
  const { isContentFreeLine } = require(path.join(root, 'server/logParser.js'));
  const NL = String.fromCharCode(10);
  const faelle = [
    ['Trennlinie aus Strichen', '08.09.26 10:24:02.269   --------------------------------', true],
    ['nur der Zeitstempel', '08.09.26 10:24:02.269', true],
    ['leer', '', true],
    ['nur Gleichheitszeichen', '   ====  ', true],
    ['echte Meldung', '08.09.26 10:26:37.279   Window closing: Aktivitaet_ListView_Haupt', false],
    ['Messwerte', '08.09.26 10:25:39.275   [Memory] WorkingSet: 1427,6 MB', false],
    ['Striche MIT Text', '08.09.26 10:24:02.269   ---> Fehler', false],
    ['mehrzeilig, erste Zeile Trenner', '08.09.26 10:24:02.269  ------' + NL + '08.09.26 10:24:03.000 Text', true],
    ['mehrzeilig, erste Zeile Inhalt', '08.09.26 10:26:37.279  Fehler' + NL + '   bei Keasy.X()', false]
  ];
  for (const [name, eingabe, erwartet] of faelle) {
    check(name, isContentFreeLine(eingabe) === erwartet,
      `erwartet ${erwartet}, bekommen ${isContentFreeLine(eingabe)}`);
  }
}

console.log('\n2) Beide Gap-Wege benutzen dieselbe Regel');
{
  // Zwei Regeln für dieselbe Frage laufen auseinander — dann meldet die
  // Analyse Lücken, die die Live-Überwachung nicht meldet, und umgekehrt.
  check('logParser exportiert isContentFreeLine', /isContentFreeLine \}/.test(read('server/logParser.js')));
  check('watchService importiert sie', /isContentFreeLine \} = require\('\.\/logParser'\)/.test(watch));
  check('analysisService importiert sie', /const \{ isContentFreeLine,/.test(analysis));

  check('live: vor dem Fortschreiben der Grundlinie',
    /function trackEntryGap[\s\S]{0,600}?isContentFreeLine\(entry\)\) return;[\s\S]{0,120}?lastEntryTimestamps\.set/.test(watch),
    'Steht die Prüfung NACH lastEntryTimestamps.set, zerfällt die echte Wartezeit trotzdem in zwei Hälften');
  check('Analyse: vor dem Fortschreiben von lastTs',
    /function trackGapAt[\s\S]{0,400}?isContentFreeLine\(firstLine\)\) return;[\s\S]{0,60}?lastTs = ts;/.test(analysis),
    'Dieselbe Reihenfolge wie live — sonst ist die Grundlinie eine Trennzeile');
  check('auch die Grundlinie bei abgeschaltetem Feature',
    /function updateGapBaseline[\s\S]{0,400}isContentFreeLine\(entries\[i\]\)\) continue;/.test(watch),
    'Sonst steht die Grundlinie nach dem Einschalten auf einer Trennzeile');
}

console.log('\n3) Verschwundene Dateien werden gekennzeichnet, nicht geleert');
{
  check('missingFiles im runtimeStore', /const missingFiles = new Map\(\);/.test(runtime));
  check('wird beim Reset mitgeleert', /missingFiles\.clear\(\);/.test(runtime));
  check('wird exportiert', /^\s*missingFiles,$/m.test(runtime));

  const unlink = watch.slice(watch.indexOf("watcher.on('unlink'"));
  const unlinkBody = unlink.slice(0, unlink.indexOf('watcher.on(', 10));
  check('unlink trägt die Datei ein', /missingFiles\.set\(filePath/.test(unlinkBody));
  check('unlink meldet es an die Oberfläche', /broadcastMissing\(\)/.test(unlinkBody));

  // Der Kern der Entscheidung: die Funde bleiben stehen. Würde hier geleert,
  // verschwänden bei einer Log-Rotation ungelesene Fehler.
  check('unlink löscht KEINE Fehler', !/errorStore\.delete/.test(unlinkBody),
    'Gesammelte Fehler sind echte Funde — sie dürfen mit der Datei nicht verschwinden');
  check('unlink löscht KEINE Performance-Einträge', !/performanceStore\.delete/.test(unlinkBody));
}

console.log('\n4) Der Zustand kommt beim Client an');
{
  check('getMissingFiles liefert die Map-Form von getOversizedFiles',
    /function getMissingFiles\(\)[\s\S]{0,300}result\[filePath\] = \{ label:/.test(watch),
    'filterMapByLabels erwartet ein Objekt mit .label je Eintrag');
  check('broadcastMissing filtert nach sichtbaren Labels',
    /function broadcastMissing\(\)[\s\S]{0,300}filterMapByLabels\(msg\.data, visibleLabels\)/.test(watch),
    'Ohne Filter sähe ein Benutzer Dateien von Quellen, die er nicht sehen darf');
  check('getMissingFiles wird exportiert', /module\.exports = \{[^}]*getMissingFiles/.test(watch));
  check('server.js importiert es', /getOversizedFiles, getMissingFiles,/.test(serverJs));
  check('steht in der init-Nachricht', /missingFiles: filterMapByLabels\(getMissingFiles\(\), ws\.visibleLabels\)/.test(serverJs),
    'Ohne init wäre die Kennzeichnung nach einem F5 wieder weg');
  check('state kennt missingFiles', /missingFiles: \{\},/.test(stateJs));
  check('wsClient übernimmt sie aus init', /state\.missingFiles = msg\.missingFiles \|\| \{\};/.test(wsClient));
  check('wsClient kennt die Einzelmeldung', /msg\.type === 'missing-files'[\s\S]{0,120}state\.missingFiles = msg\.data/.test(wsClient));
}

console.log('\n5) Die Anzeige sperrt nur, was die Datei braucht');
{
  check('istWeg-Hilfsfunktion', /const istWeg = fp =>/.test(render));
  check('Hinweiszeile im Datei-Kopf', /class="file-missing"/.test(render));
  check('eigene Klasse am Block', /file-group-missing/.test(render));
  check('CSS für die Hinweiszeile', /\.file-missing \{/.test(css));
  check('CSS für den gedämpften Kopf', /\.file-group-missing \.file-header \{/.test(css));

  check('📂/📝 und Datei-Export gesperrt',
    /function buildOpenButtonsHtml[\s\S]{0,700}?if \(istWeg\(filePath\)\)[\s\S]{0,600}?disabled>🚀<\/button>/.test(render));
  check('Sprungknopf am Fehler-Eintrag gesperrt',
    /function buildErrorEntryHtml[\s\S]{0,2000}?istWeg\(filePath\)[\s\S]{0,200}?disabled>↗ Zeile öffnen/.test(render));
  check('Sprungknopf am ⏱️-Eintrag gesperrt',
    /function buildGapEntryHtml[\s\S]{0,900}?istWeg\(filePath\)[\s\S]{0,200}?disabled>↗ Zeile öffnen/.test(render));

  // Kopieren liest aus dem Speicher, nicht von der Platte — es MUSS weiter
  // gehen, sonst kommt man an den Fund gar nicht mehr heran.
  const eintrag = render.slice(render.indexOf('function buildErrorEntryHtml'));
  const eintragBody = eintrag.slice(0, eintrag.indexOf('function buildGapEntryHtml'));
  check('📋 Kopieren bleibt bedienbar',
    /copy-btn[^>]*onclick="copyErrorToClipboard/.test(eintragBody),
    'Der Fehlertext liegt im Speicher — ohne Datei ist Kopieren der einzige Weg an den Fund');
}

console.log('\n6) Die Öffnen-Endpunkte melden einen Fehlschlag');
{
  // Vorher: try/catch verschluckte die fehlende Datei, execFile lief trotzdem,
  // und geantwortet wurde immer { ok: true }.
  const handler = name => {
    const i = routes.indexOf(`'POST /api/${name}'`);
    if (i === -1) return '';
    const rest = routes.slice(i + 5);
    const j = rest.indexOf("    'POST /api/");
    return rest.slice(0, j === -1 ? rest.length : j);
  };
  for (const name of ['open-folder', 'open-file', 'open-file-at-line']) {
    const h = handler(name);
    check(`${name}: prüft existsSync`, /fs\.existsSync\(filePath\)/.test(h));
    check(`${name}: antwortet 404`, /res\.writeHead\(404/.test(h));
    check(`${name}: prüft VOR execFile`,
      h.indexOf('fs.existsSync(filePath)') !== -1 &&
      h.indexOf('fs.existsSync(filePath)') < h.indexOf('execFile('),
      'Nach execFile wäre der Editor längst mit einem leeren Fenster offen');
  }

  check('Client wertet die Antwort aus',
    /async function oeffnenAnfordern[\s\S]{0,700}if \(res\.ok\) return;[\s\S]{0,300}showToast\(/.test(actions),
    'Ohne Auswertung gibt es keinen Weg, auf dem der Fehlschlag auf den Schirm kommt');
  check('auch ein nicht erreichbarer Monitor meldet sich',
    /catch \{[\s\S]{0,200}Der Monitor antwortet nicht/.test(actions));

  // Ein zweiter Weg zur selben Route würde die Rückmeldung wieder umgehen.
  const direkt = [read('public/js/analyzePanel.js'), read('public/js/backupTargetsPanel.js'), actions]
    .join('\n').match(/fetch\('\/api\/open-/g) || [];
  check('kein zweiter fetch-Weg auf die Öffnen-Routen', direkt.length === 0,
    'gefunden: ' + direkt.length + ' — alle Aufrufer gehen über oeffnenAnfordern()');
}

console.log(failed === 0 ? '\n✅ Verwaiste Dateien und Trennzeilen korrekt behandelt\n' : `\n❌ ${failed} Problem(e)\n`);
process.exit(failed === 0 ? 0 : 1);
