(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;

function openFolder(filePath, event) {
  event.stopPropagation();
  fetch('/api/open-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath })
  });
}

function openFile(filePath, event) {
  event.stopPropagation();
  fetch('/api/open-file-at-line', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath })
  });
}

function openFileAtError(filePath, searchText, event) {
  if (event) event.stopPropagation();
  fetch('/api/open-file-at-line', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, searchText })
  });
}

function toggleGroup(header) {
  const list = header.nextElementSibling;
  list.style.display = list.style.display === 'none' ? 'block' : 'none';
}

function toggleSource(header, label) {
  const content = header.nextElementSibling;
  const isCollapsed = !content.classList.contains('collapsed');
  content.classList.toggle('collapsed');
  state.collapsedSources[label] = isCollapsed;
  localStorage.setItem('keasy-collapsed-sources', JSON.stringify(state.collapsedSources));
  const arrow = header.querySelector('.toggle-arrow');
  if (arrow) arrow.textContent = isCollapsed ? '▶' : '▼';
  // Die Seitenleiste folgt: EIN Auf-/Zu-Zustand je Quelle, nicht zwei.
  // Sonst zeigen Hauptansicht und Index verschiedene Wahrheiten.
  if (Keasy.errorIndex) Keasy.errorIndex.renderErrorIndex();
  updateCollapseAllButton();
}

// Alle Quellen auf einmal zu- oder aufklappen. Zielzustand: ist irgendeine
// Quelle offen, werden alle zugeklappt — sonst alle aufgeklappt.
// Setzt den Zustand gebündelt und schreibt einmal in den localStorage,
// statt toggleSource je Quelle aufzurufen (das würde N-mal neu rendern).
function toggleAllSources() {
  const headers = [...document.querySelectorAll('.source-header[data-collapse-key], .analyze-wrap-head[data-collapse-key]')];
  if (headers.length === 0) return;

  const collapseAll = headers.some(h => !h.nextElementSibling.classList.contains('collapsed'));

  for (const header of headers) {
    const content = header.nextElementSibling;
    if (content.classList.contains('collapsed') === collapseAll) continue; // schon im Ziel
    content.classList.toggle('collapsed', collapseAll);
    const arrow = header.querySelector('.toggle-arrow');
    if (arrow) arrow.textContent = collapseAll ? '▶' : '▼';
    state.collapsedSources[header.dataset.collapseKey] = collapseAll;
  }

  localStorage.setItem('keasy-collapsed-sources', JSON.stringify(state.collapsedSources));
  if (Keasy.errorIndex) Keasy.errorIndex.renderErrorIndex();
  updateCollapseAllButton();
}

// Beschriftung sagt, was der Klick tut — nicht, wie der Zustand gerade ist.
function updateCollapseAllButton() {
  const btn = document.getElementById('collapseAllBtn');
  if (!btn) return;
  const headers = [...document.querySelectorAll('.source-header[data-collapse-key], .analyze-wrap-head[data-collapse-key]')];
  btn.disabled = headers.length === 0;
  const anyOpen = headers.some(h => !h.nextElementSibling.classList.contains('collapsed'));
  btn.textContent = anyOpen ? '⊟ Alle zu' : '⊞ Alle auf';
  btn.title = anyOpen ? 'Alle Quellen zuklappen' : 'Alle Quellen aufklappen';
}

// Eintragsliste einer Datei einblenden und den ersten kritischen Eintrag zurückgeben
function expandAndFindCritical(fileGroup) {
  const list = fileGroup.querySelector('.error-list');
  if (list) list.style.display = 'block';
  return fileGroup.querySelector('.error-entry.sev-kritisch');
}

// Gemeinsamer Abschluss aller Sprünge: Liste einblenden, markieren, hinscrollen,
// kurz aufblitzen. Eine Stelle, damit Alarmknopf und Fehler-Index nicht zwei
// verschiedene Sprungmechaniken haben.
// Liegt das Ziel im Analyse-Sammelblock und ist der zugeklappt, muss er zuerst
// auf: sonst springt man in ein display:none-Element und es passiert scheinbar
// nichts. Hier und nicht in den Aufrufern, weil focusEntry die gemeinsame
// Endstelle aller Spruenge ist (Index, Alarmknopf).
function expandAnalyzeWrap(target) {
  const wrap = target.closest('.analyze-wrap');
  if (!wrap) return;
  const head = wrap.querySelector('.analyze-wrap-head');
  const body = head && head.nextElementSibling;
  if (head && body && body.classList.contains('collapsed')) {
    toggleSource(head, head.dataset.collapseKey);
  }
}

