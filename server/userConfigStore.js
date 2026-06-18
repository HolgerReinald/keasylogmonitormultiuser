/**
 * Keasy Log Monitor — User Config Store
 * Per-User Konfiguration: emailTo-Subscriptions, Copilot-Pfade, Analyze-Pfade.
 */

const fs = require('fs');
const path = require('path');

const usersDir = path.join(__dirname, '..', 'users');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function configPath(username) {
  return path.join(usersDir, username, 'config.json');
}

// --- Lesen ---

function getUserConfig(username) {
  const p = configPath(username);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.error(`[UserConfig] Fehler beim Lesen von ${p}:`, err.message);
    return null;
  }
}

// --- Schreiben (atomar) ---

function saveUserConfig(username, cfg) {
  const dir = path.join(usersDir, username);
  ensureDir(dir);
  const p = configPath(username);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

// --- Erstellen (Default für neuen User) ---

function createDefaultUserConfig(username, globalConfig) {
  const subscriptions = {};
  if (globalConfig.watchPaths) {
    for (const wp of globalConfig.watchPaths) {
      const label = typeof wp === 'string' ? wp : wp.label;
      if (label) subscriptions[label] = { emailTo: '' };
    }
  }

  const cfg = {
    subscriptions,
    visibleLabels: null, // null = alle Pfade sichtbar (Default)
    copilotWorkingPathDevelop: globalConfig.copilotWorkingPathDevelop || '',
    copilotWorkingPathRelease: globalConfig.copilotWorkingPathRelease || '',
    analyzePaths: globalConfig.analyzePaths ? [...globalConfig.analyzePaths] : [],
    analyzeMaxErrors: globalConfig.analyzeMaxErrors || 100
  };

  saveUserConfig(username, cfg);
  return cfg;
}

// --- Migration: emailTo aus globaler config → Admin User-Config ---

function migrateEmailToFromGlobal(adminUsername, globalConfig) {
  let userCfg = getUserConfig(adminUsername);
  if (userCfg) return false; // Bereits migriert

  const subscriptions = {};
  let hasEmailTo = false;

  if (globalConfig.watchPaths) {
    for (const wp of globalConfig.watchPaths) {
      if (typeof wp === 'object' && wp.label) {
        const emailTo = wp.emailTo || '';
        subscriptions[wp.label] = { emailTo: Array.isArray(emailTo) ? emailTo.join(', ') : emailTo };
        if (emailTo && emailTo.length > 0) hasEmailTo = true;
      }
    }
  }

  const cfg = {
    subscriptions,
    copilotWorkingPathDevelop: globalConfig.copilotWorkingPathDevelop || '',
    copilotWorkingPathRelease: globalConfig.copilotWorkingPathRelease || '',
    analyzePaths: globalConfig.analyzePaths ? [...globalConfig.analyzePaths] : [],
    analyzeMaxErrors: globalConfig.analyzeMaxErrors || 100
  };

  saveUserConfig(adminUsername, cfg);
  if (hasEmailTo) {
    console.log(`[UserConfig] Migration: emailTo-Werte für "${adminUsername}" aus globaler Config übernommen`);
  }
  return true;
}

// --- Merge: Global + User → Frontend-kompatible Config ---

function mergeConfigForUser(globalConfig, username) {
  const userCfg = getUserConfig(username);
  const merged = JSON.parse(JSON.stringify(globalConfig));

  if (!userCfg) return merged;

  // emailTo aus User-Subscriptions in watchPaths injizieren
  if (merged.watchPaths && userCfg.subscriptions) {
    for (const wp of merged.watchPaths) {
      if (typeof wp === 'object' && wp.label && userCfg.subscriptions[wp.label]) {
        wp.emailTo = userCfg.subscriptions[wp.label].emailTo || '';
      }
    }
  }

  // Copilot-Pfade aus User-Config
  if (userCfg.copilotWorkingPathDevelop !== undefined) {
    merged.copilotWorkingPathDevelop = userCfg.copilotWorkingPathDevelop;
  }
  if (userCfg.copilotWorkingPathRelease !== undefined) {
    merged.copilotWorkingPathRelease = userCfg.copilotWorkingPathRelease;
  }

  // Analyze-Pfade aus User-Config
  if (userCfg.analyzePaths !== undefined) {
    merged.analyzePaths = userCfg.analyzePaths;
  }
  if (userCfg.analyzeMaxErrors !== undefined) {
    merged.analyzeMaxErrors = userCfg.analyzeMaxErrors;
  }

  return merged;
}

// --- Split: POST-Config → Global + User-Felder trennen ---

function extractUserFields(postedConfig) {
  const userFields = {
    subscriptions: {},
    copilotWorkingPathDevelop: postedConfig.copilotWorkingPathDevelop || '',
    copilotWorkingPathRelease: postedConfig.copilotWorkingPathRelease || '',
    analyzePaths: postedConfig.analyzePaths || [],
    analyzeMaxErrors: postedConfig.analyzeMaxErrors || 100
  };

  // emailTo aus watchPaths extrahieren
  if (postedConfig.watchPaths) {
    for (const wp of postedConfig.watchPaths) {
      if (typeof wp === 'object' && wp.label) {
        userFields.subscriptions[wp.label] = {
          emailTo: wp.emailTo || ''
        };
      }
    }
  }

  return userFields;
}

function stripUserFieldsFromGlobal(postedConfig) {
  const global = JSON.parse(JSON.stringify(postedConfig));

  // emailTo aus watchPaths entfernen (wird per-User gespeichert)
  if (global.watchPaths) {
    for (const wp of global.watchPaths) {
      if (typeof wp === 'object') {
        delete wp.emailTo;
      }
    }
  }

  // User-spezifische Felder entfernen
  delete global.copilotWorkingPathDevelop;
  delete global.copilotWorkingPathRelease;
  delete global.analyzePaths;
  delete global.analyzeMaxErrors;

  return global;
}

// --- Sichtbare Labels für einen User ermitteln ---

function getVisibleLabels(username, role) {
  // Admin sieht immer alles
  if (role === 'admin') return null; // null = alle

  const cfg = getUserConfig(username);
  if (!cfg || cfg.visibleLabels === undefined || cfg.visibleLabels === null) return null; // null = alle
  return cfg.visibleLabels; // Array (kann leer sein)
}

function canAccessLabel(session, label) {
  if (!session) return false;
  if (session.role === 'admin') return true;
  const visible = getVisibleLabels(session.username, session.role);
  if (visible === null) return true; // null = alle
  return visible.includes(label);
}

// --- Alle User-Subscriptions aggregieren (für Email-Service) ---

function getAllEmailSubscriptions() {
  ensureDir(usersDir);
  const result = new Map(); // label → [emailTo, ...]

  try {
    const dirs = fs.readdirSync(usersDir, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const cfg = getUserConfig(d.name);
      if (!cfg || !cfg.subscriptions) continue;
      for (const [label, sub] of Object.entries(cfg.subscriptions)) {
        if (!sub.emailTo) continue;
        const emails = typeof sub.emailTo === 'string'
          ? sub.emailTo.split(',').map(e => e.trim()).filter(Boolean)
          : Array.isArray(sub.emailTo) ? sub.emailTo : [];
        if (emails.length === 0) continue;
        if (!result.has(label)) result.set(label, []);
        result.get(label).push(...emails);
      }
    }
  } catch (err) {
    console.error('[UserConfig] Fehler beim Lesen der Subscriptions:', err.message);
  }

  // Deduplizieren
  for (const [label, emails] of result) {
    result.set(label, [...new Set(emails)]);
  }

  return result;
}

module.exports = {
  getUserConfig,
  saveUserConfig,
  createDefaultUserConfig,
  migrateEmailToFromGlobal,
  mergeConfigForUser,
  extractUserFields,
  stripUserFieldsFromGlobal,
  getAllEmailSubscriptions,
  getVisibleLabels,
  canAccessLabel
};
