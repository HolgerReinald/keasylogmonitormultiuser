# Keasy Log Monitor (Multiuservariante mit Rechten aktivierbar)

## Hinweis Multiuservariante (Rechte)
Diese Version ist nicht dazu gedacht lokal auf seinem PC einzusetzen. Deshalb werden die überwachten Pfade vom Admin freigegeben. Man kann aber selbst entscheiden, an welche E-Mail-Adresse die Überwachung "E-Mail an" gehen soll.

## Lokales Echtzeit-Monitoring-Dashboard für Keasy Log-Dateien
Überwacht mehrere Log-Dateien gleichzeitig und zeigt Fehler live im Browser an.  
Neue Fehler erscheinen typischerweise nach **~4,3s** (2s Polling + 100ms Debounce + 2,2s Stack-Trace-Pufferung). Polling ist Standard für alle Pfade (2s lokal, 5s Netzwerk), da Windows `fs.watch` Events verschlucken kann. Die Stack-Trace-Pufferung wartet bewusst länger als das Polling-Intervall (pollInterval + 200ms), damit mehrzeilige Einträge über Poll-Zyklen hinweg korrekt zusammengefasst werden.
Die Dokumentation wird über die Funktion update_docs (Extension) über die Konsole aktualisiert mit Versions Historie und Versionsnummer (nach Neustart).
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

- **Pfade:** Einzelne `.log`-Dateien oder ganze Ordner (werden rekursiv nach `.log`-Dateien durchsucht)
- **Streaming:** Große Dateien werden zeilenweise gelesen — der Server bleibt responsiv
- **Fehler-Limit:** Pro Datei max. 100 Fehler (konfigurierbar), verhindert Überflutung bei sehr großen Logs
- **Abbruch:** Analyse kann jederzeit abgebrochen werden
- **Löschen:** Pro Quellgruppe einzeln löschbar (🗑️-Button im Header) oder alle auf einmal (Config-Panel)
- **Zeitfilter:** Die Buttons 1h/2h/4h/6h/12h filtern auch Analyse-Ergebnisse (Datumsfilter Von/Bis nicht, da Analyse historische Daten enthält)

## Features

