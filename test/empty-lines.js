// Leerzeilen in Fehler-Eintraegen ausblenden -- Laufzeit + Verdrahtung, kein Server.
//
// Anlass 2026-09-03: im WorkflowServer-Log des Live-Systems standen grosse
// Luecken in den Fehler-Eintraegen. parseLogEntries() haengt jede Zeile ohne
// Zeitstempel an den laufenden Eintrag, und das Keasy-Fehlerformat setzt
// strukturell Leerzeilen (nach "Der folgende #Fehler ist aufgetreten:", nach
// "Stack trace:", nach "InnerException:"). Mit white-space: pre-wrap zaehlt
// jede davon als Hoehe -- gemessen 114 von 966 angezeigten Zeilen.
//
// Geprueft werden die Stellen, an denen das realistisch schiefgeht:
//   1. Zeilen aus reinen Tabs bleiben stehen (=== '' statt trim())
//   2. die Option schaltet nicht wirklich
//   3. das Stack-Trace-Limit und die Leerzeilen-Logik stolpern uebereinander
//   4. die Fehlererkennung aendert sich mit (dann fehlen ploetzlich Fehler)
//   5. die Option fehlt im Weitergabe-Paket und kommt beim Empfaenger nur
//      ueber den !== false-Default an
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const { limitStackTrace, matchesFilter } = require(path.join(root, 'server', 'logParser'));
const configStore = require(path.join(root, 'server', 'configStore'));

let failed = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const bad = (name, detail) => { console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); failed++; };
const check = (name, cond, detail) => cond ? ok(name) : bad(name, detail);

// Ein echter Keasy-Fehlerblock, gekuerzt auf das Wesentliche. Zeile 8 besteht
// aus reinen Tabs -- optisch leer, technisch nicht (so im Original vorhanden).
const BLOCK = [
  '03.09.26 06:07:24.382\t================================================================',
  'Der folgende #Fehler ist aufgetreten:',
  '',
  '\tType:       OAuthTokenInvalidException',
  '\tMessage:    Office365 Login-Token ist nicht mehr gültig.',
  '\tStack trace:',
  '',
  '\t\t\t',
  '   at Keasy.Module.Tools.Email.ExchangeTools.GetEWSSerivce(IExchangeCredentials user)',
  '   at Keasy.Module.BusinessObjects.EmailAblage.EmailAblageObjekt.DownloadEmails()',
  '\t----------------',
  '\tInnerException:',
  '',
  '\t\t\tType:       MsalUiRequiredException',
  '================================================================================'
].join('\n');

const INHALT = BLOCK.split('\n').filter(z => z.trim() !== '');

// Config umschalten OHNE writeConfig -- die Datei auf der Platte bleibt
// unberuehrt (gleiches Vorgehen wie in setup-wiring.js).
const vorher = JSON.parse(JSON.stringify(configStore.config));
function mitOption(wert, fn) {
  const cfg = JSON.parse(JSON.stringify(vorher));
  if (wert === undefined) delete cfg.hideEmptyLines;
  else cfg.hideEmptyLines = wert;
  configStore.replaceConfig(cfg);
  return fn();
}

