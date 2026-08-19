(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;

// === Date Filter ===

function initDateFilters() {
  const today = getLocalDateStr();
  state.currentDateStr = today;
  document.getElementById('dateFrom').value = today;
  document.getElementById('dateTo').value = today;
}

function scheduleMidnightUpdate() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  const ms = midnight - now;
  setTimeout(() => {
    const newDay = getLocalDateStr();
    const fromEl = document.getElementById('dateFrom');
    const toEl = document.getElementById('dateTo');
    if (fromEl.value === state.currentDateStr) fromEl.value = newDay;
    if (toEl.value === state.currentDateStr) toEl.value = newDay;
    state.currentDateStr = newDay;
    renderAll();
    scheduleMidnightUpdate();
  }, ms);
}

function onDateFilterChange() {
  const dateFrom = document.getElementById('dateFrom');
  const dateTo = document.getElementById('dateTo');
  if (dateFrom.value && dateTo.value && dateTo.value < dateFrom.value) {
    dateTo.value = dateFrom.value;
  }
  state.timeFilterHours = 0;
  updateTimeFilterButtons();
  updateClearButtonText();
  renderAll();
}

function setTimeFilter(hours) {
  state.timeFilterHours = hours;
  if (hours > 0) {
    const today = getLocalDateStr();
    document.getElementById('dateFrom').value = today;
    document.getElementById('dateTo').value = today;
  }
  updateTimeFilterButtons();
  updateClearButtonText();
  renderAll();
}

function updateTimeFilterButtons() {
  const today = getLocalDateStr();
  const dateFrom = document.getElementById('dateFrom').value;
  const dateTo = document.getElementById('dateTo').value;
  const isToday = dateFrom === today && dateTo === today;
  document.querySelectorAll('.time-filter-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  if (state.timeFilterHours === 0 && isToday) {
    document.querySelectorAll('.time-filter-btn').forEach(btn => {
      if (btn.textContent === 'Heute') btn.classList.add('active');
    });
  } else if (state.timeFilterHours > 0) {
    const labels = { 1: '1h', 2: '2h', 4: '4h', 6: '6h', 12: '12h' };
    const label = labels[state.timeFilterHours];
    document.querySelectorAll('.time-filter-btn').forEach(btn => {
      if (btn.textContent === label) btn.classList.add('active');
    });
  }
}

function updateClearButtonText() {
  const btn = document.getElementById('clearAllBtn');
  if (!btn) return;
  const today = getLocalDateStr();
  const dateFrom = document.getElementById('dateFrom').value;
  const dateTo = document.getElementById('dateTo').value;
  const isDateFiltered = (dateFrom && dateFrom !== today) || (dateTo && dateTo !== today);
  const isFiltered = isDateFiltered || state.timeFilterHours > 0;
  btn.textContent = isFiltered ? '🗑️ Sichtbare löschen' : '🗑️ Alle löschen';
  btn.title = isFiltered ? 'Nur die aktuell sichtbaren Live-Einträge löschen (nur Live-Monitoring)' : 'Alle Live-Einträge löschen (nur Live-Monitoring)';
}

// === Notifications ===

function updateNotifButton() {
  const btn = document.getElementById('notifToggle');
  if (!state.notificationsEnabled) {
    btn.textContent = '🔕';
    btn.title = 'Desktop-Benachrichtigungen ein';
    btn.style.opacity = '0.5';
    return;
  }
  // Aktiviert — aber ohne Browser-Berechtigung kommt trotzdem nichts an: Warnzustand zeigen
  if (!('Notification' in window) || Notification.permission === 'denied') {
    btn.textContent = '🔔⚠️';
    btn.title = 'Desktop-Benachrichtigungen aktiviert, aber vom Browser blockiert — Berechtigung über das Schloss-Symbol in der Adressleiste erlauben';
    btn.style.opacity = '1';
    return;
  }
  if (Notification.permission === 'default') {
    btn.textContent = '🔔❓';
    btn.title = 'Desktop-Benachrichtigungen aktiviert — Browser-Berechtigung noch nicht erteilt (aus- und wieder einschalten fragt erneut an)';
    btn.style.opacity = '1';
    return;
  }
  btn.textContent = '🔔';
  btn.title = 'Desktop-Benachrichtigungen aus';
  btn.style.opacity = '1';
}

