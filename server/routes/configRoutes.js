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

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: 'Config gespeichert und angewendet' }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: err.message }));
        }
      });
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

    'POST /api/export-copilot-context': (req, res) => {
      parseJsonBody(req, (body) => {
        const { errorText, filePath, timestamp, label, target } = body || {};
        if (!errorText) { res.writeHead(400); res.end(JSON.stringify({ ok: false, message: 'errorText fehlt' })); return; }

        // Copilot-Pfade aus User-Config lesen
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

        const targetLabel = target === 'release' ? 'Release' : 'Develop';
        if (!copilotPath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: `Copilot Working-Pfad ${targetLabel} ist nicht konfiguriert` }));
          return;
        }

        const resolvedDir = path.resolve(copilotPath);
        try {
          const stat = fs.statSync(resolvedDir);
          if (!stat.isDirectory()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, message: `Pfad ${targetLabel} ist kein Verzeichnis` }));
            return;
          }
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, message: `Pfad ${targetLabel} existiert nicht: ${resolvedDir}` }));
          return;
        }

        const outputPath = path.join(resolvedDir, 'copilot-error-context.md');
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