function focusEntry(target) {
  if (!target) return;
  expandAnalyzeWrap(target);
  const list = target.closest('.error-list');
  if (list) list.style.display = 'block';

  // Dauerhafte Markierung über die Objektreferenz merken — sie überlebt den
  // Neuaufbau durch renderAll(), eine Element-ID täte das nicht.
  const nav = state.navEntries.find(n => n.id === target.id);
  state.currentEntry = nav ? { ref: nav.ref, filePath: nav.filePath } : null;
  if (Keasy.errorIndex) Keasy.errorIndex.applyCurrentEntry();

  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Aufblitzen neu starten, auch wenn derselbe Eintrag erneut angesprungen wird
  target.classList.remove('jump-flash');
  void target.offsetWidth;
  target.classList.add('jump-flash');
}

// Sprung aus dem Fehler-Index. Klappt die Quelle auf, falls sie zu ist —
// toggleSource() merkt sich den Zustand, deshalb nicht direkt am DOM drehen.
function jumpToEntry(entryId, event) {
  if (event) event.stopPropagation();
  const target = document.getElementById(entryId);
  if (!target) return;

  const sourceGroup = target.closest('.source-group');
  const content = sourceGroup && sourceGroup.querySelector('.source-content');
  if (content && content.classList.contains('collapsed')) {
    const nav = state.navEntries.find(n => n.id === entryId);
    toggleSource(sourceGroup.querySelector('.source-header'), nav ? nav.collapseKey : '');
  }
  focusEntry(target);
}

// 🚨-Alarmknopf: zum ersten kritischen Eintrag springen.
// Auf Datei-Ebene ohne label, auf Quellen-Ebene mit — dort muss die Quelle
// erst aufgeklappt werden, und das übernimmt toggleSource (merkt sich den Zustand).
function jumpToCritical(btn, event, label) {
  if (event) event.stopPropagation(); // sonst klappt der Header darunter zu
  if (btn.disabled || btn.classList.contains('is-idle')) return;

  let target = null;
  const fileGroup = btn.closest('.file-group');
  // Der Alarmknopf im Kopf des Analyse-Sammelblocks sitzt AUSSERHALB der
  // Quellgruppen -- closest('.source-group') findet dort nichts, der Knopf waere
  // ohne diesen Zweig ein stiller Blindgaenger. Reihenfolge des Aufklappens:
  // Sammelblock, dann die Quelle mit dem kritischen Eintrag, dann die Datei.
  const wrapHead = btn.closest('.analyze-wrap-head');

  if (fileGroup) {
    target = expandAndFindCritical(fileGroup);
  } else if (wrapHead) {
    // querySelector findet auch in einem zugeklappten (display:none) Block --
    // sichtbar macht ihn anschliessend focusEntry.
    const body = wrapHead.nextElementSibling;
    const kritDatei = body ? body.querySelector('.file-group.has-kritisch') : null;
    if (kritDatei) {
      const srcHeader = kritDatei.closest('.source-group')?.querySelector('.source-header');
      const srcContent = srcHeader && srcHeader.nextElementSibling;
      if (srcHeader && srcContent && srcContent.classList.contains('collapsed')) {
        toggleSource(srcHeader, srcHeader.dataset.collapseKey);
      }
      target = expandAndFindCritical(kritDatei);
    }
  } else {
    const sourceGroup = btn.closest('.source-group');
    if (!sourceGroup) return;
    const content = sourceGroup.querySelector('.source-content');
    if (label != null && content && content.classList.contains('collapsed')) {
      toggleSource(sourceGroup.querySelector('.source-header'), label);
    }
    const firstCriticalFile = sourceGroup.querySelector('.file-group.has-kritisch');
    if (firstCriticalFile) target = expandAndFindCritical(firstCriticalFile);
  }

  focusEntry(target);
}

