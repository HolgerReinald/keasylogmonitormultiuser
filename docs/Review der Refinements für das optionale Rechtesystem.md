# Review der Refinements für das optionale Rechtesystem

## Priorisierung

| Refinement                              | Priorität | Einschätzung                                                          |
| --------------------------------------- | --------- | --------------------------------------------------------------------- |
| R1 – `ensureDefaultAdmin()` härten      | Hoch      | Verhindert Lockout beim Aktivieren des Rechtesystems                  |
| R2 – Users-Tab aktiv verlassen          | Niedrig   | Defensiv sinnvoll, aber kein kritischer Fehlerfall                    |
| R3 – Logout defensiv absichern          | Mittel    | Sauberes Verhalten im Auth-Off-Modus                                  |
| R4 – Smoke-Tests für beide Betriebsmodi | Hoch      | Verhindert Regressionen beim Umschalten zwischen Auth-On und Auth-Off |

---

## R1 – `ensureDefaultAdmin()` vereinfachen und härten

### Problem

Aktuell wird der Standard-Admin nur angelegt, wenn überhaupt keine Benutzer existieren.

Dadurch kann folgende Situation entstehen:

1. Es existieren Benutzer.
2. Alle Benutzer mit Rolle `admin` wurden gelöscht.
3. Das Rechtesystem wird aktiviert.
4. Niemand besitzt mehr Admin-Rechte.

Ergebnis: Administrativer Lockout.

### Empfehlung

`ensureDefaultAdmin()` sollte ausschließlich prüfen, ob mindestens ein Admin existiert.

```js
function ensureDefaultAdmin() {
    const hasAdmin = _users.some(u => u.role === 'admin');

    if (!hasAdmin) {
        createUser('admin', 'admin', 'admin');
        log('Default admin created');
    }
}
```

### Vorteile

* Idempotent
* Eine zentrale Implementierung
* Verhindert Lockout zuverlässig
* Kann sowohl beim Startup als auch beim Wechsel `authEnabled=false → true` verwendet werden

---

## R2 – Users-Tab defensiv verlassen

### Problem

Beim Deaktivieren des Rechtesystems wird der Benutzer-Tab ausgeblendet.

Falls dieser Tab gerade aktiv ist und der automatische Reload verzögert oder fehlschlägt, kann die Oberfläche in einem inkonsistenten Zustand verbleiben.

### Empfehlung

Vor dem Ausblenden prüfen, ob der Tab aktiv ist, und gegebenenfalls auf einen sichtbaren Tab wechseln.

```js
if (state.authEnabled === false) {
    const usersTab = document.getElementById('tab-users');

    if (usersTab?.classList.contains('active')) {
        switchConfigTab('general');
    }

    usersTab.style.display = 'none';
}
```

### Bewertung

Defensive Absicherung, aber nicht kritisch, da normalerweise ohnehin ein Reload erfolgt.

---

## R3 – Logout im Auth-Off-Modus absichern

### Problem

Im deaktivierten Rechtesystem existiert keine echte Session.

Ein Logout-Request hat daher keine funktionale Bedeutung.

### Empfehlung

Im Auth-Off-Modus direkt einen Reload durchführen.

```js
async function doLogout() {
    if (state.authEnabled === false) {
        window.location.reload();
        return;
    }

    // bestehender Logout-Code
}
```

### Vorteile

* Konsistentes Verhalten
* Keine unnötigen API-Aufrufe
* Auch bei manipuliertem DOM sauberer Zustand

---

## R4 – Smoke-Tests für beide Betriebsmodi

### Problem

Die bestehende Smoke-Suite läuft aktuell nur mit deaktiviertem Rechtesystem.

Dadurch werden Änderungen am Auth-System im aktivierten Modus nicht automatisch geprüft.

### Empfehlung

Zwei dedizierte Testläufe einführen:

```text
Smoke OFF
Smoke ON
```

### Testlauf 1 – Auth deaktiviert

```text
authEnabled=false
```

Prüfen:

* `/api/auth/me` → 200
* Rolle = admin
* `authEnabled=false`
* Geschützte APIs erreichbar
* WebSocket-Verbindung ohne Session möglich

### Testlauf 2 – Auth aktiviert

```text
authEnabled=true
```

Prüfen:

* `/api/auth/me` → 401
* `/api/config` → 401
* `/api/users` → 401
* WebSocket ohne Session wird geschlossen (4401)

### Warum keine adaptive Lösung?

Ein adaptiver Test prüft immer nur den aktuell gestarteten Modus.

Dadurch bleibt ein kompletter Betriebsmodus ungetestet.

Zwei explizite Testläufe liefern deutlich bessere Regressionserkennung und machen die beiden unterstützten Betriebsarten sichtbar.

---

## Gesamtfazit

### Sollte umgesetzt werden

* R1 – Admin-Härtung
* R4 – Getrennte Smoke-Tests für Auth-On und Auth-Off

### Sinnvoll, aber nicht kritisch

* R3 – Logout absichern

### Optional

* R2 – Users-Tab defensiv verlassen

Die größten langfristigen Risiken werden durch R1 (Lockout-Vermeidung) und R4 (Regressionserkennung) adressiert. Diese beiden Punkte sollten unabhängig vom restlichen Umfang umgesetzt werden.
