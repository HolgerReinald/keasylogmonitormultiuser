// Isolierter Logik-Test der Verdraengungs-Helfer (Phase 2).
// Die Funktionen sind modulintern, daher hier 1:1 aus watchService.js / utils.js gespiegelt
// und gegen den Quelltext verifiziert (siehe Assert am Ende).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

function evictOldest(errors) {
  const idx = errors.findIndex(e => e.level !== 'kritisch');
  errors.splice(idx === -1 ? 0 : idx, 1);
}

// Client-Gegenstück aus public/js/utils.js — muss sich identisch verhalten
function capKeepCritical(entries, max) {
  while (entries.length > max) {
    const i = entries.findIndex(e => (e.level || 'normal') !== 'kritisch');
    entries.splice(i === -1 ? 0 : i, 1);
  }
  return entries;
}

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log(`  ok   ${name}`); }
  else { console.log(`  FAIL ${name}\n       erwartet ${e}\n       erhalten ${a}`); failed++; }
}
const mk = (id, level) => ({ id, level });
const ids = arr => arr.map(e => e.id);

console.log('\nevictOldest — kritische Eintraege zuletzt opfern');
{
  // Der kritische Eintrag steht vorn und muss die Verdraengung ueberleben
  const errors = [mk(1, 'kritisch'), mk(2, 'normal'), mk(3, 'normal')];
  evictOldest(errors);
  check('aeltester nicht-kritischer weicht', ids(errors), [1, 3]);
}
{
  const errors = [mk(1, 'normal'), mk(2, 'kritisch'), mk(3, 'gering')];
  evictOldest(errors);
  check('normal vor gering (chronologisch)', ids(errors), [2, 3]);
}
{
  // Nur kritische: dann muss doch der aelteste weichen, sonst waechst das Array unbegrenzt
  const errors = [mk(1, 'kritisch'), mk(2, 'kritisch')];
  evictOldest(errors);
  check('alles kritisch -> aeltester weicht', ids(errors), [2]);
}
{
  // Eintraege ohne level (aeltere Server-Version) gelten als verdraengbar
  const errors = [{ id: 1 }, mk(2, 'kritisch')];
  evictOldest(errors);
  check('fehlendes level ist verdraengbar', ids(errors), [2]);
}
{
  // Der eigentliche Bug-Fall: 1 kritischer + Flut trivialer Fehler, Cap 5
  const errors = [mk(0, 'kritisch')];
  for (let i = 1; i <= 20; i++) {
    errors.push(mk(i, 'normal'));
    while (errors.length > 5) evictOldest(errors);
  }
  check('Flut verdraengt den kritischen nicht', errors.some(e => e.level === 'kritisch'), true);
  check('Cap wird eingehalten', errors.length, 5);
}

console.log('\ncapKeepCritical (Client) — muss sich wie evictOldest verhalten');
{
  const errors = [mk(1, 'kritisch'), mk(2, 'normal'), mk(3, 'normal'), mk(4, 'normal')];
  check('normale weichen zuerst', ids(capKeepCritical(errors, 2)), [1, 4]);
}
{
  const errors = [mk(1, 'normal'), mk(2, 'normal'), mk(3, 'normal')];
  check('ohne kritische: die aeltesten weichen', ids(capKeepCritical(errors, 2)), [2, 3]);
}
{
  const errors = [mk(1, 'normal'), mk(2, 'normal')];
  check('unter dem Limit: unveraendert', ids(capKeepCritical(errors, 5)), [1, 2]);
}
{
  const errors = [mk(1, 'kritisch'), mk(2, 'kritisch'), mk(3, 'kritisch')];
  check('alles kritisch: aeltester weicht doch', ids(capKeepCritical(errors, 2)), [2, 3]);
}
{
  // Der Fall, der im Dashboard falsche Zahlen zeigte: eine Datei voller
  // kritischer Eintraege, danach treffen normale ein. Client und Server
  // muessen zu JEDEM Zeitpunkt dieselbe Anzahl kritischer halten.
  const server = Array.from({ length: 15 }, (_, i) => mk(i + 1, 'kritisch'));
  let client = server.slice();
  let gleich = true;
  const kritZahl = a => a.filter(e => e.level === 'kritisch').length;
  for (let i = 100; i < 112; i++) {
    server.push(mk(i, 'normal'));
    while (server.length > 20) evictOldest(server);
    client.push(mk(i, 'normal'));
    capKeepCritical(client, 20);
    if (kritZahl(server) !== kritZahl(client) || server.length !== client.length) gleich = false;
  }
  check('Client driftet nicht vom Server ab', gleich, true);
  check('kritische bleiben erhalten (15 von 20)', kritZahl(client), 15);
}

console.log('\nQuelltext-Abgleich (Spiegelung ist aktuell)');
{
  const ws = fs.readFileSync(path.join(root, 'server', 'watchService.js'), 'utf8');
  const utils = fs.readFileSync(path.join(root, 'public', 'js', 'utils.js'), 'utf8');
  const wsc = fs.readFileSync(path.join(root, 'public', 'js', 'wsClient.js'), 'utf8');
  const srv = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  check('watchService: evictOldest verdrahtet', ws.includes('evictOldest(errors)') && ws.includes('function evictOldest'), true);
  check('watchService: kein blindes errors.shift()', ws.includes('errors.shift()'), false);
  check('watchService: Snapshot liefert den ganzen Speicher', ws.includes('errors: errors.slice()'), true);
  check('watchService: kein zusaetzliches Kuerzen im Snapshot', ws.includes('selectWithCriticals'), false);
  check('utils: capKeepCritical vorhanden', utils.includes('capKeepCritical(entries, max)'), true);
  check('utils: altes trimKeepCritical entfernt', utils.includes('trimKeepCritical'), false);
  check('wsClient nutzt capKeepCritical', wsc.includes('Keasy.utils.capKeepCritical'), true);
  // Der Wert gilt woertlich: kein "* 2" mehr, sonst haelt der Client eine andere
  // Menge als der Server und das Dashboard zeigt eine falsche Anzahl.
  check('wsClient nutzt maxErrorsPerFile woertlich (kein * 2)', /maxErrorsPerFile \|\| 50\)/.test(wsc), true);
  check('wsClient: Verdopplung entfernt', /maxErrorsPerFile \|\| \d+\) \* 2/.test(wsc), false);
  check('watchService: Verdopplung entfernt', /maxErrorsPerFile \* 2/.test(ws), false);
  check('server.js schickt maxErrorsPerFile im init', /maxErrorsPerFile: config\.maxErrorsPerFile/.test(srv), true);
  check('watchService: findIndex-Logik identisch zur Spiegelung', ws.includes("errors.findIndex(e => e.level !== 'kritisch')"), true);
}

console.log(failed === 0 ? '\n✅ Alle Checks bestanden\n' : `\n❌ ${failed} Check(s) fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
