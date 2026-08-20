(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;
const { escapeHtml, escapeJs } = Keasy.utils;

let _analyzeLoaded = false;

function toggleAnalyzePanel() {
  const panel = document.getElementById('analyzePanel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) {
    // Config-Panel schließen wenn offen
    document.getElementById('configPanel').classList.remove('open');
    if (!_analyzeLoaded) {
      loadAnalyzeConfig();
    } else {
      renderAnalyzePaths();
      updateAnalyzeButtons();
    }
  }
}

async function loadAnalyzeConfig() {
  try {
    const resp = await fetch('/api/config');
    const cfg = await resp.json();
    state.analyzePaths = [...(cfg.analyzePaths || [])];
    document.getElementById('analyzeMaxErrors').value = cfg.analyzeMaxErrors || 100;
    // Nie konfiguriert (undefined) → Richtwert 20; explizite 0 bleibt "aus"
    document.getElementById('analyzeGapWarnSeconds').value = cfg.analyzeGapWarnSeconds ?? 20;
    document.getElementById('analyzeGapIdleMinutes').value = cfg.analyzeGapIdleMinutes || '';
    _analyzeLoaded = true;
    loadDroppedFiles();
    renderAnalyzePaths();
    updateAnalyzeButtons();
  } catch (err) {
    console.error('[Analyze] Config laden fehlgeschlagen:', err.message);
  }
}

async function addAnalyzePath() {
  const input = document.getElementById('analyzePath');
  const errorEl = document.getElementById('analyzePathError');
  const p = input.value.trim();
  errorEl.style.display = 'none';
  if (!p) return;
  if (state.analyzePaths.includes(p)) { input.value = ''; return; }

  // Server-seitige Validierung
  try {
    const resp = await fetch('/api/analyze-validate-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p })
    });
    const result = await resp.json();
    if (!result.ok) {
      errorEl.textContent = '⚠️ ' + result.message;
      errorEl.style.display = 'block';
      return;
    }
  } catch (err) {
    errorEl.textContent = '⚠️ Validierung fehlgeschlagen: ' + err.message;
    errorEl.style.display = 'block';
    return;
  }

  state.analyzePaths.push(p);
  input.value = '';
  renderAnalyzePaths();
  updateAnalyzeButtons();
}

// Oeffnet den Pfad im Explorer. Dieselbe Route wie bei den Fehlereintraegen
// und den Backup-Zielen (/api/open-folder) — kein zweiter Weg fuer dasselbe.
// Hinweis fuer den Mehrbenutzerbetrieb: der Explorer geht auf dem RECHNER DES
// SERVERS auf. Wer das Dashboard von einem anderen PC oeffnet, sieht nichts.
function openAnalyzePath(index) {
  const p = state.analyzePaths[index];
  if (!p) return;
  fetch('/api/open-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath: p })
  }).catch(err => showToast('Öffnen fehlgeschlagen: ' + err.message, 'error'));
}

function removeAnalyzePath(index) {
  state.analyzePaths.splice(index, 1);
  renderAnalyzePaths();
  updateAnalyzeButtons();
}

// Ordner-Picker fürs Analyse-Eingabefeld — füllt #analyzePath, Hinzufügen erfolgt wie gewohnt
async function pickAnalyzeFolder() {
  const input = document.getElementById('analyzePath');
  if (!input || typeof showFolderPicker !== 'function') return;
  const chosen = await showFolderPicker(input.value.trim() || '');
  if (chosen) {
    input.value = chosen;
    input.focus();
  }
}

function renderAnalyzePaths() {
  const list = document.getElementById('analyzePathList');
  if (state.analyzePaths.length === 0) {
    list.innerHTML = '<em style="color:var(--text-secondary);">Keine Pfade hinzugefügt</em>';
    return;
  }
  list.innerHTML = state.analyzePaths.map((p, i) =>
    `<div style="display:flex; align-items:center; gap:6px; padding:3px 0;">
      <code style="flex:1; font-size:0.85em; background:var(--bg-tertiary); padding:2px 6px; border-radius:3px; word-break:break-all;">${escapeHtml(p)}</code>
      <button onclick="openAnalyzePath(${i})" style="background:none; border:none; cursor:pointer; font-size:1em;" title="Pfad im Explorer öffnen" aria-label="Pfad im Explorer öffnen">↗️</button>
      <button onclick="removeAnalyzePath(${i})" style="background:none; border:none; cursor:pointer; font-size:1em;" title="Entfernen" aria-label="Pfad entfernen">❌</button>
    </div>`
  ).join('') + renderDroppedGroup();
}

