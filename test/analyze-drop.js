// Laufzeit-Pruefung der Log-Ablage (Drag & Drop) — ohne Server.
//
// Prueft die Stellen, an denen dieses Feature realistisch falsch laeuft:
//   1. .json zaehlt nicht als Log → ein Ordner mit reinen JSON-Logs einer
//      Schnittstelle wird als "keine Log-Dateien" gemeldet (so passiert am
//      2026-08-20). Umgekehrt darf node_modules nicht mitgelesen werden.
//   2. JSON-Logs laufen durch den Textfilter statt strukturell → in Prompt-
//      texten schlaegt jedes "fehler" an, echte Error-Objekte fehlen
//   3. ZIP-Eintraege brechen aus der Ablage aus (zip-slip) oder Nicht-Logs
//      werden mitentpackt
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const dropStore = require(path.join(root, 'server', 'analyzeDropStore'));
const { collectLogFiles, runAnalysis, getAnalyzeErrors } = require(path.join(root, 'server', 'analysisService'));

let failed = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const bad = (name, detail) => { console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); failed++; };
const check = (name, cond, detail) => cond ? ok(name) : bad(name, detail);

const LOG = [
  '2026-08-20 08:00:00 [INFO] Start',
  '2026-08-20 08:00:05 [ERROR] Der folgende #Fehler ist aufgetreten:',
  'Type: TimeoutException',
  'Message: Zeitüberschreitung beim Speichern.'
].join('\n');

// KI-Log: strukturell ein Fehler (Error-Objekt), im Text steht kein Filtermuster
const JSONLOG = JSON.stringify({
  Timestamp: '2026-08-20T08:01:00.000Z',
  RequestId: 'abc-123',
  Success: false,
  Error: { Type: 'IOException', Message: 'Alle Pipeinstanzen sind ausgelastet.' }
}, null, 2);

function write(dir, name, content) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content, 'utf8');
}

