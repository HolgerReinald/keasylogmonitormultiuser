# Feature: oversizedFiles — große Log-Dateien zuletzt importieren + rot markieren (Mehrbenutzer)

> **Vollständige Implementierung von Grund auf, zugeschnitten auf die Mehrbenutzer-Variante.**
> Diese Anleitung wurde gegen den realen Code-Stand dieser Kopie geschrieben (Datei-/Funktions-Anker
> stimmen). **Kritischer Unterschied zur Einzelbenutzer-Version:** Broadcasts und das `init`-Event
> müssen **pro Client nach `visibleLabels` gefiltert** werden — sonst sehen Benutzer große Dateien
> aus Quellen, für die sie keine Berechtigung haben.

## Ausgangslage (verifiziert in dieser Kopie)
- `maxLogFileSizeMB` existiert (Config + Eingabefeld). In `server/watchService.js` werden große
  Dateien bereits **übersprungen** (Konsole „Übersprungen …", Z. ~277–279), aber **ohne** Tracking,
  ohne Map, ohne Broadcast.
- Es gibt **keine** `oversizedFiles`-Map, kein `getOversizedFiles`, keinen Frontend-State, keine
  rote Anzeige, keine CSS-Klasse `.file-oversize`.
- Architektur-Besonderheit: `server/wsBroadcast.js` bietet `broadcastFiltered(message, filterFn)`,
  das pro Client anhand `client.visibleLabels` filtert (`null` = alle sichtbar). `emitError` nutzt
  das bereits. Das `init`-Event in `server.js` filtert Fehler via `filterByLabels(...)`.

## Konzept
Große Dateien werden **nicht übersprungen**, sondern in `preload.deferredQueue` gesammelt und
**zuletzt** eingelesen. Eine Map `oversizedFiles` (filePath → sizeMB) merkt sich betroffene Dateien;
Änderungen werden **label-gefiltert** per WS-Nachricht `oversized-files` gebroadcastet. Der
Schwellwert `maxLogFileSizeMB` geht über `init` (+ `config-changed`) ans Frontend, das betroffene
Dateinamen **rot** färbt.

---

## Backend

### A. `server/runtimeStore.js`
**A1.** Bei den Maps/Sets ergänzen:
```js
const oversizedFiles = new Map();       // filePath → sizeMB (Dateien > maxLogFileSizeMB)
```
**A2.** Im `preload`-Objekt das Feld ergänzen (neben `queue: []`):
```js
  deferredQueue: [],         // { filePath, label, flushDelay } — große Dateien, zuletzt eingelesen
```
**A3.** In `resetWatcherRuntime()` ergänzen — nach `errorStore.clear();`:
```js
  oversizedFiles.clear();
```
und nach `preload.queue.length = 0;`:
```js
  preload.deferredQueue.length = 0;
```
**A4.** In `module.exports` die Map exportieren (z. B. nach `analyzeLabelMap,`):
```js
  oversizedFiles,
```

### B. `server/watchService.js`
**B1. Import (Z. 9)** — `oversizedFiles` ergänzen (`preload` ist schon dabei):
```js
const { errorStore, filePositions, pendingBuffers, pendingFlushTimers, fileLabelMap, pausedLabels, normalizedWatchPaths, preload, oversizedFiles } = require('./runtimeStore');
```
> `broadcastFiltered` ist in Z. 10 bereits importiert.

**B2. `watcher.on('add')` — Größen-Block ersetzen.** Den vorhandenen Block (aktuell ca. Z. 268–280,
beginnend mit `const maxSizeBytes = …` bis zum Ende der `if/else`-Kette inkl. „Übersprungen"-Log)
ersetzen durch:
```js
      const maxSizeBytes = Math.max(1, config.maxLogFileSizeMB || 6) * 1024 * 1024;
      const doLoad = !skipPreload && config.loadExistingErrors !== false;

      if (doLoad && stat.size > maxSizeBytes) {
        // Große Datei: nicht überspringen, sondern verzögert (zuletzt) einlesen
        const sizeMB = +(stat.size / 1024 / 1024).toFixed(1);
        oversizedFiles.set(filePath, sizeMB);
        filePositions.set(filePath, 0);
        if (!initialScanDone) {
          preload.deferredQueue.push({ filePath, label, flushDelay });
        }
        console.log(`  Große Datei (${sizeMB} MB > ${config.maxLogFileSizeMB || 6} MB), wird zuletzt eingelesen: ${path.basename(filePath)}`);
        broadcastOversized();
      } else if (doLoad) {
        // Normale Datei: ab Position 0 einlesen (Preload beim Initial-Scan, sonst beim nächsten change)
        if (oversizedFiles.delete(filePath)) broadcastOversized();
        filePositions.set(filePath, 0);
        if (!initialScanDone) {
          preloadAddFile(filePath, label, flushDelay);
        }
      } else {
        // loadExistingErrors=false oder skipPreload: nur ab jetzt überwachen
        filePositions.set(filePath, stat.size);
      }
```

**B3. `watcher.on('unlink')`** — am Ende (nach `fileLabelMap.delete(filePath);`) ergänzen:
```js
    if (oversizedFiles.delete(filePath)) broadcastOversized();
```

**B4. `startPreloadProcessing()`** — direkt nach `preload.running = true;` ergänzen:
```js
  // Große Dateien zuletzt einlesen: Defer-Queue ans Ende der Hauptqueue hängen
  if (preload.deferredQueue.length) {
    preload.queue.push(...preload.deferredQueue);
    preload.deferredQueue.length = 0;
  }
```

**B5. `preloadReset()`** — nach `preload.queue.length = 0;` ergänzen:
```js
  preload.deferredQueue.length = 0;
```

**B6. Zwei Funktionen ergänzen** (z. B. direkt vor `module.exports`). Wichtig: `broadcastOversized`
filtert **pro Client nach `visibleLabels`** und liefert die Größe + das Label pro Datei:
```js
function getOversizedFiles() {
  const result = {};
  for (const [filePath, sizeMB] of oversizedFiles) {
    result[filePath] = { sizeMB, label: fileLabelMap.get(filePath) || getLabelForFile(filePath) || '' };
  }
  return result;
}

function broadcastOversized() {
  broadcastFiltered(
    { type: 'oversized-files', data: getOversizedFiles() },
    (msg, visibleLabels) => {
      if (!visibleLabels) return msg; // null = alle sichtbar
      const data = {};
      for (const [fp, info] of Object.entries(msg.data)) {
        if (visibleLabels.includes(info.label)) data[fp] = info;
      }
      return { type: 'oversized-files', data };
    }
  );
}
```

**B7. Export (Z. ~409)** — `getOversizedFiles` ergänzen:
```js
module.exports = { startWatching, getLabelForFile, getAllErrors, getOversizedFiles, preloadReset };
```

### C. `server.js`
**C1. Import (Z. 19)** — `getOversizedFiles` ergänzen:
```js
const { startWatching, getAllErrors, getOversizedFiles, preloadReset } = require('./server/watchService');
```

**C2. `init`-Event** — nach `data: filteredErrors,` (Z. 104) ergänzen:
```js
    oversizedFiles: filterOversizedByLabels(getOversizedFiles(), ws.visibleLabels),
    maxLogFileSizeMB: config.maxLogFileSizeMB,
```

**C3. Filter-Helfer** — neben `filterByLabels(...)` (nach Z. 136) ergänzen:
```js
function filterOversizedByLabels(oversized, visibleLabels) {
  if (!visibleLabels) return oversized; // null = alle
  const filtered = {};
  for (const [filePath, info] of Object.entries(oversized)) {
    if (info.label && visibleLabels.includes(info.label)) {
      filtered[filePath] = info;
    }
  }
  return filtered;
}
```

**C4. `config-changed`-Broadcast (Z. 63)** — Schwellwert mitgeben (global, kein Label-Filter nötig):
```js
  broadcast({ type: 'config-changed', data: { emailConfigured: normalizedWatchPaths.filter(wp => wp.emailTo).map(wp => wp.label), maxLogFileSizeMB: newConfig.maxLogFileSizeMB } });
```

---

## Frontend

### D. `public/js/state.js`
Im Bereich „Monitor" (nach `fileLabels: {},`) ergänzen:
```js
  oversizedFiles: {},
  maxLogFileSizeMB: 6,
```

### E. `public/js/wsClient.js`
**E1. `init`-Handler** — nach `state.visibleLabels = msg.visibleLabels || null;` (Z. 50) ergänzen:
```js
      state.oversizedFiles = msg.oversizedFiles || {};
      state.maxLogFileSizeMB = msg.maxLogFileSizeMB ?? state.maxLogFileSizeMB;
```
**E2. `config-changed`-Handler (Z. 168–172)** — Schwellwert übernehmen, z. B. nach dem
`emailConfigured`-Block:
```js
      if (msg.data.maxLogFileSizeMB != null) {
        state.maxLogFileSizeMB = msg.data.maxLogFileSizeMB;
      }
```
**E3. Neuer Nachrichten-Handler** — als weiteren `else if`-Zweig (z. B. direkt nach dem
`config-changed`-Zweig):
```js
    } else if (msg.type === 'oversized-files') {
      state.oversizedFiles = msg.data || {};
      if (!state.paused) scheduleRender();
```

### F. `public/js/render.js`
In der per-Datei-Schleife nach `groupCount += filtered.length;` (Z. 120) die Markierungs-Variablen
berechnen — `state.oversizedFiles[filePath]` ist hier ein **Objekt** `{ sizeMB, label }`:
```js
      const ovInfo = state.oversizedFiles && state.oversizedFiles[filePath];
      const oversizeClass = ovInfo ? ' file-oversize' : '';
      const oversizeTitle = ovInfo ? ` title="${ovInfo.sizeMB} MB > ${state.maxLogFileSizeMB || 6} MB — große Datei, zuletzt eingelesen"` : '';
```
und den Dateinamen-`<div>` (Z. 126) ersetzen durch:
```js
              <div class="file-name${oversizeClass}"${oversizeTitle}>📄 ${escapeHtml(fileName)}</div>
```

### G. `public/style.css`
Rote Einfärbung ergänzen (nutzt die in allen Themes als Rot definierte Variable `--badge-bg`):
```css
.file-name.file-oversize {
  color: var(--badge-bg);
}
```

---

## Verifikation
1. **Syntax-Check:** `node --check` für `server.js`, `server/watchService.js`,
   `server/runtimeStore.js`, `public/js/state.js`, `public/js/wsClient.js`, `public/js/render.js`.
2. **Server starten:** `node server.js`. Konsole zeigt große Dateien als
   `Große Datei (… MB > … MB), wird zuletzt eingelesen: …`; im Preload zuletzt verarbeitet.
3. **Manuell im Browser** (als Benutzer mit Sicht auf die betreffende Quelle): eine `.log`
   > `maxLogFileSizeMB` mit heutigem Datum + Fehler-Inhalt in einen sichtbaren Watch-Pfad legen
   → erscheint nach (verzögertem) Import mit **rotem** Dateinamen; Tooltip zeigt Größe +
   Schwellwert. Schwellwert in den Einstellungen ändern → Tooltip aktualisiert sich ohne Reload.
4. **Rechte-Filter prüfen (Mehrbenutzer-spezifisch):** Mit einem Benutzer, der die Quelle der großen
   Datei **nicht** sehen darf, anmelden → die große Datei darf **nicht** erscheinen (weder rot noch
   sonst). Damit ist die `visibleLabels`-Filterung von `init` und `oversized-files`-Broadcast belegt.
5. **Smoke-Test:** `node test/smoke.js [port]` — falls der Test die WS-`init` authentifiziert prüft,
   dort zwei Assertions ergänzen: `typeof msg.oversizedFiles === 'object'` und
   `typeof msg.maxLogFileSizeMB === 'number'`. (Hinweis: WS erfordert eine Session; ein
   unauthentifizierter Connect wird mit Code 4401 geschlossen.)

## Doku (optional, Projektkonvention)
```
node scripts/update-docs.js "Große Log-Dateien: oversizedFiles (Defer-Import + rote Markierung, label-gefiltert)" "- Große Dateien werden zuletzt eingelesen statt übersprungen (Defer-Queue)" "- Rote Markierung; Schwellwert aus Config via init/config-changed" "- Live-Broadcast 'oversized-files', pro Client nach visibleLabels gefiltert" --files "server/watchService.js, server/runtimeStore.js, server.js, public/js/render.js, public/js/wsClient.js, public/js/state.js, public/style.css"
```

## Hinweis
Der Defer-Import liest große Dateien vollständig (am Stück) ein; bei sehr hohem `maxLogFileSizeMB`
Speicher beachten. Bei moderaten Schwellen (z. B. 6 MB) unkritisch.
