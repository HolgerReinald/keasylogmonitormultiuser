/**
 * Keasy Log Monitor — Config Routes
 * config, style, docs, email-log, export-copilot-context, system-check
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const parseJsonBody = require('../parseJsonBody');
const { config } = require('../configStore');
const configStore = require('../configStore');
const { emailLogPath } = require('../emailService');
const { markdownToHtml } = require('../markdownHelper');
const healthCheck = require('../healthCheck');
const userConfigStore = require('../userConfigStore');
const { errorStore, performanceStore } = require('../runtimeStore');
const { getAnalyzeErrors } = require('../analysisService');
const { getLabelForFile } = require('../watchService');
const dropStore = require('../analyzeDropStore');
const toolExport = require('../toolExport');
const setupState = require('../setupState');

// KI-Zielverzeichnis fuer 'develop' | 'release' ermitteln. Die Pfade sind
// PRO BENUTZER konfiguriert (users/<name>/config.json); der Rueckfall auf die
// globale Config ist historisch und praktisch leer, weil
// stripUserFieldsFromGlobal die Felder dort entfernt.
// Rueckgabe: { ok: true, dir, label } oder { ok: false, status, message }.
function resolveCopilotDir(req, target) {
  const targetLabel = target === 'release' ? 'Release' : 'Develop';
  const username = req.session ? req.session.username : null;
  let copilotPath;
  if (username) {
    const userCfg = userConfigStore.getUserConfig(username);
    if (userCfg) {
      copilotPath = target === 'release' ? userCfg.copilotWorkingPathRelease : userCfg.copilotWorkingPathDevelop;
    }
  }
  if (!copilotPath) {
    copilotPath = target === 'release' ? config.copilotWorkingPathRelease : config.copilotWorkingPathDevelop;
  }
  if (!copilotPath) {
    return { ok: false, status: 400, message: `KI-Pfad ${targetLabel} ist nicht konfiguriert`, label: targetLabel };
  }
  const dir = path.resolve(copilotPath);
  try {
    if (!fs.statSync(dir).isDirectory()) {
      return { ok: false, status: 400, message: `Pfad ${targetLabel} ist kein Verzeichnis`, label: targetLabel };
    }
  } catch {
    return { ok: false, status: 400, message: `Pfad ${targetLabel} existiert nicht: ${dir}`, label: targetLabel };
  }
  return { ok: true, dir, label: targetLabel };
}

// Darf diese Datei gelesen werden? Der Einzelfehler-Export schreibt den Pfad
// nur als Text ins Markdown und braucht das nicht — beim Kopieren der Datei
// waere ein ungeprueter Pfad dagegen ein Leseloch (beliebige Datei abholbar).
// Erlaubt ist deshalb nur, was der Server ohnehin kennt und anzeigt.
function isKnownLogFile(filePath, username) {
  const norm = path.resolve(filePath).toLowerCase();
  const hit = (key) => path.resolve(key).toLowerCase() === norm;
  if ([...errorStore.keys()].some(hit)) return true;
  if ([...performanceStore.keys()].some(hit)) return true;
  if (Object.keys(getAnalyzeErrors(username) || {}).some(hit)) return true;
  // Eigene Ablage (Drag & Drop): dort liegen nur selbst abgelegte Dateien.
  const dropDir = path.resolve(dropStore.userDir(username)).toLowerCase();
  if (norm.startsWith(dropDir + path.sep)) return true;
  return false;
}

module.exports = function configRoutes(deps) {
  const { applyConfigChanges, stylePath, styleDefaultPath } = deps;

  return {
    'GET /api/config': (req, res) => {
      // Merge: Global + User-Config basierend auf Session
      const username = req.session ? req.session.username : null;
      let safeConfig;
      if (username) {
        safeConfig = userConfigStore.mergeConfigForUser(JSON.parse(JSON.stringify(config)), username);
      } else {
        safeConfig = JSON.parse(JSON.stringify(config));
      }
      if (safeConfig.email && safeConfig.email.smtp && safeConfig.email.smtp.auth && safeConfig.email.smtp.auth.pass) {
        safeConfig.email.smtp.auth._hasPassword = true;
        safeConfig.email.smtp.auth.pass = '••••••••';
      }
      if (safeConfig.backup && safeConfig.backup.ftp && safeConfig.backup.ftp.pass) {
        safeConfig.backup.ftp._hasPassword = true;
        safeConfig.backup.ftp.pass = '••••••••';
      }
      if (safeConfig.watchPaths) {
        safeConfig.watchPaths = safeConfig.watchPaths.map(wp => {
          const p = typeof wp === 'string' ? wp : wp.path;
          const resolved = path.resolve(p);
          const isNetwork = resolved.startsWith('\\\\') || !!wp._isNetworkDrive || !!wp.usePolling;
          if (typeof wp === 'string') return { path: wp, _isNetworkDrive: isNetwork };
          return { ...wp, _isNetworkDrive: isNetwork };
        });
        // Für Nicht-Admins: nur sichtbare WatchPaths liefern
        if (req.session && req.session.role !== 'admin') {
          const visible = userConfigStore.getVisibleLabels(req.session.username, req.session.role);
          if (visible) {
            safeConfig.watchPaths = safeConfig.watchPaths.filter(wp => {
              const label = typeof wp === 'string' ? wp : wp.label;
              return visible.includes(label);
            });
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(safeConfig));
    },

    // Einen optionalen Einrichtungsschritt als "brauche ich nicht" ablegen --
    // oder das wieder zuruecknehmen. Das gehoert in die Config und nicht in den
    // localStorage: es ist eine Aussage ueber DIESE Installation, nicht ueber
    // diesen Browser. Sonst hakt ein Admin an seinem Rechner ab und der Kollege
    // sieht die Karte von vorn.
    // Admin-Schutz laeuft zentral ueber ADMIN_ONLY_ROUTES in httpRouter.js --
    // kein eigener Check hier, sonst gibt es zwei Wahrheiten.
    'POST /api/setup-dismiss': (req, res) => {
      parseJsonBody(req, (body) => {
        // "Nicht mehr anzeigen" schaltet den Assistenten als Ganzes ab. Eigenes
        // Feld statt alle Punkte abzuhaken: sonst nimmt ein Zurueckholen der
        // Einzelpunkte diese Entscheidung mit zurueck.
        if (body && body.fertig !== undefined) {
          const neuF = { ...config, setupCompleted: !!body.fertig };
          configStore.writeConfig(neuF);
          configStore.replaceConfig(neuF);
          require('../wsBroadcast').broadcastSetupState();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, setupCompleted: !!body.fertig }));
          return;
        }
        const id = body && typeof body.id === 'string' ? body.id : '';
        // Whitelist: der Wert landet in der Config und spaeter im Markup.
        if (!setupState.ABHAKBAR.includes(id)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Unbekannter Schritt' }));
          return;
        }
        const aus = !!(body && body.dismissed);
        const liste = new Set(Array.isArray(config.setupDismissed) ? config.setupDismissed : []);
        if (aus) liste.add(id); else liste.delete(id);

        const neu = { ...config, setupDismissed: [...liste] };
        configStore.writeConfig(neu);
        configStore.replaceConfig(neu);
        // Alle offenen Dashboards nachziehen, nicht nur das eigene
        require('../wsBroadcast').broadcastSetupState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, setupDismissed: [...liste] }));
      });
    },

    'POST /api/config': (req, res) => {
      parseJsonBody(req, (newConfig) => {
        if (!newConfig) { res.writeHead(400); res.end('Ungültige Config'); return; }
        try {
          const session = req.session;
          const isAdmin = session && session.role === 'admin';

          // User-Felder extrahieren und speichern (für alle Benutzer)
          if (session) {
            const userFields = userConfigStore.extractUserFields(newConfig);
            // visibleLabels aus bestehender Config beibehalten
            const existing = userConfigStore.getUserConfig(session.username);
            if (existing && existing.visibleLabels !== undefined) {
              userFields.visibleLabels = existing.visibleLabels;
            }
            userConfigStore.saveUserConfig(session.username, userFields);
          }

          // Globale Config nur für Admins
          if (isAdmin) {
            // Passwort-Maskierung beibehalten
            if (newConfig.email && newConfig.email.smtp && newConfig.email.smtp.auth) {
              if (newConfig.email.smtp.auth.pass === '••••••••' || !newConfig.email.smtp.auth.pass) {
                newConfig.email.smtp.auth.pass = config.email.smtp.auth.pass;
              }
              delete newConfig.email.smtp.auth._hasPassword;
            }
            if (newConfig.backup && newConfig.backup.ftp) {
              if (newConfig.backup.ftp.pass === '••••••••' || !newConfig.backup.ftp.pass) {
                const currentFtpPass = (config.backup && config.backup.ftp) ? config.backup.ftp.pass : '';
                newConfig.backup.ftp.pass = currentFtpPass || '';
              }
              delete newConfig.backup.ftp._hasPassword;
            }

            // Globale Config bereinigen (User-Felder entfernen)
            const globalConfig = userConfigStore.stripUserFieldsFromGlobal(newConfig);

            applyConfigChanges(globalConfig);
            configStore.writeConfig(globalConfig);
          }

          // Der Einrichtungsstand kann sich mit jedem Speichern geaendert haben:
          // erster Watchpath, E-Mail aktiviert, Regeln angepasst, Analyse-Pfade
          // hinterlegt. Ohne das bliebe die Karte stehen und wuerde zu etwas
          // auffordern, das gerade erledigt wurde.
          require('../wsBroadcast').broadcastSetupState();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: 'Config gespeichert und angewendet' }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: err.message }));
        }
      });
    },

    // Tool-Paket exportieren: schlankes, bereinigtes ZIP zur Weitergabe.
    // sections=general,rules,watchPaths,email,backup steuert die
    // eingebackene Start-Config. Admin-only via ADMIN_ONLY_ROUTES.
    'GET /api/export-tool': (req, res) => {
      let sections = [];
      const qIndex = req.url.indexOf('?');
      if (qIndex !== -1) {
        const params = new URLSearchParams(req.url.slice(qIndex + 1));
        const raw = params.get('sections') || '';
        sections = raw.split(',').map(s => s.trim()).filter(Boolean);
      }
      toolExport.streamZip(res, sections);
    },

    'GET /api/docs': (req, res) => {
      const readmePath = path.join(__dirname, '..', '..', 'README.md');
      try {
        const md = fs.readFileSync(readmePath, 'utf8');
        const html = markdownToHtml(md);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (err) {
        res.writeHead(500);
        res.end('README.md nicht gefunden');
      }
    },

    // Doku-Editor: Markdown-Quelltext liefern
    'GET /api/docs/raw': (req, res) => {
      const readmePath = path.join(__dirname, '..', '..', 'README.md');
      try {
        const md = fs.readFileSync(readmePath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(md);
      } catch (err) {
        res.writeHead(500);
        res.end('README.md nicht gefunden');
      }
    },

    // Doku-Editor: Live-Vorschau — rendert übergebenes Markdown mit demselben Renderer wie die Anzeige
    'POST /api/docs/preview': (req, res) => {
      parseJsonBody(req, (body) => {
        const md = body && typeof body.md === 'string' ? body.md : null;
        if (md === null) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'md fehlt' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(markdownToHtml(md));
      });
    },

    // Doku-Editor: README.md speichern (admin-only via ADMIN_ONLY_ROUTES)
    'POST /api/docs': (req, res) => {
      parseJsonBody(req, (body) => {
        const md = body && typeof body.md === 'string' ? body.md : null;
        if (!md || md.length < 100) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Dokumentation zu kurz (Schutz vor versehentlichem Leeren)' }));
          return;
        }
        if (!md.includes('## Historie')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: "Abschnitt '## Historie' fehlt — wird von update-docs benötigt" }));
          return;
        }
        const readmePath = path.join(__dirname, '..', '..', 'README.md');
        try {
          if (fs.existsSync(readmePath)) {
            fs.copyFileSync(readmePath, readmePath + '.bak');
          }
          fs.writeFileSync(readmePath, md, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: err.message }));
        }
      });
    },

    'POST /api/update-docs': (req, res) => {
      parseJsonBody(req, (body) => {
        const title = (body && typeof body.title === 'string') ? body.title.replace(/[\r\n]/g, ' ').trim() : '';
        if (!title) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Titel ist erforderlich' }));
          return;
        }
        const bullets = Array.isArray(body.bullets) ? body.bullets.filter(b => typeof b === 'string') : [];
        const files = (typeof body.files === 'string') ? body.files.trim() : '';

        const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'update-docs.js');
        const args = [scriptPath, title, ...bullets];
        if (files) { args.push('--files', files); }

        execFile(process.execPath, args, { cwd: path.join(__dirname, '..', '..') }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, message: stderr || err.message }));
            return;
          }
          let version = '';
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
            version = pkg.version;
          } catch (_) {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: stdout.trim(), version }));
        });
      });
    },

    'GET /api/email-log': (req, res) => {
      try {
        const content = fs.existsSync(emailLogPath) ? fs.readFileSync(emailLogPath, 'utf8') : '';
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(content);
      } catch (err) {
        res.writeHead(500);
        res.end('Fehler beim Lesen der email.log');
      }
    },

    'DELETE /api/email-log': (req, res) => {
      try {
        fs.writeFileSync(emailLogPath, '', 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: err.message }));
      }
    },

    'GET /api/style': (req, res) => {
      try {
        const css = fs.readFileSync(stylePath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end(css);
      } catch (err) {
        res.writeHead(500); res.end(err.message);
      }
    },

    'POST /api/style': (req, res) => {
      parseJsonBody(req, (body) => {
        const css = body && body.css;
        if (!css || css.length < 100) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'CSS zu kurz (Schutz vor versehentlichem Leeren)' }));
          return;
        }
        try {
          const bakPath = stylePath + '.bak';
          if (fs.existsSync(stylePath)) {
            fs.copyFileSync(stylePath, bakPath);
          }
          fs.writeFileSync(stylePath, css, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: err.message }));
        }
      });
    },

    'GET /api/style/default': (req, res) => {
      try {
        const css = fs.readFileSync(styleDefaultPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end(css);
      } catch (err) {
        res.writeHead(404); res.end('Keine Standard-CSS gefunden');
      }
    },

    // Ganze Log-Datei ins KI-Verzeichnis kopieren.
    //
    // Der Inhalt wird NICHT im Body geschickt: parseJsonBody deckelt bei 1 MB
    // (server/parseJsonBody.js), Logs sind deutlich groesser. Der Client sendet
    // nur den Pfad, der Server kopiert die Datei — copyFileSync haelt den
    // Rohzustand exakt und braucht keinen Streaming-Aufbau.
    //
    // Zielname ist der eigene Dateiname, nicht ki-error-context.md: sonst
    // ueberschriebe der Datei-Export den Einzelfehler-Export.
    'POST /api/export-copilot-file': (req, res) => {
      parseJsonBody(req, (body) => {
        const { filePath, target } = body || {};
        const send = (status, obj) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(obj));
        };
        if (!filePath || typeof filePath !== 'string') {
          send(400, { ok: false, message: 'filePath fehlt' });
          return;
        }

        const username = req.session ? req.session.username : '';
        if (!isKnownLogFile(filePath, username)) {
          send(400, { ok: false, message: 'Unbekannte Datei — nur angezeigte Log-Dateien koennen exportiert werden' });
          return;
        }
        // Sichtbarkeit der Quelle beachten, wie bei pause-source/clear-source.
        const srcLabel = getLabelForFile(filePath);
        if (srcLabel && !userConfigStore.canAccessLabel(req.session, srcLabel)) {
          send(403, { ok: false, message: 'Kein Zugriff auf diesen Pfad' });
          return;
        }

        const dirInfo = resolveCopilotDir(req, target);
        if (!dirInfo.ok) {
          send(dirInfo.status, { ok: false, message: dirInfo.message });
          return;
        }

        const source = path.resolve(filePath);
        let size = 0;
        try {
          const st = fs.statSync(source);
          if (!st.isFile()) { send(400, { ok: false, message: 'Kein Dateipfad' }); return; }
          size = st.size;
        } catch {
          send(400, { ok: false, message: 'Datei existiert nicht: ' + source });
          return;
        }
        // Obergrenze wie beim Einlesen: eine 200-MB-Datei gehoert nicht
        // versehentlich in ein Repository-Verzeichnis.
        const maxMB = Math.max(1, Number(config.maxLogFileSizeMB) || 6);
        if (size > maxMB * 1024 * 1024) {
          send(400, { ok: false, message: `Datei ist groesser als ${maxMB} MB (${(size / 1024 / 1024).toFixed(1)} MB)` });
          return;
        }

        const outputPath = path.join(dirInfo.dir, path.basename(source));
        try {
          fs.copyFileSync(source, outputPath);
          send(200, { ok: true, outputPath, target: dirInfo.label, size });
        } catch (err) {
          send(500, { ok: false, message: 'Schreibfehler: ' + err.message });
        }
      });
    },

    'POST /api/export-copilot-context': (req, res) => {
      parseJsonBody(req, (body) => {
        const { errorText, filePath, timestamp, label, target } = body || {};
        if (!errorText) { res.writeHead(400); res.end(JSON.stringify({ ok: false, message: 'errorText fehlt' })); return; }

        // Zielverzeichnis und die drei Fehlerfaelle teilt sich diese Route mit
        // dem Datei-Export (resolveCopilotDir).
        const dirInfo = resolveCopilotDir(req, target);
        if (!dirInfo.ok) {
          res.writeHead(dirInfo.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: dirInfo.message }));
          return;
        }
        const targetLabel = dirInfo.label;
        const outputPath = path.join(dirInfo.dir, 'ki-error-context.md');
        const time = timestamp ? new Date(timestamp).toLocaleString('de-DE') : 'unbekannt';
        const fence = errorText.includes('```') ? '````' : '```';
        const md = `# Fehler-Kontext für Copilot (${targetLabel})\n\n- **Quelle:** ${label || 'unbekannt'}\n- **Datei:** ${filePath || 'unbekannt'}\n- **Zeit:** ${time}\n- **Exportiert:** ${new Date().toLocaleString('de-DE')}\n- **Ziel:** ${targetLabel}\n\n## Fehlertext\n\n${fence}\n${errorText}\n${fence}\n`;

        try {
          fs.writeFileSync(outputPath, md, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, outputPath, target: targetLabel }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Schreibfehler: ' + err.message }));
        }
      });
    },

    'POST /api/browse-folders': (req, res) => {
      parseJsonBody(req, async (body) => {
        const browsePath = (body && typeof body.path === 'string') ? body.path.trim() : '';
        try {
          // Leerer Pfad → Laufwerke auflisten (Windows) via PowerShell
          if (!browsePath) {
            execFile('powershell', ['-NoProfile', '-Command',
              'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID, DriveType, ProviderName, VolumeName | ConvertTo-Json -Compress'
            ], { timeout: 5000 }, (err, stdout) => {
              let drives = [];
              if (!err && stdout) {
                try {
                  let disks = JSON.parse(stdout);
                  if (!Array.isArray(disks)) disks = [disks];
                  for (const d of disks) {
                    if (!d.DeviceID) continue;
                    const drivePath = d.DeviceID + '\\';
                    let label = drivePath;
                    if (d.DriveType === 4 && d.ProviderName) label = drivePath + ' — ' + d.ProviderName;
                    else if (d.VolumeName) label = drivePath + ' (' + d.VolumeName + ')';
                    drives.push({ name: label, path: drivePath });
                  }
                } catch (_) {}
              }
              // Fallback: A-Z scannen
              if (drives.length === 0) {
                for (let i = 65; i <= 90; i++) {
                  const letter = String.fromCharCode(i) + ':\\';
                  try { if (fs.statSync(letter).isDirectory()) drives.push({ name: letter, path: letter }); } catch (_) {}
                }
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, current: '', parent: null, folders: drives }));
            });
            return;
          }

          const resolved = path.resolve(browsePath);
          try {
            const stat = await fs.promises.stat(resolved);
            if (!stat.isDirectory()) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, message: 'Kein Verzeichnis: ' + resolved }));
              return;
            }
          } catch (statErr) {
            const msg = statErr.code === 'ENOENT' ? 'Verzeichnis nicht gefunden: '
              : statErr.code === 'EACCES' || statErr.code === 'EPERM' ? 'Zugriff verweigert: '
              : 'Fehler: ';
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, message: msg + resolved }));
            return;
          }

          const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
          const folders = entries
            .filter(e => e.isDirectory() && !e.name.startsWith('.'))
            .sort((a, b) => a.name.localeCompare(b.name, 'de'))
            .map(e => ({ name: e.name, path: path.join(resolved, e.name) }));
          const parent = path.dirname(resolved);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, current: resolved, parent: parent !== resolved ? parent : null, folders }));
        } catch (err) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: 'Zugriffsfehler: ' + err.message }));
        }
      });
    },

    'POST /api/system-check/run': (req, res) => {
      const cooldown = healthCheck.getCooldownRemaining();
      if (cooldown > 0) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: `Cooldown aktiv (${Math.ceil(cooldown / 1000)}s)`, cooldown: Math.ceil(cooldown / 1000) }));
        return;
      }
      const hcState = healthCheck.getState();
      if (hcState.running) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'Check läuft bereits' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'Check gestartet' }));

      healthCheck.runHealthCheck((check) => {
        const { clients } = require('../wsBroadcast');
        for (const ws of clients) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'system-check-progress', check }));
          }
        }
      }).then(result => {
        const { clients } = require('../wsBroadcast');
        for (const ws of clients) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'system-check-done', result }));
          }
        }
      }).catch(err => {
        console.error('[HealthCheck] Fehler:', err.message);
      });
    },

    'GET /api/system-check/status': (req, res) => {
      const hcState = healthCheck.getState();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        running: hcState.running,
        lastResult: hcState.lastResult,
        lastRunTime: hcState.lastRunTime,
        cooldown: Math.ceil(healthCheck.getCooldownRemaining() / 1000)
      }));
    },
  };
};
