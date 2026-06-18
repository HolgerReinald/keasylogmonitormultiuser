# Backup-Optimierung — Partielle Erfolge statt Komplett-Abbruch

> **Problem:** Wenn ein Backup-Ziel nicht erreichbar ist, wird das gesamte Backup als fehlgeschlagen angezeigt — obwohl andere Ziele erfolgreich waren.

---

## Analyse des aktuellen Verhaltens

### Backend (`server/backupService.js`, `runBackup()` Zeile 100–165)

Die Verteilung an die Ziele ist **bereits resilient** — jedes Ziel hat eigenes try/catch:

```javascript
// Lokale Ziele — einzeln geschützt ✅
for (const loc of activeLocals) {
  try {
    await saveLocal(zipPath, filename, loc);
    results[loc.id] = { status: 'ok', ... };
  } catch (err) {
    results[loc.id] = { status: 'error', ... };
  }
}
// FTP — einzeln geschützt ✅
if (ftpEnabled) {
  try { ... } catch { ... }
}
```

**Das Problem liegt in Zeile 160–161:**

```javascript
const allOk = Object.values(results).every(r => r.status === 'ok');
return { ok: allOk, results, filename };
//           ^^^^^ false wenn EIN Ziel fehlschlägt!
```

### Frontend (`public/js/backupPanel.js`, `runBackupNow()` Zeile 122–157)

```javascript
if (result.ok) {
  // ✅ Per-Target-Status wird gerendert
  for (const [key, r] of Object.entries(result.results)) {
    parts.push(r.status === 'ok' ? `✅ ${label} OK` : `❌ ${label}: ${r.error}`);
  }
  showToast('Backup erstellt', 'success');
} else {
  // ❌ PROBLEM: Per-Target-Ergebnisse werden ignoriert!
  statusEl.textContent = '❌ ' + (result.message || 'Fehler');
  showToast('Backup fehlgeschlagen', 'error');
}
```

Wenn `ok: false` (weil ein Ziel fehlschlägt), wird in den `else`-Zweig gesprungen — dort gibt es aber kein `result.message` (nur bei "kein Ziel aktiv" oder "läuft bereits"). Resultat: **`❌ Fehler`** ohne weitere Info.

---

## Lösung

### 1. Backend: `server/backupService.js`

**`runBackup()` Return-Logik ändern (Zeile 160–161):**

```javascript
// ALT:
const allOk = Object.values(results).every(r => r.status === 'ok');
return { ok: allOk, results, filename };

// NEU:
const allResults = Object.values(results);
const successCount = allResults.filter(r => r.status === 'ok').length;
const failCount = allResults.filter(r => r.status === 'error').length;
return {
  ok: failCount === 0,          // true NUR wenn ALLE Ziele erfolgreich
  partial: successCount > 0 && failCount > 0,  // true bei Teil-Erfolg
  successCount,
  failCount,
  results,
  filename
};
```

**Bedeutung:**
- `ok: true, partial: false` → Alle Ziele erfolgreich
- `ok: false, partial: true` → Mindestens ein Ziel erfolgreich, andere fehlgeschlagen
- `ok: false, partial: false` → Alle Ziele fehlgeschlagen (oder keins aktiv)

> **Review-Feedback umgesetzt:** `ok` behält die strenge Bedeutung "alle erfolgreich". `partial` zeigt Teil-Erfolge an. `successCount`/`failCount` für UI/Debugging.

### 2. Frontend: `public/js/backupPanel.js`

**`runBackupNow()` — Per-Target-Status immer anzeigen:**

