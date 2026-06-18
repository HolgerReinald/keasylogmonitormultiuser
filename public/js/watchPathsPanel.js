/**
 * Keasy Log Monitor — WatchPaths Panel
 * WatchPath-Tabelle, Import (Textarea + Drag & Drop CSV/Excel/TXT).
 */
(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;
const escapeHtml = Keasy.utils.escapeHtml;

function renderWatchPathsTable(watchPaths) {
  const tbody = document.getElementById('cfg-watchpaths-body');
  tbody.innerHTML = '';
  watchPaths.forEach((wp, i) => {
    const row = document.createElement('tr');
    const p = typeof wp === 'string' ? wp : wp.path;
    const l = typeof wp === 'string' ? '' : (wp.label || '');
    const e = typeof wp === 'string' ? '' : (Array.isArray(wp.emailTo) ? wp.emailTo.join(', ') : (wp.emailTo || ''));
    const polling = typeof wp === 'string' ? false : !!wp.usePolling;
    const isNetwork = typeof wp === 'string' ? false : !!wp._isNetworkDrive;
    const networkHint = isNetwork ? '<span style="color:#888;font-size:11px;margin-left:4px" title="Netzlaufwerk erkannt – Polling wird automatisch aktiviert">(Netzlaufwerk)</span>' : '';
    row.innerHTML = `
      <td><input type="text" value="${escapeHtml(p)}" data-field="path" data-admin-only></td>
      <td><input type="text" value="${escapeHtml(l)}" data-field="label" data-admin-only></td>
      <td><input type="text" value="${escapeHtml(e)}" data-field="emailTo" placeholder="(keine)" title="E-Mail-Empfänger für diese Quelle. Mehrere Adressen kommagetrennt, z.B.: user@mail.de, admin@firma.de"></td>
      <td style="text-align:center"><input type="checkbox" data-field="usePolling" ${polling || isNetwork ? 'checked' : ''} ${isNetwork && !polling ? 'data-auto-polling="true"' : ''} data-admin-only>${networkHint}</td>
      <td><button class="remove-btn" onclick="removeWatchPathRow(${i})" data-admin-only>✕</button></td>
    `;
    tbody.appendChild(row);
  });
  // Re-apply admin-only restrictions on dynamically created elements
  if (window.Keasy && window.Keasy.auth && window.Keasy.auth.applyUserRole) {
    window.Keasy.auth.applyUserRole();
  }
}

function addWatchPathRow() {
  const tbody = document.getElementById('cfg-watchpaths-body');
  const i = tbody.rows.length;
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input type="text" value="" data-field="path" placeholder="C:\\Pfad\\zu\\Logs"></td>
    <td><input type="text" value="" data-field="label" placeholder="Mein Label"></td>
    <td><input type="text" value="" data-field="emailTo" placeholder="user@mail.de, admin@firma.de" title="E-Mail-Empfänger für diese Quelle. Mehrere Adressen kommagetrennt, z.B.: user@mail.de, admin@firma.de"></td>
    <td style="text-align:center"><input type="checkbox" data-field="usePolling" checked></td>
    <td><button class="remove-btn" onclick="removeWatchPathRow(${i})">✕</button></td>
  `;
  tbody.appendChild(row);
  Keasy.config.markConfigDirty();
}

function removeWatchPathRow(index) {
  const tbody = document.getElementById('cfg-watchpaths-body');
  if (tbody.rows[index]) tbody.deleteRow(index);
  const wps = getWatchPathsFromTable();
  renderWatchPathsTable(wps);
  Keasy.config.markConfigDirty();
}

function getWatchPathsFromTable() {
  const tbody = document.getElementById('cfg-watchpaths-body');
  const result = [];
  for (const row of tbody.rows) {
    const pathVal = row.querySelector('[data-field="path"]').value.trim();
    const labelVal = row.querySelector('[data-field="label"]').value.trim();
    const emailVal = row.querySelector('[data-field="emailTo"]').value.trim();
    const usePolling = row.querySelector('[data-field="usePolling"]').checked;
    if (!pathVal) continue;
    result.push({
      path: pathVal,
      label: labelVal || pathVal,
      emailTo: emailVal || null,
      usePolling: usePolling
    });
  }
  return result;
}

function toggleWatchPathImport() {
  const area = document.getElementById('watchPathImportArea');
  const show = area.style.display === 'none';
  area.style.display = show ? 'block' : 'none';
  if (show) {
    document.getElementById('watchPathImportText').value = '';
    document.getElementById('watchPathImportPreview').textContent = '';
  }
}

function parseImportLine(line) {
  const parts = line.split(/[;\t]/);
  const path = parts[0]?.trim();
  const label = parts[1]?.trim() || '';
  const emailTo = parts[2]?.trim() || '';
  const usePolling = true;
  return { path, label, emailTo, usePolling };
}

function addWatchPathRowWithData({ path, label, emailTo, usePolling }) {
  const tbody = document.getElementById('cfg-watchpaths-body');
  const i = tbody.rows.length;
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input type="text" value="${escapeHtml(path)}" data-field="path"></td>
    <td><input type="text" value="${escapeHtml(label)}" data-field="label"></td>
    <td><input type="text" value="${escapeHtml(emailTo)}" data-field="emailTo" placeholder="(keine)" title="E-Mail-Empfänger für diese Quelle. Mehrere Adressen kommagetrennt, z.B.: user@mail.de, admin@firma.de"></td>
    <td style="text-align:center"><input type="checkbox" data-field="usePolling" ${usePolling ? 'checked' : ''}></td>
    <td><button class="remove-btn" onclick="removeWatchPathRow(${i})">✕</button></td>
  `;
  tbody.appendChild(row);
}

function importWatchPaths() {
  const text = document.getElementById('watchPathImportText').value.trim();
  if (!text) { Keasy.actions.showToast('Keine Pfade eingegeben', 'warn'); return; }

  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const existing = getWatchPathsFromTable().map(wp => wp.path.toLowerCase());

  let added = 0, skipped = 0;
  for (const line of lines) {
    const parsed = parseImportLine(line);
    if (!parsed.path) continue;
    if (existing.includes(parsed.path.toLowerCase())) { skipped++; continue; }
    addWatchPathRowWithData(parsed);
    existing.push(parsed.path.toLowerCase());
    added++;
  }

  const msg = `${added} Pfad(e) importiert` + (skipped ? `, ${skipped} bereits vorhanden` : '');
  Keasy.actions.showToast(msg, added > 0 ? 'success' : 'warn');
  toggleWatchPathImport();
  if (added > 0) Keasy.config.markConfigDirty();
}

async function handleImportFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const textarea = document.getElementById('watchPathImportText');

  if (ext === 'csv' || ext === 'txt') {
    const reader = new FileReader();
    reader.onload = (e) => {
      textarea.value = e.target.result;
      textarea.dispatchEvent(new Event('input'));
      Keasy.actions.showToast(`📄 ${file.name} geladen`, 'success');
    };
    reader.readAsText(file, 'utf-8');
  } else if (ext === 'xlsx' || ext === 'xls') {
    loadSheetJS().then(() => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_csv(sheet, { FS: ';' });
          textarea.value = rows;
          textarea.dispatchEvent(new Event('input'));
          Keasy.actions.showToast(`📄 ${file.name} geladen (${wb.SheetNames[0]})`, 'success');
        } catch (err) {
          Keasy.actions.showToast('Excel-Datei konnte nicht gelesen werden: ' + err.message, 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    }).catch(err => {
      Keasy.actions.showToast('SheetJS konnte nicht geladen werden: ' + err.message, 'error');
    });
  } else {
    Keasy.actions.showToast(`Nicht unterstütztes Format: .${ext} (CSV, Excel oder TXT erwartet)`, 'warn');
  }
}