- **Live-Updates:** Fehler erscheinen sofort im Browser (WebSocket)
- **Multi-Log:** Überwacht beliebig viele Log-Dateien gleichzeitig
- **Gruppiert nach Quelle:** Fehler werden nach konfigurierbarem Label gruppiert (z.B. "MAD Dienst", "VFMService Dienst")
- **Filterbar:** Konfigurierbare Pattern (Exception, #Fehler, disposed, ...)
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
- **E-Mail-Benachrichtigung:** Gesammelter E-Mail-Versand per SMTP pro Quelle mit Countdown-Timer
- **Einklappbare Sektionen:** Quellen und Dateigruppen ein-/ausklappbar (Zustand wird gespeichert)
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
- **🤖 Copilot-Export:** Fehler als `copilot-error-context.md` in ein konfiguriertes Verzeichnis exportieren — für direkte Übergabe an GitHub Copilot CLI. Zwei Ziele: 🤖 Develop + 🚀 Release (grün)
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

Klick auf **⚙️ Einstellungen** im Header öffnet ein einklappbares Panel mit neun Tabs:

| Tab | Einstellungen |
|---|---|
| **⚙️ Allgemein** | Linke Spalte: Server (Port, Browser auto-öffnen, Debug-Logging), Dateien & Fehler (Max. Fehler, Datei-Pattern, Bestehende Fehler einlesen, Max. Log-Dateigröße). Rechte Spalte: 🤖 Copilot-Export (Develop + Release Pfade), ⚠️ Fehlererkennung (Filter-Patterns verwalten), 🗑️ Papierkorb (Auto-Cleanup) |
| **🕵️ WatchPaths** | Überwachte Verzeichnisse hinzufügen/entfernen mit Label, E-Mail-Empfänger und Polling-Option |
| **✉️ E-Mail** | SMTP-Konfiguration, Intervall, Duplikatschutz, Absender, Betreff |
| **📧 E-Mail Log** | E-Mail-Versandprotokoll einsehen, aktualisieren und löschen |
| **🎨 CSS-Style** | Live CSS-Editor mit Vorschau, Speichern und Zurücksetzen |
| **📂 Log-Analyse** | Analyse-Pfade verwalten, Analyse starten/abbrechen |
| **🗄️ Backup** | Beliebig viele lokale Ziele (Multi-Local) + FTP mit Hybrid-Labels (📁/☁️/💾/✏️), Zeitplan, Rotation, optionales Komplett-Backup des Programmverzeichnisses, Restore mit Preview und Bestätigungsdialog |
| **🧪 System-Check** | Read-only Health-Checks (HTTP, WebSocket, Config, Dateisystem, Backup, E-Mail) mit Live-Ergebnissen |
| **📖 Dokumentation** | README als formatiertes HTML mit einklappbaren Sektionen |

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
  maxErrorsPerFile: 10,

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
    { path: 'X:\\', label: 'VFMService Dienst', emailTo: null }
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

  contextLinesBefore: 5,
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
| `analyzeGapWarnSeconds` | ⏱️ Gap-Warnung für die Log-Analyse (Sek., `0` = aus). Nie konfiguriert = Richtwert `20` |
| `analyzeGapIdleMinutes` | Leerlauf-Grenze für die Log-Analyse (Min., leer = `30`) |
| `filePattern` | Glob-Pattern für Dateinamen (z.B. `*.log`, `KeasyServer*.log`) |
| `filterPatterns` | Array von Suchbegriffen (case-insensitive) |
| `excludePatterns` | Array von Suchbegriffen (case-insensitive). Zeilen, die hierauf matchen, gelten **nicht** als Fehler – auch wenn sie ein `filterPatterns`-Pattern enthalten (z.B. `ValidationException` als Anwender-Hinweis). Leer = kein Ausschluss. Patterns spezifisch halten, sonst werden echte Fehler unterdrückt |
| `maxErrorsPerFile` | Wie viele letzte Fehler pro Datei angezeigt werden |
| `loadExistingErrors` | Bestehende Fehler aus heutigen Log-Dateien beim Start einlesen (Standard: `true`) |
| `maxLogFileSizeMB` | Max. Dateigröße für das Einlesen bestehender Fehler in MB (Standard: `6`). Größere Dateien werden nur ab dem Startzeitpunkt überwacht |
| `trashAutoCleanupHours` | Papierkorb Auto-Cleanup nach X Stunden (Standard: `48`). `0` = nie automatisch leeren |
| `copilotWorkingPathDevelop` | Pfad zum Develop-Verzeichnis für Copilot-Export. Leer = 🤖-Button deaktiviert |
| `copilotWorkingPathRelease` | Pfad zum Release-Verzeichnis für Copilot-Export. Leer = 🚀-Button deaktiviert |
| `autoOpen` | Browser automatisch öffnen (true/false) |
| `email.enabled` | E-Mail-Versand global ein/aus |
| `email.intervalMinutes` | Alle X Minuten werden gesammelte Fehler versendet |
| `email.deduplicateMinutes` | Duplikatschutz: gleicher Fehler erst nach X Min. erneut melden (Standard: 60) |
| `email.smtp` | SMTP-Server-Konfiguration (Host, Port, SSL, Auth, family) |
| `email.smtp.family` | `4` = IPv4 erzwingen, `6` = IPv6 erzwingen (optional, bei Netzwerkproblemen) |
| `email.from` | Absender-Adresse (muss zur SMTP-Login-Domain passen!) |
| `email.subject` | Betreff-Template (`{label}` wird durch den Quellnamen ersetzt) |

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
| 🤖 Develop | Fehler als `copilot-error-context.md` ins Develop-Verzeichnis exportieren |
| 🚀 Release | Fehler als `copilot-error-context.md` ins Release-Verzeichnis exportieren (grün) |

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
3. **Fehler-Limit** anpassen (Standard: 100 pro Datei)
4. **🔍 Analyse starten** — Fortschrittsbalken zeigt `X/Y Dateien (Z Fehler gefunden)`
5. **⏹ Abbrechen** — stoppt die laufende Analyse sofort
6. **Ergebnisse** erscheinen unterhalb der Live-Fehler im Dashboard mit grauem Header (📂-Prefix)
7. **🗑️ Pro Quelle löschen** — jede Analyse-Quellgruppe hat einen eigenen Lösch-Button im Header
8. **🗑️ Alle Ergebnisse löschen** — im Config-Panel: entfernt alle Analyse-Ergebnisse auf einmal
9. **Zeitfilter** — die Buttons 1h/2h/4h/6h/12h filtern auch Analyse-Ergebnisse (Von/Bis-Datum nicht)
10. **Kein Papierkorb** — Analyse-Ergebnisse werden direkt gelöscht (Wiederherstellung durch erneute Analyse)

| Button | Verfügbar wenn |
|---|---|
| 🔍 Analyse starten | Mindestens ein Pfad vorhanden, keine Analyse läuft |
| ⏹ Abbrechen | Analyse läuft |
| 🗑️ Ergebnisse löschen | Ergebnisse vorhanden, keine Analyse läuft |

> **Papierkorb:** Der Papierkorb (WatchPath) gilt nur für Live-Monitoring-Einträge. Analyse-Ergebnisse haben keinen Papierkorb — sie können jederzeit durch erneute Analyse wiederhergestellt werden.

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
| E-Mail-Duplikate | Gleicher Fehler wird erst nach `deduplicateMinutes` (Standard: 60 Min.) erneut gemeldet |
| "In Zeile springen" geht nicht | Versucht VS Code → Notepad++ → Notepad. VS Code oder Notepad++ sollte installiert sein für Zeilensprung |
| Netzlaufwerk: Keine Fehler | Polling ist Standard. Falls deaktiviert: Einstellungen → WatchPaths → Polling ✓ |
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
