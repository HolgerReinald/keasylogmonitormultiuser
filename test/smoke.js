/**
 * Keasy Log Monitor — Smoke Tests (Auth-OFF-Lauf)
 * Blackbox-Tests gegen den laufenden Server.
 * Keine Dependencies — nur Node.js built-ins (+ ws).
 *
 * Diese Suite erwartet ein DEAKTIVIERTES Rechtesystem (impliziter Admin, kein Login).
 * Server entsprechend starten:
 *   KEASY_AUTH=off node server.js
 * Dann:
 *   node test/smoke.js [port]
 *
 * Den Auth-ON-Betriebsmodus deckt test/smoke-auth-on.js ab (eigener Lauf).
 */

const http = require('http');
const WebSocket = require('ws');

const PORT = parseInt(process.argv[2]) || 3847;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ ${msg}`);
  }
}

function fetch(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function parseJSON(body) {
  try { return JSON.parse(body); } catch { return null; }
}

async function testHTTP() {
  console.log('\n📡 HTTP-Tests:');

  // Startseite
  const index = await fetch('/');
  assert(index.status === 200, 'GET / → 200');
  assert(index.body.includes('Keasy Log Monitor'), 'Startseite enthält Titel');

  // Static files
  const css = await fetch('/style.css');
  assert(css.status === 200, 'GET /style.css → 200');

  const js = await fetch('/js/boot.js');
  assert(js.status === 200, 'GET /js/boot.js → 200');
}

async function testAPI() {
  console.log('\n🔌 API-Tests:');

  // /api/config
  const config = await fetch('/api/config');
  assert(config.status === 200, 'GET /api/config → 200');
  const cfg = parseJSON(config.body);
  assert(cfg && typeof cfg.port === 'number', '/api/config liefert port als Number');
  assert(cfg && Array.isArray(cfg.watchPaths), '/api/config liefert watchPaths als Array');
  assert(cfg && Array.isArray(cfg.filterPatterns), '/api/config liefert filterPatterns als Array');

  // /api/errors
  const errors = await fetch('/api/errors');
  assert(errors.status === 200, 'GET /api/errors → 200');
  const errData = parseJSON(errors.body);
  assert(errData && typeof errData === 'object', '/api/errors liefert Objekt');

  // /api/trash
  const trash = await fetch('/api/trash');
  assert(trash.status === 200, 'GET /api/trash → 200');
  const trashData = parseJSON(trash.body);
  assert(trashData && typeof trashData === 'object', '/api/trash liefert Objekt');

  // /api/errors (prüfe nur Status)
  const status = await fetch('/api/errors');
  assert(status.status === 200, 'GET /api/errors wiederholt → 200');
}

async function testConfigSaveReload() {
  console.log('\n💾 Config Save/Reload-Test:');

  // Aktuelle Config laden
  const before = await fetch('/api/config');
  const cfg = parseJSON(before.body);
  assert(cfg !== null, 'Config laden erfolgreich');

  // Speichern (gleiche Werte zurückschreiben)
  const save = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  assert(save.status === 200, 'POST /api/config → 200');

  // Erneut laden und vergleichen
  const after = await fetch('/api/config');
  const cfg2 = parseJSON(after.body);
  assert(cfg2 && cfg2.port === cfg.port, 'Config-Port nach Save unverändert');
  assert(cfg2 && cfg2.maxErrorsPerFile === cfg.maxErrorsPerFile, 'maxErrorsPerFile nach Save unverändert');
}

async function testWatcherRestart() {
  console.log('\n🔄 Watcher-Restart-Test:');

  const res = await fetch('/api/restart-watcher', { method: 'POST' });
  assert(res.status === 200, 'POST /api/restart-watcher → 200');
  const data = parseJSON(res.body);
  assert(data && data.ok === true, 'Watcher-Restart liefert ok: true');
}

async function testAnalyze() {
  console.log('\n📂 Analyse-Tests:');

  // Cancel (sollte immer funktionieren, auch ohne laufende Analyse)
  const cancel = await fetch('/api/analyze-cancel', { method: 'POST' });
  assert(cancel.status === 200, 'POST /api/analyze-cancel → 200');
}

async function testClearAll() {
  console.log('\n🗑️ Clear-All-Test:');

  const res = await fetch('/api/clear-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert(res.status === 200, 'POST /api/clear-all → 200');
}

async function testBackup() {
  console.log('\n🗄️ Backup-Tests:');

  // Status-Endpoint
  const status = await fetch('/api/backup/status');
  assert(status.status === 200, 'GET /api/backup/status → 200');
  const statusData = parseJSON(status.body);
  assert(statusData && typeof statusData === 'object', '/api/backup/status liefert Objekt');

  // List-Endpoint
  const list = await fetch('/api/backup/list');
  assert(list.status === 200, 'GET /api/backup/list → 200');
  const listData = parseJSON(list.body);
  assert(listData && Array.isArray(listData.backups), '/api/backup/list liefert backups-Array');
  assert(listData && Array.isArray(listData.targets), '/api/backup/list liefert targets-Array');

  // Test-Connection (lokal, ohne konfigurierten Pfad → Fehler erwartet)
  const testLocal = await fetch('/api/backup/test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'loc_nonexistent' }),
  });
  assert(testLocal.status === 200, 'POST /api/backup/test-connection (local) → 200');
  const testLocalData = parseJSON(testLocal.body);
  assert(testLocalData && testLocalData.ok === false, 'test-connection ohne gültiges Ziel → ok: false');

  // Test-Connection (FTP — Ergebnis hängt von Config ab)
  const testFtp = await fetch('/api/backup/test-connection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'ftp' }),
  });
  assert(testFtp.status === 200, 'POST /api/backup/test-connection (ftp) → 200');
  const testFtpData = parseJSON(testFtp.body);
  assert(testFtpData && typeof testFtpData.ok === 'boolean', 'test-connection (ftp) liefert ok-Boolean');

  // Run-Backup (Ergebnis hängt von Config ab)
  const run = await fetch('/api/backup/run', { method: 'POST' });
  assert(run.status === 200, 'POST /api/backup/run → 200');
  const runData = parseJSON(run.body);
  assert(runData && typeof runData.ok === 'boolean', 'backup/run liefert ok-Boolean');

  // Preview (ungültiger Dateiname → Fehler erwartet)
  const preview = await fetch('/api/backup/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'local', filename: 'keasy-backup-test.zip' }),
  });
  assert(preview.status === 500, 'POST /api/backup/preview mit ungültigem Backup → 500');

  // Config enthält Backup-Sektion
  const config = await fetch('/api/config');
  const cfg = parseJSON(config.body);
  assert(cfg && cfg.backup && typeof cfg.backup === 'object', '/api/config enthält backup-Sektion');
  assert(cfg && cfg.backup && cfg.backup.ftp && typeof cfg.backup.ftp === 'object', 'Config enthält FTP-Sektion');
  assert(cfg && cfg.backup && Array.isArray(cfg.backup.locals), 'Config enthält locals-Array');

  // FTP-Passwort ist maskiert (wenn gesetzt)
  if (cfg && cfg.backup && cfg.backup.ftp && cfg.backup.ftp._hasPassword) {
    assert(cfg.backup.ftp.pass === '••••••••', 'FTP-Passwort ist maskiert');
  } else {
    assert(true, 'FTP-Passwort nicht gesetzt (kein Masking nötig)');
  }
}

async function testBackupWithFixture() {
  console.log('\n📦 Backup Fixture-Test (lokales Backup erstellen + auflisten):');

  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  // Temp-Verzeichnis als Backup-Ziel
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keasy-backup-test-'));
  const statusPath = path.join(__dirname, '..', 'backup-status.json');

  // Vor try deklarieren, damit das finally die Config zuverlässig zurücksetzen kann
  const testLocalId = 'loc_smoke_test';
  let cfg = null;
  let origLocals = [];
  let origIncludeFull;

  try {
    // Config mit temporärem lokalen Backup-Pfad speichern
    const configResp = await fetch('/api/config');
    cfg = parseJSON(configResp.body);
    // Eventuelle Reste eines früheren (abgebrochenen) Smoke-Tests herausfiltern
    origLocals = JSON.parse(JSON.stringify(cfg.backup?.locals || [])).filter(l => l.id !== testLocalId);
    cfg.backup = cfg.backup || {};
    cfg.backup.locals = [{ id: testLocalId, enabled: true, label: 'Smoke-Test', path: tmpDir }];
    cfg.backup.ftp = cfg.backup.ftp || {};
    cfg.backup.ftp.enabled = false;
    origIncludeFull = cfg.backup.includeFullBackup;
    cfg.backup.includeFullBackup = true; // Komplett-Backup im Fixture-Test mitprüfen

    const save = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    assert(save.status === 200, 'Config mit Temp-Backup-Pfad gespeichert');

    // Verbindungstest
    const test = await fetch('/api/backup/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'local:' + testLocalId }),
    });
    const testData = parseJSON(test.body);
    assert(testData && testData.ok === true, 'test-connection (local) mit Temp-Pfad → ok: true');

    // Backup ausführen
    const run = await fetch('/api/backup/run', { method: 'POST' });
    const runData = parseJSON(run.body);
    assert(runData && runData.ok === true, 'backup/run mit Temp-Pfad → ok: true');

    // ZIP-Datei existiert?
    const zipFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.zip'));
    assert(zipFiles.length > 0, 'ZIP-Datei im Backup-Verzeichnis erstellt');

    // Komplett-Backup: keasy-full-*.zip muss zusätzlich erstellt worden sein
    const fullZips = zipFiles.filter(f => f.startsWith('keasy-full-'));
    assert(fullZips.length === 1, 'Komplett-Backup (keasy-full-*.zip) erstellt');
    if (fullZips.length === 1) {
      const fullStat = fs.statSync(path.join(tmpDir, fullZips[0]));
      assert(fullStat.size > 100000, `Komplett-Backup ist plausibel groß (${Math.round(fullStat.size / 1024)} KB)`);

      // Restore-Preview auf Komplett-Backup muss abgelehnt werden
      const fullPreview = await fetch('/api/backup/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'local', sourceId: testLocalId, filename: fullZips[0] }),
      });
      assert(fullPreview.status !== 200, 'Preview auf Komplett-Backup wird abgelehnt (kein UI-Restore)');
    }

    // Backup-Liste enthält das neue Backup
    const list = await fetch('/api/backup/list');
    const listData = parseJSON(list.body);
    const backups = listData && listData.backups ? listData.backups : [];
    assert(backups.length > 0, 'backup/list enthält mindestens 1 Backup');
    assert(backups.some(b => b.type === 'full'), 'backup/list enthält Komplett-Backup (type=full)');

    if (backups.length > 0) {
      const newest = backups.find(b => b.type !== 'full') || backups[0]; // neuestes Settings-Backup (Preview gilt nur für diese)
      assert(newest.source === 'local', 'Neuestes Backup Quelle = local');
      assert(newest.size > 0, 'Neuestes Backup Größe > 0');
      assert(newest.content && newest.content.files, 'Neuestes Backup enthält Inhaltsbeschreibung');

      // Preview testen
      const preview = await fetch('/api/backup/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: newest.source, sourceId: newest.sourceId, filename: newest.filename }),
      });
      assert(preview.status === 200, 'POST /api/backup/preview → 200');
      const previewData = parseJSON(preview.body);
      assert(previewData && Array.isArray(previewData.files), 'Preview liefert files-Array');
      assert(previewData && previewData.files.includes('config.json'), 'Preview enthält config.json');
      assert(previewData && previewData.files.includes('style.css'), 'Preview enthält style.css');
      assert(previewData && previewData.manifest, 'Preview enthält Manifest');
      assert(previewData && previewData.manifest && previewData.manifest.schemaVersion === 1, 'Manifest schemaVersion = 1');
      assert(previewData && Array.isArray(previewData.overwrites), 'Preview enthält overwrites-Liste');
    }

    // Status nach Backup
    const status = await fetch('/api/backup/status');
    const statusData = parseJSON(status.body);
    assert(statusData && statusData.lastRun !== null, 'Status lastRun ist gesetzt nach Backup');
    const hasLocalResult = statusData && statusData.results && Object.values(statusData.results).some(r => r.status === 'ok');
    assert(hasLocalResult, 'Status enthält mindestens ein ok-Ergebnis');

  } finally {
    // Config zurücksetzen (Original-locals wiederherstellen) — auch bei
    // fehlgeschlagenen Asserts/Fehlern, damit kein veralteter Temp-Pfad zurückbleibt
    if (cfg) {
      try {
        cfg.backup = cfg.backup || {};
        cfg.backup.locals = origLocals;
        if (origIncludeFull === undefined) delete cfg.backup.includeFullBackup;
        else cfg.backup.includeFullBackup = origIncludeFull;
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cfg),
        });
      } catch { /* Server evtl. nicht erreichbar — Cleanup best effort */ }
    }

    // Smoke-Test-Einträge aus backup-status.json entfernen
    try {
      if (fs.existsSync(statusPath)) {
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
        let dirty = false;
        for (const key of [testLocalId, `full:${testLocalId}`]) {
          if (status.results && status.results[key]) {
            delete status.results[key];
            dirty = true;
          }
        }
        if (dirty) fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf8');
      }
    } catch { /* ignore cleanup errors */ }

    // Temp-Verzeichnis aufräumen
    try {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) fs.unlinkSync(path.join(tmpDir, f));
      fs.rmdirSync(tmpDir);
    } catch { /* ignore cleanup errors */ }
  }
}

async function testWatchPathReachability() {
  console.log('\n📡 WatchPath-Erreichbarkeits-Test (Warnung + Auto-Recovery):');

  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keasy-reach-test-'));
  const testLabel = 'ReachSmokeTest';
  let cfg = null;
  let origWatchPaths = null;
  let ws = null;

  // Auf eine WS-Nachricht warten, die das Prädikat erfüllt (null bei Timeout)
  function waitFor(wsConn, predicate, timeoutMs) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { wsConn.off('message', handler); resolve(null); }, timeoutMs);
      const handler = (data) => {
        try {
          const msg = JSON.parse(data);
          if (predicate(msg)) { clearTimeout(t); wsConn.off('message', handler); resolve(msg); }
        } catch { /* ignore */ }
      };
      wsConn.on('message', handler);
    });
  }

  const fmtLogTs = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${String(d.getFullYear()).slice(-2)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  };

  try {
    const configResp = await fetch('/api/config');
    cfg = parseJSON(configResp.body);
    origWatchPaths = JSON.parse(JSON.stringify(cfg.watchPaths || [])).filter(wp => wp.label !== testLabel);
    cfg.watchPaths = [...origWatchPaths, { path: tmpDir, label: testLabel, usePolling: true }];
    const save = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    assert(save.status === 200, 'Config mit Erreichbarkeits-Test-Watchpath gespeichert');

    // WS verbinden — init muss watchPathStatus enthalten
    ws = new WebSocket(`ws://localhost:${PORT}`);
    const init = await waitFor(ws, m => m.type === 'init', 10000);
    assert(init !== null && Array.isArray(init.watchPathStatus), 'init enthält watchPathStatus-Array');

    // 1. Verzeichnis entfernen → Warnung (reachable=false) muss kommen
    fs.rmSync(tmpDir, { recursive: true, force: true });
    const lost = await waitFor(ws, m =>
      m.type === 'watchpath-status' && (m.data.paths || []).some(p => p.label === testLabel && p.reachable === false), 30000);
    assert(lost !== null, 'watchpath-status mit reachable=false nach Entfernen des Pfads');

    // 2. Verzeichnis wiederherstellen → reachable=true + Auto-Recovery
    fs.mkdirSync(tmpDir, { recursive: true });
    const back = await waitFor(ws, m =>
      m.type === 'watchpath-status' && (m.data.paths || []).some(p => p.label === testLabel && p.reachable === true), 30000);
    assert(back !== null, 'watchpath-status mit reachable=true nach Wiederherstellen');

    // Nachweis Auto-Recovery: neue Fehlerzeile im wiederhergestellten Pfad muss wieder ankommen
    // (zweistufig: anlegen löst nur 'add' aus, verarbeitet wird erst das folgende 'change')
    const logFile = path.join(tmpDir, 'reach-test.log');
    fs.writeFileSync(logFile, `${fmtLogTs(new Date())}  INFO  Datei angelegt\n`);
    await new Promise(r => setTimeout(r, 4000));
    const errorPromise = waitFor(ws, m => m.type === 'error' && m.data && m.data.label === testLabel, 30000);
    fs.appendFileSync(logFile, `${fmtLogTs(new Date())}  ERROR  Exception nach Auto-Recovery\n`);
    const errMsg = await errorPromise;
    assert(errMsg !== null, 'Auto-Recovery: Fehler im wiederhergestellten Pfad wird wieder erkannt');
  } finally {
    if (ws) { try { ws.close(); } catch { /* ignore */ } }
    // Cleanup mit frischer Config (nicht mit dem alten Snapshot — der könnte
    // zwischenzeitliche Änderungen überschreiben) und Verifikation: ein
    // zurückgebliebener Watchpath auf ein gelöschtes Temp-Verzeichnis lässt
    // chokidar das Elternverzeichnis (%TEMP%) pollen → Event-Loop-Blockade.
    let cleanupOk = false;
    for (let attempt = 0; attempt < 3 && !cleanupOk; attempt++) {
      try {
        const fresh = parseJSON((await fetch('/api/config')).body);
        fresh.watchPaths = (fresh.watchPaths || []).filter(wp => wp.label !== testLabel);
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fresh),
        });
        const check = parseJSON((await fetch('/api/config')).body);
        cleanupOk = check && !(check.watchPaths || []).some(wp => wp.label === testLabel);
      } catch { /* Server ggf. kurz beschäftigt — erneut versuchen */ }
      if (!cleanupOk) await new Promise(r => setTimeout(r, 2000));
    }
    assert(cleanupOk, 'Cleanup: Test-Watchpath aus der Config entfernt (verifiziert)');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function testDocsEditor() {
  console.log('\n📝 Doku-Editor-Tests:');

  const fs = require('fs');
  const path = require('path');
  const readmePath = path.join(__dirname, '..', 'README.md');
  const bakPath = readmePath + '.bak';

  // Quelltext laden
  const raw = await fetch('/api/docs/raw');
  assert(raw.status === 200, 'GET /api/docs/raw → 200');
  assert(raw.body.includes('# Keasy Log Monitor'), 'Raw-Markdown enthält Titel');
  assert(raw.body.includes('## Historie'), 'Raw-Markdown enthält Historie-Abschnitt');

  // Live-Vorschau rendert Markdown
  const preview = await fetch('/api/docs/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ md: '# Vorschau-Test\n\n- Punkt 1' }),
  });
  assert(preview.status === 200, 'POST /api/docs/preview → 200');
  assert(preview.body.includes('Vorschau-Test'), 'Vorschau enthält gerenderten Titel');

  // Schutz: zu kurzer Inhalt wird abgelehnt
  const tooShort = await fetch('/api/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ md: 'zu kurz' }),
  });
  assert(tooShort.status === 400, 'Speichern mit zu kurzem Inhalt → 400');

  // Schutz: fehlender Historie-Abschnitt wird abgelehnt
  const noHistory = await fetch('/api/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ md: '# Doku ohne Historie\n\n' + 'x'.repeat(200) }),
  });
  assert(noHistory.status === 400, "Speichern ohne '## Historie' → 400");

  // Roundtrip: identischen Inhalt speichern → 200, Backup entsteht, Datei unverändert
  const save = await fetch('/api/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ md: raw.body }),
  });
  assert(save.status === 200, 'Roundtrip-Speichern (identischer Inhalt) → 200');
  assert(fs.existsSync(bakPath), 'README.md.bak wurde angelegt');
  const afterSave = fs.readFileSync(readmePath, 'utf8');
  assert(afterSave === raw.body, 'README.md nach Roundtrip inhaltlich unverändert');
}

