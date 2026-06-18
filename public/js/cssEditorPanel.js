/**
 * Keasy Log Monitor — CSS Editor Panel
 * Live-CSS-Editor: Laden, Bearbeiten, Speichern, Zurücksetzen.
 */
(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;

async function loadCssEditor() {
  try {
    const resp = await fetch('/api/style');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const css = await resp.text();
    document.getElementById('css-editor').value = css;
    state.cssSavedContent = css;
    state.cssDirty = false;
    state.cssLoaded = true;
    document.getElementById('cssSaveBtn').disabled = true;
    updateCssMessage('');
  } catch (err) {
    document.getElementById('css-editor').value = '/* Fehler beim Laden */';
    updateCssMessage('❌ CSS konnte nicht geladen werden', 'error');
  }
}

function onCssInput() {
  const css = document.getElementById('css-editor').value;
  document.getElementById('live-style').textContent = css;
  state.cssDirty = css !== state.cssSavedContent;
  document.getElementById('cssSaveBtn').disabled = !state.cssDirty;
  updateCssMessage(state.cssDirty ? '⚠️ Ungespeicherte Änderungen' : '');
}

async function saveCss() {
  const css = document.getElementById('css-editor').value;
  try {
    const resp = await fetch('/api/style', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ css })
    });
    const result = await resp.json();
    if (result.ok) {
      state.cssSavedContent = css;
      state.cssDirty = false;
      document.getElementById('live-style').textContent = '';
      document.getElementById('cssSaveBtn').disabled = true;
      updateCssMessage('✅ Gespeichert — Seite neu laden für vollständige Übernahme', 'success');
    } else {
      updateCssMessage('❌ ' + result.message, 'error');
    }
  } catch (err) {
    updateCssMessage('❌ Fehler beim Speichern', 'error');
  }
}

async function resetCssEditor() {
  try {
    const resp = await fetch('/api/style');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const css = await resp.text();
    document.getElementById('css-editor').value = css;
    document.getElementById('live-style').textContent = '';
    state.cssSavedContent = css;
    state.cssDirty = false;
    document.getElementById('cssSaveBtn').disabled = true;
    updateCssMessage('↩️ Zurückgesetzt');
  } catch (err) {
    updateCssMessage('❌ Fehler beim Laden', 'error');
  }
}

async function restoreDefaultCss() {
  if (!confirm('Original-CSS wiederherstellen? Alle Anpassungen gehen verloren.')) return;
  try {
    const resp = await fetch('/api/style/default');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const css = await resp.text();
    document.getElementById('css-editor').value = css;
    document.getElementById('live-style').textContent = css;
    state.cssDirty = true;
    document.getElementById('cssSaveBtn').disabled = false;
    updateCssMessage('⚠️ Standard geladen — noch nicht gespeichert');
  } catch (err) {
    updateCssMessage('❌ Keine Standard-CSS gefunden', 'error');
  }
}

function updateCssMessage(text, type) {
  const el = document.getElementById('cssMessage');
  el.textContent = text;
  el.className = 'config-message' + (type ? ' ' + type : '');
}

Keasy.cssEditor = { loadCssEditor, onCssInput, saveCss, resetCssEditor, restoreDefaultCss, updateCssMessage };
Object.assign(window, { saveCss, resetCssEditor, restoreDefaultCss, onCssInput });

})();
