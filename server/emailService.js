/**
 * Keasy Log Monitor — Email Service
 * E-Mail-Benachrichtigungen: Buffering, Duplikatschutz, SMTP-Versand.
 */

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { emailBuffer, sentHashes, emailDisabledLabels, normalizedWatchPaths, preload } = require('./runtimeStore');
const { broadcast } = require('./wsBroadcast');
const { config } = require('./configStore');

// E-Mail-Logdatei
const emailLogPath = path.join(__dirname, '..', 'email.log');

function logEmail(message) {
  const ts = new Date().toLocaleString('de-DE');
  const line = `[${ts}] ${message}\n`;
  console.log(`  📧 ${message}`);
  fs.appendFile(emailLogPath, line, () => {});
}

function rotateEmailLog() {
  try {
    if (!fs.existsSync(emailLogPath)) return;
    const content = fs.readFileSync(emailLogPath, 'utf8');
    const lines = content.split('\n');
    if (lines.length > 500) {
      fs.writeFileSync(emailLogPath, lines.slice(-400).join('\n'));
    }
  } catch { }
}

function errorHash(label, errorLine) {
  const firstLine = errorLine.split('\n')[0].trim();
  return `${label}::${firstLine}`;
}

// Duplikat-Fenster je Stufe: kritische Fehler dürfen nicht stundenlang stummgeschaltet
// bleiben ("SMTP kaputt seit 08:00" muss um 14:00 wieder gemeldet werden), aber auch
// nicht ganz vom Duplikatschutz ausgenommen sein — sonst mailt eine crashende
// Komponente im Sekundentakt.
function dedupeMinutesFor(level) {
  const email = config.email || {};
  if (level === 'kritisch') return email.criticalDeduplicateMinutes || 15;
  return email.deduplicateMinutes || 60;
}

function isDuplicate(label, errorLine, level) {
  const hash = errorHash(label, errorLine);
  const lastSent = sentHashes.get(hash);
  if (!lastSent) return false;
  const dedupeMs = dedupeMinutesFor(level) * 60 * 1000;
  return (Date.now() - lastSent) < dedupeMs;
}

function markAsSent(label, errorLine) {
  const hash = errorHash(label, errorLine);
  sentHashes.set(hash, Date.now());
}

// Alte Hashes aufräumen (alle 30 Min.) — nach dem längsten der beiden Fenster,
// sonst verfallen Hashes, die das andere Fenster noch braucht.
setInterval(() => {
  const dedupeMs = Math.max(dedupeMinutesFor('normal'), dedupeMinutesFor('kritisch')) * 60 * 1000;
  const now = Date.now();
  for (const [hash, ts] of sentHashes) {
    if (now - ts > dedupeMs) sentHashes.delete(hash);
  }
}, 30 * 60 * 1000);

// SMTP-Transporter erstellen (falls E-Mail konfiguriert)
let emailTransporter = null;
if (config.email && config.email.enabled) {
  const smtpOpts = {
    host: config.email.smtp.host,
    port: config.email.smtp.port,
    secure: config.email.smtp.secure || false
  };
  if (config.email.smtp.family) {
    smtpOpts.family = config.email.smtp.family;
  }
  if (config.email.smtp.auth) {
    smtpOpts.auth = config.email.smtp.auth;
  } else if (config.email.smtp.user) {
    smtpOpts.auth = { user: config.email.smtp.user, pass: config.email.smtp.pass };
  }
  emailTransporter = nodemailer.createTransport(smtpOpts);
  rotateEmailLog();
}

function getEmailRecipientsForLabel(label) {
  // Empfänger aus allen User-Subscriptions aggregieren
  const userConfigStore = require('./userConfigStore');
  const allSubs = userConfigStore.getAllEmailSubscriptions();
  const emails = allSubs.get(label);
  return emails && emails.length > 0 ? emails : null;
}

