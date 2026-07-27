(function() {
window.Keasy = window.Keasy || {};

// Deklarative Registry — eine neue exportierbare Sektion = ein Eintrag hier.
// defaultOn: teilenswerte Logik ist vorbelegt; Pfade/Zugangsdaten bewusst nicht.
const CONFIG_SECTIONS = [
  { id: 'general',    label: 'Allgemeine Optionen',                   defaultOn: true  },
  { id: 'patterns',   label: 'Filter- & Ausschluss-Muster',          defaultOn: true  },
  { id: 'thresholds', label: 'Schwellwert-Regeln',                    defaultOn: true  },
  { id: 'watchPaths', label: 'Watch-Pfade',                           defaultOn: false },
  { id: 'email',      label: 'E-Mail / SMTP (ohne Passwort)',         defaultOn: false },
  { id: 'backup',     label: 'Backup-Ziele & FTP (ohne Passwort)',    defaultOn: false }
];

let _rendered = false;

function renderExportSections() {
  const container = document.getElementById('exportSectionsList');
  if (!container || _rendered) return;
  container.innerHTML = CONFIG_SECTIONS.map(s =>
    `<label class="config-field config-field-checkbox" style="margin-bottom:6px;">` +
    `<input type="checkbox" class="export-section-cb" value="${s.id}"${s.defaultOn ? ' checked' : ''}> ${s.label}` +
    `</label>`
  ).join('');
  _rendered = true;
}

function exportToolPackage() {
  const ids = Array.from(document.querySelectorAll('.export-section-cb'))
    .filter(cb => cb.checked)
    .map(cb => cb.value);

  const url = '/api/export-tool?sections=' + encodeURIComponent(ids.join(','));

  // Attachment-Response → Download ohne Navigation
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  if (typeof showConfigMessage === 'function') {
    showConfigMessage('📦 Tool-Paket wird erzeugt und heruntergeladen…', 'success');
  }
}

window.Keasy.toolExport = { renderExportSections, exportToolPackage, CONFIG_SECTIONS };
Object.assign(window, { renderExportSections, exportToolPackage });

})();
