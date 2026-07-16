(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;
const { escapeHtml } = Keasy.utils;

let _populatingForm = false;
let _configFormPopulated = false;

function markConfigDirty() {
  if (_populatingForm) return;
  const btn = document.getElementById('configSaveBtn');
  if (btn && btn.disabled) {
    console.log('[Config] markConfigDirty → Button aktiviert');
  }
  if (btn) btn.disabled = false;
}

function toggleConfigPanel() {
  const panel = document.getElementById('configPanel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) {
    // Analyse-Panel schließen wenn offen
    document.getElementById('analyzePanel').classList.remove('open');
    if (!_configFormPopulated) loadConfig();
  }
}

function switchConfigTab(tab) {
  // Dirty-Warnung bei CSS-Tab-Wechsel
  if (state.cssDirty && state.cssCurrentTab === 'csseditor' && tab !== 'csseditor') {
    if (!confirm('Ungespeicherte CSS-Änderungen gehen verloren. Fortfahren?')) return;
    state.cssDirty = false;
    document.getElementById('live-style').textContent = '';
  }
  state.cssCurrentTab = tab;
  document.querySelectorAll('#configPanel .config-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#configPanel .config-section').forEach(s => s.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('config-' + tab).classList.add('active');
  if (tab === 'docs' && !state.docsLoaded) {
    Keasy.docs.loadDocs();
  }
  if (tab === 'emaillog') {
    loadEmailLog();
  }
  if (tab === 'csseditor' && !state.cssLoaded) {
    Keasy.cssEditor.loadCssEditor();
  }
  if (tab === 'backup' && typeof loadBackupList === 'function') {
    loadBackupList();
  }
  if (tab === 'users' && Keasy.userPanel) {
    Keasy.userPanel.loadUsers();
  }
  // Config-Buttons bei Tabs ohne Config-Formular ausblenden
  const configActions = document.querySelector('.config-actions');
  if (configActions) {
    configActions.style.display = (tab === 'docs' || tab === 'emaillog' || tab === 'csseditor' || tab === 'systemcheck' || tab === 'users') ? 'none' : '';
  }
}

function resetConfig() {
  if (state.savedConfig) {
    state.currentConfig = JSON.parse(JSON.stringify(state.savedConfig));
    populateConfigForm(state.currentConfig);
    showConfigMessage('↺ Änderungen verworfen', 'success');
    document.getElementById('configSaveBtn').disabled = true;
  } else {
    loadConfig();
  }
}

async function loadEmailLog() {
  try {
    const resp = await fetch('/api/email-log');
    const text = await resp.text();
    const el = document.getElementById('emailLogContent');
    const hasContent = !!text.trim();
    const btn = document.getElementById('clearEmailLogBtn');
    const isAdminOnly = btn.hasAttribute('data-admin-only') && (!Keasy.state.currentUser || Keasy.state.currentUser.role !== 'admin');
    btn.disabled = !hasContent || isAdminOnly;
    if (!hasContent) {
      el.textContent = '(Noch keine E-Mail-Aktivitäten protokolliert)';
    } else {
      el.textContent = text.trim().split('\n').reverse().join('\n');
    }
  } catch (err) {
    document.getElementById('emailLogContent').textContent = 'Fehler beim Laden: ' + err.message;
  }
}

async function clearEmailLog() {
  if (Keasy.state.currentUser && Keasy.state.currentUser.role !== 'admin') return;
  if (!await showConfirm('E-Mail Log wirklich löschen?')) return;
  try {
    await fetch('/api/email-log', { method: 'DELETE' });
    document.getElementById('emailLogContent').textContent = '(Log gelöscht)';
    document.getElementById('clearEmailLogBtn').disabled = true;
  } catch (err) {
    showConfigMessage('Fehler: ' + err.message, 'error');
  }
}

async function loadConfig() {
  try {
    const resp = await fetch('/api/config');
    state.currentConfig = await resp.json();
    state.savedConfig = JSON.parse(JSON.stringify(state.currentConfig));
    populateConfigForm(state.currentConfig);
    _configFormPopulated = true;
    document.getElementById('configSaveBtn').disabled = true;
    // Browser feuert input-Events auf Passwort-Feldern manchmal asynchron
    // nach dem programmatischen .value-Setzen → Guard verlängern
    _populatingForm = true;
    setTimeout(() => { _populatingForm = false; }, 50);
  } catch (err) {
    showConfigMessage('Fehler beim Laden: ' + err.message, 'error');
  }
}

function populateConfigForm(cfg) {
  _populatingForm = true;
  document.getElementById('cfg-port').value = cfg.port || 3847;
  document.getElementById('cfg-maxErrors').value = cfg.maxErrorsPerFile || 10;
  document.getElementById('cfg-autoOpen').checked = cfg.autoOpen !== false;
  document.getElementById('cfg-debugLogging').checked = !!cfg.debugLogging;
  document.getElementById('cfg-authEnabled').checked = cfg.authEnabled !== false;
  document.getElementById('cfg-loadExistingErrors').checked = cfg.loadExistingErrors !== false;
  document.getElementById('cfg-maxLogFileSizeMB').value = cfg.maxLogFileSizeMB || 6;
  document.getElementById('cfg-trashAutoCleanupHours').value = cfg.trashAutoCleanupHours != null ? cfg.trashAutoCleanupHours : 48;
  document.getElementById('cfg-copilotWorkingPathDevelop').value = cfg.copilotWorkingPathDevelop || cfg.copilotWorkingPath || '';
  document.getElementById('cfg-copilotWorkingPathRelease').value = cfg.copilotWorkingPathRelease || '';
  document.getElementById('cfg-filePattern').value = cfg.filePattern || '**/*.log';

  const email = cfg.email || {};
  document.getElementById('cfg-emailEnabled').checked = email.enabled || false;
  document.getElementById('cfg-emailInterval').value = email.intervalMinutes || 5;
  document.getElementById('cfg-deduplicateMin').value = email.deduplicateMinutes || 60;
  const smtp = email.smtp || {};
  document.getElementById('cfg-smtpHost').value = smtp.host || '';
  document.getElementById('cfg-smtpPort').value = smtp.port || 465;
  document.getElementById('cfg-smtpSecure').checked = smtp.secure || false;
  document.getElementById('cfg-smtpIPv4').checked = smtp.family === 4;
  const auth = smtp.auth || {};
  document.getElementById('cfg-smtpUser').value = auth.user || '';
  document.getElementById('cfg-smtpPass').value = auth._hasPassword ? '••••••••' : '';
  document.getElementById('cfg-emailFrom').value = email.from || '';
  document.getElementById('cfg-emailSubject').value = email.subject || '[Keasy Monitor] Fehler in: {label}';

  Keasy.watchPaths.renderWatchPathsTable(cfg.watchPaths || []);

  state.configFilterPatterns = [...(cfg.filterPatterns || [])];
  renderFilterList();

  state.configExcludePatterns = [...(cfg.excludePatterns || [])];
  renderExcludeList();

  state.configThresholdRules = JSON.parse(JSON.stringify(cfg.thresholdRules || []));
  Keasy.threshold.renderThresholdRules();

  // Log-Analyse Pfade laden
  state.analyzePaths = [...(cfg.analyzePaths || [])];
  renderAnalyzePaths();
  document.getElementById('analyzeMaxErrors').value = cfg.analyzeMaxErrors || 100;
  // Nie konfiguriert (undefined) → Richtwert 20; explizite 0 bleibt "aus"
  document.getElementById('analyzeGapWarnSeconds').value = cfg.analyzeGapWarnSeconds ?? 20;
  document.getElementById('analyzeGapIdleMinutes').value = cfg.analyzeGapIdleMinutes || '';
  updateAnalyzeButtons();

  // Backup-Config laden
  if (typeof loadBackupConfig === 'function') loadBackupConfig(cfg);
  _populatingForm = false;
}

function renderFilterList() {
  const container = document.getElementById('cfg-filter-list');
  container.innerHTML = state.configFilterPatterns.map((p, i) =>
    `<span class="config-list-item">${escapeHtml(p)}<button class="remove-item" onclick="removeFilterPattern(${i})" data-admin-only>✕</button></span>`
  ).join('');
  // Re-apply admin-only restrictions
  if (window.Keasy && window.Keasy.auth && window.Keasy.auth.applyUserRole) {
    window.Keasy.auth.applyUserRole();
  }
}

function addFilterPattern() {
  const input = document.getElementById('cfg-filter-new');
  const val = input.value.trim();
  if (val && !state.configFilterPatterns.includes(val)) {
    state.configFilterPatterns.push(val);
    renderFilterList();
    markConfigDirty();
  }
  input.value = '';
}

function removeFilterPattern(index) {
  state.configFilterPatterns.splice(index, 1);
  renderFilterList();
  markConfigDirty();
}

function renderExcludeList() {
  const container = document.getElementById('cfg-exclude-list');
  container.innerHTML = state.configExcludePatterns.map((p, i) =>
    `<span class="config-list-item">${escapeHtml(p)}<button class="remove-item" onclick="removeExcludePattern(${i})" data-admin-only>✕</button></span>`
  ).join('');
  // Re-apply admin-only restrictions
  if (window.Keasy && window.Keasy.auth && window.Keasy.auth.applyUserRole) {
    window.Keasy.auth.applyUserRole();
  }
}

function addExcludePattern() {
  const input = document.getElementById('cfg-exclude-new');
  const val = input.value.trim();
  if (val && !state.configExcludePatterns.includes(val)) {
    state.configExcludePatterns.push(val);
    renderExcludeList();
    markConfigDirty();
  }
  input.value = '';
}

function removeExcludePattern(index) {
  state.configExcludePatterns.splice(index, 1);
  renderExcludeList();
  markConfigDirty();
}

function buildConfigFromForm() {
  const cfg = {
    port: parseInt(document.getElementById('cfg-port').value) || 3847,
    autoOpen: document.getElementById('cfg-autoOpen').checked,
    debugLogging: document.getElementById('cfg-debugLogging').checked,
    authEnabled: document.getElementById('cfg-authEnabled').checked,
    maxErrorsPerFile: parseInt(document.getElementById('cfg-maxErrors').value) || 10,
    loadExistingErrors: document.getElementById('cfg-loadExistingErrors').checked,
    maxLogFileSizeMB: Math.min(99, Math.max(1, parseInt(document.getElementById('cfg-maxLogFileSizeMB').value) || 6)),
    trashAutoCleanupHours: Math.max(0, parseInt(document.getElementById('cfg-trashAutoCleanupHours').value) || 48),
    copilotWorkingPathDevelop: document.getElementById('cfg-copilotWorkingPathDevelop').value.trim(),
    copilotWorkingPathRelease: document.getElementById('cfg-copilotWorkingPathRelease').value.trim(),
    email: {
      enabled: document.getElementById('cfg-emailEnabled').checked,
      intervalMinutes: parseInt(document.getElementById('cfg-emailInterval').value) || 5,
      deduplicateMinutes: parseInt(document.getElementById('cfg-deduplicateMin').value) || 60,
      smtp: {
        host: document.getElementById('cfg-smtpHost').value.trim(),
        port: parseInt(document.getElementById('cfg-smtpPort').value) || 465,
        secure: document.getElementById('cfg-smtpSecure').checked
      },
      from: document.getElementById('cfg-emailFrom').value.trim(),
      subject: document.getElementById('cfg-emailSubject').value.trim() || '[Keasy Monitor] Fehler in: {label}'
    },
    watchPaths: Keasy.watchPaths.getWatchPathsFromTable(),
    filePattern: document.getElementById('cfg-filePattern').value.trim() || '**/*.log',
    filterPatterns: [...state.configFilterPatterns],
    excludePatterns: [...state.configExcludePatterns],
    thresholdRules: Keasy.threshold.getThresholdRulesFromForm(),
    analyzePaths: [...state.analyzePaths],
    analyzeMaxErrors: parseInt(document.getElementById('analyzeMaxErrors').value) || 100,
    analyzeGapWarnSeconds: parseInt(document.getElementById('analyzeGapWarnSeconds').value) || 0,
    analyzeGapIdleMinutes: parseInt(document.getElementById('analyzeGapIdleMinutes').value) || 0,
    backup: (() => {
      const canCollect = Keasy.backup && Keasy.backup._loaded && typeof collectBackupConfig === 'function';
      if (!canCollect) {
        console.warn('[Config] Backup-Fallback aktiv: _loaded=' + (Keasy.backup && Keasy.backup._loaded) + ' collectFn=' + (typeof collectBackupConfig));
      }
      return canCollect ? collectBackupConfig() : (state.currentConfig && state.currentConfig.backup);
    })()
  };

  if (document.getElementById('cfg-smtpIPv4').checked) {
    cfg.email.smtp.family = 4;
  }

  const user = document.getElementById('cfg-smtpUser').value.trim();
  const pass = document.getElementById('cfg-smtpPass').value;
  if (user) {
    cfg.email.smtp.auth = { user, pass };
  }

  return cfg;
}

async function saveConfig() {
  // Schwellwertregeln vorab validieren (blockiert Speichern bei Fehler)
  const thresholdRules = Keasy.threshold.getThresholdRulesFromForm();
  if (thresholdRules === null) {
    showConfigMessage('Schwellwertregel unvollständig: "Zeile enthält" und "Schwellwert" sind Pflichtfelder.', 'error');
    return;
  }
  const cfg = buildConfigFromForm();
  cfg.thresholdRules = thresholdRules;

  const isAdmin = Keasy.state.currentUser && Keasy.state.currentUser.role === 'admin';
  // Globale Validierungen nur für Admins (Nicht-Admins ändern diese Felder nicht)
  if (isAdmin) {
    if (cfg.watchPaths.length === 0) {
      showConfigMessage('Mindestens ein Überwachungspfad erforderlich!', 'error');
      return;
    }
    if (cfg.filterPatterns.length === 0) {
      showConfigMessage('Mindestens ein Filter-Pattern erforderlich!', 'error');
      return;
    }
    // Gap-Schwellwerte: Warn-Schwelle muss unter der Idle-Grenze liegen (leer = Default 30 Min)
    for (const wp of cfg.watchPaths) {
      const warn = wp.gapWarnSeconds || 0;
      const idle = wp.gapIdleMinutes || 30;
      if (warn > 0 && warn >= idle * 60) {
        showConfigMessage(`⏱️ Gap-Warnung (Sek.) muss kleiner als Idle-Grenze (Min.) sein: ${wp.label}`, 'error');
        return;
      }
    }
  }

  try {
    const resp = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    });
    const result = await resp.json();
    if (result.ok) {
      showConfigMessage('✅ Gespeichert & angewendet', 'success');
      document.getElementById('configSaveBtn').disabled = true;
      state.currentConfig = cfg;
      setTimeout(loadConfig, 500);
    } else {
      showConfigMessage('❌ ' + (result.message || 'Fehler'), 'error');
    }
  } catch (err) {
    showConfigMessage('❌ ' + err.message, 'error');
  }
}