function toggleNotifications() {
  state.notificationsEnabled = !state.notificationsEnabled;
  localStorage.setItem('keasy-notifications', state.notificationsEnabled ? 'on' : 'off');
  // Beim Aktivieren eine fehlende Browser-Berechtigung direkt anfragen
  if (state.notificationsEnabled && 'Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(updateNotifButton);
  }
  updateNotifButton();
}

// Text der Desktop-Benachrichtigung.
// Reihenfolge ist entscheidend: Windows kürzt hinten ab. Deshalb steht die
// Fehlermeldung zuerst und der Dateiname darunter — der darf wegfallen, die
// Meldung nicht. (Vorher stand der Dateiname vorn und verdrängte mit ~55
// Zeichen den kompletten Fehlertext.)
// Die Kurzfassung selbst liefert Keasy.utils.entrySummary() — dieselbe Funktion,
// die auch der Fehler-Index nutzt. Sie schneidet den führenden Zeitstempel ab,
// überspringt Trennlinien und zieht Ankündigungszeilen mit der Folgezeile
// zusammen; Keasy-Einträge beginnen sonst mit "Zeitstempel + Tab" und mehreren
// Leerzeilen, und die Benachrichtigung sagte nichts aus.
function buildNotificationBody(error) {
  const message = Keasy.utils.entrySummary(error.line || '', 180);
  const file = error.file ? `\n${error.file}` : '';
  return message + file;
}

// Quellenname bevorzugen — im Dashboard denkt man in "VFMService Dienst",
// nicht in Dateinamen.
function notificationTitle(level, label) {
  if (level === 'kritisch') {
    return label ? `🔴 Kritisch — ${label}` : '🔴 Keasy Log Monitor — kritischer Fehler';
  }
  return label ? `Keasy — ${label}` : 'Keasy Log Monitor';
}

function showNotification(title, error, opts) {
  const n = new Notification(title, Object.assign({ body: buildNotificationBody(error) }, opts));
  // Klick holt das Dashboard nach vorn — der häufigste nächste Schritt
  n.onclick = () => { window.focus(); n.close(); };
  return n;
}

