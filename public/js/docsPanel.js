/**
 * Keasy Log Monitor — Docs Panel
 * README-Dokumentation laden und anzeigen.
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

Keasy.docs = { loadDocs, toggleAllDocs };
Object.assign(window, { loadDocs, toggleAllDocs });

})();
