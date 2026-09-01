// Verdrahtungs- und Logikpruefung der Einrichtungskarte ("Erste Schritte").
//
// Anlass: ein frisch verteiltes Paket hat keine Watchpaths (config.default.js
// liefert `watchPaths: []`). Das Dashboard zeigte dann "✅ Keine Fehler --
// Überwache Log-Dateien…": ein gruenes Haekchen und die Behauptung, es werde
// ueberwacht, obwohl nichts eingerichtet ist. Dazu legt userStore bei fehlender
// users.json still admin/admin an -- die Warnung ging nur in die Konsole.
//
// Geprueft wird beides: die Zustandslogik am echten Modul (die laesst sich in
// Node vollstaendig durchspielen) und die Verdrahtung im Frontend (dort nicht,
// mangels DOM).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

let failed = 0;
const ok = (name) => console.log(`  ok   ${name}`);
const bad = (name, detail) => { console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); failed++; };
const check = (name, cond, detail) => cond ? ok(name) : bad(name, detail);

const setupState = require(path.join(root, 'server', 'setupState'));

console.log('\n1) Schritt-Liste: eine Quelle fuer Server und Client');
{
  const panel = read('public/js/setupPanel.js');
  const ids = setupState.SETUP_IDS;
  check('6 Schritte definiert', ids.length === 6, 'sind: ' + ids.join(', '));
  // 'pw' gehoert ausdruecklich NICHT dazu: das Rechtesystem wird unter Allgemein
  // per Checkbox aktiviert, der Hinweis auf admin/admin steht in dessen Text.
  check('kein eigener Benutzer-Schritt', !ids.includes('pw'),
    'Das Thema Rechtesystem/Passwort gehoert in den Allgemein-Schritt');
  check('Allgemein nennt das Rechtesystem', /Rechtesystem/.test(panel));
  for (const id of ids) {
    check(`Client kennt "${id}"`, new RegExp("id: '" + id + "'").test(panel),
      'setupPanel.js muss dieselben ids fuehren wie server/setupState.js');
  }
  // Abhakbar ist ALLES -- auch der Pflichtschritt. Er wird nicht einzeln zum
  // Wegklicken angeboten (die Karte zeigt bei ihm kein "brauche ich nicht"),
  // aber "Nicht mehr anzeigen" muss die Karte auch bei fehlendem Watchpath
  // schliessen koennen: wer nur die Log-Analyse nutzt, legt nie einen an.
  // Fehlte 'paths' in der Whitelist, antwortete der Server auf genau diesen
  // Klick mit "Unbekannter Schritt" (2026-09-01).
  check('alle Schritte sind serverseitig abhakbar',
    setupState.ABHAKBAR.length === ids.length,
    'ABHAKBAR: ' + setupState.ABHAKBAR.join(', '));
  check('"Nicht mehr anzeigen" deckt auch den Pflichtschritt',
    setupState.ABHAKBAR.includes('paths'),
    'Sonst laeuft der Klick bei einer frischen Installation in einen 400er');
  // ... im Dashboard bleibt der Unterschied trotzdem sichtbar:
  check('Pflichtschritt hat kein eigenes "brauche ich nicht"',
    !/step-pflicht[\s\S]{0,400}brauche ich nicht/.test(read('public/js/setupPanel.js')),
    'Sonst waere die Unterscheidung Pflicht/Angebot in der Karte bedeutungslos');
}

console.log('\n2) Zustandslogik am echten Modul');
{
  // Nicht-Admins duerfen die Karte nie sehen: alle Ziele sind data-admin-only,
  // die Karte wuerde zu etwas auffordern, das gesperrt ist.
  const nichtAdmin = setupState.getSetupState(false);
  check('Nicht-Admin bekommt nur { zeigen: false }',
    nichtAdmin.zeigen === false && nichtAdmin.erledigt === undefined,
    'Der Status geht an jeden Client -- er darf fuer Nicht-Admins nichts enthalten');

  const admin = setupState.getSetupState(true);
  check('Admin bekommt den vollen Status', admin.zeigen === true && !!admin.erledigt);
  for (const id of setupState.SETUP_IDS) {
    check(`Status enthaelt "${id}"`, typeof admin.erledigt[id] === 'boolean');
  }

}