function notifyNewError(error, label) {
  // Titel über die gemeinsame Funktion, damit die 🔴-Anzeige nicht zweimal implementiert ist
  Keasy.render.updateBrowserTitle();
  if (!state.notificationsEnabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const level = Keasy.utils.entryLevel(error);
  // Geduldete Einträge ("gering") benachrichtigen nie
  if (level === 'gering') return;

  const now = Date.now();

  if (level === 'kritisch') {
    // Kritische Fehler auch melden, wenn das Dashboard sichtbar und fokussiert ist —
    // der Blick kann trotzdem auf einem anderen Teil der Seite liegen.
    // Eigener Zeitstempel: mit einem gemeinsamen würde eine Flut normaler Fehler
    // die kritische Benachrichtigung aushungern. Eigener tag, damit eine normale
    // Meldung die kritische im Info-Center nicht still ersetzt.
    if (now - state.lastCriticalNotificationTime <= 3000) return;
    state.lastCriticalNotificationTime = now;
    showNotification(notificationTitle('kritisch', label), error, {
      tag: 'keasy-critical',
      renotify: true,
      requireInteraction: true
    });
    return;
  }

  // Benachrichtigen, wenn das Dashboard nicht im Blick ist: Tab verdeckt ODER Fenster
  // nicht fokussiert (z. B. Keasy im Vordergrund, Dashboard auf dem zweiten Monitor)
  const dashboardNotInView = document.hidden || !document.hasFocus();
  if (dashboardNotInView && now - state.lastNotificationTime > 10000) {
    state.lastNotificationTime = now;
    showNotification(notificationTitle('normal', label), error, {
      tag: 'keasy-error',
      renotify: true // neue Meldung poppt wieder auf, statt die alte im Info-Center stumm zu ersetzen
    });
  }
}

// === Theme ===

function onThemeChange(theme) {
  document.body.className = theme;
  localStorage.setItem('keasy-log-theme', theme);
  document.getElementById('themeSelect').value = theme;
}

function initTheme() {
  const saved = localStorage.getItem('keasy-log-theme') || 'theme-light';
  onThemeChange(saved);
}

// === Init ===

// Auth-Check: Erst prüfen, dann App initialisieren
Keasy.auth.checkAuth().then(loggedIn => {
  if (!loggedIn) return; // Login-Overlay wird gezeigt, App startet nach Login
  initApp();
});

function initApp() {
  // Notification Permission
  if ('Notification' in window && Notification.permission === 'default' && state.notificationsEnabled) {
    Notification.requestPermission().then(updateNotifButton);
  }
  updateNotifButton();

  // Theme
  initTheme();

  // Fehler-Index: gemerkte Seite und Sichtbarkeit sofort anwenden, sonst steht
  // die Leiste bis zum ersten renderAll() auf der Vorgabeseite
  if (Keasy.errorIndex) Keasy.errorIndex.applyIndexLayout();

  // Hinweistexte: gemerkten Auf-/Zu-Zustand anwenden. Eingeklappt braucht kein
  // Zutun (das macht CSS), aber die aufgeklappten und die Pfeile schon.
  if (Keasy.config) Keasy.config.applyAllHints();

  // Date Filter
  initDateFilters();
  scheduleMidnightUpdate();

  // Analyse-Pfade rendern
  renderAnalyzePaths();

  // WebSocket verbinden
  connect();

  // Countdown-Timer: aktualisiert jede Sekunde die Anzeige
  setInterval(() => {
    const els = document.querySelectorAll('.email-countdown');
    if (!els.length || !state.nextEmailSendTime) return;
    const remaining = Math.max(0, Math.round((state.nextEmailSendTime - Date.now()) / 1000));
    const min = Math.floor(remaining / 60);
    const sec = remaining % 60;
    const text = `${min}:${sec.toString().padStart(2, '0')}`;
    els.forEach(el => { el.textContent = text; });
  }, 1000);

  // Papierkorb relative Zeitanzeige minütlich aktualisieren
  setInterval(() => {
    if (state.trashTotalCount > 0 && !state.trashCollapsed) renderTrash();
  }, 60000);

  // Change-Detection auf allen Config-Feldern (INPUT + SELECT)
  document.getElementById('configPanel').addEventListener('input', (e) => {
    if (e.target.closest('.config-section') && e.target.tagName === 'INPUT') markConfigDirty();
  });
  document.getElementById('configPanel').addEventListener('change', (e) => {
    if (e.target.closest('.config-section') && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) markConfigDirty();
  });

  // Folder Picker Buttons (Event-Delegation)
  document.getElementById('configPanel').addEventListener('click', async (e) => {
    const btn = e.target.closest('.folder-picker-btn');
    if (!btn) return;
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);
    if (!input) return;
    const chosen = await showFolderPicker(input.value || '');
    if (chosen) { input.value = chosen; markConfigDirty(); }
  });

  // Keyboard shortcuts: Ctrl+K → Suchfeld, Escape → verlassen + leeren
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      const input = document.getElementById('searchInput');
      input.focus();
      input.select();
    }
    if (e.key === 'Escape' && document.activeElement === document.getElementById('searchInput')) {
      const input = document.getElementById('searchInput');
      input.value = '';
      onSearch('');
      input.blur();
    }
  });
} // end initApp

// Login-Callback: nach erfolgreichem Login App starten
window.Keasy.initApp = initApp;

window.Keasy.boot = {
  initDateFilters, scheduleMidnightUpdate, onDateFilterChange, setTimeFilter,
  updateTimeFilterButtons, updateClearButtonText,
  updateNotifButton, toggleNotifications, notifyNewError,
  onThemeChange, initTheme
};

Object.assign(window, {
  onDateFilterChange, setTimeFilter, onThemeChange, toggleNotifications,
  initTheme, notifyNewError, updateNotifButton, updateClearButtonText,
  updateTimeFilterButtons, initDateFilters
});
})();
