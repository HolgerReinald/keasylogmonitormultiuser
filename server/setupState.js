/**
 * Keasy Log Monitor — Setup-Status (Erste Schritte)
 *
 * Ein frisch verteiltes Paket hat keine config.js; bootstrapConfig() erzeugt sie
 * aus config.default.js mit `watchPaths: []`. Das Dashboard zeigte in diesem
 * Zustand „✅ Keine Fehler — Überwache Log-Dateien…": ein grünes Häkchen und die
 * Behauptung, es werde überwacht, obwohl nichts eingerichtet ist.
 *
 * Dieses Modul beantwortet je Einrichtungsschritt nur EINE Frage: erledigt oder
 * nicht. Bewusst nur Wahrheitswerte — keine Pfade, keine Hosts, keine Namen.
 * Der Status geht in jede init-Nachricht, also auch an Nicht-Admins; er darf
 * nichts verraten, was im Dashboard nicht ohnehin sichtbar wäre.
 */

const { config } = require('./configStore');

// Auslieferungszustand der Fehlererkennung (BASE_DEFAULTS in toolExport.js).
// Stimmt die Liste damit überein, hat sie noch niemand angefasst.
const DEFAULT_FILTER = ['Exception', 'Fehler'];

// Gueltige Schritt-IDs. Eine Quelle fuer alles: Whitelist der Abhak-Route,
// Reihenfolge im Dashboard, Pruefung im Test.
// 'pw' gibt es hier bewusst NICHT: das Rechtesystem wird unter Allgemein per
// Checkbox aktiviert, und wer es einsetzt, weiss was er tut. Der Hinweis auf
// admin/admin steht deshalb im Text des Allgemein-Schritts.
const SETUP_IDS = ['paths', 'allg', 'reg', 'mail', 'ana', 'bak'];

// Abhakbar ist ALLES -- auch der Pflichtschritt. Er wird zwar nicht einzeln
// zum Wegklicken angeboten (die Karte zeigt bei ihm kein "brauche ich nicht"),
// aber "Nicht mehr anzeigen" muss die Karte auch dann schliessen koennen, wenn
// noch kein Watchpath existiert: wer das Werkzeug nur fuer die Log-Analyse
// nutzt, legt nie einen an. Stand 'paths' hier nicht drin, antwortete der
// Server auf genau diesen Klick mit "Unbekannter Schritt" (2026-09-01).
const ABHAKBAR = [...SETUP_IDS];

function istStandardFilter(patterns) {
  const list = Array.isArray(patterns) ? patterns : [];
  if (list.length !== DEFAULT_FILTER.length) return false;
  return DEFAULT_FILTER.every((p, i) => list[i] === p);
}

/**
 * Einmalige Unterscheidung Neuinstallation / Bestand.
 *
 * Die Karte ist für eine Installation gedacht, in der noch nichts eingerichtet
 * ist — typischerweise ein frisch verteiltes Paket, aber die Erkennung hängt
 * NICHT an der Weitergabe: geprüft wird schlicht, ob es schon Watchpaths gibt.
 * Das trifft auch die gewachsene Ur-Installation, aus der die Weitergabe erst
 * später entstanden ist; sie hat nie ein Paket gesehen und soll die Karte
 * trotzdem nicht bekommen.
 *
 * Ohne diese Erkennung poppt sie nach einem Update bei jeder eingerichteten
 * Installation auf, die irgendein optionales Feature nicht nutzt — am
 * 2026-09-01 genau so passiert: eine vollständig konfigurierte Instanz begrüßte
 * den Betreiber mit „Grundeinrichtung steht · 2 offen".
 *
 * Erkennungsmerkmal: `setupCompleted` fehlt (die Installation kennt das Feld
 * noch nicht) UND es gibt bereits Watchpaths. Dann war hier schon jemand am
 * Werk — der Assistent hat nichts mehr beizutragen.
 *
 * Ein gesetztes Feld (auch `false`) bedeutet „schon entschieden" und wird nicht
 * angefasst.
 */
function migriereBestandsinstallation() {
  if (config.setupCompleted !== undefined) return false;
  if ((config.watchPaths || []).length === 0) return false;

  const configStore = require('./configStore');
  const neu = { ...config, setupCompleted: true };
  configStore.writeConfig(neu);
  configStore.replaceConfig(neu);
  console.log('ℹ️  Bestehende Installation erkannt — Einrichtungshinweise bleiben ausgeblendet.');
  return true;
}

/**
 * @param {boolean} istAdmin — nur Admins können die Schritte überhaupt ausführen
 *   (alle betroffenen Felder sind data-admin-only). Für alle anderen entfällt
 *   die Karte, sonst fordert sie zu etwas auf, das gesperrt ist.
 * @param {string} [username] — KI-Export-Pfade und Analyse-Pfade werden PRO
 *   BENUTZER gespeichert (userConfigStore). Ohne den Namen sieht man nur die
 *   globale Vorgabe und meldet „nicht eingerichtet", obwohl der Betreiber
 *   beides längst nutzt — am 2026-09-01 genau so passiert.
 */
function getSetupState(istAdmin, username) {
  if (!istAdmin) return { zeigen: false };

  // Lazy, um die Ladereihenfolge der Module nicht zu verdrahten
  const userConfigStore = require('./userConfigStore');
  const userCfg = username ? userConfigStore.getUserConfig(username) : null;
  const ausUser = (feld) => userCfg ? userCfg[feld] : undefined;

  const kiPfad = !!(ausUser('copilotWorkingPathDevelop') || ausUser('copilotWorkingPathRelease')
                    || config.copilotWorkingPathDevelop || config.copilotWorkingPathRelease);
  const anaPfade = (ausUser('analyzePaths') || config.analyzePaths || []).length > 0;
  const backupZiel = !!((config.backup && config.backup.locals || []).length
                        || (config.backup && config.backup.ftp && config.backup.ftp.host));

  return {
    zeigen: true,
    // erledigt[key] === true ⇒ Schritt ist tatsächlich eingerichtet
    erledigt: {
      paths: (config.watchPaths || []).length > 0,
      allg: kiPfad,
      reg: !istStandardFilter(config.filterPatterns),
      mail: !!(config.email && config.email.enabled && config.email.smtp && config.email.smtp.host),
      ana: anaPfade,
      bak: backupZiel
    },
    // Bewusst weggeklickte EINZELPUNKTE ("brauche ich nicht").
    abgehakt: Array.isArray(config.setupDismissed) ? config.setupDismissed : [],
    // Der Assistent ist als Ganzes erledigt: entweder war die Installation beim
    // Update schon eingerichtet, oder jemand hat "Nicht mehr anzeigen" geklickt.
    // Bewusst ein EIGENES Feld: teilte es sich das Array mit den Einzelpunkten,
    // nähme ein Zurückholen der Punkte auch diese Entscheidung mit zurück.
    fertig: config.setupCompleted === true
  };
}

module.exports = { getSetupState, migriereBestandsinstallation,
                   istStandardFilter, DEFAULT_FILTER, SETUP_IDS, ABHAKBAR };