function testWebSocket() {
  return new Promise((resolve) => {
    console.log('\n🌐 WebSocket-Test:');

    const ws = new WebSocket(`ws://localhost:${PORT}`);
    let initReceived = false;
    const timeout = setTimeout(() => {
      assert(false, 'WebSocket init-Event innerhalb 5s empfangen');
      ws.close();
      resolve();
    }, 5000);

    ws.on('message', (data) => {
      if (initReceived) return;
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'init') {
          initReceived = true;
          clearTimeout(timeout);
          assert(true, 'WebSocket init-Event empfangen');
          assert(typeof msg.data === 'object', 'init enthält data-Objekt');
          assert(typeof msg.version === 'string', 'init enthält version-String');
          assert(typeof msg.performanceData === 'object', 'init enthält performanceData-Objekt');
          ws.close();
          resolve();
        }
      } catch { /* ignore non-JSON */ }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      assert(false, `WebSocket Verbindung (${err.message})`);
      resolve();
    });
  });
}

async function testStaticFileSecurity() {
  console.log('\n🔒 Static-File-Sicherheitstests:');

  // Path Traversal mit ../
  const traversal1 = await fetch('/../config.js');
  assert(traversal1.status === 403 || traversal1.status === 404, 'GET /../config.js → 403/404 (Path Traversal blockiert)');

  // Path Traversal mit encoded ../
  const traversal2 = await fetch('/%2e%2e/config.js');
  assert(traversal2.status === 403 || traversal2.status === 404, 'GET /%2e%2e/config.js → 403/404 (encoded Path Traversal blockiert)');

  // Path Traversal mit doppeltem ../
  const traversal3 = await fetch('/../../package.js');
  assert(traversal3.status === 403 || traversal3.status === 404, 'GET /../../package.js → 403/404 (doppelter Path Traversal blockiert)');

  // Nicht existierende Datei
  const notFound = await fetch('/nonexistent.js');
  assert(notFound.status === 404, 'GET /nonexistent.js → 404');

  // Valide Datei funktioniert weiterhin
  const valid = await fetch('/js/state.js');
  assert(valid.status === 200, 'GET /js/state.js → 200 (valide Datei funktioniert)');
}