function clearAll() {
  const dateFrom = document.getElementById('dateFrom').value;
  const dateTo = document.getElementById('dateTo').value;
  const today = getLocalDateStr();
  const isDateFiltered = (dateFrom && dateFrom !== today) || (dateTo && dateTo !== today);
  const cutoff = state.timeFilterHours > 0 ? new Date(Date.now() - state.timeFilterHours * 60 * 60 * 1000).toISOString() : undefined;
  const sendFrom = isDateFiltered ? dateFrom : undefined;
  const sendTo = isDateFiltered ? dateTo : undefined;
  fetch('/api/clear-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dateFrom: sendFrom, dateTo: sendTo, cutoff })
  });
  if (isDateFiltered || cutoff) {
    for (const fp of Object.keys(state.errors)) {
      state.errors[fp] = state.errors[fp].filter(e => {
        const t = new Date(e.timestamp);
        if (cutoff && t < new Date(cutoff)) return true;
        if (dateFrom && t < new Date(dateFrom + 'T00:00:00')) return true;
        if (dateTo && t > new Date(dateTo + 'T23:59:59.999')) return true;
        return false;
      });
      if (state.errors[fp].length === 0) delete state.errors[fp];
    }
  } else {
    state.errors = {};
  }
  renderAll();
}

async function stopServer() {
  if (!await showConfirm('Monitor wirklich beenden?')) return;
  state.serverStopped = true;
  fetch('/api/stop-server', { method: 'POST' });
  document.getElementById('statusDot').classList.remove('connected');
  document.getElementById('statusText').textContent = 'Monitor beendet';
  const btn = document.getElementById('stopBtn');
  btn.disabled = true;
  btn.style.opacity = '0.4';
  btn.style.cursor = 'not-allowed';
  document.getElementById('restartWatcherBtn').disabled = true;
}

async function restartWatcher() {
  if (state.serverStopped) return;
  const btn = document.getElementById('restartWatcherBtn');
  btn.disabled = true;
  btn.textContent = '🔄 Neustart...';
  try {
    const resp = await fetch('/api/restart-watcher', { method: 'POST' });
    if (resp.ok) {
      // Lokale Fehler leeren — Server hat errorStore geleert, Dateien werden neu eingelesen
      state.errors = {};
      btn.textContent = '✅ Neu gestartet';
      if (typeof renderAll === 'function') renderAll();
    } else {
      btn.textContent = '❌ Fehler';
    }
  } catch (err) {
    btn.textContent = '❌ Fehler';
  } finally {
    setTimeout(() => { btn.textContent = '🔄 Watcher neu starten'; if (!state.serverStopped) btn.disabled = false; }, 2000);
  }
}

function pauseSource(label, event) {
  if (event) event.stopPropagation();
  fetch('/api/pause-source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label })
  });
}

function resumeSource(label, event) {
  if (event) event.stopPropagation();
  fetch('/api/resume-source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label })
  });
}

function clearSource(label, event) {
  if (event) event.stopPropagation();
  const dateFrom = document.getElementById('dateFrom').value;
  const dateTo = document.getElementById('dateTo').value;
  const today = getLocalDateStr();
  const isDateFiltered = (dateFrom && dateFrom !== today) || (dateTo && dateTo !== today);
  const cutoff = state.timeFilterHours > 0 ? new Date(Date.now() - state.timeFilterHours * 60 * 60 * 1000).toISOString() : null;
  fetch('/api/clear-source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, dateFrom: isDateFiltered ? dateFrom : null, dateTo: isDateFiltered ? dateTo : null, cutoff })
  });
}

function disableEmail(label, event) {
  if (event) event.stopPropagation();
  fetch('/api/email-disable-source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label })
  });
}

function enableEmail(label, event) {
  if (event) event.stopPropagation();
  fetch('/api/email-enable-source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label })
  });
}

function pauseToggle() {
  state.paused = !state.paused;
  document.getElementById('pauseBtn').textContent = state.paused ? '▶️ Fortsetzen' : '⏸️ Pause';
  if (!state.paused) renderAll();
}

async function copyErrorToClipboard(filePath, errIndex, isAnalyze, event) {
  if (event) event.stopPropagation();
  const store = isAnalyze ? state.analyzeErrors : state.errors;
  const entries = store[filePath];
  if (!entries || !entries[errIndex]) return;
  const text = entries[errIndex].line;
  try {
    await navigator.clipboard.writeText(text);
    showTrashStatus('📋 Fehlertext kopiert');
  } catch {
    showTrashStatus('❌ Kopieren fehlgeschlagen');
  }
}