// === Abgelegte Log-Dateien (Drag & Drop) ===
//
// Warum ueberhaupt Upload: ein Browser gibt beim Ablegen Name, Groesse und
// Inhalt heraus, aber NICHT den Pfad. Die Analyse arbeitet pfadbasiert, also
// wird der Inhalt hochgeladen und serverseitig abgelegt; die Auswertung selbst
// bleibt unveraendert. Nebengewinn: wer das Dashboard von einem anderen
// Rechner oeffnet, kann damit seine eigenen Dateien analysieren statt nur die,
// die der Server sieht.

const DROP_EXT = ['.log', '.json', '.zip'];

function fmtDropSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

// Abgewiesene Dateien bleiben sichtbar mit Grund. Sie stillschweigend zu
// verschlucken waere die schlechtere Variante: man wundert sich sonst, warum
// vier Dateien hineingezogen und nur zwei ausgewertet wurden.
function renderDroppedGroup() {
  const files = state.analyzeDropped || [];
  const bad = state.analyzeDroppedRejected || [];
  if (!files.length && !bad.length) return '';
  const rows = files.map(f => `
    <div class="dropped-row">
      <code>${escapeHtml(f.name)}</code>
      <span class="sz">${fmtDropSize(f.size)}</span>
      <button class="x-btn" onclick="removeDroppedFile('${escapeJs(f.name)}')" title="Entfernen" aria-label="Datei entfernen">❌</button>
    </div>`).join('');
  const badRows = bad.map((b, i) => `
    <div class="dropped-row is-bad">
      <code>${escapeHtml(b.name)}</code>
      <span class="why">✕ ${escapeHtml(b.reason)}</span>
      <button class="x-btn" onclick="dismissDroppedReject(${i})" title="Hinweis ausblenden" aria-label="Hinweis ausblenden">❌</button>
    </div>`).join('');
  const pending = state.analyzeDroppedBusy
    ? '<div class="dropped-row"><span class="sz">⏳ übertrage …</span></div>'
    : '';
  return `
    <div class="dropped-group">
      <div class="dropped-head">
        <span>📄 Abgelegte Dateien</span>
        <span class="dropped-badge">temporär · nicht in der Config</span>
        <span style="flex:1"></span>
        <button class="x-btn" onclick="clearDroppedFiles()" title="Alle entfernen" aria-label="Alle abgelegten Dateien entfernen">❌</button>
      </div>
      ${rows}${badRows}${pending}
      <div style="font-size:0.78em; color:var(--text-muted); margin-top:4px;">
        ${files.length} Datei${files.length === 1 ? '' : 'en'} werden mitanalysiert · bleiben bis „Ergebnisse löschen"
      </div>
    </div>`;
}

async function loadDroppedFiles() {
  try {
    const resp = await fetch('/api/analyze-dropped');
    const data = await resp.json();
    state.analyzeDropped = data.files || [];
  } catch {
    state.analyzeDropped = [];
  }
  renderAnalyzePaths();
  updateAnalyzeButtons();
}

// Eine Datei pro Anfrage, der Reihe nach: so gibt es Fortschritt je Datei, und
// eine abgewiesene Datei reisst nicht den ganzen Stapel mit.
async function uploadDroppedFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  state.analyzeDroppedRejected = state.analyzeDroppedRejected || [];
  state.analyzeDroppedBusy = true;
  renderAnalyzePaths();
  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (!DROP_EXT.some(e => lower.endsWith(e))) {
      state.analyzeDroppedRejected.push({ name: f.name, reason: 'nur ' + DROP_EXT.join(' / ') });
      continue;
    }
    if (f.size === 0) {
      state.analyzeDroppedRejected.push({ name: f.name, reason: 'leer' });
      continue;
    }
    try {
      const resp = await fetch('/api/analyze-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          // encodeURIComponent, damit Umlaute im Dateinamen den Header überleben
          'X-Filename': encodeURIComponent(f.name)
        },
        body: f
      });
      const data = await resp.json().catch(() => ({ ok: false, message: 'HTTP ' + resp.status }));
      if (!data.ok) {
        state.analyzeDroppedRejected.push({ name: f.name, reason: data.message || 'abgewiesen' });
      } else if (data.zip && data.skipped && data.skipped.length) {
        for (const sk of data.skipped) state.analyzeDroppedRejected.push({ name: sk.name, reason: sk.reason });
      }
    } catch (err) {
      state.analyzeDroppedRejected.push({ name: f.name, reason: err.message });
    }
  }
  state.analyzeDroppedBusy = false;
  await loadDroppedFiles();
}

