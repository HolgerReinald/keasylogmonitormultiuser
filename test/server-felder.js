// Vom Server verwaltete Config-Felder ueberleben das Speichern.
//
// Fehlerbild (2026-09-09): nach dem Entfernen einer Fehlererkennung stand der
// Einrichtungsassistent wieder da, obwohl er laengst abgeschlossen war.
//
// Ursache: buildConfigFromForm() im Client baut die Config bei jedem Speichern
// aus den Formularfeldern NEU auf. setupCompleted und setupDismissed haben kein
// Bedienelement, kommen im Body also gar nicht vor -- und POST /api/config
// schrieb den Body ungeprueft in die config.js. Beim naechsten Neustart setzte
// migriereBestandsinstallation() setupCompleted still wieder, weshalb das
// Verhalten zufaellig wirkte: nach jedem Neustart weg, nach jedem Speichern da.
//
// Teil 1 stellt den Datenverlust echt nach (kein DOM noetig), Teil 2 prueft die
// Verdrahtung in der Route.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let failed = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const bad = (name, detail) => { console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); failed++; };
const check = (name, cond, detail) => cond ? ok(name) : bad(name, detail);

const setupState = require(path.join(root, 'server/setupState.js'));
const routes = read('server/routes/configRoutes.js');
const configPanel = read('public/js/configPanel.js');

console.log('\n1) Der Datenverlust ist nachgestellt');
{
  const { SERVER_FELDER } = setupState;
  check('SERVER_FELDER wird exportiert', Array.isArray(SERVER_FELDER) && SERVER_FELDER.length > 0);
  check('setupCompleted steht drin', SERVER_FELDER.includes('setupCompleted'));
  check('setupDismissed steht drin', SERVER_FELDER.includes('setupDismissed'));

  // So sieht die gespeicherte Config aus ...
  const bestand = {
    port: 3847,
    filterPatterns: ['Exception', 'Fehler', 'disposed'],
    setupCompleted: true,
    setupDismissed: ['mail', 'bak']
  };
  // ... und so der Body, den der Client nach dem Entfernen von "disposed"
  // schickt: aus den Formularfeldern neu gebaut, ohne die Server-Felder.
  const vomClient = {
    port: 3847,
    filterPatterns: ['Exception', 'Fehler']
  };

  // Die Rettung, wie sie in der Route steht.
  const gerettet = { ...vomClient };
  for (const feld of SERVER_FELDER) {
    if (gerettet[feld] === undefined && bestand[feld] !== undefined) {
      gerettet[feld] = bestand[feld];
    }
  }

  check('ohne Rettung ginge setupCompleted verloren', vomClient.setupCompleted === undefined,
    'Sonst bildet der Test den Fehler gar nicht ab');
  check('setupCompleted ueberlebt', gerettet.setupCompleted === true,
    'Genau der Verlust, der den Assistenten wieder auftauchen liess');
  check('setupDismissed ueberlebt', JSON.stringify(gerettet.setupDismissed) === '["mail","bak"]',
    'Sonst kommen auch die einzeln weggeklickten Punkte zurueck');
  check('die echte Aenderung kommt durch', JSON.stringify(gerettet.filterPatterns) === '["Exception","Fehler"]',
    'Die Rettung darf das Speichern nicht aushebeln — "disposed" muss entfernt bleiben');

  // Gegenprobe: ein Feld, das der Client MITSCHICKT, wird nicht ueberschrieben.
  const mitLeerung = { setupDismissed: [] };
  for (const feld of SERVER_FELDER) {
    if (mitLeerung[feld] === undefined && bestand[feld] !== undefined) {
      mitLeerung[feld] = bestand[feld];
    }
  }
  check('ein mitgeschicktes Feld gewinnt', JSON.stringify(mitLeerung.setupDismissed) === '[]',
    'Nur FEHLENDE Felder werden ergaenzt — sonst liesse sich eine Liste nie mehr leeren');
}

console.log('\n2) Die Route benutzt die Rettung');
{
  check('configRoutes importiert SERVER_FELDER',
    /const \{ SERVER_FELDER \} = require\('\.\.\/setupState'\);/.test(routes));

  const i = routes.indexOf("'POST /api/config'");
  const post = routes.slice(i, routes.indexOf("'POST /api/setup", i) === -1 ? undefined : routes.indexOf("'POST /api/setup", i));
  check('Schleife ueber SERVER_FELDER im POST-Zweig', /for \(const feld of SERVER_FELDER\)/.test(post));
  check('nur fehlende Felder werden ergaenzt', /globalConfig\[feld\] === undefined/.test(post));

  // Reihenfolge: die Rettung muss VOR dem Schreiben stehen.
  const iRettung = post.indexOf('for (const feld of SERVER_FELDER)');
  const iSchreiben = post.indexOf('configStore.writeConfig(globalConfig)');
  check('Rettung steht VOR writeConfig', iRettung !== -1 && iSchreiben !== -1 && iRettung < iSchreiben,
    'Danach waere das Feld bereits aus der config.js verschwunden');
  const iAnwenden = post.indexOf('applyConfigChanges(globalConfig)');
  check('Rettung steht VOR applyConfigChanges', iRettung < iAnwenden,
    'Sonst laeuft der Server bis zum naechsten Neustart mit dem geleerten Feld');
}

console.log('\n3) Der Client kann die Felder gar nicht liefern');
{
  // Nicht "der Client soll sie mitschicken" — er kennt sie nicht und soll sie
  // auch nicht kennen. Der Test haelt fest, dass die Rettung serverseitig noetig
  // BLEIBT: taucht hier eines der Felder auf, ist die Zustaendigkeit verrutscht.
  for (const feld of setupState.SERVER_FELDER) {
    check(`${feld} steht nicht in buildConfigFromForm`, !configPanel.includes(feld),
      'Server-Felder gehoeren nicht ins Formular — die Rettung liegt beim Server');
  }
}

console.log(failed === 0 ? '\n✅ Server-Felder ueberleben das Speichern\n' : `\n❌ ${failed} Problem(e)\n`);
process.exit(failed === 0 ? 0 : 1);
