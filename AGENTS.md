# Keasy Log Monitor – Projekt-Instruktionen für KI

## Architektur

Single-Page Node.js App: Express-Server (`server.js`) + statisches Frontend (`public/`).
Kein Build-System, kein Bundler, kein TypeScript – alles Vanilla JS mit `defer`-Scripts.

### Verzeichnisstruktur
```
server/           → Express-Backend (Routes, Services, Config)
public/           → Frontend (index.html, style.css, js/*.js)
public/js/        → Module als globale Funktionen (kein import/export)
scripts/          → Build/Dev-Hilfsskripte (update-docs.js etc.)
```

## Verfügbare Utility-Funktionen

### Frontend-Globals (public/js/)

| Funktion | Datei | Beschreibung |
|----------|-------|--------------|
| `showConfirm(message, opts?)` | `confirmDialog.js` | **Custom Confirm-Dialog** (Promise<boolean>). Immer statt `confirm()` verwenden! |
| `showConfigMessage(text, type)` | `configPanel.js` | Status-Nachricht im Config-Panel anzeigen |
| `showToast(message, type)` | `utils.js` | Toast-Notification (success/error/info/warn) |
| `markConfigDirty()` | `configPanel.js` | Save-Button aktivieren bei Config-Änderungen |
| `buildConfigFromForm()` | `configPanel.js` | Vollständige Config aus aktuellem Formular-State bauen |
| `renderAll()` | `render.js` | Fehler-Liste komplett neu rendern |
| `escapeHtml(str)` | `utils.js` | HTML-Entities escapen |
| `escapeJs(str)` | `utils.js` | JS-String escapen |
| `getLocalDateStr(date?)` | `utils.js` | Datum als YYYY-MM-DD |
| `formatSize(bytes)` | `utils.js` | Bytes → human-readable |
| `formatTimeAgo(date)` | `utils.js` | Relative Zeitangabe |
| `highlightPatterns(text)` | `utils.js` | Filter-Patterns hervorheben |
| `highlightSearch(text)` | `utils.js` | Suchbegriff hervorheben |

### Namespaces
- `Keasy.state` — globaler App-State (`state.js`)
- `Keasy.utils` — Utility-Funktionen
- `Keasy.backup` — Backup-Panel Fassade
- `Keasy.backup.targets` — Backup-Ziele Modul
- `Keasy.watchPaths` — Watch-Paths Modul
- `Keasy.threshold` — Schwellwert-Regeln Modul

## ⚠️ Regeln & Anti-Patterns

### VERBOTEN (häufige Fehler!)
1. **NIEMALS `confirm()` verwenden** → Immer `await showConfirm(message)` nutzen
2. **NIEMALS Config per fetch→patch→save speichern** → Config immer über `buildConfigFromForm()` aus dem DOM bauen (verhindert Race-Conditions)
3. **KEINE `alert()` Aufrufe** → `showToast()` oder `showConfigMessage()` verwenden
4. **Kein `var`** → `const` / `let` verwenden
5. **Kein ES-Module-Syntax** (`import`/`export`) → Alles sind globale Funktionen mit `defer`-Scripts

### BEVORZUGT
- **CSS-Variablen nutzen** (`var(--bg-primary)`, `var(--accent)` etc.) statt feste Farbwerte
- **Theme-Support**: Beide Themes (light/dark) berücksichtigen
- **Event-Delegation** in `boot.js` für dynamische Elemente
- **`_populatingForm`-Guard** beim programmatischen Setzen von Formular-Werten (verhindert dirty-Markierung)
- **Config-Änderungen**: `markConfigDirty()` aufrufen bei User-Interaktion

## Script-Ladereihenfolge (index.html)
```
confirmDialog.js → utils.js → state.js → render.js → actions.js →
docsPanel.js → cssEditorPanel.js → watchPathsPanel.js → thresholdPanel.js →
configPanel.js → analyzePanel.js → backupTargetsPanel.js → backupRestorePanel.js →
backupPanel.js → systemCheckPanel.js → trashPanel.js → wsClient.js → boot.js
```
boot.js initialisiert alles — Event-Listener, Theme, WebSocket-Verbindung.

## Versionierung & Dokumentation
- `package.json` Version: `YYYY.MM.DD-HH:MM` Format
- `README.md` enthält Historie aller Änderungen
- Tool `update_docs` nutzen zum Aktualisieren (bumpt Version + README-Eintrag)

## Tests
- Keine automatisierten Unit-Tests vorhanden
- Smoke-Tests werden manuell / visuell durchgeführt
- Änderungen immer im Browser testen

## Einsatz & Security-Kontext

**Dieses Tool wird ausschließlich hausintern im lokalen Netzwerk eingesetzt.**

- Läuft auf `localhost` bzw. im Firmennetz — kein öffentlicher Zugang
- Benutzer sind bekannte Mitarbeiter, kein öffentliches Registrieren
- **Kein CSRF-Schutz nötig** (kein öffentliches Internet, SameSite=Strict reicht)
- **Kein Rate-Limiting nötig** (vertrauenswürdige Umgebung)
- **Kein Audit-Logging nötig** (interne Nutzung, kein Compliance-Bedarf)
- Security-Reviews bitte **pragmatisch** halten: Schutz vor versehentlichem Fehlbedienen > Schutz vor bösartigen Angreifern
- Ziel ist **Usability und klare Rollenverteilung** (Admin vs. User), nicht Enterprise-Grade Security
