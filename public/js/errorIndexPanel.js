(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;
const { escapeHtml, escapeJs } = Keasy.utils;

// === Fehler-Index (Seitenleiste) ===
//
// Baut aus state.navEntries eine kompakte Sprungliste, gruppiert nach Quelle.
// Die Daten entstehen in render.js im selben Durchlauf, der die Anzeige baut —
// der Index zeigt dadurch garantiert dieselbe gefilterte Menge.
//
// Nummeriert wird je Quelle neu. Eine fortlaufende Nummer über alle Watchpaths
// hinweg würde eine Reihenfolge behaupten, die es nicht gibt.

function persist(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* privater Modus */ }
}

// Dateiname ohne Datumssuffix — in der schmalen Spalte zählt jedes Zeichen
function shortFileName(name) {
  return name.replace(/_\d{4}-\d{2}-\d{2}\.log$/i, '');
}

function applyIndexLayout() {
  const main = document.getElementById('appMain');
  const btn = document.getElementById('indexToggleBtn');
  if (!main) return;
  main.dataset.side = state.indexVisible ? state.indexSide : 'off';
  if (btn) {
    btn.setAttribute('aria-pressed', String(state.indexVisible));
    btn.title = state.indexVisible ? 'Fehler-Index ausblenden' : 'Fehler-Index einblenden';
  }
}

function toggleIndexPanel() {
  state.indexVisible = !state.indexVisible;
  persist('keasy-index-visible', state.indexVisible ? 'on' : 'off');
  applyIndexLayout();
}

function swapIndexSide() {
  state.indexSide = state.indexSide === 'left' ? 'right' : 'left';
  persist('keasy-index-side', state.indexSide);
  applyIndexLayout();
}

function setIndexSeverity(critOnly) {
  state.indexCritOnly = !!critOnly;
  persist('keasy-index-crit', state.indexCritOnly ? 'on' : 'off');
  renderErrorIndex();
}

// Quelle im Index auf-/zuklappen. Nutzt bewusst denselben Zustand wie die
// Hauptansicht (state.collapsedSources): ein Auf-/Zu-Zustand je Quelle, nicht
// zwei. Deshalb wird der Quellen-Kopf in der Anzeige gesucht und toggleSource()
// aufgerufen — das pflegt Zustand, Pfeil und Persistenz an einer Stelle und
// rendert den Index gleich mit.
function toggleIndexGroup(key) {
  const header = [...document.querySelectorAll('.source-header[data-collapse-key]')]
    .find(h => h.dataset.collapseKey === key);
  if (header) { toggleSource(header, key); return; }

  // Quelle nicht im DOM (sollte nicht vorkommen) — wenigstens den Zustand pflegen
  state.collapsedSources[key] = !state.collapsedSources[key];
  persist('keasy-collapsed-sources', JSON.stringify(state.collapsedSources));
  renderErrorIndex();
}

// Angesprungenen Eintrag markieren. Die Markierung bleibt stehen, bis der
// nächste angesprungen wird — ein reines Aufblitzen ist nach gut einer Sekunde
// weg, und danach ist nicht mehr zu sehen, wo man gelandet ist.
// Sie ist bewusst NICHT rot codiert: siehe .error-entry.is-current in style.css.
function applyCurrentEntry() {
  document.querySelectorAll('.error-entry.is-current')
    .forEach(el => el.classList.remove('is-current'));
  if (!state.currentEntry) return;

  // Über die Objektreferenz wiederfinden — die IDs werden bei jedem Neuaufbau
  // neu vergeben, die Fehler-Objekte selbst bleiben dieselben.
  const nav = state.navEntries.find(n => n.ref === state.currentEntry.ref);
  if (!nav) return;
  const el = document.getElementById(nav.id);
  if (el) el.classList.add('is-current');
  // Beim Sprung führt das Sprungziel auch die Liste
  setActiveRow(nav.ref);
}

// --- „Du bist hier": Seitenleiste folgt dem Scrollen der Hauptliste ---
//
// Eine Markierung, zwei Auslöser: ein Sprung setzt sie, Scrollen verschiebt sie.
// Der Rahmen im Fehlertext (.is-current) bleibt davon unberührt und markiert
// weiter das Sprungziel — ein mitwandernder Rahmen mitten im Lesebereich wäre
// Unruhe, in der schmalen Liste ist die wandernde Zeile dagegen genau die
// gesuchte Auskunft.

let inViewRef = null;   // Objektreferenz statt ID: IDs wechseln beim Neuaufbau
let spyObserver = null;

function setActiveRow(ref) {
  inViewRef = ref || null;
  const scroll = document.getElementById('indexScroll');
  if (!scroll) return;

  scroll.querySelectorAll('.idx-row.is-active').forEach(el => el.classList.remove('is-active'));
  if (!inViewRef) return;

  const nav = state.navEntries.find(n => n.ref === inViewRef);
  if (!nav) return;
  const row = scroll.querySelector(`.idx-row[data-entry="${nav.id}"]`);
  if (!row) return;   // Zeile ausgefiltert oder Quelle zugeklappt
  row.classList.add('is-active');

  // In Sicht holen — bewusst über scrollTop statt scrollIntoView: das würde
  // auch die Seite darunter scrollen und den Blick vom Fehlertext wegreißen.
  const top = row.offsetTop;
  const bottom = top + row.offsetHeight;
  if (top < scroll.scrollTop) scroll.scrollTop = top - 8;
  else if (bottom > scroll.scrollTop + scroll.clientHeight) {
    scroll.scrollTop = bottom - scroll.clientHeight + 8;
  }
}