console.log('\n3) Standard-Filter erkennen (Auslieferungszustand)');
{
  check('Auslieferung = Standard', setupState.istStandardFilter(['Exception', 'Fehler']));
  check('erweitert = angepasst', !setupState.istStandardFilter(['Exception', 'Fehler', 'Timeout']));
  check('umsortiert = angepasst', !setupState.istStandardFilter(['Fehler', 'Exception']));
  check('leer = angepasst', !setupState.istStandardFilter([]));
  check('undefined faellt nicht um', !setupState.istStandardFilter(undefined));
  // Muss zu BASE_DEFAULTS in toolExport.js passen, sonst meldet die Karte
  // "Regeln angepasst" fuer ein frisch ausgeliefertes Paket.
  const exp = read('server/toolExport.js');
  check('deckt sich mit BASE_DEFAULTS in toolExport.js',
    /filterPatterns: \['Exception', 'Fehler'\]/.test(exp),
    'Weicht der Auslieferungswert ab, ist DEFAULT_FILTER in setupState.js nachzuziehen');

  // Der Schritt "Regeln" steht fuer den ganzen Tab, nicht nur fuer die Filter:
  // wer Schwellwerte anlegt und die Filter so laesst, hat ihn bearbeitet.
  const cs = require(path.join(root, 'server', 'configStore'));
  const sichern = JSON.parse(JSON.stringify(cs.config));
  const basis = { filterPatterns: ['Exception', 'Fehler'], excludePatterns: [], thresholdRules: [], priorityRules: [] };
  try {
    cs.replaceConfig({ ...sichern, ...basis });
    check('Auslieferung gilt als nicht angepasst', setupState.regelnAngepasst() === false);
    for (const [feld, wert] of [['filterPatterns', ['Exception', 'Fehler', 'Timeout']],
                                ['excludePatterns', ['WARNUNG']],
                                ['thresholdRules', [{ name: 'x' }]],
                                ['priorityRules', [{ name: 'y' }]]]) {
      cs.replaceConfig({ ...sichern, ...basis, [feld]: wert });
      check(`"${feld}" allein reicht`, setupState.regelnAngepasst() === true,
        'Nur auf filterPatterns zu sehen war zu eng');
    }
  } finally {
    cs.replaceConfig(sichern);
  }
}

