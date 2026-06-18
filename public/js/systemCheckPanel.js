(function() {
window.Keasy = window.Keasy || {};

let checkRunning = false;
let cooldownTimer = null;

const STATUS_ICONS = { ok: '✅', fail: '❌', warn: '⚠️', skip: '⏭️' };
const STATUS_COLORS = {
  ok: 'var(--status-connected)',
  fail: 'var(--badge-bg)',
  warn: 'var(--accent)',
  skip: 'var(--text-muted)'
};

function runSystemCheck() {
  if (checkRunning) return;
  checkRunning = true;

  const btn = document.getElementById('systemCheckRunBtn');
  const summary = document.getElementById('systemCheckSummary');
  const resultsBox = document.getElementById('systemCheckResults');
  const content = document.getElementById('systemCheckContent');
  const footer = document.getElementById('systemCheckFooter');

  btn.disabled = true;
  btn.textContent = '⏳ Check läuft...';
  summary.textContent = '';
  content.innerHTML = '';
  footer.textContent = '';
  resultsBox.style.display = 'block';

  fetch('/api/system-check/run', { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      if (!data.ok) {
        checkRunning = false;
        btn.disabled = false;
        btn.textContent = '🧪 Check starten';
        summary.textContent = data.message || 'Fehler';
        summary.style.color = 'var(--badge-bg)';
        if (data.cooldown) startCooldown(data.cooldown);
      }
    })
    .catch(err => {
      checkRunning = false;
      btn.disabled = false;
      btn.textContent = '🧪 Check starten';
      summary.textContent = 'Fehler: ' + err.message;
      summary.style.color = 'var(--badge-bg)';
    });
}

function onCheckProgress(check) {
  const content = document.getElementById('systemCheckContent');
  if (!content) return;

  // Kategorie-Gruppe finden oder erstellen
  let group = content.querySelector(`[data-category="${CSS.escape(check.category)}"]`);
  if (!group) {
    group = document.createElement('div');
    group.setAttribute('data-category', check.category);
    group.style.marginBottom = '12px';

    const heading = document.createElement('div');
    heading.style.cssText = 'font-weight:bold; margin-bottom:4px; color:var(--text-primary);';
    heading.textContent = check.category;
    group.appendChild(heading);

    content.appendChild(group);
  }

  const line = document.createElement('div');
  line.style.cssText = 'display:flex; align-items:baseline; gap:8px; padding:2px 0 2px 20px;';

  const icon = STATUS_ICONS[check.status] || '❓';
  const color = STATUS_COLORS[check.status] || 'var(--text-primary)';

  line.innerHTML = `<span>${icon}</span><span style="flex:1; color:${color};">${escapeForHtml(check.name)}</span>` +
    `<span style="color:var(--text-muted); font-size:0.85em; min-width:50px; text-align:right;">${check.duration != null ? check.duration + 'ms' : '—'}</span>`;
  group.appendChild(line);

  // Fehlermeldung eingerückt
  if (check.message && (check.status === 'fail' || check.status === 'warn')) {
    const msg = document.createElement('div');
    msg.style.cssText = `padding:1px 0 4px 48px; font-size:0.85em; color:${color};`;
    msg.textContent = '→ ' + check.message;
    group.appendChild(msg);
  }
  if (check.message && check.status === 'skip') {
    const msg = document.createElement('div');
    msg.style.cssText = 'padding:1px 0 4px 48px; font-size:0.85em; color:var(--text-muted);';
    msg.textContent = '→ ' + check.message;
    group.appendChild(msg);
  }
}

function onCheckDone(result) {
  checkRunning = false;
  const btn = document.getElementById('systemCheckRunBtn');
  const summary = document.getElementById('systemCheckSummary');
  const footer = document.getElementById('systemCheckFooter');

  btn.textContent = '🧪 Check starten';

  // Zusammenfassung
  const parts = [];
  parts.push(`${result.passed}/${result.total} bestanden`);
  if (result.warned > 0) parts.push(`${result.warned} Warnung${result.warned > 1 ? 'en' : ''}`);
  if (result.failed > 0) parts.push(`${result.failed} Fehler`);
  const duration = (result.duration / 1000).toFixed(1) + 's';
  parts.push(duration);

  const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  summary.textContent = `Letzter Check: ${time} · ${parts[0]} ${result.failed === 0 ? '✅' : '❌'}`;
  summary.style.color = result.failed === 0 ? 'var(--status-connected)' : 'var(--badge-bg)';

  footer.textContent = parts.join(' · ');

  // Cooldown starten
  startCooldown(10);
}

function startCooldown(seconds) {
  const btn = document.getElementById('systemCheckRunBtn');
  btn.disabled = true;
  let remaining = seconds;

  if (cooldownTimer) clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      btn.disabled = false;
      btn.textContent = '🧪 Check starten';
    } else {
      btn.textContent = `🧪 Check starten (${remaining}s)`;
    }
  }, 1000);
  btn.textContent = `🧪 Check starten (${remaining}s)`;
}

function escapeForHtml(str) {
  const d = document.createElement('span');
  d.textContent = str;
  return d.innerHTML;
}

// Letztes Ergebnis bei Init/Reconnect wiederherstellen
function restoreLastResult(lastResult) {
  if (!lastResult) return;
  const resultsBox = document.getElementById('systemCheckResults');
  const content = document.getElementById('systemCheckContent');
  const footer = document.getElementById('systemCheckFooter');
  const summary = document.getElementById('systemCheckSummary');
  if (!resultsBox || !content) return;

  content.innerHTML = '';
  for (const check of lastResult.checks) {
    onCheckProgress(check);
  }

  const parts = [];
  parts.push(`${lastResult.passed}/${lastResult.total} bestanden`);
  if (lastResult.warned > 0) parts.push(`${lastResult.warned} Warnung${lastResult.warned > 1 ? 'en' : ''}`);
  if (lastResult.failed > 0) parts.push(`${lastResult.failed} Fehler`);
  parts.push((lastResult.duration / 1000).toFixed(1) + 's');

  footer.textContent = parts.join(' · ');
  summary.textContent = `Letzter Check: ${lastResult.passed}/${lastResult.total} ${lastResult.failed === 0 ? '✅' : '❌'}`;
  summary.style.color = lastResult.failed === 0 ? 'var(--status-connected)' : 'var(--badge-bg)';
  resultsBox.style.display = 'block';
}

// Global verfügbar machen
window.runSystemCheck = runSystemCheck;
window.Keasy.systemCheck = { onCheckProgress, onCheckDone, restoreLastResult };

})();
