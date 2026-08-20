/**
 * Keasy Log Monitor — Ablage für per Drag & Drop übergebene Log-Dateien
 *
 * Warum es diese Ablage überhaupt gibt: ein Browser gibt beim Ablegen einer
 * Datei Name, Größe und Inhalt heraus, aber NICHT den Pfad. Die Analyse arbeitet
 * dagegen pfadbasiert (fs.statSync/createReadStream). Der Inhalt wird deshalb
 * hochgeladen, hier abgelegt, und die Analyse zeigt anschließend auf dieses
 * Verzeichnis — die gesamte bestehende Auswertung bleibt unverändert.
 *
 * Nebengewinn im Mehrbenutzerbetrieb: wer das Dashboard von einem anderen
 * Rechner öffnet, konnte bisher nur Pfade analysieren, die der SERVER sieht.
 * Über die Ablage analysiert er seine eigenen lokalen Dateien.
 *
 * Je Benutzer ein Unterverzeichnis, damit sich zwei Anwender nicht ins Gehege
 * kommen und "alles löschen" niemandem sonst etwas wegnimmt.
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const ROOT = path.join(__dirname, '..', 'temp-analyze');

// Erlaubte Endungen. .zip wird nach dem Hochladen entpackt und selbst verworfen.
const ALLOWED = ['.log', '.json', '.zip'];
const ANALYZABLE = ['.log', '.json'];

// Ältere Ablagen beim Serverstart wegräumen (dieselbe Idee wie beim Papierkorb):
// niemand erinnert sich morgen daran, was er gestern hineingezogen hat.
const MAX_AGE_HOURS = 24;

function userDir(username) {
  // Benutzernamen kommen aus der Sitzung, werden hier aber trotzdem auf
  // harmlose Zeichen reduziert — ein Verzeichnisname ist kein Ort für
  // Vertrauensfragen.
  const safe = String(username || 'anonym').replace(/[^\w.-]/g, '_').slice(0, 64) || 'anonym';
  return path.join(ROOT, safe);
}

/**
 * Dateinamen aus einem Client-Header in einen sicheren Basename verwandeln.
 * Gibt null zurück, wenn nichts Brauchbares übrig bleibt oder die Endung nicht
 * erlaubt ist. Pfadanteile werden verworfen, nicht ersetzt: ein Name wie
 * "..\\..\\config.js" hat keine gültige Endung und fällt ohnehin durch, aber
 * der Basename-Schritt macht die Absicht unmissverständlich.
 */
function safeName(raw) {
  if (!raw) return null;
  let name;
  try {
    name = decodeURIComponent(String(raw));
  } catch {
    name = String(raw);
  }
  name = path.basename(name.replace(/\\/g, '/')).trim();
  name = name.replace(/[\x00-\x1f<>:"|?*]/g, '_');
  if (!name || name === '.' || name === '..') return null;
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED.includes(ext)) return null;
  // Kürzen unter Erhalt der Endung: würde stumpf auf 180 Zeichen geschnitten,
  // verlöre ein sehr langer Name sein ".log" — die Datei läge danach in der
  // Ablage, würde aber von list() und der Analyse nicht mehr als Log erkannt.
  if (name.length > 180) {
    name = path.basename(name, path.extname(name)).slice(0, 180 - ext.length) + ext;
  }
  return name;
}

// Gleichnamige Datei nicht überschreiben — zwei Quellen liefern gern
// "app.log", und die zweite soll die erste nicht stillschweigend ersetzen.
function uniqueTarget(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = name;
  let n = 2;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base} (${n})${ext}`;
    n++;
    if (n > 999) break;
  }
  return path.join(dir, candidate);
}

function ensureDir(username) {
  const dir = userDir(username);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * ZIP entpacken: nur analysierbare Einträge, flach ins Zielverzeichnis.
 * Verzeichnisstruktur wird bewusst verworfen — sie ist für die Auswertung
 * bedeutungslos und wäre der Weg, auf dem ein Eintrag wie "../../x.log"
 * ausbrechen könnte. Die Namen laufen durch dieselbe Prüfung wie Uploads.
 */
function extractZip(zipPath, dir) {
  const added = [];
  const skipped = [];
  let zip;
  try {
    zip = new AdmZip(zipPath);
  } catch (err) {
    return { added, skipped: [{ name: path.basename(zipPath), reason: 'Kein lesbares ZIP' }] };
  }
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = safeName(path.basename(entry.entryName));
    if (!name || !ANALYZABLE.includes(path.extname(name).toLowerCase())) {
      skipped.push({ name: entry.entryName, reason: 'Keine .log/.json-Datei' });
      continue;
    }
    try {
      const target = uniqueTarget(dir, name);
      fs.writeFileSync(target, entry.getData());
      added.push({ name: path.basename(target), size: fs.statSync(target).size });
    } catch (err) {
      skipped.push({ name: entry.entryName, reason: err.message });
    }
  }
  return { added, skipped };
}

function list(username) {
  const dir = userDir(username);
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isFile() && ANALYZABLE.includes(path.extname(e.name).toLowerCase()))
      .map(e => {
        const st = fs.statSync(path.join(dir, e.name));
        return { name: e.name, size: st.size, added: st.mtime.toISOString() };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  } catch {
    return [];
  }
}

function remove(username, rawName) {
  const name = safeName(rawName);
  if (!name) return false;
  const dir = userDir(username);
  const target = path.join(dir, name);
  // Nach dem Basename-Schritt kann das nicht mehr ausbrechen — geprüft wird
  // trotzdem, weil die Zusage hier "löscht ausschließlich in der Ablage" ist.
  if (path.dirname(target) !== dir) return false;
  try {
    fs.unlinkSync(target);
    return true;
  } catch {
    return false;
  }
}

function clear(username) {
  const dir = userDir(username);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* nicht vorhanden ist auch in Ordnung */ }
}

// Beim Serverstart: Ablagen wegräumen, die älter als MAX_AGE_HOURS sind.
function sweep() {
  if (!fs.existsSync(ROOT)) return 0;
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600 * 1000;
  let removed = 0;
  try {
    for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(ROOT, entry.name);
      try {
        const files = fs.readdirSync(dir).map(f => fs.statSync(path.join(dir, f)).mtimeMs);
        const newest = files.length ? Math.max(...files) : 0;
        if (newest < cutoff) { fs.rmSync(dir, { recursive: true, force: true }); removed++; }
      } catch { /* einzelnes Verzeichnis überspringen */ }
    }
  } catch { /* Wurzel nicht lesbar */ }
  return removed;
}

module.exports = { ROOT, ALLOWED, ANALYZABLE, userDir, ensureDir, safeName, uniqueTarget, extractZip, list, remove, clear, sweep };
