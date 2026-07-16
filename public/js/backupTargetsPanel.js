/**
 * Keasy Log Monitor — Backup Targets Panel
 * Lokale Backup-Ziele: Cards, CRUD, Connection-Test, collectBackupConfig
 */
(function() {
  const { showToast } = Keasy;

  const LABEL_PRESETS = [
    { value: 'Lokales Backup', icon: '📁' },
    { value: 'Cloud / Sync-Ordner', icon: '☁️' },
    { value: 'Externes Laufwerk', icon: '💾' },
    { value: '__custom__', icon: '✏️' }
  ];

  function renderLocalCards(locals) {
    const container = document.getElementById('backupLocalCards');
    container.innerHTML = '';
    for (const loc of locals) {
      container.appendChild(createLocalCard(loc));
    }
  }

  function createLocalCard(loc) {
    const id = loc.id || ('loc_' + Math.random().toString(36).slice(2, 10));
    const preset = LABEL_PRESETS.find(p => p.value === loc.label);
    const icon = preset ? preset.icon : '📁';
    const isCustom = !preset || preset.value === '__custom__';

    const card = document.createElement('div');
    card.className = 'backup-card';
    card.dataset.targetId = id;
    card.style.cssText = 'border:1px solid var(--border-color); border-radius:8px; overflow:hidden;';
    if (!loc.enabled) card.style.opacity = '0.5';

    const esc = Keasy.utils && Keasy.utils.escapeHtml ? Keasy.utils.escapeHtml : (s => s.replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));

    card.innerHTML = `
      <div class="backup-card-header" style="padding:12px 16px; background:var(--bg-secondary); display:flex; justify-content:space-between; align-items:center; cursor:pointer;">
        <span style="font-weight:600;" data-label-display>${icon} ${esc(loc.label || 'Lokales Backup')}</span>
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer;" onclick="event.stopPropagation()">
          <input type="checkbox" data-field="enabled" ${loc.enabled ? 'checked' : ''} onchange="onLocalCardToggle(this); markConfigDirty()"> Aktiv
        </label>
      </div>
      <div class="backup-card-body" style="padding:16px; display:${loc.enabled ? 'block' : 'none'};">
        <input type="hidden" data-field="id" value="${esc(id)}">
        <div class="config-field" style="margin-bottom:8px;">
          <label>Label:</label>
          <select data-field="labelSelect" style="padding:4px 8px; width:100%;" onchange="onLocalLabelChange(this); markConfigDirty()">
            ${LABEL_PRESETS.map(p => `<option value="${esc(p.value)}" ${(isCustom && p.value === '__custom__') || (!isCustom && p.value === loc.label) ? 'selected' : ''}>${p.icon} ${p.value === '__custom__' ? 'Benutzerdefiniert…' : esc(p.value)}</option>`).join('')}
          </select>
        </div>
        <div class="config-field" data-custom-label style="margin-bottom:8px; display:${isCustom ? 'block' : 'none'};">
          <label>Eigenes Label:</label>
          <input type="text" data-field="customLabel" value="${esc(isCustom ? (loc.label || '') : '')}" placeholder="Mein Backup" style="width:100%;" oninput="markConfigDirty()">
        </div>
        <div class="config-field" style="margin-bottom:12px;">
          <label>Pfad:</label>
          <div style="display:flex; align-items:center; gap:6px; flex:1; min-width:0;">
            <input type="text" data-field="path" value="${esc(loc.path || '')}" placeholder="C:\\Backups\\keasy oder \\\\server\\share" maxlength="600" style="flex:1; min-width:0; width:auto; max-width:none;" oninput="markConfigDirty()">
            <button type="button" class="folder-picker-btn" onclick="pickBackupFolder(this)" title="Ordner auswählen">📂</button>
            <button class="config-save-btn" data-open-folder onclick="openBackupFolder(this)" style="padding:4px 8px; font-size:0.95em; display:${loc.label === 'Cloud / Sync-Ordner' ? 'none' : 'inline-block'};" title="Ordner im Explorer öffnen">↗️</button>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
          <span data-last-status style="font-size:0.85em; color:var(--text-secondary);"></span>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:8px;">
            <button class="config-save-btn" onclick="testLocalConnection(this)" style="padding:4px 12px; font-size:0.85em;">🔍 Prüfen</button>
            <span data-test-result style="font-size:0.85em;"></span>
          </div>
          <button onclick="removeLocalTarget(this)" style="background:none; border:none; cursor:pointer; font-size:1.1em; opacity:0.5; padding:4px 8px;" title="Ziel entfernen">🗑️</button>
        </div>
      </div>
    `;

    card.querySelector('.backup-card-header').addEventListener('click', function() {
      const body = card.querySelector('.backup-card-body');
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });

    return card;
  }

  function onLocalCardToggle(checkbox) {
    const card = checkbox.closest('.backup-card');
    const body = card.querySelector('.backup-card-body');
    if (checkbox.checked) {
      card.style.opacity = '1';
      body.style.display = 'block';
    } else {
      card.style.opacity = '0.5';
      body.style.display = 'none';
    }
  }

  function onLocalLabelChange(select) {
    const card = select.closest('.backup-card');
    const customDiv = card.querySelector('[data-custom-label]');
    const display = card.querySelector('[data-label-display]');
    const folderBtn = card.querySelector('[data-open-folder]');
    if (select.value === '__custom__') {
      customDiv.style.display = 'block';
      const custom = card.querySelector('[data-field="customLabel"]').value || 'Benutzerdefiniert';
      display.textContent = '✏️ ' + custom;
      if (folderBtn) folderBtn.style.display = 'inline-block';
    } else {
      customDiv.style.display = 'none';
      const preset = LABEL_PRESETS.find(p => p.value === select.value);
      display.textContent = (preset ? preset.icon : '📁') + ' ' + select.value;
      if (folderBtn) folderBtn.style.display = select.value === 'Cloud / Sync-Ordner' ? 'none' : 'inline-block';
    }
  }

  async function pickBackupFolder(btn) {
    const card = btn.closest('.backup-card');
    const input = card.querySelector('[data-field="path"]');
    if (typeof showFolderPicker !== 'function') return;
    const chosen = await showFolderPicker(input.value.trim() || '');
    if (chosen) {
      input.value = chosen;
      if (typeof markConfigDirty === 'function') markConfigDirty();
    }
  }

  async function openBackupFolder(btn) {
    const card = btn.closest('.backup-card');
    const pathVal = card.querySelector('[data-field="path"]').value.trim();
    if (!pathVal) { if (showToast) showToast('Kein Pfad eingetragen', 'error'); return; }
    try {
      await fetch('/api/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: pathVal })
      });
    } catch (err) {
      if (showToast) showToast('Fehler: ' + err.message, 'error');
    }
  }

  function addLocalTarget() {
    const container = document.getElementById('backupLocalCards');
    const newId = 'loc_' + Math.random().toString(36).slice(2, 10);
    container.appendChild(createLocalCard({
      id: newId, enabled: true, label: 'Lokales Backup', path: ''
    }));
    if (typeof markConfigDirty === 'function') markConfigDirty();
  }

  function removeLocalTarget(btn) {
    const card = btn.closest('.backup-card');
    const pathVal = card.querySelector('[data-field="path"]').value;
    const label = card.querySelector('[data-label-display]').textContent;
    if (pathVal && !confirm(`Ziel "${label}" wirklich entfernen?`)) return;
    card.remove();
    if (typeof markConfigDirty === 'function') markConfigDirty();
  }

  async function testLocalConnection(btn) {
    const card = btn.closest('.backup-card');
    const resultEl = card.querySelector('[data-test-result]');
    const pathVal = card.querySelector('[data-field="path"]').value.trim();
    const id = card.querySelector('[data-field="id"]').value;
    resultEl.textContent = '● prüft...';
    resultEl.style.color = 'var(--text-secondary)';

    try {
      const resp = await fetch('/api/backup/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'local:' + id, path: pathVal })
      });
      const result = await resp.json();
      if (result.ok) {
        resultEl.textContent = '✅ Verbindung OK (beschreibbar)';
        resultEl.style.color = '#10b981';
      } else {
        resultEl.textContent = '❌ ' + (result.error || 'Fehler');
        resultEl.style.color = '#ef4444';
      }
    } catch (err) {
      resultEl.textContent = '❌ ' + err.message;
      resultEl.style.color = '#ef4444';
    }
  }

  function collectBackupConfig() {
    const ftpPass = document.getElementById('backupFtpPass').value;

    const locals = [];
    document.querySelectorAll('#backupLocalCards .backup-card').forEach(card => {
      const sel = card.querySelector('[data-field="labelSelect"]');
      let label;
      if (sel.value === '__custom__') {
        label = card.querySelector('[data-field="customLabel"]').value.trim() || 'Benutzerdefiniert';
      } else {
        label = sel.value;
      }
      locals.push({
        id: card.querySelector('[data-field="id"]').value,
        enabled: card.querySelector('[data-field="enabled"]').checked,
        label,
        path: card.querySelector('[data-field="path"]').value.trim()
      });
    });

    return {
      schedule: {
        enabled: document.getElementById('backupScheduleEnabled').checked,
        time: document.getElementById('backupScheduleTime').value
      },
      maxBackupsPerTarget: parseInt(document.getElementById('backupMaxPerTarget').value) || 10,
      includeEmailLog: document.getElementById('backupIncludeEmailLog').checked,
      includeFullBackup: document.getElementById('backupIncludeFullBackup').checked,
      locals,
      ftp: {
        enabled: document.getElementById('backupFtpEnabled').checked,
        host: document.getElementById('backupFtpHost').value.trim(),
        port: parseInt(document.getElementById('backupFtpPort').value) || 21,
        user: document.getElementById('backupFtpUser').value.trim(),
        pass: ftpPass || '••••••••',
        secure: document.getElementById('backupFtpSecure').value !== 'none',
        secureMode: document.getElementById('backupFtpSecure').value,
        remotePath: document.getElementById('backupFtpRemotePath').value.trim() || '/backups'
      }
    };
  }

  // Window-Globals für onclick-Handler
  Object.assign(window, {
    onLocalCardToggle, onLocalLabelChange, openBackupFolder, pickBackupFolder,
    addLocalTarget, removeLocalTarget, testLocalConnection, collectBackupConfig
  });

  // Namespace registrieren
  Keasy.backup = Keasy.backup || {};
  Keasy.backup.targets = { renderLocalCards, collectBackupConfig };

})();
