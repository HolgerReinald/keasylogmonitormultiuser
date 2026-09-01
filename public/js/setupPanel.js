(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;
const { escapeHtml, escapeJs } = Keasy.utils;

// === Erste Schritte (Einrichtungskarte) ===
//
// Ein frisch verteiltes Paket hat keine Watchpaths. Das Dashboard zeigte in
// diesem Zustand "✅ Keine Fehler — Überwache Log-Dateien…": ein grünes Häkchen
// und die Behauptung, es werde überwacht, obwohl nichts eingerichtet ist. Genau
// dort steht jetzt diese Karte.
//
// Die Karte schwebt (position: fixed) unten rechts statt im Seitenfluss zu
// liegen. Inline verschob sie beim Auf- und Zuklappen die ganze Fehlerliste --
// und gerade beim Einrichten arbeitet man in den Einstellungen, wo ein
// springendes Layout am meisten stoert. Schwebend bleibt sie dabei sichtbar,
// und der Fortschrittsring zeigt, wo man steht.
//
// Genau EIN Pflichtschritt (ein Log-Pfad), alles andere ist Angebot. Wer einen
// optionalen Punkt nicht braucht, hakt ihn ab; sind alle Punkte erledigt oder
// abgehakt, verschwindet die Karte von selbst. Ohne das Abhaken stünde bei
// jemandem, der weder E-Mail noch Backup will, dauerhaft "5 offen" — eine Karte,
// die nie zufrieden wird, klickt man einmal weg und verliert dann auch die
// nützlichen Hinweise.

// Reihenfolge und Texte. Die ids spiegeln SETUP_IDS in server/setupState.js.
const SCHRITTE = [
  { id: 'paths', pflicht: true, tab: 'watchpaths', name: '🕵️ Monitor',
    titel: 'Mindestens einen Log-Pfad überwachen',
    text: 'Ohne Pfad läuft der Monitor leer — er meldet „keine Fehler", weil er nichts ansieht.' },
  { id: 'allg', tab: 'general', name: '⚙️ Allgemein',
    text: 'Port, Dateigrenzen, die <b>KI-Export-Pfade</b> (Develop / Release, gelten pro Benutzer) und das <b>Rechtesystem</b>. Wird es aktiviert, gilt zunächst <code>admin</code> / <code>admin</code> — dann das Passwort ändern.' },
  { id: 'reg', tab: 'monitorsettings', name: '📋 Regeln',
    text: 'Fehlererkennung, Ausschlüsse, Schwellwerte, Priorität. <b>Eine Standardkonfiguration ist vorhanden</b> (<code>Exception</code> und <code>Fehler</code>) — Anpassen lohnt sich für eigene Log-Formate, nötig ist es nicht. Gilt als erledigt, sobald <i>eine</i> der vier Listen angepasst ist.' },
  { id: 'mail', tab: 'email', name: '✉️ E-Mail',
    text: 'Nur nötig, wenn Fehler auch ohne offenes Dashboard gemeldet werden sollen.' },
  { id: 'ana', tab: null, name: '📂 Log-Analyse',
    text: 'Für die einmalige Auswertung älterer Logs. Eigenes Panel im Kopf, nicht in den Einstellungen.' },
  { id: 'bak', tab: 'backup', name: '🗄️ Backup',
    text: 'Sicherung der Konfiguration. <b>Nach einer Weitergabe fehlen FTP-Benutzer und -Passwort</b> — die werden beim Export entfernt.' }
];

// "Erledigt" gewinnt über "abgehakt": wer E-Mail später doch einrichtet, soll
// das sehen, auch wenn er den Punkt einmal weggeklickt hatte.
function istErledigt(s) {
  const st = state.setupState || {};
  return !!(st.erledigt && st.erledigt[s.id]);
}
function istAbgehakt(s) {
  const st = state.setupState || {};
  return !istErledigt(s) && Array.isArray(st.abgehakt) && st.abgehakt.includes(s.id);
}
function istOffen(s) { return !istErledigt(s) && !istAbgehakt(s); }

function offeneSchritte() { return SCHRITTE.filter(istOffen); }

// Ist der Assistent ueberhaupt noch aktiv? EINE Stelle fuer diese Frage -- sie
// wird an vier Orten gebraucht (Karte, Pille, Tab-Punkte, Leerzustand), und
// genau dort ist sie auseinandergelaufen: nach "Einrichtung abgeschlossen"
// blieben die grauen Punkte an den Tabs stehen, weil dort nur `zeigen` geprueft
// wurde und nicht `fertig`.
function assistentAktiv() {
  const st = state.setupState || {};
  return !!st.zeigen && !st.fertig;
}

// Ist der Pflichtschritt offen, ist die Installation nicht betriebsbereit --
// der Leerzustand darf dann kein "Keine Fehler" behaupten.
function pflichtOffen() {
  const st = state.setupState || {};
  // Bewusst OHNE assistentAktiv(): ohne Watchpath wird tatsaechlich nichts
  // ueberwacht, und das bleibt wahr, auch wenn jemand die Einrichtung als
  // abgeschlossen markiert hat. Der Leerzustand sagt weiter die Wahrheit --
  // nur der Verweis auf die Karte entfaellt, wenn es sie nicht mehr gibt.
  if (!st.zeigen) return false;
  const p = SCHRITTE.find(x => x.pflicht);
  return !!p && istOffen(p);
}

// Sichtbar, solange irgendein Schritt offen ist. Nicht-Admins sehen nichts:
// alle Ziele sind data-admin-only, die Karte würde zu Gesperrtem auffordern.
// Die Karte bleibt sichtbar, bis "Einrichtung abgeschlossen" geklickt wird --
// NICHT nur solange Punkte offen sind. Sonst verschwindet sie mitten in der
// Arbeit: wer den letzten offenen Punkt abhakt, dem wird sie unter der Hand
// weggerissen. Temporaer wegraeumen geht ueber das Einklappen (Kopf anklicken).
function istSichtbar() {
  return assistentAktiv();
}

// Kein Rueckweg noetig: die Karte verschwindet nur noch durch "Einrichtung
// abgeschlossen", und diese Entscheidung soll halten. Fuer "spaeter weiter"
// gibt es das Einklappen. Die fruehere Pille im Kopf holte beim Klick alle
// Abhakungen zurueck und setzte damit den halben Fortschritt zurueck.

// Auf- oder zugeklappt. Startet GEOEFFNET -- beim ersten Start soll die Karte
// nicht uebersehen werden. Der Zustand ist Ansichtssache des Einzelnen und
// gehoert deshalb in den localStorage, nicht in die Config (dort steht, was
// fuer die ganze Installation gilt: setupDismissed).
const KLAPP_KEY = 'keasy-setup-zu';

function istZu() {
  try { return localStorage.getItem(KLAPP_KEY) === '1'; } catch (e) { return false; }
}
function setzeZu(zu) {
  try { localStorage.setItem(KLAPP_KEY, zu ? '1' : '0'); } catch (e) { /* privater Modus */ }
}

// Anteil der tatsaechlich eingerichteten Schritte. Abgehaktes zaehlt NICHT mit,
// sonst behauptet der Ring einen Fortschritt, den es nicht gibt.
function fortschritt() {
  const fertig = SCHRITTE.filter(istErledigt).length;
  return { fertig, gesamt: SCHRITTE.length, prozent: Math.round(fertig / SCHRITTE.length * 100) };
}

function buildSetupCardHtml() {
  if (!istSichtbar()) return '';

  const zu = istZu();
  const fs = fortschritt();
  const naechster = offeneSchritte()[0];

  const zeilen = SCHRITTE.map((s, i) => {
    const fertig = istErledigt(s), ab = istAbgehakt(s);
    const jetzt = naechster && naechster.id === s.id;
    const cls = (fertig ? ' fertig' : ab ? ' unnoetig' : '') + (jetzt ? ' jetzt' : '');
    const marke = fertig ? '✓' : ab ? '✕' : (i + 1);
    // Erledigtes braucht keine Aktion — da steht etwas, das bleibt.
    const weg = fertig ? ''
      : ab
        ? `<button class="wz-weg" onclick="setupDismiss('${escapeJs(s.id)}', false, event)" title="Punkt wieder aufnehmen">↺</button>`
        : `<button class="wz-weg" onclick="setupDismiss('${escapeJs(s.id)}', true, event)" title="Brauche ich nicht">✕</button>`;
    const pflichtHinweis = s.pflicht && !fertig
      ? ' <span class="wz-pflicht">· erforderlich</span>' : '';
    return `<div class="wz-schritt${cls}" onclick="setupGoto('${escapeJs(s.id)}')">
        <span class="mk">${marke}</span>
        <span style="flex:1;min-width:0">
          <span class="nm">${escapeHtml(s.name)}${pflichtHinweis}</span>
          <span class="tx">${s.text}</span>
        </span>${weg}
      </div>`;
  }).join('');

  return `
    <div class="wz${zu ? ' zu' : ''}">
      <div class="wz-kopf" onclick="setupToggle()" title="${zu ? 'Aufklappen' : 'Einklappen'}">
        <span class="wz-ring" style="--p:${fs.prozent}"><span>${fs.fertig}/${fs.gesamt}</span></span>
        <span class="t">
          <b>Einrichtung</b>
          <span>${offeneSchritte().length === 0
            ? 'alles entschieden · unten abschließen'
            : offeneSchritte().length + ' offen' + (zu ? '' : ' · Klick klappt ein')}</span>
        </span>
        <span class="wz-pfeil">${zu ? '▴' : '▾'}</span>
      </div>
      <div class="wz-koerper">${zeilen}</div>
      <div class="wz-fuss">
        <span style="color:var(--text-secondary)">Nicht Benötigtes mit ✕ abhaken</span>
        <button class="wz-fertig" onclick="setupFertig(event)"
                title="Beendet die Einrichtung — die Karte erscheint nicht wieder">✓ Einrichtung abgeschlossen</button>
      </div>
    </div>`;
}

// Die Karte in ihren eigenen, fixierten Host schreiben. Sie liegt damit
// ausserhalb des Seitenflusses und verschiebt beim Auf-/Zuklappen nichts.
function renderSetupCard() {
  const host = document.getElementById('setupHost');
  if (!host) return;
  host.innerHTML = buildSetupCardHtml();
}

function setupToggle() {
  setzeZu(!istZu());
  renderSetupCard();
}

// Karte und Tab-Punkte neu zeichnen. Der frueher hier gepflegte Ruecksprung im
// Kopf ist entfallen -- siehe oben.
function renderSetupPill() {
  const el = document.getElementById('setupPill');
  if (el) el.innerHTML = '';
  renderSetupCard();
  markiereTabs();
}

// Punkt an den Tabs, deren Schritt noch offen ist. Der Pflichtschritt bekommt
// die Akzentfarbe, optionale einen gedimmten Punkt — sonst sehen sieben Tabs
// gleich dringend aus. Die Klassen werden bei jedem Render neu gesetzt, damit
// ein erledigter Schritt seinen Punkt sofort verliert.
function markiereTabs() {
  const tabs = document.querySelectorAll('#configPanel .config-tab');
  if (!tabs.length) return;
  const aktiv = assistentAktiv();
  for (const t of tabs) {
    t.classList.remove('setup-todo', 'setup-todo-optional');
    if (!aktiv) continue;
    const onclick = t.getAttribute('onclick') || '';
    const s = SCHRITTE.find(x => x.tab && onclick.includes("'" + x.tab + "'") && istOffen(x));
    if (!s) continue;
    t.classList.add('setup-todo');
    if (!s.pflicht) t.classList.add('setup-todo-optional');
  }
}

// --- Bedienung ---

// Zum Ziel eines Schritts springen. Ohne tab: das Analyse-Panel.
function setupGoto(id) {
  const s = SCHRITTE.find(x => x.id === id);
  if (!s) return;
  if (s.tab) {
    if (typeof toggleConfigPanel === 'function') {
      const panel = document.getElementById('configPanel');
      if (panel && !panel.classList.contains('open')) toggleConfigPanel();
    }
    if (typeof switchConfigTab === 'function') switchConfigTab(s.tab);
  } else if (typeof toggleAnalyzePanel === 'function') {
    const panel = document.getElementById('analyzePanel');
    if (panel && !panel.classList.contains('open')) toggleAnalyzePanel();
  }
}

async function sendeDismiss(id, aus) {
  try {
    const resp = await fetch('/api/setup-dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, dismissed: aus })
    });
    const r = await resp.json();
    if (!r.ok && typeof showToast === 'function') showToast(r.message || 'Fehlgeschlagen', 'error');
    // Die neue Karte kommt per 'setup-state'-Broadcast zurück — hier bewusst
    // kein lokales Nachziehen, sonst gibt es zwei Wahrheiten.
  } catch (err) {
    if (typeof showToast === 'function') showToast('Fehlgeschlagen: ' + err.message, 'error');
  }
}