function showConfigMessage(text, type) {
  const el = document.getElementById('configMessage');
  el.textContent = text;
  el.className = 'config-message' + (type ? ' ' + type : '');
  if (text) setTimeout(() => { el.textContent = ''; }, 5000);
}

// --- Preload-Fortschrittsanzeige ---

function showPreloadBanner(data) {
  if (state.preloadHideTimer) { clearTimeout(state.preloadHideTimer); state.preloadHideTimer = null; }
  const banner = document.getElementById('preloadBanner');
  const text = document.getElementById('preloadText');
  const bar = document.getElementById('preloadBar');
  banner.className = 'preload-banner';
  const labelInfo = Object.entries(data.labels || {}).map(([l, c]) => `${l}: ${c}`).join(', ');
  text.textContent = `📥 Fehler einlesen: 0/${data.total} Dateien (${labelInfo})`;
  bar.style.width = '0%';
  banner.style.display = 'flex';
}

function updatePreloadBanner(data) {
  const text = document.getElementById('preloadText');
  const bar = document.getElementById('preloadBar');
  text.textContent = `📥 Einlesen: ${data.current}/${data.total} (${data.percent}%) — [${data.label}] ${data.file}`;
  bar.style.width = data.percent + '%';
}

function hidePreloadBanner(data) {
  if (state.preloadHideTimer) { clearTimeout(state.preloadHideTimer); state.preloadHideTimer = null; }
  const banner = document.getElementById('preloadBanner');
  const text = document.getElementById('preloadText');
  const bar = document.getElementById('preloadBar');
  if (data.aborted) {
    text.textContent = `📥 ⚠️ Einlesen abgebrochen (Watcher-Neustart)`;
    bar.style.width = '0%';
    banner.className = 'preload-banner preload-aborted';
  } else {
    const labelInfo = Object.entries(data.labelErrors || {})
      .filter(([, c]) => c > 0)
      .map(([l, c]) => `${l}: ${c}`)
      .join(', ');
    text.textContent = `📥 ✅ Einlesen abgeschlossen: ${data.errorsFound} Fehler in ${data.total} Dateien` + (labelInfo ? ` (${labelInfo})` : '');
    bar.style.width = '100%';
  }
  state.preloadHideTimer = setTimeout(() => {
    banner.style.display = 'none';
    state.preloadHideTimer = null;
  }, 5000);
}

window.Keasy.config = {
  markConfigDirty, toggleConfigPanel, switchConfigTab,
  resetConfig, loadEmailLog, clearEmailLog, loadConfig, populateConfigForm,
  renderFilterList, addFilterPattern, removeFilterPattern,
  renderExcludeList, addExcludePattern, removeExcludePattern,
  buildConfigFromForm, saveConfig, showConfigMessage,
  showPreloadBanner, updatePreloadBanner, hidePreloadBanner
};

Object.assign(window, {
  toggleConfigPanel, switchConfigTab,
  addFilterPattern, removeFilterPattern,
  addExcludePattern, removeExcludePattern, saveConfig, resetConfig,
  loadEmailLog, clearEmailLog, markConfigDirty,
  showPreloadBanner, updatePreloadBanner, hidePreloadBanner,
  showConfigMessage, loadConfig, populateConfigForm
});

})();
