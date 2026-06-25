/**
 * Keasy Log Monitor — Config Store
 * Zentrale Config-Verwaltung mit Proxy für transparenten Zugriff.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let _config = require('../config');
const configPath = path.join(__dirname, '..', 'config.js');

// ─── ID-Generierung für lokale Backup-Ziele ─────────────────
function generateLocalId() {
  return 'loc_' + crypto.randomBytes(4).toString('hex');
}

// ─── Config-Migration: backup.local → backup.locals ─────────
function migrateBackupLocals(cfg) {
  if (!cfg.backup) return cfg;

  // Bereits migriert?
  if (Array.isArray(cfg.backup.locals)) {
    // Sicherstellen dass alle Einträge eine ID haben
    for (const loc of cfg.backup.locals) {
      if (!loc.id) loc.id = generateLocalId();
    }
    // Legacy-Feld entfernen falls noch vorhanden
    if (cfg.backup.local) delete cfg.backup.local;
    return cfg;
  }

  // Legacy-Format: backup.local (Object) → backup.locals (Array)
  if (cfg.backup.local && typeof cfg.backup.local === 'object') {
    const legacy = cfg.backup.local;
    cfg.backup.locals = [{
      id: generateLocalId(),
      enabled: legacy.enabled || false,
      label: 'Lokales Backup',
      path: legacy.path || ''
    }];
    delete cfg.backup.local;
    return cfg;
  }

  // Kein local und kein locals → leeres Array
  if (!cfg.backup.locals) {
    cfg.backup.locals = [];
  }

  return cfg;
}

// ─── Pfad-Normalisierung + Duplikat-Prüfung ─────────────────
function normalizeBackupLocals(cfg) {
  if (!cfg.backup || !Array.isArray(cfg.backup.locals)) return cfg;

  const seen = new Set();
  for (const loc of cfg.backup.locals) {
    if (!loc.id) loc.id = generateLocalId();
    if (loc.path) {
      const normalized = path.resolve(loc.path).toLowerCase();
      if (seen.has(normalized)) {
        throw new Error(`Doppelter Backup-Pfad: ${loc.path}`);
      }
      seen.add(normalized);
    }
  }
  return cfg;
}

// Initial migrieren
_config = migrateBackupLocals(_config);

// Proxy: damit bestehender Code weiterhin config.port, config.email etc. nutzen kann
const config = new Proxy({}, {
  get: (_, prop) => {
    if (prop === 'toJSON') return () => JSON.parse(JSON.stringify(_config));
    return _config[prop];
  },
  set: (_, prop, val) => { _config[prop] = val; return true; },
  has: (_, prop) => prop in _config,
  ownKeys: () => Reflect.ownKeys(_config),
  getOwnPropertyDescriptor: (_, prop) => {
    if (prop in _config) {
      return { configurable: true, enumerable: true, value: _config[prop], writable: true };
    }
    return undefined;
  },
});

function replaceConfig(newConfig) {
  _config = migrateBackupLocals(newConfig);
}

// Effektiver Auth-Status: ENV-Override (KEASY_AUTH=on|off) für Tests, sonst persistierter Wert.
// Mutiert _config NICHT (config.js bleibt unberührt; die Checkbox zeigt weiterhin den echten Wert).
function isAuthEnabled() {
  const env = process.env.KEASY_AUTH;
  if (env === 'off') return false;
  if (env === 'on') return true;
  return _config.authEnabled !== false; // fehlend ⇒ aktiviert (nicht brechend)
}

function writeConfig(newConfig) {
  // Migration + Validierung
  newConfig = migrateBackupLocals(newConfig);
  normalizeBackupLocals(newConfig);

  // Backup erstellen
  if (fs.existsSync(configPath)) {
    fs.copyFileSync(configPath, configPath + '.bak');
  }
  const configContent = '/**\n * Keasy Log Monitor - Konfiguration\n * Automatisch generiert über Dashboard-Einstellungen\n */\n\nmodule.exports = ' +
    JSON.stringify(newConfig, null, 2) + ';\n';
  fs.writeFileSync(configPath, configContent, 'utf8');
}

module.exports = { config, replaceConfig, writeConfig, configPath, generateLocalId, isAuthEnabled };