console.log('\n4) Server-Verdrahtung');
{
  const srv = read('server.js');
  check('setupState geht in die init-Nachricht', /setupState: require\('\.\/server\/setupState'\)\.getSetupState\(/.test(srv));
  check('Rolle entscheidet ueber den Inhalt', /session\.role === 'admin' \|\| !configStore\.isAuthEnabled\(\)/.test(srv));

  const routes = read('server/routes/configRoutes.js');
  check('Route zum Abhaken vorhanden', /'POST \/api\/setup-dismiss'/.test(routes));
  check('Whitelist gegen beliebige Werte', /setupState\.ABHAKBAR\.includes\(id\)/.test(routes),
    'Der Wert landet in der Config und spaeter im Markup');
  check('kein eigener Admin-Check in der Route', !/Nur fuer Administratoren/.test(routes),
    'Der Schutz laeuft zentral ueber ADMIN_ONLY_ROUTES -- zwei Stellen waeren zwei Wahrheiten');

  const router = read('server/httpRouter.js');
  check('Route steht in ADMIN_ONLY_ROUTES', /'POST \/api\/setup-dismiss'/.test(router));

  const ws = read('server/wsBroadcast.js');
  check('broadcastSetupState vorhanden', /function broadcastSetupState\(\)/.test(ws));
  check('pro Client nach Rolle berechnet', /client\.role === 'admin'/.test(ws),
    'Ein pauschaler Broadcast wuerde Nicht-Admins den Admin-Status schicken');
  check('wird nach dem Config-Speichern gerufen',
    (routes.match(/broadcastSetupState\(\)/g) || []).length >= 2,
    'Sonst bleibt die Karte stehen, nachdem der Watchpath angelegt wurde');
}

console.log('\n5) Client-Verdrahtung');
{
  const html = read('public/index.html');
  const panel = read('public/js/setupPanel.js');
  const render = read('public/js/render.js');
  const wsc = read('public/js/wsClient.js');
  const cfgPanel = read('public/js/configPanel.js');
  const css = read('public/style.css');

  check('setupPanel.js ist eingebunden', /<script src="js\/setupPanel\.js" defer><\/script>/.test(html));
  check('vor actions.js geladen',
    html.indexOf('js/setupPanel.js') < html.indexOf('js/actions.js'),
    'actions.js nutzt die Globals aus setupPanel.js');
  check('Platz fuer die Pille im Kopf', /id="setupPill"/.test(html));

  // Die Karte schwebt in einem eigenen fixierten Host und liegt NICHT im
  // Seitenfluss -- inline verschob sie beim Auf-/Zuklappen die Fehlerliste.
  check('eigener Host im Markup', /id="setupHost"/.test(html));
  check('Host liegt aussernhalb von app-main'.replace('aussernhalb', 'ausserhalb'),
    html.indexOf('id="setupHost"') > html.indexOf('</div>\n\n  <script'),
    'Im Seitenfluss wuerde die Karte wieder etwas verschieben');
  check('Karte kommt nicht mehr in den Container-HTML',
    !/buildSetupCardHtml\(\)[\s\S]{0,40}\+ html/.test(render),
    'Sonst liegt sie doch im Seitenfluss');
  check('Karte wird in den Host gezeichnet',
    /function renderSetupCard\(\)[\s\S]{0,220}getElementById\('setupHost'\)/.test(panel));
  check('position: fixed in der CSS-Regel',
    /\.wz \{[^}]*position: fixed/.test(css),
    'Ohne fixed verschiebt die Karte wieder das Layout');

  // Der Leerzustand darf nicht "Keine Fehler" behaupten, wenn nichts eingerichtet
  // ist -- wer die Karte einklappt, sieht sonst nur das gruene Haekchen.
  check('Leerzustand kennt "nicht eingerichtet"', /Noch nichts eingerichtet/.test(render),
    'Ohne Watchpath wird nichts ueberwacht -- "Keine Fehler" waere eine Falschaussage');
  check('haengt am Pflichtschritt', /Keasy\.setup\.pflichtOffen\(\)/.test(render));
  check('pflichtOffen ist exportiert', /pflichtOffen/.test(panel) && /pflichtOffen \}/.test(panel) === false || /fortschritt, pflichtOffen/.test(panel));

  check('init uebernimmt den Status', /state\.setupState = msg\.setupState \|\| \{ zeigen: false \}/.test(wsc));
  check("Ereignis 'setup-state' wird verarbeitet", /msg\.type === 'setup-state'/.test(wsc),
    'Ohne das bliebe die Karte auf dem Stand des Seitenaufbaus stehen');
  // Die Pause friert die Fehlerliste ein, nicht den Einrichtungsstand -- sonst
  // bleibt die Pille klickbar, obwohl der Server sie abgeschaltet hat.
  // Positionsvergleich statt Zeichenfenster: eine Regex mit fester Laenge reisst
  // beim naechsten Kommentar, ohne dass sich am Verhalten etwas geaendert haette.
  {
    const ab = wsc.indexOf("msg.type === 'setup-state'");
    const pill = wsc.indexOf('Keasy.setup.renderSetupPill();', ab);
    const paused = wsc.indexOf('if (!state.paused)', ab);
    check('Karte/Pille ziehen auch bei Pause nach',
      ab !== -1 && pill !== -1 && paused !== -1 && pill < paused,
      'renderSetupPill muss VOR der paused-Abfrage stehen -- die Pause friert die ' +
      'Fehlerliste ein, nicht den Einrichtungsstand');
  }

  for (const fn of ['setupGoto', 'setupDismiss', 'setupFertig', 'setupToggle']) {
    check(`${fn} ist global`, new RegExp('Object\\.assign\\(window,[^)]*' + fn).test(panel),
      'setupPanel.js liegt in einer IIFE -- ohne Export laeuft das onclick ins Leere');
  }
  check('Klick auf "brauche ich nicht" springt nicht mit',
    /function setupDismiss\(id, aus, event\) \{\s*\n\s*if \(event\) event\.stopPropagation\(\)/.test(panel),
    'Die Zeile selbst oeffnet den Tab -- ohne stopPropagation passiert beides');
  check('erledigt gewinnt ueber abgehakt',
    /return !istErledigt\(s\) && Array\.isArray\(st\.abgehakt\)/.test(panel),
    'Wer E-Mail spaeter doch einrichtet, soll das sehen');

  check('switchConfigTab haengt nicht mehr an event.target',
    !/^\s*event\.target\.classList\.add\('active'\);/m.test(cfgPanel),
    'Beim Aufruf aus der Karte waere event.target die Karte, nicht der Tab');
  check('Tab wird ueber den Namen gefunden', /\.find\(t => \(t\.getAttribute\('onclick'\) \|\| ''\)\.includes\("'" \+ tab \+ "'"\)\)/.test(cfgPanel));

  for (const klasse of ['.wz', '.wz-kopf', '.wz-koerper', '.wz-ring', '.wz-schritt', '.wz-weg']) {
    check(`${klasse} definiert`, new RegExp('\\' + klasse + '[\\s,{:]').test(css));
  }
  check('eingeklappt bleibt nur der Kopf', /\.wz\.zu \.wz-koerper/.test(css));
  check('Tab-Punkt definiert', /\.config-tab\.setup-todo::after/.test(css));
  check('Abhaken auch ohne Hover erreichbar', /@media \(hover: none\)[\s\S]{0,120}\.wz-weg/.test(css),
    'Die Aktion erscheint sonst nur bei Mauszeiger -- auf Touch unerreichbar');

  // Startzustand: geoeffnet. Nur ein ausdruecklich gemerktes '1' klappt zu.
  check('startet geoeffnet', /localStorage\.getItem\(KLAPP_KEY\) === '1'/.test(panel),
    'Mit umgekehrter Logik waere die Karte beim ersten Start eingeklappt');
  check('Klappzustand im localStorage, nicht in der Config',
    /const KLAPP_KEY = 'keasy-setup-zu'/.test(panel),
    'Auf-/zugeklappt ist Ansichtssache des Einzelnen, kein Zustand der Installation');
  check('Fortschritt zaehlt nur Erledigtes',
    /SCHRITTE\.filter\(istErledigt\)\.length/.test(panel),
    'Abgehaktes mitzuzaehlen behauptet Fortschritt, den es nicht gibt');
}

console.log('\n6) Frisch verteiltes Paket (BASE_DEFAULTS aus toolExport.js)');
{
  // Eigener Prozess: replaceConfig aendert nur diesen Speicher, die config.js
  // auf der Platte bleibt unberuehrt.
  const configStore = require(path.join(root, 'server', 'configStore'));
  const vorher = JSON.parse(JSON.stringify(configStore.config));
  try {
    configStore.replaceConfig({
      port: 3848, autoOpen: true, debugLogging: false, authEnabled: true,
      maxErrorsPerFile: 50, loadExistingErrors: true, maxLogFileSizeMB: 6,
      trashAutoCleanupHours: 48, watchPaths: [], filePattern: '**/*.log',
      filterPatterns: ['Exception', 'Fehler'], excludePatterns: [],
      thresholdRules: [], priorityRules: []
    });
    const s = setupState.getSetupState(true);
    check('Pflichtschritt ist offen', s.erledigt.paths === false,
      'Ohne Watchpath darf das Dashboard nicht "Keine Fehler" behaupten');
    for (const id of ['allg', 'reg', 'mail', 'ana', 'bak']) {
      check('"' + id + '" ist offen', s.erledigt[id] === false);
    }
    check('nichts vorab abgehakt', Array.isArray(s.abgehakt) && s.abgehakt.length === 0);
  } finally {
    configStore.replaceConfig(vorher);
  }
}

console.log('\n6b) Pro-Benutzer-Felder zaehlen mit');
{
  // Am 2026-09-01 meldete die Karte "KI-Export-Pfade" und "Analyse-Pfade" als
  // offen, obwohl der Betreiber beides nutzte: die Werte liegen in der
  // BENUTZER-Config (userConfigStore), geprueft wurde nur die globale.
  const srv = read('server.js');
  const ws = read('server/wsBroadcast.js');
  const st = read('server/setupState.js');
  check('getSetupState nimmt einen Benutzernamen', /function getSetupState\(istAdmin, username\)/.test(st));
  check('liest die Benutzer-Config', /userConfigStore\.getUserConfig\(username\)/.test(st));
  check('KI-Pfade: Benutzer vor global', /ausUser\('copilotWorkingPathDevelop'\)/.test(st));
  check('Analyse-Pfade: Benutzer vor global', /ausUser\('analyzePaths'\)/.test(st));
  check('init reicht session.username durch', /getSetupState\([\s\S]{0,160}session\.username/.test(srv),
    'Ohne Namen sieht der Status nur die globale Vorgabe');
  check('Broadcast reicht client.username durch', /client\.username\)/.test(ws));
  check('kein bcrypt mehr im Setup-Status', !/bcrypt/.test(st),
    'Die Passwort-Pruefung ist mit dem Benutzer-Schritt entfallen');
}

console.log('\n6c) Bestandsinstallation bekommt die Karte NICHT');
{
  // Die Karte ist fuer frisch verteilte Pakete gedacht. Ohne diese Migration
  // poppt sie nach einem Update bei jeder eingerichteten Installation auf, die
  // irgendein optionales Feature nicht nutzt.
  const configStore = require(path.join(root, 'server', 'configStore'));
  const vorher = JSON.parse(JSON.stringify(configStore.config));
  const echtWrite = configStore.writeConfig;
  let geschrieben = null;
  try {
    configStore.writeConfig = (c) => { geschrieben = c; };  // echte config.js nicht anfassen

    configStore.replaceConfig({ ...vorher, watchPaths: [{ path: 'C:/logs', label: 'A' }], setupCompleted: undefined });
    check('Bestand wird migriert', setupState.migriereBestandsinstallation() === true);
    // Eigenes Feld statt aller Einzelpunkte: sonst nimmt ein Zurueckholen der
    // Punkte die Migration mit zurueck -- und weil ein leeres Array frueher als
    // "schon migriert" galt, kam die Karte danach dauerhaft wieder (2026-09-01).
    check('setzt setupCompleted', geschrieben && geschrieben.setupCompleted === true,
      'geschrieben: ' + JSON.stringify(geschrieben && geschrieben.setupCompleted));
    check('fasst setupDismissed NICHT an',
      !geschrieben || geschrieben.setupDismissed === undefined ||
      JSON.stringify(geschrieben.setupDismissed) === JSON.stringify(vorher.setupDismissed),
      'Migration und bewusstes Abhaken muessen getrennt bleiben');

    geschrieben = null;
    configStore.replaceConfig({ ...vorher, watchPaths: [], setupCompleted: undefined });
    check('Neuinstallation wird NICHT migriert', setupState.migriereBestandsinstallation() === false,
      'Sonst bekaeme gerade der, fuer den die Karte gedacht ist, sie nie zu sehen');
    check('dabei nichts geschrieben', geschrieben === null);

    geschrieben = null;
    configStore.replaceConfig({ ...vorher, watchPaths: [{ path: 'C:/logs', label: 'A' }], setupCompleted: false });
    check('gesetztes Feld heisst "schon entschieden"', setupState.migriereBestandsinstallation() === false,
      'Auch ein ausdrueckliches false darf nicht bei jedem Start ueberschrieben werden');
    check('dabei nichts geschrieben', geschrieben === null);
  } finally {
    configStore.writeConfig = echtWrite;
    configStore.replaceConfig(vorher);
  }

  const srv = read('server.js');
  check('Migration laeuft beim Start', /migriereBestandsinstallation\(\)/.test(srv));
  // Bezugspunkt ist der Serverstart, nicht der connection-Handler: der steht
  // textuell weit oben, laeuft aber erst, wenn sich jemand verbindet.
  check('laeuft vor dem Serverstart',
    srv.indexOf('migriereBestandsinstallation()') < srv.lastIndexOf('startServer();'),
    'Sonst blitzt die Karte beim ersten Client einmal auf, bevor sie ausgeblendet wird');
}


console.log('\n6e) "Fertig" ist von den Einzelpunkten getrennt');
{
  const panel = read('public/js/setupPanel.js');
  const routes = read('server/routes/configRoutes.js');
  const st = read('server/setupState.js');

  check('Status liefert ein eigenes fertig-Flag', /fertig: config\.setupCompleted === true/.test(st));
  check('Karte bleibt weg, wenn fertig', /function istSichtbar\(\)[\s\S]{0,120}assistentAktiv\(\)/.test(panel),
    'Sonst kommt der Assistent nach dem Abschluss wieder');
  // Die Karte bleibt stehen, bis abgeschlossen wird -- nicht nur solange Punkte
  // offen sind. Sonst wird sie einem unter der Hand weggerissen, sobald man den
  // letzten offenen Punkt abhakt (2026-09-01 genau so gemeldet).
  check('Karte haengt nicht an offenen Punkten',
    /function istSichtbar\(\)[\s\S]{0,80}return assistentAktiv\(\);/.test(panel) &&
    !/istSichtbar[\s\S]{0,120}offeneSchritte\(\)\.length > 0/.test(panel),
    'Mit "&& offeneSchritte().length > 0" verschwindet sie beim Abhaken des letzten Punkts');
  check('kein Ruecksprung mehr, der Abhakungen zuruecknimmt',
    !/function setupReset/.test(panel) && !/istRueckwegNoetig/.test(panel),
    'Die Pille holte beim Klick ALLE abgehakten Punkte zurueck');

  // Die Frage "ist der Assistent aktiv?" wurde an vier Stellen unterschiedlich
  // beantwortet -- die Tab-Punkte blieben nach dem Abschluss stehen, weil dort
  // nur `zeigen` geprueft wurde. Jetzt gibt es EINE Funktion dafuer.
  check('assistentAktiv() als gemeinsame Wahrheit',
    /function assistentAktiv\(\)[\s\S]{0,120}!!st\.zeigen && !st\.fertig/.test(panel));
  check('Tab-Punkte verschwinden nach dem Abschluss',
    /const aktiv = assistentAktiv\(\);[\s\S]{0,200}if \(!aktiv\) continue;/.test(panel),
    'Sonst bleiben die grauen Punkte an Allgemein, E-Mail und Backup stehen');
  check('keine eigene zeigen-Pruefung in markiereTabs',
    !/function markiereTabs\(\)[\s\S]{0,300}state\.setupState && state\.setupState\.zeigen/.test(panel),
    'Eine zweite Wahrheit laeuft beim naechsten Umbau wieder auseinander');
  check('Leerzustand verweist nur auf eine sichtbare Karte',
    /Keasy\.setup\.istSichtbar\(\)[\s\S]{0,160}Einstellungen → Monitor|Keasy\.setup\.istSichtbar\(\)/.test(read('public/js/render.js')),
    'Sonst zeigt der Text auf eine Karte, die es nicht mehr gibt');
  check('Abschluss-Knopf schickt fertig:true', /JSON\.stringify\(\{ fertig: true \}\)/.test(panel),
    'Alle Punkte abzuhaken waere das alte Verhalten -- ein Zurueckholen nahm die Entscheidung mit');
  // Der Knopf hiess "Nicht mehr anzeigen". Das klang nach Unterdruecken und
  // wurde nicht als Abschluss erkannt: man geht die Punkte durch, entscheidet
  // je Punkt und sagt am Ende einmal "fertig".
  check('Knopf heisst "Einrichtung abgeschlossen"', /Einrichtung abgeschlossen/.test(panel),
    'Die alte Beschriftung wurde nicht als Abschluss verstanden');
  check('kein "Nicht mehr anzeigen" mehr', !/Nicht mehr anzeigen<\/button>/.test(panel));
  // Abgehaktes sah blass-kursiv aus und wirkte dadurch weiter offen.
  check('abgehakte Punkte werden durchgestrichen',
    /\.wz-schritt\.unnoetig \.nm \{ text-decoration: line-through; \}/.test(read('public/style.css')),
    'Erledigt und abgehakt sind beide abgearbeitet -- unterscheidbar bleiben sie am Zeichen');
  check('Abschluss ist als Hauptaktion gestaltet', /\.wz-fertig \{/.test(read('public/style.css')),
    'Als blasser Nebenknopf wurde er uebersehen');
  check('Route kennt das fertig-Flag', /body\.fertig !== undefined/.test(routes));
  check('Route schreibt setupCompleted', /setupCompleted: !!body\.fertig/.test(routes));
}

console.log('\n6d) Das Weitergabe-Paket traegt keine internen Pfade');
{
  // Am 2026-09-01 steckten die firmeninternen KI-Export-Pfade des Betreibers in
  // drei Paketdateien: als placeholder in index.html, als Beispiel in einem
  // CSS-Kommentar und in einem Historie-Eintrag. Keine aktiven Werte, aber die
  // Pfadstruktur wandert so in jedes verteilte Paket.
  const toolExport = require(path.join(root, 'server', 'toolExport'));
  const dateien = [];
  toolExport.collectPackageFiles(root, root, dateien);
  check('Paket enthaelt Dateien', dateien.length > 50, 'gefunden: ' + dateien.length);

  // Die Suchmuster aus Fragmenten zusammensetzen, sonst findet der Test seine
  // eigenen Literale und meldet sich selbst als betroffene Datei.
  const BS = String.fromCharCode(92);
  const verdaechtig = new RegExp(
    ['keasy' + 'repository', 'Keasy' + '_n8Dev', 'C:' + BS + BS + BS + BS + 'v' + 'fm'].join('|'), 'i');
  const treffer = dateien.filter(f => {
    try { return verdaechtig.test(fs.readFileSync(f.fullPath, 'utf8')); } catch { return false; }
  }).map(f => f.rel);
  check('keine firmeninternen Pfade im Paket', treffer.length === 0,
    'betroffen: ' + treffer.join(', ') + ' -- Beispielpfade neutral halten ' +
    '(z. B. C:' + BS + 'Repos' + BS + 'Projekt_Develop)');

  // Die Start-Config darf die Pro-Benutzer-Felder ohnehin nie enthalten
  const cfg = toolExport.buildExportConfig(['general', 'rules', 'watchPaths', 'email', 'backup']);
  for (const feld of ['copilotWorkingPathDevelop', 'copilotWorkingPathRelease', 'analyzePaths', 'setupDismissed']) {
    check(`"${feld}" nicht in der Auslieferungs-Config`, cfg[feld] === undefined);
  }
  // Umgekehrt MUSS setupCompleted: false drinstehen. Ein Paket ist immer eine
  // Neuinstallation; fehlte das Feld, wuerde die Bestandserkennung beim ersten
  // Start zuschlagen, sobald watchPaths mitexportiert wurde -- der Empfaenger
  // saehe den Assistenten dann nie.
  check('Paket markiert sich als Neuinstallation', cfg.setupCompleted === false,
    'setupCompleted im Paket: ' + JSON.stringify(cfg.setupCompleted));
  const mitPfaden = toolExport.buildExportConfig(['watchPaths']);
  check('auch mit mitgelieferten Watchpaths', mitPfaden.setupCompleted === false,
    'Gerade dieser Fall loest die Bestandserkennung sonst faelschlich aus');
  check('users/ ist vom Paket ausgeschlossen', !dateien.some(f => f.rel.startsWith('users/')),
    'Dort liegen die Pro-Benutzer-Pfade');

  // filePattern steht in der Oberflaeche unter *Allgemein -> Dateien & Fehler*
  // und gehoert deshalb in die Sektion "general". Frueher lag es bei den
  // Mustern: wer die abwaehlte, verlor unbemerkt sein **/*.log.
  const nurAllgemein = toolExport.buildExportConfig(['general']);
  const nurRegeln = toolExport.buildExportConfig(['rules']);
  check('filePattern haengt an "Allgemeine Optionen"',
    nurAllgemein.filePattern === require(path.join(root, 'server', 'configStore')).config.filePattern,
    'Sonst verliert man es beim Abwaehlen der Regeln');
  check('"rules" deckt alle vier Karten des Tabs ab',
    ['filterPatterns', 'excludePatterns', 'thresholdRules', 'priorityRules']
      .every(k => nurRegeln[k] !== undefined));

  // Der Weitergabe-Dialog nennt je Sektion, was trotz Haken NICHT mitgeht.
  // Diese Zusagen muessen zum Verhalten von buildExportConfig passen -- sonst
  // verspricht die Oberflaeche etwas, das der Export nicht einhaelt.
  const front = read('public/js/toolExport.js');
  const back = read('server/toolExport.js');
  check('Label nennt die KI-Export-Ausnahme', /KI-Export-Pfade ausgenommen/.test(front),
    'Sonst muss man im Quelltext nachsehen, was im Paket landet');
  check('… und der Export haelt sie ein', cfg.copilotWorkingPathDevelop === undefined);
  check('Label nennt fehlende Backup-Zugangsdaten', /Backup-Ziele & FTP \(ohne Zugangsdaten\)/.test(front));
  check('… und der Export entfernt Benutzer UND Passwort',
    /delete out\.backup\.ftp\.pass;/.test(back) && /delete out\.backup\.ftp\.user;/.test(back),
    '"ohne Passwort" allein waere zu wenig gewesen -- der Benutzername geht auch');
  check('Label nennt fehlende SMTP-Zugangsdaten', /E-Mail \/ SMTP \(ohne Zugangsdaten\)/.test(front));
  check('… und der Export entfernt sie', /delete out\.email\.smtp\.auth;/.test(back));
  // Der Hinweis gehoert ins Label, nicht in eine Zeile darunter: sonst waechst
  // die Sektionsliste in die Hoehe und der Dialog wird unruhig.
  check('kein Zusatztext unter der Checkbox', !/export-section-note/.test(front));
}



console.log(failed === 0 ? '\n✅ Einrichtungskarte ist korrekt verdrahtet\n' : `\n❌ ${failed} Problem(e)\n`);
process.exit(failed === 0 ? 0 : 1);
