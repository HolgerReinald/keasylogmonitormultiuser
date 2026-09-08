# Plan: Neue Fehler zurückhalten (Stufe 3)

## Problem

Wer einen Fehler liest und dabei einen neuen Fehler bekommt, wird aus der Ansicht gerissen. Stufe 1 und 2 (08.09.2026) haben die sichtbaren Folgen beseitigt — aufgeklappte Dateien bleiben offen, der Anker hält die Position. Der **Neuaufbau selbst läuft aber weiter**: `renderAll()` ersetzt bei jedem eingehenden Fehler das komplette HTML des Containers.

Was dadurch bleibt:

- **Flackern bei Fehlerfluten.** Ein Log kann in Sekunden ein Dutzend Einträge liefern; jeder davon baut die Seite neu auf.
- **Der Anker kann nur halten, was er findet.** Wird der gelesene Eintrag durch `capKeepCritical()` verdrängt oder durch einen Filter ausgeblendet, steigt `restoreViewAnchor()` still aus.
- **Die Sortierung arbeitet weiter.** Quellen und Dateien werden nach neuestem Fehler sortiert. Der Anker hält die *Position*, aber die Umgebung unter der Lesestelle ordnet sich um — man sucht die Nachbareinträge neu.

## Lösung

Solange der Anwender **nicht ganz oben** steht, wird bei eingehenden Fehlern gar nicht mehr neu aufgebaut. Die Fehler laufen weiter ein und liegen in `state.errors` bereit; angezeigt werden sie erst auf Klick. Sichtbar ist währenddessen nur eine schwebende Pille:

```
┌─ Kopfzeile (Suche · Zeitraum · ⏸️ Pause · ⊟ Alle zu · 🧭 Index) ─────┐
└──────────────────────────────────────────────────────────────────────┘
              ╭──────────────────────────────────────────╮
              │  🔴 3 neue Fehler · 🚨 1 kritisch        │  ← schwebt,
              ╰──────────────────────────────────────────╯     verschiebt nichts
┌─ 🕵️ Keasy Server ─────────────────────────────────── 🚨 2 · 42 ─────┐
│  📄 KeasyServerService_KeasyWorkflowServer…_2026-09-08.log    🕒 …  │
│    ▾ 14:02:11   ↗ Zeile öffnen  📋  🤖  🚀                          │
│      Der folgende #Fehler ist aufgetreten: …                        │  ← bleibt
│    ▾ 14:01:52   ↗ Zeile öffnen  📋  🤖  🚀                          │     stehen
```

Ein Klick auf die Pille baut ein, die Pille verschwindet. **Die Ansicht springt dabei nicht** — der Anker aus Stufe 2 hält die Lesestelle, die neuen Fehler erscheinen darüber.

### Die Regel, wann zurückgehalten wird

| Lage | Verhalten |
|---|---|
| Ganz oben (`scrollY <= 4`) | sofort einbauen — dort liest man live mit |
| Weiter unten | zurückhalten, Pille zeigen |
| ⏸️ Pause aktiv | unverändert; Pause gewinnt, keine Pille |
| Anwender scrollt nach oben | automatisch einbauen, Pille verschwindet |
| Filter, Suche, Zeitraum, Löschen, Analyse | **immer sofort** — das hat der Anwender selbst ausgelöst |

