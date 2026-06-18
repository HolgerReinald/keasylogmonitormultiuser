/**
 * Keasy Log Monitor — Backup Service
 * Erstellt, verteilt, listet und stellt Backups wieder her.
 */

const fs = require('fs');
const path = require('path');
const { ZipArchive } = require('archiver');
const AdmZip = require('adm-zip');
const ftp = require('basic-ftp');

const { config, configPath, writeConfig } = require('./configStore');

const ROOT = path.join(__dirname, '..');
const STATUS_FILE = path.join(ROOT, 'backup-status.json');

// basic-ftp secure-Wert aus Config-secureMode ableiten
function resolveFtpSecure(cfg) {
  const mode = cfg.secureMode || (cfg.secure === true ? 'implicit' : cfg.secure === 'explicit' ? 'explicit' : 'none');
  return mode === 'explicit' ? 'explicit' : (mode === 'implicit' ? true : false);
}
const STYLE_PATH = path.join(ROOT, 'public', 'style.css');
const EMAIL_LOG_PATH = path.join(ROOT, 'email.log');

// Erlaubte Dateien im ZIP (Whitelist)
const ALLOWED_FILES = ['config.json', 'style.css', 'email.log', 'backup-manifest.json'];
const REQUIRED_FILES = ['config.json', 'style.css', 'backup-manifest.json'];
const SCHEMA_VERSION = 1;

let schedulerTimer = null;
let backupRunning = false; // Run-Lock (Mutex)

// ─── Status-Datei ───────────────────────────────────────────

function readStatus() {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return { lastRun: null, results: {}, nextScheduled: null };
}

function writeStatus(data) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Backup erstellen ───────────────────────────────────────

function createBackup() {
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `keasy-backup-${timestamp}.zip`;
    const tmpPath = path.join(ROOT, 'temp-backup');

    if (!fs.existsSync(tmpPath)) fs.mkdirSync(tmpPath, { recursive: true });

    const zipPath = path.join(tmpPath, filename);
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on('close', () => resolve({ zipPath, filename, size: archive.pointer() }));
    archive.on('error', reject);
    archive.pipe(output);

    // Config als JSON-Snapshot (nicht JS!)
    const configSnapshot = JSON.parse(JSON.stringify(config.toJSON ? config.toJSON() : config));
    archive.append(JSON.stringify(configSnapshot, null, 2), { name: 'config.json' });

    // CSS
    if (fs.existsSync(STYLE_PATH)) {
      archive.file(STYLE_PATH, { name: 'style.css' });
    }

    // E-Mail-Log (optional)
    const backupCfg = config.backup || {};
    const includeLog = backupCfg.includeEmailLog !== false;
    const files = ['config.json', 'style.css'];
    if (includeLog && fs.existsSync(EMAIL_LOG_PATH)) {
      archive.file(EMAIL_LOG_PATH, { name: 'email.log' });
      files.push('email.log');
    }

    // Manifest
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const manifest = {
      version: pkg.version,
      created: new Date().toISOString(),
      files,
      schemaVersion: SCHEMA_VERSION
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: 'backup-manifest.json' });

    archive.finalize();
  });
}

// ─── Backup verteilen ───────────────────────────────────────