// --- Sofortversand für kritische Fehler ---
// Ohne diesen Pfad wartet ein kritischer Fehler bis zum nächsten Intervall
// (in der Praxis bis zu 4 Stunden). Bewusst gebündelt statt sofort:
// 50 kritische Zeilen in einem Batch ergeben eine Mail mit 50 Einträgen, nicht 50 Mails.
const IMMEDIATE_DEBOUNCE_MS = 5 * 1000;   // Bündelung eines Ausbruchs
const IMMEDIATE_MIN_GAP_MS = 60 * 1000;   // harte Sperre pro Label
const IMMEDIATE_MAX_AGE_MS = 15 * 60 * 1000; // nur frische Ereignisse
const immediateTimers = new Map();  // label → Timeout
const lastImmediateSend = new Map(); // label → Zeitstempel

// Beim Start werden mit loadExistingErrors ganze Logdateien neu durchgeparst.
// Ohne diesen Schutz löst jeder historische kritische Fehler bei jedem Neustart
// eine Mail aus. Doppelt abgesichert: Preload-Flag UND Alter des Eintrags —
// das Flag ist bei der Nachlauf-Queue für große Dateien nicht immer gesetzt.
function isHistoricalError(error) {
  if (preload.running) return true;
  const ts = new Date(error.timestamp).getTime();
  if (isNaN(ts)) return false;
  return (Date.now() - ts) > IMMEDIATE_MAX_AGE_MS;
}

function scheduleImmediateSend(label) {
  if (immediateTimers.has(label)) return; // Ausbruch wird schon gebündelt
  const last = lastImmediateSend.get(label) || 0;
  const waitMs = Math.max(IMMEDIATE_DEBOUNCE_MS, IMMEDIATE_MIN_GAP_MS - (Date.now() - last));
  immediateTimers.set(label, setTimeout(() => {
    immediateTimers.delete(label);
    lastImmediateSend.set(label, Date.now());
    sendBufferedEmails(label, true);
  }, waitMs));
}

function bufferErrorForEmail(label, error) {
  if (!config.email || !config.email.enabled) return;
  if (emailDisabledLabels.has(label)) return;
  if (!getEmailRecipientsForLabel(label)) return;
  const level = (error && error.level) || 'normal';
  if (isDuplicate(label, error.line, level)) {
    logEmail(`ÜBERSPRUNGEN (Duplikat) → ${label} | ${error.line.split('\n')[0].substring(0, 80)}`);
    return;
  }

  if (!emailBuffer.has(label)) emailBuffer.set(label, []);
  const buf = emailBuffer.get(label);
  buf.push(error);
  // Limit: max 100 pro Label, älteste verwerfen
  if (buf.length > 100) emailBuffer.set(label, buf.slice(-100));

  if (level === 'kritisch' && !isHistoricalError(error)) {
    scheduleImmediateSend(label);
  }
}

