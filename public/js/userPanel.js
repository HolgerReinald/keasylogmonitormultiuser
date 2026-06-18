/**
 * Keasy Log Monitor — User Panel
 * Benutzerverwaltung (Admin) + Passwort-Änderung (alle).
 */
(function() {
  window.Keasy = window.Keasy || {};

  let _users = [];
  let _allWatchLabels = [];

  async function loadUsers() {
    try {
      // Load watchPath labels for the checkbox list (admin gets all)
      const cfgRes = await fetch('/api/config');
      const cfgData = await cfgRes.json();
      _allWatchLabels = (cfgData.watchPaths || [])
        .map(wp => typeof wp === 'string' ? wp : wp.label)
        .filter(Boolean);

      const res = await fetch('/api/users');
      const data = await res.json();
      if (data.ok) {
        _users = data.users;
        renderUserList();
      }
    } catch (e) {
      showToast('Fehler beim Laden der Benutzer', 'error');
    }
  }

  function renderUserList() {
    const container = document.getElementById('userList');
    const isAdmin = Keasy.state.currentUser && Keasy.state.currentUser.role === 'admin';

    if (!_users.length) {
      container.innerHTML = '<div class="empty-state">Keine Benutzer vorhanden</div>';
      return;
    }

    // WatchPath-Labels aus geladener Liste
    const allLabels = _allWatchLabels;

    container.innerHTML = _users.map(u => {
      const visibleLabels = u.visibleLabels; // null = alle, [] = keine, [...] = Auswahl
      const allVisible = visibleLabels === null || visibleLabels === undefined;
      const visibleCount = allVisible ? allLabels.length : visibleLabels.length;
      const pathInfo = u.role === 'admin'
        ? '<span class="path-info">alle (Admin)</span>'
        : `<span class="path-info">${visibleCount} von ${allLabels.length} Pfaden</span>`;

      let pathCheckboxes = '';
      if (isAdmin && u.role !== 'admin') {
        pathCheckboxes = `
          <div class="user-paths" id="paths-${escapeHtml(u.username)}" style="display:none">
            <div class="path-toolbar">
              <button class="btn-small" onclick="userPanel_selectAllPaths('${escapeJs(u.username)}', true)">Alle</button>
              <button class="btn-small" onclick="userPanel_selectAllPaths('${escapeJs(u.username)}', false)">Keine</button>
              <span class="path-counter" id="pathCounter-${escapeHtml(u.username)}">${visibleCount}/${allLabels.length}</span>
            </div>
            ${allLabels.map(label => `
              <label class="path-checkbox">
                <input type="checkbox" data-username="${escapeHtml(u.username)}" data-label="${escapeHtml(label)}"
                  ${allVisible || (visibleLabels && visibleLabels.includes(label)) ? 'checked' : ''}
                  onchange="userPanel_updatePathCounter('${escapeJs(u.username)}')">
                ${escapeHtml(label)}
              </label>
            `).join('')}
            <button class="btn-small btn-primary" onclick="userPanel_savePaths('${escapeJs(u.username)}')" style="margin-top:6px">💾 Pfade speichern</button>
          </div>`;
      }

      return `
        <div class="user-row-wrapper">
          <div class="user-row">
            <span class="user-row-name">${escapeHtml(u.username)}</span>
            <span class="role-badge role-${u.role}">${u.role === 'admin' ? 'Admin' : 'User'}</span>
            ${pathInfo}
            <span class="user-row-date" title="Erstellt: ${u.createdAt}">${formatTimeAgo(new Date(u.createdAt))}</span>
            ${isAdmin ? `
              <div class="user-row-actions">
                ${u.role !== 'admin' ? `<button class="btn-small" onclick="userPanel_togglePaths('${escapeJs(u.username)}')" title="Sichtbare Pfade bearbeiten">📂</button>` : ''}
                <button class="btn-small" onclick="userPanel_editRole('${escapeJs(u.username)}', '${u.role}')" title="Rolle ändern">🔄</button>
                <button class="btn-small" onclick="userPanel_resetPassword('${escapeJs(u.username)}')" title="Passwort zurücksetzen">🔑</button>
                <button class="btn-small btn-danger" onclick="userPanel_deleteUser('${escapeJs(u.username)}')" title="Benutzer löschen">🗑️</button>
              </div>
            ` : ''}
          </div>
          ${pathCheckboxes}
        </div>`;
    }).join('');
  }

  async function createUser() {
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newUserRole').value;

    if (!username || !password) {
      showToast('Benutzername und Passwort eingeben', 'warn');
      return;
    }

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`Benutzer "${username}" erstellt`, 'success');
        document.getElementById('newUsername').value = '';
        document.getElementById('newPassword').value = '';
        await loadUsers();
      } else {
        showToast(data.message, 'error');
      }
    } catch (e) {
      showToast('Fehler beim Erstellen', 'error');
    }
  }

  async function editRole(username, currentRole) {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    const ok = await showConfirm(`Rolle von "${username}" ändern zu ${newRole}?`);
    if (!ok) return;

    try {
      const res = await fetch('/api/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, role: newRole })
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`Rolle geändert: ${username} → ${newRole}`, 'success');
        await loadUsers();
      } else {
        showToast(data.message, 'error');
      }
    } catch (e) {
      showToast('Fehler beim Ändern', 'error');
    }
  }

  async function resetPassword(username) {
    const ok = await showConfirm(`Passwort von "${username}" zurücksetzen auf "keasy123"?`);
    if (!ok) return;

    try {
      const res = await fetch('/api/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: 'keasy123' })
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`Passwort zurückgesetzt für "${username}"`, 'success');
      } else {
        showToast(data.message, 'error');
      }
    } catch (e) {
      showToast('Fehler beim Zurücksetzen', 'error');
    }
  }

  async function deleteUser(username) {
    const ok = await showConfirm(`Benutzer "${username}" wirklich löschen?`);
    if (!ok) return;

    try {
      const res = await fetch('/api/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`Benutzer "${username}" gelöscht`, 'success');
        await loadUsers();
      } else {
        showToast(data.message, 'error');
      }
    } catch (e) {
      showToast('Fehler beim Löschen', 'error');
    }
  }

  async function changeOwnPassword() {
    const oldPw = document.getElementById('ownOldPassword').value;
    const newPw = document.getElementById('ownNewPassword').value;
    const confirmPw = document.getElementById('ownConfirmPassword').value;

    if (!oldPw || !newPw) {
      showToast('Alle Felder ausfüllen', 'warn');
      return;
    }
    if (newPw !== confirmPw) {
      showToast('Neue Passwörter stimmen nicht überein', 'warn');
      return;
    }
    if (newPw.length < 3) {
      showToast('Neues Passwort muss mindestens 3 Zeichen lang sein', 'warn');
      return;
    }

    try {
      const res = await fetch('/api/users/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw })
      });
      const data = await res.json();
      if (data.ok) {
        showToast('Passwort geändert', 'success');
        document.getElementById('ownOldPassword').value = '';
        document.getElementById('ownNewPassword').value = '';
        document.getElementById('ownConfirmPassword').value = '';
      } else {
        showToast(data.message, 'error');
      }
    } catch (e) {
      showToast('Fehler beim Ändern', 'error');
    }
  }

  function togglePaths(username) {
    const el = document.getElementById('paths-' + username);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }

  function selectAllPaths(username, checked) {
    const boxes = document.querySelectorAll(`input[data-username="${username}"]`);
    boxes.forEach(cb => cb.checked = checked);
    updatePathCounter(username);
  }

  function updatePathCounter(username) {
    const boxes = document.querySelectorAll(`input[data-username="${username}"]`);
    const checked = [...boxes].filter(cb => cb.checked).length;
    const counter = document.getElementById('pathCounter-' + username);
    if (counter) counter.textContent = `${checked}/${boxes.length}`;
  }

  async function savePaths(username) {
    const boxes = document.querySelectorAll(`input[data-username="${username}"]`);
    const allChecked = [...boxes].every(cb => cb.checked);
    const visibleLabels = allChecked ? null : [...boxes].filter(cb => cb.checked).map(cb => cb.dataset.label);

    try {
      const res = await fetch('/api/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, visibleLabels })
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`Pfade für "${username}" gespeichert`, 'success');
        await loadUsers();
      } else {
        showToast(data.message, 'error');
      }
    } catch (e) {
      showToast('Fehler beim Speichern', 'error');
    }
  }

  // Globals für onclick
  window.userPanel_createUser = createUser;
  window.userPanel_editRole = editRole;
  window.userPanel_resetPassword = resetPassword;
  window.userPanel_deleteUser = deleteUser;
  window.userPanel_changeOwnPassword = changeOwnPassword;
  window.userPanel_togglePaths = togglePaths;
  window.userPanel_selectAllPaths = selectAllPaths;
  window.userPanel_updatePathCounter = updatePathCounter;
  window.userPanel_savePaths = savePaths;

  window.Keasy.userPanel = { loadUsers };
})();