async function runBackup() {
  if (backupRunning) {
    return { ok: false, message: 'Backup läuft bereits' };
  }
  backupRunning = true;

  try {
    const backupCfg = config.backup || {};
    const locals = backupCfg.locals || [];
    const activeLocals = locals.filter(l => l.enabled && l.path);
    const ftpEnabled = backupCfg.ftp && backupCfg.ftp.enabled;

    if (activeLocals.length === 0 && !ftpEnabled) {
      return { ok: false, message: 'Kein Backup-Ziel aktiviert' };
    }

    const { zipPath, filename, size } = await createBackup();
    const results = {};

    // Lokale Ziele
    for (const loc of activeLocals) {
      try {
        await saveLocal(zipPath, filename, loc);
        results[loc.id] = { label: loc.label, status: 'ok', time: new Date().toISOString(), file: filename, size };
      } catch (err) {
        results[loc.id] = { label: loc.label, status: 'error', time: new Date().toISOString(), error: err.message };
      }
    }

    // FTP
    if (ftpEnabled) {
      try {
        await saveToFtp(zipPath, filename, backupCfg.ftp);
        results.ftp = { status: 'ok', time: new Date().toISOString(), file: filename, size };
      } catch (err) {
        results.ftp = { status: 'error', time: new Date().toISOString(), error: err.message };
      }
    }

    // Temp-ZIP aufräumen
    try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
    try { fs.rmdirSync(path.dirname(zipPath)); } catch { /* ignore */ }

    // Status speichern
    const status = readStatus();
    status.lastRun = new Date().toISOString();
    status.results = results;
    writeStatus(status);

    // Alte Backups rotieren
    const maxPerTarget = backupCfg.maxBackupsPerTarget || 10;
    for (const loc of activeLocals) {
      if (results[loc.id] && results[loc.id].status === 'ok') {
        try { await rotateLocalBackups(loc, maxPerTarget); } catch { /* ignore */ }
      }
    }
    if (ftpEnabled && results.ftp && results.ftp.status === 'ok') {
      try { await rotateFtpBackups(maxPerTarget, backupCfg.ftp); } catch { /* ignore */ }
    }

    const allOk = Object.values(results).every(r => r.status === 'ok');
    const allResults = Object.values(results);
    const successCount = allResults.filter(r => r.status === 'ok').length;
    const failCount = allResults.filter(r => r.status === 'error').length;
    return {
      ok: failCount === 0,
      partial: successCount > 0 && failCount > 0,
      successCount,
      failCount,
      results,
      filename
    };
  } finally {
    backupRunning = false;
  }
}

// ─── Lokales Backup ─────────────────────────────────────────

async function saveLocal(zipPath, filename, localCfg) {
  const targetDir = localCfg.path;
  if (!targetDir) throw new Error('Kein lokaler Pfad konfiguriert');
  if (!fs.existsSync(targetDir)) throw new Error(`Pfad nicht gefunden: ${targetDir}`);

  const targetPath = path.join(targetDir, filename);
  await retryOperation(() => {
    fs.copyFileSync(zipPath, targetPath);
  });
}

// ─── FTP Backup ─────────────────────────────────────────────

async function saveToFtp(zipPath, filename, ftpCfg) {
  await retryOperation(async () => {
    const client = new ftp.Client();
    client.ftp.verbose = false;
    try {
      await client.access({
        host: ftpCfg.host,
        port: ftpCfg.port || 21,
        user: ftpCfg.user,
        password: ftpCfg.pass,
        secure: resolveFtpSecure(ftpCfg)
      });
      const remotePath = ftpCfg.remotePath || '/backups';
      await client.ensureDir(remotePath);
      await client.uploadFrom(zipPath, `${remotePath}/${filename}`);
    } finally {
      client.close();
    }
  });
}

// ─── Retry-Logik ────────────────────────────────────────────

