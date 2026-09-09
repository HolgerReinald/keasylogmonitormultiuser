# Plan: Was passiert beim Klick auf „anzeigen"? (Stufe 3b)

> Ersetzt die Zeile „3b" in `plan-neue-fehler-zurueckhalten.md`. Stufe 3a und 3c
> sind gebaut (Commit 5a43ab2, Version 2026.09.09-08:09).

## Der Befund

Der Knopf heißt „anzeigen", tut aber **Einbauen**, nicht Anzeigen.

Nach dem Klick sind die neuen Fehler in der Liste — nach Zeitstempel einsortiert,
womöglich verteilt über mehrere Quellen. An der Lesestelle ändert sich dabei
**sichtbar nichts**, weil der Anker sie festhält. Die Pille verschwindet, sonst
passiert scheinbar nichts. Der Klick wirkt folgenlos, und die drei Fehler sind
danach nicht wiederzufinden.

Dazu die Zwischenfrage: **anspringen** kann man nur einen, und das wäre der
neueste. Liegen die drei in drei Quellen, zeigt ein Sprung also einen, und die
beiden anderen sind nur über den Fehler-Index auffindbar. Die Zahl in der Pille
bleibt die einzige Information, dass es überhaupt drei waren.

## Drei schlüssige Möglichkeiten

| | Verhalten beim Klick | Dafür | Dagegen |
|---|---|---|---|
| **A** | einbauen, stehenbleiben (*gebauter Stand*) | ruhig, nichts bewegt sich | wirkt folgenlos; die neuen Einträge sind nicht wiederzufinden. Ehrlicher hieße der Knopf „übernehmen" |
| **B** | einbauen **und** zum neuesten springen, markiert und kurz aufblitzend | „anzeigen" hält, was es verspricht; **keine neue Bildsprache** — Sprung und Aufblitzen gibt es schon | die Lesestelle geht verloren — aber freiwillig |
| **C** | einbauen **und** die dazugekommenen Einträge markieren, bis der nächste Schwung kommt | zeigt alle, auch über Quellen verteilt | eine fünfte Markierungsebene (siehe unten) |

## Empfehlung: B als Hauptklick

Damit erledigt sich 3b als *separater zweiter Knopf* — der Sprung wird der
Hauptklick.

Der scheinbare Widerspruch zu „bleib stehen" löst sich so auf: Stufe 3 schützt
davor, **unfreiwillig** aus der Ansicht gerissen zu werden. Ein Klick ist
freiwillig — wer klickt, will hin. Geschützt bleibt weiterhin alles, was von
selbst passiert.

**C nicht auf Verdacht bauen.** Die Anzeige trägt bereits vier Signale:
🔴 kritisch, die farblich hervorgehobene neueste Datei je Quelle, die
Übergrößen-Markierung und „Datei nicht mehr vorhanden". Ein fünftes „neu"
konkurriert damit — besonders mit *neueste Datei*, das ähnlich klingt, aber
etwas anderes meint (neuste von allen vs. seit deinem letzten Klick).

Erst wenn B sich im Betrieb als zu wenig erweist, und dann leise: dünne Kante
plus kleines „neu" in der Zeitzeile, **keine Hintergrundfarbe** — die gehört der
Dringlichkeit.

## Nächster Schritt: Mockup

Drei Verhalten muss man erleben, nicht beschreiben — besonders die Frage, ob der
Sprung bei B sich hilfreich oder übergriffig anfühlt. Eine Seite, auf der A, B
und C an denselben erfundenen Fehlern umschaltbar sind. Vorbild und Bauart wie
das Mockup zu Stufe 3 (liegt in Commit `7ea280e`, `mockup-neue-fehler.html`):
echtes `public/style.css`, echte Markup-Struktur, Regler für die Fehlerrate.

## Technische Punkte, die beim Bauen anfallen

1. **`state.pendingNew` braucht eine Referenz**, nicht nur Zahlen. „Das Neueste"
   lässt sich nicht über die Position im Aufbau finden: über den Live-Quellen
   liegt der Analyse-Sammelblock, der erste Eintrag im DOM ist also nicht
   zwangsläufig der neueste Fehler. Gemerkt wird das Fehlerobjekt — dieselbe
   Mechanik wie bei Anker (`state.navEntries`) und Fehler-Index.
2. **Kein Sprung ins Leere.** Ist der Eintrag inzwischen durch Filter oder die
   `maxErrorsPerFile`-Grenze weggefallen, wird nur eingebaut. Ein Sprung, der
   nichts findet, wäre schlimmer als keiner.
3. **Anker und Sprung ziehen gegeneinander.** `renderAll()` stellt am Ende die
   Lesestelle wieder her; danach würde der Sprung sie wieder verlassen — als
   ruckartiges Zurechtrücken plus anschließendem weichem Scrollen. Für genau
   diesen einen Aufbau muss der Anker übersprungen werden. Kleiner Eingriff,
   aber an einer Stelle, die schon zweimal umgebaut wurde: gehört in den Test.
4. **Wiederverwenden statt neu bauen:** `focusEntry()` in `actions.js` ist die
   gemeinsame Endstelle aller Sprünge (Alarmknopf, Fehler-Index) und erledigt
   Aufklappen, Markieren, Scrollen und `jump-flash` bereits.

## Aufwand

Rund 30–40 Zeilen plus Prüfungen in `test/zurueckhalten-wiring.js`. Reiner
Client — F5 genügt, kein Server-Neustart.