try {
  console.log('\n1) Option an: Whitespace-Zeilen fallen weg, Inhalt bleibt');
  {
    const zeilen = mitOption(true, () => limitStackTrace(BLOCK).split('\n'));
    check('keine Whitespace-Zeile mehr uebrig',
      zeilen.every(z => z.trim() !== ''),
      'uebrig: ' + JSON.stringify(zeilen.filter(z => z.trim() === '')));
    check('Zeile aus reinen Tabs ist ebenfalls weg',
      !zeilen.includes('\t\t\t'),
      'trim() statt "=== \'\'" -- sonst bleibt sie als leere Zeile stehen');
    check('alle Inhaltszeilen unveraendert und in gleicher Reihenfolge',
      JSON.stringify(zeilen) === JSON.stringify(INHALT),
      'Der Eingriff darf nur weglassen, nicht umschreiben oder umsortieren');
    check('vier Zeilen weniger', BLOCK.split('\n').length - zeilen.length === 4,
      `gefunden: ${BLOCK.split('\n').length} -> ${zeilen.length}`);
  }

  console.log('\n2) Option aus: Leerzeilen bleiben');
  {
    const zeilen = mitOption(false, () => limitStackTrace(BLOCK).split('\n'));
    check('Leerzeilen erhalten', zeilen.filter(z => z.trim() === '').length === 4,
      'Die Option muss wirklich schalten, sonst ist sie Zierde');
    check('Zeilenzahl unveraendert', zeilen.length === BLOCK.split('\n').length, null);
  }

  console.log('\n3) Fehlendes Feld gilt als "an" (bestehende config.js kennt es nicht)');
  {
    const zeilen = mitOption(undefined, () => limitStackTrace(BLOCK).split('\n'));
    check('wirkt wie eingeschaltet', zeilen.every(z => z.trim() !== ''),
      'config.js ist gitignored -- ohne "!== false" waere die Option bei jeder ' +
      'bestehenden Installation stillschweigend aus');
  }

  console.log('\n4) Stack-Trace-Limit bleibt daneben wirksam');
  {
    const viele = ['03.09.26 06:07:24.382\tFehler', '', ...Array.from(
      { length: 9 }, (_, i) => `   at Irgendwas.Methode${i}()`), '', 'Ende'].join('\n');
    const zeilen = mitOption(true, () => limitStackTrace(viele).split('\n'));
    check('nur 5 at-Zeilen', zeilen.filter(z => /^\s+at\s/.test(z)).length === 5, null);
    check('Auslassungs-Marker steht da',
      zeilen.some(z => z.includes('weitere Stack-Trace-Zeilen ausgeblendet')),
      'Das continue fuer Leerzeilen darf den Marker-Zweig nicht ueberspringen');
    check('Marker steht vor der Schlusszeile',
      zeilen.indexOf('Ende') === zeilen.length - 1, null);
  }

  console.log('\n5) Die Fehlererkennung bleibt unberuehrt');
  {
    // matchesFilter laeuft in watchService/analysisService auf dem ROHTEXT,
    // limitStackTrace erst danach. Beide Formen muessen gleich bewertet werden,
    // sonst verschwinden Fehler, sobald die Option greift.
    const roh = matchesFilter(BLOCK);
    const gekuerzt = mitOption(true, () => matchesFilter(limitStackTrace(BLOCK)));
    check('Rohform wird als Fehler erkannt', roh === true, null);
    check('gekuerzte Form ebenso', gekuerzt === roh, null);
  }
} finally {
  configStore.replaceConfig(vorher);
}

console.log('\n6) Reihenfolge im Aufrufer: erst pruefen, dann kuerzen');
{
  const watch = read('server/watchService.js');
  const ana = read('server/analysisService.js');
  for (const [name, src] of [['watchService', watch], ['analysisService', ana]]) {
    const iFilter = src.indexOf('matchesFilter(');
    const iLimit = src.indexOf('limitStackTrace(');
    check(`${name}: matchesFilter steht vor limitStackTrace`,
      iFilter !== -1 && iLimit !== -1 && iFilter < iLimit,
      'Umgekehrt wuerde auf gekuerztem Text gefiltert -- ein Fehler, dessen ' +
      'Kennwort in einer weggelassenen Zeile stand, waere verschwunden');
  }
}

console.log('\n7) Verdrahtung der Option');
{
  const html = read('public/index.html');
  const panel = read('public/js/configPanel.js');
  const exp = read('server/toolExport.js');

  check('Checkbox in index.html', /id="cfg-hideEmptyLines"/.test(html), null);
  check('nur fuer Admins', /id="cfg-hideEmptyLines" data-admin-only/.test(html),
    'Ohne data-admin-only koennte ein Nicht-Admin die globale Config aendern');
  check('Erklaerung im title', /Leerzeichen oder Tabs enthalten/.test(html), null);

  check('configPanel laedt den Wert', /cfg-hideEmptyLines'\)\.checked = cfg\.hideEmptyLines !== false/.test(panel),
    'Mit "!!cfg.hideEmptyLines" waere die Checkbox bei fehlendem Feld leer, ' +
    'obwohl die Funktion aktiv ist');
  check('configPanel speichert den Wert',
    /hideEmptyLines: document\.getElementById\('cfg-hideEmptyLines'\)\.checked/.test(panel),
    'Laden ohne Speichern: die Checkbox springt beim naechsten Oeffnen zurueck');

  check('Default im Weitergabe-Paket', /hideEmptyLines: true/.test(exp), null);
  check('in der Sektion "Allgemeine Optionen"',
    /general: \[[\s\S]*?'hideEmptyLines'[\s\S]*?\]/.test(exp),
    'Sonst fehlt die Option im Paket und kommt beim Empfaenger nur ueber den Default an');
}

console.log(failed ? `\n❌ ${failed} Problem(e)\n` : '\n✅ Leerzeilen-Ausblendung korrekt verdrahtet\n');
process.exit(failed ? 1 : 0);
