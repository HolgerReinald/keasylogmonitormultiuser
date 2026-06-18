(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;

function toggleTrash() {
  state.trashCollapsed = !state.trashCollapsed;
  renderTrash();
}

function toggleTrashGroup(header, label) {
  const key = 'trash-' + label;
  const wasCollapsed = state.collapsedSources[key] !== false;
  state.collapsedSources[key] = wasCollapsed ? false : true;
  localStorage.setItem('keasy-collapsed-sources', JSON.stringify(state.collapsedSources));
  renderTrash();
}

async function restoreTrashSource(label, event) {
  if (event) event.stopPropagation();
  try {
    const resp = await fetch('/api/trash-restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label })
    });
    const result = await resp.json();
    if (result.ok && result.restoredCount > 0) {
      showTrashStatus(`↩️ ${result.restoredCount} Einträge wiederhergestellt`);
    }
  } catch (err) {
    showTrashStatus('❌ Fehler: ' + err.message);
  }
}

async function restoreAllTrash() {
  try {
    const resp = await fetch('/api/trash-restore-all', { method: 'POST' });
    const result = await resp.json();
    if (result.ok) {
      showTrashStatus(`↩️ ${result.restoredCount} Einträge wiederhergestellt`);
    }
  } catch (err) {
    showTrashStatus('❌ Fehler: ' + err.message);
  }
}

async function emptyTrash() {
  try {
    const resp = await fetch('/api/trash-empty', { method: 'POST' });
    const result = await resp.json();
    if (result.ok) {
      showTrashStatus(`🗑️ ${result.removedCount} Einträge endgültig gelöscht`);
    }
  } catch (err) {
    showTrashStatus('❌ Fehler: ' + err.message);
  }
}

async function emptyTrashSource(label, event) {
  if (event) event.stopPropagation();
  try {
    const resp = await fetch('/api/trash-empty-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label })
    });
    const result = await resp.json();
    if (result.ok) {
      showTrashStatus(`🗑️ ${result.removedCount} Einträge endgültig gelöscht`);
    }
  } catch (err) {
    showTrashStatus('❌ Fehler: ' + err.message);
  }
}

function showTrashStatus(message) {
  const el = document.getElementById('trashStatus');
  if (!el) return;
  el.textContent = message;
  el.style.display = '';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

window.Keasy.trash = {
  toggleTrash, toggleTrashGroup, restoreTrashSource, restoreAllTrash,
  emptyTrash, emptyTrashSource, showTrashStatus
};

Object.assign(window, {
  toggleTrash, toggleTrashGroup, restoreTrashSource, restoreAllTrash,
  emptyTrash, emptyTrashSource, showTrashStatus
});
})();
