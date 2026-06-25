/**
 * Keasy Log Monitor — Auth-ON Smoke-Test
 * Prüft die Härtung bei AKTIVEM Rechtesystem: ohne Session-Cookie → 401 / WS-Close 4401.
 *
 * Server in diesem Modus starten (eigener Lauf, getrennt vom Auth-OFF-Lauf):
 *   KEASY_AUTH=on node server.js
 * Dann:
 *   node test/smoke-auth-on.js [port]
 *
 * Keine Dependencies außer ws (wie smoke.js).
 */

const http = require('http');
const WebSocket = require('ws');

const PORT = parseInt(process.argv[2]) || 3848;

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: 'localhost', port: PORT, path }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function run() {
  console.log(`\n🔐 Keasy Auth-ON Smoke-Test (Port: ${PORT})`);
  console.log('═'.repeat(50));

  try {
    // HTTP: geschützte Routen ohne Session → 401
    const me = await get('/api/auth/me');
    assert(me.status === 401, 'GET /api/auth/me ohne Session → 401');
    if (me.status === 200) {
      console.error('  ⚠️  Server läuft offenbar mit DEAKTIVIERTEM Rechtesystem — diesen Test mit "KEASY_AUTH=on node server.js" starten.');
    }
    const config = await get('/api/config');
    assert(config.status === 401, 'GET /api/config ohne Session → 401');
    const users = await get('/api/users');
    assert(users.status === 401, 'GET /api/users ohne Session → 401');

    // WebSocket ohne Cookie → Close 4401, kein init
    await new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${PORT}`);
      let gotInit = false;
      const timeout = setTimeout(() => {
        assert(false, 'WS ohne Session wird geschlossen (Timeout — kein Close empfangen)');
        try { ws.close(); } catch {}
        resolve();
      }, 5000);
      ws.on('message', (d) => { try { if (JSON.parse(d).type === 'init') gotInit = true; } catch {} });
      ws.on('close', (code) => {
        clearTimeout(timeout);
        assert(!gotInit && code === 4401, `WS ohne Session geschlossen mit Code 4401 (Code: ${code}, init empfangen: ${gotInit})`);
        resolve();
      });
      ws.on('error', () => { /* Close folgt */ });
    });
  } catch (err) {
    console.error(`\n💥 Unerwarteter Fehler: ${err.message || err}`);
    failed++;
  }

  console.log('\n' + '═'.repeat(50));
  console.log(`Ergebnis: ${passed} bestanden, ${failed} fehlgeschlagen`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