// onlyLabel: nur dieses Label versenden (Sofortversand). Ohne Parameter läuft
// wie bisher der komplette Puffer über das Intervall.
async function sendBufferedEmails(onlyLabel, isCriticalTrigger) {
  if (!emailTransporter) return;

  const entries = onlyLabel
    ? (emailBuffer.has(onlyLabel) ? [[onlyLabel, emailBuffer.get(onlyLabel)]] : [])
    : Array.from(emailBuffer);

  for (const [label, errors] of entries) {
    if (errors.length === 0) continue;
    const recipients = getEmailRecipientsForLabel(label);
    if (!recipients) continue;

    const criticalCount = errors.filter(e => e.level === 'kritisch').length;
    const subject = (config.email.subject || '[Keasy Monitor] Fehler in: {label}')
      .replace('{label}', label)
      .replace('{level}', criticalCount > 0 ? 'Kritisch' : 'Normal');

    const body = [
      `Keasy Log Monitor — ${errors.length} neue(r) Fehler in "${label}"`,
      criticalCount > 0 ? `🔴 Davon ${criticalCount} als KRITISCH eingestuft.` : null,
      isCriticalTrigger ? 'Sofortversand wegen kritischem Fehler — die übrigen gepufferten Einträge dieser Quelle sind mit dabei.' : null,
      `Zeitraum: ${new Date(errors[0].timestamp).toLocaleString('de-DE')} – ${new Date(errors[errors.length - 1].timestamp).toLocaleString('de-DE')}`,
      '',
      '─'.repeat(60),
      ...errors.map((e, i) => [
        `\n[${i + 1}]${e.level === 'kritisch' ? ' 🔴 KRITISCH —' : ''} ${e.file} — ${new Date(e.timestamp).toLocaleTimeString('de-DE')}`,
        e.line,
        ''
      ].join('\n')),
      '─'.repeat(60),
      `\nGesendet vom Keasy Log Monitor`
    ].filter(l => l !== null).join('\n');

    try {
      await emailTransporter.sendMail({
        from: config.email.from,
        to: recipients.join(', '),
        subject: criticalCount > 0 ? `🔴 KRITISCH: ${subject}` : subject,
        text: body
      });
      for (const e of errors) {
        markAsSent(label, e.line);
      }
      logEmail(`GESENDET${isCriticalTrigger ? ' (SOFORT/kritisch)' : ''} → ${recipients.join(', ')} | ${label} | ${errors.length} Fehler${criticalCount ? ` (${criticalCount} kritisch)` : ''}`);
      emailBuffer.delete(label);
    } catch (err) {
      logEmail(`FEHLER → ${label} | ${err.message} (wird beim nächsten Intervall erneut versucht)`);
    }
  }
}

// E-Mail-Timer
let emailInterval = null;
let nextEmailSendTime = null;

if (config.email && config.email.enabled) {
  const ms = (config.email.intervalMinutes || 5) * 60 * 1000;
  nextEmailSendTime = Date.now() + ms;

  emailInterval = setInterval(() => {
    sendBufferedEmails();
    nextEmailSendTime = Date.now() + ms;
    broadcast({ type: 'email-timer', data: { nextSendTime: nextEmailSendTime } });
  }, ms);

  console.log(`📧 E-Mail-Versand aktiv (Intervall: ${config.email.intervalMinutes || 5} Min.)`);
}

function getNextEmailSendTime() {
  return nextEmailSendTime;
}

function restartEmailTimer() {
  if (emailInterval) { clearInterval(emailInterval); emailInterval = null; }
  if (config.email && config.email.enabled) {
    const ms = (config.email.intervalMinutes || 5) * 60 * 1000;
    nextEmailSendTime = Date.now() + ms;
    emailInterval = setInterval(() => {
      sendBufferedEmails();
      nextEmailSendTime = Date.now() + ms;
      broadcast({ type: 'email-timer', data: { nextSendTime: nextEmailSendTime } });
    }, ms);
    // SMTP-Transporter neu erstellen
    const smtpOpts = { host: config.email.smtp.host, port: config.email.smtp.port, secure: config.email.smtp.secure || false };
    if (config.email.smtp.family) smtpOpts.family = config.email.smtp.family;
    if (config.email.smtp.auth) smtpOpts.auth = config.email.smtp.auth;
    emailTransporter = nodemailer.createTransport(smtpOpts);
    broadcast({ type: 'email-timer', data: { nextSendTime: nextEmailSendTime } });
  } else {
    emailTransporter = null;
    nextEmailSendTime = null;
    // Ausstehende Sofortversand-Timer verwerfen — ohne Transporter läuft sonst
    // ein Timeout ins Leere und hält den Prozess unnötig wach
    for (const t of immediateTimers.values()) clearTimeout(t);
    immediateTimers.clear();
  }
}

module.exports = { bufferErrorForEmail, getNextEmailSendTime, restartEmailTimer, logEmail, emailLogPath, getEmailRecipientsForLabel };