async function removeDroppedFile(name) {
  try {
    await fetch('/api/analyze-drop-remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
  } catch (err) {
    showToast('Entfernen fehlgeschlagen: ' + err.message, 'error');
  }
  await loadDroppedFiles();
}

async function clearDroppedFiles() {
  try {
    await fetch('/api/analyze-drop-remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true })
    });
  } catch (err) {
    showToast('Entfernen fehlgeschlagen: ' + err.message, 'error');
  }
  state.analyzeDroppedRejected = [];
  await loadDroppedFiles();
}

function dismissDroppedReject(i) {
  (state.analyzeDroppedRejected || []).splice(i, 1);
  renderAnalyzePaths();
}

function updateAnalyzeButtons() {
  const startBtn = document.getElementById('analyzeStartBtn');
  const clearBtn = document.getElementById('analyzeClearBtn');
  // Nur abgelegte Dateien ohne konfigurierten Pfad ist ein gueltiger Lauf.
  const hasPaths = state.analyzePaths.length > 0 || (state.analyzeDropped || []).length > 0;
  const hasResults = Object.keys(state.analyzeErrors).length > 0;
  startBtn.disabled = !hasPaths || state.analyzeIsRunning;
  clearBtn.disabled = state.analyzeIsRunning || (!hasResults && !state.analyzeIsRunning);
}

async function startAnalysis() {
  if (state.analyzePaths.length === 0 && (state.analyzeDropped || []).length === 0) return;
  const maxErrors = parseInt(document.getElementById('analyzeMaxErrors').value) || 100;
  const gapWarnSeconds = parseInt(document.getElementById('analyzeGapWarnSeconds').value) || 0;
  const gapIdleMinutes = parseInt(document.getElementById('analyzeGapIdleMinutes').value) || 0;
  try {
    const resp = await fetch('/api/analyze-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: state.analyzePaths, maxErrorsPerFile: maxErrors, gapWarnSeconds, gapIdleMinutes })
    });
    const result = await resp.json();
    if (result.ok) {
      state.analyzeIsRunning = true;
      document.getElementById('analyzeStartBtn').style.display = 'none';
      document.getElementById('analyzeCancelBtn').style.display = '';
      updateAnalyzeButtons();
      document.getElementById('analyzePanel').classList.remove('open');
    } else {
      showAnalyzeStatus('❌ ' + result.message, 'error');
    }
  } catch (err) {
    showAnalyzeStatus('❌ ' + err.message, 'error');
  }
}

async function cancelAnalysis() {
  await fetch('/api/analyze-cancel', { method: 'POST' });
}

async function clearAnalysis() {
  // Sofort clientseitig leeren (optimistic)
  state.analyzeErrors = {};
  state.analyzeLabels = {};
  // Der Server raeumt die Ablage beim Leeren mit — Anzeige gleich mitziehen
  state.analyzeDropped = [];
  state.analyzeDroppedRejected = [];
  const progress = document.getElementById('analyzeProgress');
  progress.style.display = 'none';
  updateAnalyzeButtons();
  if (typeof renderAll === 'function') renderAll();
  // Server-Request fire-and-forget
  try {
    const resp = await fetch('/api/analyze-clear', { method: 'POST' });
    if (!resp.ok) showToast('Analyse-Clear fehlgeschlagen', 'error');
  } catch (err) {
    showToast('Analyse-Clear: ' + err.message, 'error');
  }
}