async function main() {
  // Arbeitsverzeichnis ausserhalb des Projekts, damit nichts Echtes angefasst wird
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keasy-drop-test-'));
  try {
    console.log('\n1) .log und .json gelten überall als Log, node_modules nicht');
    {
      const dir = path.join(tmp, 'mixed');
      write(dir, 'app.log', LOG);
      write(dir, 'ki.json', JSONLOG);
      write(dir, 'package.json', '{ "name": "kein-log" }');
      // Der Grund fuer die Sprungliste: hier liegen in echten Projekten
      // tausende JSON-Dateien, die niemand lesen will.
      write(path.join(dir, 'node_modules', 'irgendwas'), 'package.json', '{ "name": "x" }');
      write(path.join(dir, '.git'), 'config.json', '{}');

      const found = (await collectLogFiles([dir])).logFiles;
      const names = found.map(p => path.basename(p)).sort();

      check('.log wird gefunden', names.includes('app.log'), 'gefunden: ' + names.join(', '));
      check('.json wird gefunden', names.includes('ki.json'),
        'Ein Ordner mit reinen JSON-Logs (Schnittstelle) waere sonst wertlos — genau der Fall, ' +
        'der am 2026-08-20 als "keine Log-Dateien" gemeldet wurde');
      check('node_modules wird uebersprungen', names.filter(n => n === 'package.json').length === 1,
        'gefunden: ' + names.join(', ') + ' — die package.json des Ordners selbst zaehlt, ' +
        'die aus node_modules nicht');
      check('.git wird uebersprungen', !found.some(p => p.includes('.git')));
      check('insgesamt drei Dateien', found.length === 3, 'gefunden: ' + names.join(', '));

      // Die Ablage nutzt dieselbe Logik — kein Sonderfall mehr
      const asObject = (await collectLogFiles([{ path: dir }])).logFiles;
      check('Objekt-Form { path } verhaelt sich gleich', asObject.length === found.length);
    }

    console.log('\n2) JSON-Logs werden strukturell ausgewertet');
    {
      const dir = path.join(tmp, 'jsononly');
      write(dir, 'ki.json', JSONLOG);
      const user = 'testuser-drop';
      await runAnalysis([dir], 100, user, { gapWarnSeconds: 0, gapIdleMinutes: 30 });
      const res = getAnalyzeErrors(user);
      const files = Object.keys(res);
      check('JSON-Datei wurde ausgewertet', files.length === 1, 'Dateien: ' + files.join(', '));
      const errors = files.length ? res[files[0]].errors : [];
      check('Fehler aus dem Error-Objekt erkannt', errors.length >= 1,
        'evaluateJsonEntry sollte Error.Type/Message melden, gefunden: ' + errors.length);
      if (errors.length) {
        check('Meldung traegt Typ und Text',
          /IOException/.test(errors[0].line) && /Pipeinstanzen/.test(errors[0].line),
          'Zeile: ' + errors[0].line);
        check('Timestamp kommt aus dem JSON-Feld',
          String(errors[0].timestamp).startsWith('2026-08-20T08:01'),
          'Timestamp: ' + errors[0].timestamp);
      }
    }

    console.log('\n3) ZIP: nur Logs, flach, kein Ausbruch');
    {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();
      zip.addFile('inner/app.log', Buffer.from(LOG, 'utf8'));
      zip.addFile('inner/ki.json', Buffer.from(JSONLOG, 'utf8'));
      zip.addFile('inner/readme.txt', Buffer.from('kein Log', 'utf8'));
      zip.addFile('../ausbruch.log', Buffer.from(LOG, 'utf8'));
      const zipPath = path.join(tmp, 'logs.zip');
      fs.writeFileSync(zipPath, zip.toBuffer());

      const target = path.join(tmp, 'entpackt');
      fs.mkdirSync(target, { recursive: true });
      const { added, skipped } = dropStore.extractZip(zipPath, target);
      const names = fs.readdirSync(target).sort();

      check('.log und .json entpackt', names.includes('app.log') && names.includes('ki.json'),
        'im Ziel: ' + names.join(', '));
      check('.txt nicht entpackt', !names.includes('readme.txt'),
        'uebersprungen: ' + JSON.stringify(skipped));
      check('kein Ausbruch aus dem Zielverzeichnis', !fs.existsSync(path.join(tmp, 'ausbruch.log')),
        'Ein Eintrag "../ausbruch.log" darf nur als "ausbruch.log" IM Ziel landen');
      check('Ausbruch-Eintrag landete flach im Ziel', names.includes('ausbruch.log'));
      check('added meldet die uebernommenen Dateien', added.length === 3,
        'added: ' + added.map(a => a.name).join(', '));
    }

    console.log('\n4) Namenspruefung');
    {
      check('.txt abgelehnt', dropStore.safeName('notes.txt') === null);
      check('Pfadanteile verworfen', dropStore.safeName('C:\\Windows\\x.log') === 'x.log');
      check('Traversal ohne gueltige Endung abgelehnt', dropStore.safeName('..\\..\\config.js') === null);
      check('Traversal mit gueltiger Endung wird Basename', dropStore.safeName('../../x.log') === 'x.log');
      const long = dropStore.safeName('a'.repeat(300) + '.log');
      check('langer Name behaelt die Endung', long.endsWith('.log') && long.length <= 180,
        'Ohne Endung wuerde die Datei liegen bleiben und nie analysiert werden');
      check('Benutzername wird entschaerft', !dropStore.userDir('../x').includes('..' + path.sep),
        dropStore.userDir('../x'));
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* egal */ }
  }

  console.log(failed === 0 ? '\n✅ Ablage verhaelt sich wie zugesagt\n' : `\n❌ ${failed} Problem(e)\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('\n❌ Test abgebrochen: ' + err.stack);
  process.exit(1);
});
