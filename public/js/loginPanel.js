/**
 * Keasy Log Monitor — Login Panel
 * Fullscreen Login-Overlay mit Auth-Check.
 */
(function() {
  window.Keasy = window.Keasy || {};

  const overlay = document.getElementById('loginOverlay');
  const form = document.getElementById('loginForm');
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const errorEl = document.getElementById('loginError');
  const submitBtn = document.getElementById('loginSubmit');

  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.ok && data.user) {
          Keasy.state.currentUser = data.user;
          Keasy.state.authEnabled = data.authEnabled !== false;
          hideLogin();
          return true;
        }
      }
    } catch (e) { /* nicht eingeloggt */ }
    showLogin();
    return false;
  }

  function showLogin() {
    overlay.style.display = 'flex';
    document.body.classList.add('login-active');
    usernameInput.value = '';
    passwordInput.value = '';
    errorEl.textContent = '';
    setTimeout(() => usernameInput.focus(), 50);
  }

  function hideLogin() {
    overlay.style.display = 'none';
    document.body.classList.remove('login-active');
    applyUserRole();
  }

  function applyUserRole() {
    const user = Keasy.state.currentUser;
    if (!user) return;

    // Header: User-Info anzeigen
    const userInfo = document.getElementById('userInfo');
    if (userInfo) {
      userInfo.style.display = 'flex';
      document.getElementById('currentUsername').textContent = user.username;
      const badge = document.getElementById('userRoleBadge');
      badge.textContent = user.role === 'admin' ? 'Admin' : 'User';
      badge.className = 'role-badge role-' + user.role;
    }

    // Admin-Only Elemente: disable/enable + Tooltip
    const isAdmin = user.role === 'admin';
    document.querySelectorAll('[data-admin-only]').forEach(el => {
      // Original-Title beim ersten Durchlauf sichern
      if (!el.dataset.originalTitle && el.title) {
        el.dataset.originalTitle = el.title;
      }

      if (el.tagName === 'BUTTON') {
        el.disabled = !isAdmin;
        el.title = isAdmin ? (el.dataset.originalTitle || '') : '🔒 Nur für Administratoren';
      } else if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') {
        el.disabled = !isAdmin;
        el.title = isAdmin ? (el.dataset.originalTitle || '') : '🔒 Nur für Administratoren';
      } else {
        el.classList.toggle('admin-disabled', !isAdmin);
      }
    });

    // Config Save/Reset Buttons — für alle Benutzer erlaubt
    // (Backend trennt User-Felder von globaler Config)
    // configSaveBtn wird über markConfigDirty() gesteuert

    // Editierbare Felder für Nicht-Admins hervorheben
    document.querySelectorAll('.config-watchpaths-table input[data-field="emailTo"]').forEach(el => {
      el.classList.toggle('user-editable', !isAdmin);
    });
    // Copilot-Pfade ebenfalls hervorheben
    ['cfg-copilotWorkingPathDevelop', 'cfg-copilotWorkingPathRelease'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('user-editable', !isAdmin);
    });

    // Hinweis für Nicht-Admins bei Config-Aktionen
    const configActions = document.querySelector('.config-actions');
    if (configActions) {
      let hint = configActions.querySelector('.admin-hint');
      if (!isAdmin) {
        if (!hint) {
          hint = document.createElement('span');
          hint.className = 'admin-hint';
          hint.style.cssText = 'font-size:0.85em; color:var(--text-muted); margin-left:8px;';
          hint.textContent = 'ℹ️ Globale Einstellungen nur für Administratoren';
          configActions.appendChild(hint);
        }
      } else if (hint) {
        hint.remove();
      }
    }

    // Auth-Off-Modus: Benutzerkonzept komplett ausblenden (wie Einzelbenutzer-App)
    const authOff = Keasy.state.authEnabled === false;
    const userInfoEl = document.getElementById('userInfo');
    if (userInfoEl) userInfoEl.style.display = authOff ? 'none' : 'flex';
    const usersTab = document.getElementById('tab-users');
    if (usersTab) {
      if (authOff) {
        // R2: aktiven Users-Tab vor dem Ausblenden defensiv verlassen
        if (usersTab.classList.contains('active')) {
          document.querySelectorAll('#configPanel .config-tab').forEach(t => t.classList.remove('active'));
          document.querySelectorAll('#configPanel .config-section').forEach(s => s.classList.remove('active'));
          const generalTab = document.querySelector('#configPanel .config-tab[onclick*="\'general\'"]');
          if (generalTab) generalTab.classList.add('active');
          const generalSection = document.getElementById('config-general');
          if (generalSection) generalSection.classList.add('active');
        }
        usersTab.style.display = 'none';
      } else {
        usersTab.style.display = '';
      }
    }
  }

  async function doLogin() {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      errorEl.textContent = 'Bitte Benutzername und Passwort eingeben';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Anmelden...';
    errorEl.textContent = '';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (data.ok) {
        Keasy.state.currentUser = data.user;
        hideLogin();
        if (Keasy.initApp) Keasy.initApp();
        showToast(`Angemeldet als ${data.user.username}`, 'success');
      } else {
        errorEl.textContent = data.message || 'Anmeldung fehlgeschlagen';
        passwordInput.value = '';
        passwordInput.focus();
      }
    } catch (e) {
      errorEl.textContent = 'Verbindungsfehler — Server erreichbar?';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Anmelden';
    }
  }

  async function doLogout() {
    // R3: Im Auth-Off-Modus gibt es keine echte Session — nur neu laden
    if (Keasy.state.authEnabled === false) {
      window.location.reload();
      return;
    }
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) { /* ignore */ }
    Keasy.state.currentUser = null;
    // Hard-Reload: verhindert doppelte Timer/Listener/WebSocket
    window.location.reload();
  }

  // Form Submit
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    doLogin();
  });

  window.Keasy.auth = { checkAuth, doLogout, applyUserRole };
  window.doLogout = doLogout;
})();