async function testBackupDeleteSecurity() {
  console.log('\n🔒 Backup-Delete-Sicherheitstests:');

  // Ohne Dateiname
  const noFile = await fetch('/api/backup/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert(noFile.status === 400, 'DELETE ohne filename → 400');

  // Path Traversal im Dateinamen
  const traversal = await fetch('/api/backup/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: '../../../config.js', source: 'local' }),
  });
  assert(traversal.status === 400, 'DELETE mit Path Traversal → 400');

  // Ungültiges Dateinamensformat
  const invalidName = await fetch('/api/backup/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'evil-file.zip', source: 'local' }),
  });
  assert(invalidName.status === 400, 'DELETE mit ungültigem Dateiname → 400');
}

async function testOpenFileEndpoints() {
  console.log('\n📂 Open-File-Endpoint-Tests:');

  // open-folder ohne filePath
  const noPath1 = await fetch('/api/open-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert(noPath1.status === 400, 'POST /api/open-folder ohne filePath → 400');

  // open-file ohne filePath
  const noPath2 = await fetch('/api/open-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert(noPath2.status === 400, 'POST /api/open-file ohne filePath → 400');

  // open-file-at-line ohne filePath
  const noPath3 = await fetch('/api/open-file-at-line', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert(noPath3.status === 400, 'POST /api/open-file-at-line ohne filePath → 400');
}

async function testUnknownRoutes() {
  console.log('\n❓ Unbekannte Routen:');

  const unknown = await fetch('/api/nonexistent');
  assert(unknown.status === 404, 'GET /api/nonexistent → 404');

  const unknownPost = await fetch('/api/nonexistent', { method: 'POST' });
  assert(unknownPost.status === 404, 'POST /api/nonexistent → 404');

  // Malformed URL (decodeURIComponent-Schutz)
  const malformed = await fetch('/%ZZ.js');
  assert(malformed.status === 400 || malformed.status === 404, 'GET /%ZZ.js → 400/404 (malformed URL abgefangen)');
}

async function testThresholdRules() {
  console.log('\n📊 Schwellwert-Regeln-Tests:');

  // 1. Config laden und prüfen ob thresholdRules existiert
  const before = await fetch('/api/config');
  const cfg = parseJSON(before.body);
  assert(cfg && Array.isArray(cfg.thresholdRules), 'Config enthält thresholdRules Array');

  // 2. Originale Regeln sichern (deep copy)
  const origRules = JSON.parse(JSON.stringify(cfg.thresholdRules));

  try {
    // 3. Testregel setzen und speichern
    cfg.thresholdRules = [
      { name: 'TestRule', contains: 'WorkingSet:', before: 'MB', operator: '>', value: 1000 }
    ];
    const save = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    assert(save.status === 200, 'Schwellwert-Testregel speichern → 200');

    // 4. Config neu laden und Regel prüfen
    const after = await fetch('/api/config');
    const cfg2 = parseJSON(after.body);
    assert(cfg2 && cfg2.thresholdRules.length === 1, 'Testregel gespeichert (1 Regel)');
    assert(cfg2 && cfg2.thresholdRules[0].name === 'TestRule', 'Regelname korrekt');
    assert(cfg2 && cfg2.thresholdRules[0].contains === 'WorkingSet:', 'contains korrekt');
    assert(cfg2 && cfg2.thresholdRules[0].operator === '>', 'operator korrekt');
    assert(cfg2 && cfg2.thresholdRules[0].value === 1000, 'value korrekt');

    // 5. Leere Regeln speichern
    cfg.thresholdRules = [];
    const saveEmpty = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    assert(saveEmpty.status === 200, 'Leere thresholdRules speichern → 200');
    const afterEmpty = await fetch('/api/config');
    const cfg3 = parseJSON(afterEmpty.body);
    assert(cfg3 && cfg3.thresholdRules.length === 0, 'Leere Regeln gespeichert');

  } finally {
    // 6. Originale Regeln wiederherstellen
    cfg.thresholdRules = origRules;
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
  }
}

async function testGapConfigRoundtrip() {
  console.log('\n⏱️ Gap-Config-Roundtrip-Test:');

  const before = await fetch('/api/config');
  const cfg = parseJSON(before.body);
  assert(cfg && Array.isArray(cfg.watchPaths) && cfg.watchPaths.length > 0, 'Config enthält watchPaths');
  if (!cfg || !cfg.watchPaths || cfg.watchPaths.length === 0) return;

  const origWatchPaths = JSON.parse(JSON.stringify(cfg.watchPaths));
  const origAnalyzeWarn = cfg.analyzeGapWarnSeconds;
  const origAnalyzeIdle = cfg.analyzeGapIdleMinutes;

  try {
    // Gap-Felder am ersten WatchPath + Analyse-Gap-Felder setzen
    cfg.watchPaths[0].gapWarnSeconds = 20;
    cfg.watchPaths[0].gapIdleMinutes = 30;
    cfg.analyzeGapWarnSeconds = 15;
    cfg.analyzeGapIdleMinutes = 45;
    const save = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    assert(save.status === 200, 'Config mit Gap-Feldern speichern → 200');

    const after = await fetch('/api/config');
    const cfg2 = parseJSON(after.body);
    assert(cfg2 && cfg2.watchPaths[0].gapWarnSeconds === 20, 'gapWarnSeconds Roundtrip (20)');
    assert(cfg2 && cfg2.watchPaths[0].gapIdleMinutes === 30, 'gapIdleMinutes Roundtrip (30)');
    assert(cfg2 && cfg2.analyzeGapWarnSeconds === 15, 'analyzeGapWarnSeconds Roundtrip (15)');
    assert(cfg2 && cfg2.analyzeGapIdleMinutes === 45, 'analyzeGapIdleMinutes Roundtrip (45)');
  } finally {
    cfg.watchPaths = origWatchPaths;
    if (origAnalyzeWarn === undefined) delete cfg.analyzeGapWarnSeconds; else cfg.analyzeGapWarnSeconds = origAnalyzeWarn;
    if (origAnalyzeIdle === undefined) delete cfg.analyzeGapIdleMinutes; else cfg.analyzeGapIdleMinutes = origAnalyzeIdle;
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
  }
}

async function testPerformanceGap() {
  console.log('\n⏱️ Performance-Lücken-Test (Live-Erkennung):');

  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keasy-gap-test-'));
  const testLabel = 'GapSmokeTest';
  let cfg = null;
  let origWatchPaths = null;
  let ws = null;

  // Timestamp im Keasy-Log-Format: DD.MM.YY HH:MM:SS.mmm
  const fmtLogTs = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${String(d.getFullYear()).slice(-2)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  };

  try {
    const configResp = await fetch('/api/config');
    cfg = parseJSON(configResp.body);
    origWatchPaths = JSON.parse(JSON.stringify(cfg.watchPaths || [])).filter(wp => wp.label !== testLabel);
    cfg.watchPaths = [...origWatchPaths, { path: tmpDir, label: testLabel, usePolling: true, gapWarnSeconds: 5, gapIdleMinutes: 30 }];
    const save = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    });
    assert(save.status === 200, 'Config mit Gap-Test-Watchpath gespeichert (Watcher-Restart)');

    // WS verbinden, Log-Datei in zwei Schritten schreiben, auf performance-Event warten
    const perfEvent = await new Promise((resolve) => {
      ws = new WebSocket(`ws://localhost:${PORT}`);
      const timeout = setTimeout(() => resolve(null), 15000);
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'performance' && msg.data && msg.data.label === testLabel) {
            clearTimeout(timeout);
            resolve(msg.data);
          }
        } catch { /* ignore non-JSON */ }
      });
      ws.on('open', () => {
        const now = new Date();
        const t1 = new Date(now.getTime() - 10000);
        const logFile = path.join(tmpDir, 'gap-test.log');
        // Schritt 1: Datei anlegen (add-Event), Schritt 2: anhängen (change-Event → Einlesen)
        setTimeout(() => {
          fs.writeFileSync(logFile, `${fmtLogTs(t1)} Vorgang gestartet\n`, 'utf8');
        }, 1500);
        setTimeout(() => {
          fs.appendFileSync(logFile, `${fmtLogTs(now)} Vorgang beendet\n`, 'utf8');
        }, 4000);
      });
      ws.on('error', () => { clearTimeout(timeout); resolve(null); });
    });

    assert(perfEvent !== null, 'performance-Event innerhalb 15s empfangen (Lücke 10s > Schwelle 5s)');
    if (perfEvent) {
      assert(perfEvent.entry && typeof perfEvent.entry.gapSeconds === 'number' && perfEvent.entry.gapSeconds >= 5,
        `gapSeconds >= 5 (${perfEvent.entry && perfEvent.entry.gapSeconds})`);
      assert(perfEvent.entry && typeof perfEvent.entry.prevTimestamp === 'string', 'Eintrag enthält prevTimestamp');
      assert(perfEvent.entry && perfEvent.entry.line.includes('Vorgang beendet'), 'Eintrag enthält erste Zeile des Folge-Eintrags');
    }

    // Clear-Route
    const clearNoLabel = await fetch('/api/performance-clear-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert(clearNoLabel.status === 400, 'performance-clear-source ohne Label → 400');

    const clear = await fetch('/api/performance-clear-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: testLabel }),
    });
    assert(clear.status === 200, 'performance-clear-source mit Label → 200');

  } finally {
    try { if (ws) ws.close(); } catch { /* ignore */ }
    // Config zurücksetzen (Test-Watchpath entfernen) — auch bei Fehlern
    if (cfg && origWatchPaths) {
      try {
        cfg.watchPaths = origWatchPaths;
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cfg),
        });
      } catch { /* Server evtl. nicht erreichbar — Cleanup best effort */ }
    }
    // Temp-Verzeichnis aufräumen
    try {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) fs.unlinkSync(path.join(tmpDir, f));
      fs.rmdirSync(tmpDir);
    } catch { /* ignore cleanup errors */ }
  }
}

