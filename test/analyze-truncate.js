// Laufzeit-Pruefung des Lesestopps der Log-Analyse — ohne Server.
//
// Anlass (2026-08-31): eine Analyse zeigte 100 Fehler, obwohl 110 in der Datei
// standen. `analyzeFile()` bricht das Lesen ab, sobald das Limit erreicht ist
// (rl.close(); stream.destroy()) — die Datei war nur bis 17:21:45 gelesen.
// Sichtbar war davon nichts: ein unvollstaendiges Ergebnis sah genauso aus wie
// ein vollstaendiges.
//
// Geprueft wird deshalb nicht nur, DASS abgebrochen wird, sondern dass der
// Abbruch beim Client ankommt:
//   1. au.truncated traegt Limit und letzten gelesenen Zeitstempel
//   2. das Ereignis 'analyze-truncated' geht raus (sonst faellt der Hinweis im
//      Dashboard weg, ohne dass irgendetwas rot wird)
//   3. 'analyze-done' zaehlt die betroffenen Dateien
//   4. getAnalyzeErrors() liefert den Vermerk mit — sonst ist der Hinweis nach
//      einem F5 verschwunden, obwohl die Ergebnisse noch da sind
//   5. der Vermerk wird beim naechsten Lauf wieder geraeumt
//   6. der JSON-Pfad (emitJsonErrors) meldet den Lesestopp genauso — das ist
//      eine zweite, unabhaengige Implementierung derselben Grenze
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');

// Reihenfolge ist entscheidend: analysisService destrukturiert broadcastToUser
// beim Laden (`const { broadcastToUser } = require('./wsBroadcast')`). Wird das
// Modul erst danach gepatcht, laeuft der Patch ins Leere. Also vorher.
const wsBroadcast = require(path.join(root, 'server', 'wsBroadcast'));
const gesendet = [];
wsBroadcast.broadcastToUser = (user, msg) => gesendet.push(msg);

const lp = require(path.join(root, 'server', 'logParser'));
const { runAnalysis, getAnalyzeErrors } = require(path.join(root, 'server', 'analysisService'));

// Filter explizit setzen: config.js ist gitignored, der Test darf nicht davon
// abhaengen, was auf dieser Maschine zufaellig konfiguriert ist.
lp.rebuildFilterRegex(['Fehler', 'Exception']);
lp.rebuildExcludeRegex([]);
lp.rebuildThresholdRules([]);

let failed = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const bad = (name, detail) => { console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); failed++; };
const check = (name, cond, detail) => cond ? ok(name) : bad(name, detail);

const USER = 'truncate-test';

// Log im Keasy-Format: "DD.MM.YY HH:MM:SS.mmm<TAB>Text".
// 8 Treffer (jede zweite Minute), dazwischen harmlose Zeilen. Der 5. Treffer
// liegt bei 08:09:00 — bis dorthin muss bei Limit 5 gelesen worden sein.
function baueLog() {
  const zeilen = [];
  for (let i = 0; i < 8; i++) {
    const min = String(i * 2).padStart(2, '0');
    zeilen.push(`31.08.26 08:${min}:00.000\tAlles in Ordnung, nur Rauschen`);
    zeilen.push(`31.08.26 08:0${i}:00.000\tDer folgende #Fehler ist aufgetreten:`);
  }
  return zeilen.join('\n') + '\n';
}
const TREFFER_GESAMT = 8;
const LIMIT = 5;
const ZEIT_5_TREFFER = '08:04:00';   // 5. Treffer: i=4 → 08:04:00

// JSON-Log der KI-Schnittstelle: Bloecke durch eine Zeile "---" getrennt.
// Success:false macht den Block strukturell zum Fehler — im Text steht bewusst
// kein Filtermuster, damit der JSON-Pfad und nicht der Textfilter greift.
function baueJsonLog(anzahl) {
  const bloecke = [];
  for (let i = 0; i < anzahl; i++) {
    bloecke.push(JSON.stringify({
      Timestamp: `2026-08-31T09:0${i}:00.000Z`,
      RequestId: `req-${i}`,
      Success: false,
      Error: { Type: 'IOException', Message: 'Alle Pipeinstanzen sind ausgelastet.' }
    }, null, 2));
  }
  return bloecke.join('\n---\n') + '\n---\n';
}

const uhrzeit = (iso) => iso ? new Date(iso).toTimeString().slice(0, 8) : null;
const letzte = (typ) => [...gesendet].reverse().find(m => m.type === typ);