// Komplette Log-Datei ins Copilot-Verzeichnis kopieren (Knoepfe in der
// Datei-Kopfzeile). Anders als exportToCopilot wird KEIN Inhalt geschickt:
// parseJsonBody deckelt bei 1 MB, Logs sind groesser. Der Server liest die
// Datei selbst — deshalb prueft er auch, ob der Pfad einer ist, den er
// ohnehin anzeigt.
async function exportFileToCopilot(filePath, target, event) {
  if (event) event.stopPropagation();
  const btn = event && event.currentTarget;
  if (btn) btn.disabled = true;
  const targetLabel = target === 'release' ? 'Release' : 'Develop';
  try {
    const resp = await fetch('/api/export-copilot-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath, target })
    });
    const result = await resp.json();
    if (result.ok) {
      const kb = result.size ? ` (${(result.size / 1024).toFixed(0)} KB)` : '';
      showTrashStatus(`${target === 'release' ? '🚀' : '🤖'} ${targetLabel}: ` + result.outputPath + kb);
    } else {
      showTrashStatus('❌ ' + targetLabel + ': ' + result.message);
    }
  } catch (e) {
    showTrashStatus('❌ ' + targetLabel + ': ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function exportToCopilot(filePath, errIndex, isAnalyze, target, event) {
  if (event) event.stopPropagation();
  const btn = event && event.currentTarget;
  if (btn) btn.disabled = true;
  const store = isAnalyze ? state.analyzeErrors : state.errors;
  const labelMap = isAnalyze ? state.analyzeLabels : state.fileLabels;
  const entries = store[filePath];
  if (!entries || !entries[errIndex]) { if (btn) btn.disabled = false; return; }
  const err = entries[errIndex];
  const targetLabel = target === 'release' ? 'Release' : 'Develop';
  try {
    const resp = await fetch('/api/export-copilot-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ errorText: err.line, filePath, timestamp: err.timestamp, label: labelMap[filePath] || '', target })
    });
    const result = await resp.json();
    if (result.ok) {
      showTrashStatus(`${target === 'release' ? '🚀' : '🤖'} ${targetLabel}: ` + result.outputPath);
    } else {
      showTrashStatus('❌ ' + targetLabel + ': ' + result.message);
    }
  } catch (e) {
    showTrashStatus('❌ ' + targetLabel + ': ' + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function onSearch(value) {
  state.searchTerm = value.trim().toLowerCase();
  if (state.searchTerm && state.searchTerm.includes('*')) {
    const escaped = state.searchTerm.replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*');
    try { state.searchRegex = new RegExp(escaped, 'i'); } catch { state.searchRegex = null; }
  } else {
    state.searchRegex = null;
  }
  renderAll();
}

function clearAnalyzeSource(label, event) {
  if (event) event.stopPropagation();
  fetch('/api/analyze-clear-source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label })
  });
  // Sofort clientseitig leeren
  const state = Keasy.state;
  for (const fp of Object.keys(state.analyzeErrors)) {
    if (state.analyzeLabels[fp] === label) {
      delete state.analyzeErrors[fp];
      delete state.analyzeLabels[fp];
    }
  }
  if (typeof renderAll === 'function') renderAll();
}

function clearPerformanceSource(label, event) {
  if (event) event.stopPropagation();
  fetch('/api/performance-clear-source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label })
  }).then(resp => {
    if (!resp.ok) showToast('Performance-Einträge löschen fehlgeschlagen', 'error');
  }).catch(err => showToast('Performance-Löschen: ' + err.message, 'error'));
  // Sofort clientseitig leeren
  const state = Keasy.state;
  for (const fp of Object.keys(state.performanceEntries)) {
    if (state.performanceLabels[fp] === label) {
      delete state.performanceEntries[fp];
      delete state.performanceLabels[fp];
    }
  }
  if (typeof renderAll === 'function') renderAll();
}

window.Keasy.actions = {
  openFolder, openFile, openFileAtError, toggleGroup, toggleSource,
  clearAll, stopServer, restartWatcher, pauseSource, resumeSource,
  clearSource, disableEmail, enableEmail, pauseToggle,
  copyErrorToClipboard, exportToCopilot, exportFileToCopilot, onSearch, clearAnalyzeSource, clearPerformanceSource,
  jumpToCritical, jumpToEntry, toggleAllSources, updateCollapseAllButton
};

Object.assign(window, {
  openFolder, openFile, openFileAtError, toggleGroup, toggleSource,
  clearAll, stopServer, restartWatcher, pauseSource, resumeSource,
  clearSource, disableEmail, enableEmail, pauseToggle,
  copyErrorToClipboard, exportToCopilot, exportFileToCopilot, onSearch, clearAnalyzeSource, clearPerformanceSource,
  jumpToCritical, jumpToEntry, toggleAllSources, updateCollapseAllButton
});
})();
