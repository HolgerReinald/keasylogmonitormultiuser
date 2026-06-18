# Plan: Labels/Bezeichnungen über GUI änderbar

## Problem
Alle UI-Texte (Button-Labels, Überschriften, Tooltips, Statusmeldungen) sind hartcodiert in HTML und JavaScript. Es gibt keine Möglichkeit, Bezeichnungen anzupassen — weder über die Oberfläche noch über eine Konfigurationsdatei.

## Bestandsaufnahme
Das UI enthält ca. **150+ verschiedene Texte**, verteilt auf:
- `public/index.html`: ~80 statische Labels, Buttons, Tooltips, Platzhalter
- `public/js/render.js`: ~30 dynamisch generierte Texte (Fehler-Einträge, Quell-Header, Papierkorb)
- `public/js/actions.js`: ~15 Toast-/Status-Meldungen
- `public/js/backupPanel.js`: ~25 Backup-spezifische Texte
- `public/js/configPanel.js`: ~20 Config-Panel-Texte
- `public/js/boot.js`: ~10 Filter/Status-Texte

## Vorgeschlagene Lösung: Overlay-Bearbeitungsmodus

### UX-Konzept (nach Review überarbeitet)

Statt unsichtbarem Doppelklick-Editing → **expliziter Bearbeitungsmodus** mit Toggle-Button:

#### Aktivierung (2-stufig)
1. **Feature-Freigabe:** `config.js` → `labelEditMode: true` (Standard: `false`, unsichtbar)
2. **Modus-Toggle:** Wenn freigeschaltet, erscheint ein **✏️-Button** im Header. Klick aktiviert/deaktiviert den Edit-Modus.

#### Edit-Modus aktiv
- **Top-Banner:** Gelber Hinweisbalken „✏️ Label-Bearbeitungsmodus aktiv — Klick auf ein Label zum Bearbeiten | Esc: Modus beenden"
- **Visuelle Markierung:** Alle editierbaren Labels bekommen Rahmen + Edit-Cursor + dezentes ✏️-Icon bei Hover
- **Einfacher Klick** öffnet Inline-Editor (statt Doppelklick — besser auffindbar, touch-kompatibel)
- **Enter** speichert, **Escape** bricht ab (kein Blur-Speichern)
- **Toast-Feedback** nach Speichern

#### Mini-Inspector für unsichtbare Texte
Beim Klick auf ein Element im Edit-Modus erscheint ein kleines **Popover** das zeigt:
- Sichtbarer Text (direkt editierbar)
- Tooltip/Title (editierbar)
- Placeholder (editierbar, falls vorhanden)
- Button „↩️ Standard" zum Zurücksetzen

```
┌──────────────────────────────┐
│ 📝 Label bearbeiten         │
│                              │
│ Text:    [⏹️ Monitor beenden]│
│ Tooltip: [Monitor beenden   ]│
│                              │
│  💾 Speichern  ↩️ Standard   │
└──────────────────────────────┘
```

#### Schutzmaßnahmen
- **Mindestlänge:** 1 Zeichen (kein leeres Label)
- **Maximallänge:** 100 Zeichen
- **Template-Variablen:** `{count}`, `{label}`, `{datum}` sind geschützt und werden im Editor als nicht-löschbare Tokens angezeigt
- **Reset pro Label** + **globaler Reset** (alle Labels auf Defaults)

### Architektur

#### 1. Label-Registry (`public/js/labelRegistry.js`) — NEU

```js
window.Keasy.labels = {
  defaults: {
    'btn.stopServer': '⏹️ Monitor beenden',
    'btn.restartWatcher': '🔄 Watcher neu starten',
    'tab.general': '⚙️ Allgemein',
    'status.noErrors': '✅ Keine Fehler',
    'tooltip.openFolder': 'Ordner öffnen',
    'title.document': '({count}) Keasy Log Monitor',  // Template
    // ... alle Texte
  },
  overrides: {},  // aus labels.json geladen

  get(key) {
    return this.overrides[key] ?? this.defaults[key] ?? key;
  },

  // Template-Rendering: get('title.document', { count: 5 })
  format(key, vars) {
    let text = this.get(key);
    for (const [k, v] of Object.entries(vars || {})) {
      text = text.replace(`{${k}}`, v);
    }
    return text;
  },

  set(key, value) { /* speichern */ },
  reset(key) { /* auf Default zurücksetzen */ },
  resetAll() { /* alle Overrides löschen */ },
  save() { /* POST /api/labels */ },
  load() { /* GET /api/labels → overrides */ }
};
```

#### 2. HTML-Integration: `data-label` Attribute

Statt `textContent`-Ersetzung → **dedizierte Text-Spans** die den restlichen DOM nicht zerstören:

