# Keasy Log Monitor

## Multiuservariante (Rechte)
Diese Version ist nicht dazu gedacht lokal auf seinem PC einzusetzen. Die zu überwachenden Pfade werden vom Admin freigegeben. Man kann aber selbst entscheiden an welche E-Mail-Adresse die Überwachung "E-Mail an" gehen soll.

## Lokales Echtzeit-Monitoring
Überwacht mehrere Log-Dateien gleichzeitig und zeigt Fehler live im Browser an.  
Neue Fehler erscheinen typischerweise nach **~4,3s** (2s Polling + 100ms Debounce + 2,2s Stack-Trace-Pufferung). Polling ist Standard für alle Pfade (2s lokal, 5s Netzwerk), da Windows `fs.watch` Events verschlucken kann. Die Stack-Trace-Pufferung wartet bewusst länger als das Polling-Intervall (pollInterval + 200ms), damit mehrzeilige Einträge über Poll-Zyklen hinweg korrekt zusammengefasst werden.
Historie-Eintrag und Versionsnummer werden über `node scripts/update-docs.js` gesetzt (ohne Argumente interaktiv, sonst `"Titel" "- Punkt" … --files "a.js, b.js"`); die neue Version erscheint im Kopf des Dashboards nach einem Neustart. **Die Feature-Abschnitte dieser Doku pflegt das Skript nicht** — die gehören bei jeder Änderung von Hand nachgezogen, siehe Checkliste in `AGENTS.md`.
Dann gibt es noch die Performance-Gap-Erkennung. Dazu gibt es ein eigene Erklärung.

### Tagesaktuelle Log-Dateien

Beim Start werden **nur die heutigen Log-Dateien** aktiv geladen und überwacht. Ältere Dateien werden registriert, aber nicht eingelesen — das spart Ressourcen und verhindert, dass beim Start tausende alter Einträge erscheinen.

### Bestehende Fehler einlesen

Heutige Log-Dateien werden beim Start automatisch nach bestehenden Fehlern durchsucht (`loadExistingErrors: true`). So sieht man nach einem Neustart sofort alle bereits aufgetretenen Fehler im Dashboard.

- **Non-blocking:** Dateien werden sequenziell via `setImmediate()` eingelesen — Dashboard und WebSocket bleiben responsiv
- **Globale Queue:** Dateien aus allen Watchern werden in einer gemeinsamen Queue gesammelt und nacheinander verarbeitet (kein Interleaving)
- **Größenlimit:** Dateien über `maxLogFileSizeMB` (Standard: 6 MB) werden übersprungen und nur ab dem Startzeitpunkt überwacht
- **Fortschrittsanzeige:** Im Dashboard erscheint ein Fortschrittsbalken (`📥 Einlesen: 52/78 (67%)`), in der Konsole eine Zusammenfassung pro Label
- **Deaktivierbar:** Mit `loadExistingErrors: false` in den Einstellungen (Tab "Allgemein")

**Was passiert, wenn eine Log-Datei von gestern heute weitergeschrieben wird?**

```
1. Start: Datei "service_2026-05-07.log" wird erkannt (mtime = gestern)
   → Position wird gespeichert, aber Datei ist NICHT aktiv

2. Tagsüber: Der Dienst schreibt einen neuen Fehler in dieselbe Datei
   → chokidar meldet ein change-Event

3. Automatische Aktivierung: Der Monitor erkennt, dass die Datei
   noch nicht aktiv war, aktiviert sie und liest nur die neuen Zeilen

4. Ab jetzt: Alle weiteren Fehler werden live angezeigt — genau wie
   bei einer heutigen Datei
```

So werden keine Fehler verpasst, auch wenn ein Dienst seine Log-Datei über Mitternacht hinaus weiterschreibt.

**Was passiert, wenn eine Log-Datei gelöscht wird?**

Die Datei wird automatisch aus der Überwachung entfernt (Position, Puffer und Label werden bereinigt). Bereits angezeigte Fehler im Dashboard bleiben sichtbar, aber es kommen keine neuen mehr.

### 📂 Log-Analyse (einmalige Auswertung)

Neben dem Live-Monitoring gibt es die **Log-Analyse** — eine einmalige Auswertung von Log-Dateien ohne Watcher. Typische Anwendungsfälle:

- **Historische Logs auswerten** — Log-Dateien der letzten Wochen nach Fehlern durchsuchen
- **Anwender-Logs prüfen** — Zugesandte Log-Dateien schnell auf Fehler analysieren
- **Fehlersuche** — Gezielt bestimmte Verzeichnisse nach Problemen scannen

Die Analyse läuft komplett getrennt vom Live-Monitoring: eigener Datenspeicher, eigene Anzeige im Dashboard (grauer Header statt blau), kein Einfluss auf laufende Überwachung. Analyse-Ergebnisse haben **keinen Papierkorb** — sie können jederzeit durch erneute Analyse wiederhergestellt werden.

**Vier Wege, Dateien hineinzugeben**

| Weg | Bedienelement | Wofür |
|---|---|---|
| **Pfad eintragen** | Eingabefeld + **📂** zur Ordnerauswahl, dann **➕ Hinzufügen** | Alles, was der Server selbst sieht — auch gemappte Laufwerke wie `Y:\`. Wird direkt von der Platte gelesen, **ohne Upload** |
| **📥 Import** | Textfeld, ein Pfad pro Zeile (`#` = Kommentar); CSV/TXT/Excel kann hineingezogen werden | Viele Pfade auf einmal übernehmen |
| **Datei ablegen** | Ablagefläche (Ziehen **oder** Klick öffnet die Dateiauswahl) | Dateien, die der Server **nicht** sieht — ein Log aus einer Mail, ein Notebook ohne Laufwerks-Mapping |
| **📁 Ordner** | Ordnerauswahl, läuft rekursiv durch | Wie oben, nur ganzer Ordner statt Einzeldateien |

Die beiden unteren Wege **laden hoch**: der Browser gibt beim Ablegen nur Name, Größe und Inhalt heraus, nicht den Pfad. Die Analyse arbeitet pfadbasiert, also landet der Inhalt in `temp-analyze/<benutzer>/` und wird von dort gelesen. Details:

- **Erlaubt sind `.log`, `.json` und `.zip`** — ein ZIP wird nach dem Hochladen entpackt und selbst verworfen
- **Ablagen älter als 24 Stunden** werden beim Serverstart weggeräumt
- **Obergrenze 200 Dateien pro Ordner-Durchlauf** — ein versehentlich gewählter Downloads-Ordner soll keine hunderte Uploads auslösen. Überzählige werden nicht stillschweigend abgeschnitten, sondern mit Grund in der Zusammenfassung genannt
- **Der Unterordner wandert in den Dateinamen** (`2026-08/app.log` → `2026-08~app.log`), weil die Ablage flach ist — sonst wären zwei `app.log` aus verschiedenen Ordnern im Ergebnis nicht mehr unterscheidbar
- **Abweisungen sind einzeln laut, im Ordner leise:** einzeln abgelegt nennt jede untaugliche Datei ihren Grund, im Ordner gefundene werden still übersprungen und einmal zusammengefasst. Ein fehlgeschlagener **Upload** bleibt in beiden Fällen laut

**Was ausgewertet wird**

- **`.log` und `.json`** — JSON-Logs (etwa der KI-Schnittstelle) werden **strukturell** beurteilt (Error-Objekt bzw. `Success: false`), nicht über den Textfilter. Der würde in Prompt- und Antworttexten dauernd anschlagen. Eine `package.json` fällt damit von selbst durch
- **Streaming:** Große Dateien werden zeilenweise gelesen — der Server bleibt responsiv
- **Dieselben Regeln wie im Live-Monitoring:** Filter-Pattern, Ausschlüsse, Schwellwerte und Prioritätsregeln gelten unverändert

**Einstellungen im Panel**

- **Max. Fehler je Datei (Analyse)** — ein **Lesestopp**, Standard 100. Ist die Grenze in einer Datei erreicht, wird sie **nicht weitergelesen**; spätere Fehler bleiben ungeprüft. Das fällt nicht mehr unter den Tisch: ⚠-Badge am Dateikopf, Warnzeile mit dem Zeitpunkt des Abbruchs, Sammelbanner unter dem Fortschritt. Limit erhöhen und erneut starten liefert den Rest
- **⏱️ Gap-Warnung ab (Sek.)** — meldet Wartezeiten *zwischen* zwei Log-Einträgen als Performance-Lücke. Richtwert **20** (der Schmerzpunkt für Anwender), `0` = aus. Lücken erscheinen als eigene ⏱️-Einträge mit eigenem Zähler und **verdrängen keine Fehler**
- **Idle ab (Min.)** — Lücken größer als N Minuten gelten als Leerlauf (Nacht, Programmstart) und werden ignoriert. Leer = 30
- **💾 Speichern** sichert Pfade **und** alle drei Zahlenfelder. Ohne Speichern gelten geänderte Zahlen nur für den aktuellen Lauf

**Ablauf und Ergebnis**

- **Die Ergebnisse stehen in einem eigenen Sammelblock oberhalb der Live-Überwachung** — nicht mehr als gleichrangige Quellgruppen darunter. Der Block ist **standardmäßig zugeklappt** und kostet dann eine Zeile; seine Kopfzeile nennt die Kennzahlen (Dateien, Ordner, Fehler, kritische, ⏱️ Gaps, ⚠ unvollständig gelesen). Ein Klick klappt ihn auf, der Zustand wird gemerkt. „⊟ Alle zu" nimmt ihn mit, und bei einer aktiven Suche ist er immer offen
- **🔍 Analyse starten** wertet alle eingetragenen Pfade und alle abgelegten Dateien in einem Lauf aus. Der Knopf ist gesperrt, solange weder Pfad noch abgelegte Datei vorhanden ist
- **Pro Benutzer getrennt:** eigener Datenspeicher, eigene Fortschrittsanzeige, eigener Lauf — zwei Benutzer stören sich nicht
- **⏹ Abbrechen** hält einen laufenden Lauf an; bereits gefundene Fehler bleiben stehen
- **Löschen:** Pro Quellgruppe einzeln (🗑️ im Header) oder alle auf einmal. „Ergebnisse löschen" räumt **auch die abgelegten Dateien** weg — sie gehören zum Ergebnis
- **Zeitfilter:** Die Buttons 1h/2h/4h/6h/12h filtern auch Analyse-Ergebnisse (Datumsfilter Von/Bis nicht, da Analyse historische Daten enthält)

## Features