let _sheetJSLoaded = false;
function loadSheetJS() {
  if (_sheetJSLoaded && typeof XLSX !== 'undefined') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    script.onload = () => { _sheetJSLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('CDN nicht erreichbar'));
    document.head.appendChild(script);
  });
}

// Live-Vorschau + Drag & Drop Event-Listener
document.addEventListener('DOMContentLoaded', () => {
  const textarea = document.getElementById('watchPathImportText');
  if (textarea) {
    textarea.addEventListener('input', () => {
      const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      const existing = getWatchPathsFromTable().map(wp => wp.path.toLowerCase());
      const newCount = lines.filter(l => {
        const p = parseImportLine(l).path;
        return p && !existing.includes(p.toLowerCase());
      }).length;
      const preview = document.getElementById('watchPathImportPreview');
      preview.textContent = lines.length > 0 ? `${newCount} neue Pfade erkannt` : '';
    });
  }

  const dropZone = document.getElementById('watchPathDropZone');
  if (dropZone) {
    const overlay = document.getElementById('watchPathDropOverlay');
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
      handleImportFile(file);
    });
  }
});

Keasy.watchPaths = {
  renderWatchPathsTable, addWatchPathRow, removeWatchPathRow, getWatchPathsFromTable,
  toggleWatchPathImport, importWatchPaths, addWatchPathRowWithData, parseImportLine
};
Object.assign(window, {
  addWatchPathRow, removeWatchPathRow, toggleWatchPathImport, importWatchPaths
});

})();
