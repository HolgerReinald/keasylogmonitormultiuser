const http = require('http');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { WebSocketServer } = require('ws');

// --- Module ---
const store = require('./server/runtimeStore');
const { normalizedWatchPaths, pausedLabels, emailDisabledLabels, trashStore, state: rState } = store;
const { broadcast, clients, broadcastTrash, disconnectUser } = require('./server/wsBroadcast');
const configStore = require('./server/configStore');
const { config } = configStore;
const { getVisibleLabels, mergeConfigForUser } = require('./server/userConfigStore');
const { rebuildFilterRegex, rebuildExcludeRegex, rebuildThresholdRules } = require('./server/logParser');
const { getTrashSnapshot } = require('./server/trashService');
const { restartEmailTimer, getNextEmailSendTime } = require('./server/emailService');
const { getAnalyzeErrors } = require('./server/analysisService');
const { getOrCreateAnalyzeUser } = require('./server/runtimeStore');
const { startWatching, getAllErrors, getOversizedFiles, reevaluateOversized, preloadReset } = require('./server/watchService');
const createRouter = require('./server/httpRouter');
const backupService = require('./server/backupService');
const healthCheck = require('./server/healthCheck');
const userStore = require('./server/userStore');

// --- activeWatchers als Ref-Objekt (let → { current }) ---
const activeWatchersRef = { current: [] };

// --- Config Hot-Reload ---
function applyConfigChanges(newConfig) {
  const oldConfig = JSON.parse(JSON.stringify(config));
  configStore.replaceConfig(newConfig);

  // normalizedWatchPaths aktualisieren
  normalizedWatchPaths.length = 0;
  newConfig.watchPaths.forEach(entry => {
    if (typeof entry === 'string') {
      normalizedWatchPaths.push({ path: entry, label: path.basename(entry) || entry, emailTo: null, usePolling: false });
    } else {
      normalizedWatchPaths.push({ ...entry, usePolling: !!entry.usePolling });
    }
  });

  // Filter-Regex neu erstellen
  rebuildFilterRegex(newConfig.filterPatterns);

  // Ausschluss-Regex neu erstellen
  rebuildExcludeRegex(newConfig.excludePatterns);

  // Schwellwert-Regeln aktualisieren
  rebuildThresholdRules(newConfig.thresholdRules);

  // Email-Timer aktualisieren
  restartEmailTimer();

  // Backup-Scheduler aktualisieren
  backupService.scheduleBackup();

  // Watcher neu starten wenn sich watchPaths oder Polling geändert haben
  const serializeWp = wps => (wps || []).map(wp => typeof wp === 'string' ? wp : `${wp.path}|${!!wp.usePolling}`).sort().join('||');
  if (serializeWp(oldConfig.watchPaths) !== serializeWp(newConfig.watchPaths) || oldConfig.filePattern !== newConfig.filePattern) {
    activeWatchersRef.current.forEach(w => w.close());
    store.resetWatcherRuntime();
    activeWatchersRef.current = startWatching();
  }

  // Rechtesystem gerade aktiviert (false→true)? → sicherstellen, dass ein Admin existiert (Aussperr-Schutz)
  if (oldConfig.authEnabled === false && newConfig.authEnabled !== false) {
    userStore.ensureDefaultAdmin().catch(err => console.error('⚠️  ensureDefaultAdmin:', err.message));
  }

  // config-changed pro Client senden: emailConfigured hängt an den per-User-Subscriptions
  for (const client of clients) {
    if (client.readyState !== 1) continue;
    const emailConfigured = client.username ? emailConfiguredForUser(client.username, client.visibleLabels) : [];
    try {
      client.send(JSON.stringify({ type: 'config-changed', data: { emailConfigured, maxLogFileSizeMB: newConfig.maxLogFileSizeMB, authEnabled: configStore.isAuthEnabled() } }));
    } catch (_) { /* Client ggf. getrennt */ }
  }
  // Große-Datei-Markierung gegen den (ggf. geänderten) Schwellwert neu bewerten
  reevaluateOversized();
  rState.trashAutoCleanupHours = newConfig.trashAutoCleanupHours || 48;
  console.log('⚙️  Config aktualisiert und angewendet');
}

// --- HTTP + WebSocket ---
const stylePath = path.join(__dirname, 'public', 'style.css');
const styleDefaultPath = path.join(__dirname, 'public', 'style.default.css');

const router = createRouter({ applyConfigChanges, activeWatchersRef, stylePath, styleDefaultPath });
const server = http.createServer(router);
const wss = new WebSocketServer({ server });

