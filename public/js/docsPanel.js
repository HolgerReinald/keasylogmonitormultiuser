/**
 * Keasy Log Monitor — Docs Panel
 * README-Dokumentation laden, anzeigen und bearbeiten (Markdown + Live-Vorschau).
 */
(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;

// Referenz-/Riesen-Abschnitte starten zugeklappt
const REF_SECTIONS = /(Historie|Konfiguration|Architektur|Dependencies)/i;

async function loadDocs() {
  try {
    const resp = await fetch('/api/docs');
    const html = await resp.text();
    document.getElementById('docsContent').innerHTML = html;
    enhanceDocs();
    state.docsLoaded = true;
  } catch (err) {
    document.getElementById('docsContent').innerHTML = '<p style="color:var(--badge-bg)">Fehler beim Laden der Dokumentation.</p>';
  }
}

function toggleAllDocs(open) {
  document.querySelectorAll('#docsContent .docs-section, #docsContent .docs-collapsible')
    .forEach(d => d.open = open);
}

// ─── Aufbereitung: h2-Abschnitte einklappbar + Inhaltsverzeichnis ───

function slugifyDoc(s) {
  return 'sec-' + s.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function enhanceDocs() {
  const content = document.getElementById('docsContent');
  if (!content) return;
  wrapH2Sections(content);
  buildDocsToc(content);
  setupDocsScrollSpy(content);
  const search = document.getElementById('docsSearch');
  if (search) search.value = '';
}

// Jede h2-Überschrift + Folgeinhalt (bis zur nächsten h2) in ein <details> packen
function wrapH2Sections(content) {
  const nodes = Array.from(content.childNodes);
  const groups = [];
  let cur = null;
  for (const n of nodes) {
    if (n.nodeType === 1 && n.tagName === 'H2') {
      cur = { h2: n, items: [] };
      groups.push(cur);
    } else if (cur) {
      cur.items.push(n);
    }
  }
  const usedIds = new Set();
  groups.forEach((g, idx) => {
    const title = g.h2.textContent.trim();
    let id = slugifyDoc(title) || ('sec-' + idx);
    while (usedIds.has(id)) id += '-' + idx;
    usedIds.add(id);

    const det = document.createElement('details');
    det.className = 'docs-section';
    det.id = id;
    det.dataset.title = title;

    const sum = document.createElement('summary');
    sum.className = 'docs-section-h';
    const chev = document.createElement('span');
    chev.className = 'docs-chev';
    chev.textContent = '▶';
    sum.appendChild(chev);

    content.insertBefore(det, g.h2); // details an die Stelle der h2 setzen
    sum.appendChild(g.h2);           // h2 in die summary verschieben
    det.appendChild(sum);

    const body = document.createElement('div');
    body.className = 'docs-section-body';
    for (const it of g.items) body.appendChild(it);
    det.appendChild(body);

    const count = det.querySelectorAll('.docs-collapsible').length;
    if (count > 0) {
      const badge = document.createElement('span');
      badge.className = 'docs-badge';
      badge.textContent = /Historie/i.test(title) ? (count + ' Einträge') : count;
      sum.appendChild(badge);
    }
    det.open = !REF_SECTIONS.test(title);
  });
}

function buildDocsToc(content) {
  const toc = document.getElementById('docsToc');
  if (!toc) return;
  toc.innerHTML = '<div class="docs-toc-title">Inhalt</div>';
  content.querySelectorAll('.docs-section').forEach(sec => {
    const title = sec.dataset.title || '';
    const a = document.createElement('a');
    a.href = '#' + sec.id;
    a.dataset.target = sec.id;
    a.title = title;
    a.textContent = title.length > 30 ? title.slice(0, 29) + '…' : title;
    if (/Historie/i.test(title)) {
      const n = document.createElement('span');
      n.className = 'docs-toc-n';
      n.textContent = sec.querySelectorAll('.docs-collapsible').length;
      a.appendChild(n);
    }
    a.addEventListener('click', (e) => {
      e.preventDefault();
      sec.open = true;
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveToc(sec.id);
    });
    toc.appendChild(a);
  });
}

function setActiveToc(id) {
  document.querySelectorAll('#docsToc a').forEach(a =>
    a.classList.toggle('active', a.dataset.target === id));
}

let _docsObserver = null;
function setupDocsScrollSpy(content) {
  if (_docsObserver) { _docsObserver.disconnect(); _docsObserver = null; }
  if (!('IntersectionObserver' in window)) return;
  try {
    _docsObserver = new IntersectionObserver((entries) => {
      const vis = entries.filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (vis[0]) setActiveToc(vis[0].target.id);
    }, { root: content, rootMargin: '0px 0px -70% 0px', threshold: 0 });
    content.querySelectorAll('.docs-section').forEach(s => _docsObserver.observe(s));
  } catch { /* Scroll-Spy ist optional */ }
}

// Volltext-Filter: nicht passende Abschnitte ausblenden, passende aufklappen
function filterDocs(q) {
  const query = (q || '').trim().toLowerCase();
  const content = document.getElementById('docsContent');
  if (!content) return;
  content.querySelectorAll('.docs-section').forEach(sec => {
    const match = !query || sec.textContent.toLowerCase().includes(query);
    sec.style.display = match ? '' : 'none';
    if (query && match) sec.open = true;
    const a = document.querySelector('#docsToc a[data-target="' + sec.id + '"]');
    if (a) a.style.display = match ? '' : 'none';
  });
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
  document.getElementById('docsView').style.display = 'none';
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
  document.getElementById('docsView').style.display = '';
  document.getElementById('docsEditBtn').style.display = '';
}

Keasy.docs = { loadDocs, toggleAllDocs, startDocsEdit, saveDocs, cancelDocsEdit, filterDocs };
Object.assign(window, { loadDocs, toggleAllDocs, startDocsEdit, onDocsEditorInput, saveDocs, cancelDocsEdit, filterDocs });

})();
