/**
 * Keasy Log Monitor — WebSocket Broadcast
 * Client-Verwaltung und Broadcast-Funktionen.
 * Unterstützt per-Client-Filterung nach visibleLabels.
 */

const clients = new Set();

function broadcast(message) {
  const json = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      try { client.send(json); } catch (_) { /* client ggf. gerade getrennt */ }
    }
  }
}

// Gefilterten Broadcast: filtert Daten pro Client nach visibleLabels
function broadcastFiltered(message, filterFn) {
  for (const client of clients) {
    if (client.readyState !== 1) continue;
    const filtered = filterFn(message, client.visibleLabels);
    if (filtered) {
      try { client.send(JSON.stringify(filtered)); } catch (_) { /* client ggf. gerade getrennt */ }
    }
  }
}

function broadcastToUser(username, message) {
  const json = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1 && client.username === username) {
      try { client.send(json); } catch (_) {}
    }
  }
}

// WS-Close für einen bestimmten User erzwingen (bei Rechteänderung)
function disconnectUser(username) {
  for (const client of clients) {
    if (client.username === username && client.readyState === 1) {
      client.close(4403, 'Berechtigungen geändert');
    }
  }
}

// broadcastTrash wird von außen gesetzt (um Zirkulär-Deps zu vermeiden)
let _getTrashSnapshot = null;
function setTrashSnapshotFn(fn) { _getTrashSnapshot = fn; }

function broadcastTrash() {
  const store = require('./runtimeStore');
  store.state.trashRevision++;
  if (_getTrashSnapshot) {
    const fullSnapshot = _getTrashSnapshot();
    for (const client of clients) {
      if (client.readyState !== 1) continue;
      if (!client.visibleLabels) {
        // null = alle sichtbar
        try { client.send(JSON.stringify({ type: 'trash-snapshot', ...fullSnapshot })); } catch (_) {}
      } else {
        // Filtern nach sichtbaren Labels
        const filtered = filterTrashSnapshot(fullSnapshot, client.visibleLabels);
        try { client.send(JSON.stringify({ type: 'trash-snapshot', ...filtered })); } catch (_) {}
      }
    }
  }
}

function filterTrashSnapshot(snapshot, visibleLabels) {
  if (!visibleLabels) return snapshot;
  const filtered = { ...snapshot };
  if (filtered.trashGroups) {
    filtered.trashGroups = filtered.trashGroups.filter(g => visibleLabels.includes(g.label));
    filtered.trashTotalCount = filtered.trashGroups.reduce((sum, g) => sum + (g.count || 0), 0);
  }
  return filtered;
}

// Hilfsfunktion: Fehler-Daten nach visibleLabels filtern
function filterErrorsByLabels(errors, visibleLabels) {
  if (!visibleLabels) return errors;
  const filtered = {};
  for (const [filePath, entries] of Object.entries(errors)) {
    // entries haben label info, oder wir checken über fileLabelMap
    if (entries.length > 0 && entries[0]._label && visibleLabels.includes(entries[0]._label)) {
      filtered[filePath] = entries;
    }
  }
  return filtered;
}

module.exports = { clients, broadcast, broadcastFiltered, broadcastToUser, broadcastTrash, setTrashSnapshotFn, disconnectUser, filterErrorsByLabels, filterTrashSnapshot };
