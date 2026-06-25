(a) Umfang

Bitte umsetzen:

✓ Kern (A–J)
✓ R1 – ensureDefaultAdmin() auf "mindestens ein Admin vorhanden" umstellen
✓ R2 – Users-Tab defensiv verlassen
✓ R3 – Logout bei auth-off per Reload absichern
✓ R4 – getrennte Smoke-Test-Läufe (auth-on/auth-off) inkl. ENV-Override

R2 ist zwar nicht kritisch, aber sehr günstig umzusetzen und erhöht die Robustheit der UI.

(b) Header bei auth-off

Bitte komplett ausblenden:

✓ Benutzername ausblenden
✓ Rollen-Badge ausblenden
✓ Logout-Button ausblenden

Begründung:
Im auth-off-Modus gibt es konzeptionell keinen angemeldeten Benutzer. Der implizite Admin dient nur der technischen Kompatibilität (bestehende admin-Konfiguration, E-Mail-Abos usw.). Die Oberfläche soll sich in diesem Modus wie eine klassische Einzelbenutzer-Anwendung verhalten:

- kein Login
- kein sichtbares Benutzerkonzept
- kein Logout
- kein Benutzer-Tab
- alle Funktionen verfügbar

Das ergibt die konsistenteste UX und vermeidet Fragen wie "Warum bin ich als Admin angemeldet, obwohl ich mich nie eingeloggt habe?".