/**
 * Keasy Log Monitor — Tool-Export
 * Erzeugt ein schlankes, weitergebbares ZIP der App: App-Code + eine bereinigte
 * Start-Config (config.default.js), OHNE Secrets, Benutzerkonten, Logs, node_modules
 * und maschinenspezifische Daten. Die Sektions-Auswahl steuert, welche Einstellungen
 * in die mitgelieferte Config eingebacken werden.
 */

const fs = require('fs');
const path = require('path');
const { ZipArchive } = require('archiver');
const { config } = require('./configStore');

const ROOT = path.join(__dirname, '..');

// Minimal lauffähige Basis-Config — unabhängig von der Sektions-Auswahl immer vorhanden,
// damit ein entpacktes Paket in jedem Fall startet.
const BASE_DEFAULTS = {
  port: 3848,
  autoOpen: true,
  debugLogging: false,
  authEnabled: true,
  maxErrorsPerFile: 10,
  loadExistingErrors: true,
  maxLogFileSizeMB: 6,
  trashAutoCleanupHours: 48,
  watchPaths: [],
  filePattern: '**/*.log',
  filterPatterns: ['Exception', 'Fehler'],
  excludePatterns: [],
  thresholdRules: []
};

// Sektion → Config-Keys, die bei angehakter Sektion aus der Laufzeit-Config übernommen werden.
// analyzePaths / copilotWorkingPath* sind bewusst in KEINER Sektion → werden nie exportiert.
const SECTION_KEYS = {
  general: ['port', 'autoOpen', 'debugLogging', 'authEnabled', 'maxErrorsPerFile',
            'loadExistingErrors', 'maxLogFileSizeMB', 'trashAutoCleanupHours'],
  patterns: ['filterPatterns', 'excludePatterns', 'filePattern'],
  thresholds: ['thresholdRules'],
  watchPaths: ['watchPaths'],
  email: ['email'],
  backup: ['backup']
};

const VALID_SECTIONS = Object.keys(SECTION_KEYS);

// Bereinigte Start-Config aus der Sektions-Auswahl bauen.
function buildExportConfig(selectedSectionIds) {
  const selected = (selectedSectionIds || []).filter(id => VALID_SECTIONS.includes(id));
  const source = config.toJSON ? config.toJSON() : JSON.parse(JSON.stringify(config));
  const out = JSON.parse(JSON.stringify(BASE_DEFAULTS));

  for (const id of selected) {
    for (const key of SECTION_KEYS[id]) {
      if (source[key] !== undefined) {
        out[key] = JSON.parse(JSON.stringify(source[key]));
      }
    }
  }

  // Secrets / Runtime-Marker konsequent tilgen — auch wenn die Sektion angehakt wurde.
  if (out.email && out.email.smtp) {
    delete out.email.smtp.auth;               // SMTP-User + Passwort
  }
  if (out.backup && out.backup.ftp) {
    delete out.backup.ftp.pass;
    delete out.backup.ftp.user;
  }
  if (Array.isArray(out.watchPaths)) {
    out.watchPaths = out.watchPaths.map(wp => {
      if (wp && typeof wp === 'object') {
        const { _isNetworkDrive, _hasPassword, ...rest } = wp;
        return rest;
      }
      return wp;
    });
  }

  return out;
}

// Config-Datei-Inhalt im selben Format wie configStore.writeConfig erzeugen.
function serializeConfigModule(cfg) {
  const header = '/**\n' +
    ' * Keasy Log Monitor - Standard-Konfiguration (Auslieferung)\n' +
    ' * Wird beim ersten Start nach config.js kopiert, falls diese fehlt.\n' +
    ' */\n\n';
  return header + 'module.exports = ' + JSON.stringify(cfg, null, 2) + ';\n';
}

// ─── Paket-Dateien sammeln ──────────────────────────────────

// Verzeichnisse, die nie ins Paket gehören (per Basename, auch verschachtelt).
const EXCLUDE_DIR_NAMES = new Set([
  'node_modules', '.git', '.claude',
  'temp-backup', 'temp-ftp', 'temp-restore',
  'users'
]);