async function saveAnalyzePaths() {
  const msg = document.getElementById('analyzeSaveMessage');
  try {
    // Verwende buildConfigFromForm() statt fetch+patch,
    // damit alle Config-Werte (inkl. Backup/FTP) konsistent bleiben
    const cfg = typeof buildConfigFromForm === 'function'
      ? buildConfigFromForm()
      : await fetch('/api/config').then(r => r.json());
    cfg.analyzePaths = [...state.analyzePaths];
    cfg.analyzeMaxErrors = parseInt(document.getElementById('analyzeMaxErrors').value) || 100;
    cfg.analyzeGapWarnSeconds = parseInt(document.getElementById('analyzeGapWarnSeconds').value) || 0;
    cfg.analyzeGapIdleMinutes = parseInt(document.getElementById('analyzeGapIdleMinutes').value) || 0;
    const saveResp = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    });
    const result = await saveResp.json();
    if (result.ok) {
      msg.textContent = '✅ Pfade gespeichert';
      msg.style.color = '#10b981';
      state.currentConfig = cfg;
    } else {
      msg.textContent = '❌ ' + (result.message || 'Fehler');
      msg.style.color = '#ef4444';
    }
  } catch (err) {
    msg.textContent = '❌ ' + err.message;
    msg.style.color = '#ef4444';
  }
  msg.style.display = 'inline';
  setTimeout(() => { msg.style.display = 'none'; }, 3000);
}

function showAnalyzeStatus(text, type) {
  const status = document.getElementById('analyzeStatus');
  const progress = document.getElementById('analyzeProgress');
  progress.style.display = '';
  document.getElementById('analyzeProgressBar').style.width = '0%';
  status.textContent = text;
}

function updateAnalyzeProgress(current, total, errorCount, running, aborted, skippedPaths, gaps) {
  const progress = document.getElementById('analyzeProgress');
  const bar = document.getElementById('analyzeProgressBar');
  const status = document.getElementById('analyzeStatus');
  progress.style.display = '';
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  bar.style.width = pct + '%';
  const gapInfo = gaps > 0 ? `, ${gaps} ⏱️ Gaps` : '';

  if (running) {
    state.analyzeIsRunning = true;
    let text = `${current}/${total} Dateien (${errorCount} Fehler${gapInfo} gefunden)`;
    if (skippedPaths && skippedPaths.length > 0) {
      text += ` — ${skippedPaths.length} Pfade übersprungen`;
    }
    status.textContent = text;
  } else {
    state.analyzeIsRunning = false;
    document.getElementById('analyzeStartBtn').style.display = '';
    document.getElementById('analyzeCancelBtn').style.display = 'none';
    updateAnalyzeButtons();
    if (aborted) {
      status.textContent = `⏹ Abgebrochen: ${current}/${total} Dateien, ${errorCount} Fehler${gapInfo}`;
    } else if (total === 0) {
      // Endungen nennen: sonst raetselt man, wonach ueberhaupt gesucht wurde.
      status.textContent = '⚠️ Keine .log/.json-Dateien gefunden in den angegebenen Pfaden';
    } else {
      status.textContent = `✅ Abgeschlossen: ${errorCount} Fehler${gapInfo} in ${total} Dateien`;
    }
  }
}

// --- Import ---

function toggleAnalyzeImport() {
  const area = document.getElementById('analyzeImportArea');
  const show = area.style.display === 'none';
  area.style.display = show ? 'block' : 'none';
  if (show) {
    document.getElementById('analyzeImportText').value = '';
    document.getElementById('analyzeImportPreview').textContent = '';
  }
}

function importAnalyzePaths() {
  const text = document.getElementById('analyzeImportText').value.trim();
  if (!text) { showToast('Keine Pfade eingegeben', 'warn'); return; }

  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const existing = state.analyzePaths.map(p => p.toLowerCase());

  let added = 0, skipped = 0;
  for (const line of lines) {
    const p = line.split(/[;\t]/)[0]?.trim();
    if (!p) continue;
    if (existing.includes(p.toLowerCase())) { skipped++; continue; }
    state.analyzePaths.push(p);
    existing.push(p.toLowerCase());
    added++;
  }

  const msg = `${added} Pfad(e) importiert` + (skipped ? `, ${skipped} bereits vorhanden` : '');
  showToast(msg, added > 0 ? 'success' : 'warn');
  toggleAnalyzeImport();
  renderAnalyzePaths();
  updateAnalyzeButtons();
}

