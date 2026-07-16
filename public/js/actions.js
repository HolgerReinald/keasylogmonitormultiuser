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
  copyErrorToClipboard, exportToCopilot, onSearch, clearAnalyzeSource, clearPerformanceSource
};

Object.assign(window, {
  openFolder, openFile, openFileAtError, toggleGroup, toggleSource,
  clearAll, stopServer, restartWatcher, pauseSource, resumeSource,
  clearSource, disableEmail, enableEmail, pauseToggle,
  copyErrorToClipboard, exportToCopilot, onSearch, clearAnalyzeSource, clearPerformanceSource
});
})();
