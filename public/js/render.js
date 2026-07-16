(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;
const { escapeHtml, escapeJs, highlightPatterns, highlightSearch } = Keasy.utils;

function updateBrowserTitle() {
  document.title = state.totalErrors > 0
    ? `(${state.totalErrors}) Keasy Log Monitor`
    : 'Keasy Log Monitor';
}

function isInTimeFilter(timestamp) {
  if (!state.timeFilterHours || state.timeFilterHours <= 0) return true;
  const errorDate = new Date(timestamp);
  const cutoff = new Date(Date.now() - state.timeFilterHours * 60 * 60 * 1000);
  return errorDate >= cutoff;
}

function isInDateRange(timestamp) {
  const dateFrom = document.getElementById('dateFrom').value;
  const dateTo = document.getElementById('dateTo').value;
  if (!dateFrom && !dateTo && !state.timeFilterHours) return true;

  const errorDate = new Date(timestamp);
  if (state.timeFilterHours > 0) {
    const cutoff = new Date(Date.now() - state.timeFilterHours * 60 * 60 * 1000);
    if (errorDate < cutoff) return false;
  }
  if (dateFrom) {
    const from = new Date(dateFrom + 'T00:00:00');
    if (errorDate < from) return false;
  }
  if (dateTo) {
    const to = new Date(dateTo + 'T23:59:59.999');
    if (errorDate > to) return false;
  }
  return true;
}

// --- Gemeinsame Render-Bausteine (Live, ⏱️ Performance, Analyse) ---

// Such- und Zeitraum-Filter für die Einträge einer Datei
// (dateCheck: isInDateRange für Live/Performance, isInTimeFilter für Analyse)
function filterEntriesForFile(entries, fileName, dateCheck) {
  const fileNameLower = fileName.toLowerCase();
  return entries.filter(e => {
    if (!dateCheck(e.timestamp)) return false;
    if (state.searchTerm) {
      if (state.searchRegex) {
        if (!state.searchRegex.test(e.line) && !state.searchRegex.test(fileName)) return false;
      } else {
        if (!e.line.toLowerCase().includes(state.searchTerm) && !fileNameLower.includes(state.searchTerm)) return false;
      }
    }
    return true;
  });
}

function buildOpenButtonsHtml(filePath) {
  return `<button class="action-btn" title="Ordner öffnen" onclick="openFolder('${escapeJs(filePath)}', event)">📂</button>
              <button class="action-btn" title="Datei öffnen" onclick="openFile('${escapeJs(filePath)}', event)">📝</button>`;
}

// Datei-Block mit Header (Name, Pfad, Aktionen) und ausklappbarer Eintragsliste
function buildFileGroupHtml(filePath, fileNameHtml, actionsHtml, entriesHtml, extraClass = '') {
  return `
        <div class="file-group${extraClass}">
          <div class="file-header" onclick="toggleGroup(this)">
            <div>
              ${fileNameHtml}
              <div class="file-path">${escapeHtml(filePath)}</div>
            </div>
            <div class="file-actions">
              ${actionsHtml}
            </div>
          </div>
          <div class="error-list" style="display:none">${entriesHtml}</div>
        </div>`;
}

// Fehler-Eintrag mit Zeile-öffnen/Kopieren/Copilot-Buttons (Live und Analyse)
function buildErrorEntryHtml(filePath, err, origIdx, isAnalyze) {
  const time = new Date(err.timestamp).toLocaleTimeString('de-DE');
  const errTextEscaped = escapeJs(err.line.split('\n')[0]);
  return `
          <div class="error-entry">
            <div class="error-time">
              ${time}
              <button class="action-btn error-jump-btn" title="In Datei springen" onclick="openFileAtError('${escapeJs(filePath)}', '${errTextEscaped}', event)">↗ Zeile öffnen</button>
              <button class="action-btn copy-btn" aria-label="Fehler kopieren" title="In Zwischenablage kopieren" onclick="copyErrorToClipboard('${escapeJs(filePath)}', ${origIdx}, ${isAnalyze}, event)">📋</button>
              <button class="action-btn copilot-btn" aria-label="Für Copilot Develop exportieren" title="Für Copilot Develop exportieren" onclick="exportToCopilot('${escapeJs(filePath)}', ${origIdx}, ${isAnalyze}, 'develop', event)">🤖</button>
              <button class="action-btn copilot-release-btn" aria-label="Für Copilot Release exportieren" title="Für Copilot Release exportieren" onclick="exportToCopilot('${escapeJs(filePath)}', ${origIdx}, ${isAnalyze}, 'release', event)">🚀</button>
            </div>
            <div class="error-text">${highlightSearch(highlightPatterns(escapeHtml(err.line)))}</div>
          </div>`;
}

// ⏱️ Gap-Eintrag (Live-Performance und Analyse identisch — keine Copy/Copilot-Buttons)
function buildGapEntryHtml(filePath, entry) {
  const time = new Date(entry.timestamp).toLocaleTimeString('de-DE');
  const prevTime = new Date(entry.prevTimestamp).toLocaleTimeString('de-DE');
  const gapLabel = Keasy.utils.formatGapDuration(entry.gapSeconds);
  const entryTextEscaped = escapeJs(entry.line.split('\n')[0]);
  return `
          <div class="error-entry gap-entry">
            <div class="error-time">
              <span class="gap-duration" title="Gap (Zeitabstand) zwischen zwei Log-Einträgen">⏱️ Gap: ${gapLabel} (${prevTime} → ${time})</span>
              <button class="action-btn error-jump-btn" title="In Datei springen" onclick="openFileAtError('${escapeJs(filePath)}', '${entryTextEscaped}', event)">↗ Zeile öffnen</button>
            </div>
            <div class="error-text gap-entry-line">${highlightSearch(escapeHtml(entry.line))}</div>
          </div>`;
}

function renderAll() {
  const container = document.getElementById('container');
  const keys = Object.keys(state.errors).filter(k => state.errors[k].length > 0);
  const analyzeKeys = Object.keys(state.analyzeErrors).filter(k => state.analyzeErrors[k].length > 0);
  const perfKeys = Object.keys(state.performanceEntries).filter(k => state.performanceEntries[k].length > 0);

  if (keys.length === 0 && analyzeKeys.length === 0 && perfKeys.length === 0) {
    state.totalErrors = 0;
    document.getElementById('totalCount').textContent = state.totalErrors;
    updateBrowserTitle();
    container.innerHTML = `
      <div class="empty-state" id="emptyState">
        <h2>✅ Keine Fehler</h2>
        <p>Überwache Log-Dateien... Fehler werden hier live angezeigt.</p>
      </div>`;
    updateLiveControlStates(0);
    renderTrash();
    if (window.Keasy && window.Keasy.auth && window.Keasy.auth.applyUserRole) {
      window.Keasy.auth.applyUserRole();
    }
    return;
  }

  // Nach Label gruppieren
  const groups = {};
  for (const filePath of keys) {
    const label = state.fileLabels[filePath] || 'Sonstige';
    if (!groups[label]) groups[label] = [];
    groups[label].push(filePath);
  }

  // Innerhalb jeder Gruppe nach neuester Fehlermeldung sortieren
  for (const label of Object.keys(groups)) {
    groups[label].sort((a, b) => {
      const lastA = state.errors[a][state.errors[a].length - 1]?.timestamp || '';
      const lastB = state.errors[b][state.errors[b].length - 1]?.timestamp || '';
      return lastB.localeCompare(lastA);
    });
  }

  // Gruppen sortieren nach neuester Fehlermeldung der Gruppe
  const sortedLabels = Object.keys(groups).sort((a, b) => {
    const newestA = groups[a].reduce((max, fp) => {
      const t = state.errors[fp][state.errors[fp].length - 1]?.timestamp || '';
      return t > max ? t : max;
    }, '');
    const newestB = groups[b].reduce((max, fp) => {
      const t = state.errors[fp][state.errors[fp].length - 1]?.timestamp || '';
      return t > max ? t : max;
    }, '');
    return newestB.localeCompare(newestA);
  });

  let html = '';
  let filteredTotal = 0;
  let liveTotal = 0;

  for (const label of sortedLabels) {
    const filePaths = groups[label];
    let groupHtml = '';
    let groupCount = 0;
    // Die filePaths sind bereits absteigend nach neuestem Fehler sortiert;
    // die erste tatsächlich angezeigte Datei ist die mit dem aktuellsten Datum.
    let firstShownInGroup = true;

    for (const filePath of filePaths) {
      const fileErrors = state.errors[filePath];
      const fileName = fileErrors[0]?.file || filePath.split('\\').pop();

      const filtered = filterEntriesForFile(fileErrors, fileName, isInDateRange);
      if (filtered.length === 0) continue;
      groupCount += filtered.length;

      // Aktuellste Datei je Watchpath farblich hervorheben
      const newestClass = firstShownInGroup ? ' file-group-newest' : '';
      firstShownInGroup = false;

      const ovInfo = state.oversizedFiles && state.oversizedFiles[filePath];
      const oversizeClass = ovInfo ? ' file-oversize' : '';
      const oversizeTitle = ovInfo ? ` title="${ovInfo.sizeMB} MB > ${state.maxLogFileSizeMB || 6} MB — große Datei, zuletzt eingelesen"` : '';

      // Zeitpunkt des neuesten angezeigten Fehlers (filtered ist chronologisch, ältester zuerst)
      const lastTs = filtered[filtered.length - 1]?.timestamp;
      const lastErrLabel = lastTs
        ? new Date(lastTs).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
          })
        : '';

      let entriesHtml = '';
      for (const err of [...filtered].reverse()) {
        entriesHtml += buildErrorEntryHtml(filePath, err, state.errors[filePath].indexOf(err), false);
      }

      const fileNameHtml = `<div class="file-name${oversizeClass}"${oversizeTitle}>📄 ${escapeHtml(fileName)}</div>`;
      const actionsHtml = `${lastErrLabel ? `<span class="file-last-error" title="Zeitpunkt des letzten Fehlers">🕒 ${lastErrLabel}</span>` : ''}
              ${buildOpenButtonsHtml(filePath)}
              <span class="file-badge" title="Anzahl Fehler in dieser Datei">${filtered.length}</span>`;
      groupHtml += buildFileGroupHtml(filePath, fileNameHtml, actionsHtml, entriesHtml, newestClass);
    }

    if (groupCount === 0) continue;
    filteredTotal += groupCount;
    liveTotal += groupCount;

    const isCollapsed = (state.searchTerm && groupCount > 0) ? false : state.collapsedSources[label] === true;
    const isPaused = state.pausedSources.has(label);
    const pauseBtn = isPaused
      ? `<button class="action-btn paused" title="Monitoring fortsetzen" onclick="resumeSource('${escapeJs(label)}', event)" data-admin-only>▶️ Monitor</button>`
      : `<button class="action-btn" title="Monitoring pausieren" onclick="pauseSource('${escapeJs(label)}', event)" data-admin-only>⏸️ Monitor</button>`;

    let emailBtn = '';
    if (state.emailConfiguredSources.has(label)) {
      const emailOff = state.emailDisabledSources.has(label) || isPaused;
      emailBtn = emailOff
        ? `<button class="action-btn email-off" title="E-Mail aktivieren" onclick="enableEmail('${escapeJs(label)}', event)">📧 ${isPaused ? 'pausiert' : 'Aus'}</button>`
        : `<button class="action-btn email-on" title="E-Mail deaktivieren" onclick="disableEmail('${escapeJs(label)}', event)">📧 <span class="email-countdown">--:--</span></button>`;
    }

    html += `
      <div class="source-group">
        <div class="source-header" onclick="toggleSource(this, '${escapeJs(label)}')">
          <span><span class="toggle-arrow">${isCollapsed ? '▶' : '▼'}</span> ${escapeHtml(label)}${isPaused ? ' (pausiert)' : ''}</span>
          <div class="source-actions">
            ${emailBtn}
            ${pauseBtn}
            <button class="action-btn" title="Einträge im gewählten Zeitraum löschen" onclick="clearSource('${escapeJs(label)}', event)" data-admin-only>🗑️</button>
            <span class="source-badge" title="Anzahl Fehler in dieser Quelle">${groupCount}</span>
          </div>
        </div>
        <div class="source-content${isCollapsed ? ' collapsed' : ''}">
          ${groupHtml}
        </div>
      </div>`;
  }

  // === ⏱️ Performance-Lücken (getrennt vom Fehler-Logging) ===
  if (perfKeys.length > 0) {
    const pGroups = {};
    for (const filePath of perfKeys) {
      const label = state.performanceLabels[filePath] || 'Sonstige';
      if (!pGroups[label]) pGroups[label] = [];
      pGroups[label].push(filePath);
    }

    for (const label of Object.keys(pGroups)) {
      let groupHtml = '';
      let groupCount = 0;

      for (const filePath of pGroups[label]) {
        const fileEntries = state.performanceEntries[filePath];
        const fileName = fileEntries[0]?.file || filePath.split('\\').pop();
        const filtered = filterEntriesForFile(fileEntries, fileName, isInDateRange);
        if (filtered.length === 0) continue;
        groupCount += filtered.length;

        let entriesHtml = '';
        for (const entry of [...filtered].reverse()) {
          entriesHtml += buildGapEntryHtml(filePath, entry);
        }

        const actionsHtml = `${buildOpenButtonsHtml(filePath)}
              <span class="file-badge gap-badge" title="Anzahl Performance-Gaps in dieser Datei">⏱️ ${filtered.length}</span>`;
        groupHtml += buildFileGroupHtml(filePath, `<div class="file-name">📄 ${escapeHtml(fileName)}</div>`, actionsHtml, entriesHtml);
      }

      if (groupCount > 0) {
        const collapseKey = 'perf:' + label;
        const isCollapsed = (state.searchTerm && groupCount > 0) ? false : state.collapsedSources[collapseKey] === true;
        html += `
          <div class="source-group performance-source">
            <div class="source-header performance-header" onclick="toggleSource(this, '${escapeJs(collapseKey)}')">
              <span><span class="toggle-arrow">${isCollapsed ? '▶' : '▼'}</span> ⏱️ ${escapeHtml(label)} <span style="font-size:0.85em; opacity:0.7;">(Performance)</span></span>
              <div class="source-actions">
                <button class="action-btn" title="Performance-Einträge dieser Quelle löschen" onclick="clearPerformanceSource('${escapeJs(label)}', event)" data-admin-only>🗑️</button>
                <span class="source-badge gap-badge" title="Anzahl Performance-Gaps in dieser Quelle">⏱️ ${groupCount}</span>
              </div>
            </div>
            <div class="source-content${isCollapsed ? ' collapsed' : ''}">
              ${groupHtml}
            </div>
          </div>`;
      }
    }
  }

  // === Analyse-Ergebnisse (getrennt von Live) ===
  if (analyzeKeys.length > 0) {
    const aGroups = {};
    for (const filePath of analyzeKeys) {
      const label = state.analyzeLabels[filePath] || '📂 Analyse';
      if (!aGroups[label]) aGroups[label] = [];
      aGroups[label].push(filePath);
    }

    for (const label of Object.keys(aGroups)) {
      let groupHtml = '';
      let groupCount = 0;
      let groupErrCount = 0;
      let groupGapCount = 0;

      for (const filePath of aGroups[label]) {
        const fileErrors = state.analyzeErrors[filePath];
        const fileName = fileErrors[0]?.file || filePath.split('\\').pop();
        const filtered = filterEntriesForFile(fileErrors, fileName, isInTimeFilter);
        if (filtered.length === 0) continue;
        groupCount += filtered.length;
        // Fehler und ⏱️-Lücken getrennt zählen (Lücken haben gapSeconds)
        const fileGapCount = filtered.filter(e => e.gapSeconds != null).length;
        const fileErrCount = filtered.length - fileGapCount;
        groupErrCount += fileErrCount;
        groupGapCount += fileGapCount;
        const fileGapBadge = fileGapCount > 0 ? `<span class="file-badge gap-badge" title="Anzahl Performance-Gaps in dieser Datei">⏱️ ${fileGapCount}</span>` : '';

        let entriesHtml = '';
        for (const err of [...filtered].reverse()) {
          if (err.gapSeconds != null) {
            // ⏱️ Performance-Lücke aus der Analyse — eigenes Layout, keine Copy/Copilot-Buttons
            entriesHtml += buildGapEntryHtml(filePath, err);
          } else {
            entriesHtml += buildErrorEntryHtml(filePath, err, state.analyzeErrors[filePath].indexOf(err), true);
          }
        }

        const actionsHtml = `${buildOpenButtonsHtml(filePath)}
              <span class="file-badge" title="Anzahl Fehler in dieser Datei">${fileErrCount}</span>${fileGapBadge}`;
        groupHtml += buildFileGroupHtml(filePath, `<div class="file-name">📄 ${escapeHtml(fileName)}</div>`, actionsHtml, entriesHtml);
      }

      if (groupCount > 0) {
        filteredTotal += groupErrCount; // ⏱️-Lücken zählen nicht in den Fehlerzähler
        const collapseKey = 'analyze:' + label;
        const isCollapsed = (state.searchTerm && groupCount > 0) ? false : state.collapsedSources[collapseKey] === true;
        const analyzeUserHint = state.analyzeUser ? ` <span style="font-size:0.85em; opacity:0.7;">(${escapeHtml(state.analyzeUser)})</span>` : '';
        const clearDisabled = state.analyzeIsRunning ? ' disabled title="Analyse läuft…"' : ' title="Analyse-Ergebnisse dieser Quelle löschen"';
        const groupGapBadge = groupGapCount > 0 ? `<span class="source-badge gap-badge" title="Anzahl Performance-Gaps (Analyse)">⏱️ ${groupGapCount}</span>` : '';
        html += `
          <div class="source-group analyze-source">
            <div class="source-header analyze-header" onclick="toggleSource(this, '${escapeJs(collapseKey)}')">
              <span><span class="toggle-arrow">${isCollapsed ? '▶' : '▼'}</span> ${escapeHtml(label)}${analyzeUserHint}</span>
              <div class="source-actions">
                <button class="action-btn"${clearDisabled} onclick="clearAnalyzeSource('${escapeJs(label)}', event)">🗑️</button>
                <span class="source-badge" title="Anzahl Fehler (Analyse)">${groupErrCount}</span>${groupGapBadge}
              </div>
            </div>
            <div class="source-content${isCollapsed ? ' collapsed' : ''}">
              ${groupHtml}
            </div>
          </div>`;
      }
    }
  }

  if (!html) {
    state.totalErrors = 0;
    document.getElementById('totalCount').textContent = state.totalErrors;
    updateBrowserTitle();
    container.innerHTML = `
      <div class="empty-state">
        <h2>🔍 Keine Treffer</h2>
        <p>Kein Fehler-Eintrag passt zum Filter/Zeitraum.</p>
      </div>`;
    updateLiveControlStates(0);
    renderTrash();
    if (window.Keasy && window.Keasy.auth && window.Keasy.auth.applyUserRole) {
      window.Keasy.auth.applyUserRole();
    }
    return;
  }

  state.totalErrors = filteredTotal;
  document.getElementById('totalCount').textContent = state.totalErrors;
  updateBrowserTitle();
  container.innerHTML = html;
  updateLiveControlStates(liveTotal);
  renderTrash();
  // Re-apply admin-only restrictions to dynamically rendered buttons
  if (window.Keasy && window.Keasy.auth && window.Keasy.auth.applyUserRole) {
    window.Keasy.auth.applyUserRole();
  }
}