// Dateien (per Basename), die nie ins Paket gehören.
const EXCLUDE_FILE_RE = new RegExp(
  '^(config\\.js|config\\.js\\.bak|config - Kopie\\.js|config\\.default\\.js|' +
  'users\\.json|backup-status\\.json|crash\\.log(\\.old)?|' +
  '.*\\.log|.*\\.bak|keasy-(backup|full|safety)-.*\\.zip)$'
);

// App-Code rekursiv sammeln (Muster analog backupService.collectFullBackupFiles).
function collectPackageFiles(dir, base, result) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const rel = path.relative(base, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (EXCLUDE_DIR_NAMES.has(entry.name)) continue;
      collectPackageFiles(fullPath, base, result);
    } else if (entry.isFile()) {
      if (EXCLUDE_FILE_RE.test(entry.name)) continue;
      // Lose Plan-/Scratch-Markdown im Wurzelverzeichnis auslassen (README.md bleibt,
      // docs/*.md bleiben, da sie einen Pfad-Anteil "docs/" haben).
      if (!rel.includes('/') && /\.md$/i.test(entry.name) && entry.name !== 'README.md') continue;
      result.push({ fullPath, rel });
    }
  }
}

const WEITERGABE_MD = `# Keasy Log Monitor — Weitergabe-Paket

Dieses Paket enthält den Programmcode und eine bereinigte Standard-Konfiguration
(\`config.default.js\`). **Nicht** enthalten sind Zugangsdaten (SMTP/FTP), Benutzerkonten,
Log-Dateien und maschinenspezifische Pfade.

## Installation

1. ZIP in einen leeren Ordner entpacken.
2. Sicherstellen, dass Node.js installiert ist (https://nodejs.org/).
3. \`start.bat\` ausführen. Beim ersten Start werden die Abhängigkeiten installiert
   (\`npm install\`) und \`config.default.js\` nach \`config.js\` kopiert.
4. Das Dashboard öffnet sich im Browser.
{{LOGIN}}

## Danach

- Überwachungspfade, E-Mail-/Backup-Zugänge in den ⚙️ Einstellungen ergänzen.
`;

// Login-Hinweis abhängig vom tatsächlichen Auth-Zustand der Paket-Config erzeugen.
// Regel wie configStore.isAuthEnabled: fehlend ⇒ aktiv, nur explizit false ⇒ aus.
function buildWeitergabeMd(exportConfig) {
  const authOn = exportConfig.authEnabled !== false;
  const login = authOn
    ? '5. Das Rechte-System ist aktiv. Standard-Login: `admin` / `admin`\n' +
      '   (bitte umgehend unter ⚙️ Einstellungen → Benutzer das Passwort ändern).'
    : '5. Das Rechte-System ist deaktiviert — kein Login nötig. Es kann bei Bedarf unter\n' +
      '   ⚙️ Einstellungen → Allgemein aktiviert werden (dann Standard-Login `admin` / `admin`).';
  return WEITERGABE_MD.replace('{{LOGIN}}', login);
}

// ZIP direkt in die HTTP-Response streamen.
function streamZip(res, selectedSectionIds) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `keasy-tool-${dateStr}.zip`;

  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${filename}"`
  });

  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error('⚠️  Tool-Export Fehler:', err.message);
    res.destroy(err);
  });
  archive.pipe(res);

  const files = [];
  collectPackageFiles(ROOT, ROOT, files);
  for (const f of files) {
    archive.file(f.fullPath, { name: f.rel });
  }

  const exportConfig = buildExportConfig(selectedSectionIds);
  archive.append(serializeConfigModule(exportConfig), { name: 'config.default.js' });
  archive.append(buildWeitergabeMd(exportConfig), { name: 'WEITERGABE.md' });

  archive.finalize();
}

module.exports = { buildExportConfig, serializeConfigModule, collectPackageFiles, streamZip, VALID_SECTIONS };