async function main() {
  // Arbeitsverzeichnis ausserhalb des Projekts, damit nichts Echtes angefasst wird
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keasy-truncate-test-'));
  try {
    const logDatei = path.join(tmp, 'App_2026-08-31.log');
    fs.writeFileSync(logDatei, baueLog(), 'utf8');

    console.log(`\nLimit ${LIMIT} greift — der Abbruch muss gemeldet werden`);
    {
      gesendet.length = 0;
      await runAnalysis([logDatei], LIMIT, USER, null);

      const fehler = gesendet.filter(m => m.type === 'analyze-error');
      check(`genau ${LIMIT} Fehler gemeldet`, fehler.length === LIMIT, 'gemeldet: ' + fehler.length);

      const trunc = gesendet.filter(m => m.type === 'analyze-truncated');
      check("Ereignis 'analyze-truncated' gesendet", trunc.length === 1,
        'gesendet: ' + trunc.length + " — ohne dieses Ereignis fehlt der Hinweis im Dashboard");

      if (trunc.length === 1) {
        check('Limit im Ereignis', trunc[0].data.limit === LIMIT, 'war: ' + trunc[0].data.limit);
        check(`gelesen bis ${ZEIT_5_TREFFER}`, uhrzeit(trunc[0].data.lastTimestamp) === ZEIT_5_TREFFER,
          'war: ' + uhrzeit(trunc[0].data.lastTimestamp));
        check('Dateipfad im Ereignis', trunc[0].data.filePath === logDatei);
      }

      const done = letzte('analyze-done');
      check('analyze-done zaehlt 1 abgeschnittene Datei', done && done.data.truncatedFiles === 1,
        'war: ' + (done && done.data.truncatedFiles));

      // Der Vermerk muss im Snapshot stecken, sonst ist der Hinweis nach F5 weg
      const snap = getAnalyzeErrors(USER);
      const eintrag = snap[logDatei];
      check('truncated im Snapshot (ueberlebt F5)', !!(eintrag && eintrag.truncated));
      if (eintrag && eintrag.truncated) {
        check('Snapshot nennt dasselbe Limit', eintrag.truncated.limit === LIMIT);
      }
    }

    console.log('\nLimit reicht aus — kein Hinweis, und der alte Vermerk ist weg');
    {
      gesendet.length = 0;
      await runAnalysis([logDatei], 50, USER, null);

      const fehler = gesendet.filter(m => m.type === 'analyze-error');
      check(`alle ${TREFFER_GESAMT} Fehler gemeldet`, fehler.length === TREFFER_GESAMT,
        'gemeldet: ' + fehler.length);
      check("kein 'analyze-truncated'", gesendet.every(m => m.type !== 'analyze-truncated'));

      const done = letzte('analyze-done');
      check('analyze-done zaehlt 0', done && done.data.truncatedFiles === 0,
        'war: ' + (done && done.data.truncatedFiles));

      const snap = getAnalyzeErrors(USER);
      check('Vermerk des Vorlaufs geraeumt', snap[logDatei] && snap[logDatei].truncated === undefined,
        'Ein stehengebliebener Vermerk warnt vor einem Abbruch, der nicht stattfand');
    }

    console.log('\nJSON-Logs — zweiter Codepfad, gleiche Grenze');
    {
      const jsonDatei = path.join(tmp, 'ki_2026-08-31.json');
      fs.writeFileSync(jsonDatei, baueJsonLog(6), 'utf8');

      gesendet.length = 0;
      await runAnalysis([jsonDatei], 2, USER, null);

      const fehler = gesendet.filter(m => m.type === 'analyze-error');
      check('2 Fehler gemeldet (Limit 2)', fehler.length === 2, 'gemeldet: ' + fehler.length);

      const trunc = gesendet.filter(m => m.type === 'analyze-truncated');
      check("JSON-Pfad meldet 'analyze-truncated'", trunc.length === 1,
        'gesendet: ' + trunc.length + ' — emitJsonErrors ist eine eigene Implementierung ' +
        'derselben Grenze und wird beim Nachziehen leicht vergessen');
      if (trunc.length === 1) {
        check('Limit im JSON-Ereignis', trunc[0].data.limit === 2, 'war: ' + trunc[0].data.limit);
        check('Zeitstempel aus dem JSON-Feld', uhrzeit(trunc[0].data.lastTimestamp) !== null,
          'Ohne Zeitstempel kann die Warnzeile nicht sagen, bis wohin gelesen wurde');
      }
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* egal */ }
  }

  console.log(failed === 0 ? '\n✅ Lesestopp wird korrekt gemeldet\n' : `\n❌ ${failed} Problem(e)\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