// Drag & Drop + Live-Vorschau für Analyse-Import
document.addEventListener('DOMContentLoaded', () => {
  const textarea = document.getElementById('analyzeImportText');
  if (textarea) {
    textarea.addEventListener('input', () => {
      const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      const existing = state.analyzePaths.map(p => p.toLowerCase());
      const newCount = lines.filter(l => {
        const p = l.split(/[;\t]/)[0]?.trim();
        return p && !existing.includes(p.toLowerCase());
      }).length;
      const preview = document.getElementById('analyzeImportPreview');
      preview.textContent = lines.length > 0 ? `${newCount} neue Pfade erkannt` : '';
    });
  }

  const dropZone = document.getElementById('analyzeDropZone');
  if (dropZone) {
    const overlay = document.getElementById('analyzeDropOverlay');
    let dragCounter = 0;

    dropZone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (overlay) overlay.style.display = 'flex';
      dropZone.style.borderColor = '#2ea043';
    });
    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        if (overlay) overlay.style.display = 'none';
        dropZone.style.borderColor = '';
      }
    });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      if (overlay) overlay.style.display = 'none';
      dropZone.style.borderColor = '';
      const file = e.dataTransfer.files[0];
      if (!file) return;
      handleAnalyzeImportFile(file);
    });
  }
});

function handleAnalyzeImportFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const textarea = document.getElementById('analyzeImportText');

  if (ext === 'csv' || ext === 'txt') {
    const reader = new FileReader();
    reader.onload = (e) => {
      textarea.value = e.target.result;
      textarea.dispatchEvent(new Event('input'));
      showToast(`📄 ${file.name} geladen`, 'success');
    };
    reader.readAsText(file, 'utf-8');
  } else {
    showToast(`Nicht unterstütztes Format: .${ext} (CSV oder TXT erwartet)`, 'warn');
  }
}

// Drop-Bereich verdrahten. Muster wie beim Pfad-Import: Listener beim
// DOMContentLoaded, damit die Verdrahtung an einer Stelle steht.
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('analyzeLogDrop');
  if (!zone) return;
  let depth = 0;
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; zone.classList.add('is-over'); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); });
  zone.addEventListener('dragleave', (e) => { e.preventDefault(); if (--depth <= 0) { depth = 0; zone.classList.remove('is-over'); } });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    zone.classList.remove('is-over');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      uploadDroppedFiles(e.dataTransfer.files);
    }
  });
  // Auch per Klick auswaehlbar — Drag & Drop ist bequem, aber nicht fuer alle
  // und nicht mit der Tastatur bedienbar.
  const picker = document.getElementById('analyzeLogPicker');
  if (picker) {
    zone.addEventListener('click', () => picker.click());
    picker.addEventListener('change', () => {
      uploadDroppedFiles(picker.files);
      picker.value = '';
    });
  }
});

window.Keasy.analyze = {
  toggleAnalyzePanel, loadAnalyzeConfig, addAnalyzePath, removeAnalyzePath, renderAnalyzePaths, updateAnalyzeButtons,
  startAnalysis, cancelAnalysis, clearAnalysis, saveAnalyzePaths,
  showAnalyzeStatus, updateAnalyzeProgress, toggleAnalyzeImport, importAnalyzePaths, pickAnalyzeFolder,
  loadDroppedFiles, uploadDroppedFiles, removeDroppedFile, clearDroppedFiles, openAnalyzePath
};

Object.assign(window, {
  toggleAnalyzePanel, addAnalyzePath, removeAnalyzePath, startAnalysis, cancelAnalysis,
  clearAnalysis, saveAnalyzePaths, updateAnalyzeButtons,
  renderAnalyzePaths, updateAnalyzeProgress, showAnalyzeStatus,
  toggleAnalyzeImport, importAnalyzePaths, pickAnalyzeFolder,
  removeDroppedFile, clearDroppedFiles, dismissDroppedReject, openAnalyzePath
});
})();