async function retryOperation(fn, maxRetries = 3, delayMs = 15000) {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err;
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

// ─── Backup-Rotation ────────────────────────────────────────

async function rotateLocalBackups(localCfg, maxPerTarget) {
  const dir = localCfg.path;
  if (!dir || !fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('keasy-backup-') && f.endsWith('.zip'))
    .map(f => ({ filename: f, mtime: fs.statSync(path.join(dir, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);
  if (files.length <= maxPerTarget) return;
  for (const b of files.slice(maxPerTarget)) {
    try { fs.unlinkSync(path.join(dir, b.filename)); } catch { /* ignore */ }
  }
}

async function rotateFtpBackups(maxPerTarget, ftpCfg) {
  const backups = await listFtpBackups(ftpCfg);
  if (backups.length <= maxPerTarget) return;
  const toDelete = backups.slice(maxPerTarget);
  const client = new ftp.Client();
  try {
    await client.access({
      host: ftpCfg.host,
      port: ftpCfg.port || 21,
      user: ftpCfg.user,
      password: ftpCfg.pass,
      secure: resolveFtpSecure(ftpCfg)
    });
    const remotePath = ftpCfg.remotePath || '/backups';
    for (const b of toDelete) {
      try { await client.remove(`${remotePath}/${b.filename}`); } catch { /* ignore */ }
    }
  } finally {
    client.close();
  }
}

// ─── Backups auflisten ──────────────────────────────────────

async function listBackups(target) {
  const backupCfg = config.backup || {};
  const backups = [];
  const targets = [];

  // Lokale Ziele
  if (target !== 'ftp') {
    const locals = backupCfg.locals || [];
    for (const loc of locals) {
      if (target && target.startsWith('local:') && target !== `local:${loc.id}`) continue;
      if (!loc.path || !fs.existsSync(loc.path)) {
        targets.push({ source: 'local', sourceId: loc.id, label: loc.label || 'Lokal', reachable: false, error: 'Pfad nicht erreichbar' });
        continue;
      }
      targets.push({ source: 'local', sourceId: loc.id, label: loc.label || 'Lokal', reachable: true });
      const files = fs.readdirSync(loc.path)
        .filter(f => f.startsWith('keasy-backup-') && f.endsWith('.zip'));
      for (const f of files) {
        try {
          const stat = fs.statSync(path.join(loc.path, f));
          backups.push({
            filename: f,
            source: 'local',
            sourceId: loc.id,
            sourceLabel: loc.label || 'Lokal',
            size: stat.size,
            date: stat.mtime.toISOString(),
            content: getZipContentSummary(path.join(loc.path, f))
          });
        } catch { /* Datei zwischenzeitlich verschwunden — überspringen */ }
      }
    }
  }

  if (target === 'ftp' || !target) {
    const ftpCfg = backupCfg.ftp || {};
    try {
      const ftpBackups = await listFtpBackups(ftpCfg);
      backups.push(...ftpBackups);
      if (ftpCfg.enabled && ftpCfg.host) {
        targets.push({ source: 'ftp', sourceId: 'ftp', label: 'FTP', reachable: true });
      }
    } catch {
      if (ftpCfg.enabled && ftpCfg.host) {
        targets.push({ source: 'ftp', sourceId: 'ftp', label: 'FTP', reachable: false, error: 'Verbindung fehlgeschlagen' });
      }
    }
  }

  // Duplikate entfernen (gleicher Filename von verschiedenen lokalen Zielen → nur einmal zeigen)
  const seen = new Map();
  const deduplicated = [];
  for (const b of backups) {
    const key = `${b.filename}|${b.source}|${b.sourceId || 'ftp'}`;
    if (!seen.has(key)) {
      seen.set(key, true);
      deduplicated.push(b);
    }
  }

  // Neueste zuerst
  deduplicated.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return { backups: deduplicated, targets };
}

async function listFtpBackups(ftpCfg) {
  const backups = [];
  if (!ftpCfg || !ftpCfg.host || !ftpCfg.enabled) return backups;
  try {
    const client = new ftp.Client();
    await client.access({
      host: ftpCfg.host,
      port: ftpCfg.port || 21,
      user: ftpCfg.user,
      password: ftpCfg.pass,
      secure: resolveFtpSecure(ftpCfg)
    });
    const remotePath = ftpCfg.remotePath || '/backups';
    const list = await client.list(remotePath);
    for (const item of list) {
      if (item.name.startsWith('keasy-backup-') && item.name.endsWith('.zip')) {
        let content = null;
        try {
          const tmpDir = path.join(ROOT, 'temp-ftp');
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
          const tmpPath = path.join(tmpDir, item.name);
          await client.downloadTo(tmpPath, `${remotePath}/${item.name}`);
          content = getZipContentSummary(tmpPath);
          try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        } catch { /* ignore */ }
        backups.push({
          filename: item.name,
          source: 'ftp',
          sourceId: 'ftp',
          sourceLabel: 'FTP',
          size: item.size,
          date: item.modifiedAt ? item.modifiedAt.toISOString() : null,
          content
        });
      }
    }
    client.close();
  } catch { /* FTP nicht erreichbar → leere Liste */ }
  return backups;
}

function getZipContentSummary(zipPath) {
  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries().map(e => e.entryName);
    const parts = [];
    if (entries.includes('config.json')) parts.push('Config');
    if (entries.includes('style.css')) parts.push('CSS');
    if (entries.includes('email.log')) parts.push('Mail-Log');
    // Version aus Manifest
    const manifestEntry = zip.getEntry('backup-manifest.json');
    let version = null;
    if (manifestEntry) {
      try {
        const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
        version = manifest.version;
      } catch { /* ignore */ }
    }
    return { files: parts.join('+'), version };
  } catch { return null; }
}

// ─── Verbindung testen ──────────────────────────────────────

async function testConnection(target, formData) {
  const backupCfg = config.backup || {};

  // local:loc_xxx → lokales Ziel per ID
  if (target.startsWith('local')) {
    let localPath;
    if (formData && 'path' in formData) {
      localPath = formData.path;
    } else if (target.startsWith('local:')) {
      const id = target.split(':')[1];
      const loc = (backupCfg.locals || []).find(l => l.id === id);
      localPath = loc ? loc.path : '';
    }
    if (!localPath) return { ok: false, error: 'Kein Pfad konfiguriert' };
    if (!fs.existsSync(localPath)) return { ok: false, error: `Pfad nicht gefunden: ${localPath}` };

    const testFile = path.join(localPath, '.keasy-backup-test');
    try {
      fs.writeFileSync(testFile, 'test', 'utf8');
      fs.unlinkSync(testFile);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Nicht beschreibbar: ${err.message}` };
    }
  }

  if (target === 'ftp') {
    const ftpCfg = backupCfg.ftp || {};
    const host = (formData && formData.host) || ftpCfg.host;
    const port = (formData && formData.port) || ftpCfg.port || 21;
    const user = (formData && formData.user) || ftpCfg.user;
    const pass = (formData && formData.pass && formData.pass !== '••••••••') ? formData.pass : ftpCfg.pass;
    const secureMode = formData && formData.secureMode ? formData.secureMode : (ftpCfg.secureMode || ftpCfg.secure || false);
    // basic-ftp: false = kein TLS, "explicit" = STARTTLS (Port 21), true = implizit (Port 990)
    const secure = secureMode === 'explicit' ? 'explicit' : (secureMode === 'implicit' ? true : false);
    const remotePath = (formData && formData.remotePath) || ftpCfg.remotePath || '/backups';
    if (!host) return { ok: false, error: 'Kein FTP-Host konfiguriert' };

    const client = new ftp.Client();
    try {
      await client.access({ host, port, user, password: pass, secure });
      await client.ensureDir(remotePath);
      // Schreibtest: Testdatei hoch- und runterladen
      const testContent = Buffer.from('keasy-backup-test');
      const { Readable } = require('stream');
      const testStream = new Readable();
      testStream.push(testContent);
      testStream.push(null);
      await client.uploadFrom(testStream, `${remotePath}/.keasy-backup-test`);
      await client.remove(`${remotePath}/.keasy-backup-test`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      client.close();
    }
  }

  return { ok: false, error: `Unbekanntes Ziel: ${target}` };
}

// ─── Restore Preview ────────────────────────────────────────

async function previewRestore(source, filename, sourceId) {
  const zipPath = await getZipPath(source, filename, sourceId);

  // Zip-Slip-Prüfung + Whitelist
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  const validFiles = [];
  const rejected = [];

  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, '/');
    // Pfad-Traversal blockieren
    if (name.includes('..') || path.isAbsolute(name)) {
      if (source === 'ftp') cleanupTempFtp(zipPath);
      throw new Error(`Ungültiger Pfad im ZIP: ${name}`);
    }
    if (ALLOWED_FILES.includes(name)) {
      validFiles.push(name);
    } else {
      rejected.push(name);
    }
  }

  // Pflichtdateien prüfen
  for (const req of REQUIRED_FILES) {
    if (!validFiles.includes(req)) {
      if (source === 'ftp') cleanupTempFtp(zipPath);
      throw new Error(`Pflichtdatei fehlt im ZIP: ${req}`);
    }
  }

  // Manifest + Schema-Version prüfen
  const manifestEntry = zip.getEntry('backup-manifest.json');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  if (manifest.schemaVersion > SCHEMA_VERSION) {
    if (source === 'ftp') cleanupTempFtp(zipPath);
    throw new Error(`Inkompatible Schema-Version: ${manifest.schemaVersion} (erwartet max. ${SCHEMA_VERSION})`);
  }

  if (source === 'ftp') cleanupTempFtp(zipPath);

  return {
    filename,
    source,
    manifest,
    files: validFiles,
    rejected,
    overwrites: validFiles.filter(f => f !== 'backup-manifest.json').map(f => {
      if (f === 'config.json') return 'config.js (Konfiguration)';
      if (f === 'style.css') return 'public/style.css (CSS-Anpassungen)';
      if (f === 'email.log') return 'email.log (E-Mail-Protokoll)';
      return f;
    })
  };
}

// ─── Restore ausführen ──────────────────────────────────────

async function restoreBackup(source, filename, sourceId) {
  const zipPath = await getZipPath(source, filename, sourceId);
  const zip = new AdmZip(zipPath);

  // 1. Validierung (Whitelist + Zip-Slip)
  const entries = zip.getEntries();
  const validEntries = [];
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (name.includes('..') || path.isAbsolute(name)) {
      throw new Error(`Ungültiger Pfad im ZIP: ${name}`);
    }
    if (ALLOWED_FILES.includes(name)) {
      validEntries.push(entry);
    }
  }

  // Pflichtdateien prüfen
  const validNames = validEntries.map(e => e.entryName.replace(/\\/g, '/'));
  for (const req of REQUIRED_FILES) {
    if (!validNames.includes(req)) throw new Error(`Pflichtdatei fehlt: ${req}`);
  }

  // Schema-Version
  const manifestEntry = validEntries.find(e => e.entryName.replace(/\\/g, '/') === 'backup-manifest.json');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  if (manifest.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Inkompatible Schema-Version: ${manifest.schemaVersion}`);
  }

  // 2. Safety-Backup — in erstes aktives+beschreibbares lokales Ziel
  const safetyResult = await createBackup();
  const backupCfg = config.backup || {};
  const locals = backupCfg.locals || [];
  const safetyTarget = locals.find(l => l.enabled && l.path && fs.existsSync(l.path));
  if (safetyTarget) {
    const safetyName = safetyResult.filename.replace('keasy-backup-', 'keasy-safety-');
    fs.copyFileSync(safetyResult.zipPath, path.join(safetyTarget.path, safetyName));
  }
  try { fs.unlinkSync(safetyResult.zipPath); } catch { /* ignore */ }
  try { fs.rmdirSync(path.dirname(safetyResult.zipPath)); } catch { /* ignore */ }

  // 3. Dateien extrahieren + atomar ersetzen
  const tempDir = path.join(ROOT, 'temp-restore');
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  for (const entry of validEntries) {
    const name = entry.entryName.replace(/\\/g, '/');
    if (name === 'backup-manifest.json') continue;

    const data = entry.getData();

    if (name === 'config.json') {
      // JSON → config.js zurückschreiben
      const restoredConfig = JSON.parse(data.toString('utf8'));
      // Backup-Einstellungen beibehalten (nicht aus altem Backup übernehmen)
      restoredConfig.backup = JSON.parse(JSON.stringify(config.toJSON ? config.toJSON() : config)).backup;
      writeConfig(restoredConfig);
    } else if (name === 'style.css') {
      const tempFile = path.join(tempDir, 'style.css');
      fs.writeFileSync(tempFile, data);
      fs.renameSync(tempFile, STYLE_PATH);
    } else if (name === 'email.log') {
      const tempFile = path.join(tempDir, 'email.log');
      fs.writeFileSync(tempFile, data);
      fs.renameSync(tempFile, EMAIL_LOG_PATH);
    }
  }

  // Cleanup
  try { fs.rmSync(tempDir, { recursive: true }); } catch { /* ignore */ }
  if (source === 'ftp') cleanupTempFtp(zipPath);

  return { ok: true, manifest };
}

// ─── FTP-Hilfsfunktionen ────────────────────────────────────

async function getZipPath(source, filename, sourceId) {
  // Dateinamen-Validierung
  if (!filename.startsWith('keasy-backup-') && !filename.startsWith('keasy-safety-')) {
    throw new Error('Ungültiger Dateiname');
  }
  if (!filename.endsWith('.zip')) throw new Error('Ungültiger Dateiname');
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Ungültiger Dateiname');
  }

  if (source === 'local') {
    const locals = ((config.backup || {}).locals || []);
    // Per sourceId auflösen, oder über alle suchen
    let localPath;
    if (sourceId) {
      const loc = locals.find(l => l.id === sourceId);
      localPath = loc ? loc.path : null;
    }
    if (!localPath) {
      // Fallback: in allen lokalen Zielen suchen
      for (const loc of locals) {
        if (loc.path && fs.existsSync(path.join(loc.path, filename))) {
          localPath = loc.path;
          break;
        }
      }
    }
    if (!localPath) throw new Error('Kein lokaler Pfad konfiguriert');
    const fullPath = path.join(localPath, filename);
    if (!fs.existsSync(fullPath)) throw new Error(`Backup nicht gefunden: ${filename}`);
    return fullPath;
  }

  if (source === 'ftp') {
    const ftpCfg = (config.backup || {}).ftp || {};
    const client = new ftp.Client();
    const tmpDir = path.join(ROOT, 'temp-ftp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpPath = path.join(tmpDir, filename);
    try {
      await client.access({
        host: ftpCfg.host,
        port: ftpCfg.port || 21,
        user: ftpCfg.user,
        password: ftpCfg.pass,
        secure: resolveFtpSecure(ftpCfg)
      });
      const remotePath = ftpCfg.remotePath || '/backups';
      await client.downloadTo(tmpPath, `${remotePath}/${filename}`);
    } finally {
      client.close();
    }
    return tmpPath;
  }

  throw new Error(`Unbekannte Quelle: ${source}`);
}

function cleanupTempFtp(zipPath) {
  try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
  try { fs.rmdirSync(path.dirname(zipPath)); } catch { /* ignore */ }
}

// ─── Scheduler ──────────────────────────────────────────────

function scheduleBackup() {
  stopScheduler();

  const backupCfg = config.backup || {};
  const schedule = backupCfg.schedule || {};
  if (!schedule.enabled) return;

  const time = schedule.time || '02:00';
  const [hours, minutes] = time.split(':').map(Number);

  function scheduleNext() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const delay = next.getTime() - now.getTime();
    const status = readStatus();
    status.nextScheduled = next.toISOString();
    writeStatus(status);

    schedulerTimer = setTimeout(async () => {
      try {
        console.log(`[Backup] Geplantes Backup um ${time} gestartet`);
        await runBackup();
        console.log('[Backup] Geplantes Backup abgeschlossen');
      } catch (err) {
        console.error('[Backup] Fehler beim geplanten Backup:', err.message);
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}

function stopScheduler() {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}

function checkMissedBackup() {
  const backupCfg = config.backup || {};
  const schedule = backupCfg.schedule || {};
  if (!schedule.enabled) return;

  const status = readStatus();
  if (!status.lastRun) {
    // Noch nie ein Backup gelaufen → jetzt nachholen
    console.log('[Backup] Kein vorheriges Backup gefunden — wird nachgeholt');
    runBackup().catch(err => console.error('[Backup] Fehler:', err.message));
    return;
  }

  const lastRun = new Date(status.lastRun);
  const now = new Date();
  const hoursSinceLastRun = (now - lastRun) / (1000 * 60 * 60);

  if (hoursSinceLastRun > 25) {
    console.log(`[Backup] Letztes Backup vor ${Math.round(hoursSinceLastRun)}h — wird nachgeholt`);
    runBackup().catch(err => console.error('[Backup] Fehler:', err.message));
  }
}

// ─── Backup löschen ──────────────────────────────────────────

async function deleteBackup(source, sourceId, filename) {
  // Strenge Validierung: exaktes Dateiformat
  if (!/^keasy-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.zip$/.test(filename)) {
    const err = new Error('Ungültiger Dateiname');
    err.statusCode = 400;
    throw err;
  }

  if (source === 'local') {
    const localCfg = (config.backup?.locals || []).find(l => l.id === sourceId);
    if (!localCfg) {
      const err = new Error('Backup-Ziel nicht gefunden');
      err.statusCode = 400;
      throw err;
    }
    const fullPath = path.join(localCfg.path, filename);
    // Path-Traversal-Schutz
    if (!path.resolve(fullPath).startsWith(path.resolve(localCfg.path))) {
      const err = new Error('Ungültiger Pfad');
      err.statusCode = 400;
      throw err;
    }
    if (!fs.existsSync(fullPath)) {
      const err = new Error('Backup-Datei nicht mehr vorhanden');
      err.statusCode = 404;
      throw err;
    }
    fs.unlinkSync(fullPath);
  } else if (source === 'ftp') {
    const ftpCfg = config.backup?.ftp;
    if (!ftpCfg || !ftpCfg.host) {
      const err = new Error('FTP nicht konfiguriert');
      err.statusCode = 400;
      throw err;
    }
    const client = new ftp.Client();
    try {
      await client.access({
        host: ftpCfg.host,
        port: ftpCfg.port || 21,
        user: ftpCfg.user,
        password: ftpCfg.pass,
        secure: resolveFtpSecure(ftpCfg)
      });
      const remotePath = ftpCfg.remotePath || '/backups';
      await client.remove(`${remotePath}/${filename}`);
    } finally {
      client.close();
    }
  } else {
    const err = new Error('Unbekannte Quelle');
    err.statusCode = 400;
    throw err;
  }
}

module.exports = {
  createBackup,
  runBackup,
  listBackups,
  deleteBackup,
  testConnection,
  previewRestore,
  restoreBackup,
  scheduleBackup,
  stopScheduler,
  checkMissedBackup,
  readStatus
};