async function testAuthOff() {
  console.log('\n🔓 Auth-OFF-Modus-Tests:');

  const me = await fetch('/api/auth/me');
  assert(me.status === 200, 'GET /api/auth/me → 200 (Rechtesystem aus)');
  const meData = parseJSON(me.body);
  assert(meData && meData.user && meData.user.role === 'admin', '/api/auth/me liefert impliziten Admin');
  assert(meData && meData.authEnabled === false, '/api/auth/me meldet authEnabled=false');
  if (!(meData && meData.authEnabled === false)) {
    console.error('  ⚠️  Server läuft offenbar MIT Rechtesystem — diese Suite mit "KEASY_AUTH=off node server.js" starten.');
  }
}

async function run() {
  console.log(`\n🧪 Keasy Log Monitor Smoke-Tests (Port: ${PORT})`);
  console.log('═'.repeat(50));

  try {
    await testHTTP();
    await testAuthOff();
    await testStaticFileSecurity();
    await testAPI();
    await testConfigSaveReload();
    await testWatcherRestart();
    await testAnalyze();
    await testClearAll();
    await testBackup();
    await testBackupWithFixture();
    await testBackupDeleteSecurity();
    await testOpenFileEndpoints();
    await testUnknownRoutes();
    await testThresholdRules();
    await testGapConfigRoundtrip();
    await testPerformanceGap();
    await testWatchPathReachability();
    await testDocsEditor();
    await testWebSocket();
  } catch (err) {
    console.error(`\n💥 Unerwarteter Fehler: ${err.message || err}`);
    if (err.stack) console.error(err.stack);
    failed++;
  }

  console.log('\n' + '═'.repeat(50));
  console.log(`Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
