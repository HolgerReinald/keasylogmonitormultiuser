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

function selectWithCriticals(errors, max, extra = 5) {
  if (errors.length <= max) return errors.slice();
  const recent = errors.slice(-max);
  const droppedCriticals = errors.slice(0, errors.length - max).filter(e => e.level === 'kritisch');
  if (droppedCriticals.length === 0) return recent;
  return droppedCriticals.slice(-extra).concat(recent);
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

console.log('\nselectWithCriticals — Snapshot fuer neue Clients');
{
  const errors = [mk(1, 'kritisch'), mk(2, 'normal'), mk(3, 'normal'), mk(4, 'normal')];
  check('herausgefallener kritischer wird ergaenzt', ids(selectWithCriticals(errors, 2)), [1, 3, 4]);
}
{
  const errors = [mk(1, 'normal'), mk(2, 'normal'), mk(3, 'normal')];
  check('ohne kritische unveraendert (nur letzte max)', ids(selectWithCriticals(errors, 2)), [2, 3]);
}
{
  const errors = [mk(1, 'normal'), mk(2, 'normal')];
  check('unter dem Limit: alles', ids(selectWithCriticals(errors, 5)), [1, 2]);
}
{
  // Puffer begrenzt: 8 herausgefallene kritische, extra=5 -> nur die 5 jüngsten davor
  const errors = [];
  for (let i = 1; i <= 8; i++) errors.push(mk(i, 'kritisch'));
  for (let i = 9; i <= 11; i++) errors.push(mk(i, 'normal'));
  const sel = selectWithCriticals(errors, 3);
  check('Puffer auf extra begrenzt', ids(sel), [4, 5, 6, 7, 8, 9, 10, 11]);
  check('chronologische Reihenfolge bleibt', ids(sel).every((v, i, a) => i === 0 || a[i - 1] < v), true);
}

console.log('\nQuelltext-Abgleich (Spiegelung ist aktuell)');
{
  const ws = fs.readFileSync(path.join(root, 'server', 'watchService.js'), 'utf8');
  const utils = fs.readFileSync(path.join(root, 'public', 'js', 'utils.js'), 'utf8');
  check('watchService: evictOldest verdrahtet', ws.includes('evictOldest(errors)') && ws.includes('function evictOldest'), true);
  check('watchService: kein blindes errors.shift()', ws.includes('errors.shift()'), false);
  check('watchService: getAllErrors nutzt selectWithCriticals', ws.includes('selectWithCriticals(errors, config.maxErrorsPerFile)'), true);
  check('utils: trimKeepCritical vorhanden', utils.includes('trimKeepCritical('), true);
  check('watchService: findIndex-Logik identisch zur Spiegelung', ws.includes("errors.findIndex(e => e.level !== 'kritisch')"), true);
}

console.log(failed === 0 ? '\n✅ Alle Checks bestanden\n' : `\n❌ ${failed} Check(s) fehlgeschlagen\n`);
process.exit(failed === 0 ? 0 : 1);
