#!/usr/bin/env node
/**
 * update-docs.js — Aktualisiert README-Historie und package.json Version.
 *
 * Usage:
 *   node scripts/update-docs.js "Titel" "- Punkt 1" "- Punkt 2" ...
 *   node scripts/update-docs.js "Titel" --files "datei1.js, datei2.js"
 *
 * Ohne Argumente: interaktiver Modus (fragt nach Titel + Punkten).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const README = path.join(ROOT, 'README.md');
const PKG = path.join(ROOT, 'package.json');

function getTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}-${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function getDateString() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function bumpVersion() {
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf-8'));
  const oldVersion = pkg.version;
  pkg.version = getTimestamp();
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  console.log(`📦 Version: ${oldVersion} → ${pkg.version}`);
  return pkg.version;
}

function addHistoryEntry(title, bullets, files) {
  const readme = fs.readFileSync(README, 'utf-8');
  const marker = '## Historie';
  const idx = readme.indexOf(marker);
  if (idx === -1) {
    console.error('❌ "## Historie" nicht in README.md gefunden!');
    process.exit(1);
  }

  let entry = `### ${getDateString()} — ${title}\n\n`;
  if (bullets.length > 0) {
    entry += bullets.map(b => b.startsWith('- ') ? b : `- ${b}`).join('\n') + '\n';
  }
  if (files) {
    entry += `\n**Dateien:** ${files}\n`;
  }
  entry += '\n';

  const before = readme.substring(0, idx + marker.length);
  const after = readme.substring(idx + marker.length);
  fs.writeFileSync(README, before + '\n\n' + entry + after.trimStart(), 'utf-8');
  console.log(`📝 Historie-Eintrag hinzugefügt: "${title}"`);
}

async function interactiveMode() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(resolve => rl.question(q, resolve));

  const title = await ask('Titel: ');
  if (!title.trim()) { console.log('Abgebrochen.'); rl.close(); return; }

  console.log('Bullet-Points (leer = fertig):');
  const bullets = [];
  while (true) {
    const line = await ask('  - ');
    if (!line.trim()) break;
    bullets.push(line.trim());
  }

  const files = await ask('Geänderte Dateien (optional, Komma-getrennt): ');
  rl.close();

  addHistoryEntry(title.trim(), bullets, files.trim() || null);
  bumpVersion();
  console.log('\n✅ Fertig!');
}

function cliMode() {
  const args = process.argv.slice(2);
  if (args.length === 0) return false;

  const title = args[0];
  let bullets = [];
  let files = null;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--files' && args[i + 1]) {
      files = args[++i];
    } else {
      bullets.push(args[i]);
    }
  }

  addHistoryEntry(title, bullets, files);
  bumpVersion();
  console.log('\n✅ Fertig!');
  return true;
}

if (!cliMode()) {
  interactiveMode();
}
