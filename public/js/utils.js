window.Keasy = window.Keasy || {};

window.Keasy.utils = {
  escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  escapeJs(str) {
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  },

  highlightPatterns(text) {
    for (const pattern of Keasy.state.configFilterPatterns) {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`(${escaped})`, 'gi'), '<span class="highlight-pattern">$1</span>');
    }
    return text;
  },

  highlightSearch(text) {
    const { searchTerm, searchRegex } = Keasy.state;
    if (!searchTerm) return text;

    let regex;
    if (searchRegex) {
      const lazySource = searchRegex.source.replace(/\.\*/g, '.*?');
      regex = new RegExp(lazySource, 'gi');
    } else {
      const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(`(${escaped})`, 'gi');
    }

    return text.replace(/(<[^>]+>)|([^<]+)/g, (match, tag, content) => {
      if (tag) return tag;
      return content.replace(regex, '<mark class="highlight-search">$&</mark>');
    });
  },

  getLocalDateStr(d) {
    const date = d || new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  formatSize(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  },

  formatTimeAgo(dateOrString) {
    const time = dateOrString instanceof Date ? dateOrString.getTime() : new Date(dateOrString).getTime();
    const diff = Date.now() - time;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'gerade eben';
    if (minutes < 60) return `vor ${minutes} Min.`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `vor ${hours}h`;
    const days = Math.floor(hours / 24);
    return `vor ${days} Tag${days > 1 ? 'en' : ''}`;
  },

  formatGapDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${String(s).padStart(2, '0')}s`;
  },

  // Dringlichkeit eines Eintrags — einziger Lesezugriff auf entry.level.
  // Einträge aus einer älteren Server-Version (oder aus Papierkorb/Analyse-Läufen
  // von vor dem Update) haben kein level und gelten als 'normal'.
  entryLevel(entry) {
    const level = entry && entry.level;
    return (level === 'kritisch' || level === 'gering') ? level : 'normal';
  },

  // Client-Trim mit Vorrang für kritische Einträge (Server-Gegenstück:
  // selectWithCriticals in watchService.js). Ohne diesen Vorrang verdrängt eine
  // Serie trivialer Fehler genau den Eintrag, der auffallen soll.
  trimKeepCritical(entries, max, extra = 5) {
    if (entries.length <= max) return entries;
    const recent = entries.slice(-max);
    const droppedCriticals = entries
      .slice(0, entries.length - max)
      .filter(e => Keasy.utils.entryLevel(e) === 'kritisch');
    if (droppedCriticals.length === 0) return recent;
    return droppedCriticals.slice(-extra).concat(recent);
  },

  // Einzige Stufe→Darstellung-Map der App (Vorbild: die colors/icons-Maps in showToast).
  // 'normal' liefert bewusst leere cls/icon: der Standardfall erzeugt kein zusätzliches
  // Markup und keine zusätzliche Farbe.
  severityMeta(level) {
    const map = {
      kritisch: { icon: '🔴', label: 'Kritisch', cls: 'sev-kritisch' },
      normal: { icon: '', label: 'Normal', cls: '' },
      gering: { icon: '', label: 'Gering', cls: 'sev-gering' }
    };
    return map[level] || map.normal;
  },

  showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = 'position:fixed; bottom:20px; right:20px; z-index:10000; display:flex; flex-direction:column; gap:8px;';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    const colors = { success: 'var(--status-connected)', error: 'var(--badge-bg)', info: 'var(--accent)', warn: 'var(--accent)' };
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warn: '⚠️' };
    toast.style.cssText = `padding:10px 16px; border-radius:8px; background:var(--bg-secondary); border:2px solid ${colors[type] || colors.info}; color:var(--text-primary); font-size:0.9em; box-shadow:0 4px 12px rgba(0,0,0,0.2); animation:fadeInToast 0.3s; max-width:400px;`;
    toast.textContent = `${icons[type] || ''} ${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 4000);
  }
};

// Window-Globals für Zugriff aus anderen Modulen
Object.assign(window, {
  escapeHtml: Keasy.utils.escapeHtml,
  escapeJs: Keasy.utils.escapeJs,
  highlightPatterns: Keasy.utils.highlightPatterns,
  highlightSearch: Keasy.utils.highlightSearch,
  getLocalDateStr: Keasy.utils.getLocalDateStr,
  formatSize: Keasy.utils.formatSize,
  formatTimeAgo: Keasy.utils.formatTimeAgo,
  formatGapDuration: Keasy.utils.formatGapDuration,
  showToast: Keasy.utils.showToast
});

// Auf Keasy-Namespace für backupPanel etc.
Keasy.showToast = Keasy.utils.showToast;