function renderTrash() {
  const trashContainer = document.getElementById('trashContainer');
  if (!trashContainer) return;

  const labels = Object.keys(state.trashData);
  if (labels.length === 0 || state.trashTotalCount === 0) {
    trashContainer.innerHTML = '';
    trashContainer.style.display = 'none';
    return;
  }

  trashContainer.style.display = '';
  let html = `
    <div class="trash-section">
      <button class="trash-header" onclick="toggleTrash()" aria-expanded="${!state.trashCollapsed}" aria-controls="trashContent">
        <span>${state.trashCollapsed ? '▶' : '▼'} 🗑️ Papierkorb (Monitor)</span>
        <div class="trash-header-actions">
          <span class="trash-badge" title="Einträge im Papierkorb (nur Live-Monitoring)">${state.trashTotalCount}</span>
        </div>
      </button>`;

  if (!state.trashCollapsed) {
    html += `
      <div class="trash-toolbar">
        <button class="action-btn trash-restore-btn" onclick="restoreAllTrash()" title="Alle Einträge wiederherstellen">↩️ Alle wiederherstellen</button>
        <button class="action-btn trash-danger-btn" onclick="emptyTrash()" title="Papierkorb endgültig leeren" data-admin-only>🗑️ Papierkorb leeren</button>
        <small style="color:var(--text-secondary); margin-left:8px;">Nur Live-Monitoring — Analyse-Ergebnisse können jederzeit neu erstellt werden.</small>
      </div>
      <div id="trashContent" class="trash-content">`;

    for (const label of labels) {
      const batches = state.trashData[label];
      if (!batches || batches.length === 0) continue;

      let labelCount = 0;
      let latestDeletedAt = '';
      for (const batch of batches) {
        if (batch.deletedAt > latestDeletedAt) latestDeletedAt = batch.deletedAt;
        for (const entries of Object.values(batch.files)) labelCount += entries.length;
      }
      if (labelCount === 0) continue;

      const timeAgo = Keasy.utils.formatTimeAgo(latestDeletedAt);
      const isGroupCollapsed = state.collapsedSources['trash-' + label] !== false;

      html += `
        <div class="trash-group">
          <div class="trash-group-header" onclick="toggleTrashGroup(this, '${escapeJs(label)}')">
            <span>${isGroupCollapsed ? '▶' : '▼'} ${escapeHtml(label)} <small class="trash-time">(${escapeHtml(timeAgo)})</small></span>
            <div class="trash-group-actions">
              <button class="action-btn trash-restore-btn" onclick="restoreTrashSource('${escapeJs(label)}', event)" title="Diese Quelle wiederherstellen">↩️</button>
              <button class="action-btn trash-danger-btn" onclick="emptyTrashSource('${escapeJs(label)}', event)" title="Endgültig löschen">❌</button>
              <span class="trash-badge">${labelCount}</span>
            </div>
          </div>`;

      if (!isGroupCollapsed) {
        html += `<div class="trash-group-content">`;
        let entryCount = 0;
        const MAX_VISIBLE = 50;
        for (const batch of batches) {
          for (const [filePath, entries] of Object.entries(batch.files)) {
            if (entryCount >= MAX_VISIBLE) break;
            const fileName = entries[0]?.file || filePath.split('\\').pop();
            html += `<div class="file-group trash-file-group">
              <div class="file-header" onclick="toggleGroup(this)">
                <div>
                  <div class="file-name">📄 ${escapeHtml(fileName)}</div>
                  <div class="file-path">${escapeHtml(filePath)}</div>
                </div>
                <span class="file-badge">${entries.length}</span>
              </div>
              <div class="error-list" style="display:none">`;
            const shown = entries.slice(-MAX_VISIBLE + entryCount).reverse();
            for (const err of shown) {
              const time = new Date(err.timestamp).toLocaleTimeString('de-DE');
              html += `<div class="error-entry">
                <div class="error-time">${time}</div>
                <div class="error-text">${highlightSearch(highlightPatterns(escapeHtml(err.line)))}</div>
              </div>`;
            }
            html += `</div></div>`;
            entryCount += entries.length;
          }
          if (entryCount >= MAX_VISIBLE) break;
        }
        if (labelCount > MAX_VISIBLE) {
          html += `<div class="trash-more">… und ${labelCount - MAX_VISIBLE} weitere Einträge</div>`;
        }
        html += `</div>`;
      }

      html += `</div>`;
    }

    html += `</div>`;
  }

  html += `</div>`;
  trashContainer.innerHTML = html;
}

// Disable "Sichtbare löschen" wenn keine Live-Fehler sichtbar sind
function updateLiveControlStates(visibleLiveCount) {
  const clearBtn = document.getElementById('clearAllBtn');
  if (clearBtn) {
    // Don't re-enable if admin-only restriction applies
    const isAdmin = Keasy.state.currentUser && Keasy.state.currentUser.role === 'admin';
    if (!isAdmin) {
      clearBtn.disabled = true;
      clearBtn.title = '🔒 Nur für Administratoren';
    } else {
      clearBtn.disabled = visibleLiveCount === 0;
      if (visibleLiveCount === 0) {
        clearBtn.title = 'Keine Live-Einträge zum Löschen vorhanden';
      } else {
        if (typeof updateClearButtonText === 'function') updateClearButtonText();
      }
    }
  }
}

window.Keasy.render = { renderAll, renderTrash, isInDateRange };

Object.assign(window, {
  renderAll, renderTrash, isInDateRange
});
})();