- **Live-Updates:** Fehler erscheinen sofort im Browser (WebSocket)
- **Multi-Log:** Überwacht beliebig viele Log-Dateien gleichzeitig
- **Gruppiert nach Quelle:** Fehler werden nach konfigurierbarem Label gruppiert (z.B. "MAD Dienst", "VFMService Dienst")
- **Filterbar:** Konfigurierbare Pattern (Exception, #Fehler, disposed, ...)
- **🔴 Dringlichkeit:** Prioritätsregeln stufen Fehler in `kritisch` / `normal` / `gering` ein (erste passende Regel gewinnt). Kritische Fehler fallen sofort auf (Badge, Rollup-Zähler pro Datei und Quelle, Browser-Titel), lösen eine Sofort-Mail aus, benachrichtigen auch bei sichtbarem Fenster und werden zuletzt verdrängt. `normal` sieht unverändert aus, `gering` wird gedimmt und benachrichtigt nie
- **Multi-Line-Erkennung:** Mehrzeilige Log-Einträge werden als ein Fehler gruppiert (Erkennung via Timestamp, Stack-Trace-Pufferung: pollInterval + 200ms)
- **Stack-Trace-Limit:** Stack Traces werden auf die ersten 5 Zeilen begrenzt
- **Tagesaktuelle Dateien:** Beim Start werden nur heutige Log-Dateien aktiv überwacht — ältere Dateien werden automatisch aktiviert, sobald sie heute beschrieben werden
- **📥 Bestehende Fehler einlesen:** Beim Start werden vorhandene Fehler aus heutigen Log-Dateien automatisch eingelesen (konfigurierbar). Dateien über dem Größenlimit (Standard: 6 MB) werden übersprungen. Fortschrittsanzeige im Dashboard
- **Zeitraum-Filter:** Datepicker (Von/Bis) zur Einschränkung auf einen Datumsbereich — aktualisiert sich automatisch um Mitternacht. Quick-Filter-Buttons: `1h` `2h` `4h` `6h` `12h` `Heute` für schnelle Stundenfilterung
- **Theme-Auswahl:** Drei Themes wählbar (Hell, Dunkel, Blau) — Auswahl wird gespeichert
- **Ordner/Datei öffnen:** Log-Datei direkt im Editor oder den Ordner im Explorer öffnen
- **In Zeile springen:** Fehler direkt im Editor an der betroffenen Zeile öffnen (VS Code → Notepad++ → Notepad)
- **Desktop-Notification:** Benachrichtigung bei neuen Fehlern (konfigurierbar ein/aus, Throttling auf max. 1 pro 10 Sek.)
- **Pause/Resume pro Quelle:** Überwachung einzelner Quellen pausieren ohne das Tool zu beenden
- **Einträge löschen pro Quelle:** Fehleranzeige einer einzelnen Quelle leeren (berücksichtigt Datumsfilter)
- **Monitor beenden:** Server direkt über das Dashboard stoppen (kein manuelles CMD-Schließen nötig)
- **Suche:** Volltextsuche mit Wildcard-Unterstützung (`*`) und **gelber Treffer-Markierung** — klappt automatisch nur Quellen mit Treffern auf. Shortcut: `Strg+K` (fokussiert + selektiert), `Escape` (leert + verlässt)
- **🧭 Fehler-Index:** Seitenleiste mit allen Fehlern als Sprungliste, gruppiert nach Quelle und je Quelle neu nummeriert. Ein Klick klappt Quelle und Datei auf, scrollt zum Eintrag und markiert ihn dauerhaft. Der Quellen-Kopf bleibt beim Scrollen stehen. Filter `Alle` / `🔴 Nur kritische` wirkt nur auf die Navigation — die Anzeige bleibt vollständig. Ein-/ausblendbar (`🧭 Index`), links oder rechts (`⇄`), Zustand wird gespeichert. Enthält Live-Fehler immer und Analyse-Treffer, sobald welche vorliegen; ⏱️-Lücken nie
- **⊟ Alle zu / ⊞ Alle auf:** Alle Quellen auf einen Schlag ein- oder ausklappen
- **E-Mail-Benachrichtigung:** Gesammelter E-Mail-Versand per SMTP pro Quelle mit Countdown-Timer
- **Einklappbare Sektionen:** Quellen und Dateigruppen ein-/ausklappbar (Zustand wird gespeichert). Hauptansicht und Fehler-Index teilen sich denselben Zustand — ein Klick wirkt in beiden
- **⚙️ Einstellungen im Dashboard:** Alle Config-Werte direkt im Browser bearbeiten (kein Editor nötig)
- **🎨 Live CSS-Editor:** CSS direkt im Dashboard bearbeiten mit Live-Vorschau. Speichern-Button erst aktiv nach Änderungen. Backup und Standard-Wiederherstellung integriert
- **📂 Log-Analyse:** Einmalige Analyse von Log-Dateien ohne Watcher — historische Logs oder Anwender-Logs auswerten. Streaming-Read für große Dateien, eigener Store getrennt vom Live-Monitoring, Abbrechen-Option, Fortschrittsanzeige
- **🗄️ Backup & Restore:** Automatisches tägliches Backup (Zeitplan konfigurierbar) auf beliebig viele lokale Verzeichnisse (Multi-Local) und/oder FTPS (Explicit STARTTLS / Implicit / None). Hybrid-Labels pro Ziel (📁 Lokal, ☁️ Cloud/Sync, 💾 Externes Laufwerk, ✏️ Benutzerdefiniert). ZIP-Archiv mit Config, CSS und E-Mail-Log. Optional zusätzlich ein **Komplett-Backup** des gesamten Programmverzeichnisses (`keasy-full-*.zip`, inkl. node_modules — im Katastrophenfall entpacken und starten; Wiederherstellung manuell, nicht über die Oberfläche). Rotation (max. Backups pro Ziel, Settings- und Komplett-Backups getrennt). Restore mit Preview, Whitelist-Validierung, Zip-Slip-Schutz und Sicherheits-Backup. Verbindungstest pro Ziel. Run-Lock (Mutex) gegen parallele Backups. Duplikat-Pfad-Erkennung. Verpasste Backups werden beim Start nachgeholt
- **🧪 System-Check:** Read-only Health-Checks direkt im Server-Prozess — prüft HTTP-Erreichbarkeit, WebSocket, Konfiguration, Dateisystem (inkl. Netzlaufwerke), Backup-Status und E-Mail-Log. Live-Ergebnisse per WebSocket mit gestaffelter Animation. Cooldown-Schutz (10s), Reconnect-safe
- **📖 Dokumentation im Dashboard:** README als formatiertes HTML mit einklappbaren Sektionen
- **📋 E-Mail Log im Dashboard:** E-Mail-Aktivitäten einsehen und löschen
- **🔄 Watcher neu starten:** FileWatcher über das Dashboard neu starten (ohne Server-Neustart)
- **📡 Polling als Standard:** Alle Pfade werden per Polling überwacht (2s lokal, 5s Netzwerk) — zuverlässiger als Windows `fs.watch`. Kann pro WatchPath mit `usePolling: false` deaktiviert werden
- **🗑️ Papierkorb:** Gelöschte Fehler-Einträge werden in einen Papierkorb verschoben statt endgültig gelöscht. Wiederherstellen pro Quelle oder alle. Auto-Cleanup nach konfigurierbarer Zeit (Standard: 48h). Batch-basiert mit Lösch-Zeitpunkt, Bestätigungsdialog beim Leeren
- **⏱️ Performance-Gap-Erkennung:** Pro WatchPath konfigurierbar — meldet, wenn zwischen zwei aufeinanderfolgenden Log-Einträgen derselben Datei mehr als N Sekunden liegen (Richtwert: 20 s, der Schmerzpunkt für Anwender). Kein Fehler, sondern eigene Kategorie: eigene orange Sektion im Dashboard, getrennt vom Fehler-Logging, keine E-Mail, kein Papierkorb. Leerlauf-Obergrenze (Standard: 30 Min) filtert Nacht-/Start-Gaps heraus. Greift im Live-Monitoring, beim Start-Einlesen und (mit eigenen Feldern) in der Log-Analyse. Standard: aus
- **📋 Fehler kopieren:** Fehlertext einzelner Einträge per Klick in die Zwischenablage kopieren
- **🤖 KI-Export:** Einzelnen Fehler als `ki-error-context.md` in ein konfiguriertes Verzeichnis exportieren — zur direkten Übergabe an eine KI (Claude, Copilot &amp; Co.). Zwei Ziele: 🤖 Develop + 🚀 Release (grün). Dieselben zwei Knöpfe sitzen auch in der **Datei-Kopfzeile** und legen dort die **komplette Log-Datei** unter ihrem eigenen Namen im Zielverzeichnis ab — für den Fall, dass Copilot das Umfeld eines Fehlers braucht
- **📤 Weitergabe (Tool-Export):** Erzeugt per Klick ein schlankes, weitergebbares ZIP der App (Tab „Weitergabe", admin-only) — **ohne** Zugangsdaten (SMTP/FTP), Benutzerkonten, Logs, `node_modules` und maschinenspezifische Pfade. Eine Sektions-Checkliste (Positivauswahl) steuert, welche Einstellungen in die mitgelieferte `config.default.js` eingebacken werden (Allgemein, Filter-/Ausschluss-Muster, Schwellwerte vorbelegt; Watch-Pfade, E-Mail, Backup optional). Passwörter werden nie exportiert. Empfänger: entpacken → `start.bat` (installiert Dependencies, erzeugt beim ersten Start `config.js` aus `config.default.js`)
- **🔌 Auto-Port-Recovery:** Bei belegtem Port wird der alte Prozess automatisch beendet
- **⚡ Intelligentes Debouncing:** Mehrfache Datei-Events werden zusammengefasst (100ms) für effiziente Verarbeitung
- **🔍 Debug-Logging:** Timing-Analyse per Checkbox aktivierbar (Einstellungen → Allgemein) — zeigt `[TIMING]`-Einträge in der Server-Konsole
- **🏷️ Versionierung:** Datums-Zeitstempel als Version (Format: `YYYY.MM.DD-HH:mm`), wird im Dashboard-Titel angezeigt. Wird automatisch bei Dokumentations-Updates mit dem Hinweis: "Dokumentation aktualisiere" aktualisiert (`package.json` → `version`)

## Voraussetzungen

- **Node.js** (v18 oder höher) — [Download](https://nodejs.org/)

## Installation & Start

### Variante 1: Doppelklick (empfohlen)

1. `start.bat` doppelklicken
2. Beim ersten Start werden automatisch die Dependencies installiert
3. Der Browser öffnet sich automatisch mit dem Dashboard

### Variante 2: Kommandozeile

```powershell
cd C:\vfm\keasy-log-monitor
npm install        # nur beim ersten Mal
npm start
```

## Konfiguration

Alle Einstellungen können auf zwei Wegen bearbeitet werden:

### 1. Im Dashboard (empfohlen)

Klick auf **⚙️ Einstellungen** im Header öffnet ein einklappbares Panel. Die Tabs in der Reihenfolge, in der sie dort stehen:

| Tab | Einstellungen |
|---|---|
| **⚙️ Allgemein** | 🖥️ Server (Port, Browser automatisch öffnen, Debug-Logging, Rechte-System) · 📄 Dateien & Fehler (Max. Fehler je Datei (Live-Überwachung), Datei-Pattern, bestehende Fehler beim Start einlesen, Max. Log-Dateigröße) · 🗑️ Papierkorb (Auto-Cleanup) · 🤖 KI-Export (Develop- und Release-Pfad, gelten **pro Benutzer**) |
| **🕵️ Monitor** | 📂 Überwachte Pfade als Tabelle: Pfad, Label, E-Mail an, Polling, JSON, ⏱️ Gap (s), Idle (min). Pfade hinzufügen/entfernen, Ordnerauswahl, Import per 📥 (auch Drag & Drop) |
| **📋 Regeln** | ⚠️ Fehlererkennung · 🚫 Ausschluss-Patterns · 📊 Schwellwertregeln · 🔴 Prioritätsregeln |
| **✉️ E-Mail** 🔒 | SMTP-Konfiguration, Intervall, Duplikatschutz (normal und kritisch), Absender, Betreff |
| **📧 E-Mail Log** | E-Mail-Versandprotokoll einsehen, aktualisieren und löschen |
| **📖 Dokumentation** | README als formatiertes HTML: Inhaltsverzeichnis, Suche, einklappbare Abschnitte, ✏️ Bearbeiten mit Live-Vorschau |
| **🕘 Historie** | Alle Einträge der Änderungshistorie als Sprungliste, mit Suche, „Alle auf/zu" und Trefferzahl |
| **🗄️ Backup** 🔒 | Beliebig viele lokale Ziele + FTP, Zeitplan, Rotation, optionales Komplett-Backup des Programmverzeichnisses, Wiederherstellen mit Vorschau und Bestätigungsdialog |
| **📤 Weitergabe** 🔒 | Bereinigtes Tool-Paket als ZIP erzeugen — ohne Zugangsdaten, Benutzerkonten, Logs und `node_modules` |
| **🧪 System-Check** 🔒 | Health-Checks ohne Seiteneffekte (HTTP, WebSocket, Config, Dateisystem, Backup, E-Mail) mit Live-Ergebnissen |
| **👥 Benutzer** 🔒 | Eigenes Passwort ändern, Benutzer anlegen und verwalten. Nur vorhanden, wenn das Rechte-System aktiv ist |
| **🎨 CSS-Style** 🔒 | Live-CSS-Editor mit Vorschau, Speichern und Zurücksetzen |

🔒 = **nur für Administratoren.** Diese Tabs sind für Benutzer der Rolle *User* nicht versteckt, sondern **deaktiviert** — mit dem Hinweis „🔒 Nur für Administratoren" als Tooltip. Bei abgeschaltetem Rechte-System (`authEnabled: false`) gibt es keine Rollen, alle Tabs sind bedienbar, und der Tab **👥 Benutzer** entfällt ganz.

**Die 📂 Log-Analyse ist kein Tab dieses Panels**, sondern ein eigenes Panel über den gleichnamigen Knopf im Header — inklusive eigener Pfadliste und Lücken-Schwellwerte.

- Änderungen werden mit **💾 Speichern** sofort wirksam (Hot-Reload)
- **💾 Speichern** ist nur aktiv, wenn tatsächlich Änderungen vorgenommen wurden
- **↺ Zurücksetzen** verwirft ungespeicherte Änderungen
- Vor jedem Speichern wird ein Backup (`config.js.bak`) erstellt
- SMTP-Passwort wird maskiert angezeigt (änderbar, aber nicht lesbar)
- Port-Änderung erfordert einen Neustart des Monitors

### 2. Direkt in `config.js`

```javascript
module.exports = {
  port: 3847,
  autoOpen: true,
  maxErrorsPerFile: 50,

  // E-Mail-Benachrichtigung
  email: {
    enabled: true,
    intervalMinutes: 5,       // Sammel-Intervall in Minuten
    deduplicateMinutes: 60,   // Duplikatschutz: gleicher Fehler erst nach X Min. erneut melden
    smtp: {
      host: 'smtp.example.com',
      port: 465,
      secure: true,      // true für Port 465 (SSL)
      family: 4,         // IPv4 erzwingen (optional, bei IPv6-Problemen)
      auth: { user: 'benutzer@example.com', pass: 'passwort' }
    },
    from: 'benutzer@example.com',  // Muss zur SMTP-Login-Domain passen!
    subject: '[Keasy Monitor] Fehler in: {label}'
  },

  // Überwachte Log-Verzeichnisse mit Label und optionalem E-Mail-Empfänger
  watchPaths: [
    { path: 'C:\\Users\\hr\\AppData\\Local\\Keasy\\Logs', label: 'Keasy Lokal', emailTo: null },
    { path: 'C:\\ProgramData\\Keasy\\Logs', label: 'Lokale Dienste', emailTo: null },
    { path: 'Y:\\', label: 'MAD Dienst', emailTo: 'admin@example.com' },
    { path: 'X:\\', label: 'VFMService Dienst', emailTo: null },
    { path: 'C:\\...\\Keasy\\KI', label: 'Schnittstellen KI', includeJson: true }  // auch .json-Logs
  ],

  filePattern: '**/*.log',

  filterPatterns: [
    'Exception',
    '#Fehler',
    'disposed'
  ],

  excludePatterns: [
    'ValidationException'      // Hinweis-Meldungen, die trotz Filter-Treffer NICHT als Fehler gelten
  ],

  // Dringlichkeit: stuft erkannte Fehler ein, entscheidet aber NICHT, ob etwas ein Fehler ist.
  // Erste passende Regel gewinnt (Reihenfolge = Vorrang), kein Treffer ⇒ 'normal'.
  priorityRules: [
    { name: 'SMTP-Versand', contains: 'Send_over_SMTP', level: 'kritisch' },
    { name: 'Dispose-Rauschen', contains: 'disposed', level: 'gering' }
  ],

  loadExistingErrors: true,   // Bestehende Fehler aus heutigen Log-Dateien beim Start einlesen
  maxLogFileSizeMB: 6         // Dateien über 6 MB werden übersprungen
};
```

### Einstellungen

| Einstellung | Beschreibung |
|---|---|
| `port` | HTTP-Port des Dashboards (Standard: 3847) |
| `watchPaths` | Array von `{ path, label, emailTo }` — überwachte Verzeichnisse |
| `watchPaths[].label` | Anzeigename der Quelle im Dashboard |
| `watchPaths[].emailTo` | E-Mail-Empfänger: kommagetrennt (`'a@x.de, b@x.de'`), Array (`['a@x.de', 'b@x.de']`) oder `null` (kein Versand) |
| `watchPaths[].gapWarnSeconds` | ⏱️ Performance-Warnung, wenn zwischen zwei Log-Einträgen mehr als N Sekunden liegen. `0`/leer = aus. Richtwert: `20` (Schmerzpunkt für Anwender) — neue Zeilen werden damit vorbelegt |
| `watchPaths[].gapIdleMinutes` | Gaps größer als N Minuten gelten als Leerlauf (Nacht/Programmstart) und werden ignoriert. Leer = `30` |
| `watchPaths[].includeJson` | `true` = in diesem Pfad zusätzlich `.json`-Logs überwachen (Glob `**/*.{log,json}`) und pro JSON-Objekt strukturell auswerten (`Error`/`Success:false`), z. B. KI-Schnittstelle. Standard `false` — bewusst pro Pfad aktivieren, um Netzlaufwerke (`X:`/`Y:`) nicht unnötig nach JSON zu durchsuchen |
| `analyzeMaxErrors` | **Lesestopp** der Log-Analyse (Standard: `100`): Ist die Grenze in einer Datei erreicht, wird sie **nicht weitergelesen** — spätere Fehler bleiben ungeprüft. Anders als bei `maxErrorsPerFile` verdrängt hier nichts, es fehlt einfach der hintere Teil der Datei. Greift die Grenze, weist das Dashboard darauf hin (⚠-Badge an der Datei, Warnzeile mit dem Zeitpunkt des Abbruchs, Sammelbanner unter dem Fortschritt) |
| `setupCompleted` | `true` = der Einrichtungsassistent ist erledigt und erscheint nicht mehr. Gesetzt per „✓ Einrichtung abgeschlossen" oder beim ersten Start einer **bestehenden** Installation (Feld fehlt + Watchpaths vorhanden). Ein gesetztes Feld — auch `false` — wird beim Start nicht mehr angefasst |
| `setupDismissed` | Array der **einzeln** als „brauche ich nicht" abgehakten Schritte (`paths`, `allg`, `reg`, `mail`, `ana`, `bak`). Gilt für die **Installation**, nicht für den Browser. Bewusst getrennt von `setupCompleted` |
| `analyzeGapWarnSeconds` | ⏱️ Gap-Warnung für die Log-Analyse (Sek., `0` = aus). Nie konfiguriert = Richtwert `20` |
| `analyzeGapIdleMinutes` | Leerlauf-Grenze für die Log-Analyse (Min., leer = `30`) |
| `filePattern` | Glob-Pattern für Dateinamen (z.B. `*.log`, `KeasyServer*.log`) |
| `filterPatterns` | Array von Suchbegriffen (case-insensitive). Geprüft gegen den **gesamten Eintrag**, nicht gegen einzelne Zeilen — siehe Abschnitt „Muster und mehrzeilige Einträge" |
| `excludePatterns` | Array von Suchbegriffen (case-insensitive). **Einträge**, die hierauf matchen, gelten **nicht** als Fehler – auch wenn sie ein `filterPatterns`-Pattern enthalten (z.B. `ValidationException` als Anwender-Hinweis). Leer = kein Ausschluss. **Ein Treffer an beliebiger Stelle unterdrückt den kompletten mehrzeiligen Eintrag** — auch einen echten Fehler, der den Begriff nur als InnerException enthält. Patterns deshalb so eng wie möglich fassen |
| `priorityRules` | Array von `{ name, contains, level }` — stuft erkannte Fehler nach **Dringlichkeit** ein, beeinflusst aber **nicht**, ob etwas als Fehler gilt. Erste passende Regel gewinnt (Reihenfolge = Vorrang, im Dashboard mit ▲▼ umsortierbar), kein Treffer ⇒ `normal`. Leer = Feature aus (alles wie ohne Prioritätsregeln). Wirkt auch auf JSON-Logs und Schwellwert-Treffer |
| `priorityRules[].contains` | Suchbegriff (case-insensitive, Teilzeichenkette — kein Regex). Wird im **gesamten Eintrag** gesucht, auch über Zeilenumbrüche hinweg — der Begriff muss also nicht in der ersten Zeile stehen. Pflichtfeld. Siehe Abschnitt „Prioritätsregeln in der Praxis" |
| `priorityRules[].level` | `kritisch` (🚨 Alarmknopf mit Sprung zum Eintrag, roter Blockrahmen, Browser-Titel, Sofort-Mail, Benachrichtigung auch bei sichtbarem Fenster, Schutz vor Verdrängung), `normal` (Standard, Darstellung unverändert), `gering` (gedimmt, keine Benachrichtigung — zählt aber weiter im Fehlerzähler). Unbekannte Werte werden zu `normal` |
| `maxErrorsPerFile` | Aufbewahrung pro Datei im **Live-Monitoring** (Standard: `50`). Der Wert gilt wörtlich: Server **und** Dashboard halten genau so viele Einträge je Datei und verdrängen dabei immer den ältesten **nicht**-kritischen Eintrag zuerst — als `kritisch` eingestufte Fehler bleiben, solange normale vorhanden sind. Die Log-Datei selbst bleibt unberührt. **Nicht zu verwechseln mit `analyzeMaxErrors`**, dem Lesestopp der Log-Analyse |
| `loadExistingErrors` | Bestehende Fehler aus heutigen Log-Dateien beim Start einlesen (Standard: `true`) |
| `maxLogFileSizeMB` | Max. Dateigröße für das Einlesen bestehender Fehler in MB (Standard: `6`). Größere Dateien werden nur ab dem Startzeitpunkt überwacht |
| `trashAutoCleanupHours` | Papierkorb Auto-Cleanup nach X Stunden (Standard: `48`). `0` = nie automatisch leeren |
| `copilotWorkingPathDevelop` | Develop-Verzeichnis für den KI-Export. Leer = 🤖-Knopf gesperrt. Schlüsselname historisch — die Funktion hieß früher Copilot-Export |
| `copilotWorkingPathRelease` | Release-Verzeichnis für den KI-Export. Leer = 🚀-Knopf gesperrt |
| `autoOpen` | Browser automatisch öffnen (true/false) |
| `debugLogging` | Ausführliche Server-Protokollierung in der Konsole (true/false). Standard: `false` |
| `email.enabled` | E-Mail-Versand global ein/aus |
| `email.intervalMinutes` | Alle X Minuten werden gesammelte Fehler versendet. Gilt **nicht** für `kritisch` eingestufte Fehler — die lösen sofort einen Versand aus (5 s Bündelung, danach min. 60 s Sperre pro Quelle) |
| `email.deduplicateMinutes` | Duplikatschutz: gleicher Fehler erst nach X Min. erneut melden (Standard: 60) |
| `email.criticalDeduplicateMinutes` | Duplikatschutz für `kritisch` eingestufte Fehler (Standard: 15). Kurz halten — mit dem normalen Fenster bliebe ein Dauerproblem stundenlang stumm. Kritische Fehler sind bewusst **nicht** vom Duplikatschutz ausgenommen, sonst würde eine crashende Komponente im Sekundentakt mailen |
| `email.smtp` | SMTP-Server-Konfiguration (Host, Port, SSL, Auth, family) |
| `email.smtp.family` | `4` = IPv4 erzwingen, `6` = IPv6 erzwingen (optional, bei Netzwerkproblemen) |
| `email.from` | Absender-Adresse (muss zur SMTP-Login-Domain passen!) |
| `email.subject` | Betreff-Template (`{label}` wird durch den Quellnamen ersetzt, `{level}` durch `Kritisch`/`Normal`). Bei kritischen Fehlern wird zusätzlich `🔴 KRITISCH: ` vorangestellt |

### Muster und mehrzeilige Einträge

**Alle vier Musterlisten** — Fehlererkennung, Ausschluss, Schwellwertregeln und Prioritätsregeln — werden gegen den **gesamten Log-Eintrag** geprüft, nicht gegen einzelne Zeilen. Ein Eintrag ist alles zwischen zwei Zeitstempeln und umfasst bei Keasy typischerweise ein Dutzend Zeilen:

```
30.07.26 18:15:34.751
                                    ← mehrere Leerzeilen
Der folgende #Fehler ist aufgetreten:
Type: TimeoutException
Message: The operation has timed out.
InnerException: ValidationException — IBAN-Prüfung fehlgeschlagen
   at Keasy.Workflow.Run()
```

Daraus folgt für jede Liste etwas anderes:

**Fehlererkennung (`filterPatterns`)** — ein Muster greift, egal in welcher Zeile es steht. `TimeoutException` erkennt den Eintrag oben zuverlässig, obwohl der Begriff erst in Zeile 4 auftaucht. Umgekehrt trifft ein breites Muster wie `Fehler` bereits die Ankündigungszeile `Der folgende #Fehler ist aufgetreten:` — und die steht über nahezu jedem Eintrag. Für die *Erkennung* ist das meist gewollt, man sollte es aber wissen.

**Ausschluss (`excludePatterns`)** — hier ist die Wirkung am folgenreichsten: **ein Treffer an beliebiger Stelle unterdrückt den kompletten Eintrag.** Im Beispiel oben würde ein Ausschluss auf `ValidationException` oder `IBAN-Prüfung fehlgeschlagen` den echten `TimeoutException`-Fehler mitverschlucken, weil der Begriff als *InnerException* in Zeile 6 steht. Ausschluss-Muster deshalb so eng wie möglich fassen — je allgemeiner, desto größer die Gefahr, dass sie einen echten Fehler mitnehmen, der sie nur zufällig als Nebensatz enthält.

**Schwellwertregeln (`thresholdRules`)** — die Zahl wird ab der Position von „Zeile enthält" gesucht und kann daher aus einer *Folgezeile* stammen. Bei `WorkingSet:` am Zeilenende und der Zahl in der nächsten Zeile greift die Regel trotzdem. Das ist meist hilfreich, kann aber die falsche Zahl erwischen, wenn zwischen Begriff und gewünschtem Wert noch eine andere Zahl steht.

**Prioritätsregeln (`priorityRules`)** — hier ist die Ankündigungszeile als Regel unbrauchbar: sie trifft *alles* und würde jeden Fehler zu `kritisch` machen. Aussagekräftig ist der Typ in der Folgezeile. Zusätzlich gilt: **die erste passende Regel gewinnt.** Eine allgemeine Regel auf `Exception` → `kritisch` oberhalb einer spezifischen auf `UserFriendlyException` → `gering` verschluckt die spezifische — also **spezifisch oben, allgemein unten** (im Dashboard mit ▲▼ sortierbar).

Brauchbare Begriffe sind Ausnahme-Typen, keine Fließtexte: `TimeoutException`, `AggregateException`, `ServiceResponseException`, `NullReferenceException`, `TargetInvocationException`. Für Meldungen, die sich an Anwender richten statt einen Systemfehler zu beschreiben (`UserFriendlyException`, `ValidationException`), ist `gering` meist passender als ein Ausschluss — sie bleiben sichtbar und im Fehlerzähler, benachrichtigen aber nicht.

**Zwei Ausnahmen von der Regel:**

- **JSON-Logs** (`includeJson`) werden strukturell ausgewertet (`Error`-Objekt oder `Success: false`), nicht über `filterPatterns`. Dort wirken `excludePatterns` bewusst **nur auf Typ und Meldung**, nicht auf den ganzen Block — sonst könnten Wörter im KI-Prompt-Text eine Unterdrückung auslösen.
- **Stack-Traces** werden vor dem Speichern gekürzt: ab der sechsten `   at …`-Zeile entfällt der Rest (`limitStackTrace`). Prioritätsregeln sehen also den gekürzten Text; alle Zeilen außerhalb des Stack-Traces bleiben vollständig erhalten. Erkennung und Ausschluss laufen dagegen auf dem ungekürzten Eintrag.

### SMTP-Konfiguration

**Interner Relay ohne Authentifizierung:**
```javascript
smtp: {
  host: 'mailrelay.intern.local',
  port: 25,
  secure: false,
  auth: null
}
```

**Server mit Authentifizierung (SSL):**
```javascript
smtp: {
  host: 'smtp.provider.de',
  port: 465,
  secure: true,
  family: 4,  // IPv4 erzwingen (bei IPv6-Problemen)
  auth: { user: 'benutzer@provider.de', pass: 'passwort' }
}
```

> **Wichtig:** Der `from`-Absender muss zur SMTP-Login-Domain passen, sonst verwerfen Empfänger wie Gmail die Mail still (SPF-Fail).  
> Beispiel: Login `benutzer@provider.de` → `from: 'benutzer@provider.de'`

### Weitere Log-Verzeichnisse hinzufügen

```javascript
watchPaths: [
  // ... bestehende Einträge ...
  { path: 'D:\\MeinServer\\Logs', label: 'Mein Server', emailTo: 'admin@firma.de' }
]
```

> `emailTo` akzeptiert drei Formate:
> - Kommagetrennt: `'admin@firma.de, chef@firma.de'`
> - Array: `['admin@firma.de', 'chef@firma.de']`
> - Einzeln: `'admin@firma.de'`
> - Leer/null: kein E-Mail-Versand für diese Quelle

### Datumsfilter beim Löschen

Die Lösch-Funktionen berücksichtigen den aktiven Datumsfilter:

- **Mit Datumsfilter (Von/Bis):** Es werden nur Einträge innerhalb des gewählten Zeitraums gelöscht. Einträge außerhalb des Filters bleiben erhalten — sowohl im Frontend als auch im Server-Speicher.
- **Ohne Datumsfilter:** Alle Einträge werden gelöscht (bisheriges Verhalten).

Dies gilt für „🗑️ Alle löschen" (global) und „🗑️" (pro Quelle). Analyse-Ergebnisse sind davon nicht betroffen — sie haben eigene Lösch-Buttons pro Quellgruppe.

### Weitere Filter-Pattern hinzufügen

```javascript
filterPatterns: [
  'Exception',
  '#Fehler',
  'disposed',
  'FATAL',           // ← neu
  'NullReference'    // ← neu
]
```

### Suche (Wildcard)

Das Suchfeld im Header unterstützt **Wildcard-Suche** mit `*`:

| Eingabe | Wirkung |
|---|---|
| `timeout` | Findet alle Zeilen die „timeout" enthalten (Substring) |
| `SQL*timeout` | Findet Zeilen mit „SQL" gefolgt von „timeout" (beliebig dazwischen) |
| `*error*` | Wie einfache Suche — findet alles mit „error" |
| `Fehler*Daten` | Findet z.B. „Fehler beim Laden der Daten" |

**Verhalten:**
- Ohne `*` → einfache Substring-Suche (wie bisher)
- Mit `*` → Wildcard-Muster (`*` = beliebige Zeichen)
- Groß-/Kleinschreibung wird ignoriert
- **Treffer werden gelb markiert** im Fehlertext (funktioniert auch mit Wildcard und in Kombination mit roten Filter-Pattern-Highlights)
- Eingeklappte Quellen klappen automatisch auf, wenn sie Treffer enthalten
- Beim Leeren der Suche wird der gespeicherte Einklapp-Zustand wiederhergestellt

## Bedienung

### Globale Steuerung (Header)

| Element | Funktion |
|---|---|
| 🟢 Verbunden | WebSocket-Verbindungsstatus |
| ⏹️ Monitor beenden | Beendet den Server (Button wird danach deaktiviert) |
| 🔄 Watcher neu starten | Startet den FileWatcher neu ohne Server-Neustart |
| ⚙️ Einstellungen | Öffnet das Config-Panel zum Bearbeiten aller Einstellungen |
| 📅 Von / Bis | Zeitraum-Filter — nur Fehler aus diesem Datumsbereich anzeigen (wechselt automatisch um Mitternacht) |
| 🗑️ Alle löschen | Löscht nur Live-Einträge im gewählten Zeitraum — ohne Datumsfilter werden alle gelöscht (Analyse nicht betroffen) |
| ⏸️ Pause | Stoppt die Live-Aktualisierung global |
| ⊟ Alle zu / ⊞ Alle auf | Klappt alle Quellen zu bzw. auf. Ist irgendeine offen, klappt der Knopf alle zu — die Beschriftung sagt, was der Klick tut |
| 🧭 Index | Blendet den Fehler-Index (Seitenleiste) ein oder aus |
| ⬇️ Neueste | Scrollt zum neuesten Fehler |
| 🔍 Suche | Volltextsuche mit Wildcard-Unterstützung (`*`) — klappt Quellen mit Treffern automatisch auf |
| ☀️/🌙/🔵 Theme | Wechsel zwischen Hell, Dunkel und Blau (wird gespeichert) |

### Pro Quelle (Source-Header)

| Element | Funktion |
|---|---|
| ▼/▶ | Sektion ein-/ausklappen (Zustand wird gespeichert) |
| 📧 3:24 | E-Mail aktiv — Countdown bis zum nächsten Versand |
| 📧 Aus | E-Mail für diese Quelle deaktiviert |
| ⏸️ Monitor | Überwachung dieser Quelle pausieren |
| ▶️ Monitor | Pausierte Quelle fortsetzen |
| 🗑️ | Fehlereinträge dieser Quelle im gewählten Zeitraum löschen (ohne Datumsfilter: alle). Bei Analyse-Quellen: löscht die gesamte Quellgruppe |

### Pro Fehler-Eintrag

| Element | Funktion |
|---|---|
| ↗ Zeile öffnen | Öffnet die Log-Datei an der Fehlerzeile (VS Code → Notepad++ → Notepad) |
| 📂 Ordner öffnen | Öffnet den Ordner der Log-Datei im Windows Explorer |
| 📝 Datei öffnen | Öffnet die Log-Datei im Editor |
| 📋 Kopieren | Fehlertext in die Zwischenablage kopieren |
| 🤖 Develop | Einzelnen Fehler als `ki-error-context.md` ins Develop-Verzeichnis exportieren |
| 🚀 Release | Einzelnen Fehler als `ki-error-context.md` ins Release-Verzeichnis exportieren (grün) |

In der **Datei-Kopfzeile** neben 📂/📝:

| Icon | Funktion |
|---|---|
| 🤖 Develop | **Komplette** Log-Datei unter ihrem eigenen Namen ins Develop-Verzeichnis kopieren |
| 🚀 Release | **Komplette** Log-Datei unter ihrem eigenen Namen ins Release-Verzeichnis kopieren (grün) |

### 🧭 Fehler-Index (Seitenleiste)

Kompakte Sprungliste neben der Fehleranzeige. Sie zeigt **dieselbe gefilterte Menge** wie die Anzeige — Suche und Zeitraumfilter wirken automatisch mit.

| Element | Funktion |
|---|---|
| ⇄ | Legt die Seitenleiste auf die andere Seite (links/rechts, wird gespeichert) |
| Alle / 🔴 Nur kritische | Filtert die **Navigation**, nicht die Daten — die Anzeige rechts bleibt vollständig |
| ▼/▶ Quellen-Kopf | Klappt die Quelle auf/zu — wirkt zugleich in der Hauptansicht |
| Klick auf eine Zeile | Klappt Quelle und Datei auf, scrollt zum Eintrag und markiert ihn |
| (beim Scrollen) | Die Liste markiert mit, wo man gerade liest, und holt die Zeile in Sicht |

- **Gruppiert nach Quelle**, je Quelle neu nummeriert. Eine fortlaufende Nummer über alle Watchpaths würde eine Reihenfolge behaupten, die es nicht gibt
- **Der Quellen-Kopf klebt** beim Scrollen — sowohl in der Liste als auch in der Hauptansicht. Sonst ist mitten in einem langen Stack-Trace unklar, in welchem Watchpath man liest
- **Die Beschriftung** wird aus dem Eintrag berechnet (`Keasy.utils.entrySummary`) — dieselbe Funktion, die auch die Desktop-Benachrichtigung füllt: Zeitstempel abschneiden, Trennlinien überspringen, Ankündigungszeilen wie „Der folgende #Fehler ist aufgetreten:" mit der Folgezeile zusammenziehen
- **Der angesprungene Eintrag bleibt markiert**, bis der nächste angesprungen wird — bewusst nicht rot, sondern über Helligkeit, Rahmen und Akzentfarbe (siehe Historie)
- **Umfang ist eine Regel, keine Einstellung:** Live-Fehler immer, Analyse-Treffer sobald welche vorliegen, ⏱️-Lücken nie
- Unterhalb von 1100 px Fensterbreite blendet sich die Leiste aus — die Fehlertexte brauchen dort den Platz

### Sonstiges

- **Klick auf Datei-Header:** Klappt die Fehlerliste ein/aus
- **Browser-Tab-Titel:** Zeigt Anzahl aktueller Fehler `(5) Keasy Log Monitor`
- **Desktop-Notification:** Erscheint wenn Browser im Hintergrund ist (🔔/🔕 Toggle im Dashboard)
- **Auto-Reconnect:** Bei Verbindungsverlust wird automatisch alle 3 Sekunden reconnected

### 📂 Log-Analyse bedienen

1. **Einstellungen öffnen** → Tab **📂 Log-Analyse**
2. **Pfade hinzufügen** — Datei- oder Ordnerpfade eingeben und mit „+" bestätigen
   - Ordner werden rekursiv nach `.log`-Dateien durchsucht
   - Doppelte Pfade und ungültige Einträge werden automatisch übersprungen
   - **📂 wählt serverseitig** — der Ordner-Browser listet die Laufwerke des *Servers*. Alles, was er sieht (auch gemappte Laufwerke wie `Y:\`), gehört hierher und wird ohne Upload direkt von der Platte gelesen
3. **Dateien ablegen oder 📁 Ordner** — nur für Dateien, die der Server **nicht** sieht: ein Log aus einer Mail, ein Notebook ohne Laufwerks-Mapping
   - Ablegen oder Klick auf die Fläche: einzelne `.log`, `.json`, `.zip`
   - **📁 Ordner** übergibt einen ganzen Ordner samt Unterordnern (max. 200 Dateien)
   - Der direkte Ordnername wandert in den Dateinamen: aus `2026-08/app.log` wird `2026-08~app.log`, damit zwei gleichnamige Logs im Ergebnis unterscheidbar bleiben
   - Nicht passende Dateien werden beim Ordner-Durchlauf still übersprungen und einmal zusammengefasst; einzeln abgelegte bekommen ihren Grund einzeln genannt
   - Die Ablage ist **temporär** und steht nicht in der Config; sie bleibt bis „Ergebnisse löschen"
4. **Fehler-Limit** anpassen (Standard: 100 pro Datei)
5. **🔍 Analyse starten** — Fortschrittsbalken zeigt `X/Y Dateien (Z Fehler gefunden)`
6. **⏹ Abbrechen** — stoppt die laufende Analyse sofort
7. **Ergebnisse** erscheinen unterhalb der Live-Fehler im Dashboard mit grauem Header (📂-Prefix)
8. **🗑️ Pro Quelle löschen** — jede Analyse-Quellgruppe hat einen eigenen Lösch-Button im Header
9. **🗑️ Alle Ergebnisse löschen** — im Config-Panel: entfernt alle Analyse-Ergebnisse auf einmal
10. **Zeitfilter** — die Buttons 1h/2h/4h/6h/12h filtern auch Analyse-Ergebnisse (Von/Bis-Datum nicht)
11. **Kein Papierkorb** — Analyse-Ergebnisse werden direkt gelöscht (Wiederherstellung durch erneute Analyse)

| Button | Verfügbar wenn |
|---|---|
| 🔍 Analyse starten | Mindestens ein Pfad vorhanden, keine Analyse läuft |
| ⏹ Abbrechen | Analyse läuft |
| 🗑️ Ergebnisse löschen | Ergebnisse vorhanden, keine Analyse läuft |

> **Papierkorb:** Der Papierkorb (WatchPath) gilt nur für Live-Monitoring-Einträge. Analyse-Ergebnisse haben keinen Papierkorb — sie können jederzeit durch erneute Analyse wiederhergestellt werden.

### 📤 Weitergabe: was ins Paket wandert

Der Tab **📤 Weitergabe** erzeugt ein ZIP mit dem Programmcode und einer
bereinigten Start-Konfiguration. Fünf Sektionen sind wählbar:

| Sektion | Enthält | Standard |
|---|---|---|
| **Allgemeine Optionen** | Port, Dateigrenzen, Papierkorb, **Datei-Pattern** — ohne die KI-Export-Pfade (die gelten pro Benutzer) | an |
| **Regeln** | Fehlererkennung, Ausschlüsse, Schwellwerte, Priorität — alle vier Karten des Regeln-Tabs | an |
| **Watch-Pfade** | die überwachten Verzeichnisse | aus |
| **E-Mail / SMTP** | Server und Einstellungen, **ohne** Benutzername und Passwort | aus |
| **Backup-Ziele & FTP** | Ziele, **ohne** FTP-Benutzer und -Passwort | aus |

**Die Aufteilung folgt den Tabs, nicht der Datenstruktur.** Das `filePattern`
(`**/*.log`) gehört zu den Allgemeinen Optionen, weil es dort in der Oberfläche
steht — früher lag es bei den Mustern, und wer die abwählte, verlor es unbemerkt.
Die vier Regel-Karten bilden **eine** Sektion: sie beantworten gemeinsam „was ist
ein Fehler und wie wichtig ist er", einzeln weiterzugeben ergibt selten Sinn, und
der Einrichtungsassistent führt sie ebenfalls als einen Punkt.

**Nie im Paket:** Zugangsdaten, Benutzerkonten (`users/`), Logs, `node_modules`,
die Analyse-Pfade und die KI-Export-Pfade. Ein Paket trägt außerdem
`setupCompleted: false` — es ist immer eine Neuinstallation und soll den
Einrichtungsassistenten zeigen.

### 🚧 Erste Schritte (Einrichtungsassistent)

Ein frisch verteiltes Paket hat noch keine überwachten Pfade. In diesem Zustand
schwebt unten rechts eine **Einrichtungskarte** — sie startet geöffnet und liegt
außerhalb des Seitenflusses, verschiebt also nichts, wenn man sie auf- oder
zuklappt. Ein Klick auf den Kopf klappt sie ein; dieser Zustand wird pro Browser
gemerkt.

| Element | Bedeutung |
|---|---|
| **Ring** (z. B. `2/7`) | Anteil der wirklich eingerichteten Schritte — auch eingeklappt sichtbar. Abgehaktes zählt **nicht** mit |
| **Hervorgehobene Zeile** | der nächste offene Schritt |
| Klick auf eine Zeile | öffnet die passende Stelle (Tab in den Einstellungen bzw. das Analyse-Panel) |
| **✕** an einer Zeile | „brauche ich nicht" — der Punkt zählt nicht mehr als offen |
| **↺** | nimmt einen abgehakten Punkt wieder auf |
| **✓ Einrichtung abgeschlossen** | beendet den Assistenten dauerhaft (`setupCompleted`). **Der einzige Weg, die Karte loszuwerden** — danach kein Rückweg in der Hauptansicht |

**Ein Pflichtschritt, fünf Angebote.** Nur ohne überwachten Pfad läuft der
Monitor leer; alles andere — Allgemein, Regeln, E-Mail, Log-Analyse, Backup —
ist Angebot. **Das Rechtesystem hat keinen eigenen Schritt:** es wird unter
*Allgemein → Server* per Checkbox aktiviert, und der Hinweis auf `admin`/`admin`
steht im Text dieses Schritts.

**Die Karte bleibt stehen, bis du abschließt** — nicht nur solange Punkte offen
sind. Sonst wird sie einem unter der Hand weggerissen, sobald man den letzten
Punkt abhakt. Vorübergehend wegräumen geht über das Einklappen (Kopf anklicken);
zugeklappt zeigt der Ring weiter den Stand. Steht nichts mehr aus, meldet die
Kopfzeile „alles entschieden · unten abschließen".

**Wann gilt „Regeln" als erledigt?** Sobald **eine** der vier Listen des Tabs vom
Auslieferungszustand abweicht — Fehlererkennung (`Exception`, `Fehler`),
Ausschlüsse, Schwellwerte oder Priorität. Nicht alle vier: wer Schwellwerte
anlegt und die Filter so lässt, hat den Tab sehr wohl bearbeitet.

**Erledigt und abgehakt sind beide durchgestrichen** — beides ist abgearbeitet.
Unterscheidbar bleiben sie am Zeichen: grünes **✓** = eingerichtet, graues
**✕** = bewusst weggelassen (zusätzlich kursiv und blasser, mit **↺** zum
Zurücknehmen). Wird ein abgehakter Punkt später doch eingerichtet, gewinnt
„erledigt".

**Die Tabs tragen einen Punkt**, solange ihr Schritt offen ist — in der
Akzentfarbe beim Pflichtschritt, gedimmt bei den optionalen.

**Nur für Administratoren.** Alle Ziele sind admin-only; einem normalen Benutzer
würde die Karte zu Gesperrtem auffordern und erscheint deshalb nicht.

**Bestehende Installationen sehen die Karte nicht.** Beim ersten Start nach dem
Update gilt: gibt es schon überwachte Pfade, war hier jemand am Werk — dann wird
`setupCompleted: true` gesetzt.

**Zwei getrennte Dinge.** `setupCompleted` beendet den Assistenten als Ganzes
(Bestandserkennung oder „✓ Einrichtung abgeschlossen"); `setupDismissed` sammelt die einzeln
weggeklickten Punkte. Teilten sie sich ein Feld, nähme ein Zurückholen der
Einzelpunkte die Grundentscheidung mit zurück — genau so kam die Karte nach
einem Klick auf die Pille dauerhaft wieder.

**Solange kein Pfad eingerichtet ist**, sagt auch der leere Hauptbereich die
Wahrheit („🚧 Noch nichts eingerichtet") statt „✅ Keine Fehler" — sonst wirkt es
beim eingeklappten Assistenten, als liefe alles.

## Beenden

- ⏹️ "Monitor beenden" im Dashboard klicken, oder
- Konsole schließen, oder
- `Strg+C` im Terminal drücken

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| "Node.js ist nicht installiert" | Node.js von https://nodejs.org/ installieren |
| Port belegt | Server beendet alten Prozess automatisch. Falls nicht möglich: manuell in `config.js` anderen Port eintragen |
| Keine Fehler erscheinen | Prüfe ob `watchPaths` korrekt sind und Log-Dateien existieren. Beim Start werden nur tagesaktuelle Dateien geladen — ältere werden automatisch aktiviert sobald sie beschrieben werden |
| Verbindung getrennt | Dashboard reconnected automatisch nach 3 Sekunden |
| E-Mail wird nicht versendet | SMTP-Einstellungen prüfen, `emailTo` muss gesetzt sein. Siehe `email.log` für Details |
| E-Mail-Duplikate | Gleicher Fehler wird erst nach `deduplicateMinutes` (Standard: 60 Min.) erneut gemeldet — bei `kritisch` eingestuften Fehlern nach `criticalDeduplicateMinutes` (Standard: 15 Min.) |
| Wichtiger Fehler kommt zu spät per Mail | Prioritätsregel mit Stufe `kritisch` anlegen (Einstellungen → Regeln → Prioritätsregeln). Kritische Fehler umgehen das Sende-Intervall. Beim Start eingelesene *historische* Fehler lösen bewusst keine Sofort-Mail aus |
| Wichtiger Fehler verschwindet aus der Liste | `maxErrorsPerFile` verdrängt die ältesten Einträge. Als `kritisch` eingestufte Fehler werden zuletzt verdrängt — für Dauerbeobachtung zusätzlich das Limit erhöhen |
| "In Zeile springen" geht nicht | Versucht VS Code → Notepad++ → Notepad. VS Code oder Notepad++ sollte installiert sein für Zeilensprung |
| Netzlaufwerk: Keine Fehler | Polling ist Standard. Falls deaktiviert: Einstellungen → Monitor → Polling ✓ |
| Fehler erscheinen verzögert | Polling-Intervall ist 2s (lokal) bzw. 5s (Netzwerk) + 100ms Debounce + Flush (pollInterval + 200ms) = ~4,3s lokal / ~10,3s Netzwerk. Für Analyse: Debug-Logging aktivieren (Einstellungen → Allgemein → Debug-Logging ✓) — zeigt `[TIMING]`-Einträge in der Konsole |
| Notifications erscheinen nicht | Browser-Berechtigung erforderlich. 🔔-Button im Dashboard prüfen |
| Bestehende Fehler fehlen nach Neustart | `loadExistingErrors` muss `true` sein (Standard). Dateien über `maxLogFileSizeMB` (Standard: 6 MB) werden übersprungen — Limit ggf. erhöhen |

## E-Mail-Logging

Alle E-Mail-Aktivitäten werden in **`email.log`** im Projektverzeichnis protokolliert:

```
[07.05.26, 11:30:00] GESENDET → admin@example.com | MAD Dienst | 3 Fehler
[07.05.26, 11:35:00] ÜBERSPRUNGEN (Duplikat) → MAD Dienst | Exception in Modul XY...
[07.05.26, 11:35:00] FEHLER → Keasy Lokal | Connection refused
```

| Typ | Bedeutung |
|---|---|
| `GESENDET` | E-Mail erfolgreich an SMTP übergeben |
| `ÜBERSPRUNGEN` | Fehler nicht gemeldet (Duplikat innerhalb der Schutzzeit) |
| `FEHLER` | SMTP-Verbindung oder Sende-Fehler |

Die Datei wird automatisch auf 500 Zeilen begrenzt (Rotation beim Start).

## Historie

### 2026-09-01 — 🚧 Einrichtungsassistent für frisch verteilte Pakete

Ein frisch verteiltes Paket hat keine `config.js`; `bootstrapConfig()` erzeugt sie aus `config.default.js` — mit `watchPaths: []`. Das Dashboard zeigte in diesem Zustand **„✅ Keine Fehler — Überwache Log-Dateien…"**: ein grünes Häkchen und die Behauptung, es werde überwacht, obwohl nichts eingerichtet ist. Dazu legt `userStore` bei fehlender `users.json` still **admin/admin** an — die Warnung ging bisher nur in die Konsole.

**Ein Pflichtschritt, sechs Angebote.** Ohne überwachten Pfad läuft der Monitor leer; Allgemein (inkl. KI-Export-Pfade), Regeln, E-Mail, Log-Analyse, Backup und Benutzer sind Angebot. Wer einen davon nicht braucht, hakt ihn mit **✕** ab; sind alle Punkte erledigt oder abgehakt, verschwindet die Karte von selbst. Ohne das Abhaken stände bei jemandem, der weder E-Mail noch Backup nutzt, dauerhaft „5 offen" — eine Karte, die nie zufrieden wird, klickt man einmal weg und verliert dann auch die nützlichen Hinweise.

**Erledigt und abgehakt sehen unterschiedlich aus:** durchgestrichen mit grünem Häkchen heißt „eingerichtet", kursiv-blass heißt „bewusst weggelassen". Sonst ist in einem halben Jahr nicht mehr zu erkennen, was der Fall war. **„Erledigt" gewinnt über „abgehakt"**: wer E-Mail später doch einrichtet, sieht das, auch wenn er den Punkt einmal weggeklickt hatte.

**Die Karte schwebt, statt im Seitenfluss zu liegen.** Der erste Entwurf setzte sie über die Fehlerliste — beim Auf- und Zuklappen sprang damit das ganze Layout, und gerade beim Einrichten arbeitet man in den Einstellungen, wo das am meisten stört. Sie liegt jetzt in einem eigenen fixierten Host (`#setupHost`) unten rechts, startet **geöffnet** und verschiebt nichts. Ein **Fortschrittsring** (`conic-gradient`) zeigt den Stand auch eingeklappt; er zählt bewusst nur **wirklich Erledigtes**, sonst behauptet er Fortschritt, den es nicht gibt. Der Klappzustand liegt im `localStorage` — auf/zu ist Ansichtssache des Einzelnen, während `setupDismissed` für die ganze Installation gilt.

**Verworfen wurden zwei Alternativen.** Ein Drawer von rechts nimmt 340 px — zusammen mit dem Fehler-Index links bleibt beim Einrichten kaum Mitte. Eine Leiste am unteren Rand wäre gleichwertig, ist beim allerersten Start aber leichter zu übersehen. Freies Positionieren wurde bewusst nicht gebaut: der Assistent verschwindet nach der Einrichtung ohnehin.

**Der leere Hauptbereich sagt jetzt selbst die Wahrheit.** Beim Umbau auf die Schwebekarte wäre dort wieder „Keine Fehler" gestanden — also genau die Falschaussage, gegen die das Ganze gebaut ist, sichtbar spätestens beim Einklappen. Ohne Watchpath steht dort **„🚧 Noch nichts eingerichtet"**.

**Zwei Fehler, die erst der Praxiseinsatz zeigte.** Erstens meldete die Karte **KI-Export-Pfade und Analyse-Pfade als offen, obwohl beide genutzt wurden**: die Werte liegen in der **Benutzer**-Config (`userConfigStore`), geprüft wurde nur die globale `config.js`. `getSetupState()` bekommt jetzt den Benutzernamen. Zweitens hätte die Karte selbst mit korrekter Erkennung bei **jeder bestehenden Installation** aufgepoppt, sobald irgendein optionales Feature ungenutzt ist — sie ist für frisch verteilte Pakete gedacht. Fehlt `setupDismissed` und gibt es bereits Watchpaths, war hier schon jemand am Werk: die optionalen Punkte gelten dann als bewusst übergangen.

**Und ein dritter, den ein Screenshot aufdeckte:** „Nicht mehr anzeigen" schickt jeden offenen Schritt ans Abhaken — auch den Pflichtschritt, den die Whitelist ausschloss. Der Server antwortete korrekt mit „Unbekannter Schritt", die Karte blieb stehen. Serverseitig ist jetzt alles abhakbar; der Pflichtcharakter zeigt sich in der Darstellung, nicht im Verbot. Das ist auch nötig: wer das Werkzeug nur für die Log-Analyse nutzt, legt nie einen Watchpath an.

**Nur für Administratoren, und nur Wahrheitswerte.** Der Status geht in jede `init`-Nachricht, also auch an Nicht-Admins — dort als `{ zeigen: false }`. Er enthält keine Pfade und keine Hosts. Alle Ziele sind `data-admin-only`; einem normalen Benutzer würde die Karte zu Gesperrtem auffordern. Ohne Rechtesystem gilt der Passwort-Punkt als erledigt, statt zum Ändern eines Passworts aufzufordern, das niemand braucht.

**Der Passwort-Vergleich läuft einmal beim Serverstart.** `bcrypt.compare` ist absichtlich langsam (~50–100 ms); pro Verbindungsaufbau wäre das spürbar und hätte den WebSocket-Handler `async` gemacht. Solange nichts ermittelt wurde, gilt „kein Standardpasswort" — ein Fehlalarm wäre schlimmer als ein verspäteter Hinweis.

**Live nachziehen war Pflicht.** Ohne `broadcastSetupState()` stände „Log-Pfad eintragen" noch da, nachdem man ihn eingetragen hat. Der Broadcast wird pro Client nach Rolle berechnet und nach jedem Config-Speichern sowie nach jedem Abhaken ausgelöst.

**Ein latenter Fehler kam mit:** `switchConfigTab()` markierte den aktiven Tab über das globale `event.target`. Beim Aufruf aus der Karte wäre das die Karte gewesen, nicht der Tab — der Sprung hätte den falschen Tab markiert. Die Funktion sucht den Knopf jetzt über den Tab-Namen.

**Aufgeräumt beim Weitergabe-Paket:** in drei Paketdateien standen firmeninterne KI-Export-Pfade — als `placeholder` in `index.html`, als Beispiel in einem CSS-Kommentar und in einem Historie-Eintrag. Keine aktiven Werte, aber die Pfadstruktur wandert so in jedes verteilte Paket. Alle drei sind neutral (`z. B. C:\Repos\Projekt_Develop`).

**`test/setup-wiring.js` (neu)** prüft die Zustandslogik am echten Modul — ein simuliertes frisches Paket (die echten `BASE_DEFAULTS`) meldet 6 von 7 Schritten offen, ein gemocktes `admin/admin` wird von bcrypt erkannt, die Bestands-Migration läuft in beide Richtungen — und die Verdrahtung im Frontend, die in Node nicht nachstellbar ist. Dazu durchsucht er alle 94 Paketdateien nach internen Pfaden; die Suchmuster sind aus Fragmenten zusammengesetzt, sonst findet der Test seine eigenen Literale.

**Der Benutzer-Schritt ist wieder entfallen.** Das Rechtesystem wird unter *Allgemein → Server* per Checkbox aktiviert — dort gehört der Hinweis hin, nicht in einen eigenen Punkt. Mit ihm verschwand der aufwändigste Teil des Features restlos: `bcryptjs`, die Prüfung des Standardpassworts, deren Aufruf beim Serverstart und der `authAktiv`-Parameter. Aus sieben Schritten wurden sechs.

**„Fertig" und „abgehakt" mussten getrennt werden.** Beides lag zunächst in `setupDismissed`: die Bestandserkennung trug dort alle Punkte ein, ebenso „Nicht mehr anzeigen". Ein Klick auf die Pille holte damit **auch die Grundentscheidung** zurück — und weil ein leeres Array als „schon migriert" galt, kam die Karte danach dauerhaft wieder. `setupCompleted` ist jetzt ein eigenes Feld; die Pille erscheint bei gesetztem Flag gar nicht, und nach „Nicht mehr anzeigen" gibt es bewusst keinen Rückweg per Klick in der Hauptansicht.

**Die Pille hing auch sonst falsch.** Sie prüfte `abgehakt.length > 0` statt zu fragen, ob dort noch etwas *versteckt* ist. Nach der Bestandserkennung steht in der Liste alles drin, obwohl alles eingerichtet ist — die Pille wäre dauerhaft im Kopf geblieben, ohne dass es etwas zurückzuholen gäbe. Jetzt gilt dieselbe Regel wie in der Karte: `SCHRITTE.some(istAbgehakt)`, und „erledigt" gewinnt.

**Ein ausgeliefertes Paket markiert sich als Neuinstallation.** Wird die Sektion *Watch-Pfade* mitexportiert, bringt der Empfänger Pfade mit — und die Bestandserkennung hätte zugeschlagen: Pfade vorhanden, Feld fehlt, also „da war schon jemand". Der Assistent wäre bei genau dem stillgelegt worden, für den er gebaut ist. Die Auslieferungs-Defaults tragen deshalb ausdrücklich `setupCompleted: false`.

**Die Pause fror zu viel ein.** Das Nachziehen von Karte und Pille hängte an `if (!state.paused)` — bei aktiver Pause blieb die Pille klickbar stehen, obwohl der Server sie längst abgeschaltet hatte. Die Pause friert die **Fehlerliste** ein, nicht den Einrichtungsstand.

**Der Weitergabe-Dialog nennt seine Ausnahmen.** Bisher stand nirgends, dass die KI-Export-Pfade trotz angehakter Sektion *Allgemeine Optionen* nicht mitgehen. Die Labels sagen es jetzt — einzeilig neben der Checkbox, ohne Zusatzzeile darunter. Dabei fiel auf, dass „E-Mail / SMTP (ohne Passwort)" und „Backup-Ziele & FTP (ohne Passwort)" zu wenig versprachen: der Export entfernt bei beiden auch den **Benutzernamen**. Der Test hält Zusage und Verhalten gegeneinander — eine Zusage, die der Export nicht einhält, wäre schlimmer als gar kein Hinweis.

**Der Abschluss-Knopf hieß falsch — und das kostete mehrere Runden.** Er stand als blasser Nebenknopf da und hieß „Nicht mehr anzeigen": das klingt nach Unterdrücken, nicht nach Abschluss. Der Betreiber ging die Punkte durch, entschied je Punkt und suchte dann etwas, das „fertig" bedeutet — fand es nicht und meldete den Assistenten mehrfach als kaputt. Technisch war nach dem Klick alles korrekt; die Beschriftung hat nur nie dorthin geführt. Jetzt: **✓ Einrichtung abgeschlossen**, grün und als Hauptaktion erkennbar, die Funktion heißt `setupFertig()`.

**Die Karte verschwand von selbst — mitten in der Arbeit.** Sie hängte an „solange Punkte offen sind"; wer den letzten offenen Punkt abhakte, dem wurde sie unter der Hand weggerissen. Sie bleibt jetzt, bis abgeschlossen wird. Vorübergehend wegräumen geht über das Einklappen. **Damit entfällt die Pille ersatzlos** — sie war nur nötig, weil die Karte von selbst ging, und ihr Klick nahm alle Abhakungen zurück: ein abgehakter Punkt tauchte wieder auf, der halbe Fortschritt war weg.

**Vier Stellen, drei Antworten.** Die Frage „ist der Assistent noch aktiv?" wurde in Karte, Pille, Tab-Punkten und Leerzustand unterschiedlich beantwortet — `markiereTabs()` prüfte nur `zeigen`, nicht `fertig`, weshalb die grauen Punkte an Allgemein, E-Mail und Backup nach dem Abschluss stehen blieben. Statt die vergessene Stelle einzeln zu flicken, gibt es jetzt `assistentAktiv()`; ein Test verhindert, dass in `markiereTabs()` wieder eine eigene Prüfung entsteht. Ausgenommen bleibt der Leerzustand: ohne Watchpath wird tatsächlich nichts überwacht, und das bleibt wahr — nur der Verweis auf die Karte entfällt, wenn es sie nicht mehr gibt.

**Abgehaktes sah aus wie offen.** Blass-kursiv statt durchgestrichen — dabei ist ein bewusst weggelassener Punkt genauso abgearbeitet wie ein eingerichteter. Beide werden jetzt durchgestrichen; unterschieden wird am Zeichen (grünes ✓ gegen graues ✕).

**„Regeln" hängte nur an den Filtern.** Der Schritt steht für einen Tab mit vier Karten, geprüft wurde aber allein `filterPatterns`. Wer Schwellwerte anlegte und die Filter so ließ, sah den Punkt weiter offen. Jetzt genügt **eine** der vier Listen.

**Der Export teilte dasselbe Thema anders auf als der Rest.** Vier Karten im Regeln-Tab, drei Haken im Weitergabe-Dialog — einer davon fasste zwei Karten zusammen, ohne erkennbaren Grund, während der Einrichtungsassistent einen einzigen Punkt „Regeln" führt. Aus `patterns`, `thresholds` und `priorities` wurde die Sektion **`rules`**; aus sieben Haken werden fünf. **Dabei fiel ein stiller Datenverlust auf:** `filePattern` (`**/*.log`) lag in „Filter- & Ausschluss-Muster", steht in der Oberfläche aber unter *Allgemein → Dateien & Fehler*. Wer die Muster abwählte, setzte dem Empfänger unbemerkt das Datei-Muster zurück. Es gehört jetzt zu `general`.

**Was diese Runde gekostet hat, war die Diagnose.** Der Assistent wurde dreimal als „gleiches Verhalten" gemeldet, und dreimal habe ich erklärt, warum er so nicht funktionieren *kann*, statt am laufenden System nachzusehen. Als ich es tat, war die Sache in zwei Abfragen klar: Port 3848 lieferte eine Config mit einem einzigen Watchpath, leerer E-Mail und leerem Backup — das getestete Paket, nicht die Hauptinstallation. Und der eigentliche Fehler stand die ganze Zeit im Wort auf dem Knopf.

**Vorgehen:** Mockup mit vier Zuständen (frisch, teilweise, abgehakt, fertig), dann Code; für den Umbau auf die Schwebekarte ein zweites Mockup mit eingebauter **Messlatte**, die den Layout-Sprung in Pixeln anzeigt — inline mehrere hundert, schwebend 0.

**Dateien:** server/setupState.js (neu), server.js, server/wsBroadcast.js, server/routes/configRoutes.js, server/httpRouter.js, public/js/setupPanel.js (neu), public/js/render.js, public/js/state.js, public/js/wsClient.js, public/js/configPanel.js, public/index.html, public/style.css, test/setup-wiring.js (neu), README.md, AGENTS.md

### 2026-08-31 — 📎 update_docs war die ganze Zeit da — nur anders geschrieben

Beim Doku-Commit am selben Tag hatte ich behauptet, das in AGENTS.md genannte „Tool `update_docs`" stehe in Claude Code nicht zur Verfügung, und Version wie Historie von Hand gepflegt. **Das war falsch** — und die Behauptung stand damit selbst in AGENTS.md und in einem Historie-Eintrag, also als Projektwissen verankert. Beide Sätze sind zurückgenommen.

**Die Doku nannte die Funktion an zwei Stellen irreführend.** Im README-Kopf als „die Funktion update_docs (Extension) über die Konsole", in AGENTS.md als „Tool `update_docs` nutzen". Beides klingt nach einer Funktion der Umgebung, und wer nach `update_docs` sucht, findet `scripts/update-docs.js` nicht — Unterstrich gegen Bindestrich. Beide Stellen nennen jetzt den Aufruf:

```
node scripts/update-docs.js "Titel" "- Punkt 1" --files "a.js, b.js"
node scripts/update-docs.js          # interaktiv
```

**Zu finden gewesen wäre es trotzdem:** AGENTS.md führt `scripts/` seit langem als „Build/Dev-Hilfsskripte (update-docs.js etc.)". Ein `ls scripts/` hätte gereicht. Aus einer Formulierung geschlossen und die Schlussfolgerung nicht geprüft — der Fehler liegt nicht bei der Schreibweise allein.

**Der eigentliche Befund wiegt schwerer als der Irrtum.** Das Skript bumpt `package.json` und setzt einen Historie-Eintrag — **die Feature-Abschnitte oben in der README fasst es nicht an.** Damit war die Verrottung strukturell vorprogrammiert, die am selben Tag aufgefallen war: jede der im Abschnitt „📂 Log-Analyse" fehlenden Änderungen *hatte* ihren Historie-Eintrag. Das Werkzeug pflegt die Vergangenheit; den Zustand pflegte niemand. Das steht jetzt an beiden Stellen ausdrücklich dabei, damit die nächste Runde nicht wieder darauf baut.

**Und eine Festlegung zum Stil:** Historie-Einträge bleiben in der **ausführlichen Form** — fette Absätze, bei Bedarf Tabellen, und das *Warum* mit drin. Das Skript erzeugt Bullets, deshalb ist der Weg: Version und Grundeintrag (Titel plus `**Dateien:**`) vom Skript nehmen, den Text danach ausbauen. Dieser Eintrag ist genau so entstanden.

**Dateien:** AGENTS.md, README.md

### 2026-08-31 — 📦 Analyse-Ergebnisse in einem Sammelblock statt als Anhang

Die Analyse hing als **letzte** von acht Quellgruppen unter den fünf Live-Quellen: pro Ordner eine eigene Gruppe, gleichrangig, gleich aussehend. Bei einem Ordner-Lauf über mehrere Unterordner musste man also für genau das am weitesten scrollen, was man gerade angefordert hatte.

**Vorgehen:** Mockup mit vier Zuständen zum Vergleichen — Ist-Zustand und drei Vorschläge (A Ansichts-Umschalter im Kopf, B Sammelblock, C geteilte Ansicht), umschaltbar zwischen 2 und 14 Analyse-Dateien. Entschieden wurde **B als QuickWin jetzt, A als eigentliche Lösung morgen**. C fiel durch: mit dem Fehler-Index bleiben pro Spalte rund 40 % der Fensterbreite, und Fehlerzeilen sind mehrzeilig.

**Der Block liegt oben und ist zugeklappt.** Die Kopfzeile trägt die Kennzahlen — Dateien, Ordner, Fehler, kritische, ⏱️ Gaps, ⚠ unvollständig gelesen — und ist damit auch zugeklappt aussagekräftig. Der Rahmen in `--file-name-color` grenzt die Analyse deutlich von der Live-Überwachung ab; vorher war der graue Kopf der einzige Unterschied.

**Kein eigener Klapp-Mechanismus.** Der Kopf trägt `data-collapse-key` und ruft `toggleSource()` — dieselbe Funktion wie die Quellgruppen, die den Zustand bereits im `localStorage` merkt und die Seitenleiste mitnimmt. Für „standardmäßig zu" dient das invertierte Muster des Papierkorbs (`!== false`): ohne gemerkten Zustand zugeklappt, ein Klick speichert das Aufklappen. Bei aktiver Suche ist der Block immer offen — sonst sucht man in einem Block, der nichts zeigt.

**Zwei Dinge wären still kaputt gewesen.** Erstens hätte „⊟ Alle zu" den Block übersehen: `toggleAllSources()` und `updateCollapseAllButton()` selektieren `.source-header[data-collapse-key]`, alles wäre zugeklappt und der Analyse-Block offen daneben stehen geblieben. Beide Selektoren sind erweitert.

Zweitens der **Alarmknopf im Kopf**: er sitzt außerhalb der Quellgruppen, `closest('.source-group')` findet von dort nichts — `jumpToCritical()` wäre ohne eigenen Zweig still ausgestiegen, ein Knopf ohne Wirkung. Beim Bauen dieses Zweigs fiel der eigentliche Fehler auf: **auch der Klick im Fehler-Index** sprang bei zugeklapptem Block in ein `display:none`-Element, es passierte scheinbar nichts. `jumpToEntry()` klappt nur die Quellgruppe auf, nicht den Rahmen darum. Das Sichtbarmachen sitzt deshalb jetzt in `focusEntry()` — der gemeinsamen Endstelle **aller** Sprünge —, nicht in den einzelnen Aufrufern; sonst ist es beim nächsten Sprungweg wieder vergessen.

**Zwei bestehende Tests wurden rot, beide zu Recht.** `priority-wiring.js` prüft mit einem Zeichenfenster, dass `jumpToCritical` die Quelle über `toggleSource` aufklappt — der neue Zweig hat den Abstand über die 900 Zeichen hinausgeschoben; Fenster vergrößert, Prüfung unverändert. `error-index-wiring.js` bestand auf genau drei `data-collapse-key` (Live, Performance, Analyse-Quellen) — jetzt sind es vier. Die exakte Zahl ist dort der Punkt, deshalb mitgezogen und nicht aufgeweicht.

**`test/analyze-wrap-wiring.js` (neu)** hält die Fallstricke fest: dass der Block vorangestellt wird (`wrap + html` — steht er nicht vorne, ist das Feature wirkungslos), das invertierte Klapp-Muster, beide erweiterten Selektoren, der Alarmknopf-Zweig, `expandAnalyzeWrap` in `focusEntry` und die CSS-Regel `.analyze-wrap-body.collapsed` — ohne sie schaltet `toggleSource` eine Klasse, die nichts bewirkt, und der Klick bleibt folgenlos.

**Offen bleibt Variante A** — der Ansichts-Umschalter „Live / Analyse / Beides" im Kopf. B verkürzt den Block, löst das Grundproblem aber nur halb: aufgeklappt ist die Seite genauso lang wie vorher. Vor dem Bauen zu klären: ob Zeitfilter und Suche nur die sichtbare Welt filtern, und ob die Auswahl einen Browser-Neustart überlebt.

**Dateien:** public/js/render.js, public/js/actions.js, public/style.css, test/analyze-wrap-wiring.js (neu), test/priority-wiring.js, test/error-index-wiring.js, AGENTS.md, README.md

### 2026-08-31 — 📘 Die Doku wusste nichts von den letzten drei Ausbauten

Direkt nach dem Doku-Commit von heute fiel auf: der Abschnitt **📂 Log-Analyse** war weiterhin veraltet. Er kannte Pfade, Streaming, Fehler-Limit und Zeitfilter — und sonst nichts. Nicht dabei: die **Datei-Ablage** per Drag & Drop, **📥 Import**, die **📁 Ordner**-Übergabe vom 2026-08-25, die **⏱️ Gap-Warnung**, die **📂**-Ordnerauswahl am Pfadfeld und der Start-Knopf selbst. Dass `.json`-Dateien mitanalysiert werden, stand ebenfalls nicht drin — der Abschnitt sprach durchgehend von „rekursiv nach `.log`-Dateien".

**Die Historie hatte jeden einzelnen Zubau brav vermerkt.** Genau das ist die Falle: ein ausführlicher Historie-Eintrag fühlt sich wie erledigte Dokumentation an. Er beschreibt aber die **Veränderung**, nicht den **Zustand** — und wer wissen will, was das Werkzeug heute kann, liest nicht 1500 Zeilen Historie.

| | Zweck | Zeitform |
|---|---|---|
| Abschnitte vor „Historie" | wie es **heute** ist | Gegenwart, wird überschrieben |
| Abschnitt „Historie" | was **damals** geändert wurde und warum | Vergangenheit, bleibt stehen |

**Der Abschnitt ist jetzt vollständig neu**, gegliedert in vier Wege der Dateiübergabe (mit Tabelle, welcher Weg wofür gedacht ist — die Verwechslung „Ordner übergeben" gegen „Analyse-Pfad hinzufügen" kostet sonst hunderte unnötige Uploads), was ausgewertet wird, die Einstellungen im Panel und den Ablauf. Dazu die harten Zahlen, die vorher nur im Code standen: 200 Dateien pro Ordner-Durchlauf, Ablagen älter als 24 Stunden werden beim Serverstart weggeräumt, `.zip` wird entpackt und selbst verworfen.

**Damit es nicht wieder passiert, prüft `test/docs-tabs-sync.js` es jetzt statisch.** Dieselbe Datei, die schon die Tab-Tabelle gegen das Markup hält — sie war aus genau demselben Anlass entstanden, nur eine Stelle weiter. Neu ist Abschnitt 6: **jeder Knopf im Analyse-Panel** muss im Doku-Abschnitt vorkommen oder im Test begründet ausgenommen sein, und die drei Zahlenfelder müssen unter ihrem Panel-Namen auftauchen. Der Trick liegt in der Vollständigkeit beider Listen: ein **neuer** Knopf steht in keiner von beiden und fällt deshalb auf. Gegenprobe gemacht — ein testweise eingeschleuster Knopf ließ den Test sofort rot werden.

Aufgefallen sind dabei zwei Lücken, die niemand vermutet hätte: **„🔍 Analyse starten" und „⏹ Abbrechen" waren nirgends beschrieben** — die beiden zentralen Knöpfe des Panels.

**Und eine Klarstellung in AGENTS.md** zum Weg dorthin. Dort stand „Tool `update_docs` nutzen" — das klingt nach einer Funktion der Umgebung, gemeint ist aber `node scripts/update-docs.js`, ein Skript im Repo. Es steht jetzt mit Aufruf da.

**Was das Skript nicht kann, und warum die Doku trotzdem verrottet ist:** es bumpt die Version und setzt einen Historie-Eintrag — die Feature-Abschnitte oben in der README fasst es nicht an. Damit war genau dieser Zustand vorprogrammiert: jede der vermissten Änderungen hatte ihren Historie-Eintrag, gepflegt hat den *Zustand* niemand. Die Checkliste, welche Doku-Stellen bei einer Änderung durchzugehen sind, steht jetzt ebenfalls in AGENTS.md, samt Test-Hinweis.

**Nachtrag zur Konvention:** 92 der 109 Historie-Einträge enden mit einer Zeile **Dateien:** — bei den letzten drei war das eingeschlafen, auch bei den beiden von heute. Nachgezogen, in AGENTS.md festgehalten (bisher stand die Konvention nirgends, deshalb konnte sie unbemerkt verschwinden) und in `test/docs-tabs-sync.js` geprüft: der **jeweils neueste** Eintrag muss die Zeile haben. Ältere bleiben unangetastet — die Historie wird nicht rückwirkend umgeschrieben.

**Dateien:** README.md, AGENTS.md, test/docs-tabs-sync.js

### 2026-08-31 — ⚠️ Zwei Fehler-Limits, zwei Namen — und ein Lesestopp, der sich nicht mehr versteckt

Eine Analyse von `KeasyWin_2026-08-05.log` zeigte **100 Fehler**, obwohl **110** in der Datei stehen. Die zehn fehlenden lagen alle nach 17:22 Uhr, darunter ein `exception.ErrorCode: invalid_grant` um 17:26 und zwei Postausgang-Meldungen um 20:00. Kein Parser-Fehler: `analyzeFile()` bricht das Lesen ab, sobald das Limit erreicht ist (`rl.close(); stream.destroy()`), und die Datei war schlicht nur bis **17:21:45** gelesen. **Zu sehen war davon nichts** — ein unvollständiges Ergebnis sah genauso aus wie ein vollständiges, und die Fehlersuche lief prompt in die falsche Richtung („warum fehlen die *älteren*?").

Beim Nachsehen kamen zwei weitere Dinge hoch, die dieselbe Wurzel haben.

---

**Zwei Felder hießen wörtlich gleich.** „Max. Fehler pro Datei" stand sowohl unter *Allgemein → Dateien & Fehler* als auch im *Log-Analyse*-Panel. Sie tun grundverschiedene Dinge:

| | Live-Überwachung | Log-Analyse |
|---|---|---|
| Wirkung | **Ringpuffer** — ältester nicht-kritischer Eintrag fällt heraus | **Lesestopp** — Datei wird nicht weitergelesen |
| Verlust | nur in der Anzeige, Datei unberührt | der hintere Teil der Datei bleibt ungeprüft |
| Standard | 50 | 100 |

Sie heißen jetzt **„Max. Fehler je Datei (Live-Überwachung)"** und **„Max. Fehler je Datei (Analyse)"**. Beide haben einen Tooltip *und* eine sichtbare Erklärzeile darunter (`.field-hint`). Die Erklärung steht bewusst sichtbar und nicht nur im Tooltip: bei Nicht-Admins ersetzt `loginPanel.js` den `title` des gesperrten Feldes durch „🔒 Nur für Administratoren" — der Tooltip wäre dort also gar nicht lesbar.

**Das Live-Feld täuschte um den Faktor zwei.** `watchService.js` hielt `maxErrorsPerFile * 2`; bei eingetragenen 10 waren es 20. Der Wert gilt jetzt wörtlich, und der Standard steigt auf **50** — dieselbe Größenordnung wie vorher, nur ehrlich benannt. Client-Spiegelung (`wsClient.js`, `state.js`) und Defaults (`toolExport.js`, `configPanel.js`) ziehen mit; sie **müssen** übereinstimmen, sonst zeigt das Dashboard eine andere Anzahl kritischer Fehler als der Server hält. `test/eviction-priority.js` prüft die Spiegelung schon lange und schlug beim Umbau sofort an, was genau seine Aufgabe ist — der Check auf `* 2` ist jetzt einer *gegen* `* 2`, plus einer für `watchService.js`.

**Wichtig beim Update:** `config.js` ist gitignored, der neue Standard erreicht also keine bestehende Installation. Wer dort noch `maxErrorsPerFile: 10` stehen hat, bekommt nach diesem Update **10 statt der bisherigen 20** Einträge. Der Wert gehört einmalig hochgesetzt. Eine automatische Migration wurde bewusst *nicht* eingebaut: sie würde eine bewusst gesetzte Einstellung überschreiben und könnte 10 nicht von „wollte wirklich 10" unterscheiden.

---

**Ein Deckel, der einmal richtig war.** Beim Einlesen zum Start zählte `watchService.js` mit `Math.min(errorsAfter - errorsBefore, maxErrorsPerFile)` — eingeführt am 2026-05-09 („Fix: Fehler-Zählung Konsole ↔ Dashboard"), und damals korrekt: das Dashboard zeigte seinerzeit nur `maxErrorsPerFile` Einträge, die Konsole meldete mehr, also wurde die Konsole gedeckelt. Mit dem Umbau am 2026-07-30 („Dashboard zeigte zu wenige kritische Fehler") liefert das Dashboard alles, was der Server hält — der Deckel war ab da nicht mehr Gleichstand, sondern Untertreibung, und die Startmeldung „📥 X Fehler in Y Dateien" nannte bei Dateien mit vielen Treffern zu wenig. Er ist ersatzlos weg; der Store ist durch `evictOldest` ohnehin begrenzt.

---

**Der Lesestopp meldet sich jetzt.** `analyzeFile()` merkt sich in `au.truncated` (Map je Analyse-Benutzer), dass das Limit gegriffen hat, und **wann**: `lastTs` — der Zeitstempel des letzten gelesenen Eintrags — wurde für die Gap-Erkennung schon mitgeführt und ist genau die gesuchte Stelle. Der Vermerk geht als `analyze-truncated` an den Client, zählt in `analyze-done` als `truncatedFiles` mit und steckt in `getAnalyzeErrors()` — **sonst wäre der Hinweis nach F5 verschwunden**, obwohl die Ergebnisse bleiben.

Im Dashboard drei Stellen, absichtlich mehr als eine:

- **⚠-Badge im Datei-Kopf** — die Warnzeile allein wäre bei zugeklappter Gruppe unsichtbar, und zugeklappt ist der Normalfall bei vielen Dateien
- **Warnzeile über den Fehlern** („⚠ Limit 100 erreicht — die Datei wurde nur bis 17:21:45 gelesen.") — `buildFileGroupHtml()` nimmt dafür einen optionalen Block *vor* den Einträgen
- **Sammelbanner unter dem Fortschritt** („⚠ 1 von 1 Datei unvollständig gelesen") — eigenes Element, damit `analyzeStatus` weiter reiner Text bleibt

Farbe ist durchgehend `--highlight-fehler` (orange), **nicht** das Kritisch-Rot: ein erreichtes Limit ist kein kritischer Fehler, sondern ein unvollständiges Ergebnis. Aufgeräumt wird der Vermerk überall dort, wo auch die Ergebnisse verschwinden — Laufstart, „Ergebnisse löschen", Quelle löschen.

**Nebenbei gehärtet:** `maxErrorsPerFile` kam in `analysisRoutes.js` ungefiltert aus dem POST-Body und wird jetzt angezeigt. Der Wert wird auf eine Ganzzahl ≥ 1 gezwungen (`Math.max(1, Math.floor(Number(…)) || 100)`) — gleiche Behandlung wie die Gap-Optionen daneben, die das schon immer so machten.

---

**„💾 Pfade speichern" heißt jetzt „💾 Speichern".** Der Knopf sichert vier Dinge — Pfade, Fehler-Limit, Gap-Warnung, Idle-Schwelle —, und `analyzeSnapshot()` vergleicht auch alle vier; ein eigener Listener weckt ihn, wenn man an den Zahlenfeldern dreht. Nur das Label verschwieg die drei Zahlen. Das ist keine Kosmetik: wer das Analyse-Limit von 100 auf 500 stellt, muss auf diesen Knopf drücken, damit es beim nächsten Mal noch steht — auf „Pfade speichern" kommt man dabei nicht. Die Erfolgsmeldung heißt entsprechend „✅ Gespeichert". Der gleichnamige Knopf in der **Benutzerverwaltung** bleibt „Pfade speichern": dort speichert `userPanel_savePaths()` wirklich nur Pfade.

**Vorgehen:** erst ein bedienbares Mockup mit beiden Feldern, Badge, Warnzeile und Banner samt Umschalter zwischen „Limit hat gegriffen" und „vollständig" — abgenommen, dann der Code. Geprüft wurde gegen die echte Datei: Limit 100 → 100 Fehler, Lesestopp 17:21:45, ein Banner; Limit 500 → 110 Fehler, kein Hinweis, Vermerk des Vorlaufs geräumt.

**`test/analyze-truncate.js` (neu) hält das fest** — zunächst belegte nur ein Wegwerf-Skript, dass der Lesestopp gemeldet wird. Der Test baut seine Log-Datei selbst in einem temporären Verzeichnis und setzt die Filter-Pattern explizit: `*.log` **und** `config.js` sind gitignored, ein Repo-Test darf von beidem nicht abhängen, sonst läuft er auf einem frischen Klon nicht. Geprüft wird nicht nur, *dass* abgebrochen wird, sondern dass es beim Client ankommt: das Ereignis `analyze-truncated`, der Zähler in `analyze-done`, der Vermerk im Snapshot (ohne ihn ist der Hinweis nach F5 weg) und das Aufräumen beim nächsten Lauf. Der **JSON-Pfad wird eigens geprüft**: `emitJsonErrors` ist eine zweite, unabhängige Implementierung derselben Grenze und wird beim Nachziehen leicht vergessen.

Eine Feinheit steckt in der Ladereihenfolge: `analysisService` destrukturiert `broadcastToUser` beim Laden, ein später gesetzter Patch läuft ins Leere. Der Test lädt `wsBroadcast` deshalb **vor** dem Service — steht als Kommentar darüber, sonst dreht das jemand beim Aufräumen um und der Test wird stillschweigend blind.

Gegenprobe mit drei Mutationen am Quelltext: Broadcast entfernt, Store-Vermerk entfernt, `truncated.clear()` entfernt — jede wurde von genau dem zuständigen Check gemeldet.

**Dateien:** server/analysisService.js, server/runtimeStore.js, server/routes/analysisRoutes.js, server/watchService.js, server/toolExport.js, public/index.html, public/style.css, public/js/render.js, public/js/wsClient.js, public/js/state.js, public/js/analyzePanel.js, public/js/configPanel.js, test/eviction-priority.js, test/analyze-truncate.js (neu), README.md

### 2026-08-25 — 📁 Ganzen Ordner an die Log-Analyse übergeben

Neben „📥 Import" steht jetzt **📁 Ordner**. Der Browser läuft den gewählten Ordner selbst rekursiv ab und liefert jede Datei samt Relativpfad — ein zweites verstecktes `<input type="file" webkitdirectory multiple>`, sonst nichts. **Am Server ist keine Zeile geändert:** es geht weiterhin eine Datei pro Anfrage an `/api/analyze-upload`, die Ablage bleibt `temp-analyze/<benutzer>/`, die Auswertung bleibt pfadbasiert.

**Nicht der Weg für gemappte Laufwerke.** Was der Server ohnehin sieht — alles, was als WatchPath läuft, etwa `Y:\` —, gehört nicht durch den Browser. Solche Pfade werden über das **📂** neben dem Analyse-Pfad-Feld ausgewählt; `collectLogsRecursive()` liest sie direkt von der Platte, ohne einen einzigen Upload. Die Ordner-Übergabe ist für den anderen Fall: Dateien, die der Server **nicht** sieht — ein Log aus einer Mail, ein Notebook ohne Laufwerks-Mapping. Der Tooltip des Knopfes sagt das auch.

**Eigener Knopf statt zweiter Zeile in der Ablagefläche.** Beide Varianten standen im Mockup zur Wahl. Die Ablagefläche reagiert bereits auf Klick und öffnet die Dateiauswahl; ein zweites Klickziel darin wäre ohne Verlust des vorhandenen nicht sauber zu treffen.

**Der Relativpfad wird in den Dateinamen gefaltet.** Die Ablage ist flach — aus zwei `app.log` aus verschiedenen Unterordnern würden sonst `app.log` und `app.log (2)`, und im Ergebnis wäre nicht mehr zu erkennen, welcher Fehler aus welchem Ordner kam. Nur der **direkte** Ordner wandert mit: bei datierten Unterordnern trägt genau der die Information, der volle Pfad wäre nur Länge. Trenner ist die **Tilde** — in Windows-Dateinamen erlaubt und in Logdateinamen praktisch nie vorhanden, anders als `_` oder `.`. Aus `2026-08/app.log` wird `2026-08~app.log`. Einzeln abgelegte Dateien behalten ihren Namen unverändert; `safeName()` am Server verwirft weiterhin alles, was nach Pfad aussieht, und die Tilde überlebt das.

**Die Abweisung wird leiser — aber nur im Ordner.** Bisher wurde jede nicht passende Datei einzeln mit Grund aufgelistet. Das ist bei vier gezogenen Dateien genau richtig und bei 200 aus einem Ordner unbrauchbar: die Liste schiebt die übernommenen Dateien aus dem Bild. Jetzt gilt: **einzeln abgelegt → Grund zeigen, im Ordner gefunden → still überspringen und einmal zusammenfassen** („↳ 41 Dateien im Ordner übersprungen — ansehen"). Beurteilt wird in beiden Fällen an derselben Stelle, `dropSkipReason()`; nur die Lautstärke unterscheidet sich. **Ein fehlgeschlagener Upload bleibt in beiden Fällen laut** — „ist kein Log" ist eine Auskunft, „ging schief" ist ein Problem.

**Obergrenze 200 Dateien**, und zwar nur auf dem Ordner-Weg. Ein versehentlich gewählter Downloads-Ordner soll keine hunderte Uploads auslösen. Überzählige werden nicht stillschweigend abgeschnitten, sondern landen mit dem Grund „über der Obergrenze" in derselben Zusammenfassung. Wer vier Dateien zieht, spürt die Grenze nicht.

**Fortschritt beim Ordner-Upload.** Statt „⏳ übertrage …" steht dort jetzt „⏳ übertrage 34 von 80 …". Achtzig aufeinanderfolgende Anfragen ohne Zähler sehen aus wie ein Hänger.

**Beim ersten Versuch passierte scheinbar gar nichts** — und der Grund lag nicht im Neuen. `renderAnalyzePaths()` stieg bei **leerer Pfadliste** aus, bevor die abgelegten Dateien angehängt wurden. Wer also keinen Analyse-Pfad konfiguriert hatte, übergab einen Ordner, der Upload lief sauber durch, die Dateien lagen korrekt gefaltet in `temp-analyze/<benutzer>/` — und im Panel war nichts zu sehen. Der Fehler ist so alt wie der Datei-Drop selbst und traf ihn genauso; er fiel nur nie auf, weil dort meist schon ein Pfad eingetragen war. Die Ablage wird jetzt in **beiden** Zweigen gezeichnet, und `test/analyze-folder-wiring.js` hält das fest. `updateAnalyzeButtons()` kannte den Fall übrigens längst: „nur Abgelegtes, kein Pfad" schaltet den Start-Knopf frei — nur das Zeichnen zog nicht mit.

**`test/analyze-folder-wiring.js`** prüft das alles statisch: den Knopf und sein Ziel, `webkitdirectory` am versteckten Feld (fehlt es, öffnet der Browser stumm eine gewöhnliche Dateiauswahl), die drei Inline-Handler als `window`-Globals — `analyzePanel.js` liegt in einer IIFE, ohne `Object.assign(window, …)` läuft ein `onclick` dort ins Leere —, dass die Obergrenze im Ordner-Block steht und nicht auf dem Einzelweg, und dass die Faltung nur beim Ordner greift. Das Verhalten selbst ist in Node nicht prüfbar: `webkitdirectory` gibt es nur im Browser.

**Offen bleibt Variante B — den Ordner *ziehen*** statt ihn auszuwählen. Das braucht `webkitGetAsEntry()` synchron im Drop-Handler und ist bewusst zurückgestellt. Die beiden Entscheidungen von heute, Faltung und leise Abweisung, gelten dann mit; B wäre nur ein zweiter Einstiegsweg.

### 2026-08-25 — 🤖 KI-Export zieht von „Regeln" nach „Allgemein"

Die Karte **🤖 KI-Export** stand im Tab **📋 Regeln** und war dort der einzige Fremdkörper. Die vier Nachbarkarten beantworten durchgehend eine einzige Frage — *was ist ein Fehler, und wie wichtig ist er?* Fehlererkennung, Ausschluss, Schwellwerte, Priorität. Der KI-Export beantwortet stattdessen *wohin geht die Ausgabe?*. Sichtbar war das auch am Layout: Er ist die einzige Karte, die über `config-card-wide` die volle Rasterbreite braucht, weil zwei Windows-Pfade in eine 340-px-Regelspalte nicht passen.

**Warum Allgemein und nicht Monitor.** Der Tab Monitor führt die **Eingangs**pfade — was wird überwacht. Der KI-Export sind **Ausgangs**pfade. Zwei Pfadlisten mit gegensätzlicher Bedeutung im selben Tab laden zur Verwechslung ein („warum wird mein Working-Pfad nicht überwacht?"). Allgemein sammelt dagegen schon heute, was Betrieb und Ablage betrifft — Port, Dateigrenzen, Papierkorb; ein Zielverzeichnis gehört in diese Familie.

**„(pro Benutzer)" steht jetzt in der Überschrift**, nicht nur im Fließtext darunter. Der KI-Export ist der einzige Block ohne `data-admin-only` — in Allgemein ist sonst alles Admin-Sache, genau wie vorher in Regeln. Ein normaler Benutzer sieht dort also lauter gesperrte Felder und genau einen offenen Block; ohne Beschriftung wirkt das wie ein Fehler statt wie Absicht.

**Am JavaScript war nichts zu ändern.** Alle Zugriffe laufen über `getElementById` (`configPanel.js` beim Laden, Speichern und Entsperren der ↗️-Knöpfe, `loginPanel.js` beim Freischalten für Nicht-Admins) — kein Selektor hing am Tab.

**Zwei CSS-Regeln waren nötig**, weil Kartenoptik *und* Vollbreite am Regel-Raster hingen:

- `.config-columns > .config-card-wide` gibt der Karte im Zwei-Spalten-Raster von Allgemein wieder Rahmen, Hintergrund und `grid-column: 1 / -1`. Ohne sie stünde der KI-Export als schmucklose halbe Spalte neben dem Papierkorb.
- `flex: 1; min-width: 0` bei den Pfadfeldern kam vorher von `.config-rules-grid .config-field input` und steht jetzt bei `.config-card-wide` selbst. Die bereits vorhandene `max-width: none` allein reicht nicht: In einem Flex-Container bleibt ein Feld mit `width: auto` auf seiner Standardbreite von rund 20 Zeichen stehen — die volle Kartenbreite hätte den Feldern also nichts gebracht.

**Und eine Falle, die beim Umzug fast zugeschnappt wäre:** Die rechte Spalte in Allgemein holte ihren Hintergrund über `.config-columns > .config-column:last-child`. Die neue Karte ist das letzte Kind des Rasters — die Regel hätte ins Leere gezielt und *Dateien & Fehler* hätte seinen Hintergrund verloren. Der Selektor heißt jetzt `:nth-child(2)` und benennt damit, was gemeint war: die rechte Spalte.

**Der Test wandert mit.** `test/hint-collapse-wiring.js` zählte die Karten im Regeln-Tab und bestand auf fünf — er schlug beim Umzug sofort an, was genau seine Aufgabe ist. Er erwartet jetzt vier Regel-Karten, und die Ausnahme „KI-Export bewusst ohne Einklapper" prüft er weiterhin, nur eben im Tab Allgemein. Zwei Zusicherungen sind dazugekommen: dass die Karte über `grid-column: 1 / -1` die volle Rasterbreite bekommt, und dass die rechte Spalte nicht mehr an `:last-child` hängt — sonst fällt genau diese Falle beim nächsten Umbau wieder zu.

**Verweise nachgezogen:** der Tooltip des Regeln-Tabs nennt den KI-Export nicht mehr, die Tab-Tabelle in dieser Doku hängt ihn unter Allgemein, und der gesperrte 🤖-Knopf schickt im Titel jetzt nach „Einstellungen → Allgemein" statt nach „Regeln". Die Nennungen weiter unten in der Historie bleiben stehen — dort lag die Karte damals wirklich in Regeln.

### 2026-08-20 — 🔒 „Leer = Knopf gesperrt" gilt jetzt wirklich, und der Copilot-Export heißt KI-Export

Zwei Dinge in einem Zug, weil sie dieselbe Karte betreffen.

---

**„Leer = Button deaktiviert" war ein Versprechen ohne Umsetzung.**

Die Einstellungskarte behauptete das seit langem, tatsächlich kam die Absage **erst nach dem Klick** — als Statuszeile „❌ Develop: Pfad ist nicht konfiguriert". Betroffen waren drei Knöpfe: 🤖 und 🚀 (am Fehlereintrag **und**, seit heute, in der Datei-Kopfzeile) sowie das neue ↗️ an den Pfadfeldern.

**Die drei hängen bewusst an verschiedenen Dingen:**

| Knopf | folgt | Grund |
|---|---|---|
| 🤖 / 🚀 | dem **gespeicherten** Pfad | dorthin exportiert der Server |
| ↗️ am Eingabefeld | dem **aktuellen Feldinhalt** | wer einen Pfad eintippt, darf ihn vor dem Speichern nachsehen |

Der Client kann die Pfade nicht selbst kennen: sie stehen **pro Benutzer** in `users/<name>/config.json` und werden erst beim Öffnen der Einstellungen geholt — die Hauptansicht rendert aber vorher. Deshalb schickt die `init`-Nachricht zwei **Merker** mit, `copilotDevelopSet` und `copilotReleaseSet`. Bewusst nur Merker: die Pfade selbst haben in jeder init-Nachricht nichts zu suchen. Nach dem Speichern greift es ohne Neuladen, weil `saveConfig` ohnehin `loadConfig` nachruft und die Anzeige nur bei echter Änderung neu gebaut wird.

**Nebenbei aufgeräumt:** die beiden Knöpfe standen zweimal ausgeschrieben im Markup — am Fehlereintrag und in der Kopfzeile. Beide kommen jetzt aus **einem** Bauer `buildCopilotBtnHtml()`. Ohne das hätte die Sperre an zwei Stellen eingebaut werden müssen, und die zweite wäre beim nächsten Mal vergessen worden. Der gesperrte Knopf nennt im Titel den Grund („KI-Pfad Develop ist nicht konfiguriert (Einstellungen → Regeln)") — ein gesperrter Knopf ohne Begründung ist schlimmer als einer, der erst nach dem Klick meckert.

**Der eigentliche Fehler saß aber im CSS.**

Die Sperre wirkte trotzdem nicht — gemeldet als „geht nicht, die Vorbelegung funkt dazwischen". Ursache: **`.folder-picker-btn` und `.action-btn` hatten keinen `:disabled`-Stil.** Das ↗️ *war* gesperrt und nicht klickbar, sah aber vollkommen unverändert aus. `.copilot-btn` hatte den Stil (`opacity: 0.3`), `.config-save-btn` und `.config-reset-btn` auch — diese zwei Klassen nicht.

Ein gesperrter Knopf, der aussieht wie ein bedienbarer, ist schlimmer als keine Sperre: der Klick tut nichts, und man sucht den Fehler bei sich. Beide Klassen haben jetzt `opacity: 0.35`.

**Die Vorbelegung war nicht schuld, hat die Verwirrung aber erzeugt:** leert man das Feld, erscheint der graue Beispielpfad als Platzhalter. Das sieht nach Inhalt aus, ist keiner — der Code liest `.value.trim()`. Die Feld-Tooltips sagen jetzt klar „Leer = 🤖-Knopf gesperrt".

---

**Copilot-Export → KI-Export.**

Wir arbeiten nicht mehr mit Copilot, sondern mit Claude. Umbenannt wurde alles **Sichtbare**: Kartentitel, Tab-Tooltip, beide Feld-Tooltips, die Knopf-Beschriftungen („Einzelnen Fehler an die KI (Develop) exportieren", „Komplette Datei ins KI-Verzeichnis Develop kopieren"), die Sperr-Begründung, die Servermeldung und die Doku. Die exportierte Datei heißt jetzt **`ki-error-context.md`** statt `copilot-error-context.md`.

**Intern unverändert:** die Config-Schlüssel `copilotWorkingPathDevelop`/`-Release` (sie stehen in `users/*/config.json`, ein Umbenennen bräuchte eine Migration ohne sichtbaren Nutzen), die Routen `export-copilot-*`, die CSS-Klassen `.copilot-btn` und die Funktionsnamen. `AGENTS.md` hält den Widerspruch ausdrücklich fest — „KI-Export (Routen und Config-Schlüssel heißen intern weiter `copilot*`)" —, damit niemand darüber stolpert und sie versehentlich mitzieht.

**Die Historie behält die alten Namen.** Dort hieß die Funktion so, als die Einträge geschrieben wurden.

**Altlast:** in den Zielverzeichnissen liegt die alte `copilot-error-context.md` weiter herum. Nichts räumt sie automatisch weg, und in einem Repository-Verzeichnis löscht das Tool nichts ungefragt.

Ein Test hat die Umbenennung sofort gefangen: `hint-collapse-wiring.js` erkannte die Ausnahme-Karte (die einzige ohne einklappbaren Hinweis) am Wort „Copilot" im Titel. Angepasst — und das ist genau die Sorte Fund, für die diese Prüfungen da sind.

**Dateien:** public/js/render.js, public/js/state.js, public/js/wsClient.js, public/js/configPanel.js, public/index.html, public/style.css, server.js, server/routes/configRoutes.js, test/copilot-file-export-wiring.js, test/hint-collapse-wiring.js, AGENTS.md, README.md

### 2026-08-20 — ↗️ Copilot-Pfade im Explorer öffnen

Die beiden Copilot-Pfadfelder im Tab „Regeln" haben neben dem 📂 (Ordner auswählen) jetzt ein **↗️** bekommen: öffnet den eingetragenen Pfad im Explorer. Zum Nachsehen, was dort liegt, musste man den Pfad vorher von Hand herauskopieren.

**Kein vierter Aufruf derselben Route.** `/api/open-folder` bedienen inzwischen die Fehlereinträge (`actions.js`), die Backup-Ziele (`backupTargetsPanel.js`) und die Analyse-Pfade (`analyzePanel.js`). Der neue Knopf liest nur das Eingabefeld und gibt den Wert an das vorhandene `openFolder()` weiter — der `fetch` steht damit weiterhin an genau einer Stelle. Nebeneffekt: er erbt die Verbesserung vom Eintrag darunter, dass ein Verzeichnis **direkt** geöffnet wird statt der Elternordner mit markiertem Ordner.

Der Test hält das fest (`kein eigener fetch`), damit hier nicht doch noch eine vierte Kopie entsteht — bei vier gleichartigen Aufrufern ist das der wahrscheinlichste Weg, wie so etwas auseinanderläuft.

**Bei leerem Feld kommt eine Rückmeldung** („Kein Pfad eingetragen") statt eines Klicks ins Nichts — dasselbe Verhalten wie beim ↗️ der Backup-Ziele.

**Bewusst nicht mitgemacht:** der Knopf wird bei leerem Feld nicht ausgegraut. Das wäre konsequent, hängt aber am selben ungelösten Punkt wie die 🤖/🚀-Knöpfe — die Karte behauptet „Leer = Button deaktiviert", umgesetzt ist das nirgends. Das gehört in einem Zug für alle drei gemacht, nicht halb. Ebenso offen: dieselbe Möglichkeit an den Monitor-Pfaden.

**Dateien:** public/index.html, public/js/configPanel.js, test/copilot-file-export-wiring.js, README.md

### 2026-08-20 — 🤖 Komplette Log-Datei ins Copilot-Verzeichnis

Ein einzelner Fehler ließ sich schon per 🤖/🚀 als `copilot-error-context.md` in ein Arbeitsverzeichnis exportieren. Beim Arbeiten fehlte oft das Umfeld: was lief vor dem Fehler, wie lang waren die Abstände, was kam danach. Die beiden Icons sitzen jetzt **zusätzlich in der Datei-Kopfzeile** neben 📂/📝 und legen dort die **komplette Log-Datei im Rohzustand** unter **ihrem eigenen Namen** im jeweiligen Zielverzeichnis ab.

Sie stecken in `buildOpenButtonsHtml()` und erscheinen damit in allen drei Bereichen, die diesen Baustein nutzen — Live, ⏱️ Performance und Analyse. Hinter jedem Dateikopf steht ein echter Pfad, also ist es überall sinnvoll; eine Sonderbehandlung je Bereich wäre mehr Code für weniger Funktion.

**Der Dateiinhalt darf nicht durch den JSON-Body.** `parseJsonBody` deckelt bei **1 MB** und antwortet bei Überschreitung irreführend „errorText fehlt" — für Logs von 100 KB bis mehreren MB also untragbar. Der Client schickt deshalb nur `{ filePath, target }`, der Server kopiert die Datei mit `fs.copyFileSync`. Das hält den Rohzustand exakt und braucht keinen Streaming-Aufbau.

**Eigener Dateiname, nicht der feste.** `copilot-error-context.md` ist beim Einzel-Export fest verdrahtet; hätte der Datei-Export ihn mitbenutzt, würde er den Einzelfehler-Export bei jedem Klick überschreiben. Zielname ist `path.basename()`. Der Test hält beide Namen gegeneinander fest, damit das nicht zusammenwächst.

**Die Pfadprüfung ist neu — und war der eigentliche Aufwand.** Die bestehende Route validiert `filePath` **gar nicht**: unkritisch, solange der Pfad nur als Text ins Markdown wandert. Sobald der Server die Datei *liest*, wäre jede Datei des Rechners abholbar. `isKnownLogFile()` lässt deshalb nur zu, was der Server ohnehin anzeigt:

- Schlüssel im `errorStore` (Live) und im `performanceStore` (⏱️)
- Dateien im Analyse-Store **des jeweiligen Benutzers**
- Dateien in dessen Drag-&-Drop-Ablage (`temp-analyze/<benutzer>/`)

Dazu `canAccessLabel` wie bei `pause-source`, damit niemand eine Quelle exportiert, die er nicht sehen darf, und die Obergrenze `maxLogFileSizeMB` — eine 200-MB-Datei gehört nicht versehentlich in ein Repository-Verzeichnis. Gegengeprüft am laufenden Server: `C:/Windows/win.ini` wird mit „Unbekannte Datei" abgewiesen, und im Zielverzeichnis landet nichts.

**Geteilt statt kopiert:** die Zielverzeichnis-Auflösung samt ihren drei Fehlerfällen (nicht konfiguriert / kein Verzeichnis / existiert nicht) steckt jetzt in `resolveCopilotDir()` und wird von **beiden** Routen genutzt. Der größere Teil des Diffs in `configRoutes.js` ist deshalb verschobener, nicht neuer Code.

**Unverändert gelassen, obwohl auffällig:** die Route steht wie ihre Schwester in `ADMIN_ONLY_ROUTES`, während die Copilot-Pfade **pro Benutzer** konfiguriert werden und die Knöpfe für alle gerendert werden. Bei abgeschaltetem Rechtesystem ist jeder impliziter Admin, es wirkt sich also nicht aus. Ebenso weiterhin offen: `public/index.html` verspricht „Leer = Button deaktiviert", umgesetzt ist das nirgends — die Meldung kommt erst nach dem Klick. Betrifft die bestehenden Knöpfe genauso und wäre eine eigene Änderung.

`test/copilot-file-export-wiring.js` (neu) prüft 30 Punkte statisch, gezielt auf das, was im Browser nicht wie ein Fehler aussieht, sondern wie „der Knopf tut nichts": Inline-Handler gegen die window-Globals (beide Listen), Route in der Route-Map und in `ADMIN_ONLY_ROUTES`, `event.stopPropagation()` gegen das Zuklappen der Kopfzeile — dazu die vier inhaltlichen Zusagen: kein Inhalt im Body, Zielname ≠ fester Name, alle vier Quellen in der Pfadprüfung, `resolveCopilotDir` von beiden Routen genutzt.

**Dateien:** public/js/render.js, public/js/actions.js, server/routes/configRoutes.js, server/httpRouter.js, test/copilot-file-export-wiring.js (neu), README.md, AGENTS.md

### 2026-08-20 — 🔘 Knöpfe im Analyse-Panel sagen wieder, ob es etwas zu tun gibt

Zwei Knöpfe im Log-Analyse-Panel behaupteten eine offene Aufgabe, wo keine war.

**„💾 Pfade speichern" war immer grün und aktiv** — auch direkt nach dem Öffnen, ohne jede Änderung. Ein Knopf, der dauerhaft wie eine offene Aufgabe aussieht, verliert seine Aussage: man kann ihm nicht mehr ansehen, ob ungespeicherte Änderungen vorliegen. Der Speichern-Knopf der Config macht es seit langem richtig (aus, bis wirklich etwas geändert wurde), und `.config-save-btn:disabled` mit `opacity: 0.4` gab es auch schon — das Muster war hier nur nicht angewandt.

Jetzt trägt `state.analyzeSavedSnapshot` den Stand der zuletzt gespeicherten Werte: Pfadliste, Max. Fehler, Gap-Warnung, Idle. Gesetzt wird er beim Laden und nach dem Speichern; weicht die Anzeige ab, wird der Knopf aktiv. **Ohne Vergleichsstand gilt „nichts zu speichern"**, nicht „geändert" — sonst leuchtete der Knopf ausgerechnet in dem Moment zwischen Seitenaufbau und geladener Config, wo es garantiert nichts zu tun gibt.

Die **Zahlenfelder brauchten eigene Listener**: das Analyse-Panel liegt außerhalb von `#configPanel`, dessen Änderungserkennung greift dort nicht. Pfad-Hinzufügen und -Entfernen riefen `updateAnalyzeButtons()` schon auf.

**„⏹ Abbrechen" war klickbar, obwohl nichts lief.** Es wurde bisher nur über `display` ein- und ausgeblendet — das reichte nicht: bei einem klebenden Anzeigezustand blieb es sichtbar *und* klickbar, während serverseitig keine Analyse lief. Es ist jetzt zusätzlich `disabled`, solange `analyzeIsRunning` falsch ist. Damit greifen drei Dinge zusammen: ausgeblendet wenn nichts läuft, gesperrt falls es doch sichtbar ist, und die Route schickt selbst ein Ende, wenn es nichts abzubrechen gibt (Eintrag darüber).

Gegengeprüft an einer DOM-Attrappe über alle sechs Zustände — vor dem Laden, geladen, Zahl geändert, gespeichert, Pfad hinzugefügt, Analyse läuft.

**Dateien:** public/js/analyzePanel.js, public/js/state.js, README.md

### 2026-08-20 — 🔧 `.json` gilt jetzt überall als Log, und Abbrechen wirkt auch ohne laufende Analyse

Direkt nach der Erprobung des Drag & Drop fiel auf: eine Analyse über `S:\temp\HR` meldete **„Keine .log-Dateien gefunden"**, obwohl der Ordner existiert und Log-Dateien enthält — nämlich die **reinen JSON-Logs einer Schnittstelle**.

**Ursache war die Entscheidung aus dem Eintrag darunter.** Dort steht: „`.json` gilt nur für abgelegte Dateien. Bei einem konfigurierten Ordner würde sonst jede `package.json` im Baum als Log ausgewertet." Diese Regel schließt genau den Fall aus, für den das Feature gebaut wurde — sie entstand, *nachdem* der Hinweis „reine json-dateien haben wir auch für eine schnittstelle" gefallen war.

**Und das Gegenargument war schwächer als gedacht:** JSON wird **strukturell** bewertet (`evaluateJsonEntry`). Eine `package.json` hat kein Error-Objekt, kein `success: false` und keinen `code >= 400` — sie erzeugt also überhaupt keine Meldung. Der einzige echte Preis war **Lesezeit**, und die wird nur an einer Stelle teuer: `node_modules`.

Deshalb jetzt:

- **`.json` gilt überall als Log**, die Einschränkung samt `includeJson`-Verkabelung ist entfallen. Das `includeJson` der **Watch-Paths** bleibt unberührt — das ist eine eigene Einstellung für den Live-Watcher.
- **`node_modules` und `.git` werden in der Rekursion übersprungen** (`SKIP_DIRS`). Gezielt gegen die tatsächliche Gefahr, statt eine ganze Dateiendung zu opfern. Gegenprobe am Projektordner selbst: 17 Dateien statt der tausenden aus den Abhängigkeitsbäumen.
- **Die Meldung nennt die Endungen:** „Keine `.log`/`.json`-Dateien gefunden in den angegebenen Pfaden". Vorher stand dort nur `.log`, während `.json` schweigend ignoriert wurde — dieser Widerspruch war der eigentliche Grund, warum die Sache wie ein Defekt wirkte und nicht wie eine Regel.

---

**Zweiter, unabhängiger Fund: ⏹ Abbrechen tat unter Umständen gar nichts.** Die Route setzte nur `au.aborted = true`:

```js
const au = getOrCreateAnalyzeUser(username);
au.aborted = true;
```

Lief serverseitig gerade **kein** Lauf, sendete niemand etwas — der Client blieb im „läuft"-Zustand, der Start-Knopf blieb versteckt, und nur ein Reload half. Genau so ist eine Anzeige klebengeblieben, in der die Statuszeile von einem abgeschlossenen Lauf stammte und der Knopfzustand von einem späteren. `analyze-cancel` schickt jetzt in diesem Fall selbst ein `analyze-done` mit `aborted: true`. Damit ist Abbrechen immer ein Ausweg, unabhängig davon, wie der Zustand entstanden ist.

---

**Der Test hätte die Korrektur blockiert.** `test/analyze-drop.js` prüfte ausdrücklich das alte Verhalten („konfigurierter Ordner: nur `.log`") — mit Begründung, die inzwischen widerlegt war. Er prüft jetzt das Gegenteil plus die neuen Sprungverzeichnisse: `.log` gefunden, `.json` gefunden, `node_modules` und `.git` übersprungen, genau drei Dateien. Auch `AGENTS.md` stand auf der alten Regel und ist nachgezogen.

Lehre für den Umgang mit solchen Tests: ein Test, der eine *Entscheidung* festschreibt, muss mitgeändert werden, wenn die Entscheidung fällt — sonst verteidigt er den Fehler. Er ist deshalb nicht wertlos, im Gegenteil: er hat beim Ändern sofort angezeigt, welche Annahme gerade umgeworfen wird.

**Nebenbei ein Diagnose-Irrweg, der Zeit gekostet hat:** ein `fs.statSync` auf `S:\temp\HR` aus der Werkzeug-Shell liefert **ENOENT**, obwohl der Pfad existiert — gemappte Netzlaufwerke hängen am Benutzer-Token der Sitzung. Daraus wurde fälschlich „Pfad nicht erreichbar" geschlossen. Wer die Umgebung des Servers wissen will, muss den **Server** fragen: `POST /api/analyze-validate-path` mit `{"path":"S:/temp/HR"}` beantwortet das aus dessen Sicht (Schrägstriche verwenden — Backslashes überleben die Verschachtelung in Shell-Aufrufen nicht).

**Dateien:** server/analysisService.js, server/routes/analysisRoutes.js, public/js/analyzePanel.js, test/analyze-drop.js, AGENTS.md, README.md

### 2026-08-20 — ↗️ Pfad im Explorer öffnen, und Verzeichnisse landen nicht mehr im Eltern-Ordner

Die Analyse-Pfade haben vor dem ❌ ein **↗️** bekommen: öffnet den Pfad im Explorer. Kein neuer Weg — dieselbe Route `POST /api/open-folder`, die die Fehlereinträge in der Hauptansicht und die Backup-Ziele schon nutzen, und dasselbe Zeichen wie dort. Bewusst nicht `📂`: das steht in diesem Panel bereits für die *Ordnerauswahl*.

**Dabei fiel ein Fehler in der gemeinsamen Route auf.** Sie lief für alles über `explorer.exe /select,` — für **Dateien** richtig (Ordner öffnet, Datei ist markiert), für **Verzeichnisse** falsch: geöffnet wurde der *Eltern*-Ordner mit dem Verzeichnis markiert, statt hineinzugehen. Bei `S:\temp\HR` landete man in `S:\temp`. Jetzt entscheidet ein `statSync`, ob direkt geöffnet oder markiert wird.

**Das wirkt auch auf die Backup-Ziele**, die ebenfalls Verzeichnisse schicken (`E:\keasylogmonitor`, `D:\vfm`) und bisher genauso im Eltern-Ordner landeten — ein Nebeneffekt, aber der erwünschte. Nicht existierende Pfade verhalten sich wie bisher: `statSync` wirft, es bleibt bei `/select,`, und der Explorer meldet selbst, dass da nichts ist.

**Der Explorer geht auf dem Rechner des Servers auf** — bei Einzelnutzung dasselbe Gerät und daher unauffällig, im Mehrbenutzerbetrieb sieht ein Anwender an einem anderen PC nichts passieren. Das gilt für die vorhandenen Knöpfe genauso und steht jetzt als Kommentar an der Funktion, damit es nicht irgendwann als Fehler gesucht wird.

Die **abgelegten Dateien** haben absichtlich kein ↗️: der Client kennt den Ablage-Pfad nicht, damit kein Server-Pfad über den Browser wandert.

**Dateien:** server/routes/processRoutes.js, public/js/analyzePanel.js, README.md

### 2026-08-20 — 📄 Log-Dateien per Drag & Drop, und JSON-Fehler werden endlich erkannt

Bisher konnte die Log-Analyse nur Pfade auswerten, die der **Server** sieht. Wer Logs von einem Kollegen bekam, musste sie erst irgendwohin kopieren und den Pfad eintragen. Jetzt gibt es im Analyse-Panel einen Ablage-Bereich: Dateien hineinziehen (oder klicken), „🔍 Analyse starten" wertet sie zusammen mit den konfigurierten Pfaden aus.

**Warum überhaupt hochgeladen wird.** Ein Browser gibt beim Ablegen Name, Größe und **Inhalt** heraus, aber **nicht den Pfad** — das ist Absicht und nicht abschaltbar. Die Analyse arbeitet umgekehrt pfadbasiert (`fs.statSync`, `createReadStream`). Der Inhalt wird deshalb hochgeladen, in `temp-analyze/<benutzer>/` abgelegt, und die Analyse zeigt auf dieses Verzeichnis — **die gesamte bestehende Auswertung bleibt unverändert**: Filter, Ausschluss, Schwellwerte, Prioritätsregeln, ⏱️-Lücken.

Auf demselben Rechner klingt das nach Umweg. Im Mehrbenutzerbetrieb ist es der einzige Weg: wer das Dashboard von einem anderen PC öffnet, konnte bisher nur Pfade des Servers analysieren, jetzt seine eigenen Dateien.

**Entscheidungen, die den Bau bestimmt haben:**

- **Roher Body statt JSON, eine Datei pro Anfrage.** `parseJsonBody` deckelt bei 1 MB, Logs dürfen laut `maxLogFileSizeMB` 6 MB. Kein Base64, keine neue Abhängigkeit — und eine abgewiesene Datei reißt nicht den ganzen Stapel mit. Die Größe wird **während** des Empfangs geprüft, damit eine 500-MB-Datei nicht erst vollständig auf die Platte läuft.
- **Der Client kennt den Ablage-Pfad nicht.** Er schickt weiterhin nur die konfigurierten Pfade; die Ablage hängt der Server selbst an. Kein Server-Pfad, der über den Browser wandert.
- **ZIP wird entpackt und selbst verworfen** — flach und nur `.log`/`.json`. Die Verzeichnisstruktur ist für die Auswertung bedeutungslos und wäre der Weg, auf dem ein Eintrag wie `../../x.log` ausbrechen könnte. `adm-zip` war über das Backup ohnehin schon Abhängigkeit.
- **`.json` gilt nur für abgelegte Dateien.** Bei einem konfigurierten Ordner würde sonst jede `package.json` oder `tsconfig.json` im Baum als Log ausgewertet. In der Ablage liegen nur Dateien, die jemand bewusst hineingezogen hat.
- **Abgewiesene Dateien bleiben sichtbar, mit Grund** (falsche Endung, zu groß, leer). Sie stillschweigend zu verschlucken wäre schlimmer: man wundert sich sonst, warum vier Dateien hineingezogen und nur zwei ausgewertet wurden.
- **Ein eigener Drop-Bereich**, getrennt vom vorhandenen hinter „📥 Import". Der frisst **Pfadlisten** (CSV/TXT/Excel), dieser Log-**Inhalte**. Ein gemeinsamer Bereich wäre an `.txt` gescheitert — eine Pfadliste ist typischerweise `.txt`, ein Log kann es auch sein, und Zweideutigkeit bei „was passiert mit meiner Datei" ist teuer.
- **Aufräumen:** „🗑️ Ergebnisse löschen" nimmt die Ablage mit, plus Sweep beim Serverstart für alles über 24 Stunden. Nicht sofort nach der Analyse — sonst kann man nicht zweimal mit anderen Schwellwerten drüberlaufen.

---

**Beim Erproben fiel auf: JSON-Fehler wurden nicht erkannt.** Ein echter Fall aus der Schnittstelle:

```json
{ "error": { "code": 400, "message": "Ungültiges Format. Ein Komma fehlt im JSON-Body.", "status": "BAD_REQUEST" } }
```

Wurde **stillschweigend übergangen**. Und die naheliegende Abhilfe — ein Fehler-Pattern anlegen — wirkt nicht: bei `.json` entscheidet **nicht** der Textfilter, sondern `evaluateJsonEntry` strukturell. Diese Prüfung kannte genau `Error` mit `Type`/`Message` und `Success: false` — großgeschrieben. JavaScript unterscheidet bei Feldnamen, `"error"` mit `code`/`message`/`status` war für sie schlicht nicht vorhanden.

Erkannt werden jetzt drei Formen, weil Schnittstellen sie unterschiedlich schreiben:

| Form | Beispiel |
|---|---|
| Keasy-Stil | `{ "Error": { "Type", "Message" } }`, `"Success": false` |
| REST-Stil | `{ "error": { "code", "message", "status" } }`, `"success": false` |
| HTTP-Code | `code >= 400`, auch ohne Fehlerobjekt |

Dazu `timestamp` und `requestId` in Kleinschreibung. Die Meldung liest sich jetzt als `BAD_REQUEST (400): Ungültiges Format. Ein Komma fehlt im JSON-Body.`

**Bewusst nicht geändert:** kaputtes JSON gilt weiter *nicht* automatisch als Fehler. Am Ende eines mitgeschriebenen Streams ist ein halber Block der Normalfall — das würde bei jedem Lauf melden. Dort greift wie bisher der Textfilter als Rückfall, weshalb ein Muster wie `Unexpected token` in genau diesem Fall wirkt.

**Die Performance war die Bedingung, also wurde gemessen** — alte Fassung neben die neue gelegt, dieselben 2500 Blöcke mit langen Prompt-Texten (13 MB), Median aus neun Runden:

| | Zeit | erkannt |
|---|---|---|
| vorher | 13,9 ms | 1666 |
| nachher | 14,2 ms | 1666 |

**Aufpreis 1,9 %, 0,10 µs pro Block**, Durchsatz 574 MB/s. Eine erste Messung zeigte +18,6 % und war irreführend: dort wurden 500 Blöcke *zusätzlich* erkannt, und die Zeit ging in das Bauen dieser 500 Meldungen — nicht langsamer, sondern mehr gefunden. Der geringe Aufpreis kommt daher, dass die Erweiterung nur **Felder abfragt**: keine Regex über den Block, keine Schleife über alle Schlüssel, keine zweite `JSON.parse`. Der Aufwand bleibt unabhängig von der Blockgröße konstant — das zählt, weil `evaluateJsonEntry` auch der Live-Watcher benutzt.

---

**Zwei Fehler, die beim Bauen auffielen und behoben sind:**

- **`escapeJs` war nicht im Scope** von `analyzePanel.js` (nur `escapeHtml` war destrukturiert). Der Render-Code hätte beim ersten Ablegen geworfen — im Browser sichtbar als „tut nichts".
- **Die Namenskürzung schnitt die Endung ab.** 300 Zeichen + `.log` wurde stumpf auf 180 Zeichen gekappt, also ohne `.log`. Die Datei hätte in der Ablage gelegen und wäre nie analysiert worden, weil `list()` und die Analyse sie nicht als Log erkannt hätten. Jetzt wird der Namensteil gekürzt, die Endung bleibt.

`test/analyze-drop.js` (neu) prüft ohne Server gegen die Module, gezielt auf die drei realistischen Fehlerquellen: dass `.json` nur in der Ablage zählt (im konfigurierten Ordner bleibt `package.json` außen vor), dass JSON strukturell ausgewertet wird (Error-Objekt gefunden, Typ und Meldung in der Zeile, Zeitstempel aus dem JSON-Feld), und dass ein ZIP-Eintrag `../ausbruch.log` flach im Ziel landet statt eine Ebene höher. Dazu die Namensprüfung: `.txt` abgelehnt, Pfadanteile verworfen, Endung überlebt die Kürzung.

`temp-analyze/` steht jetzt in der `.gitignore` — neben `temp-backup/`, `temp-ftp/` und `temp-restore/`.

**Dateien:** server/analyzeDropStore.js (neu), server/analysisService.js, server/logParser.js, server/routes/analysisRoutes.js, server.js, public/index.html, public/js/analyzePanel.js, public/js/state.js, public/style.css, test/analyze-drop.js (neu), .gitignore, AGENTS.md, README.md

### 2026-08-19 — 🧭 Abschnitt „Konfiguration" war verrottet, jetzt maschinell abgeglichen

Die Tab-Tabelle unter „1. Im Dashboard" beschrieb einen Zustand, den es seit Monaten nicht mehr gab. Aufgefallen beim Lesen, nicht durch einen Fehler — beide Seiten sahen für sich plausibel aus.

| Doku sagte | Wirklichkeit |
|---|---|
| „neun Tabs" | zwölf |
| **🕵️ WatchPaths** | heißt **🕵️ Monitor** |
| **📂 Log-Analyse** als Tab | gibt es dort nicht — eigenes Panel über den Header-Knopf |
| Allgemein enthält „🤖 Copilot-Export, ⚠️ Fehlererkennung" | beides zog am 30.07. in den Regeln-Tab; Allgemein hat Server, Dateien & Fehler, Papierkorb |
| — | fehlten ganz: **📋 Regeln**, **🕘 Historie**, **📤 Weitergabe**, **👥 Benutzer** |
| — | kein Hinweis, dass sechs Tabs nur für Admins sind |

Die Tabelle steht jetzt in der Reihenfolge des Panels, mit 🔒 an den Admin-Tabs. Zwei Feinheiten sind neu hinterlegt, weil sie leicht zu Fehlschlüssen führen: die Admin-Tabs sind für die Rolle *User* **nicht versteckt, sondern deaktiviert** (Tooltip „🔒 Nur für Administratoren"), und bei abgeschaltetem Rechte-System entfällt der Tab **👥 Benutzer** ganz.

**Zwei weitere Fehler im selben Abschnitt**, gefunden beim Gegenrechnen des `config.js`-Beispiels gegen die echte Konfiguration:

- **`contextLinesBefore: 5` war eine Phantom-Option** — im Beispiel dokumentiert, aber von keiner Zeile im Code gelesen. Sie tut nichts. Entfernt. Das ist die unangenehmste Sorte Doku-Fehler: man stellt sie ein und wundert sich, warum nichts passiert.
- **`debugLogging` fehlte** in der Einstellungstabelle, obwohl es im Dashboard einstellbar ist. Ergänzt.
- Und eine dritte veraltete Wegbeschreibung: „Einstellungen → **WatchPaths** → Polling ✓" in der Fehlerbehebung heißt jetzt „→ Monitor".

Nicht angefasst: die Nennungen in der Historie (dort waren die Namen korrekt, als die Einträge geschrieben wurden) und `WatchPaths-Tabelle` im Architekturdiagramm — das beschreibt die Datei `watchPathsPanel.js`, ist also ein Codename, kein Tab.

**Der eigentliche Ertrag ist der Test.** `test/docs-tabs-sync.js` (neu) vergleicht die Doku gegen `index.html`:

1. gleiche Tabs, gleiche Anzahl, **gleiche Reihenfolge** wie im Panel
2. 🔒 in der Doku ↔ `data-admin-only` im Markup, tabweise
3. kein Tab für die Analyse behauptet
4. **jede Wegbeschreibung „Einstellungen → X" zeigt auf einen Tab, den es gibt** — der Abschnitt Historie ausgenommen, dort sind alte Namen richtig

Der Test hätte alle sechs Abweichungen gefunden. Damit ist die Tabelle nicht mehr Fleißarbeit, sondern geprüfte Zusage: wer künftig einen Tab hinzufügt, umbenennt oder verschiebt, bekommt einen roten Test statt einer stillen Lüge in der Doku. Dass die Reihenfolge mitgeprüft wird, ist Absicht — die Tabelle behauptet „in der Reihenfolge, in der sie dort stehen", also muss sie es auch tun.

**Dateien:** README.md, test/docs-tabs-sync.js (neu)

### 2026-08-19 — 🕘 Eigener Tab „Historie", Tab „Monitor-Einstellungen" heißt jetzt „Regeln"

Die Änderungshistorie lag als letzter großer Abschnitt der Dokumentation weit unten — 1336 von 1907 Zeilen, erreichbar erst nach den Abschnitten davor, die aufgeklappt starten und lang sind. Wer sehen wollte, was sich zuletzt geändert hat, scrollte.

**Drei Wege standen zur Wahl, zwei wurden verworfen:**

1. **Historie im README nach oben** — probiert und zurückgenommen. Im Tab hilft es, aber in der *flachen* Ansicht (GitHub, Editor, und die README im Tool-Paket für Empfänger) stehen dann 1336 Zeilen Änderungsprotokoll vor „Voraussetzungen" und „Installation". Wer das Tool zum ersten Mal in die Hand nimmt, scrollt an 96 Einträgen vorbei, bevor er liest, wie er es startet.
2. **Historie aufgeklappt starten** (`REF_SECTIONS` in `docsPanel.js`) — hätte die Titel sofort sichtbar gemacht, weil jeder Eintrag ein eigener Klapp-Block ist. Schiebt aber alles andere um 96 Zeilen nach unten und löst das Problem von Punkt 1 nicht.
3. **Eigener Tab** — gewählt. Löst die Anzeige im Programm und lässt die Datei in Ruhe. Ein Ziel statt eines Kompromisses an zwei Fronten.

**Neu: „🕘 Historie"** zwischen „📖 Dokumentation" und „🗄️ Backup", mit Suchfeld, „▼ Alle auf / ▲ Alle zu" und Trefferanzeige.

**Kein Server-Eingriff, kein zweites Dokument.** Der Doku-Tab baut die `##`-Abschnitte ohnehin zu Klapp-Blöcken um; der Historie-Block wird anschließend in den neuen Tab umgehängt (`moveHistoryToTab`). Drei Entscheidungen tragen das:

- **Umgehängt wird vor dem Aufbau des Inhaltsverzeichnisses.** Dadurch fehlt die Historie dort automatisch — kein Sonderfall im Verzeichnis, keiner im Scroll-Spy. Nach dem Verzeichnis umgehängt stünde sie doppelt drin.
- **Nur der Inhalt wandert, nicht die `<details>`-Hülle.** Der Tab-Name sagt „Historie"; eine zweite Klapp-Ebene wäre ein Klick für nichts.
- **Beide Tabs hängen an einem Abruf** (`/api/docs`, faul geladen). Der Historie-Tab löst ihn selbst aus — ohne diesen Zweig wäre er leer, solange man die Doku nicht vorher geöffnet hat. Das ist die Art Fehler, die im Browser nicht als Fehler aussieht, sondern als leerer Tab.

`toggleAllDocs` und `filterDocs` waren fest auf `#docsContent` verdrahtet. Das Auf-/Zuklappen nimmt jetzt einen Behälter entgegen (`toggleAllIn`), sonst hätte ein „Alle zu" den jeweils anderen Tab mitgeschaltet.

**Die Suche** filtert die Einträge selbst (`.docs-collapsible`), nicht `##`-Abschnitte — im Tab liegt genau eine Ebene, und die Frage lautet „in welchem Eintrag steht das?". Treffer werden aufgeklappt, sonst wäre die Fundstelle unsichtbar. Daneben steht die Zahl: „97 Einträge", beim Suchen „3 von 97" — die Gesamtzahl wächst mit jedem Eintrag, sie wird zur Laufzeit gezählt und steht nicht im Code. Ohne sie ist eine leergefilterte Liste nicht von einem Fehler zu unterscheiden. Beim Leeren des Feldes bleiben geöffnete Einträge offen — zuklappen wäre ein Eingriff in etwas, das der Suchende gerade lesen wollte.

**Der Doku-Editor bleibt im Doku-Tab** und bearbeitet weiterhin die ganze README samt Historie. Zwei Editoren auf einer Datei wären eine Einladung zum Datenverlust.

**Fällt das Umhängen aus** (kein `#historyContent`, etwa nach einem Teil-Rollback), bleibt die Historie im Doku-Tab und startet dort wie bisher zugeklappt — `REF_SECTIONS` führt sie weiter. Das ist kein toter Code, sondern der Rückfall.

---

**Der Tab „⚙️ Monitor-Einstellungen" heißt jetzt „📋 Regeln".** Gewünscht war eine Abkürzung auf „Einstellungen" — das wurde verworfen: der Knopf, der das ganze Panel öffnet, heißt bereits **„⚙️ Einstellungen"**, und der erste Tab darin heißt „⚙️ Allgemein". Ein Tab „Einstellungen" innerhalb der Einstellungen sagt nichts und konkurriert mit zwei Nachbarn.

„Regeln" benennt, was drin ist — vier Regellisten (Fehlererkennung, Ausschluss, Schwellwerte, Priorität) —, ist mit 6 statt 21 Zeichen deutlich kürzer als vorher, und räumt nebenbei das doppelte ⚙️ weg, das der Tab sich mit „Allgemein" geteilt hat.

Die **interne Kennung `monitorsettings` bleibt** unverändert: sie steht in CSS, in der Tab-Logik und in `test/hint-collapse-wiring.js`, und niemand sieht sie. Umbenennen wäre Aufwand ohne Nutzen.

**Verweise nachgezogen, mit einer Unterscheidung:** die Wegbeschreibung im Abschnitt Fehlerbehebung heißt jetzt „Einstellungen → Regeln → Prioritätsregeln", ebenso zwei Code-Kommentare, die den heutigen Zustand beschreiben. Die sechs Nennungen **in der Historie bleiben stehen** — dort hieß der Tab damals so, die Einträge waren korrekt, als sie geschrieben wurden. Sie umzuschreiben würde die Aufzeichnung verfälschen.

`test/history-tab-wiring.js` (neu) prüft 26 Punkte statisch, gezielt auf die drei Fehler, die im Browser nicht wie Fehler aussehen: dass der Tab den Abruf selbst auslöst (sonst leer), dass das Umhängen *vor* dem Inhaltsverzeichnis passiert (sonst doppelt), und dass beide „Alle zu" auf je einen Behälter begrenzt sind (sonst schaltet eines das andere mit).

**Dateien:** public/index.html, public/js/docsPanel.js, public/js/configPanel.js, public/js/state.js, public/style.css, test/history-tab-wiring.js (neu), README.md

### 2026-08-19 — 📂 Hinweistexte einklappbar, und was dabei auffiel

Die Hinweistexte in den vier Regel-Karten nahmen mehr Platz als die Einstellungen, die sie erklären — bei den Prioritätsregeln zehn Zeilen über einer einzigen Regel. Mit jedem weiteren Pattern wächst das weiter. Sie stehen jetzt hinter einer **beschrifteten Klappzeile**, eingeklappt per Vorgabe.

**Beschriftet statt ℹ️.** Drei Varianten standen am Mockup zur Wahl: ein ℹ️ im Kartenkopf, eine stehenbleibende erste Zeile mit „▾ mehr", oder eine Zeile, die sagt, was sie öffnet. Es wurde die dritte — „Wie Muster wirken", „⚠️ Unterdrückt den *kompletten* Eintrag", „Beispiel", „Reihenfolge und Praxistipp". Der Grund ist die zweite Beschriftung: bei den Ausschluss-Patterns ist die Warnung die wichtigste Aussage der Karte, und sie steht so **auch eingeklappt** da, in vier Wörtern statt vier Zeilen. Ein nacktes ℹ️ hätte sie verschluckt. Das folgt derselben Regel wie der Alarmknopf und die „Alle zu"-Umschaltung: die Beschriftung sagt, was der Klick tut.

**Verworfen: die stehenbleibende erste Zeile.** Sie hätte keine Kernaussage verloren, spart aber weniger Höhe und kostet in jeder Karte eine dauerhaft sichtbare Zeile — bei vier Karten genau der Platz, um den es ging. Ihre **Textumstellung wurde übernommen**: der tragende Satz steht jetzt in allen vier Blöcken vorn.

- Ausschluss-Patterns: die Warnung stand im zweiten Absatz und steht jetzt zuerst.
- Prioritätsregeln: „Die erste passende Regel gewinnt — spezifisch oben, allgemein unten" nach vorn. Dabei fiel ein **sachlicher Fehler** auf: „(das machen die Fehlererkennungs-Patterns *oben*)" stimmte seit dem Umbau ins Karten-Raster nicht mehr — die Fehlererkennung liegt je nach Fensterbreite daneben, nicht darüber. „oben" ist gestrichen.
- Schwellwertregeln: fehlendes Komma.

**Verworfen: Prioritätsregeln über die volle Breite.** Sie stehen in der zweiten Rasterzeile allein neben zwei leeren Spalten. Volle Breite füllt die Lücke, lässt aber die Regelzeilen unnötig weit auseinanderlaufen — die Lücke ist der geringere Preis.

**Der Zustand liegt an einer Stelle.** Gespeichert werden nur die *offenen* Karten (`keasy-hints-open`); die Vorgabe „eingeklappt" gilt damit ohne Sonderfall, auch für Karten, die später dazukommen. Versteckt wird über **CSS** (`.config-hint .config-hint-text`), nicht per `style.display` aus dem JS: dadurch blitzt der Volltext beim Laden nicht auf, und es gibt genau einen Zustand — die Klasse am Container — statt zusätzlich einen Inline-Style, der auseinanderlaufen kann.

**Beim Erproben fiel auf, dass der Text zu klein ist** — und zwar schon immer. Der Umbau hat das nicht verursacht, sondern sichtbar gemacht: hinter einem Klick öffnet man den Text bewusst und liest ihn, statt ihn zu überblättern. Ursache war eine relative Angabe in einer ansonsten absolut gesetzten Umgebung:

| Element | vorher | jetzt |
|---|---|---|
| Pattern-Chips | 16 px (erben, keine Angabe) | unverändert |
| Kartentitel | 14 px | unverändert |
| Feld-Label | 13 px | unverändert |
| Hinweistext | **12,8 px** (`0.8em` von der 16-px-Browser-Basis) | **14 px**, `line-height: 1.5` |
| `<code>` darin | ohne Angabe → Monospace rendert optisch kleiner | **13 px** |
| Klappzeile | 12,8 px | **14 px** |

`0.8em` hing an der Browser-Basis, während alles ringsum absolute Werte trägt — der Erklärtext war damit das kleinste Element der Karte, und die eingebetteten Muster (`Send_over_SMTP`, `TimeoutException`) fielen als Monospace noch darunter ab. Ausgerechnet die Begriffe, um die es im jeweiligen Satz geht. Die Zeilen standen zudem auf Kante, deshalb `line-height: 1.5`.

**Die Klappzeile war nicht als Klickziel zu erkennen.** Mit `background: none` lag sie farbgleich auf der Karte; ein 1-px-Rahmen allein ist kein Signal. Sie ist jetzt mit `--bg-secondary` gefüllt — der Hausgriff für anklickbare Zeilen, der in derselben Karte schon zweimal steht: die Regelzeilen (`.threshold-rule-card`) direkt darunter und die einklappbaren Abschnitte im Doku-Tab nutzen genau diese Füllung auf `--bg-tertiary`-Grund. Der Abstand trägt in allen drei Themes, hell wird heller, dunkel und blau dunkler. Ein eigenes Aussehen hätte behauptet, es sei etwas anderes als die Regelzeile zwei Zentimeter darunter — beides klappt auf.

Der **Pfeil in Akzentfarbe** kommt als drittes Signal hinzu, zwei der drei kommen ohne Farbwahrnehmung aus (Füllung, Rahmen, Farbe). Ein *dauerhaft* farbiger Rahmen wurde verworfen: vier durchgehend blau umrandete Zeilen konkurrieren mit den Kartentiteln, die schon in Akzentfarbe stehen.

**Nachgereicht: die Copilot-Felder liefen gegen eine Kappe.** Die Karte hat seit dem Eintrag darunter die volle Rasterbreite, die Felder blieben aber bei `max-width: 350px` aus `.config-field input[type="text"]` — rund 54 Zeichen statt der behaupteten 150. Behoben wie im Backup-Tab, der diese Basisregel aus demselben Grund schon überschreibt; die neue Ausnahme steht direkt daneben, damit ein künftiger Eingriff in die 350 px beide Abhängigkeiten sieht. Jetzt rund 170 Zeichen bei ~1400 px Fenster. Die Regel hängt an `.config-card-wide` und damit an genau einem Element — über die Rasterregel gelöst wären die Muster-Eingabefelder mitgewachsen.

**Nicht umgesetzt:** ein globales „Alle Hinweise auf/zu" wie im Doku-Tab. Bei vier Karten schien der zusätzliche Knopf in der Steuerleiste mehr Aufwand als Nutzen. Und der Hinweis im **Copilot-Export** bleibt sichtbar — ein einzelner Satz in einer Karte über die volle Breite kostet eine Zeile, dafür lohnt kein Bedienelement.

`test/hint-collapse-wiring.js` (neu) prüft 27 Punkte statisch: dass jede Regel-Karte einen Block hat, dass kein Hinweistext außerhalb des Containers hängengeblieben ist, dass `toggleHint` als window-Global steht, dass die Vorgabe leer ist, dass das Verstecken ohne `style.display` auskommt und dass jede Klappzeile eine Beschriftung von mindestens sechs Zeichen trägt. Der Test hat sich sofort bezahlt: er meldete fünf Hinweistexte auf vier Einklapper — die Copilot-Ausnahme ist dadurch als bewusste Entscheidung festgeschrieben statt als Zufall.

**Dateien:** public/index.html, public/style.css, public/js/configPanel.js, public/js/state.js, public/js/boot.js, test/hint-collapse-wiring.js (neu), README.md

### 2026-08-19 — 📐 Monitor-Einstellungen: gleich hohe Karten, Copilot-Pfade über die volle Breite

Zwei Layoutmängel im Tab „Monitor-Einstellungen", beide aus derselben Ursache: das Raster `repeat(auto-fit, minmax(340px, 1fr))` behandelt alle fünf Abschnitte als gleich breite Karten auf Inhaltshöhe. Für die Musterlisten passt das, für zwei Pfadfelder nicht.

**Die Copilot-Pfade waren unlesbar kurz.** In einer 340-px-Karte blieben nach dem 160-px-Label und dem 📂-Knopf rund 15 Zeichen sichtbar, während die Windows-Pfade 40–60 Zeichen lang sind (etwa `C:\Repos\Projekt_Release26.2hotfix`). Sichtbar war damit nie der Teil, auf den es ankommt — das Ende, das Develop von Release unterscheidet. Die Karte bekommt über die neue Klasse `.config-card-wide` mit `grid-column: 1 / -1` die volle Rasterbreite; die Felder haben dort schon `flex: 1` und wachsen von selbst mit — allerdings nur bis rund 54 Zeichen. **Korrigiert im Eintrag darüber:** hier stand ursprünglich „rund 150 Zeichen". Übersehen war die Basisregel `.config-field input[type="text"]` mit `max-width: 350px`, die weiter griff — die breite Karte brachte den Feldern damit weit weniger als behauptet.

**Kein fester Pixelwert.** Vor dem Umzug in dieses Raster hatten die Felder über `.config-column .config-field input[type="text"]` feste 350 px — genau der Wert, der eine 340-px-Karte gesprengt hätte und deshalb damals auf `flex: 1` wich. Eine Zahl wäre hier auch grundsätzlich falsch: die Schriftgröße ist über den Tab „CSS-Style" änderbar, eine in Pixeln gesetzte Feldbreite trägt dann eine andere Zeichenzahl.

**Die drei oberen Karten waren unterschiedlich hoch.** `align-items: start` hielt jede Karte auf Inhaltshöhe. Die Fehlererkennung ist mit dem längsten Hinweistext *und* zehn Patterns die höchste, Ausschluss und Schwellwerte endeten daneben sichtbar früher. `stretch` wirkt **zeilenweise** — deshalb gilt es unverändert bei einer, zwei oder drei Spalten. Genau darum sitzt die Lösung am Raster und nicht als `min-height` an den Karten: eine Mindesthöhe müsste je Fensterbreite anders lauten und bräuchte Media Queries, die dieses Raster bisher nirgends braucht.

**Die Bedienzeilen liegen jetzt auf einer Linie.** Bei gleicher Kartenhöhe endete die Eingabezeile der kürzeren Karten mitten im Feld, mit einem Loch darunter. `margin-top: auto` schiebt Eingabezeile bzw. „+"-Knopf an den Kartenfuß. Der Knopf braucht dazu `align-self: flex-start` — als Flex-Item der neuen Spalte wäre er sonst über die volle Kartenbreite gestreckt worden.

**Vorab am Mockup entschieden, nicht im Code:** ein bedienbares Mockup mit der echten `style.css` und den echten Werten aus `config.js`, vier einzeln schaltbare Varianten. Zwei wurden dort abgelehnt:

- **Label über dem Feld** (wie im Backup-Tab) brächte weitere ~20 Zeichen, ist aber überflüssig, sobald die Karte die volle Breite hat — und die Labels bleiben so auf einer Höhe mit allen anderen Einstellungsfeldern.
- **Prioritätsregeln über die volle Breite** würden die Lücke füllen, die neben ihnen in der zweiten Rasterzeile entsteht. Dafür würden die Regelzeilen („Zeile enthält", Dringlichkeit) unnötig weit auseinanderlaufen. Die Lücke ist der geringere Preis.

Reiner CSS-Umbau plus eine Klasse im Markup: keine ID, kein `onclick`, kein `data-admin-only` und keine Zeile JavaScript angefasst. `test/priority-wiring.js`, `test/error-index-wiring.js` und `test/eviction-priority.js` laufen unverändert durch.

**Bekannter Nebeneffekt:** Ausschluss und Schwellwerte haben durch die angeglichene Höhe Leerraum im Bauch. Die Alternative wäre, die Pattern-Liste den freien Platz füllen zu lassen statt fester `max-height: 200px` — dann scrollt die Fehlererkennungs-Liste weniger. Zurückgestellt, bis sich zeigt, ob der Leerraum in der täglichen Nutzung überhaupt stört.

**Dateien:** public/index.html, public/style.css, README.md

### 2026-08-18 — 🧭 Fehler-Index: Sprungliste statt Scrollen

Der Weg **zum nächsten Fehler** kostete unverhältnismäßig viel Zeit. Ursache war die Struktur der Anzeige: Quelle → Datei → Einträge, wobei die Eintragslisten zugeklappt starten (`.error-list` wird mit `display:none` gerendert). Man klappte also eine Datei auf, scrollte durch mehrzeilige Stack-Traces, und der nächste Fehler lag weit darunter. Bei ~90 Einträgen über vier Quellen war das der Hauptzeitfresser.

Neu ist eine **Seitenleiste mit allen Fehlern als Sprungliste**, gruppiert nach Quelle. Ein Klick klappt Quelle und Datei auf, scrollt zum Eintrag und markiert ihn.

**Vorlage und Entscheidungen** wurden vorab an einem bedienbaren Mockup getroffen, nicht im Code. Drei Gliederungen standen zur Wahl (nach Quelle / flach chronologisch / Baum Quelle→Datei→Eintrag); es wurde **nach Quelle** — bei fünf Watchpaths bleibt das überschaubar, während der Baum das Auf- und Zuklappen nur in die Seitenleiste verlagert hätte.

**Verworfen: eine Vor/Zurück-Leiste** `‹ 12/91 ›`. Sie war als billige Vorstufe geplant (~1 h, kein Layout-Eingriff) und wurde am Mockup abgelehnt: sie steppt quer über alle Watchpaths, und ohne Angabe der Quelle ist der Sprung wertlos — bei einer einzigen Log-Datei tragfähig, bei fünf Quellen nicht. Aus demselben Grund wird **je Quelle neu nummeriert**: eine fortlaufende Nummer über vier Watchpaths behauptet eine Reihenfolge, die es nicht gibt.

**Umfang ist eine Regel, keine Einstellung.** Live-Fehler immer, Analyse-Treffer sobald welche da sind, ⏱️-Lücken nie. Weil die Analyse bewusst gestartet wird, braucht es dafür keinen Schalter — der Index folgt einfach der Anzeige. Das ist *weniger* Code als eine Einstellung „nur Live", die eine Filterbedingung bräuchte. Lücken bleiben außen vor: sie sind keine Fehler und haben keine Dringlichkeitsstufe.

**Keine zweite Textaufbereitung.** Die Kurzfassung im Index entsteht mit derselben Logik, die schon die Desktop-Benachrichtigung füllt — dafür wanderte `buildNotificationBody()` aus `boot.js` als `Keasy.utils.entrySummary()` in die Utilities (Zeitstempel abschneiden, Trennlinien überspringen, Ankündigungszeile wie „Der folgende #Fehler ist aufgetreten:" mit der Folgezeile zusammenziehen). Zwei Implementierungen wären auseinandergelaufen, und dann stünde in der Benachrichtigung etwas anderes als in der Liste.

**Keine zweite Sprungmechanik.** `jumpToCritical()` (🚨-Alarmknopf) und der neue `jumpToEntry()` teilen sich `focusEntry()`. Beide klappen die Quelle über `toggleSource()` auf, damit der gemerkte Auf-/Zu-Zustand nicht umgangen wird.

**Kein zweiter Durchlauf über die Daten.** `state.navEntries` wird in `buildErrorEntryHtml()` gefüllt — also in den Schleifen, die die Anzeige ohnehin baut. Der Index zeigt dadurch garantiert dieselbe gefilterte Menge wie die Anzeige; Suche und Zeitraumfilter wirken automatisch mit.

**Das Sprungziel ist nicht mehr rot.** Bisher blitzte der angesprungene Eintrag in `--sev-critical` auf — auf einer ohnehin rot dominierten Anzeige trug das kaum Information, bei Rot-Grün-Sehschwäche gar keine. Und nach 1,2 s war es weg, danach war nicht mehr zu sehen, wo man gelandet war. Jetzt **bleibt** die Markierung stehen und ist wie bei den Prioritätsregeln redundant codiert; zwei der drei Signale kommen ohne Farbe aus:

1. **Helligkeit** — `--bg-tertiary` hebt sich in allen drei Themes deutlich von `--error-entry-bg` ab (in Graustufen prüfbar; `--file-header-bg` tat das *nicht*, es liegt in Dunkel und Blau zu nah an `--bg-secondary`)
2. **Form** — Rahmen rundum plus doppelt dicker linker Balken
3. **Farbe** — Akzent, die einzige Nicht-Rot-Farbe der Fehleranzeige

Bei kritischen Einträgen überschreibt die Markierung deren roten Grund. Die Dringlichkeit bleibt über das ausgeschriebene Abzeichen „🔴 Kritisch" ablesbar — genau dafür ist es redundant codiert.

**Nachgereicht nach der Erprobung — ein Auf-/Zu-Zustand, nicht zwei.** Der Index brachte zunaechst ein eigenes Gedaechtnis fuer eingeklappte Quellen mit (`indexCollapsed`). Damit liefen Hauptansicht und Seitenleiste auseinander: ein Klick auf den Watchpath in der Anzeige liess die Gruppe im Index unberuehrt. Beide teilen sich jetzt `state.collapsedSources` — der Index-Kopf sucht den Quellen-Kopf ueber ein neues `data-collapse-key` und ruft `toggleSource()` auf. Zustand, Pfeil und Persistenz werden dadurch an genau einer Stelle gepflegt; das ist weniger Code als vorher.

**Ausserdem neu: `⊟ Alle zu` / `⊞ Alle auf`** in der Steuerleiste — klappt alle Quellen auf einen Schlag zu oder auf. Ist irgendeine offen, klappt der Knopf alle zu, sonst alle auf; die Beschriftung sagt, was der Klick tut. Der Zustand wird gebuendelt gesetzt und einmal geschrieben, statt `toggleSource()` je Quelle aufzurufen (das wuerde N-mal neu rendern).

**Und der Quellen-Kopf klebt jetzt auch in der Hauptansicht** (`position: sticky`) — mitten in einem langen Stack-Trace bleibt ablesbar, in welchem Watchpath man liest. Bewusst nur diese eine Ebene: die Steuerleiste bricht auf schmalen Fenstern in mehrere Reihen um und wuerde klebend dauerhaft ein Viertel der Hoehe fressen, und der Dateiname steht ohnehin in jeder Index-Zeile. Ohne Schalter — eine klebende Zeile hat keinen Nachteil, der eine Einstellung rechtfertigt.

**Bedienung** — drei Elemente, alle merken sich ihren Zustand in `localStorage`:

| | wo | was |
|---|---|---|
| 🧭 Index | Steuerleiste | Seitenleiste ein/aus |
| ⇄ | Kopf der Seitenleiste | links oder rechts |
| Alle / 🔴 Nur kritische | Filterzeile | filtert die **Navigation**, nicht die Daten — die Anzeige bleibt vollständig |

Der Filter saß zunächst als kleine Pille im Kopf und wurde schlicht übersehen; er steht jetzt als eigene Zeile über die volle Breite. Ein Bedienelement, das man suchen muss, ist keins.

**Weitere Details aus der Erprobung:**

- **Der Quellen-Kopf klebt** beim Scrollen der Liste (`position: sticky`). Sonst ist nach ein paar Zeilen wieder unklar, in welchem Watchpath man liest — dasselbe Problem, an dem die Vor/Zurück-Leiste gescheitert ist.
- **Die Zeitspalte wird vom Inhalt bestimmt** (`max-content`), nicht von einer festen Pixelbreite. 46 px waren zu schmal für `13:28:02` in Cascadia Code — die Uhrzeit lief über und verschluckte den Spaltenabstand. Feste Breiten für Text sind hier besonders heikel, weil die Schriftgröße über den Tab „CSS-Style" änderbar ist.
- **Nur die Meldung** ist auf zwei Zeilen begrenzt, nicht der ganze Textblock. Sonst verschwand bei zweizeiliger Meldung der Dateiname — ausgerechnet bei den langen Einträgen, wo man die Herkunft am ehesten braucht.
- **Scrollposition und Markierung überleben den Neuaufbau.** `renderAll()` baut bei jedem eingehenden Fehler das komplette HTML neu auf; ohne Gegenmaßnahme spränge die Liste im Live-Betrieb dauernd an den Anfang. Der aktive Eintrag wird über die **Objektreferenz** wiedergefunden, nicht über eine Element-ID oder eine laufende Nummer — die werden bei jedem Durchlauf neu vergeben.
- Unterhalb von 1100 px Fensterbreite blendet sich die Leiste aus; die Fehlertexte brauchen dort den Platz.

`test/error-index-wiring.js` prüft die Verdrahtung statisch: DOM-IDs, Inline-Handler gegen die window-Globals, Ladereihenfolge, dass es nur *eine* Textaufbereitung und *eine* Sprungmechanik gibt, dass Lücken nicht im Index landen, und dass die Markierung ohne `!important` und ohne `--sev-critical` auskommt.

**Nachgereicht: die Seitenleiste folgt dem Scrollen.** Beim Lesen in der Hauptliste zeigt der Index jetzt mit, wo man gerade ist — die Seitenleiste ist eine Karte, „du bist hier" ist ihre Aufgabe.

Es gibt dadurch zwei Bedeutungen, die nach **Ort** getrennt sind statt nach Farbe: die Seitenleiste zeigt die Leseposition und folgt dem Scrollen, der Rahmen im Fehlertext bleibt das **Sprungziel**. Ein mitwandernder Rahmen mitten im Lesebereich wäre Unruhe; in der schmalen Liste ist die wandernde Zeile dagegen genau die gesuchte Auskunft. Ein Sprung setzt beide, danach läuft nur noch die Liste mit.

- **`IntersectionObserver`** statt Scroll-Handler — ein Listener müsste bei jedem Frame über alle Einträge laufen.
- **Leseband** `rootMargin: -25% / -65%`: nur was das obere Viertel bis Drittel des Fensters kreuzt, gilt als „hier bin ich". Ohne Band wären bei langen Stack-Traces mehrere Einträge gleichzeitig sichtbar.
- Der Beobachter wird **nach jedem Neuaufbau neu gesetzt** (und der alte vorher getrennt) — `renderAll()` ersetzt sämtliche Eintrags-Elemente, alte Beobachtungen zeigten ins Leere.
- Die Lesemarke hängt wie das Sprungziel an der **Objektreferenz**, nicht an der Element-ID.
- Die Seitenleiste holt die Zeile über `scrollTop` in Sicht, nicht über `scrollIntoView` — das würde die Seite darunter mitscrollen und den Blick vom Fehlertext wegreißen.

**Nachgereicht: Ankuendigungszeile faellt weg.** Keasy-Fehlerbloecke beginnen mit „Der folgende #Fehler ist aufgetreten:“ — einer Zeile, die ueber nahezu jedem Eintrag steht und fuer sich nichts sagt. Sie kostete 37 Zeichen, sodass dahinter nur noch der Exception-Typ Platz hatte und die eigentliche Meldung wegfiel. `entrySummary()` wertet jetzt die Felder `Type:` und `Message:` aus:

```
vorher:  Der folgende #Fehler ist aufgetreten: Type: IOException
jetzt:   IOException — Alle Pipeinstanzen sind ausgelastet.
```

An 77 echten Eintraegen gegengerechnet: 27 werden dadurch aussagekraeftig, 50 ohne solchen Block laufen unveraendert ueber die bisherige Logik (Ankuendigungszeile mit der Folgezeile zusammenziehen). Die Zeile wird dabei im Schnitt 13 Zeichen *laenger* — es ging nie um Platz, sondern darum, was die Zeichen tragen. Wirkt auch auf die Desktop-Benachrichtigung; das fuehrt das Ziel des Commits vom 30.07. fort, in dem die eigentliche Fehlermeldung sichtbar werden sollte.

**Nachgereicht: Kuerzung an der Wortgrenze.** `entrySummary()` schnitt bei Erreichen der Laengengrenze mitten im Wort ab (`… Bitte den Systemadministrator kontaktieren. Sql T`). Jetzt wird an der letzten Wortgrenze geschnitten und ein … angehaengt. Der Rueckschnitt greift nur, wenn dabei nicht mehr als 40 % verlorengehen — bei einem einzelnen langen Token (Pfad, GUID, Stack-Zeile) gibt es keine brauchbare Grenze, dann bleibt es beim harten Schnitt. Wirkt auch auf die Desktop-Benachrichtigung, es ist dieselbe Funktion.

**Dateien:** public/js/errorIndexPanel.js (neu), public/js/render.js, public/js/actions.js, public/js/utils.js, public/js/state.js, public/js/boot.js, public/index.html, public/style.css, test/error-index-wiring.js (neu), test/error-index-live.js (neu), AGENTS.md, README.md


### 2026-07-30 — 🗂️ Monitor-Tab entlastet: eigener Tab „Monitor-Einstellungen"

Der Monitor-Tab platzte rechts. Ursache war die Struktur: ein Raster **3fr / 2fr**, links nur die Pfad-Tabelle, rechts **fünf** gestapelte Abschnitte (Copilot-Export, Fehlererkennung, Ausschluss, Schwellwerte, Priorität). Gleichzeitig hatte die Tabelle mit ihren acht Spalten in `3fr` zu wenig Platz und scrollte horizontal — es lief also rechts über, während links gescrollt werden musste.

- **Neuer Tab „⚙️ Monitor-Einstellungen"** direkt nach „🕵️ Monitor" nimmt alle fünf Abschnitte auf. Der Monitor-Tab hat damit genau eine Aufgabe: die überwachten Pfade, über die volle Breite und ohne horizontales Scrollen.
- Die fünf Abschnitte liegen als gleichwertige Karten in `.config-rules-grid` — `repeat(auto-fit, minmax(340px, 1fr))` stellt sich je Fensterbreite selbst auf eine, zwei oder drei Spalten ein, **ohne** Media Query. Reihenfolge: die vier Regel-Abschnitte zuerst, der Copilot-Export zuletzt (einmal eingestellt, dann nicht mehr angefasst).
- Reiner Markup- und CSS-Umbau: alle IDs, `onclick`-Handler, `title`-Tooltips und `data-admin-only`-Attribute unverändert. `switchConfigTab` ist generisch (`#config-<tab>`) und brauchte keine Änderung. Kein Eingriff in Lade- oder Speicherlogik.
- Die Copilot-Textfelder hatten über `.config-column .config-field input[type="text"]` feste **350 px**. Nach dem Umzug greift der Selektor nicht mehr, und 350 px hätten eine 340-px-Karte gesprengt — im Raster jetzt `flex: 1; min-width: 0`. Die beiden ℹ️-Tooltips sind zu einem Hinweissatz zusammengefasst, der zusätzlich festhält, dass diese Pfade **pro Benutzer** gelten.
- `.config-columns-monitor` und die zugehörige Media-Query-Zeile entfernt (toter Code).
- **Korrigiert:** README verwies an zwei Stellen auf einen Tab „Filter", den es nie gab — die Abschnitte lagen im Monitor-Tab. Richtig ist jetzt „Monitor-Einstellungen".

**Dateien:** public/index.html, public/style.css, README.md

### 2026-07-30 — 🔢 Dashboard zeigte zu wenige kritische Fehler

Aufgefallen beim Vergleich zweier Zahlen: der Server meldete 129 Einträge mit 43 kritischen, das Dashboard zeigte gleichzeitig 163 Einträge mit nur 33 kritischen. Ursache waren **drei verschiedene Aufbewahrungsregeln** für dieselben Daten.

- **Server** (`evictOldest`): verdrängt immer den ältesten *nicht*-kritischen Eintrag, Obergrenze `maxErrorsPerFile * 2`. Kritische bleiben, solange normale vorhanden sind. ✔
- **Snapshot für neue Clients** (`selectWithCriticals`): lieferte nur die letzten `maxErrorsPerFile` Einträge plus bis zu 5 gerettete kritische — also höchstens 15 von 20, obwohl der Server mehr hielt.
- **Dashboard** (`trimKeepCritical`): behielt die letzten 10 plus höchstens 5 ältere kritische. Dadurch **sank die angezeigte Anzahl kritischer Fehler, je länger die Seite offen war** — simuliert: 15 kritische wurden nach zwölf normalen Fehlern zu 5, während der Server unverändert 15 hielt.

Das untergrub genau den Zweck des Verdrängungsschutzes: kritische Fehler verschwanden aus der Ansicht, obwohl der Server sie noch hatte.

Jetzt gilt **eine** Regel an allen drei Stellen:

- `capKeepCritical()` im Client spiegelt `evictOldest()` des Servers exakt — ältester nicht-kritischer Eintrag weicht, nur bei durchgehend kritischem Array der älteste überhaupt.
- Die Obergrenze wird nicht mehr doppelt gepflegt: `maxErrorsPerFile` kommt über die `init`-Nachricht zum Client, der daraus `* 2` bildet. Vorher stand im Frontend eine feste 20 bzw. 10.
- `getAllErrors()` liefert den vollständigen Speicherstand statt ihn erneut zu kürzen — `selectWithCriticals` ist damit entfallen.

**Folge für die Anzeige:** die Zahlen sind höher als vorher (im Test 186 statt 129 Einträge, 58 statt 43 kritisch). Das sind keine neuen Fehler, sondern die, die der Server bereits hielt und die vorher nicht ausgeliefert wurden. `maxErrorsPerFile` ist entsprechend nicht mehr die Anzeigegrenze, sondern der Grundwert für `* 2` — Tabelleneintrag korrigiert.

`test/eviction-priority.js` prüft jetzt beide Regeln gegeneinander: ein Test lässt Server und Client parallel laufen und schlägt an, sobald die Anzahl kritischer Einträge auseinanderdriftet.

**Dateien:** server/watchService.js, server.js, public/js/utils.js, public/js/wsClient.js, public/js/state.js, test/eviction-priority.js, test/priority-wiring.js, README.md

### 2026-07-30 — 📝 Mustersuche über mehrzeilige Einträge dokumentiert

Beim Prüfen der Benachrichtigungen an echten Log-Daten fiel auf, dass Keasy-Fehler fast immer mit `Der folgende #Fehler ist aufgetreten:` beginnen und den eigentlichen Typ erst in einer Folgezeile tragen. Das betrifft **alle vier Musterlisten**, nicht nur die Prioritätsregeln — und war nirgends hinterlegt.

Am Code verifiziert und dokumentiert: alle Listen werden gegen den **gesamten Eintrag** geprüft (alles zwischen zwei Zeitstempeln), mit unterschiedlichen Folgen:

- **Fehlererkennung:** ein Muster greift unabhängig von der Zeile — `TimeoutException` erkennt einen Fehler auch in Zeile 4. Umgekehrt trifft `Fehler` bereits die Ankündigungszeile über nahezu jedem Eintrag.
- **Ausschluss:** die folgenreichste Wirkung — **ein Treffer an beliebiger Stelle unterdrückt den kompletten Eintrag.** Ein Ausschluss auf `ValidationException` verschluckt damit auch einen echten `TimeoutException`-Fehler, der den Begriff nur als InnerException enthält. Für Anwender-Meldungen ist eine Prioritätsregel mit Stufe `gering` meist die bessere Wahl.
- **Schwellwertregeln:** die Zahl wird ab der Position von „Zeile enthält" gesucht und kann aus einer Folgezeile stammen.
- **Prioritätsregeln:** die Ankündigungszeile taugt nicht als Regel (trifft alles); aussagekräftig ist der Typ in der Folgezeile. Und weil die erste passende Regel gewinnt: **spezifisch oben, allgemein unten.**
- **Zwei Ausnahmen:** bei JSON-Logs wirken `excludePatterns` bewusst nur auf Typ und Meldung, nicht auf den ganzen Block. Und Stack-Traces werden vor dem Speichern gekürzt — Prioritätsregeln sehen den gekürzten Text, Erkennung und Ausschluss den vollständigen.

Hinterlegt an drei Stellen: neuer Doku-Abschnitt „Muster und mehrzeilige Einträge", Hinweistexte in den Tab-Abschnitten Fehlererkennung / Ausschluss / Prioritätsregeln, und ein Tooltip am Feld „Zeile enthält".

Dabei zwei sachliche Fehler in der bestehenden Doku korrigiert: sowohl der Hinweistext als auch die Einstellungstabelle sprachen bei `excludePatterns` von „Zeilen" statt von Einträgen — genau daraus entsteht die Falle.

Eine Stichprobe über 26.240 Einträge aus 38 lokalen Logdateien ergab keinen Fall, in dem ein echter Fehler durch einen Ausschluss-Treffer in einer anderen Zeile verlorenging (die Netzlaufwerke `X:`/`Y:` waren dabei nicht einsehbar).

**Dateien:** README.md, public/index.html, public/js/priorityPanel.js

### 2026-07-30 — 🔔 Desktop-Benachrichtigungen mit Aussagekraft

Eine Benachrichtigung zeigte praktisch nur den abgeschnittenen Dateinamen (`KeasyServerService_Keasy.WorkflowServer_26_20…`) — die eigentliche Fehlermeldung war nicht zu sehen, der gemeldete Fehler damit im Dashboard nicht auffindbar.

Drei Ursachen im Text `${error.file}: ${error.line.substring(0, 80)}`:
- Der **Dateiname stand vorn** und füllte mit ~55 Zeichen allein die verfügbare Breite. Windows kürzt hinten ab, also fiel die Meldung komplett weg.
- `error.line` **beginnt mit dem Log-Zeitstempel**, weitere ~22 Zeichen gingen für Datum und Uhrzeit drauf.
- Das **Quellen-Label fehlte** — im Dashboard denkt man in „VFMService Dienst", nicht in Dateinamen.

Neu:
- **Titel trägt die Quelle**: `Keasy — VFMService Dienst`, bei kritischen Fehlern `🔴 Kritisch — VFMService Dienst`. Das Label wird aus `wsClient.js` durchgereicht.
- **Meldung zuerst, Dateiname darunter** — was gekürzt wird, ist dann der Dateiname und nicht der Inhalt.
- `buildNotificationBody()` sucht die erste Zeile mit **echtem** Inhalt. Das ist nötig, weil Keasy-Einträge typischerweise aus „Zeitstempel + Tab", mehreren Leerzeilen und erst danach der Meldung bestehen; manche beginnen zusätzlich mit einer `====`-Trennlinie. Ankündigungszeilen wie „Der folgende #Fehler ist aufgetreten:" werden mit der Folgezeile zusammengezogen, sonst sagt die Meldung nichts aus.
- Mehrfach-Leerzeichen werden zusammengefasst, Text auf 180 Zeichen begrenzt.
- **Klick auf die Benachrichtigung holt das Dashboard nach vorn.**
- Das wirkungslose `icon: '🔴'` entfernt (das Feld erwartet eine URL, kein Emoji).

Gegen die 128 Einträge im laufenden Monitor geprüft: keine leere Meldung, keine reine Trennlinie, keine beginnt mit einem Zeitstempel, keine reine Ankündigung.

**Dateien:** public/js/boot.js, public/js/wsClient.js

### 2026-07-30 — ♻️ Kein harter Reload mehr nach Frontend-Änderungen

Der Server lieferte CSS, JS und `index.html` **ohne jeden Cache-Header** aus — kein `Cache-Control`, kein `ETag`, kein `Last-Modified`. Browser entscheiden dann heuristisch und halten geänderte Dateien fest. Nach jeder Frontend-Änderung war ein harter Reload (`Strg+F5`) nötig, sonst suchte man Fehler, die im Code längst behoben waren. Bei `index.html` war es gravierender: neu hinzugefügte `<script>`-Tags wurden gar nicht erst geladen.

- Neue Hilfsfunktion `sendWithRevalidation()` in `server/httpRouter.js`, genutzt von beiden Auslieferungswegen (statische Dateien und `index.html`).
- `Cache-Control: no-cache` heißt nicht „nicht zwischenspeichern", sondern **„vor Benutzung nachfragen"**: der Browser schickt `If-None-Match`, und bei unveränderter Datei antwortet der Server mit `304` ohne Body — also kein erneuter Download, nur eine sehr kleine Anfrage.
- Der `ETag` ist ein SHA1 über den Dateiinhalt. Jede inhaltliche Änderung erzeugt automatisch einen neuen ETag und damit ein frisches `200`; identischer Inhalt bleibt beim `304`.
- Geprüft für `/style.css`, `/js/render.js` und `/`: erster Aufruf `200`, Revalidierung `304`, veralteter ETag wieder `200`.

**Dateien:** server/httpRouter.js

### 2026-07-30 — 🚨 Alarmknopf statt Rollup-Badge

Die rechte Seite der Datei-Kopfzeile wirkte unruhig: 📂 und 📝 saßen in jeder Zeile an einer anderen Stelle, und zwei rote Pillen (`🔴 10` und der Zähler `18`) standen direkt nebeneinander.

**Ursache** war nicht die Farbe, sondern die schwankende Elementzahl: wo keine kritischen Fehler existierten, fehlte das `🔴`-Badge komplett und alles rutschte nach rechts.

- Die Rollup-Badges auf Datei- und Quellen-Ebene sind jetzt ein **🚨-Alarmknopf** (`buildAlarmButtonHtml` in `render.js`). Er steht in **jeder** Zeile — im Ruhezustand ausgegraut und `disabled`. Dadurch bleibt die Elementzahl konstant und die Spalten fluchten von selbst, ohne feste Breiten und ohne Platzhalter. Ein Badge kann das nicht leisten: „0 kritische Fehler" als Pille wäre sinnlos, ein Knopf darf inaktiv sein.
- Die zweite rote Pille entfällt damit ersatzlos, statt umgefärbt zu werden. Der Zähler bleibt unverändert.
- **Klick springt** zum ersten kritischen Eintrag (`jumpToCritical` in `actions.js`): Datei-Liste einblenden, `scrollIntoView`, kurzes Aufblitzen (`.jump-flash`). Auf Quellen-Ebene wird die Quelle vorher über das vorhandene `toggleSource` aufgeklappt, damit der Auf-/Zu-Zustand wie gewohnt gemerkt wird. `stopPropagation`, sonst klappt der Header darunter zu.
- **Roter Blockrahmen** am Datei-Block mit kritischem Inhalt (`.file-group.has-kritisch`). „Kritisch schlägt aktuellste": zwei Klassen haben höhere Spezifität als `.file-group-newest`, die blaue Markierung der neuesten Datei bleibt also erhalten, wo nichts kritisch ist — ohne `!important`.
- **Bewusst ohne Animation:** `renderAll()` baut das komplette HTML bei jedem eingehenden Fehler neu auf. Ein Einblend-Puls würde dauernd neu starten statt nur beim Auftauchen — aus demselben Grund existiert `.error-entry.new` nur im alten Default-Stylesheet.
- Geprüft wurde außerdem, ob ein oranger Zähler die Alternative wäre: `--badge-bg` steuert neben dem Zähler auch Fehler-Toasts, System-Check-Fehlschläge, Ordner-Picker-Meldungen und `.config-message.error` (neun Stellen) — eine Umfärbung hätte all das mitgetroffen. Und Orange ist bereits die Farbe der ⏱️-Lücken, die im Analyse-Tab direkt daneben stehen. Der Alarmknopf umgeht beides.

**Dateien:** public/js/render.js, public/js/actions.js, public/style.css, test/priority-wiring.js

### 2026-07-30 — 🔴 Dringlichkeit von Fehlern (Prioritätsregeln)

Bisher sahen alle erkannten Fehler gleich aus: ein fehlgeschlagener Mailversand stand optisch gleichwertig neben `disposed`-Rauschen. Neu ist eine Dringlichkeitsstufe pro Fehler.

**Modell** — neue Config-Liste `priorityRules: [{ name, contains, level }]`, erste Treffer-Regel gewinnt (Reihenfolge = Vorrang, im Tab „Monitor-Einstellungen" mit ▲▼ umsortierbar), kein Treffer ⇒ `normal`. Drei Stufen: `kritisch` / `normal` / `gering`.
- Bewusst **getrennt** von `filterPatterns`: der OR-verknüpfte `filterRegex` kann nicht sagen, welches Muster getroffen hat, und „Send_over_SMTP schlägt fehl" passt gleichzeitig auf `Fehler` und `Send_over_SMTP` — Priorität braucht eine Rangfolge, Erkennung nicht.
- Wirkt dadurch auch auf **JSON-Logs** (strukturelle Erkennung, nutzt keine filterPatterns) und **Schwellwert-Treffer**.
- Erkennung (`matchesFilter`) und Einstufung (`classifySeverity`) sind orthogonale Funktionen; `matchesFilter` ist unverändert.
- `sanitizePriorityRules()` verwirft Regeln ohne `contains` und setzt unbekannte Stufen auf `normal` — `config.js` ist handeditierbar und wird beim Speichern nicht validiert.
- **Bei leerer Regelliste ist alles wie vorher** — kein Badge, keine Farbe, kein geändertes Verhalten.

**Darstellung** — nur Abweichungen vom Standard kosten Tinte:
- `kritisch`: 🔴-Badge im Eintrag, kräftigerer linker Rand (3→5 px), eigener Hintergrund; Rollup-Zähler `🔴 n` im Datei- **und** Quellen-Header (wichtig, weil Quellen einklappbar sind); Browser-Titel `🔴 (2/17) Keasy Log Monitor`.
- `normal`: erzeugt **kein** zusätzliches Markup und keine zusätzliche Farbe — identisch zu vorher.
- `gering`: gedimmt (`opacity`, `--text-muted`) statt einer dritten Farbe; zählt weiter im Gesamtzähler (ein geduldeter Fehler ist ein Fehler — „0 Fehler" über einer nicht leeren Liste wäre irreführend).
- Redundante Codierung (Randstärke + ausgeschriebenes „Kritisch" + Farbe): ein reiner Farbwechsel wäre neben dem ohnehin roten `.error-entry`-Rand kaum sichtbar. Neue Variablen `--sev-critical{,-bg,-fg}` in allen drei Themes; bleibt bewusst in der Rot-Familie und kollidiert nicht mit dem Orange der ⏱️-Lücken.
- ⏱️-Lücken bleiben ihre eigene Klasse von Ereignis — **ohne** Dringlichkeitsstufe.

**Verhalten** bei `kritisch`:
- **Sofort-Mail** statt Warten auf das Sende-Intervall (in der Praxis bis zu 4 h). Gebündelt: 5 s Debounce plus harte Sperre von 60 s pro Quelle, damit 50 kritische Zeilen **eine** Mail mit 50 Einträgen ergeben und eine crashende Komponente nicht im Sekundentakt mailt. Kein zweiter Timer, kein zweiter Transporter — `sendBufferedEmails(onlyLabel)` wiederverwendet die bestehende Komposition.
- **Preload-Schutz**: beim Start werden mit `loadExistingErrors` ganze Logdateien neu geparst — ohne Schutz würde jeder *historische* kritische Fehler bei jedem Neustart eine Mail auslösen. Doppelt abgesichert über `preload.running` und das Alter des Eintrags (< 15 Min.).
- **Eigenes Duplikat-Fenster** `email.criticalDeduplicateMinutes` (Standard 15). Grund: mit dem normalen Fenster (in der Praxis 360 Min.) würde „SMTP kaputt seit 08:00" um 14:00 nie erneut gemeldet. Kritische Fehler sind aber *nicht* vom Duplikatschutz ausgenommen — das würde den Crashloop-Spam öffnen. Das Hash-Aufräumen nutzt jetzt das längere der beiden Fenster.
- **Desktop-Benachrichtigung** auch bei sichtbarem, fokussiertem Fenster (der Blick kann auf einem anderen Teil der Seite liegen), 3-s-Sperre, eigener `tag`, `requireInteraction`. Eigener Zeitstempel `lastCriticalNotificationTime` — mit einem gemeinsamen würde eine Flut normaler Fehler die kritische Meldung aushungern. `gering` benachrichtigt nie.
- **Verdrängungsschutz**: `maxErrorsPerFile` verdrängte streng FIFO, bei `maxErrorsPerFile: 10` konnten also 11 triviale Fehler den kritischen unsichtbar machen. `evictOldest()` opfert kritische Einträge zuletzt; `selectWithCriticals()` (Server-Snapshot) und `trimKeepCritical()` (Client) ergänzen herausgefallene kritische Fehler bis zu einem Puffer von 5.

**Tool-Export**: neue Sektion „Prioritätsregeln (Dringlichkeit)" (vorbelegt), beidseitig registriert.

**Tests**: `test/eviction-priority.js` (Verdrängungslogik inkl. „Flut verdrängt den kritischen nicht"), `test/priority-wiring.js` (statische Verdrahtung: DOM-IDs, Ladereihenfolge, Querverweise, Theme-Variablen, Regressionsschutz „normal erzeugt kein Markup").

**Dateien:** server/logParser.js, server/watchService.js, server/analysisService.js, server/emailService.js, server/toolExport.js, server.js, public/js/priorityPanel.js (neu), public/js/render.js, public/js/utils.js, public/js/state.js, public/js/configPanel.js, public/js/boot.js, public/js/wsClient.js, public/js/toolExport.js, public/index.html, public/style.css, test/eviction-priority.js (neu), test/priority-wiring.js (neu)

### 2026-07-27 — 📖 Dokumentation-Tab übersichtlicher

- Sticky Inhaltsverzeichnis links: alle `##`-Abschnitte auf einen Blick, Klick springt hin, aktiver Abschnitt hervorgehoben (Scroll-Spy per IntersectionObserver)
- Volltext-Suche in der Toolbar (`filterDocs`): blendet nicht passende Abschnitte aus und klappt Treffer auf
- `##`-Abschnitte werden clientseitig in einklappbare Karten verpackt (`wrapH2Sections`); Referenz-/Riesen-Abschnitte (Historie, Konfiguration, Architektur, Dependencies) starten zugeklappt mit Anzahl-Badge (Historie zeigt „N Einträge")
- Rein im Frontend gelöst (kein Server-Eingriff): `docsPanel.js` reichert das gerenderte README nach dem Laden an; zweispaltiges Layout + Styles über die vorhandenen Theme-Variablen
- Editor-Umschaltung schaltet jetzt die ganze Ansicht (`#docsView`) statt nur den Inhalt

**Dateien:** public/js/docsPanel.js, public/index.html, public/style.css

### 2026-07-27 — 🗄️ Backup-Tab aufgeräumt

- Aktionsleiste nach oben: „💾 Jetzt sichern" prominent statt zwischen FTP und Wiederherstellen; mit Status und Zeitplan-Hinweis (`updateBackupScheduleHint`)
- Zeitplan und Umfang in zwei getrennte Karten aufgeteilt (statt einer vollgestopften Zeile); Ein/Aus als Toggle-Switch (`input.ksw`)
- Backup-Ziele als einheitliches Karten-Raster: lokale Ziele lösen sich per `display:contents` ins Raster (`#backupLocalCards.bk-targets-contents`), FTP ist eine gleichwertige Karte, „＋ Lokales Ziel hinzufügen" als Kachel
- Wiederherstellen als einklappbares `<details>` (selten genutzt, optisch schwer)
- Alle IDs/onclick-Handler unverändert — reine Layout-/CSS-Umstrukturierung; neue `.bk-*`-Klassen und `.ksw`-Switch nutzen die vorhandenen Theme-Variablen (hell/dunkel/blau)

**Dateien:** public/index.html, public/style.css, public/js/backupPanel.js, public/js/backupTargetsPanel.js

### 2026-07-27 — 📂 Ordnerauswahl bei Monitor-Pfaden und Log-Analyse

- WatchPath-Tabelle (Tab „Monitor"): 📂-Button in jeder Pfad-Zelle öffnet den Ordner-Picker und übernimmt den gewählten Pfad — in allen drei Render-Wegen (`renderWatchPathsTable`, `addWatchPathRow`, `addWatchPathRowWithData`); neue Funktion `pickWatchPathFolder` (findet das Input relativ zur Tabellenzeile)
- Log-Analyse: 📂-Button neben dem Pfad-Eingabefeld (`pickAnalyzeFolder`) füllt `#analyzePath` — Hinzufügen erfolgt wie gewohnt
- Wiederverwendung des bestehenden Ordner-Pickers (`showFolderPicker` / `/api/browse-folders`), analog zum Copilot-Export; `browse-folders` ist nicht admin-only, daher auch für Analyse-Nutzer verfügbar

**Dateien:** public/js/watchPathsPanel.js, public/js/analyzePanel.js, public/index.html

### 2026-07-27 — 📤 Tool-Export: weitergebbares Paket erzeugen

- Neuer Tab „📤 Weitergabe" (admin-only): erzeugt ein schlankes ZIP der App zur Weitergabe an Dritte — Download direkt aus dem Browser (`GET /api/export-tool`)
- Sektions-Checkliste (Positivauswahl) steuert, welche Einstellungen in die mitgelieferte `config.default.js` eingebacken werden; vorbelegt: Allgemeine Optionen, Filter-/Ausschluss-Muster, Schwellwert-Regeln. Optional: Watch-Pfade, E-Mail/SMTP, Backup/FTP. Registry in `public/js/toolExport.js` (eine neue Sektion = ein Eintrag)
- Sicherheit: Passwörter (SMTP/FTP) werden nie exportiert (auch nicht bei angehakter Sektion); ausgeschlossen sind zudem `config.js`, `users.json`/`users/`, `*.log`, `node_modules`, `.git`, temp-/Backup-Artefakte sowie `analyzePaths`/`copilotWorkingPath*` und Runtime-Marker (`_isNetworkDrive`)
- Erstlauf-Bootstrap: fehlt `config.js` (Weitergabe-Paket enthält nur `config.default.js`), wird sie beim ersten Start automatisch erzeugt — `server/bootstrapConfig.js` läuft als erste Zeile in `server.js`, vor allen Modul-Requires (mehrere Module laden `../config` direkt)
- Ins ZIP gelegte `WEITERGABE.md` mit Kurzanleitung; der Login-Hinweis richtet sich nach dem tatsächlichen Auth-Zustand der gewählten Config (kein „admin/admin", wenn das Rechte-System aus ist)

**Dateien:** server/toolExport.js, server/bootstrapConfig.js, server/routes/configRoutes.js, server/httpRouter.js, server/configStore.js, server.js, public/js/toolExport.js, public/js/configPanel.js, public/index.html

### 2026-07-20 — 🧩 JSON-Logs pro WatchPath überwachen (z. B. KI-Schnittstelle)

- Neues Häkchen 'JSON' pro WatchPath: nur wo aktiviert, werden zusätzlich .json-Logs erfasst (Glob **/*.{log,json}) — Netzlaufwerke wie X:/Y: bleiben aus Performance-Gründen bewusst .log-only
- Hintergrund: KI-Schnittstelle schreibt Fehler nach ai_log_*.json; der globale filePattern **/*.log erfasste diese Dateien nie, dadurch blieben AggregateException/Retry failed unerkannt
- logParser: parseJsonLogEntries splittet JSON-Logs am ---Trenner (statt an Timestamp-Zeilen), inkl. Pending-Handling fürs inkrementelle Tailing; parseEntryTimestamp erkennt jetzt auch ISO-Zeitstempel
- logParser: evaluateJsonEntry erkennt Fehler strukturell (Error-Objekt oder Success:false) statt per Textfilter — verhindert Fehlalarme durch Filterwörter im KI-Prompt-Text (z. B. "fehler":null); excludePatterns bleiben auf die Fehlermeldung anwendbar
- watchService: Glob und Parser werden pro Datei/Pfad gewählt (wp.includeJson bzw. Dateiendung); JSON-Fehler erscheinen als kompakte Zeile mit korrektem ISO-Zeitstempel statt als ein Datei-Blob
- Frontend: neue Spalte 'JSON' in der WatchPath-Tabelle (renderWatchPathsTable, addWatchPathRow, Import, getWatchPathsFromTable); neues Feld includeJson überlebt Speicherung automatisch (normalizedWatchPaths spreadet alle Felder)

**Dateien:** server/logParser.js, server/watchService.js, public/js/watchPathsPanel.js, public/index.html

### 2026-07-16 — 🔔 Desktop-Benachrichtigungen zuverlässiger

- renotify: neue Meldungen poppen wieder auf, statt die alte im Info-Center stumm zu ersetzen (gleicher tag verschluckte Folge-Meldungen)
- Benachrichtigt jetzt auch, wenn das Dashboard-Fenster sichtbar, aber nicht fokussiert ist (document.hasFocus zusätzlich zu document.hidden) — z. B. Keasy im Vordergrund oder Dashboard auf dem zweiten Monitor
- 🔔-Button zeigt Warnzustand, wenn die Browser-Berechtigung fehlt (🔔❓) oder blockiert ist (🔔⚠️, Tooltip mit Anleitung); beim Aktivieren wird die Berechtigung direkt angefragt
- Unverändert: höchstens eine Benachrichtigung alle 10 Sekunden; Windows-seitig kann der Benachrichtigungsassistent Banner weiterhin unterdrücken

**Dateien:** public/js/boot.js

### 2026-07-16 — Watcher-Schutz: fehlende WatchPaths blockieren den Server nicht mehr

- startWatching legt für nicht existierende Pfade keinen Watcher mehr an — chokidar fiel sonst aufs nächste existierende Elternverzeichnis zurück und pollte es komplett (z. B. %TEMP% mit zigtausenden Dateien → Event-Loop-Blockade, Dashboard reagierte nicht mehr)
- Die Erreichbarkeitsüberwachung meldet den fehlenden Pfad (Warnbanner) und startet die Watcher automatisch neu, sobald er wieder existiert
- Smoke-Test-Cleanup gehärtet: Erreichbarkeits-Test entfernt seinen Temp-Watchpath jetzt mit frischer Config, Retry und verifizierendem Assert (ein Rest-Watchpath auf ein gelöschtes Verzeichnis hatte genau diese Blockade ausgelöst)

**Dateien:** server/watchService.js, test/smoke.js

### 2026-07-16 — Code-Refactoring: Render-Bausteine, FTP-Helper, Label-Filter + Repo-Hygiene

- render.js: die drei fast identischen Anzeige-Sektionen (Live, ⏱️ Performance, Analyse) nutzen jetzt gemeinsame Bausteine (filterEntriesForFile, buildFileGroupHtml, buildErrorEntryHtml, buildGapEntryHtml) — per DOM-Stub-Aequivalenztest über 6 Szenarien verifiziert (Ausgabe identisch)
- backupService: withFtpClient-Helper ersetzt 5x identisches FTP-Verbindungs-Boilerplate (einheitliches Schliessen auch im Fehlerfall)
- wsBroadcast: gemeinsame Label-Filter (filterMapByLabels, labelMessageFilter) ersetzen 6 Kopien in server.js und watchService.js
- Repo-Hygiene: backup-status.json (Laufzeit-Status) und zwei versehentlich getrackte temp-backup-ZIPs aus Git entfernt; .gitattributes beendet die CRLF-Warnungen; temp-Ordner ignoriert

**Dateien:** public/js/render.js, server/backupService.js, server/wsBroadcast.js, server/watchService.js, server.js, .gitignore, .gitattributes

### 2026-07-16 — README: Architektur-Abschnitt auf aktuellen Stand gebracht

- Diagramm vervollständigt: alle 17 Server-Module (u. a. backupService, healthCheck, sessionMiddleware, userStore, markdownHelper, routes/-Ordner) und alle 21 Frontend-Panels
- Modul-Beschreibungen aktualisiert (watchService inkl. Gap-Erkennung und Erreichbarkeits-Monitor, logParser inkl. Gap-Bewertung, httpRouter als Dispatcher mit Auth-Guards)
- server.js-Zeilenangabe korrigiert (188 → ~380), Dependencies-Tabelle vervollständigt (archiver, adm-zip, basic-ftp, bcryptjs ergänzt)

**Dateien:** README.md

### 2026-07-16 — 📡 WatchPath-Erreichbarkeit: Warnbanner + Auto-Recovery

- Server prüft alle 15s die Erreichbarkeit aller WatchPaths (fs.access, überlappungssicher) — Hintergrund: Netzlaufwerke (X:/Y:) können pro Session wegfallen, die Watcher liefen dann still ins Leere
- Nicht erreichbare Pfade erscheinen als ⚠️-Warnbanner oberhalb der Fehlerliste (pro Quelle, nach sichtbaren Labels gefiltert); Status kommt per WS-Event watchpath-status und im init
- Auto-Recovery: Wird ein Pfad wieder erreichbar, startet der Server die Watcher automatisch neu (gleiche Semantik wie 'Watcher neu starten' inkl. Preload) — manuelles Eingreifen entfällt
- Neue Smoke-Tests: Warnung nach Pfad-Wegfall, Status nach Rückkehr, Fehler-Erkennung im wiederhergestellten Pfad

**Dateien:** server/watchService.js, server.js, public/js/wsClient.js, public/index.html, public/style.css, test/smoke.js

### 2026-07-16 — README: Einleitung überarbeitet (Multiuser-Hinweis, Gap-Verweis)

- Einleitung in eigene Abschnitte gegliedert: Hinweis Multiuservariante (Rechte) und Dashboard-Beschreibung
- Verweis auf die Performance-Gap-Erkennung ergänzt
- Erste inhaltliche Bearbeitung direkt über den neuen Doku-Editor im Dashboard

**Dateien:** README.md

### 2026-07-16 — 📝 Doku-Tab: Markdown-Editor mit Live-Vorschau

- Neuer Bearbeiten-Modus im Doku-Tab (admin-only): links README-Quelltext, rechts Live-Vorschau — gerendert über denselben Server-Renderer wie die Anzeige (markdownHelper), Vorschau debounced (400 ms)
- Speichern schreibt README.md mit automatischem Backup (README.md.bak, Muster style.css.bak); Abbrechen warnt bei ungespeicherten Änderungen
- Schutz-Validierung: Mindestlänge gegen versehentliches Leeren, Abschnitt '## Historie' muss erhalten bleiben (wird von update-docs benötigt)
- Neue Routen: GET /api/docs/raw, POST /api/docs/preview, POST /api/docs (admin-only via ADMIN_ONLY_ROUTES)
- Neue Smoke-Tests: raw/preview, Ablehnung zu kurz / ohne Historie, Roundtrip mit Backup-Prüfung

**Dateien:** server/routes/configRoutes.js, server/httpRouter.js, public/js/docsPanel.js, public/index.html, public/style.css, test/smoke.js, .gitignore

### 2026-07-16 — 🗄️ Komplett-Backup des Programmverzeichnisses + crash.log-Endlosschleife behoben

- Neue Backup-Option 'Komplett-Backup (gesamtes Verzeichnis) zusätzlich erstellen': sichert bei jedem Backup-Lauf das komplette Programmverzeichnis (inkl. node_modules) als `keasy-full-*.zip` an dieselben Ziele (lokal + FTP) — im Katastrophenfall entpacken und `node server.js` starten
- Ausgeschlossen: temp-Ordner, crash.log und vorhandene Backup-ZIPs (verhindert Rekursion, falls ein Backup-Ziel im Programmverzeichnis liegt)
- Eigene Rotation getrennt vom Settings-Backup (jeweils 'Max. Backups pro Ziel'); Restore-Liste zeigt Komplett-Backups mit 🗂️ und 'Komplett (N Dateien)', löschbar, aber bewusst **kein UI-Restore** (Server lehnt Preview/Restore ab — der laufende Server kann sich nicht selbst überschreiben)
- crash.log: wuchs seit 16.05. auf 1,4 GB durch eine Endlos-Schleife — console.error im Crash-Handler warf bei toter Konsole (EPIPE/broken pipe) selbst eine Exception, die wieder geloggt wurde. Fix: EPIPE am Stream schlucken, Rekursionsschutz in logCrash, Rotation bei 5 MB nach crash.log.old
- Neue Smoke-Tests: Komplett-ZIP wird erstellt und gelistet (type=full), Preview darauf wird abgelehnt

**Dateien:** server/backupService.js, server.js, public/index.html, public/js/backupPanel.js, public/js/backupTargetsPanel.js, public/js/backupRestorePanel.js, test/smoke.js, README.md

### 2026-07-16 — ⏱️ Gap-Erkennung: Performance-Optimierungen (flüssiges Monitoring)

- Nach der Gap-Erweiterung fühlte sich das System träge an — auch bei deaktiviertem Feature: der Settings-Lookup (path.resolve über alle WatchPaths) lag im Pro-Eintrag-Pfad. Gemessen: 236 ms statt 0,9 ms pro 50.000 Einträge (~eine 6-MB-Tagesdatei)
- Gap-Settings werden jetzt einmal pro Batch (processNewLines-Aufruf) gelesen statt pro Eintrag — Hot-Reload bei Schwellwert-Änderungen bleibt erhalten
- Feature aus: kein Timestamp-Parsing pro Eintrag mehr — die Gap-Baseline wird per Rückwärts-Scan nur aus dem letzten Eintrag des Batches gepflegt (~1 ms, späteres Aktivieren hat sofort einen Vorgänger-Timestamp)
- Preload: historische Gaps werden nicht mehr einzeln gebroadcastet (Nachrichten-Sturm), sondern nach Abschluss als **ein** `performance-snapshot` gesendet; Clients ersetzen ihren Performance-Stand komplett
- Client: Gap-Nachrichten rendern gedrosselt (~300 ms Coalescing) statt bis zu 60×/s per rAF — Fehler behalten ihre sofortige Anzeige
- getLabelForFile und getGapSettingsForFile teilen sich das WatchPath-Matching (findWatchPathForFile)

**Dateien:** server/watchService.js, public/js/wsClient.js

### 2026-07-15 — Umbenennung: 'Lücke' → 'Gap' in der Oberfläche

- Alle sichtbaren Texte umbenannt: Spalte '⏱️ Gap (s)', Eintrags-Anzeige '⏱️ Gap: 34s (…)', Badge-Tooltips 'Anzahl Performance-Gaps', Analyse-Feld '⏱️ Gap-Warnung ab', Fortschritt/Konsole 'N ⏱️ Gaps', Validierungsmeldung
- Nur UI-Labels geändert — interne Feldnamen (gapWarnSeconds, gapIdleMinutes, analyzeGap*), CSS-Klassen und WS-Events unverändert

**Dateien:** public/index.html, public/js/render.js, public/js/analyzePanel.js, public/js/configPanel.js, public/js/watchPathsPanel.js, server/analysisService.js, README.md

### 2026-07-15 — ⏱️ Richtwert 20 Sekunden als Vorbelegung für Lücken-Warnung

- 20 Sekunden Wartezeit ist für Keasy-Anwender der Schmerzpunkt → neuer Richtwert für die Lücken-Warnung
- Neue WatchPath-Zeilen (Hinzufügen + Import) starten mit gapWarnSeconds=20 vorbelegt (löschen = aus)
- Analyse-Panel: Feld fällt auf 20 zurück, wenn nie konfiguriert — explizite 0 bleibt 'aus'
- Tooltips nennen den Richtwert 20 (WatchPaths-Tabelle, Analyse-Panel)

**Dateien:** public/index.html, public/js/watchPathsPanel.js, public/js/analyzePanel.js, public/js/configPanel.js, config.js, README.md

### 2026-07-15 — Analyse: Fehler und ⏱️-Lücken getrennt ausweisen (Badges + Fortschritt)

- Quell- und Datei-Badges im Analyse-Abschnitt zeigen Fehler und Performance-Lücken jetzt getrennt: roter Badge = Fehler (Tooltip 'Anzahl Fehler'), oranger Badge '⏱️ N' = Lücken (Tooltip 'Anzahl Performance-Lücken') — vorher wurden Lücken als Fehler mitgezählt
- Fortschrittsanzeige und Abschluss-Status nennen Lücken separat ('0 Fehler, 94 ⏱️ Lücken in 1 Dateien'); Server sendet gaps-Zähler in analyze-progress/analyze-done
- ⏱️-Lücken zählen nicht mehr in den globalen Fehlerzähler (Browser-Titel/Kopfzeile)
- Badges der Live-Performance-Sektion ebenfalls im orangen ⏱️-Stil (gap-badge)

**Dateien:** server/analysisService.js, public/js/render.js, public/js/wsClient.js, public/js/analyzePanel.js, public/style.css

### 2026-07-15 — ⏱️ Performance-Lücken-Erkennung: Zeitabstand zwischen Log-Einträgen überwachen

- Neue per-WatchPath-Felder gapWarnSeconds (0/leer = aus, Default aus) und gapIdleMinutes (Leerlauf-Obergrenze, leer = 30): meldet, wenn zwischen zwei aufeinanderfolgenden Log-Einträgen derselben Datei mehr als N Sekunden liegen — Lücken über der Idle-Grenze (Nacht/Programmstart) werden ignoriert
- Saubere Trennung vom Fehler-Logging: eigene orange Sektion '⏱️ (Performance)' im Dashboard (Muster Log-Analyse), eigener Store, eigenes WS-Event 'performance', keine E-Mail, kein Papierkorb (direktes Löschen pro Quelle, admin-only)
- Gap-Prüfung betrachtet ALLE geparsten Einträge (nicht nur Filter-Treffer); Einträge ohne Timestamp werden übersprungen (kein Wall-Clock-Fallback); greift im Live-Monitoring UND beim Start-Einlesen (Preload)
- Log-Analyse: eigene Felder analyzeGapWarnSeconds/analyzeGapIdleMinutes im Analyse-Panel — Lücken-Treffer erscheinen als ⏱️-Einträge im Analyse-Abschnitt (eigener Zähler, verdrängen keine Fehler)
- Schwellwert-Änderungen wirken ohne Watcher-Neustart (Laufzeit-Lookup aus normalizedWatchPaths, serializeWp unverändert); Validierung: Warn-Schwelle muss unter der Idle-Grenze liegen
- Edge Cases: Rotation/Truncation und Datei-Löschung setzen die Gap-Baseline zurück; negative Zeitdifferenzen (Uhr-Sprünge) werden ignoriert; erster Eintrag einer Datei löst nie eine Warnung aus
- Neue Smoke-Tests: Config-Roundtrip der Gap-Felder, funktionaler Live-Test (temp Watchpath, 10s-Lücke → performance-Event), Clear-Route, performanceData im WS-init

**Dateien:** server/logParser.js, server/runtimeStore.js, server/watchService.js, server.js, server/routes/processRoutes.js, server/routes/analysisRoutes.js, server/analysisService.js, public/index.html, public/js/state.js, public/js/utils.js, public/js/wsClient.js, public/js/render.js, public/js/actions.js, public/js/watchPathsPanel.js, public/js/configPanel.js, public/js/analyzePanel.js, public/style.css, test/smoke.js, README.md

### 2026-07-01 — Aktuellste Datei je Watchpath farblich hervorheben

- Im Live-Monitoring wird pro Watchpath (Quelle) die Datei mit dem **neuesten** Fehler farblich hervorgehoben: Header mit kräftiger Accent-Hinterlegung + Accent-Rand links (4px)
- Nutzt die bestehende Sortierung (Dateien je Quelle sind absteigend nach neuestem Fehler sortiert) — die oberste angezeigte Datei erhält die CSS-Klasse `file-group-newest`
- Bezieht sich auf den neuesten **angezeigten** Fehler, also konsistent mit aktivem Datums-/Suchfilter, dem 🕒-Zeitstempel und dem Anzahl-Badge
- Farbanteil per `color-mix` gegen die themespezifische `--file-header-bg` → passt automatisch in Hell/Dunkel/Blau (Hell #0077cc, Dunkel #00d4ff)
- Reine Frontend-Änderung; Server/WebSocket/Datenmodell unverändert. Analyse-Ansicht nicht betroffen

**Dateien:** public/js/render.js, public/style.css

### 2026-06-30 — Ausschluss-Patterns: ValidationException als Hinweis statt Fehler

- Neue, GUI-pflegbare Liste **excludePatterns** (Tab Allgemein, Abschnitt „🚫 Ausschluss-Patterns") analog zur Filter-Liste mit Hinzufügen/Entfernen
- Zeilen, die ein Ausschluss-Pattern enthalten, gelten **nicht** als Fehler — auch wenn sie ein `filterPatterns`-Pattern (z.B. `Exception`) treffen. Der Ausschluss gewinnt
- Anwendungsfall: `ValidationException` ist ein Anwender-Hinweis (etwas fehlt zum Abschluss eines Vorgangs), kein echter Fehler, und kommt nur in Anwender-Logs vor → globaler Ausschluss genügt, ohne die Quelle durchreichen zu müssen
- Greift zentral in `matchesFilter` und damit in Live-Monitoring **und** Analyse gleichermaßen; Hot-Reload ohne Neustart
- Leere Ausschluss-Liste = kein Ausschluss (Schutz gegen `RegExp('')`, das sonst alles matchen würde). Patterns spezifisch halten — ein zu allgemeines Pattern (`Exception`) würde echte Fehler unterdrücken
- Logik verifiziert: `ValidationException` → kein Fehler, `NullReferenceException`/`Fehler` → weiterhin Treffer

**Dateien:** server/logParser.js, server.js, public/index.html, public/js/configPanel.js, README.md

### 2026-06-25 — Zeitpunkt des letzten Fehlers im Datei-Header

- Im Live-Monitoring zeigt jeder Datei-Header jetzt **vor** dem 📂-Button den Zeitpunkt des neuesten Fehlers an (`🕒 TT.MM.JJ HH:MM:SS`) — man erkennt auf einen Blick, wann zuletzt ein Fehler in die jeweilige Log-Datei kam, ohne sie aufzuklappen
- Bezieht sich auf den neuesten **angezeigten** Fehler, also konsistent mit aktivem Datums-/Suchfilter und dem Anzahl-Badge
- Reine Frontend-Änderung: das `timestamp`-Feld pro Fehler war bereits vorhanden; Server/WebSocket/Datenmodell unverändert. Analyse-Ansicht nicht betroffen
- Smoke-Tests unverändert: Auth-OFF 83/83

**Dateien:** public/js/render.js, public/style.css

### 2026-06-19 — Optionales Rechtesystem: Checkbox 'Rechtesystem aktivieren' (eine Codebasis statt zwei Varianten)

- Neues Flag authEnabled in der Config + Checkbox (Tab Allgemein). Aus = kein Login, alles als impliziter Admin (Einzelbenutzer-Verhalten); An = bisheriges Mehrbenutzer-Verhalten (Default, nicht brechend)
- Zentrale getEffectiveSession() (sessionMiddleware): bei deaktiviertem System impliziter Admin {admin}, wiederverwendet bestehende users/admin/config.json (emailTo-Abos etc.) — nichts geht verloren
- HTTP-Guard, WebSocket und /api/auth/me nutzen die effektive Session; init/config-changed senden authEnabled; Umschalten löst Client-Reload aus
- Bei auth-off: Header-Benutzerblock (Name/Rolle/Logout) + Benutzer-Tab ausgeblendet, Logout = nur Reload (R2/R3)
- ensureDefaultAdmin() prüft jetzt 'existiert ein Admin?' statt 'gibt es User?' (Aussperr-Schutz, R1); Aufruf beim Aktivieren des Rechtesystems
- ENV-Override KEASY_AUTH=on|off (mutiert config.js nicht) für getrennte Smoke-Test-Läufe; neuer test/smoke-auth-on.js + testAuthOff in test/smoke.js (R4)
- System-Check auth-bewusst: 'API erreichbar' akzeptiert 401 und 'Init-Event' den WS-Close 4401 als gesund, wenn das Rechtesystem aktiv ist (18/18 in beiden Modi)

**Dateien:** server/configStore.js, server/sessionMiddleware.js, server/httpRouter.js, server.js, server/routes/authRoutes.js, server/userStore.js, server/healthCheck.js, public/index.html, public/js/configPanel.js, public/js/state.js, public/js/loginPanel.js, public/js/wsClient.js, test/smoke.js, test/smoke-auth-on.js

### 2026-06-18 — Bugfix: E-Mail-Versand-Anzeige (📧-Countdown) in Mehrbenutzer-Variante

- emailConfigured wurde aus der globalen normalizedWatchPaths.emailTo berechnet — in der Mehrbenutzer-Variante immer leer, da Empfänger per-User in users/<name>/config.json liegen
- Folge: Der 📧-Countdown pro Quelle verschwand nach einem Server-Neustart (gestrippte config.js ohne emailTo)
- Fix: Neue Helper-Funktion emailConfiguredForUser() leitet die Quellen aus den Subscriptions des verbundenen Users ab (via mergeConfigForUser)
- WS-init nutzt den Helper; config-changed wird pro Client gesendet, damit jeder User nach dem Speichern seine korrekten 📧-Quellen live erhält

**Dateien:** server.js

### 2026-06-18 — Große Dateien: Markierung bei Schwellwert-Änderung neu bewerten

- Neue Funktion reevaluateOversized() in watchService.js — bewertet oversizedFiles gegen den aktuellen maxLogFileSizeMB neu (ohne Dateien neu einzulesen)
- Aufruf im Config-Hot-Reload (server.js) nach dem config-changed-Broadcast: rote Markierung + Tooltip aktualisieren sich ohne Watcher-Neustart
- Behebt widersprüchlichen Tooltip (z.B. '5 MB > 10 MB') wenn der Schwellwert über die Dateigröße angehoben wird; Senken markiert wieder
- Nicht mehr lesbare Dateien werden aus oversizedFiles entfernt; Broadcast bleibt pro Client label-gefiltert (Mehrbenutzer)

**Dateien:** server/watchService.js, server.js

### 2026-05-16 — Backup-Optimierung: Partielle Erfolge

- runBackup() gibt jetzt partial-Flag zurück wenn einige Ziele fehlschlagen
- Frontend zeigt Per-Target-Status immer an (nicht nur bei vollem Erfolg)
- 3-Farben-System: grün (alle OK) / orange (teilweise) / rot (alle fehlgeschlagen)
- loadBackupStatus() wird immer aufgerufen damit Status-Cards aktuell bleiben
- Backup-Liste wird bei mindestens 1 Erfolg aktualisiert

**Dateien:** server/backupService.js, public/js/backupPanel.js

### 2026-05-16 — Folder Picker Optimierung

- folderPicker.js: isOpen Re-Entrancy-Guard verhindert doppeltes Öffnen
- folderPicker.js: goUp() behandelt Drive-Root C:\\ korrekt
- folderPicker.js: Item-HTML in <span> gewrappt mit spellcheck=false
- configRoutes.js: wmic → PowerShell Get-CimInstance für Laufwerkserkennung
- configRoutes.js: sync FS → async fs.promises (stat, readdir)
- configRoutes.js: differenzierte Fehlerbehandlung (ENOENT/EACCES/EPERM)
- style.css: .folder-picker-name CSS-Klasse ergänzt

**Dateien:** public/js/folderPicker.js, server/routes/configRoutes.js, public/style.css

### 2026-05-16 — Netzlaufwerke im Folder Picker

- Folder Picker zeigt jetzt auch Netzlaufwerke (DriveType 4) mit UNC-Pfad an
- Laufwerks-Erkennung via wmic logicaldisk statt fs.statSync-Schleife
- Lokale Laufwerke mit Volume-Name, Netzlaufwerke mit UNC-Pfad als Label
- Fallback auf A-Z fs.statSync falls wmic fehlschlägt

**Dateien:** server/routes/configRoutes.js

### 2026-05-16 — Ordner-Auswahl für Copilot-Pfade

- 📂-Button neben Copilot Working-Pfad Develop/Release
- Modal-Dialog mit Ordner-Navigation (Doppelklick, Pfad-Eingabe, Übergeordnet)
- Neuer API-Endpoint POST /api/browse-folders (listet Laufwerke + Unterverzeichnisse)
- Neues Modul folderPicker.js mit showFolderPicker() API

**Dateien:** server/routes/configRoutes.js, public/js/folderPicker.js, public/index.html, public/style.css, public/js/boot.js

### 2026-05-16 — Benutzer-eigene Config speichern

- Nicht-Admins können eigene Einstellungen speichern (emailTo, Copilot-Pfade)
- Globale Config-Felder (Port, MaxErrors, FilePattern etc.) mit data-admin-only geschützt
- WatchPaths: Pfad/Label/Polling/Entfernen admin-only, emailTo bleibt editierbar
- Filter-Patterns und Schwellwertregeln admin-only geschützt
- Save/Reset-Button für alle Benutzer aktiviert (Backend trennt User/Global)
- Hint-Text geändert: Globale Einstellungen nur für Administratoren

**Dateien:** public/js/loginPanel.js,public/index.html,public/js/watchPathsPanel.js,public/js/configPanel.js,public/js/thresholdPanel.js

### 2026-05-16 — Review-Fixes (Markus/Sandra/Lisa)

- B1: analyze-clear setzt running=false (verhindert 409-Deadlock)
- B2: Neuer Analyse-Run leert alte Client-Daten bei analyze-start
- N1: clearAnalysis() optimistic — UI sofort leer, fetch fire-and-forget
- N2: updateAnalyzeButtons() nach WS Clear-Events
- N3: toggle-arrow in eigenem span — Username im Header bleibt erhalten
- N4: Collapsed-State Live/Analyse getrennt (analyze: Prefix)
- N5: WS-Reconnect setzt analyzeRunning sauber zurück
- N6: Stream-Fehler in analyzeFile abgefangen
- N7: Clear-Source Button disabled während laufender Analyse

**Dateien:** server/routes/analysisRoutes.js,server/analysisService.js,public/js/wsClient.js,public/js/analyzePanel.js,public/js/render.js,public/js/actions.js

### 2026-05-16 — Analyse-Löschen Bugfix

- Fix: Analyse-Quelle löschen funktioniert jetzt auch serverseitig für Non-Admins (canAccessLabel-Check entfernt, da per-user isoliert)
- Debug-Logs entfernt

**Dateien:** server/routes/analysisRoutes.js,public/js/analyzePanel.js

### 2026-05-16 — Analyse-Berechtigungen und Bugfixes

- Analyse-Ergebnisse löschen sofort clientseitig (nicht mehr auf WS-Broadcast warten)
- Analyse-Pfade speichern/importieren/löschen für alle Benutzer freigegeben
- Benutzername im Analyse-Header auch nach F5 sichtbar (Fallback auf currentUser)
- POST /api/config für alle Benutzer erlaubt (User-Felder waren schon sicher gesplittet)

**Dateien:** public/js/analyzePanel.js,public/js/actions.js,public/js/wsClient.js,public/index.html,server/httpRouter.js,server/routes/analysisRoutes.js

### 2026-05-16 — Per-User Analyse-Isolation

- Analyse-Ergebnisse sind jetzt pro Benutzer isoliert (eigener Store, eigener Running-State)
- Mehrere Benutzer können gleichzeitig analysieren ohne sich gegenseitig zu überschreiben
- broadcastToUser() sendet Analyse-Events nur an den startenden Benutzer
- runId/Generation-Counter verhindert Race-Conditions bei Cancel/Clear
- try/finally garantiert State-Reset auch bei Fehlern
- Analyse-Pfade speichern/importieren für alle Benutzer freigegeben (nicht mehr admin-only)
- Benutzername wird im Analyse-Header angezeigt

**Dateien:** server/runtimeStore.js,server/wsBroadcast.js,server/analysisService.js,server/routes/analysisRoutes.js,server.js,public/js/render.js,public/js/wsClient.js,public/js/state.js,public/index.html,server/httpRouter.js

### 2026-05-16 — Bugfixes: Admin-Buttons, Pfad-Checkboxen, Crash-Schutz

- Löschen/Monitor-Buttons wieder data-admin-only (waren versehentlich freigegeben)
- updateLiveControlStates() prüft Admin-Rolle vor Button-Aktivierung
- UserPanel: WatchPaths per fetch('/api/config') laden statt state.config (existierte nicht)
- WS-Broadcast: try/catch um alle send()-Aufrufe (Crash-Schutz)
- WS-Connection: ws.on('error') Handler + try/catch um Init-Handler
- Crash-Logging in crash.log mit Timestamp und Stacktrace
- process.on('exit') Handler für saubere Exit-Diagnose

**Dateien:** public/js/render.js, public/js/userPanel.js, public/index.html, server.js, server/wsBroadcast.js

### 2026-05-15 — Per-User Pfad-Sichtbarkeit mit Checkboxen

- User-Config: visibleLabels Feld (null=alle, []=keine, Array=Auswahl)
- Admin kann pro User sichtbare Pfade per Checkbox setzen (📂 Button im User-Panel)
- WebSocket: Init + Broadcast filtern pro Client nach visibleLabels
- GET /api/config: WatchPaths für Nicht-Admins nach visibleLabels gefiltert
- Löschen/Monitor-Buttons für alle User auf eigene Pfade erlaubt (nicht mehr admin-only)
- Backend: canAccessLabel() prüft bei pause/resume/clear/trash-Operationen
- WS-Close (4403) bei Rechteänderung → automatischer Reconnect
- AGENTS.md: Security-Kontext Abschnitt (hausintern, pragmatisch)

**Dateien:** server/userConfigStore.js, server/wsBroadcast.js, server/routes/userRoutes.js, server/routes/processRoutes.js, server/routes/trashRoutes.js, server/routes/analysisRoutes.js, server/routes/configRoutes.js, server/watchService.js, server.js, public/js/userPanel.js, public/js/render.js, public/js/wsClient.js, public/index.html, public/style.css, AGENTS.md

### 2026-05-15 — Admin-Berechtigungen für alle Löschen- und Monitor-Buttons

- Alle dynamischen Löschen-Buttons (🗑️) pro Quellgruppe nur für Admins
- Monitor pausieren/fortsetzen Buttons nur für Admins
- Papierkorb leeren nur für Admins
- Analyse Ergebnisse löschen nur für Admins
- Alle löschen (Live-Monitor Toolbar) nur für Admins
- E-Mail Log löschen: Fix für disabled-Überschreibung durch loadEmailLog()
- applyUserRole() wird nach jedem renderAll() aufgerufen für dynamische Elemente

**Dateien:** public/js/render.js, public/js/configPanel.js, public/index.html

### 2026-05-15 — Auth + Benutzerverwaltung + Multi-Tenant Config (Gesamtübersicht)

- Auth-System: Login-Overlay, Cookie-Sessions (HttpOnly, 8h), Auth-Guard für alle API-Routen + WebSocket
- Benutzerverwaltung: User-CRUD Tab (Admin), eigenes Passwort ändern (alle), Default-Admin admin/admin
- Multi-Tenant Config: Per-User emailTo, Copilot-Pfade, Analyse-Pfade in users/{username}/config.json
- API: GET /api/config merged (global+user), POST splittet automatisch nach Rolle
- E-Mail-Service: Empfänger-Aggregation über alle User-Subscriptions
- Migration: Bestehende emailTo/Copilot/Analyze-Werte werden automatisch in Admin-User-Config überführt

**Dateien:** server/userStore.js, server/sessionMiddleware.js, server/userConfigStore.js, server/routes/authRoutes.js, server/routes/userRoutes.js, server/routes/configRoutes.js, server/httpRouter.js, server/emailService.js, server.js, public/js/loginPanel.js, public/js/userPanel.js, public/js/boot.js, public/js/state.js, public/js/wsClient.js, public/index.html, public/style.css

### 2026-05-15 — Multi-Tenant Config — Per-User Einstellungen

- Multi-Tenant Config: Per-User emailTo, Copilot-Pfade und Analyse-Pfade
- userConfigStore.js: User-Config Lesen/Schreiben/Merge/Split in users/{username}/config.json
- GET /api/config liefert jetzt merged Config (global + User-spezifisch)
- POST /api/config splittet automatisch: User-Felder → User-Config, globale Felder → config.js (nur Admin)
- Migration: emailTo-Werte aus globaler Config werden beim Start in Admin User-Config überführt
- E-Mail-Service: Empfänger werden jetzt über alle User-Subscriptions aggregiert
- Copilot-Export: Pfade werden aus User-Config des eingeloggten Benutzers gelesen
- Neue User bekommen automatisch Default-Config mit globalen Vorgabewerten

**Dateien:** server/userConfigStore.js, server/routes/configRoutes.js, server/emailService.js, server/userStore.js, server.js

### 2026-05-15 — Benutzerverwaltung — User-CRUD + Passwortänderung

- Benutzerverwaltung: Neuer 'Benutzer' Tab in den Einstellungen (Admin-only)
- User-CRUD API: Benutzer erstellen, Rolle ändern, Passwort zurücksetzen, löschen
- Eigenes Passwort ändern: Für alle Benutzer verfügbar (mit Prüfung des alten Passworts)
- Schutz: Letzter Admin kann nicht gelöscht werden, alle User-APIs admin-only

**Dateien:** server/routes/userRoutes.js, public/js/userPanel.js, public/index.html, public/style.css, server/httpRouter.js, public/js/configPanel.js

### 2026-05-15 — Auth Phase 1 — Login, Session, Berechtigungen

- Benutzer-Authentifizierung: Login-Overlay mit Cookie-basierter Session (HttpOnly, SameSite=Strict, 8h Timeout)
- Benutzerverwaltung: users.json mit bcryptjs-Hashing, Default-Admin (admin/admin) wird automatisch erstellt
- Auth-Guard: Alle API-Routen geschützt (401), Admin-Only Routen (Config, Backup, Style, System) mit 403
- WebSocket-Auth: Session-Cookie wird beim Handshake geprüft, unauthentifizierte Verbindungen abgelehnt
- Frontend: Login-Overlay (Fullscreen), User-Info + Rolle im Header, Logout per Page-Reload
- Admin-Only UI: data-admin-only Attribut für deklaratives Disable von Admin-Elementen

**Dateien:** server/userStore.js, server/sessionMiddleware.js, server/routes/authRoutes.js, server/httpRouter.js, server.js, public/js/loginPanel.js, public/js/state.js, public/js/boot.js, public/js/wsClient.js, public/index.html, public/style.css

### 2026-05-15 — Tab-Reorganisation: Monitor zweispaltig

- Copilot-Export, Fehlererkennung und Schwellwertregeln von Tab 'Allgemein' nach Tab 'Monitor' verschoben
- Monitor-Tab jetzt zweispaltig: Links=WatchPaths-Tabelle, Rechts=Export+Filter+Schwellwerte (60/40 Grid)
- Tab 'Allgemein' enthält nur noch Server + Dateien/Fehler + Papierkorb (System-Config)
- CSS: .config-columns-monitor mit 3fr/2fr Grid + overflow-x für Tabelle
- Kein JS-Refactoring nötig (alle Funktionen arbeiten ID-basiert)

**Dateien:** public/index.html,public/style.css

### 2026-05-15 — Bugfixes Analyse-Panel und Config-Panel Entkopplung

- Config-Panel: Selektoren auf #configPanel eingegrenzt (verhindert Kollision mit Analyse-Panel)
- Analyse-Panel: Eigene Config-Ladung (loadAnalyzeConfig) unabhängig vom Config-Panel
- Config-Formular: _configFormPopulated Flag verhindert fehlende Befüllung

**Dateien:** public/js/configPanel.js, public/js/analyzePanel.js

### 2026-05-15 — Log-Analyse Import-Funktion

- Import-Funktion für Log-Analyse Pfade (Textarea + Drag & Drop)
- Gleiche Umsetzung wie Monitor-Import: Live-Vorschau, Duplikat-Erkennung
- Unterstützt CSV/TXT Dateien und manuelle Eingabe

**Dateien:** public/index.html, public/js/analyzePanel.js

### 2026-05-15 — Log-Analyse als eigenständiges Panel

- Log-Analyse aus Einstellungen herausgelöst in eigenes Panel
- Neuer Header-Button "📂 Log-Analyse" vor Einstellungen
- Analyse-Panel und Config-Panel schließen sich gegenseitig
- Config-Tab "📂 Log-Analyse" entfernt

**Dateien:** public/index.html, public/js/analyzePanel.js, public/js/configPanel.js

### 2026-05-15 — WatchPaths → Monitor umbenannt

- Config-Tab "WatchPaths" → "Monitor" mit Tooltip "Pfadüberwachung"
- Button "+ WatchPath hinzufügen" → "+ Pfad hinzufügen"
- Fehlermeldung und Papierkorb-Label angepasst
- Nur UI-Labels geändert, interne CSS-Klassen und JS-Funktionen unverändert

**Dateien:** public/index.html, public/js/configPanel.js, public/js/render.js

### 2026-05-13 — AGENTS.md Projekt-Instruktionen

- AGENTS.md erstellt — zentrale KI-Instruktionen für alle Sessions
- Dokumentiert: verfügbare Utility-Funktionen, Namespaces, verbotene Patterns
- Verhindert wiederkehrende Fehler (confirm(), fetch→patch→save, alert())

**Dateien:** AGENTS.md

### 2026-05-13 — Custom Confirm-Dialog

- Native confirm() durch eigenen Modal-Dialog ersetzt (E-Mail Log löschen, Monitor beenden)
- Neues Modul confirmDialog.js mit showConfirm(message) → Promise<boolean>
- Dialog nutzt Theme-Variablen, hat Escape-Support und Backdrop-Click

**Dateien:** public/js/confirmDialog.js, public/style.css, public/index.html, public/js/actions.js, public/js/configPanel.js

### 2026-05-13 — Session-Abschluss

- Diagnose-Code bereinigt (console.trace → console.log)
- Alle 80 Smoke-Tests bestanden
- Session abgeschlossen: Suche erweitert, FTP-Bug + Save-Button-Bug behoben

### 2026-05-13 — FTP-Persistenz & Save-Button Fix

- FTP-Backup-Persistenz-Bug behoben: saveAnalyzePaths() überschrieb Config mit veralteten Daten — nutzt jetzt buildConfigFromForm()
- Save-Button bleibt nach Speichern korrekt disabled (50ms Guard gegen asynchrone Browser-Events)
- HTML-Syntaxfehler bei Select-Element behoben (doppeltes >>)
- SELECT-Elemente in Change-Detection aufgenommen (boot.js)
- Diagnose-Logging für FTP-Config auf Server-Seite hinzugefügt

**Dateien:** public/js/configPanel.js,public/js/analyzePanel.js,public/js/boot.js,public/index.html,server/routes/configRoutes.js

### 2026-05-13 — Suche: Leerzeichen-Trimming

- Suchfeld trimmt Leerzeichen aus Copy-Paste automatisch (.trim())

**Dateien:** public/js/actions.js

### 2026-05-13 — Suche auf Dateinamen erweitert

- Suchfeld filtert jetzt nach Fehlertext ODER Log-Dateiname (OR-Logik)
- Wildcard-Suche funktioniert auch für Dateinamen (z.B. KeasyServer*)
- Placeholder aktualisiert: 'Suche in Fehler & Dateiname...'

**Dateien:** public/js/render.js, public/index.html

### 2026-05-12 — Speichern-Button sticky fixiert

- Speichern-Button (.config-actions) mit position:sticky am unteren Rand des Config-Panels fixiert
- Button bleibt im Backup-Tab (und allen anderen Tabs) immer sichtbar, auch bei langem Inhalt

**Dateien:** public/style.css

### 2026-05-12 — Backup-Tab Save-UX vereinheitlicht

- Backup-Tab nutzt jetzt den Shared-Speichern-Button wie alle anderen Tabs
- Eigener 'Konfiguration speichern'-Button im Backup entfernt
- Alle Backup-Felder aktivieren dirty-Detection (markConfigDirty)
- Konsistente UX: Button disabled bis Änderung, dann aktiv

**Dateien:** public/index.html,public/js/backupPanel.js,public/js/backupTargetsPanel.js,public/js/configPanel.js

### 2026-05-12 — P2 Quick Wins + FTP-Checkbox-Fix

- Helper-Duplikation behoben: formatSize/formatTimeAgo in utils.js zentralisiert
- parseJsonBody: 1 MB Body-Size-Limit eingeführt
- FTP-Checkbox-Reset-Bug behoben: _loaded Guard verhindert versehentliches Überschreiben

**Dateien:** public/js/utils.js,public/js/backupPanel.js,public/js/backupRestorePanel.js,public/js/configPanel.js,server/parseJsonBody.js

### 2026-05-12 — Review-Findings P0+P1 Fixes

- P0 Fix: Config-Validierung vor Speichern (erst apply, dann write)
- P1 Fix: updateFtpSecureWarning fehlte im window-Export (ReferenceError)
- P1 Fix: decodeURIComponent mit try/catch abgesichert (malformed URLs → 400)
- P1 Fix: runAnalysis() mit .catch() für sauberes Error-Handling
- P1 Fix: Router Error-Boundary für API-Handler (try/catch + Promise.catch → 500)
- Neuer Smoke-Test: malformed URL (80 Tests gesamt)

**Dateien:** server.js,server/httpRouter.js,server/routes/configRoutes.js,server/routes/analysisRoutes.js,public/js/backupPanel.js,test/smoke.js

### 2026-05-12 — Crash-Protection Handler

- Crash-Protection: uncaughtException + unhandledRejection Handler in server.js
- Server bleibt bei unbehandelten Fehlern am Leben statt sich stillschweigend zu beenden
- Fehler werden in der Konsole geloggt mit ⚠️ Warnung

**Dateien:** server.js

### 2026-05-12 — backupPanel.js Refactoring (Plan 2.3)

- backupPanel.js 3-Wege-Split: 556 → ~180 Zeilen Fassade
- Neu: backupTargetsPanel.js (~240 Z.) — Lokale Backup-Ziele, Cards, CRUD, collectBackupConfig
- Neu: backupRestorePanel.js (~150 Z.) — Restore-Liste, Delete, Preview, Restore-Flow
- backupPanel.js bleibt Koordinator: loadBackupConfig, FTP-Config, Save, Run, Status
- Keasy.backup.targets / .restore Namespace-Pattern für Cross-Panel-Kommunikation

**Dateien:** public/js/backupPanel.js,public/js/backupTargetsPanel.js,public/js/backupRestorePanel.js,public/index.html

### 2026-05-12 — httpRouter.js Refactoring

- httpRouter.js (857 Zeilen) in 8 Module aufgeteilt
- Neu: markdownHelper.js, parseJsonBody.js + 5 Route-Module unter server/routes/
- processRoutes.js (205 Z.) - Runtime-Operationen
- trashRoutes.js (106 Z.) - Papierkorb
- backupRoutes.js (75 Z.) - Backup
- analysisRoutes.js (70 Z.) - Log-Analyse
- configRoutes.js (190 Z.) - Config, Style, Docs, System-Check
- httpRouter.js auf ~75 Zeilen Dispatcher reduziert mit Route-Map-Lookup
- mergeRoutes() mit Duplicate-Key-Schutz statt if/else-Kette
- 79/79 Smoke-Tests bestehen weiterhin

**Dateien:** server/httpRouter.js, server/markdownHelper.js, server/parseJsonBody.js, server/routes/processRoutes.js, server/routes/trashRoutes.js, server/routes/backupRoutes.js, server/routes/analysisRoutes.js, server/routes/configRoutes.js

### 2026-05-12 — configPanel.js Refactoring

- configPanel.js (744 Zeilen) in 5 Dateien aufgeteilt
- Neu: docsPanel.js, cssEditorPanel.js, watchPathsPanel.js, thresholdPanel.js
- configPanel.js auf 275 Zeilen Core reduziert (Tab-Switch, Config Save/Load, Filter, Preload)
- Cross-Panel-Kommunikation über Keasy.* Namespace
- 79/79 Smoke-Tests bestehen weiterhin

**Dateien:** public/js/configPanel.js, public/js/docsPanel.js, public/js/cssEditorPanel.js, public/js/watchPathsPanel.js, public/js/thresholdPanel.js, public/index.html

### 2026-05-12 — Version-Button entfernt

- 📦 Version aktualisieren Button + Statusanzeige aus UI entfernt
- quickVersionBump() + checkForChanges() aus configPanel.js entfernt
- /api/has-changes Endpoint aus httpRouter.js entfernt
- 6 leere 'Aktualisierung'-Einträge aus README.md bereinigt

**Dateien:** public/index.html, public/js/configPanel.js, server/httpRouter.js, README.md

### 2026-05-12 — Historie-Formular in Web-UI

- Neuer Button "📝 Historie-Eintrag hinzufügen" im Dokumentation-Tab (aufklappbares Formular)
- API-Endpoint `POST /api/update-docs` mit Server-Validierung
- XSS-Hardening: Markdown-Links nur noch http/https erlaubt
- Version im Header aktualisiert sich automatisch nach Eintrag

**Dateien:** server/httpRouter.js, public/index.html, public/js/configPanel.js

### 2026-05-12 — Overnight-File-Detection Bugfix

- **Problem:** Neue Log-Dateien die über Nacht erscheinen wurden nicht eingelesen (Position = Dateigröße statt 0)
- **Ursache:** Nach `initialScanDone` wurde für neue Dateien `filePositions = stat.size` gesetzt — bestehender Inhalt übersprungen
- **Fix:** Neue Dateien nach Initial-Scan werden jetzt ab Position 0 gelesen (sofern unter maxLogFileSizeMB)

**Dateien:** server/watchService.js

### 2026-05-11 — UI-Verbesserungen & Schwellwert-Bugfixes

- **Kompakte Regel-Ansicht:** Schwellwertregeln werden als einzeilige Zusammenfassung angezeigt (Accordion-Design), per Klick expandierbar zum Bearbeiten. Live-Update der Summary beim Tippen.
- **Validierung blockiert Speichern:** Unvollständige Schwellwertregeln verhindern jetzt das Speichern (vorher wurde der Vorgang trotz Fehler abgeschlossen).
- **Placeholder-Fix:** Schwellwert-Feld zeigt `"z.B. 4000"` statt `"4000"` — verhindert Verwechslung mit eingegebenem Wert.
- **Case-insensitive Matching:** Schwellwertregel-Matching ignoriert jetzt Groß-/Kleinschreibung.
- **Papierkorb-Settings** in linke Spalte verschoben mit einheitlichem Gruppen-Design (grauer Rahmen).
- **Confirm-Dialoge entfernt:** Papierkorb leeren ohne Browser-Bestätigungsdialog.

**Dateien:** `public/js/configPanel.js`, `public/style.css`, `public/index.html`, `server/logParser.js`, `public/js/trashPanel.js`, `config.js`

### 2026-05-11 — Schwellwert-Regeln für Fehlererkennung

Neuer Regeltyp neben den bestehenden Text-FilterPatterns: Numerische Schwellwerte aus Log-Zeilen erkennen.

**Beispiel:** `[Memory] WorkingSet: 4523,7 MB` → Regel "WorkingSet:" > 4000 MB → Fehler erkannt.

- **Backend:** `extractNumber()`, `matchesThresholdRule()`, `rebuildThresholdRules()` in `logParser.js`, automatisch bei Config-Reload aktiv
- **Frontend:** Neue Karten-UI "📊 Schwellwertregeln" im Einstellungen-Tab, Regeln hinzufügen/entfernen/konfigurieren
- **Config:** Neues Feld `thresholdRules[]` mit `name`, `contains`, `before`, `operator`, `value`
- Deutsches Zahlenformat (Komma als Dezimaltrennzeichen) wird unterstützt

**Dateien:** `server/logParser.js`, `server.js`, `public/js/configPanel.js`, `public/js/state.js`, `public/index.html`, `public/style.css`, `config.js`

### 2026-05-11 — Smoke-Test Config-Restore Bugfix

**Problem:** Der Backup-Fixture-Test setzte `backup.locals = []` am Ende und stellte die Original-Config nicht wieder her — Backup-Einstellungen gingen nach jedem Testlauf verloren.

**Fix:** `origLocals` wird vor dem Test gesichert (deep copy) und im Teardown wiederhergestellt. Analyse-Zeitfilter auf `isInDateRange` vereinheitlicht.

**Dateien:** `test/smoke.js`, `public/js/render.js`

### 2026-05-11 — Gezieltes Refactoring (Sicherheit + Codequalität)

**Maßnahmen:**

1. **Legacy `public/app.js` entfernt** — 1.571 Zeilen toter Code, wurde nicht mehr geladen (nicht in index.html referenziert). Alle Funktionen leben jetzt in den modularen `public/js/*.js` Dateien.

2. **`httpRouter.js` gehärtet:**
   - **Path-Traversal-Schutz:** Static-File-Pfade werden mit `path.resolve()` normalisiert und gegen `publicDir` geprüft (403 bei Ausbruch)
   - **`exec()` → `execFile()`:** Alle 3 Prozessstarts (`/api/open-folder`, `/api/open-file`, `/api/open-file-at-line`) verwenden jetzt `execFile` mit Array-Argumenten statt String-Interpolation (Command-Injection-Schutz)

3. **Smoke-Tests erweitert (+15 Tests):**
   - `testStaticFileSecurity` — Path-Traversal mit `../`, encoded `%2e%2e`, doppeltem `../../`
   - `testBackupDeleteSecurity` — fehlender Dateiname, Path-Traversal, ungültiges Format
   - `testOpenFileEndpoints` — fehlender filePath in allen 3 open-Endpoints
   - `testUnknownRoutes` — 404 für unbekannte API-Routen

**Dateien:** `server/httpRouter.js`, `test/smoke.js`, `public/app.js` (gelöscht)

### 2026-05-11 — Speichern-Button Bugfix

**Problem:** Der "💾 Speichern"-Button in den Einstellungen war sofort nach dem Öffnen aktiv, obwohl noch nichts geändert wurde.

**Ursache:** `markConfigDirty()` wurde während `populateConfigForm()` durch Event-Bubbling ausgelöst (input/change-Events beim Setzen von Formularwerten).

**Fix:** `_populatingForm`-Flag unterdrückt `markConfigDirty()` während des Befüllens. Zusätzlich wird nach `loadConfig()` der Button explizit auf `disabled` gesetzt.

**Dateien:** `public/js/configPanel.js`

### 2026-05-11 — Browser-Tab Fehleranzahl Bugfix

**Problem:** Die Fehleranzahl im Browser-Tab (`(N) Keasy Log Monitor`) wurde nur bei neuen Fehlern aktualisiert — beim Löschen, Filtern oder Watcher-Restart blieb der alte Zähler stehen.

**Fix:** Neue `updateBrowserTitle()` Funktion in `render.js`, wird an allen 3 Stellen aufgerufen wo `totalErrors` gesetzt wird. Bei 0 Fehlern zeigt der Tab nur "Keasy Log Monitor" (ohne Klammer).

**Dateien:** `public/js/render.js`, `public/js/boot.js`

### 2026-05-11 — WatchPath-Import

**Feature:** Neue Import-Funktion für WatchPaths — Pfade können per Textarea eingefügt oder als CSV/Excel/TXT per Drag & Drop importiert werden.

**Details:**
- **📥 Import-Button** im WatchPaths-Tab neben "+ WatchPath hinzufügen"
- Textarea für Pfade (ein Pfad pro Zeile), unterstützt Format `Pfad` oder `Pfad;Label;Email` (Trennzeichen: `;` oder Tab)
- **Drag & Drop** — CSV-, Excel- (.xlsx/.xls) und TXT-Dateien direkt auf die Textarea ziehen
- Excel-Parsing via SheetJS (wird bei Bedarf von CDN geladen)
- **Duplikat-Erkennung** — bereits vorhandene Pfade werden übersprungen
- **Live-Vorschau** — "X neue Pfade erkannt" bei Eingabe
- **Polling standardmäßig aktiv** für alle importierten Pfade
- Kommentarzeilen mit `#` werden ignoriert

**Dateien:** `public/index.html`, `public/js/configPanel.js`

### 2026-05-11 — Suchergebnisse farblich markieren

**Feature:** Suchbegriffe werden im Fehlertext gelb hervorgehoben (`<mark class="highlight-search">`). Funktioniert mit einfacher Suche und Wildcard-Suche, kombinierbar mit den roten Filter-Pattern-Highlights.

**Details:**
- Neue Funktion `highlightSearch(text)` in `utils.js` — tag-sicher (markiert nur Textteile, nicht HTML-Tags), eigene Regex mit `gi`-Flags, lazy Wildcards (`.*?` statt `.*`)
- Neue CSS-Klasse `.highlight-search` — gelber Hintergrund, `color: inherit` (bestehende rote Highlights bleiben erhalten)
- An allen 3 Render-Stellen integriert: Live-Fehler, Analyse-Ergebnisse, Papierkorb

**Dateien:** `public/js/utils.js`, `public/js/render.js`, `public/style.css`

### 2026-05-11 — Backup-Delete via UI

**Feature:** Backups können direkt über die Oberfläche gelöscht werden (🗑️-Button pro Backup-Zeile). Nicht erreichbare Backup-Ziele werden als Warnung angezeigt.

**Details:**
- **🗑️-Button** pro Backup-Zeile — direktes Löschen ohne Bestätigungsdialog
- **API-Endpoint** `POST /api/backup/delete` mit Sicherheitsvalidierungen (Dateiname-Format, Path-Traversal-Schutz)
- **Ziel-Erreichbarkeit** — `listBackups()` gibt jetzt `{ backups, targets }` zurück, nicht erreichbare Ziele werden als Warnung angezeigt
- **Fehlerbehandlung** — `resp.ok`-Checks vor `.json()` in allen Backup-API-Aufrufen

**Dateien:** `server/backupService.js`, `server/httpRouter.js`, `public/js/backupPanel.js`, `public/index.html`

### 2026-05-11 — Analyse-Ergebnisse löschen & Watcher-Restart-Bugfix

**Problem 1:** Analyse-Ergebnisse (keasy-log-analyse) konnten nicht aus der Hauptansicht gelöscht werden. Es gab keinen 🗑️-Button, und die Zeitfilter-Buttons (1h, 2h…) hatten keine Auswirkung auf Analyse-Ergebnisse.

**Änderungen (Analyse):**
- **🗑️-Button pro Analyse-Quellgruppe** — jede Analyse-Quelle hat nun einen eigenen Lösch-Button im Header (analog zu Live-Quellen)
- **Neuer API-Endpoint** `POST /api/analyze-clear-source` — löscht Analyse-Ergebnisse eines bestimmten Labels (statt immer alle)
- **Zeitfilter für Analyse** — die Buttons 1h/2h/4h/6h/12h filtern jetzt auch Analyse-Ergebnisse (Von/Bis-Datum bewusst nicht, da Analyse historische Daten enthält)
- **Papierkorb-Klarstellung** — Papierkorb umbenannt zu "Papierkorb (WatchPath)" mit Hinweis: nur für Live-Monitoring, Analyse-Ergebnisse werden direkt gelöscht

**Problem 2:** Nach Klick auf „🔄 Watcher neu starten" im Dashboard wurden keine Log-Dateien mehr erkannt — keine Fehler eingelesen, Anzeige blieb leer. Voller Server-Neustart funktionierte.

**Ursache:** Die Restart-Route `/api/restart-watcher` rief nur `preloadReset()` auf, aber nicht `resetWatcherRuntime()`. Dadurch blieben `filePositions` und `fileLabelMap` mit alten Werten gefüllt. Die neuen chokidar-Watcher feuerten `add`-Events, aber der Handler übersprang alle Dateien als „schon bekannt".

**Fix:** `preloadReset()` durch `resetWatcherRuntime()` ersetzt — leert zusätzlich `filePositions` und `fileLabelMap`, sodass Dateien beim Watcher-Restart komplett neu eingelesen werden.

**Problem 3:** Bei jedem Watcher-Restart wurden Fehlerzähler immer höher, weil der `errorStore` nicht geleert wurde — die gleichen Fehler wurden erneut eingelesen und zu den bestehenden addiert.

**Fix:** `errorStore.clear()` in `resetWatcherRuntime()` ergänzt. Zusätzlich leert der Client nach erfolgreichem Restart `state.errors` und rendert neu, sodass das Dashboard sofort einen sauberen Zustand zeigt.

**Dateien:** `server/httpRouter.js`, `server/runtimeStore.js`, `public/js/render.js`, `public/js/actions.js`, `public/js/wsClient.js`

### 2026-05-09 — Bugfixes: Watcher + UX

**Fix: Doppelte Datei-Erkennung**
- Chokidar feuerte `add`-Event doppelt für dieselbe Log-Datei (bei Polling/Netzlaufwerken)
- Duplikat-Check via `fileLabelMap.has(filePath)` — zweiter Event wird ignoriert

**Fix: Fehler-Zählung Konsole ↔ Dashboard**
- Konsole zählte alle gespeicherten Fehler (bis `maxErrorsPerFile × 2`), Dashboard zeigte nur `maxErrorsPerFile`
- Konsolen-Zählung jetzt begrenzt auf `Math.min(errorsAfter - errorsBefore, maxErrorsPerFile)`

**UX: Live-Control-Hinweise bei Log-Analyse**
- „Sichtbare löschen" wird disabled wenn keine sichtbaren Live-Fehler vorhanden sind
- Tooltips an allen Live-only Buttons (Zeitfilter, Löschen, Pause): „nur Live-Monitoring"

**Dateien:** `server/watchService.js`, `public/js/render.js`, `public/js/boot.js`, `public/index.html`

### 2026-05-09 — Multi-Local Backup + FTP-Fixes

**Feature: Multi-Local Backup-Ziele**
- Beliebig viele lokale Backup-Ziele statt nur einem (z.B. lokaler Ordner + Cloud-Sync + externes Laufwerk)
- Stabile Ziel-IDs (`loc_xxxxxxxx`) für API-Referenzierung und Status-Tracking
- Auto-Migration: bestehende `backup.local` (Object) wird automatisch zu `backup.locals[]` (Array) konvertiert
- Hybrid-Label-Dropdown pro Ziel: 📁 Lokales Backup, ☁️ Cloud / Sync-Ordner, 💾 Externes Laufwerk, ✏️ Benutzerdefiniert
- Dynamische Karten-UI: Ziele hinzufügen/entfernen, Prüfen per ID, Löschen mit Bestätigung
- Duplikat-Pfad-Erkennung (`path.resolve().toLowerCase()`) beim Speichern
- Run-Lock (Mutex): Verhindert parallele Backup-Runs (manuell + Scheduler)
- Backup-Status und Rotation pro Ziel-ID (nicht mehr pro Target-Typ)
- Restore mit `sourceId` zur korrekten Pfad-Auflösung
- Safety-Backup bei Restore: erstes aktives+beschreibbares lokales Ziel

**Fix: FTP-Verschlüsselung**
- FTP Secure-Checkbox durch Dropdown ersetzt: Keine / Explizites FTP über TLS (STARTTLS) / Implizites FTPS
- Behebt Problem mit FileZilla-kompatiblen Einstellungen (Explicit STARTTLS ≠ `secure: true`)
- `resolveFtpSecure()` Helper für alle 5 FTP-Verbindungspunkte

**Fix: Dedizierter Backup-Speichern-Button**
- Eigener 💾-Button im Backup-Tab (vorher musste man über "Allgemein" speichern)
- Buttons "Konfiguration speichern" und "Jetzt sichern" nebeneinander

**Fix: FTP-Backup-Metadaten**
- FTP-Backups zeigen jetzt Inhalt und Versionsnummer in der Restore-Liste
- ZIPs werden temporär heruntergeladen, Manifest geparst, Temp-Dateien gelöscht

**Dateien:** `server/configStore.js`, `server/backupService.js`, `server/healthCheck.js`, `server/httpRouter.js`, `public/js/backupPanel.js`, `public/index.html`

### 2026-05-09 — System-Check (Health-Check Tab)

**Feature: 🧪 System-Check**
- Neuer Tab "System-Check" in Einstellungen — 16 read-only Health-Checks in 6 Kategorien
- **Kategorien:** Server & HTTP, WebSocket, Konfiguration, Dateisystem (inkl. Netzlaufwerke), Backup, E-Mail
- Checks laufen direkt im Server-Prozess (kein Child-Process, keine destruktiven Tests)
- Live-Ergebnisse per WebSocket mit 80ms-Verzögerung für sichtbares "Eintickern"
- Status pro Check: ✅ ok · ❌ fail · ⚠️ warn · ⏭️ skip
- Cooldown: 10s zwischen Checks (DOS-Schutz, HTTP 429)
- 409 wenn Check bereits läuft
- Global-Timeout: 30s mit `Promise.race` (hängende Checks werden abgebrochen)
- Netzlaufwerk-Timeout: 10s (statt 5s lokal) — berücksichtigt Windows-OS-Timeouts
- Reconnect-safe: Letztes Ergebnis wird bei WebSocket-Init mitgesendet
- Tab-Overflow-Fix: `.config-tabs` mit `flex-wrap: wrap` für 9 Tabs
- Vorhandene CSS-Variablen für Farbgebung (passt zu allen 3 Themes)
- **Dateien:** `server/healthCheck.js` (neu), `public/js/systemCheckPanel.js` (neu), httpRouter.js, wsClient.js, configPanel.js, index.html, style.css
- **API:** `POST /api/system-check/run`, `GET /api/system-check/status`
- **Triple-Review:** Markus 🟢, Sandra 🟡→✅, Lisa 🟢

### 2026-05-09 — Backup & Restore

**Feature: 🗄️ Backup & Restore**
- Neuer Tab "Backup" in Einstellungen mit vollständiger Backup- und Restore-Funktionalität
- **Backup-Ziele:** Lokales Verzeichnis + FTPS (weitere cloud-Optionen vorbereitet)
- **Zeitplan:** Tägliches automatisches Backup zu konfigurierbarer Uhrzeit (Drift-Korrektur)
- **Verpasste Backups:** Beim Start Check ob >25h seit letztem Backup, automatisches Nachholen
- **Rotation:** Konfigurierbare max. Anzahl Backups pro Ziel (älteste werden gelöscht)
- **ZIP-Inhalt:** config.json (nicht .js, Schutz vor Code-Injection), style.css, email.log, backup-manifest.json
- **Restore-Flow:** Preview (Inhalt + Overwrites) → Bestätigungsdialog → Sicherheits-Backup → atomischer Replace → Server-Neustart
- **Sicherheit:** Whitelist-Validierung (nur erlaubte Dateien), Zip-Slip-Schutz (Pfad-Traversal-Erkennung), FTP-Passwort maskiert
- **Retry-Logik:** 3 Versuche mit 15s Pause bei Verbindungsproblemen
- **Verbindungstest:** Button pro Backup-Ziel (inkl. Schreibtest)
- **FTP:** Secure (FTPS) als Standard, Passwort-Masking wie SMTP
- **Dateien:** `server/backupService.js` (neu), `public/js/backupPanel.js` (neu), httpRouter.js, server.js, configPanel.js, index.html, config.js
- **API:** `/api/backup/run`, `/list`, `/status`, `/test-connection`, `/preview`, `/restore`
- **Smoke-Tests:** 21 neue Tests (57 total, alle bestanden)
- **Triple-Review:** Markus 🔴→🟢, Sandra 🔴→🟢, Lisa 🟢 (2 Review-Runden mit kritischen Fixes)
- **Dependencies:** archiver (v7, ZipArchive API), basic-ftp, adm-zip

### 2026-05-09 — Refactoring: Modularisierung (6 Phasen)

Komplette Modularisierung der Codebasis in 6 Phasen, basierend auf Triple-Review (Markus/Architekt, Sandra/QA, Lisa/Frontend).

**Phase 0 — Smoke-Tests:**
- 57 Blackbox-Tests (`test/smoke.js`): HTTP, API, Config, Watcher, Analyse, Clear-All, Backup (21), WebSocket
- Kein Test-Framework — nur `fetch` + `assert` + `ws`. Exit-Code 0/1

**Phase 1 — Server Runtime-Kern (3 Module):**
- `server/runtimeStore.js` — Alle Maps/Sets/Flags zentral (state-Objekt für primitive Werte)
- `server/wsBroadcast.js` — WebSocket Client-Verwaltung + Broadcast (Callback-Pattern für Trash)
- `server/configStore.js` — Config-Proxy für transparenten `config.port`-Zugriff + Hot-Reload

**Phase 2 — Server Feature-Module (6 Module):**
- `server/trashService.js` — Papierkorb: Batches, Eviction, Snapshot
- `server/logParser.js` — Filter-Regex, Timestamp-Erkennung, Stack-Trace-Limit
- `server/emailService.js` — SMTP, Buffer (max 100/Label), Dedup, Timer
- `server/analysisService.js` — Log-Analyse mit Streaming
- `server/watchService.js` — Chokidar Watcher, Preload, processNewLines
- `server/httpRouter.js` — Alle HTTP-Routes + Markdown-Converter + Static Files
- **server.js: 1825 → 188 Zeilen** (90% Reduktion, nur noch Glue-Code)

**Phase 3 — Frontend-Module (9 Module):**
- Monolithische `app.js` (~1720 Zeilen) aufgeteilt in 9 Module unter `public/js/`
- `window.Keasy`-Namespace-Pattern: `Keasy.state`, `Keasy.utils`, `Keasy.render`, etc.
- IIFE-Wrapper `(function() { ... })();` für eigenen Scope pro Modul (verhindert `const`-Konflikte im globalen lexikalischen Scope)
- Alle onclick-Handler-Funktionen auf `window` exportiert (Inline-onclick-Kompatibilität)
- Ladereihenfolge: utils → state → render → actions → configPanel → analyzePanel → trashPanel → wsClient → boot (alle `defer`)

**Phase 4 — Rendering optimieren:**
- `requestAnimationFrame`-Batching in `wsClient.js`: Bei vielen schnellen WS-Nachrichten wird nur einmal pro Frame gerendert (`scheduleRender()`)

**Phase 5 — Cleanup & Hardening:**
- emailBuffer-Limit: Max 100 Fehler pro Label, älteste werden verworfen
- CSS-Cleanup: Doppelte `@keyframes fadeIn` → Toast-Variante umbenannt in `fadeInToast`

### 2026-05-09 — UI/UX-Überarbeitung Einstellungen

**Allgemein-Tab Redesign:**
- Linke Spalte mit Titel "🖥️ Monitor & Dateien" und 3 thematischen Gruppen (Server, Dateien & Fehler, Papierkorb) in grauen Boxen
- Rechte Spalte mit grauem Hintergrund: 🤖 Copilot-Export, ⚠️ Fehlererkennung (Filter-Patterns), 🗑️ Papierkorb
- Checkboxen mit eigenem kompaktem Layout (Label klickbar, engerer Abstand)
- Numerische Eingabefelder begrenzt: Port 5 Zeichen, Max. Fehler/Log-Größe 3 Zeichen, Papierkorb 3 Zeichen — nur Zahlen erlaubt
- Neustart-Hinweis direkt in Server-Gruppe statt global am Ende
- Einheitliche Input-Breiten (`flex: 1`, `max-width: 350px`)

**Filter-Tab aufgelöst:**
- Filter-Patterns in rechte Spalte des Allgemein-Tabs integriert als eigene Sektion "⚠️ Fehlererkennung"
- Pattern-Liste mit `max-height: 200px` und Scrollbar bei vielen Einträgen
- Ein Tab weniger in der Navigation

**Tab-Reihenfolge & Icons:**
- Neue Reihenfolge: ⚙️ Allgemein · 🕵️ WatchPaths · ✉️ E-Mail · 📧 E-Mail Log · 🎨 CSS-Style · 📂 Log-Analyse · 🗄️ Backup · 🧪 System-Check · 📖 Dokumentation
- Alle Tabs haben jetzt passende Icons (Detektiv 🕵️ für WatchPaths = "Augen offen halten")

### 2026-05-09 — Clipboard & Copilot-Export pro Fehler-Eintrag

**Feature: 📋 Fehler kopieren & 🤖 Copilot-Export**
- Zwei neue Buttons pro Fehler-Eintrag neben "↗ Zeile öffnen"
- **📋 Clipboard:** Fehlertext per Klick in die Zwischenablage kopieren (async mit Fehlerbehandlung)
- **🤖 Copilot-Export:** Fehler als `copilot-error-context.md` in konfiguriertes Verzeichnis exportieren
  - Markdown-Datei mit Quelle, Dateipfad, Zeitstempel und Fehlertext (fenced code block)
  - Serverseitige Pfad-Validierung (existiert, isDirectory)
  - Doppelklick-Schutz (Button disabled während Request)
- Toast-Feedback über bestehendes Status-Pattern (Erfolg/Fehler)
- ARIA-Labels für Screenreader-Unterstützung
- Responsive: 36px Touch-Targets auf Mobile
- Config: `copilotWorkingPath` in config.js + Config-GUI (Tab "Allgemein")
- Dual-Export: 🤖 Develop + 🚀 Release (grün) — zwei separate Pfade konfigurierbar
- Index-basierter Fehler-Lookup aus State (sicher für mehrzeilige Stack-Traces)

### 2026-05-09 — Bugfix: Button-States nach Monitor-Beendigung

- **Fix:** "Watcher neu starten"-Button blieb nach "Monitor beenden" aktiv/klickbar
- **Ursache:** `setTimeout` in `restartWatcher()` aktivierte Button nach 2s bedingungslos, überschrieb `disabled`
- **Lösung:** `serverStopped`-Guard als Early-Return und im setTimeout-Callback
- **CSS:** Globale `.header-btn:disabled`-Regel (`opacity: 0.4`, `pointer-events: none`) für einheitliches Disabled-Styling aller Header-Buttons

### 2026-05-09 — Papierkorb für gelöschte Protokolle

**Feature: 🗑️ Papierkorb (WatchPath)**
- Gelöschte Live-Monitoring-Einträge (per Source oder alle) werden in einen Papierkorb verschoben statt endgültig gelöscht
- Gilt nur für Live-Monitoring — Analyse-Ergebnisse haben keinen Papierkorb (Wiederherstellung durch erneute Analyse)
- Batch-basiertes Modell: Jeder Löschvorgang wird als Batch mit Zeitstempel gespeichert
- Wiederherstellen pro Quelle/Label oder alle auf einmal (ohne E-Mail-Benachrichtigungen auszulösen)
- Endgültig löschen pro Quelle oder Papierkorb komplett leeren (mit Bestätigungsdialog)
- Auto-Cleanup: Einträge älter als `trashAutoCleanupHours` (Standard: 48h) werden automatisch entfernt
- Eviction: Bei >1000 Einträgen werden älteste Batches automatisch entfernt
- Eigener Bereich unter den Live-Fehlern im Dashboard, standardmäßig eingeklappt
- Relative Zeitanzeige ("gelöscht vor 2h") mit minütlichem Update
- WebSocket-Sync: `trash-snapshot` mit Revision-Counter für Multi-Client-Konsistenz
- Copy-then-remove Atomizität: Erst in Trash kopieren, dann aus errorStore entfernen
- Lock-basierte Serialisierung von Cleanup/Restore Operationen
- Config-GUI: Auto-Cleanup-Stunden konfigurierbar im Tab "Allgemein"
- Responsive Layout mit 44px Touch-Targets, Danger-Styling für destruktive Aktionen

### 2026-05-09 — Review-Fixes Log-Analyse

**Code-Review Fixes:**
- Button-States: Start/Cancel-Buttons werden erst nach erfolgreicher Server-Antwort umgeschaltet
- Clear während laufender Analyse bricht diese automatisch ab
- Feedback bei 0 gefundenen Dateien und übersprungenen Pfaden
- Theme-Selektoren korrigiert (`body.theme-*` statt `[data-theme]`)
- HTML-Escaping für Pfade in der Pfad-Liste (XSS-Schutz)
- `runAnalysis()` für neues `collectLogFiles()`-Rückgabeformat angepasst
- `analyzeFile()` nutzt nun `parseLogEntries()` mit Batch-Verarbeitung
- Stream-Abort bei `maxErrors` erreicht (`rl.close()` + `stream.destroy()`)
- Datei-Deduplizierung mit `path.resolve().toLowerCase()` + Set
- Server sendet `analyzeRunning`-Status beim Reconnect
- Disable-Logik für Start/Clear-Buttons (kein Klick ohne Pfade/Ergebnisse)

**Analyse-Verbesserungen:**
- Analyse-Ergebnisse werden unabhängig vom Datumsfilter (Von/Bis) angezeigt, aber Zeitfilter-Buttons (1h–12h) wirken auch auf Analyse
- Pfad-Validierung: Server prüft ob Pfad existiert bevor er hinzugefügt wird (inkl. UNC-Pfade)
- Analyse-Pfade + Max-Fehler werden in Config gespeichert (💾 eigener Save-Button)
- Einstellungsfenster klappt bei Analyse-Start automatisch zu
- Enter-Taste zum Hinzufügen von Pfaden

### 2026-05-08 — Bestehende Fehler beim Start einlesen

**Feature: 📂 Log-Analyse (LogChecker)**
- Einmalige Analyse von Log-Dateien ohne Watcher — zum Auswerten historischer Logs oder Anwender-Logs
- Neuer Tab "📂 Log-Analyse" in Einstellungen: Pfade (Datei/Ordner) hinzufügen, Analyse starten/abbrechen
- Eigener `analyzeStore` getrennt vom Live-`errorStore` — kein Einfluss auf Live-Monitoring
- Streaming-Read per `createReadStream` + `readline` — große Dateien blockieren den Server nicht
- Parser-Refactoring: `parseLogEntries(text, { flushFinal })` als reine Funktion extrahiert
- Fortschrittsbalken im Analyse-Tab (X/Y Dateien, Z Fehler)
- Eigenes Fehler-Limit pro Datei (Standard: 100, konfigurierbar)
- Analyse-Quellen visuell getrennt im Dashboard (grauer Header statt blau)
- Kein Pause/Resume, keine E-Mail-Benachrichtigung für Analyse-Quellen
- API: `POST /api/analyze-logs`, `POST /api/analyze-cancel`, `POST /api/analyze-clear`, `GET /api/analyze-errors`

**Feature: Preload existierender Fehler**
- Beim Start werden vorhandene Fehler aus heutigen Log-Dateien automatisch geladen
- Globaler Preload-Coordinator: Sequentielle, nicht-blockierende Verarbeitung über `setImmediate()`-Queue
- Dateien über dem konfigurierbaren Größenlimit (1–99 MB, Standard: 6 MB) werden übersprungen
- Dashboard-Fortschrittsbalken mit aggregierter Prozentanzeige über alle Watcher
- WebSocket-Events: `preload-start` → `preload-progress` (gedrosselt auf max. 1x/500ms) → `preload-done`
- Konfigurierbar unter Einstellungen → Allgemein (`loadExistingErrors`, `maxLogFileSizeMB`)

**Technische Details:**
- `initialScanDone`-Flag pro Watcher: Unterscheidet initiale Datei-Erkennung (→ Preload-Queue) von Runtime-Erkennung (→ normales Tailing)
- `preloadGeneration`-Counter: Race-Condition-sicher bei Config-Änderungen während des Preloads
- `skipPreload`-Option für Netzwerk-Polling-Watcher verhindert Doppelregistrierung
- Alle Watcher müssen `ready` melden (oder 5s-Fallback-Timer) bevor Preload startet
- Responsive CSS für Banner und Config-Felder (≤600px Breakpoint)
- Theme-kompatible CSS-Variablen (`--bg-secondary`, `--text-primary`, `--bg-tertiary`)

**Verbesserung: Datumsfilter-Validierung**
- "Bis"-Datum kann nicht mehr vor "Von"-Datum liegen (wird automatisch korrigiert)
- "Alle löschen" bei Standard-Datum (heute) löscht tatsächlich alles — Datumsfilter greift nur bei manuell geändertem Zeitraum

**Feature: Such-Shortcut (Strg+K)**
- `Strg+K` springt ins Suchfeld und selektiert vorhandenen Text (sofort losschreiben möglich)
- `Escape` leert die Suche und verlässt das Suchfeld
- Tooltip und Placeholder-Hint zeigen die Shortcuts an

**Feature: Stundenfilter (Quick-Filter-Buttons)**
- Buttons `1h`, `2h`, `4h`, `6h`, `12h`, `Heute` in der Steuerleiste neben dem Datumsfilter
- Filtert Fehler auf die letzten X Stunden — aktiver Button ist farblich hervorgehoben
- Bei Änderung des Datums-Pickers wird automatisch auf "Heute" zurückgesetzt
- Tooltips erklären die jeweilige Funktion

**Verbesserung: UI-Fixes**
- "Neueste"-Button entfernt (war im Header oben nicht erreichbar beim Runterscrollen)
- Fehler-Badge (`source-badge`) hat feste Mindestbreite (36px) — Layout verschiebt sich nicht mehr bei ein- vs. zweistelligen Zahlen

**Feature: Live CSS-Editor**
- Neuer Tab "🎨 CSS-Style" in den Einstellungen mit Live-Vorschau
- `<style id="live-style">` im DOM nach dem CSS-Link — CSS-Kaskade überschreibt gespeicherte Styles in Echtzeit
- Buttons: Speichern (erstellt `style.css.bak` Backup), Zurücksetzen, Standard wiederherstellen (`style.default.css`)
- `style.default.css` wird beim ersten Serverstart als unveränderliche Sicherungskopie erstellt
- Dirty-Warnung bei Tab-Wechsel mit ungespeicherten Änderungen
- Speichern-Button ist deaktiviert bis tatsächlich Änderungen vorgenommen werden
- Config-Buttons (Speichern/Zurücksetzen) werden in CSS-/Doku-/E-Mail-Log-Tabs ausgeblendet — nur die tab-eigenen Aktionen sind sichtbar
- Mindestlänge-Validierung beim Speichern (Schutz vor versehentlichem Leeren)
- HTTP-Statusprüfung (`resp.ok`) bei allen CSS-API-Aufrufen
- Speichern-Button ist deaktiviert bis tatsächlich Änderungen vorgenommen werden
- Config-Buttons (Speichern/Zurücksetzen) werden in CSS-/Doku-/E-Mail-Log-Tabs ausgeblendet

**Bugfixes aus Code-Review (Markus, Sandra, Lisa):**
- UTC-Datum durch lokales Datum ersetzt (`getLocalDateStr()`) — korrektes "heute" auch nach Mitternacht in deutscher Zeitzone
- Stundenfilter wird beim Löschen berücksichtigt: `cutoff`-Timestamp an Server gesendet und per WebSocket-Broadcast an alle Clients weitergeleitet → nur sichtbare Einträge werden gelöscht
- Stundenfilter/Datumsfilter Interaktion bereinigt: Stundenfilter setzt Datum auf heute, "Heute"-Button nur aktiv wenn Datum tatsächlich heute, kein Button aktiv bei Custom-Range
- CSS-Editor prüft HTTP-Status vor Verwendung der Response (verhindert Fehlertexte als CSS)

**Verbesserung: Dynamischer Löschen-Button**
- Button-Text wechselt automatisch: "🗑️ Alle löschen" → "🗑️ Sichtbare löschen" wenn Stundenfilter oder Datumsfilter aktiv
- Tooltip passt sich ebenfalls an

---

### 2026-05-07 — E-Mail-Benachrichtigung & Dashboard-Konfiguration

**Feature: E-Mail-Versand bei Fehlern**
- Gesammelter E-Mail-Versand per SMTP pro Quelle mit konfigurierbarem Countdown-Timer
- Duplikat-Erkennung mit Schutzzeit verhindert Spam
- E-Mail-Log im Dashboard einsehbar und löschbar
- Logging aller E-Mail-Aktivitäten in `email.log` (max. 500 Zeilen, Rotation beim Start)

**Feature: Einstellungen im Dashboard**
- Alle Config-Werte direkt im Browser bearbeiten (SMTP, Filter, Pfade, Allgemein)
- Live-Übernahme ohne Server-Neustart
- Config-Datei wird automatisch aktualisiert

**Feature: Dokumentation im Dashboard**
- README als formatiertes HTML mit einklappbaren Sektionen direkt im Dashboard

---

### 2026-05-06 — Erweiterte Überwachung & Bedienkomfort

**Feature: Polling als Standard**
- Alle Pfade werden per Polling überwacht (2s lokal, 5s Netzwerk) — zuverlässiger als `fs.watch` auf Windows/Netzlaufwerken
- Pro WatchPath mit `usePolling: false` deaktivierbar

**Feature: Watcher-Management**
- FileWatcher über Dashboard neu starten (ohne Server-Neustart)
- Auto-Port-Recovery bei belegtem Port (alter Prozess wird beendet)
- Intelligentes Debouncing: Mehrfache Datei-Events zusammengefasst (100ms)

**Feature: Suche mit Wildcards**
- Volltextsuche mit `*`-Wildcard — klappt automatisch nur Quellen mit Treffern auf

**Feature: Debug-Logging**
- Timing-Analyse per Checkbox aktivierbar (zeigt `[TIMING]`-Einträge in Server-Konsole)

---

### 2026-05-05 — Kernfunktionalität

**Initiales Release: Echtzeit-Log-Monitor**
- Live-Updates über WebSocket — Fehler erscheinen sofort im Browser
- Multi-Log-Überwachung beliebig vieler Dateien gleichzeitig
- Gruppierung nach konfigurierbarem Label (z.B. "MAD Dienst", "VFMService Dienst")
- Konfigurierbare Filter-Pattern (Exception, #Fehler, disposed, ...)
- Multi-Line-Erkennung: Mehrzeilige Log-Einträge als ein Fehler gruppiert (Timestamp-Erkennung, Stack-Trace-Pufferung)
- Stack-Trace-Limit: Begrenzung auf 5 Zeilen
- Tagesaktuelle Dateien: Nur heutige Log-Dateien aktiv, ältere bei Beschreibung automatisch aktiviert
- Zeitraum-Filter mit Datepicker (Von/Bis), Auto-Update um Mitternacht
- Theme-Auswahl (Hell, Dunkel, Blau) — Auswahl wird gespeichert
- Ordner/Datei öffnen im Explorer bzw. Editor
- In Zeile springen (VS Code → Notepad++ → Notepad)
- Desktop-Notification bei neuen Fehlern (Throttling: max. 1/10s)
- Pause/Resume pro Quelle
- Einträge löschen pro Quelle (berücksichtigt Datumsfilter)
- Monitor beenden über Dashboard
- Einklappbare Sektionen (Zustand gespeichert)
- Versionierung per Datums-Zeitstempel in `package.json`

---

## Architektur

```
┌─────────────────────┐
│  Log-Dateien        │  chokidar überwacht auf Änderungen
│  (*.log)            │  (Polling alle 2s lokal, 5s Netzwerk)
└────────┬────────────┘
         │ Datei geändert (Debounce: 100ms)
         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Node.js Server (server.js — ~380 Zeilen Glue-Code)              │
│                                                                  │
│  server/                                                         │
│  ├─ runtimeStore.js       State: Maps, Sets, Flags               │
│  ├─ configStore.js        Config Proxy, Hot-Reload               │
│  ├─ wsBroadcast.js        WebSocket-Broadcast (Label-Filter)     │
│  ├─ watchService.js       Watcher, Preload, Gap-Erkennung,       │
│  │                        Erreichbarkeit + Auto-Recovery         │
│  ├─ logParser.js          Filter, Timestamp, Gap, StackTrace     │
│  ├─ emailService.js       SMTP, Buffer, Dedup, Timer             │
│  ├─ trashService.js       Papierkorb, Batches, Eviction          │
│  ├─ analysisService.js    Log-Analyse, Streaming, Gaps           │
│  ├─ backupService.js      Backup/Restore, FTP, Rotation,         │
│  │                        Komplett-Backup, Zeitplan              │
│  ├─ healthCheck.js        System-Check (read-only)               │
│  ├─ sessionMiddleware.js  Sessions, Auth-Guards                  │
│  ├─ userStore.js          Benutzer (bcrypt, users.json)          │
│  ├─ userConfigStore.js    Per-User-Einstellungen                 │
│  ├─ markdownHelper.js     README → HTML (Doku-Tab)               │
│  ├─ parseJsonBody.js      JSON-Body-Parser (1-MB-Limit)          │
│  ├─ httpRouter.js         Dispatcher, Static Files,              │
│  │                        Auth-/Admin-Routen-Guards              │
│  └─ routes/               auth, config, backup, analysis,        │
│                           process, trash, user                   │
└────────┬─────────────────────┬───────────────────────────────────┘
         │ WebSocket           │ SMTP (alle X Min.)
         ▼                     ▼
┌─────────────────────────────────┐  ┌─────────────────┐
│  Browser Dashboard              │  │  E-Mail an      │
│  public/                        │  │  Empfänger      │
│  ├─ index.html                  │  └─────────────────┘
│  ├─ style.css                   │
│  └─ js/                         │
│     ├─ boot.js                  │  Init, Filter, Theme
│     ├─ state.js                 │  Keasy.state Objekt
│     ├─ utils.js                 │  Hilfsfunktionen
│     ├─ wsClient.js              │  WebSocket, rAF-Batching, Banner
│     ├─ render.js                │  DOM-Rendering (Live/Gaps/Analyse)
│     ├─ actions.js               │  User-Aktionen
│     ├─ errorIndexPanel.js       │  Fehler-Index (Sprungliste)
│     ├─ loginPanel.js            │  Login, Rollen (data-admin-only)
│     ├─ configPanel.js           │  Einstellungen (Koordinator)
│     ├─ watchPathsPanel.js       │  WatchPaths-Tabelle inkl. Gaps
│     ├─ thresholdPanel.js        │  Schwellwert-Regeln
│     ├─ analyzePanel.js          │  Log-Analyse UI
│     ├─ trashPanel.js            │  Papierkorb UI
│     ├─ backupPanel.js           │  Backup: Status, Zeitplan, FTP
│     ├─ backupTargetsPanel.js    │  Lokale Backup-Ziele
│     ├─ backupRestorePanel.js    │  Backup-Liste, Restore
│     ├─ cssEditorPanel.js        │  Live CSS-Editor
│     ├─ docsPanel.js             │  Doku-Anzeige + Markdown-Editor
│     ├─ systemCheckPanel.js      │  System-Check UI
│     ├─ userPanel.js             │  Benutzerverwaltung
│     ├─ folderPicker.js          │  Ordner-Auswahl-Dialog
│     └─ confirmDialog.js         │  Bestätigungs-Dialoge
└─────────────────────────────────┘
```

## Dependencies

| Paket | Zweck |
|---|---|
| `chokidar` | Datei-Watcher für Log-Dateien |
| `ws` | WebSocket-Server für Live-Updates |
| `open` | Browser automatisch öffnen |
| `nodemailer` | E-Mail-Versand per SMTP |
| `archiver` | Backup-ZIPs erstellen (Settings- und Komplett-Backup) |
| `adm-zip` | Backup-ZIPs lesen/validieren (Restore-Preview, Inhaltsanzeige) |
| `basic-ftp` | FTP/FTPS-Upload und -Verwaltung der Backups |
| `bcryptjs` | Passwort-Hashing für das Rechtesystem |
