/**
 * Keasy Log Monitor — Backup Panel (Fassade)
 * loadBackupConfig (Koordinator), FTP-Config, Save, Run, Status
 */
(function() {
  const { showToast } = Keasy;
  const { formatSize, formatTimeAgo } = Keasy.utils;

  let _backupLoaded = false;

  // ─── Config laden (Koordinator) ─────────────────────────
  function loadBackupConfig(cfg) {
    _backupLoaded = true;
    const b = cfg.backup || {};
    const schedule = b.schedule || {};
    const ftp = b.ftp || {};

    document.getElementById('backupScheduleEnabled').checked = schedule.enabled || false;
    document.getElementById('backupScheduleTime').value = schedule.time || '02:00';
    document.getElementById('backupMaxPerTarget').value = b.maxBackupsPerTarget || 10;
    document.getElementById('backupIncludeEmailLog').checked = b.includeEmailLog !== false;
    document.getElementById('backupIncludeFullBackup').checked = b.includeFullBackup === true;

    // Lokale Ziele rendern (delegiert an targets-Modul)
    Keasy.backup.targets.renderLocalCards(b.locals || []);

    // FTP initialisieren
    document.getElementById('backupFtpEnabled').checked = ftp.enabled || false;
    document.getElementById('backupFtpHost').value = ftp.host || '';
    document.getElementById('backupFtpPort').value = ftp.port || 21;
    document.getElementById('backupFtpUser').value = ftp.user || '';
    document.getElementById('backupFtpPass').value = '';
    document.getElementById('backupFtpRemotePath').value = ftp.remotePath || '/backups';
    const secureEl = document.getElementById('backupFtpSecure');
    if (ftp.secureMode) {
      secureEl.value = ftp.secureMode;
    } else if (ftp.secure === true || ftp.secure === 'implicit') {
      secureEl.value = 'implicit';
    } else if (ftp.secure === 'explicit') {
      secureEl.value = 'explicit';
    } else if (ftp.secure === false) {
      secureEl.value = 'none';
    } else {
      secureEl.value = 'explicit';
    }

    const passStatus = document.getElementById('backupFtpPassStatus');
    if (ftp._hasPassword) {
      passStatus.textContent = '✓ Passwort gesetzt';
      passStatus.style.color = '#10b981';
      document.getElementById('backupFtpPass').placeholder = '••••••••';
    } else {
      passStatus.textContent = '';
      document.getElementById('backupFtpPass').placeholder = 'Passwort';
    }

    onBackupCardToggle('ftp');
    updateFtpSecureWarning();
    loadBackupStatus();
  }

  // ─── FTP-Karten ein-/ausklappen ──────────────────────────
  function toggleBackupCard(target) {
    if (target === 'ftp') {
      const body = document.getElementById('backupCardFtpBody');
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    }
  }

  function onBackupCardToggle(target) {
    if (target === 'ftp') {
      const enabled = document.getElementById('backupFtpEnabled').checked;
      const card = document.getElementById('backupCardFtp');
      const body = document.getElementById('backupCardFtpBody');
      if (enabled) { card.style.opacity = '1'; body.style.display = 'block'; }
      else { card.style.opacity = '0.5'; body.style.display = 'none'; }
    }
  }

  function updateFtpSecureWarning() {
    const secureMode = document.getElementById('backupFtpSecure').value;
    document.getElementById('backupFtpInsecureWarning').style.display = secureMode === 'none' ? 'block' : 'none';
  }

  // ─── FTP Verbindung testen ──────────────────────────────
  async function testBackupConnection(target) {
    if (target !== 'ftp') return;
    const resultEl = document.getElementById('backupFtpTestResult');
    resultEl.textContent = '● prüft...';
    resultEl.style.color = 'var(--text-secondary)';

    const payload = {
      target: 'ftp',
      host: document.getElementById('backupFtpHost').value.trim(),
      port: parseInt(document.getElementById('backupFtpPort').value) || 21,
      user: document.getElementById('backupFtpUser').value.trim(),
      pass: document.getElementById('backupFtpPass').value.trim(),
      secureMode: document.getElementById('backupFtpSecure').value,
      remotePath: document.getElementById('backupFtpRemotePath').value.trim()
    };

    try {
      const resp = await fetch('/api/backup/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
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

  // ─── Backup jetzt ausführen ─────────────────────────────
  async function runBackupNow() {
    const statusEl = document.getElementById('backupRunStatus');
    const btn = document.getElementById('backupRunBtn');
    btn.disabled = true;
    statusEl.textContent = '● Backup wird erstellt...';
    statusEl.style.color = 'var(--text-secondary)';

    try {
      const resp = await fetch('/api/backup/run', { method: 'POST' });
      const result = await resp.json();

      if (result.results) {
        const parts = [];
        for (const [key, r] of Object.entries(result.results)) {
          const label = r.label || (key === 'ftp' ? 'FTP' : key);
          parts.push(r.status === 'ok' ? `✅ ${label} OK` : `❌ ${label}: ${r.error}`);
        }
        statusEl.innerHTML = parts.join(' · ') || (result.ok ? '✅ Backup erstellt' : '❌ Alle Ziele fehlgeschlagen');

        if (result.partial) {
          statusEl.style.color = '#f59e0b';
          showToast('Backup teilweise erstellt — nicht alle Ziele erreichbar', 'warn');
        } else if (result.ok) {
          statusEl.style.color = '#10b981';
          showToast('Backup erstellt: ' + (result.filename || ''), 'success');
        } else {
          statusEl.style.color = '#ef4444';
          showToast('Backup fehlgeschlagen — kein Ziel erreichbar', 'error');
        }
        loadBackupStatus();
        if (result.ok || result.partial) {
          Keasy.backup.restore.loadBackupList();
        }
      } else {
        statusEl.textContent = '❌ ' + (result.message || 'Fehler');
        statusEl.style.color = '#ef4444';
        showToast('Backup fehlgeschlagen: ' + (result.message || ''), 'error');
      }
    } catch (err) {
      statusEl.textContent = '❌ ' + err.message;
      statusEl.style.color = '#ef4444';
    } finally {
      btn.disabled = false;
    }
  }

  // ─── Status laden ───────────────────────────────────────
  async function loadBackupStatus() {
    try {
      const resp = await fetch('/api/backup/status');
      const status = await resp.json();

      if (status.results) {
        // Lokale Ziele: Status per ID zuordnen
        document.querySelectorAll('#backupLocalCards .backup-card').forEach(card => {
          const id = card.querySelector('[data-field="id"]').value;
          const el = card.querySelector('[data-last-status]');
          const r = status.results[id];
          if (!el || !r) return;
          if (r.status === 'ok') {
            const date = new Date(r.time);
            const ago = formatTimeAgo(date);
            const sizeStr = r.size ? formatSize(r.size) : '';
            el.innerHTML = `Letztes Backup: ✅ ${date.toLocaleString('de-DE')} (${ago})${sizeStr ? ' · ' + sizeStr : ''}`;
            el.style.color = '#10b981';
          } else if (r.status === 'error') {
            el.innerHTML = `Letztes Backup: ❌ ${r.error}`;
            el.style.color = '#ef4444';
          }
        });

        // FTP-Status
        const ftpEl = document.getElementById('backupFtpLastStatus');
        const ftpR = status.results.ftp;
        if (ftpEl && ftpR) {
          if (ftpR.status === 'ok') {
            const date = new Date(ftpR.time);
            const ago = formatTimeAgo(date);
            const sizeStr = ftpR.size ? formatSize(ftpR.size) : '';
            ftpEl.innerHTML = `Letztes Backup: ✅ ${date.toLocaleString('de-DE')} (${ago})${sizeStr ? ' · ' + sizeStr : ''}`;
            ftpEl.style.color = '#10b981';
          } else if (ftpR.status === 'error') {
            ftpEl.innerHTML = `Letztes Backup: ❌ ${ftpR.error}`;
            ftpEl.style.color = '#ef4444';
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Window-Globals für onclick-Handler
  Object.assign(window, {
    loadBackupConfig, toggleBackupCard,
    onBackupCardToggle, updateFtpSecureWarning, testBackupConnection, runBackupNow
  });

  // Namespace registrieren (Fassade)
  Keasy.backup = Object.assign(Keasy.backup || {}, {
    loadBackupConfig, runBackupNow,
    loadBackupStatus
  });
  Object.defineProperty(Keasy.backup, '_loaded', {
    get() { return _backupLoaded; }
  });

})();