```html
<!-- Vorher: -->
<button id="stopServerBtn" title="Monitor beenden">⏹️ Monitor beenden</button>

<!-- Nachher: -->
<button id="stopServerBtn" data-label="btn.stopServer" data-label-title="tooltip.stopServer">
  <span data-label-text>⏹️ Monitor beenden</span>
</button>
```

#### 3. Persistenz

- **Speicherort:** `labels.json` im Projektroot (neben `config.js`)
- **Backup-Integration:** `labels.json` wird ins Backup-ZIP aufgenommen (wie `config.json`, `style.css`)
- **API:**
  - `GET /api/labels` → aktuelle Overrides
  - `POST /api/labels` → Overrides speichern
  - `DELETE /api/labels` → alle Overrides löschen (Reset)

#### 4. Config-Erweiterung

```js
// config.js
labelEditMode: false,  // true = ✏️-Button im Header sichtbar
```

### Phasenplan

#### Phase A: Grundgerüst + statische HTML-Labels (Mittel)
- `labelRegistry.js` mit Defaults und Load/Save
- API-Endpoints (`GET/POST/DELETE /api/labels`)
- `labels.json` Persistenz + Backup-Integration
- Config-Option `labelEditMode`
- `data-label` auf **statische HTML-Elemente** in `index.html` (~80 Stellen)
- `applyLabels()` beim Seitenstart
- **Ergebnis:** Labels sind konfigurierbar, aber noch kein visuelles Editing

#### Phase B: Overlay-Bearbeitungsmodus (Mittel)
- ✏️-Toggle-Button im Header
- Top-Banner im Edit-Modus
- CSS für editierbare Labels (Rahmen, Cursor, ✏️-Hover)
- Klick → Mini-Inspector/Popover (Text + Tooltip + Placeholder)
- Enter/Escape-Handling
- **Ergebnis:** Statische Labels visuell editierbar

#### Phase C: JS-generierte Labels migrieren (Hoch)
- Alle hartcodierten Strings in `render.js`, `actions.js`, `boot.js`, `backupPanel.js`, `configPanel.js` durch `Keasy.labels.get()` / `format()` ersetzen
- Template-Variablen für dynamische Texte
- ~70 Stellen in 5 Dateien
- **Ergebnis:** Auch dynamisch generierte Texte editierbar

### Betroffene Dateien

| Datei | Phase | Änderung |
|---|---|---|
| `public/js/labelRegistry.js` | A | **NEU** — Label-Registry |
| `public/index.html` | A | `data-label` Attribute + Script-Include |
| `server/httpRouter.js` | A | 3 Endpoints (GET/POST/DELETE /api/labels) |
| `config.js` | A | `labelEditMode: false` |
| `server/backupService.js` | A | `labels.json` ins Backup aufnehmen |
| `public/js/labelEditor.js` | B | **NEU** — Overlay-Modus, Inspector, Editing-Logik |
| `public/style.css` | B | Edit-Modus-Styles (Banner, Rahmen, Cursor) |
| `public/js/render.js` | C | ~30 Strings → `labels.get()` |
| `public/js/actions.js` | C | ~15 Strings → `labels.get()` |
| `public/js/boot.js` | C | ~10 Strings → `labels.get()` |
| `public/js/backupPanel.js` | C | ~25 Strings → `labels.get()` |
| `public/js/configPanel.js` | C | ~20 Strings → `labels.get()` |

## Aufwand
- **Phase A:** Mittel (~120 Zeilen neuer Code + ~80 HTML-Attribut-Ergänzungen)
- **Phase B:** Mittel (~150 Zeilen Editing-Logik + CSS)
- **Phase C:** Hoch (~100 String-Ersetzungen, viel Testing)
- **Gesamt: Hoch** — empfohlen in Phasen umzusetzen

## Review-Ergebnis

Plan wurde von UX-Profis geprüft. Übernommene Punkte:
1. ✅ **Overlay-Modus** statt Doppelklick (besser auffindbar, touch-kompatibel)
2. ✅ **Dedizierte Text-Spans** statt `textContent`-Ersetzung (DOM-Struktur bleibt intakt)
3. ✅ **Mini-Inspector/Popover** für Tooltips und unsichtbare Texte
4. ✅ **Enter/Escape** statt Blur-Speichern (weniger versehentliche Änderungen)
5. ✅ **Labels.json ins Backup** aufnehmen (geht nicht verloren bei Backup/Restore)
6. ✅ **Validierung:** Mindest-/Maximallänge, geschützte Template-Variablen
7. ✅ **Top-Banner** im Edit-Modus für klare Discoverability
8. ✅ **Phasenweise Einführung** statt Big-Bang (Phase A/B/C)