// WebSocket Init
wss.on('connection', (ws, req) => {
  try {
  // Auth-Check für WebSocket
  const { getEffectiveSession } = require('./server/sessionMiddleware');
  const session = getEffectiveSession(req);
  if (!session) {
    ws.close(4401, 'Nicht angemeldet');
    return;
  }
  ws.username = session.username;
  ws.role = session.role;
  ws.visibleLabels = getVisibleLabels(session.username, session.role);

  clients.add(ws);
  const pkg = require('./package.json');

  // Fehler-Daten nach sichtbaren Labels filtern
  const allErrors = getAllErrors();
  const filteredErrors = filterByLabels(allErrors, ws.visibleLabels);
  // Analyse-Daten per-user (nicht nach visibleLabels filtern)
  const analyzeData = getAnalyzeErrors(session.username);
  const au = getOrCreateAnalyzeUser(session.username);
  const trashData = getTrashSnapshot();
  const filteredTrash = filterTrashByLabels(trashData, ws.visibleLabels);

  ws.send(JSON.stringify({
    type: 'init',
    data: filteredErrors,
    oversizedFiles: filterOversizedByLabels(getOversizedFiles(), ws.visibleLabels),
    maxLogFileSizeMB: config.maxLogFileSizeMB,
    authEnabled: configStore.isAuthEnabled(),
    analyzeData: analyzeData,
    analyzeRunning: au.running,
    analyzeUser: session.username,
    version: pkg.version,
    pausedSources: [...pausedLabels].filter(l => !ws.visibleLabels || ws.visibleLabels.includes(l)),
    emailDisabledSources: [...emailDisabledLabels].filter(l => !ws.visibleLabels || ws.visibleLabels.includes(l)),
    emailConfigured: emailConfiguredForUser(session.username, ws.visibleLabels),
    nextEmailSendTime: getNextEmailSendTime(),
    trashData: filteredTrash,
    healthCheckLastResult: healthCheck.getState().lastResult,
    visibleLabels: ws.visibleLabels
  }));
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
  } catch (err) {
    console.error('⚠️  WS-Connection-Fehler:', err.message, err.stack);
    logCrash('WS-Connection-Fehler', err);
    try { clients.delete(ws); } catch (_) {}
  }
});

// Hilfsfunktionen: Fehler nach sichtbaren Labels filtern
function filterByLabels(errors, visibleLabels) {
  if (!visibleLabels) return errors; // null = alle
  const filtered = {};
  for (const [filePath, data] of Object.entries(errors)) {
    if (data.label && visibleLabels.includes(data.label)) {
      filtered[filePath] = data;
    }
  }
  return filtered;
}

function filterOversizedByLabels(oversized, visibleLabels) {
  if (!visibleLabels) return oversized; // null = alle
  const filtered = {};
  for (const [filePath, info] of Object.entries(oversized)) {
    if (info.label && visibleLabels.includes(info.label)) {
      filtered[filePath] = info;
    }
  }
  return filtered;
}

// emailConfigured pro User: E-Mail-Empfänger liegen per-User in users/<name>/config.json,
// nicht in der globalen config.js — daher aus den Subscriptions des verbundenen Users ableiten.
function emailConfiguredForUser(username, visibleLabels) {
  if (!username) return [];
  const merged = mergeConfigForUser(JSON.parse(JSON.stringify(config)), username);
  return (merged.watchPaths || [])
    .filter(wp => typeof wp === 'object' && wp.emailTo && wp.emailTo.length > 0)
    .map(wp => wp.label)
    .filter(l => !visibleLabels || visibleLabels.includes(l));
}

function filterTrashByLabels(trashData, visibleLabels) {
  if (!visibleLabels) return trashData;
  const filtered = { ...trashData };
  if (filtered.trashGroups) {
    filtered.trashGroups = filtered.trashGroups.filter(g => visibleLabels.includes(g.label));
    filtered.trashTotalCount = filtered.trashGroups.reduce((sum, g) => sum + (g.count || 0), 0);
  }
  return filtered;
}

// --- Start ---

