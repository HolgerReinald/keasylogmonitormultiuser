/**
 * Keasy Log Monitor — Docs Panel
 * README-Dokumentation laden, anzeigen und bearbeiten (Markdown + Live-Vorschau).
 */
(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;

async function loadDocs() {
  try {
    const resp = await fetch('/api/docs');
    const html = await resp.text();
    document.getElementById('docsContent').innerHTML = html;
    state.docsLoaded = true;
  } catch (err) {
    document.getElementById('docsContent').innerHTML = '<p style="color:var(--badge-bg)">Fehler beim Laden der Dokumentation.</p>';
  }
}

function toggleAllDocs(open) {
  const details = document.querySelectorAll('#docsContent .docs-collapsible');
  details.forEach(d => d.open = open);
}

// ─── Doku-Editor (Markdown + Live-Vorschau) ─────────────────

let docsOriginalText = ''; // Stand beim Öffnen — für Dirty-Check bei Abbrechen
let docsPreviewTimer = null;

async function startDocsEdit() {
  try {
    const resp = await fetch('/api/docs/raw');
    if (!resp.ok) {
      Keasy.showToast('Dokumentation konnte nicht geladen werden', 'error');
      return;
    }
    docsOriginalText = await resp.text();
  } catch (err) {
    Keasy.showToast('Fehler: ' + err.message, 'error');
    return;
  }
  document.getElementById('docsEditorText').value = docsOriginalText;
  document.getElementById('docsEditor').style.display = '';
  document.getElementById('docsContent').style.display = 'none';
  document.getElementById('docsEditBtn').style.display = 'none';
  renderDocsPreview();
}

function onDocsEditorInput() {
  // Vorschau debounced aktualisieren — nicht bei jedem Tastendruck rendern
  if (docsPreviewTimer) clearTimeout(docsPreviewTimer);
  docsPreviewTimer = setTimeout(renderDocsPreview, 400);
}

async function renderDocsPreview() {
  const md = document.getElementById('docsEditorText').value;
  try {
    const resp = await fetch('/api/docs/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ md })
    });
    if (resp.ok) {
      document.getElementById('docsEditorPreview').innerHTML = await resp.text();
    }
  } catch { /* Vorschau-Fehler still ignorieren — nächster Tastendruck versucht es erneut */ }
}

async function saveDocs() {
  const md = document.getElementById('docsEditorText').value;
  const btn = document.getElementById('docsSaveBtn');
  btn.disabled = true;
  try {
    const resp = await fetch('/api/docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ md })
    });
    const result = await resp.json();
    if (result.ok) {
      Keasy.showToast('Dokumentation gespeichert (Backup: README.md.bak)', 'success');
      closeDocsEditor();
      loadDocs();
    } else {
      Keasy.showToast('❌ ' + (result.message || 'Fehler beim Speichern'), 'error');
    }
  } catch (err) {
    Keasy.showToast('❌ ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function cancelDocsEdit() {
  const current = document.getElementById('docsEditorText').value;
  if (current !== docsOriginalText && !confirm('Änderungen verwerfen?')) return;
  closeDocsEditor();
}

function closeDocsEditor() {
  if (docsPreviewTimer) clearTimeout(docsPreviewTimer);
  document.getElementById('docsEditor').style.display = 'none';
  document.getElementById('docsContent').style.display = '';
  document.getElementById('docsEditBtn').style.display = '';
}

Keasy.docs = { loadDocs, toggleAllDocs, startDocsEdit, saveDocs, cancelDocsEdit };
Object.assign(window, { loadDocs, toggleAllDocs, startDocsEdit, onDocsEditorInput, saveDocs, cancelDocsEdit });

})();
