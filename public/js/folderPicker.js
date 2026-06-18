/**
 * Keasy Log Monitor — Folder Picker
 * Modal-Dialog zur Ordner-Auswahl via Server-API.
 */
(function() {
'use strict';
window.Keasy = window.Keasy || {};

let overlay = null;
let resolvePromise = null;
let currentPath = '';
let isOpen = false;

function ensureDOM() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'folder-picker-overlay';
  overlay.innerHTML = `
    <div class="folder-picker-box">
      <div class="folder-picker-header">
        <span class="folder-picker-title">📂 Ordner auswählen</span>
        <button class="folder-picker-close" title="Schließen">✕</button>
      </div>
      <div class="folder-picker-path">
        <button class="folder-picker-up" title="Übergeordneter Ordner">⬆️</button>
        <button class="folder-picker-drives" title="Alle Laufwerke anzeigen">💻</button>
        <input type="text" class="folder-picker-input" placeholder="Pfad eingeben..." spellcheck="false">
        <button class="folder-picker-go" title="Pfad öffnen">↩️</button>
      </div>
      <div class="folder-picker-list" spellcheck="false"></div>
      <div class="folder-picker-actions">
        <button class="confirm-btn confirm-cancel">Abbrechen</button>
        <button class="confirm-btn confirm-ok">✅ Auswählen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('.folder-picker-close').addEventListener('click', () => close(null));
  overlay.querySelector('.confirm-cancel').addEventListener('click', () => close(null));
  overlay.querySelector('.confirm-ok').addEventListener('click', () => close(currentPath));
  overlay.querySelector('.folder-picker-up').addEventListener('click', goUp);
  overlay.querySelector('.folder-picker-drives').addEventListener('click', () => navigate(''));
  overlay.querySelector('.folder-picker-go').addEventListener('click', () => {
    const val = overlay.querySelector('.folder-picker-input').value.trim();
    if (val) navigate(val);
  });
  overlay.querySelector('.folder-picker-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (val) navigate(val);
    }
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });
}

function close(result) {
  if (!isOpen) return;
  isOpen = false;
  overlay.classList.remove('visible');
  if (resolvePromise) { resolvePromise(result); resolvePromise = null; }
}

async function navigate(targetPath) {
  const list = overlay.querySelector('.folder-picker-list');
  list.innerHTML = '<div style="padding:12px; color:var(--text-secondary);">Laden...</div>';

  try {
    const resp = await fetch('/api/browse-folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath })
    });
    const data = await resp.json();
    if (!data.ok) {
      list.innerHTML = `<div style="padding:12px; color:var(--badge-bg);">⚠️ ${Keasy.utils.escapeHtml(data.message)}</div>`;
      return;
    }

    currentPath = data.current;
    overlay.querySelector('.folder-picker-input').value = currentPath;
    overlay.querySelector('.folder-picker-up').disabled = !data.current;

    if (data.folders.length === 0) {
      list.innerHTML = '<div style="padding:12px; color:var(--text-secondary);">(Keine Unterordner)</div>';
      return;
    }

    list.innerHTML = data.folders.map(f =>
      `<div class="folder-picker-item" data-path="${Keasy.utils.escapeHtml(f.path)}" title="${Keasy.utils.escapeHtml(f.path)}"><span class="folder-picker-icon">📁</span> <span class="folder-picker-name">${Keasy.utils.escapeHtml(f.name)}</span></div>`
    ).join('');

    list.querySelectorAll('.folder-picker-item').forEach(item => {
      item.addEventListener('dblclick', () => navigate(item.dataset.path));
      item.addEventListener('click', () => {
        list.querySelectorAll('.folder-picker-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        currentPath = item.dataset.path;
        overlay.querySelector('.folder-picker-input').value = currentPath;
      });
    });
  } catch (err) {
    list.innerHTML = `<div style="padding:12px; color:var(--badge-bg);">⚠️ ${Keasy.utils.escapeHtml(err.message)}</div>`;
  }
}

function goUp() {
  if (!currentPath) return;
  // Laufwerks-Root (z.B. "C:\") → Laufwerksübersicht
  if (/^[A-Z]:\\?$/i.test(currentPath)) { navigate(''); return; }
  // Parent berechnen: letztes Pfadsegment entfernen
  let parent = currentPath.replace(/[\\/][^\\/]+[\\/]?$/, '');
  // Sicherstellen dass Laufwerks-Root als "C:\" erhalten bleibt
  if (/^[A-Z]:$/i.test(parent)) parent += '\\';
  navigate(parent);
}

/**
 * Öffnet den Ordner-Picker und gibt den gewählten Pfad zurück (oder null bei Abbruch).
 * @param {string} [startPath=''] - Startverzeichnis
 * @returns {Promise<string|null>}
 */
window.showFolderPicker = function(startPath) {
  if (isOpen) return Promise.resolve(null);
  ensureDOM();
  isOpen = true;
  currentPath = startPath || '';
  overlay.classList.add('visible');
  navigate(currentPath);
  return new Promise((resolve) => { resolvePromise = resolve; });
};

window.Keasy.folderPicker = { showFolderPicker: window.showFolderPicker };
})();
