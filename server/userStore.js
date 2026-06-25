/**
 * Keasy Log Monitor — User Store
 * Benutzerverwaltung mit bcryptjs und atomischem Schreiben.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const usersPath = path.join(__dirname, '..', 'users.json');
const SALT_ROUNDS = 10;

let _users = [];

// --- Laden / Initialisieren ---

function loadUsers() {
  if (!fs.existsSync(usersPath)) {
    _users = [];
    return;
  }
  try {
    const raw = fs.readFileSync(usersPath, 'utf8');
    _users = JSON.parse(raw);
    if (!Array.isArray(_users)) {
      console.error('[UserStore] users.json ist kein Array — wird zurückgesetzt');
      _users = [];
    }
  } catch (err) {
    console.error('[UserStore] Fehler beim Laden von users.json:', err.message);
    _users = [];
  }
}

async function ensureDefaultAdmin() {
  loadUsers();
  if (!_users.some(u => u.role === 'admin')) {
    console.log('[UserStore] Kein Admin vorhanden — erstelle Default-Admin (admin/admin)');
    await createUser('admin', 'admin', 'admin');
    console.log('⚠️  Standard-Admin erstellt: admin / admin — Bitte Passwort ändern!');
  }
}

// --- Atomisches Schreiben ---

function writeUsers() {
  const tmpPath = usersPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(_users, null, 2), 'utf8');
  fs.renameSync(tmpPath, usersPath);
}

// --- CRUD ---

function getUser(username) {
  return _users.find(u => u.username === username) || null;
}

function listUsers() {
  return _users.map(u => ({ username: u.username, role: u.role, createdAt: u.createdAt }));
}

async function createUser(username, password, role = 'user') {
  if (_users.find(u => u.username === username)) {
    throw new Error(`Benutzer "${username}" existiert bereits`);
  }
  if (!username || username.length < 2) {
    throw new Error('Benutzername muss mindestens 2 Zeichen lang sein');
  }
  if (!password || password.length < 3) {
    throw new Error('Passwort muss mindestens 3 Zeichen lang sein');
  }
  if (!['admin', 'user'].includes(role)) {
    throw new Error('Ungültige Rolle (erlaubt: admin, user)');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const user = {
    username,
    passwordHash,
    role,
    createdAt: new Date().toISOString()
  };
  _users.push(user);
  writeUsers();

  // Default User-Config erstellen
  try {
    const userConfigStore = require('./userConfigStore');
    const { config } = require('./configStore');
    userConfigStore.createDefaultUserConfig(username, config);
    console.log(`[UserStore] Default-Config für "${username}" erstellt`);
  } catch (err) {
    console.error(`[UserStore] Fehler beim Erstellen der Default-Config für "${username}":`, err.message);
  }

  return { username: user.username, role: user.role };
}

async function updateUser(username, updates) {
  const user = getUser(username);
  if (!user) throw new Error(`Benutzer "${username}" nicht gefunden`);

  if (updates.role && ['admin', 'user'].includes(updates.role)) {
    user.role = updates.role;
  }
  if (updates.password) {
    if (updates.password.length < 3) throw new Error('Passwort muss mindestens 3 Zeichen lang sein');
    user.passwordHash = await bcrypt.hash(updates.password, SALT_ROUNDS);
  }

  writeUsers();
  return { username: user.username, role: user.role };
}

function deleteUser(username) {
  const idx = _users.findIndex(u => u.username === username);
  if (idx === -1) throw new Error(`Benutzer "${username}" nicht gefunden`);
  _users.splice(idx, 1);
  writeUsers();
}

async function verifyPassword(username, password) {
  const user = getUser(username);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? { username: user.username, role: user.role } : null;
}

module.exports = { ensureDefaultAdmin, getUser, listUsers, createUser, updateUser, deleteUser, verifyPassword };
