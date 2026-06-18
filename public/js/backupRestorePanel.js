/**
 * Keasy Log Monitor — Backup Restore Panel
 * Restore-Liste, Delete, Preview, Restore-Flow
 */
(function() {
  const { showToast } = Keasy;
  const { formatSize } = Keasy.utils;

  // ─── Backup-Liste laden ─────────────────────────────────
  async function loadBackupList() {
    const tbody = document.getElementById('backupRestoreList');
    const warningsDiv = document.getElementById('backupTargetWarnings');
    tbody.innerHTML = '<tr><td colspan="7" style="padding:12px; color:var(--text-secondary); text-align:center;">Lade Backups...</td></tr>';
    if (warningsDiv) { warningsDiv.style.display = 'none'; warningsDiv.innerHTML = ''; }

    try {
      const resp = await fetch('/api/backup/list');
      if (!resp.ok) {
        tbody.innerHTML = `<tr><td colspan="7" style="padding:12px; color:#ef4444; text-align:center;">Server-Fehler: ${resp.status}</td></tr>`;
        return;
      }
      const data = await resp.json();
      const list = data.backups || (Array.isArray(data) ? data : []);
      const targets = data.targets || [];

      // Ziel-Erreichbarkeit anzeigen
      const unreachable = targets.filter(t => !t.reachable);
      if (warningsDiv && unreachable.length > 0) {
        warningsDiv.style.display = 'block';
        warningsDiv.innerHTML = unreachable.map(t =>
          `<div style="padding:8px 12px; margin-bottom:4px; background:var(--bg-tertiary); border:1px solid #f59e0b; border-radius:6px; color:var(--text-primary); font-size:0.9em;">
            ⚠️ <strong>${t.label}</strong> (${t.source === 'ftp' ? 'FTP' : 'Lokal'}): ${t.error || 'Nicht erreichbar'}
          </div>`
        ).join('');
      }

      if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="padding:12px; color:var(--text-secondary); text-align:center;">Keine Backups vorhanden</td></tr>';
        return;
      }

      tbody.innerHTML = '';
      for (const b of list) {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-color)';
        tr.style.cursor = 'pointer';
        tr.onclick = () => selectBackup(b, tr);

        const date = b.date ? new Date(b.date).toLocaleString('de-DE') : '—';
        const sourceIcon = b.source === 'ftp' ? '🌐' : '📁';
        const sourceLabel = b.sourceLabel || (b.source === 'ftp' ? 'FTP' : 'Lokal');
        const size = formatSize(b.size);
        const content = b.content ? b.content.files : '—';
        const version = b.content ? (b.content.version || '—') : '—';
        const val = `${b.source}|${b.filename}|${b.sourceId || ''}`;
        const escSrc = (b.source || '').replace(/'/g, "\\'");
        const escId = (b.sourceId || '').replace(/'/g, "\\'");
        const escFn = (b.filename || '').replace(/'/g, "\\'");
        const escDate = date.replace(/'/g, "\\'");

        tr.innerHTML = `
          <td style="padding:6px;"><input type="radio" name="backupSelect" value="${val}"></td>
          <td style="padding:6px;">${date}</td>
          <td style="padding:6px;">${sourceIcon} ${sourceLabel}</td>
          <td style="padding:6px;">${size}</td>
          <td style="padding:6px;">${content}</td>
          <td style="padding:6px;">${version}</td>
          <td style="padding:6px;"><button class="action-btn" title="Backup löschen" onclick="event.stopPropagation(); deleteBackupFile('${escSrc}', '${escId}', '${escFn}', '${escDate}')">🗑️</button></td>
        `;
        tbody.appendChild(tr);
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding:12px; color:#ef4444; text-align:center;">Fehler: ${err.message}</td></tr>`;
    }
  }

  // ─── Backup löschen ───────────────────────────────────────
  async function deleteBackupFile(source, sourceId, filename, dateStr) {
    try {
      const resp = await fetch('/api/backup/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, sourceId, filename })
      });
      if (!resp.ok && !resp.headers.get('content-type')?.includes('json')) {
        showToast(`Fehler: Server antwortete mit ${resp.status}`, 'error');
      } else {
        const result = await resp.json();
        if (result.ok) {
          showToast('Backup gelöscht', 'success');
        } else {
          showToast(result.error || 'Fehler beim Löschen', resp.status === 404 ? 'warn' : 'error');
        }
      }
    } catch (err) {
      showToast('Fehler: ' + err.message, 'error');
    }
    document.getElementById('backupRestoreBtn').disabled = true;
    loadBackupList();
  }

  function selectBackup(backup, tr) {
    const radio = tr.querySelector('input[type=radio]');
    radio.checked = true;
    document.getElementById('backupRestoreBtn').disabled = false;
    document.querySelectorAll('#backupRestoreList tr').forEach(r => r.style.background = '');
    tr.style.background = 'var(--bg-secondary)';
  }

  // ─── Restore ────────────────────────────────────────────
  async function restoreSelectedBackup() {
    const selected = document.querySelector('input[name=backupSelect]:checked');
    if (!selected) return;

    const parts = selected.value.split('|');
    const source = parts[0];
    const filename = parts[1];
    const sourceId = parts[2] || undefined;

    try {
      const resp = await fetch('/api/backup/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, filename, sourceId })
      });
      const preview = await resp.json();

      if (!preview.overwrites) {
        showToast('Fehler: ' + (preview.message || 'Ungültiges Backup'), 'error');
        return;
      }

      const date = preview.manifest ? new Date(preview.manifest.created).toLocaleString('de-DE') : filename;
      const version = preview.manifest ? preview.manifest.version : '?';
      const fileList = preview.overwrites.map(f => '  • ' + f).join('\n');

      const confirmed = confirm(
        `⚠️ Backup wiederherstellen\n\n` +
        `Backup vom: ${date}\n` +
        `Version: ${version}\n\n` +
        `Folgende Dateien werden überschrieben:\n${fileList}\n\n` +
        `Ein Sicherheits-Backup wird vorher automatisch erstellt.\n` +
        `Der Server wird danach neu gestartet.\n\n` +
        `Fortfahren?`
      );

      if (!confirmed) return;

      showToast('Restore wird durchgeführt...', 'info');

      const restoreResp = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, filename, sourceId })
      });
      const result = await restoreResp.json();

      if (result.ok) {
        showToast('✅ Restore erfolgreich — Server startet neu...', 'success');
      } else {
        showToast('❌ Restore fehlgeschlagen: ' + (result.message || ''), 'error');
      }
    } catch (err) {
      showToast('❌ Fehler: ' + err.message, 'error');
    }
  }

  // Window-Globals für onclick-Handler
  Object.assign(window, { loadBackupList, deleteBackupFile, restoreSelectedBackup });

  // Namespace registrieren
  Keasy.backup = Keasy.backup || {};
  Keasy.backup.restore = { loadBackupList, deleteBackupFile, restoreSelectedBackup };

})();
