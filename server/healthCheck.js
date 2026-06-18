/**
 * Keasy Log Monitor — Health-Check (read-only)
 * 
 * Führt passive Prüfungen direkt im Server-Prozess aus.
 * Check-Funktionen dürfen NUR lesen: fs.access/readFile, http.get, ws connect+close.
 * Kein Server-State wird verändert.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { config } = require('./configStore');

const TIMEOUT_LOCAL = 5000;
const TIMEOUT_NETWORK = 10000;
const TIMEOUT_GLOBAL = 30000;
const COOLDOWN_MS = 10000;

// Server-State (RAM-only)
let healthCheckState = {
  running: false,
  lastResult: null,
  lastRunTime: null
};

function getState() {
  return { ...healthCheckState };
}

function getCooldownRemaining() {
  if (!healthCheckState.lastRunTime) return 0;
  const elapsed = Date.now() - healthCheckState.lastRunTime;
  return Math.max(0, COOLDOWN_MS - elapsed);
}

// Einzelnen Check mit Timeout ausführen
async function runWithTimeout(fn, timeoutMs) {
  return Promise.race([
    fn(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))
  ]);
}

// HTTP GET Helper
function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${config.port}${urlPath}`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
  });
}

// --- Check-Definitionen ---

function serverHttpChecks() {
  return [
    {
      category: '🖥️ Server & HTTP',
      name: 'HTTP erreichbar',
      timeout: TIMEOUT_LOCAL,
      run: async () => {
        const res = await httpGet('/');
        if (res.status !== 200) throw new Error(`Status ${res.status}`);
      }
    },
    {
      category: '🖥️ Server & HTTP',
      name: 'Statische Dateien verfügbar',
      timeout: TIMEOUT_LOCAL,
      run: async () => {
        const res = await httpGet('/style.css');
        if (res.status !== 200) throw new Error(`style.css: Status ${res.status}`);
        const res2 = await httpGet('/js/boot.js');
        if (res2.status !== 200) throw new Error(`boot.js: Status ${res2.status}`);
      }
    },
    {
      category: '🖥️ Server & HTTP',
      name: 'API erreichbar',
      timeout: TIMEOUT_LOCAL,
      run: async () => {
        const res = await httpGet('/api/errors');
        if (res.status !== 200) throw new Error(`Status ${res.status}`);
      }
    }
  ];
}

function webSocketChecks() {
  return [
    {
      category: '📡 WebSocket',
      name: 'Verbindung möglich',
      timeout: TIMEOUT_LOCAL,
      run: async () => {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${config.port}`);
          ws.on('open', () => { ws.close(); resolve(); });
          ws.on('error', reject);
        });
      }
    },
    {
      category: '📡 WebSocket',
      name: 'Init-Event empfangen',
      timeout: TIMEOUT_LOCAL,
      run: async () => {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${config.port}`);
          ws.on('message', (data) => {
            try {
              const msg = JSON.parse(data);
              if (msg.type === 'init' && msg.version) {
                ws.close();
                resolve();
              } else {
                ws.close();
                reject(new Error('Init-Event ohne Version'));
              }
            } catch (e) { ws.close(); reject(new Error('Ungültiges JSON')); }
          });
          ws.on('error', reject);
        });
      }
    }
  ];
}

function configChecks() {
  const configPath = path.join(__dirname, '..', 'config.js');
  return [
    {
      category: '⚙️ Konfiguration',
      name: 'config.js lesbar',
      timeout: TIMEOUT_LOCAL,
      run: async () => {
        fs.accessSync(configPath, fs.constants.R_OK);
      }
    },
    {
      category: '⚙️ Konfiguration',
      name: 'Pflichtfelder vorhanden',
      timeout: TIMEOUT_LOCAL,
      run: async () => {
        const missing = [];
        if (!config.port) missing.push('port');
        if (!config.watchPaths || !Array.isArray(config.watchPaths)) missing.push('watchPaths');
        if (!config.filterPatterns || !Array.isArray(config.filterPatterns)) missing.push('filterPatterns');
        if (missing.length > 0) throw new Error(`Fehlend: ${missing.join(', ')}`);
      }
    },
    {
      category: '⚙️ Konfiguration',
      name: 'E-Mail-Konfiguration',
      timeout: TIMEOUT_LOCAL,
      run: async () => {
        if (!config.email || !config.email.enabled) {
          return { status: 'skip', message: 'E-Mail deaktiviert' };
        }
        if (!config.email.smtp || !config.email.smtp.host) {
          return { status: 'warn', message: 'SMTP-Host nicht gesetzt' };
        }
      }
    }
  ];
}

function filesystemChecks() {
  const checks = [];

  // WatchPaths
  const watchPaths = config.watchPaths || [];
  for (const wp of watchPaths) {
    const wpPath = typeof wp === 'string' ? wp : wp.path;
    const wpLabel = typeof wp === 'string' ? path.basename(wp) : (wp.label || wp.path);
    const isNetwork = /^[\\\/]{2}|^[A-Z]:\\/i.test(wpPath) && /^[XYZ]:/i.test(wpPath);

    checks.push({
      category: '📂 Dateisystem',
      name: `WatchPath: ${wpLabel}`,
      timeout: isNetwork ? TIMEOUT_NETWORK : TIMEOUT_LOCAL,
      run: async () => {
        fs.accessSync(wpPath, fs.constants.R_OK);
      }
    });
  }

  // Wichtige Dateien
  checks.push({
    category: '📂 Dateisystem',
    name: 'style.css existiert',
    timeout: TIMEOUT_LOCAL,
    run: async () => {
      const p = path.join(__dirname, '..', 'public', 'style.css');
      if (!fs.existsSync(p)) throw new Error('style.css nicht gefunden');
    }
  });

  checks.push({
    category: '📂 Dateisystem',
    name: 'index.html existiert',
    timeout: TIMEOUT_LOCAL,
    run: async () => {
      const p = path.join(__dirname, '..', 'public', 'index.html');
      if (!fs.existsSync(p)) throw new Error('index.html nicht gefunden');
    }
  });

  return checks;
}

function backupChecks() {
  const checks = [];
  const statusPath = path.join(__dirname, '..', 'backup-status.json');

  checks.push({
    category: '🗄️ Backup',
    name: 'backup-status.json',
    timeout: TIMEOUT_LOCAL,
    run: async () => {
      if (!fs.existsSync(statusPath)) {
        return { status: 'skip', message: 'Nicht vorhanden (OK)' };
      }
      const content = fs.readFileSync(statusPath, 'utf8');
      JSON.parse(content); // Validierung
    }
  });

  const locals = (config.backup && config.backup.locals) || [];
  for (const loc of locals) {
    if (loc.enabled && loc.path) {
      checks.push({
        category: '🗄️ Backup',
        name: `Backup-Pfad: ${loc.label || loc.path}`,
        timeout: TIMEOUT_LOCAL,
        run: async () => {
          fs.accessSync(loc.path, fs.constants.R_OK | fs.constants.W_OK);
        }
      });
    }
  }

  return checks;
}

function emailChecks() {
  const emailLogPath = path.join(__dirname, '..', 'email.log');
  return [
    {
      category: '📧 E-Mail',
      name: 'E-Mail-Log',
      timeout: TIMEOUT_LOCAL,
      run: async () => {
        if (!fs.existsSync(emailLogPath)) {
          return { status: 'skip', message: 'Nicht vorhanden (OK)' };
        }
        fs.accessSync(emailLogPath, fs.constants.R_OK);
      }
    }
  ];
}

// --- Haupt-Funktion ---

async function runHealthCheck(onProgress) {
  if (healthCheckState.running) {
    throw new Error('Check läuft bereits');
  }

  const cooldown = getCooldownRemaining();
  if (cooldown > 0) {
    throw new Error(`Cooldown aktiv (${Math.ceil(cooldown / 1000)}s)`);
  }

  healthCheckState.running = true;
  const startTime = Date.now();
  const results = [];

  // Alle Checks sammeln
  const allChecks = [
    ...serverHttpChecks(),
    ...webSocketChecks(),
    ...configChecks(),
    ...filesystemChecks(),
    ...backupChecks(),
    ...emailChecks()
  ];

  try {
    // Checks sequentiell mit globalem Timeout
    await Promise.race([
      (async () => {
        for (const check of allChecks) {
          const checkStart = Date.now();
          let result = { category: check.category, name: check.name };

          try {
            const ret = await runWithTimeout(check.run, check.timeout);
            // Check kann explizit warn/skip zurückgeben
            if (ret && ret.status) {
              result.status = ret.status;
              result.message = ret.message || '';
            } else {
              result.status = 'ok';
            }
          } catch (err) {
            result.status = 'fail';
            result.message = err.message;
          }

          result.duration = Date.now() - checkStart;
          results.push(result);

          // Live-Progress an Client senden + kleine Verzögerung für sichtbares "Eintickern"
          if (onProgress) {
            onProgress(result);
            await new Promise(r => setTimeout(r, 80));
          }
        }
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Globaler Timeout')), TIMEOUT_GLOBAL)
      )
    ]);
  } catch (err) {
    if (err.message === 'Globaler Timeout') {
      // Verbleibende Checks als Timeout markieren
      const done = new Set(results.map(r => r.name));
      for (const check of allChecks) {
        if (!done.has(check.name)) {
          const timeoutResult = {
            category: check.category,
            name: check.name,
            status: 'fail',
            message: 'Globaler Timeout überschritten',
            duration: 0
          };
          results.push(timeoutResult);
          if (onProgress) onProgress(timeoutResult);
        }
      }
    }
  } finally {
    const totalDuration = Date.now() - startTime;
    const summary = {
      checks: results,
      passed: results.filter(r => r.status === 'ok').length,
      failed: results.filter(r => r.status === 'fail').length,
      warned: results.filter(r => r.status === 'warn').length,
      skipped: results.filter(r => r.status === 'skip').length,
      total: results.length,
      duration: totalDuration
    };

    healthCheckState.running = false;
    healthCheckState.lastResult = summary;
    healthCheckState.lastRunTime = Date.now();
  }

  return healthCheckState.lastResult;
}

module.exports = { runHealthCheck, getState, getCooldownRemaining };
