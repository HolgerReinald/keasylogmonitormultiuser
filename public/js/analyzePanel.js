(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;
const { escapeHtml } = Keasy.utils;

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
    _analyzeLoaded = true;
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

function removeAnalyzePath(index) {
  state.analyzePaths.splice(index, 1);
  renderAnalyzePaths();
  updateAnalyzeButtons();
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
      <button onclick="removeAnalyzePath(${i})" style="background:none; border:none; cursor:pointer; font-size:1em;" title="Entfernen" aria-label="Pfad entfernen">❌</button>
    </div>`
  ).join('');
}

function updateAnalyzeButtons() {
  const startBtn = document.getElementById('analyzeStartBtn');
  const clearBtn = document.getElementById('analyzeClearBtn');
  const hasPaths = state.analyzePaths.length > 0;
  const hasResults = Object.keys(state.analyzeErrors).length > 0;
  startBtn.disabled = !hasPaths || state.analyzeIsRunning;
  clearBtn.disabled = state.analyzeIsRunning || (!hasResults && !state.analyzeIsRunning);
}

async function startAnalysis() {
  if (state.analyzePaths.length === 0) return;
  const maxErrors = parseInt(document.getElementById('analyzeMaxErrors').value) || 100;
  try {
    const resp = await fetch('/api/analyze-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: state.analyzePaths, maxErrorsPerFile: maxErrors })
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

function updateAnalyzeProgress(current, total, errorCount, running, aborted, skippedPaths) {
  const progress = document.getElementById('analyzeProgress');
  const bar = document.getElementById('analyzeProgressBar');
  const status = document.getElementById('analyzeStatus');
  progress.style.display = '';
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  bar.style.width = pct + '%';

  if (running) {
    state.analyzeIsRunning = true;
    let text = `${current}/${total} Dateien (${errorCount} Fehler gefunden)`;
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
      status.textContent = `⏹ Abgebrochen: ${current}/${total} Dateien, ${errorCount} Fehler`;
    } else if (total === 0) {
      status.textContent = '⚠️ Keine .log-Dateien gefunden in den angegebenen Pfaden';
    } else {
      status.textContent = `✅ Abgeschlossen: ${errorCount} Fehler in ${total} Dateien`;
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

window.Keasy.analyze = {
  toggleAnalyzePanel, loadAnalyzeConfig, addAnalyzePath, removeAnalyzePath, renderAnalyzePaths, updateAnalyzeButtons,
  startAnalysis, cancelAnalysis, clearAnalysis, saveAnalyzePaths,
  showAnalyzeStatus, updateAnalyzeProgress, toggleAnalyzeImport, importAnalyzePaths
};

Object.assign(window, {
  toggleAnalyzePanel, addAnalyzePath, removeAnalyzePath, startAnalysis, cancelAnalysis,
  clearAnalysis, saveAnalyzePaths, updateAnalyzeButtons,
  renderAnalyzePaths, updateAnalyzeProgress, showAnalyzeStatus,
  toggleAnalyzeImport, importAnalyzePaths
});
})();
