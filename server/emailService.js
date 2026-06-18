/**
 * Keasy Log Monitor — Email Service
 * E-Mail-Benachrichtigungen: Buffering, Duplikatschutz, SMTP-Versand.
 */

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { emailBuffer, sentHashes, emailDisabledLabels, normalizedWatchPaths } = require('./runtimeStore');
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

function isDuplicate(label, errorLine) {
  const hash = errorHash(label, errorLine);
  const lastSent = sentHashes.get(hash);
  if (!lastSent) return false;
  const dedupeMs = ((config.email && config.email.deduplicateMinutes) || 60) * 60 * 1000;
  return (Date.now() - lastSent) < dedupeMs;
}

function markAsSent(label, errorLine) {
  const hash = errorHash(label, errorLine);
  sentHashes.set(hash, Date.now());
}

// Alte Hashes aufräumen (alle 30 Min.)
setInterval(() => {
  const dedupeMs = ((config.email && config.email.deduplicateMinutes) || 60) * 60 * 1000;
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

function bufferErrorForEmail(label, error) {
  if (!config.email || !config.email.enabled) return;
  if (emailDisabledLabels.has(label)) return;
  if (!getEmailRecipientsForLabel(label)) return;
  if (isDuplicate(label, error.line)) {
    logEmail(`ÜBERSPRUNGEN (Duplikat) → ${label} | ${error.line.split('\n')[0].substring(0, 80)}`);
    return;
  }

  if (!emailBuffer.has(label)) emailBuffer.set(label, []);
  const buf = emailBuffer.get(label);
  buf.push(error);
  // Limit: max 100 pro Label, älteste verwerfen
  if (buf.length > 100) emailBuffer.set(label, buf.slice(-100));
}

async function sendBufferedEmails() {
  if (!emailTransporter) return;

  for (const [label, errors] of emailBuffer) {
    if (errors.length === 0) continue;
    const recipients = getEmailRecipientsForLabel(label);
    if (!recipients) continue;

    const subject = (config.email.subject || '[Keasy Monitor] Fehler in: {label}')
      .replace('{label}', label);

    const body = [
      `Keasy Log Monitor — ${errors.length} neue(r) Fehler in "${label}"`,
      `Zeitraum: ${new Date(errors[0].timestamp).toLocaleString('de-DE')} – ${new Date(errors[errors.length - 1].timestamp).toLocaleString('de-DE')}`,
      '',
      '─'.repeat(60),
      ...errors.map((e, i) => [
        `\n[${i + 1}] ${e.file} — ${new Date(e.timestamp).toLocaleTimeString('de-DE')}`,
        e.line,
        ''
      ].join('\n')),
      '─'.repeat(60),
      `\nGesendet vom Keasy Log Monitor`
    ].join('\n');

    try {
      await emailTransporter.sendMail({
        from: config.email.from,
        to: recipients.join(', '),
        subject,
        text: body
      });
      for (const e of errors) {
        markAsSent(label, e.line);
      }
      logEmail(`GESENDET → ${recipients.join(', ')} | ${label} | ${errors.length} Fehler`);
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
  }
}

module.exports = { bufferErrorForEmail, getNextEmailSendTime, restartEmailTimer, logEmail, emailLogPath, getEmailRecipientsForLabel };
