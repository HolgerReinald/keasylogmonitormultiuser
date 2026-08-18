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

  // Obergrenze pro Datei, mit Vorrang für kritische Einträge — spiegelt
  // evictOldest in server/watchService.js: es weicht immer der älteste
  // NICHT-kritische Eintrag, und nur wenn alle kritisch sind der älteste
  // überhaupt. Mutiert das Array, damit die Objekt-Identität erhalten bleibt
  // (render.js bildet origIdx über indexOf).
  // Vorher kürzte der Client nach einer anderen Regel als der Server und behielt
  // höchstens 5 ältere kritische Einträge. Dadurch sank die angezeigte Anzahl
  // kritischer Fehler, je länger die Seite offen war — der Server hielt sie noch,
  // das Dashboard zeigte sie nicht mehr.
  capKeepCritical(entries, max) {
    while (entries.length > max) {
      const i = entries.findIndex(e => Keasy.utils.entryLevel(e) !== 'kritisch');
      entries.splice(i === -1 ? 0 : i, 1);
    }
    return entries;
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

  // Zeitstempel am Zeilenanfang entfernen ("18.08.26 13:27:11.204<TAB>…")
  stripLeadingTimestamp(line) {
    return line
      .replace(/^\s*\d{1,2}\.\d{1,2}\.\d{2,4},?\s+\d{1,2}:\d{2}:\d{2}(\.\d{3})?\s*/, '')
      .replace(/^[\s\t]+/, '');
  },

  // Aussagekräftige Kurzfassung eines mehrzeiligen Eintrags.
  // Gemeinsame Grundlage von Desktop-Benachrichtigung (boot.js) und Fehler-Index
  // (errorIndexPanel.js) — zwei getrennte Implementierungen würden auseinanderlaufen,
  // und dann stünde in der Benachrichtigung etwas anderes als in der Liste.
  // Keasy-Einträge bestehen typischerweise aus "Zeitstempel + Tab", mehreren
  // Leerzeilen und erst danach der Meldung; manche beginnen mit einer ====-Trennlinie.
  entrySummary(text, maxLen) {
    const clean = l => Keasy.utils.stripLeadingTimestamp(l).replace(/\s+/g, ' ').trim();
    const raw = String(text || '');
    const meaningful = raw
      .split('\n')
      .map(clean)
      .filter(l => l && !/^[=\-_*#~+.]+$/.test(l)); // reine Trennlinien überspringen

    // Keasy-Fehlerblöcke tragen die Aussage in den Feldern "Type:" und "Message:".
    // Die Zeile darüber — "Der folgende #Fehler ist aufgetreten:" — steht über
    // nahezu jedem Eintrag und sagt für sich nichts. Sie kostete 37 Zeichen,
    // sodass dahinter nur noch der Exception-Typ Platz hatte und die eigentliche
    // Meldung wegfiel. An 77 echten Einträgen geprüft: 27 werden dadurch
    // aussagekräftig, 50 ohne solchen Block laufen unverändert weiter.
    const field = name => {
      const hit = meaningful.find(l => l.toLowerCase().startsWith(name + ':'));
      return hit ? hit.substring(name.length + 1).trim() : '';
    };
    const type = field('type');
    const msg = field('message');
    const hasFields = !!(type || msg);

    let message = hasFields
      ? [type, msg].filter(Boolean).join(' — ')
      : (meaningful[0] || clean(raw));

    // Rückfall für Einträge ohne Type/Message-Block: eine Ankündigungszeile mit
    // der Folgezeile zusammenziehen, sonst sagt die Meldung nichts aus.
    if (!hasFields && meaningful[1] && message.length < 60 && /:$/.test(message)) {
      message += ' ' + meaningful[1];
    }

    const limit = maxLen || 120;
    if (message.length <= limit) return message;
    // An der letzten Wortgrenze schneiden statt mitten im Wort ("… Sql T").
    // Der Rückschnitt wird nur genommen, wenn dabei nicht zu viel verlorengeht —
    // bei einem einzelnen langen Token (Pfad, GUID, Stack-Zeile) gibt es keine
    // brauchbare Grenze, dann bleibt es beim harten Schnitt.
    const cut = message.substring(0, limit - 1);
    const space = cut.lastIndexOf(' ');
    return (space > (limit - 1) * 0.6 ? cut.substring(0, space) : cut).replace(/\s+$/, '') + '…';
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
