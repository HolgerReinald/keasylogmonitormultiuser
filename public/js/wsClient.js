(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;

// rAF-Batching: bei vielen schnellen WS-Nachrichten nur einmal rendern
let renderScheduled = false;
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderAll();
  });
}

function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${protocol}//${location.host}`);

  state.ws.onopen = () => {
    document.getElementById('statusDot').classList.add('connected');
    document.getElementById('statusText').textContent = 'Verbunden';
  };

  state.ws.onclose = (event) => {
    document.getElementById('statusDot').classList.remove('connected');
    // Session abgelaufen → Reload zum Login
    if (event.code === 4401 || event.code === 4403) {
      window.location.reload();
      return;
    }
    if (state.serverStopped) {
      document.getElementById('statusText').textContent = 'Monitor beendet';
      state.nextEmailSendTime = null;
      document.querySelectorAll('.email-countdown').forEach(el => { el.textContent = '--:--'; });
      document.getElementById('restartWatcherBtn').disabled = true;
    } else {
      document.getElementById('statusText').textContent = 'Getrennt - Reconnect...';
      setTimeout(connect, 3000);
    }
  };

  state.ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'init') {
      state.errors = {};
      state.fileLabels = {};
      state.visibleLabels = msg.visibleLabels || null; // null = alle sichtbar
      state.oversizedFiles = msg.oversizedFiles || {};
      state.maxLogFileSizeMB = msg.maxLogFileSizeMB ?? state.maxLogFileSizeMB;
      if (msg.version) {
        document.getElementById('appVersion').textContent = 'v' + msg.version;
      }
      for (const [filePath, data] of Object.entries(msg.data)) {
        state.errors[filePath] = data.errors || data;
        if (data.label) state.fileLabels[filePath] = data.label;
      }
      if (msg.pausedSources) {
        state.pausedSources = new Set(msg.pausedSources);
      }
      if (msg.emailDisabledSources) {
        state.emailDisabledSources = new Set(msg.emailDisabledSources);
      }
      if (msg.emailConfigured) {
        state.emailConfiguredSources = new Set(msg.emailConfigured);
      }
      if (msg.nextEmailSendTime) {
        state.nextEmailSendTime = msg.nextEmailSendTime;
      }
      // Analyse-Ergebnisse laden
      state.analyzeErrors = {};
      state.analyzeLabels = {};
      state.analyzeUser = msg.analyzeUser || (state.currentUser && state.currentUser.username) || '';
      if (msg.analyzeData) {
        for (const [filePath, data] of Object.entries(msg.analyzeData)) {
          state.analyzeErrors[filePath] = data.errors || [];
          if (data.label) state.analyzeLabels[filePath] = data.label;
        }
      }
      if (msg.analyzeRunning) {
        state.analyzeIsRunning = true;
        document.getElementById('analyzeStartBtn').style.display = 'none';
        document.getElementById('analyzeCancelBtn').style.display = '';
      } else {
        state.analyzeIsRunning = false;
        document.getElementById('analyzeStartBtn').style.display = '';
        document.getElementById('analyzeCancelBtn').style.display = 'none';
      }
      updateAnalyzeButtons();
      // Papierkorb laden
      if (msg.trashData) {
        state.trashData = msg.trashData.data || {};
        state.trashTotalCount = msg.trashData.totalCount || 0;
        state.trashRevision = msg.trashData.revision || 0;
      }
      if (!state.paused) renderAll();
      // Health-Check Ergebnis wiederherstellen
      if (msg.healthCheckLastResult && Keasy.systemCheck) {
        Keasy.systemCheck.restoreLastResult(msg.healthCheckLastResult);
      }
    } else if (msg.type === 'error') {
      const { filePath, error, label } = msg.data;
      if (!state.errors[filePath]) state.errors[filePath] = [];
      state.errors[filePath].push(error);
      if (label) state.fileLabels[filePath] = label;
      if (state.errors[filePath].length > 20) {
        state.errors[filePath] = state.errors[filePath].slice(-10);
      }
      if (!state.paused) {
        scheduleRender();
        notifyNewError(error);
      }
    } else if (msg.type === 'source-paused') {
      state.pausedSources.add(msg.data.label);
      if (!state.paused) scheduleRender();
    } else if (msg.type === 'source-resumed') {
      state.pausedSources.delete(msg.data.label);
      if (!state.paused) scheduleRender();
    } else if (msg.type === 'source-cleared') {
      const label = msg.data.label;
      const dateFrom = msg.data.dateFrom;
      const dateTo = msg.data.dateTo;
      const cutoff = msg.data.cutoff;
      for (const fp of Object.keys(state.errors)) {
        if (state.fileLabels[fp] === label) {
          if (dateFrom || dateTo || cutoff) {
            state.errors[fp] = state.errors[fp].filter(e => {
              const t = new Date(e.timestamp);
              if (cutoff && t < new Date(cutoff)) return true;
              if (dateFrom && t < new Date(dateFrom + 'T00:00:00')) return true;
              if (dateTo && t > new Date(dateTo + 'T23:59:59.999')) return true;
              return false;
            });
            if (state.errors[fp].length === 0) delete state.errors[fp];
          } else {
            delete state.errors[fp];
          }
        }
      }
      if (!state.paused) scheduleRender();
    } else if (msg.type === 'all-cleared') {
      const dateFrom = msg.data.dateFrom;
      const dateTo = msg.data.dateTo;
      const cutoff = msg.data.cutoff;
      if (dateFrom || dateTo || cutoff) {
        for (const fp of Object.keys(state.errors)) {
          state.errors[fp] = state.errors[fp].filter(e => {
            const t = new Date(e.timestamp);
            if (cutoff && t < new Date(cutoff)) return true;
            if (dateFrom && t < new Date(dateFrom + 'T00:00:00')) return true;
            if (dateTo && t > new Date(dateTo + 'T23:59:59.999')) return true;
            return false;
          });
          if (state.errors[fp].length === 0) delete state.errors[fp];
        }
      } else {
        state.errors = {};
      }
      if (!state.paused) scheduleRender();
    } else if (msg.type === 'email-disabled') {
      state.emailDisabledSources.add(msg.data.label);
      if (!state.paused) scheduleRender();
    } else if (msg.type === 'email-enabled') {
      state.emailDisabledSources.delete(msg.data.label);
      if (!state.paused) scheduleRender();
    } else if (msg.type === 'email-timer') {
      state.nextEmailSendTime = msg.data.nextSendTime;
    } else if (msg.type === 'config-changed') {
      if (msg.data.emailConfigured) {
        state.emailConfiguredSources = new Set(msg.data.emailConfigured);
      }
      if (msg.data.maxLogFileSizeMB != null) {
        state.maxLogFileSizeMB = msg.data.maxLogFileSizeMB;
      }
      if (!state.paused) scheduleRender();
    } else if (msg.type === 'oversized-files') {
      state.oversizedFiles = msg.data || {};
      if (!state.paused) scheduleRender();
    } else if (msg.type === 'preload-start') {
      showPreloadBanner(msg.data);
    } else if (msg.type === 'preload-progress') {
      updatePreloadBanner(msg.data);
    } else if (msg.type === 'preload-done') {
      hidePreloadBanner(msg.data);
    } else if (msg.type === 'analyze-error') {
      const { filePath, error, label } = msg.data;
      if (!state.analyzeErrors[filePath]) state.analyzeErrors[filePath] = [];
      state.analyzeErrors[filePath].push(error);
      if (label) state.analyzeLabels[filePath] = label;
      if (!state.paused) scheduleRender();
    } else if (msg.type === 'analyze-start') {
      state.analyzeUser = msg.data.username || '';
      // Alte Ergebnisse leeren — Server startet mit leerem Store
      state.analyzeErrors = {};
      state.analyzeLabels = {};
      updateAnalyzeProgress(0, msg.data.total, 0, true, false, msg.data.skippedPaths);
    } else if (msg.type === 'analyze-progress') {
      updateAnalyzeProgress(msg.data.current, msg.data.total, msg.data.errors, true);
    } else if (msg.type === 'analyze-done') {
      state.analyzeUser = msg.data.username || state.analyzeUser || '';
      updateAnalyzeProgress(msg.data.processed, msg.data.total, msg.data.errors, false, msg.data.aborted);
      if (!state.paused) scheduleRender();
    } else if (msg.type === 'analyze-cleared') {
      state.analyzeErrors = {};
      state.analyzeLabels = {};
      updateAnalyzeButtons();
      if (!state.paused) scheduleRender();
    } else if (msg.type === 'analyze-source-cleared') {
      const label = msg.data.label;
      for (const fp of Object.keys(state.analyzeErrors)) {
        if (state.analyzeLabels[fp] === label) {
          delete state.analyzeErrors[fp];
          delete state.analyzeLabels[fp];
        }
      }
      updateAnalyzeButtons();
      if (!state.paused) scheduleRender();
    } else if (msg.type === 'trash-snapshot') {
      state.trashData = msg.data || {};
      state.trashTotalCount = msg.totalCount || 0;
      state.trashRevision = msg.revision || 0;
      renderTrash();
    } else if (msg.type === 'errors-restored') {
      state.errors = {};
      state.fileLabels = {};
      for (const [filePath, data] of Object.entries(msg.data)) {
        state.errors[filePath] = data.errors || data;
        if (data.label) state.fileLabels[filePath] = data.label;
      }
      if (!state.paused) scheduleRender();
    } else if (msg.type === 'system-check-progress') {
      if (Keasy.systemCheck) Keasy.systemCheck.onCheckProgress(msg.check);
    } else if (msg.type === 'system-check-done') {
      if (Keasy.systemCheck) Keasy.systemCheck.onCheckDone(msg.result);
    }
  };
}

window.Keasy.ws = { connect };

Object.assign(window, { connect });
})();