// Graceful shutdown bei SIGINT/SIGTERM
function shutdown() {
  console.log('\nBeende Monitor...');
  backupService.stopScheduler();
  activeWatchersRef.current.forEach(w => w.close());
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Crash-Protection: Server am Leben halten bei unbehandelten Fehlern
const crashLogPath = path.join(__dirname, 'crash.log');
function logCrash(type, err) {
  const ts = new Date().toISOString();
  const msg = `[${ts}] ${type}: ${err && err.message || err}\n${err && err.stack || ''}\n\n`;
  console.error(`⚠️  ${type} (Server läuft weiter):`, err && err.message || err);
  if (err && err.stack) console.error(err.stack);
  try { fs.appendFileSync(crashLogPath, msg, 'utf8'); } catch (_) {}
}
process.on('uncaughtException', (err) => logCrash('Unbehandelte Exception', err));
process.on('unhandledRejection', (reason) => logCrash('Unbehandelte Promise-Rejection', reason));
process.on('exit', (code) => {
  if (code !== 0) {
    logCrash('Process Exit', { message: `Exit-Code: ${code}`, stack: new Error().stack });
  }
});

// Port prüfen und ggf. alten Prozess beenden
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`⚠️  Port ${config.port} ist belegt. Versuche alten Prozess zu beenden...`);
    // ABHÖREN (DE) oder LISTENING (EN)
    exec(`netstat -ano | findstr :${config.port}`, (findErr, stdout) => {
      if (findErr || !stdout.trim()) {
        console.error(`❌ Konnte Port ${config.port} nicht freigeben. Bitte manuell beenden.`);
        process.exit(1);
        return;
      }
      // Nur Zeilen mit LISTENING/ABHÖREN (Server-Sockets)
      const listenLines = stdout.trim().split('\n').filter(l => /LISTENING|ABH/i.test(l));
      const pids = [...new Set(listenLines.map(l => l.trim().split(/\s+/).pop()).filter(p => p && p !== '0'))];
      if (pids.length === 0) {
        console.error(`❌ Konnte Port ${config.port} nicht freigeben. Bitte manuell beenden.`);
        process.exit(1);
        return;
      }
      const killCmd = pids.map(p => `taskkill /F /PID ${p}`).join(' & ');
      exec(killCmd, (killErr) => {
        if (killErr) {
          console.error(`❌ Konnte Port ${config.port} nicht freigeben. Bitte manuell beenden.`);
          process.exit(1);
        }
        console.log(`✅ Alter Prozess beendet. Starte neu...`);
        setTimeout(() => startServer(), 1500);
      });
    });
  } else {
    console.error('Server-Fehler:', err);
    process.exit(1);
  }
});

wss.on('error', () => {}); // WSS-Fehler werden über server.on('error') behandelt

function startServer() {
  server.listen(config.port, '127.0.0.1', () => {
    const url = `http://localhost:${config.port}`;
    console.log(`╔══════════════════════════════════════════════╗`);
    console.log(`║  Keasy Log Monitor läuft                    ║`);
    console.log(`║  Dashboard: ${url}            ║`);
    console.log(`╚══════════════════════════════════════════════╝`);
    console.log('');

    activeWatchersRef.current = startWatching();

    // Backup-Scheduler starten + verpasste Backups nachholen
    backupService.scheduleBackup();
    backupService.checkMissedBackup();

    // Papierkorb Auto-Cleanup (alle 10 Minuten)
    setInterval(() => {
      if (rState.trashLocked || rState.trashAutoCleanupHours === 0) return;
      rState.trashLocked = true;
      try {
        const cutoff = new Date(Date.now() - rState.trashAutoCleanupHours * 60 * 60 * 1000).toISOString();
        let removedCount = 0;
        for (const [label, source] of trashStore) {
          const before = source.batches.length;
          source.batches = source.batches.filter(b => {
            if (b.deletedAt < cutoff) {
              for (const entries of b.files.values()) removedCount += entries.length;
              return false;
            }
            return true;
          });
          if (source.batches.length === 0) trashStore.delete(label);
        }
        if (removedCount > 0) {
          console.log(`🗑️ Trash-Cleanup: ${removedCount} Einträge älter als ${rState.trashAutoCleanupHours}h entfernt`);
          broadcastTrash();
        }
      } finally { rState.trashLocked = false; }
    }, 10 * 60 * 1000);

    if (config.autoOpen) {
      import('open').then(open => open.default(url)).catch(() => {
        console.log(`Browser manuell öffnen: ${url}`);
      });
    }
  });
}

// CSS-Default sichern (nur beim ersten Start)
if (!fs.existsSync(styleDefaultPath)) {
  try {
    fs.copyFileSync(stylePath, styleDefaultPath);
    console.log('[CSS] style.default.css als Sicherungskopie erstellt');
  } catch (err) {
    console.error('[CSS] Fehler beim Erstellen der Sicherungskopie:', err.message);
  }
}

// Users initialisieren + Migration + Server starten
const userConfigStore = require('./server/userConfigStore');
userStore.ensureDefaultAdmin().then(() => {
  // Migration: emailTo/Copilot/Analyze aus globaler Config → Admin User-Config
  userConfigStore.migrateEmailToFromGlobal('admin', config);

  // Default-Config für bestehende User ohne Config erstellen
  const users = userStore.listUsers();
  for (const u of users) {
    if (!userConfigStore.getUserConfig(u.username)) {
      userConfigStore.createDefaultUserConfig(u.username, config);
      console.log(`[UserConfig] Default-Config für "${u.username}" erstellt`);
    }
  }

  startServer();
}).catch(err => {
  console.error('❌ Fehler bei User-Initialisierung:', err);
  process.exit(1);
});
