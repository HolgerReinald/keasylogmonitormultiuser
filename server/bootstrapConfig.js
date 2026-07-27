/**
 * Keasy Log Monitor — Config-Bootstrap
 * In einem ausgelieferten Weitergabe-Paket fehlt config.js (nur config.default.js liegt bei).
 * Diese Funktion kopiert sie beim ersten Start einmalig, BEVOR irgendein Modul require('../config')
 * aufruft. Muss daher als allererstes in server.js laufen (mehrere Module laden config direkt).
 */

const fs = require('fs');
const path = require('path');

module.exports = function ensureConfig() {
  const configPath = path.join(__dirname, '..', 'config.js');
  const defaultPath = path.join(__dirname, '..', 'config.default.js');
  if (!fs.existsSync(configPath) && fs.existsSync(defaultPath)) {
    try {
      fs.copyFileSync(defaultPath, configPath);
      console.log('ℹ️  config.js aus config.default.js erzeugt (Erstinstallation).');
    } catch (err) {
      console.error('⚠️  Konnte config.js nicht aus config.default.js erzeugen:', err.message);
    }
  }
};