// Beobachtet die Einträge der Hauptliste. Muss nach jedem Neuaufbau neu
// aufgesetzt werden — renderAll() ersetzt sämtliche Elemente.
function observeEntries() {
  if (spyObserver) spyObserver.disconnect();
  if (typeof IntersectionObserver === 'undefined') return;
  const container = document.getElementById('container');
  if (!container) return;

  const visible = new Set();
  spyObserver = new IntersectionObserver(changes => {
    for (const c of changes) {
      if (c.isIntersecting) visible.add(c.target.id);
      else visible.delete(c.target.id);
    }
    // navEntries hat dieselbe Reihenfolge wie das DOM (beides entsteht in
    // buildErrorEntryHtml) — der erste Treffer ist also der oberste Eintrag.
    const hit = state.navEntries.find(n => visible.has(n.id));
    const ref = hit ? hit.ref : null;
    if (ref !== inViewRef) setActiveRow(ref);
  }, {
    // Leseband: nur was das obere Viertel bis Drittel des Fensters kreuzt,
    // gilt als „hier bin ich". Ohne dieses Band waeren bei langen
    // Stack-Traces mehrere Eintraege gleichzeitig „sichtbar".
    rootMargin: '-25% 0px -65% 0px',
    threshold: 0
  });

  container.querySelectorAll('.error-entry[id]').forEach(el => spyObserver.observe(el));
}

function buildRowHtml(entry, nr) {
  const levelClass = entry.level !== 'normal' ? ` lvl-${entry.level}` : '';
  const title = `${entry.time} — ${entry.file}`;
  return `<button class="idx-row${levelClass}" type="button" data-entry="${entry.id}"
            title="${escapeHtml(title)}" onclick="jumpToEntry('${escapeJs(entry.id)}', event)">
            <span class="idx-nr">${nr}</span>
            <span class="idx-time">${entry.time}</span>
            <span class="idx-text">
              <span class="idx-msg">${escapeHtml(entry.summary)}</span>
              <span class="idx-origin">${escapeHtml(shortFileName(entry.file))}</span>
            </span>
          </button>`;
}

function renderErrorIndex() {
  const panel = document.getElementById('errorIndex');
  if (!panel) return;

  applyIndexLayout();

  const scroll = document.getElementById('indexScroll');
  // Scrollposition sichern: renderAll() baut bei jedem eingehenden Fehler alles
  // neu auf — ohne das springt die Liste im Live-Betrieb dauernd an den Anfang.
  const scrollTop = scroll ? scroll.scrollTop : 0;

  const shown = state.indexCritOnly
    ? state.navEntries.filter(e => e.level === 'kritisch')
    : state.navEntries;

  const totalEl = document.getElementById('indexTotal');
  if (totalEl) totalEl.textContent = shown.length;

  const allBtn = document.getElementById('indexFilterAll');
  const critBtn = document.getElementById('indexFilterCrit');
  if (allBtn) allBtn.setAttribute('aria-pressed', String(!state.indexCritOnly));
  if (critBtn) critBtn.setAttribute('aria-pressed', String(state.indexCritOnly));

  if (!scroll) return;

  if (shown.length === 0) {
    scroll.innerHTML = state.indexCritOnly
      ? `<p class="idx-empty">Kein kritischer Fehler.</p>`
      : `<p class="idx-empty">Keine Einträge.</p>`;
    return;
  }

  // Nach Quelle gruppieren — Reihenfolge folgt der Anzeige, weil navEntries
  // in genau dieser Reihenfolge gefüllt wird
  const groups = new Map();
  for (const entry of shown) {
    if (!groups.has(entry.label)) groups.set(entry.label, []);
    groups.get(entry.label).push(entry);
  }

  let html = '';
  for (const [label, list] of groups) {
    const key = list[0].collapseKey;
    const isCollapsed = state.collapsedSources[key] === true;
    const critCount = list.filter(e => e.level === 'kritisch').length;
    const analyzeClass = list[0].isAnalyze ? ' is-analyze' : '';
    const critBadge = (critCount > 0 && !state.indexCritOnly)
      ? `<span class="idx-group-crit" title="${critCount} kritisch">🔴 ${critCount}</span> `
      : '';

    html += `
      <div class="idx-group-head${analyzeClass}" role="button" tabindex="0"
           aria-expanded="${!isCollapsed}"
           onclick="toggleIndexGroup('${escapeJs(key)}')">
        <span class="idx-group-name"><span class="idx-arrow">${isCollapsed ? '▶' : '▼'}</span> ${escapeHtml(label)}</span>
        <span class="idx-group-meta">${critBadge}<span class="idx-count">${list.length}</span></span>
      </div>`;

    if (isCollapsed) continue;
    list.forEach((entry, i) => { html += buildRowHtml(entry, i + 1); });
  }

  scroll.innerHTML = html;
  scroll.scrollTop = scrollTop;
  applyCurrentEntry();
  // Beobachter neu aufsetzen: renderAll() hat alle Eintrags-Elemente ersetzt.
  // Danach die Lesemarke wiederherstellen — sie haengt an der Objektreferenz,
  // ueberlebt den Neuaufbau also, braucht aber die neue Zeile.
  observeEntries();
  if (inViewRef && !state.currentEntry) setActiveRow(inViewRef);
}

window.Keasy.errorIndex = {
  renderErrorIndex, toggleIndexPanel, swapIndexSide,
  setIndexSeverity, toggleIndexGroup, applyCurrentEntry, applyIndexLayout,
  setActiveRow, observeEntries
};

Object.assign(window, {
  renderErrorIndex, toggleIndexPanel, swapIndexSide, setIndexSeverity, toggleIndexGroup
});
})();