function setupDismiss(id, aus, event) {
  if (event) event.stopPropagation(); // sonst springt der Klick ins Ziel
  sendeDismiss(id, aus);
}

// "Einrichtung abgeschlossen": beendet den Assistenten als Ganzes. Hieß früher
// "Nicht mehr anzeigen" — das klang nach Unterdrücken und wurde deshalb nicht
// als der Abschluss erkannt, der es ist: man geht die Punkte durch, entscheidet
// je Punkt, und sagt am Ende einmal "fertig".
// Setzt setupCompleted statt jeden Punkt abzuhaken; sonst nimmt ein Zurückholen
// der Einzelpunkte diese Entscheidung mit zurück.
async function setupFertig(event) {
  if (event) event.stopPropagation();
  try {
    const resp = await fetch('/api/setup-dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fertig: true })
    });
    const r = await resp.json();
    if (!r.ok && typeof showToast === 'function') showToast(r.message || 'Fehlgeschlagen', 'error');
  } catch (err) {
    if (typeof showToast === 'function') showToast('Fehlgeschlagen: ' + err.message, 'error');
  }
}

window.Keasy.setup = {
  buildSetupCardHtml, renderSetupCard, renderSetupPill, markiereTabs, SCHRITTE,
  istSichtbar, istOffen, istErledigt, istAbgehakt, fortschritt, pflichtOffen, assistentAktiv
};
Object.assign(window, { setupGoto, setupDismiss, setupFertig, setupToggle });
})();