```javascript
// ALT: if (result.ok) { ... per target ... } else { ... nur message ... }

// NEU:
if (result.results) {
  const parts = [];
  for (const [key, r] of Object.entries(result.results)) {
    const label = r.label || (key === 'ftp' ? 'FTP' : key);
    parts.push(r.status === 'ok' ? `✅ ${label} OK` : `❌ ${label}: ${r.error}`);
  }
  statusEl.innerHTML = parts.join(' · ') || (result.ok ? '✅ Backup erstellt' : '❌ Alle Ziele fehlgeschlagen');

  if (result.partial) {
    statusEl.style.color = '#f59e0b'; // Orange/Warnung
    showToast('Backup teilweise erstellt — nicht alle Ziele erreichbar', 'warn');
  } else if (result.ok) {
    statusEl.style.color = '#10b981'; // Grün
    showToast('Backup erstellt: ' + (result.filename || ''), 'success');
  } else {
    statusEl.style.color = '#ef4444'; // Rot
    showToast('Backup fehlgeschlagen — kein Ziel erreichbar', 'error');
  }
  // Status immer aktualisieren, Liste nur bei mindestens 1 Erfolg
  loadBackupStatus();
  if (result.ok || result.partial) {
    Keasy.backup.restore.loadBackupList();
  }
} else {
  statusEl.textContent = '❌ ' + (result.message || 'Fehler');
  statusEl.style.color = '#ef4444';
  showToast('Backup fehlgeschlagen: ' + (result.message || ''), 'error');
}
```

> **Review-Feedback umgesetzt:**
> - `loadBackupStatus()` wird **immer** aufgerufen (auch bei komplettem Fehlschlag), damit die Status-Cards aktuell bleiben
> - `loadBackupList()` nur bei mindestens einem Erfolg (`ok || partial`)

---

## Geänderte Dateien

| # | Datei | Änderung |
|---|-------|----------|
| 1 | `server/backupService.js` | `runBackup()` Return-Logik: `ok` = mindestens 1 Erfolg, `partial` Flag |
| 2 | `public/js/backupPanel.js` | `runBackupNow()`: Per-Target-Status immer anzeigen, 3 Zustände (grün/orange/rot) |

## Nicht betroffen

- **`backupRoutes.js`** — gibt `result` unverändert weiter, keine Änderung nötig
- **`backupTargetsPanel.js`** — nur Config-UI, kein Run-Handling
- **`backupRestorePanel.js`** — nur Restore, kein Run-Handling
- **`createBackup()`** — erstellt ZIP, unabhängig von Zielen
- **`listBackups()`** — bereits resilient (jedes Ziel einzeln mit try/catch)
- **Scheduler** — ruft `runBackup()` auf, profitiert automatisch
- **`loadBackupStatus()`** — liest Status, per-Target-Rendering bereits vorhanden

## Edge Cases

1. **Alle Ziele erfolgreich** → `ok: true, partial: false` → Grüne Anzeige, Success-Toast
2. **Nur FTP fehlgeschlagen** → `ok: false, partial: true` → Orange, Warn-Toast, Backup-Liste + Status aktualisiert
3. **Alle Ziele fehlgeschlagen** → `ok: false, partial: false` → Rote Anzeige, Error-Toast, Status trotzdem aktualisiert (Cards zeigen aktuellen Fehler)
4. **Retry-Logik** (3 Versuche, 15s Delay) bleibt pro Ziel bestehen — erst nach 3 Fehlversuchen wird `error` gesetzt
5. **Scheduler** profitiert automatisch — geplante Backups werden nicht mehr als "fehlgeschlagen" geloggt wenn ein Ziel ausfällt
6. **`createBackup()` schlägt fehl** (vor Ziel-Verteilung) → Route `.catch()` feuert, `{ ok: false, message }` → Frontend else-Zweig greift korrekt

## Review-Ergebnis (Rubber-Duck)

- ✅ Keine blocking Issues
- 🔧 `ok` behält strenge Bedeutung ("alle erfolgreich"), `partial` für Teil-Erfolg — klarer API-Vertrag
- 🔧 `loadBackupStatus()` wird immer aufgerufen, nicht nur bei Erfolg — Status-Cards bleiben aktuell
- 🔧 `successCount`/`failCount` im Response für UI/Debugging
- ℹ️ Scheduler `lastRun` wird auch bei Fehlschlag aktualisiert — bewusst beibehalten (Vermeidung von Retry-Loops)