Die Schwelle `scrollY <= 4` ist dieselbe wie beim Anker in `captureViewAnchor()`. Zwei Schwellen für dieselbe Frage („liest der Anwender gerade oben mit?") würden auseinanderlaufen — sie gehört in eine gemeinsame Funktion.

### Der Zähler zählt nicht mit

`renderAll()` setzt `totalCount` auf die Zahl der **angezeigten** Einträge. Zurückgehaltene Fehler sind nicht angezeigt — der Zähler bleibt also richtig, ohne dass etwas geändert werden muss. Die Wahrheit über das Zurückgehaltene steht in der Pille.

Unberührt bleiben ebenfalls: der Browser-Titel und die Desktop-Benachrichtigung. Beide laufen außerhalb der Anzeige (`updateBrowserTitle()` wird zwar aus `renderAll()` gerufen, `notifyNewError()` aber direkt aus dem WS-Empfang) — der Anwender erfährt vom neuen Fehler also weiterhin sofort, auch ohne hinzusehen.

> **Offene Entscheidung:** Soll der Titel den zurückgehaltenen Stand zeigen (`(45)` statt `(42)`)? Dann braucht es einen eigenen kleinen Aufruf, weil `updateBrowserTitle()` heute an `state.totalErrors` aus dem letzten Aufbau hängt.

## Architektur

### 1. Ein einziger neuer Einstiegspunkt

Zurückgehalten wird **nur** der Weg „neuer Eintrag vom Server". Alle anderen Aufrufer von `renderAll()` bleiben unangetastet — sonst würde eine Filteränderung nicht mehr wirken.

`public/js/wsClient.js`:

```js
// Neuer Eintrag vom Server. Anders als jeder andere Aufbau ist dieser NICHT
// vom Anwender ausgeloest — deshalb darf er warten, solange gelesen wird.
function scheduleRenderForNewEntry(kind) {
  if (liestGeradeOben()) { scheduleRender(); return; }
  state.pendingNew.errors   += kind === 'error' ? 1 : 0;
  state.pendingNew.gaps     += kind === 'gap'   ? 1 : 0;
  state.pendingNew.critical += kind === 'critical' ? 1 : 0;
  renderPendingPill();
}
```

Umgestellt werden genau zwei Stellen:

| Stelle | heute | künftig |
|---|---|---|
| `wsClient.js` — `msg.type === 'error'` | `scheduleRender()` | `scheduleRenderForNewEntry('error')` |
| `wsClient.js` — `schedulePerformanceRender()` | `scheduleRender()` | `scheduleRenderForNewEntry('gap')` |

`scheduleRender()` und `renderAll()` behalten ihre Bedeutung. Der Test hält fest, dass in `wsClient.js` kein direkter `scheduleRender()`-Aufruf aus dem Empfangspfad zurückbleibt.

### 2. Der Zähler wird in `renderAll()` zurückgesetzt

Nicht im Klick-Handler, nicht im Scroll-Handler — **in `renderAll()` selbst**, ganz am Anfang. Damit gilt: was aufgebaut wurde, ist nicht mehr ausstehend. Jeder Weg, der einen Aufbau auslöst (Klick auf die Pille, Filter, Suche, Löschen, Analyse), räumt die Pille automatisch mit ab, und kein künftiger Aufrufer kann es vergessen.

```js
function renderAll() {
  const anchor = captureViewAnchor();
  state.pendingNew = { errors: 0, gaps: 0, critical: 0 };
  renderPendingPill();          // zeichnet sich damit leer, also unsichtbar
  …
```

### 3. Zustand

`public/js/state.js`:

```js
// Eingegangen, aber noch nicht eingebaut — solange der Anwender liest.
// Wird ausschliesslich in renderAll() zurueckgesetzt.
pendingNew: { errors: 0, gaps: 0, critical: 0 },
```

Bewusst **nicht** im `localStorage`: nach einem F5 ist ohnehin alles neu aufgebaut, ein überlebender Zähler wäre eine Lüge.

### 4. Die Pille

Eigener fixierter Host in `public/index.html`, direkt vor `<div class="app-main">` — nach dem Vorbild von `#setupHost`, damit das Ein- und Ausblenden **nichts im Seitenfluss verschiebt**. Genau das ist der Punkt der ganzen Stufe.

```html
<div id="neuHost" aria-live="polite"></div>
```

```html
<button class="neu-pille" onclick="einbauenJetzt()">
  🔴 3 neue Fehler <span class="neu-krit">🚨 1 kritisch</span>
</button>
```

- `position: fixed`, oben mittig über dem Container, `z-index` unter den Dialogen
- Ein- und Ausblenden ohne Bewegung von unten (eine Animation, die bei jedem neuen Fehler neu startet, wäre unruhiger als gar keine)
- Singular/Plural: „1 neuer Fehler" / „3 neue Fehler"
- Sind nur ⏱️-Lücken eingegangen: „⏱️ 2 neue Lücken" — Lücken sind keine Fehler und dürfen nicht so aussehen
- Kritische Fehler färben die Pille rot, **brechen aber nicht durch**. Ein kritischer Fehler, der die Ansicht umbaut, ist genau die Störung, um die es hier geht; gemeldet wird er ohnehin per Benachrichtigung und Titel.

> **Offene Entscheidung:** Soll ein kritischer Fehler doch sofort einbauen? Meine Empfehlung ist nein — sonst ist die Stufe genau dann wirkungslos, wenn sie am meisten hilft.

### 5. Automatisch einbauen beim Hochscrollen

Ein gedrosselter `scroll`-Listener (rAF, kein `setTimeout`) auf `window`: erreicht `scrollY` die Schwelle und liegt etwas an, wird eingebaut. Der Listener wird **einmal beim Start** gesetzt (`boot.js`), nicht in `renderAll()` — dort würde er sich bei jedem Aufbau erneut anhängen.

### 6. Der Anker bleibt zuständig

Beim Einbauen läuft `renderAll()` wie bisher, und damit `captureViewAnchor()` / `restoreViewAnchor()` aus Stufe 2. Es braucht keinen zweiten Mechanismus fürs Stehenbleiben — Stufe 3 sorgt nur dafür, dass der Aufbau **seltener** passiert und zu einem Zeitpunkt, den der Anwender bestimmt.

## Stufen

| Stufe | Inhalt | Aufwand |
|---|---|---|
| **3.0** | **Mockup** — bedienbare HTML-Seite mit erfundenem Fehlerstrom (Regler für die Rate), um Wortlaut, Platz und Timing zu prüfen. Kein Produktivcode. | klein |
| **3a** | Kern: Zurückhalten, Pille, Klick baut ein, Auto-Einbau beim Hochscrollen | mittel |
| **3b** | Zweite Aktion in der Pille: „↑ zum neuesten" — baut ein *und* springt zum neuesten Eintrag | klein |
| **3c** | Abschaltbar unter *Einstellungen → Allgemein* (`holdNewErrors`, Standard an) | klein |

3.0 zuerst — die Pille ist das erste neue Bedienelement der Ansicht seit dem Index, und Wortlaut und Platzierung entscheiden hier mehr als der Code darunter.

## Was zu prüfen ist

Neue Suite `test/hold-new-errors-wiring.js`, statisch wie `test/view-anchor-wiring.js`:

1. Beide Empfangspfade in `wsClient.js` gehen über `scheduleRenderForNewEntry()`, keiner mehr direkt über `scheduleRender()`
2. `renderAll()` setzt `state.pendingNew` zurück — **am Anfang**, vor dem ersten `return` des Leerzustands (sonst bleibt die Pille bei „keine Treffer" stehen)
3. Die Schwelle steht in **einer** Funktion und wird von Anker und Zurückhalten gemeinsam benutzt
4. Der Scroll-Listener wird in `boot.js` gesetzt, nicht in `renderAll()`
5. `#neuHost` ist `position: fixed` — eine Pille im Seitenfluss würde beim Erscheinen alles verschieben und damit das Gegenteil bewirken
6. ⏸️ Pause hat Vorrang: im Pausenzustand wird nichts gezählt und nichts gezeigt

Dazu die Gegenprobe wie bei Stufe 2: Verdrahtung von Hand kaputt machen, Test muss rot werden.

## Dateien

- `public/js/state.js` — `pendingNew`
- `public/js/wsClient.js` — `scheduleRenderForNewEntry()`, zwei umgestellte Aufrufe
- `public/js/render.js` — Reset in `renderAll()`, gemeinsame Schwellenfunktion
- `public/js/actions.js` — `einbauenJetzt()`
- `public/js/boot.js` — Scroll-Listener
- `public/index.html` — `#neuHost`
- `public/style.css` — `.neu-pille`
- `test/hold-new-errors-wiring.js` — neu

Alles im Client: **F5 genügt**, kein Server-Neustart.
