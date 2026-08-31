(function() {
window.Keasy = window.Keasy || {};

const { state } = Keasy;
const { escapeHtml, escapeJs } = Keasy.utils;

let _analyzeLoaded = false;

function toggleAnalyzePanel() {
  const panel = document.getElementById('analyzePanel');
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) {
    // Config-Panel schließen wenn offen
    document.getElementById('configPanel').classList.remove('open');
    if (!_analyzeLoaded) {
      loadAnalyzeConfig();
    } else {
      renderAnalyzePaths();
      updateAnalyzeButtons();
    }
  }
}

async function loadAnalyzeConfig() {
  try {
    const resp = await fetch('/api/config');
    const cfg = await resp.json();
    state.analyzePaths = [...(cfg.analyzePaths || [])];
    document.getElementById('analyzeMaxErrors').value = cfg.analyzeMaxErrors || 100;
    // Nie konfiguriert (undefined) → Richtwert 20; explizite 0 bleibt "aus"
    document.getElementById('analyzeGapWarnSeconds').value = cfg.analyzeGapWarnSeconds ?? 20;
    document.getElementById('analyzeGapIdleMinutes').value = cfg.analyzeGapIdleMinutes || '';
    _analyzeLoaded = true;
    loadDroppedFiles();
    renderAnalyzePaths();
    markAnalyzeSaved();
  } catch (err) {
    console.error('[Analyze] Config laden fehlgeschlagen:', err.message);
  }
}

async function addAnalyzePath() {
  const input = document.getElementById('analyzePath');
  const errorEl = document.getElementById('analyzePathError');
  const p = input.value.trim();
  errorEl.style.display = 'none';
  if (!p) return;
  if (state.analyzePaths.includes(p)) { input.value = ''; return; }

  // Server-seitige Validierung
  try {
    const resp = await fetch('/api/analyze-validate-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p })
    });
    const result = await resp.json();
    if (!result.ok) {
      errorEl.textContent = '⚠️ ' + result.message;
      errorEl.style.display = 'block';
      return;
    }
  } catch (err) {
    errorEl.textContent = '⚠️ Validierung fehlgeschlagen: ' + err.message;
    errorEl.style.display = 'block';
    return;
  }

  state.analyzePaths.push(p);
  input.value = '';
  renderAnalyzePaths();
  updateAnalyzeButtons();
}

// Oeffnet den Pfad im Explorer. Dieselbe Route wie bei den Fehlereintraegen
// und den Backup-Zielen (/api/open-folder) — kein zweiter Weg fuer dasselbe.
// Hinweis fuer den Mehrbenutzerbetrieb: der Explorer geht auf dem RECHNER DES
// SERVERS auf. Wer das Dashboard von einem anderen PC oeffnet, sieht nichts.
function openAnalyzePath(index) {
  const p = state.analyzePaths[index];
  if (!p) return;
  fetch('/api/open-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath: p })
  }).catch(err => showToast('Öffnen fehlgeschlagen: ' + err.message, 'error'));
}

function removeAnalyzePath(index) {
  state.analyzePaths.splice(index, 1);
  renderAnalyzePaths();
  updateAnalyzeButtons();
}

// Ordner-Picker fürs Analyse-Eingabefeld — füllt #analyzePath, Hinzufügen erfolgt wie gewohnt
async function pickAnalyzeFolder() {
  const input = document.getElementById('analyzePath');
  if (!input || typeof showFolderPicker !== 'function') return;
  const chosen = await showFolderPicker(input.value.trim() || '');
  if (chosen) {
    input.value = chosen;
    input.focus();
  }
}

function renderAnalyzePaths() {
  const list = document.getElementById('analyzePathList');
  // Die abgelegten Dateien haengen an derselben Liste, sind aber unabhaengig
  // von den konfigurierten Pfaden: "nur Abgelegtes, kein Pfad" ist ein
  // gueltiger Lauf, updateAnalyzeButtons() schaltet den Start-Knopf dafuer
  // ausdruecklich frei. Hier stand frueher ein Ausstieg bei leerer Pfadliste
  // -- der hat die Ablage in genau diesem Fall verschluckt: man legte Dateien
  // ab oder uebergab einen Ordner, der Upload lief durch, und zu sehen war
  // nichts. Deshalb wird die Gruppe in beiden Zweigen angehaengt.
  const dropped = renderDroppedGroup();
  if (state.analyzePaths.length === 0) {
    list.innerHTML = '<em style="color:var(--text-secondary);">Keine Pfade hinzugefügt</em>' + dropped;
    return;
  }
  list.innerHTML = state.analyzePaths.map((p, i) =>
    `<div style="display:flex; align-items:center; gap:6px; padding:3px 0;">
      <code style="flex:1; font-size:0.85em; background:var(--bg-tertiary); padding:2px 6px; border-radius:3px; word-break:break-all;">${escapeHtml(p)}</code>
      <button onclick="openAnalyzePath(${i})" style="background:none; border:none; cursor:pointer; font-size:1em;" title="Pfad im Explorer öffnen" aria-label="Pfad im Explorer öffnen">↗️</button>
      <button onclick="removeAnalyzePath(${i})" style="background:none; border:none; cursor:pointer; font-size:1em;" title="Entfernen" aria-label="Pfad entfernen">❌</button>
    </div>`
  ).join('') + dropped;
}

// === Abgelegte Log-Dateien (Drag & Drop) ===
//
// Warum ueberhaupt Upload: ein Browser gibt beim Ablegen Name, Groesse und
// Inhalt heraus, aber NICHT den Pfad. Die Analyse arbeitet pfadbasiert, also
// wird der Inhalt hochgeladen und serverseitig abgelegt; die Auswertung selbst
// bleibt unveraendert. Nebengewinn: wer das Dashboard von einem anderen
// Rechner oeffnet, kann damit seine eigenen Dateien analysieren statt nur die,
// die der Server sieht.

const DROP_EXT = ['.log', '.json', '.zip'];

// Obergrenze fuer einen Ordner-Durchlauf. Ein versehentlich gewaehlter
// Downloads-Ordner soll keine hunderte Uploads ausloesen. Fuer den Zweck des
// Ordner-Uploads -- Dateien, die der Server NICHT sieht, etwa aus einer Mail
// oder von einem Notebook ohne Laufwerks-Mapping -- sind 200 reichlich. Was
// auf einem gemappten Laufwerk liegt, gehoert als Analyse-Pfad hinzugefuegt
// und wird dort ohne einen einzigen Upload gelesen.
const DROP_FOLDER_MAX = 200;

function fmtDropSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

// Warum eine Datei nicht taugt — oder null, wenn sie taugt. Eine Stelle fuer
// beide Wege, damit einzeln abgelegte und im Ordner gefundene Dateien nach
// denselben Regeln beurteilt werden; nur die Lautstaerke unterscheidet sich.
function dropSkipReason(f) {
  const lower = f.name.toLowerCase();
  if (!DROP_EXT.some(e => lower.endsWith(e))) return 'nur ' + DROP_EXT.join(' / ');
  if (f.size === 0) return 'leer';
  return null;
}

// Relativpfad in den Dateinamen falten. Die Ablage ist flach: aus zwei
// "app.log" aus verschiedenen Unterordnern wuerden sonst "app.log" und
// "app.log (2)" -- im Ergebnis nicht mehr unterscheidbar, und genau die
// Zuordnung braucht man beim Nachsehen. Nur der direkte Ordner wandert mit;
// bei datierten Unterordnern traegt er die Information, der volle Pfad waere
// nur Laenge. Tilde als Trenner: in Windows-Dateinamen erlaubt und in
// Logdateinamen praktisch nie vorhanden, anders als "_" oder ".". Der Server
// verwirft ueber safeName() ohnehin alles, was nach Pfad aussieht -- die
// Tilde ueberlebt das, ein "/" nicht.
function foldDroppedName(f) {
  const rel = f.webkitRelativePath || '';
  if (!rel) return f.name;
  const parts = rel.split('/');
  parts.pop();
  const parent = parts[parts.length - 1];
  return parent ? parent + '~' + f.name : f.name;
}

// Eine Datei pro Anfrage, der Reihe nach: so gibt es Fortschritt je Datei, und
// eine abgewiesene Datei reisst nicht den ganzen Stapel mit.
//
// opts.fromFolder unterscheidet die beiden Wege. Einzeln abgelegt heisst: der
// Benutzer hat genau diese Datei gemeint, eine Abweisung gehoert ihm mit Grund
// gesagt. Im Ordner gefunden heisst: er hat einen Ordner gemeint, nicht die
// 200 .txt darin -- die werden still uebersprungen und einmal zusammengefasst.
// Fehlgeschlagene Uploads bleiben in BEIDEN Faellen laut: "ist kein Log" ist
// eine Auskunft, "ging schief" ist ein Problem.
async function uploadDroppedFiles(fileList, opts) {
  const fromFolder = !!(opts && opts.fromFolder);
  let files = Array.from(fileList || []);
  if (!files.length) return;

  state.analyzeDroppedRejected = state.analyzeDroppedRejected || [];

  if (fromFolder) {
    state.analyzeDroppedSkipped = [];
    state.analyzeDroppedSkippedOpen = false;
    const usable = [];
    for (const f of files) {
      const reason = dropSkipReason(f)
        || (usable.length >= DROP_FOLDER_MAX ? 'über der Obergrenze von ' + DROP_FOLDER_MAX : null);
      if (reason) {
        state.analyzeDroppedSkipped.push({ name: f.webkitRelativePath || f.name, reason });
      } else {
        usable.push(f);
      }
    }
    files = usable;
    if (!files.length) {
      renderAnalyzePaths();
      return;
    }
  }

  state.analyzeDroppedBusy = true;
  state.analyzeDroppedProgress = fromFolder ? { done: 0, total: files.length } : null;
  renderAnalyzePaths();

  for (const f of files) {
    if (!fromFolder) {
      const reason = dropSkipReason(f);
      if (reason) {
        state.analyzeDroppedRejected.push({ name: f.name, reason });
        continue;
      }
    }
    const target = fromFolder ? foldDroppedName(f) : f.name;
    try {
      const resp = await fetch('/api/analyze-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          // encodeURIComponent, damit Umlaute im Dateinamen den Header überleben
          'X-Filename': encodeURIComponent(target)
        },
        body: f
      });
      const data = await resp.json().catch(() => ({ ok: false, message: 'HTTP ' + resp.status }));
      if (!data.ok) {
        state.analyzeDroppedRejected.push({ name: target, reason: data.message || 'abgewiesen' });
      } else if (data.zip && data.skipped && data.skipped.length) {
        // ZIP-Inhalt: derselbe Massstab wie beim Ordner — beim Einzel-Upload
        // laut, beim Ordner-Durchlauf still in die Zusammenfassung.
        const sink = fromFolder ? state.analyzeDroppedSkipped : state.analyzeDroppedRejected;
        for (const sk of data.skipped) sink.push({ name: sk.name, reason: sk.reason });
      }
    } catch (err) {
      state.analyzeDroppedRejected.push({ name: target, reason: err.message });
    }
    if (state.analyzeDroppedProgress) {
      state.analyzeDroppedProgress.done++;
      renderAnalyzePaths();
    }
  }

  state.analyzeDroppedBusy = false;
  state.analyzeDroppedProgress = null;
  await loadDroppedFiles();
}

// Ordner uebergeben. Der Browser laeuft ihn selbst rekursiv ab und liefert
// jede Datei samt webkitRelativePath — kein Entry-Walker noetig, und der
// Server bleibt unveraendert.
function pickAnalyzeLogFolder() {
  const picker = document.getElementById('analyzeLogFolderPicker');
  if (picker) picker.click();
}

function toggleDroppedSkipped() {
  state.analyzeDroppedSkippedOpen = !state.analyzeDroppedSkippedOpen;
  renderAnalyzePaths();
}

function dismissDroppedSkipped() {
  state.analyzeDroppedSkipped = [];
  state.analyzeDroppedSkippedOpen = false;
  renderAnalyzePaths();
}

// Einzeln abgelegte Dateien bleiben mit Grund sichtbar: wer vier Dateien
// hineinzieht und zwei ausgewertet bekommt, soll erfahren warum. Beim
// Ordner-Durchlauf kippt dieselbe Liste ins Gegenteil — 200 Zeilen "nur .log
// / .json / .zip" schieben die uebernommenen Dateien aus dem Bild. Deshalb
// dort eine Zeile mit Zahl und Aufklapper.
function renderDroppedGroup() {
  const files = state.analyzeDropped || [];
  const bad = state.analyzeDroppedRejected || [];
  const skipped = state.analyzeDroppedSkipped || [];
  if (!files.length && !bad.length && !skipped.length) return '';

  const rows = files.map(f => `
    <div class="dropped-row">
      <code>${escapeHtml(f.name)}</code>
      <span class="sz">${fmtDropSize(f.size)}</span>
      <button class="x-btn" onclick="removeDroppedFile('${escapeJs(f.name)}')" title="Entfernen" aria-label="Datei entfernen">❌</button>
    </div>`).join('');

  const badRows = bad.map((b, i) => `
    <div class="dropped-row is-bad">
      <code>${escapeHtml(b.name)}</code>
      <span class="why">✕ ${escapeHtml(b.reason)}</span>
      <button class="x-btn" onclick="dismissDroppedReject(${i})" title="Hinweis ausblenden" aria-label="Hinweis ausblenden">❌</button>
    </div>`).join('');

  let skippedBlock = '';
  if (skipped.length) {
    const open = !!state.analyzeDroppedSkippedOpen;
    const detail = open ? skipped.map(s => `
      <div class="dropped-row is-bad">
        <code>${escapeHtml(s.name)}</code>
        <span class="why">✕ ${escapeHtml(s.reason)}</span>
      </div>`).join('') : '';
    skippedBlock = `
      <div class="dropped-skipped">
        <span>↳ ${skipped.length} Datei${skipped.length === 1 ? '' : 'en'} im Ordner übersprungen</span>
        <button type="button" class="link-btn" onclick="toggleDroppedSkipped()" aria-expanded="${open}">${open ? 'zuklappen' : 'ansehen'}</button>
        <span style="flex:1"></span>
        <button class="x-btn" onclick="dismissDroppedSkipped()" title="Hinweis ausblenden" aria-label="Hinweis ausblenden">❌</button>
      </div>${detail}`;
  }

  const p = state.analyzeDroppedProgress;
  const pending = state.analyzeDroppedBusy
    ? `<div class="dropped-row"><span class="sz">⏳ übertrage ${p ? `${p.done + 1} von ${p.total}` : ''} …</span></div>`
    : '';

  return `
    <div class="dropped-group">
      <div class="dropped-head">
        <span>📄 Abgelegte Dateien</span>
        <span class="dropped-badge">temporär · nicht in der Config</span>
        <span style="flex:1"></span>
        <button class="x-btn" onclick="clearDroppedFiles()" title="Alle entfernen" aria-label="Alle abgelegten Dateien entfernen">❌</button>
      </div>
      ${rows}${badRows}${skippedBlock}${pending}
      <div style="font-size:0.78em; color:var(--text-muted); margin-top:4px;">
        ${files.length} Datei${files.length === 1 ? '' : 'en'} werden mitanalysiert · bleiben bis „Ergebnisse löschen"
      </div>
    </div>`;
}

async function loadDroppedFiles() {
  try {
    const resp = await fetch('/api/analyze-dropped');
    const data = await resp.json();
    state.analyzeDropped = data.files || [];
  } catch {
    state.analyzeDropped = [];
  }
  renderAnalyzePaths();
  updateAnalyzeButtons();
}

async function removeDroppedFile(name) {
  try {
    await fetch('/api/analyze-drop-remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
  } catch (err) {
    showToast('Entfernen fehlgeschlagen: ' + err.message, 'error');
  }
  await loadDroppedFiles();
}

async function clearDroppedFiles() {
  try {
    await fetch('/api/analyze-drop-remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true })
    });
  } catch (err) {
    showToast('Entfernen fehlgeschlagen: ' + err.message, 'error');
  }
  state.analyzeDroppedRejected = [];
  state.analyzeDroppedSkipped = [];
  state.analyzeDroppedSkippedOpen = false;
  await loadDroppedFiles();
}

function dismissDroppedReject(i) {
  (state.analyzeDroppedRejected || []).splice(i, 1);
  renderAnalyzePaths();
}

// Vergleichsstand der speicherbaren Werte. Wird beim Laden gesetzt und nach
// dem Speichern erneuert; daraus ergibt sich, ob der Speichern-Knopf etwas zu
// tun hat. Ein Knopf, der immer wie eine offene Aufgabe aussieht, verliert
// seine Aussage — dasselbe Muster wie beim Speichern-Knopf der Config.
function analyzeSnapshot() {
  const num = (id) => (document.getElementById(id) || {}).value || '';
  return JSON.stringify({
    paths: state.analyzePaths,
    maxErrors: num('analyzeMaxErrors'),
    gapWarn: num('analyzeGapWarnSeconds'),
    gapIdle: num('analyzeGapIdleMinutes')
  });
}

function markAnalyzeSaved() {
  state.analyzeSavedSnapshot = analyzeSnapshot();
  updateAnalyzeButtons();
}

function updateAnalyzeButtons() {
  const startBtn = document.getElementById('analyzeStartBtn');
  const clearBtn = document.getElementById('analyzeClearBtn');
  const cancelBtn = document.getElementById('analyzeCancelBtn');
  const saveBtn = document.getElementById('analyzeSaveBtn');
  // Nur abgelegte Dateien ohne konfigurierten Pfad ist ein gueltiger Lauf.
  const hasPaths = state.analyzePaths.length > 0 || (state.analyzeDropped || []).length > 0;
  const hasResults = Object.keys(state.analyzeErrors).length > 0;
  startBtn.disabled = !hasPaths || state.analyzeIsRunning;
  clearBtn.disabled = state.analyzeIsRunning || (!hasResults && !state.analyzeIsRunning);
  // Abbrechen ist zusaetzlich zum Ausblenden gesperrt: bleibt es durch einen
  // ungewoehnlichen Zustand doch sichtbar, ist es wenigstens nicht klickbar.
  if (cancelBtn) cancelBtn.disabled = !state.analyzeIsRunning;
  if (saveBtn) {
    // Ohne Vergleichsstand (noch nicht geladen) gibt es nichts zu speichern.
    const dirty = state.analyzeSavedSnapshot !== null && analyzeSnapshot() !== state.analyzeSavedSnapshot;
    saveBtn.disabled = state.analyzeIsRunning || !dirty;
  }
}

async function startAnalysis() {
  if (state.analyzePaths.length === 0 && (state.analyzeDropped || []).length === 0) return;
  const maxErrors = parseInt(document.getElementById('analyzeMaxErrors').value) || 100;
  const gapWarnSeconds = parseInt(document.getElementById('analyzeGapWarnSeconds').value) || 0;
  const gapIdleMinutes = parseInt(document.getElementById('analyzeGapIdleMinutes').value) || 0;
  try {
    const resp = await fetch('/api/analyze-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: state.analyzePaths, maxErrorsPerFile: maxErrors, gapWarnSeconds, gapIdleMinutes })
    });
    const result = await resp.json();
    if (result.ok) {
      state.analyzeIsRunning = true;
      document.getElementById('analyzeStartBtn').style.display = 'none';
      document.getElementById('analyzeCancelBtn').style.display = '';
      updateAnalyzeButtons();
      document.getElementById('analyzePanel').classList.remove('open');
    } else {
      showAnalyzeStatus('❌ ' + result.message, 'error');
    }
  } catch (err) {
    showAnalyzeStatus('❌ ' + err.message, 'error');
  }
}

async function cancelAnalysis() {
  await fetch('/api/analyze-cancel', { method: 'POST' });
}

async function clearAnalysis() {
  // Sofort clientseitig leeren (optimistic)
  state.analyzeErrors = {};
  state.analyzeLabels = {};
  // Der Server raeumt die Ablage beim Leeren mit — Anzeige gleich mitziehen
  state.analyzeDropped = [];
  state.analyzeDroppedRejected = [];
  const progress = document.getElementById('analyzeProgress');
  progress.style.display = 'none';
  updateAnalyzeButtons();
  if (typeof renderAll === 'function') renderAll();
  // Server-Request fire-and-forget
  try {
    const resp = await fetch('/api/analyze-clear', { method: 'POST' });
    if (!resp.ok) showToast('Analyse-Clear fehlgeschlagen', 'error');
  } catch (err) {
    showToast('Analyse-Clear: ' + err.message, 'error');
  }
}

async function saveAnalyzePaths() {
  const msg = document.getElementById('analyzeSaveMessage');
  try {
    // Verwende buildConfigFromForm() statt fetch+patch,
    // damit alle Config-Werte (inkl. Backup/FTP) konsistent bleiben
    const cfg = typeof buildConfigFromForm === 'function'
      ? buildConfigFromForm()
      : await fetch('/api/config').then(r => r.json());
    cfg.analyzePaths = [...state.analyzePaths];
    cfg.analyzeMaxErrors = parseInt(document.getElementById('analyzeMaxErrors').value) || 100;
    cfg.analyzeGapWarnSeconds = parseInt(document.getElementById('analyzeGapWarnSeconds').value) || 0;
    cfg.analyzeGapIdleMinutes = parseInt(document.getElementById('analyzeGapIdleMinutes').value) || 0;
    const saveResp = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    });
    const result = await saveResp.json();
    if (result.ok) {
      msg.textContent = '✅ Gespeichert';
      msg.style.color = '#10b981';
      state.currentConfig = cfg;
      markAnalyzeSaved();
    } else {
      msg.textContent = '❌ ' + (result.message || 'Fehler');
      msg.style.color = '#ef4444';
    }
  } catch (err) {
    msg.textContent = '❌ ' + err.message;
    msg.style.color = '#ef4444';
  }
  msg.style.display = 'inline';
  setTimeout(() => { msg.style.display = 'none'; }, 3000);
}

function showAnalyzeStatus(text, type) {
  const status = document.getElementById('analyzeStatus');
  const progress = document.getElementById('analyzeProgress');
  progress.style.display = '';
  document.getElementById('analyzeProgressBar').style.width = '0%';
  status.textContent = text;
  // Banner des vorigen Laufs raeumen: es gehoert nicht zu dieser Meldung.
  showAnalyzeTruncatedHint(0);
}

function updateAnalyzeProgress(current, total, errorCount, running, aborted, skippedPaths, gaps, opts) {
  const progress = document.getElementById('analyzeProgress');
  const bar = document.getElementById('analyzeProgressBar');
  const status = document.getElementById('analyzeStatus');
  progress.style.display = '';
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  bar.style.width = pct + '%';
  const gapInfo = gaps > 0 ? `, ${gaps} ⏱️ Gaps` : '';

  if (running) {
    state.analyzeIsRunning = true;
    let text = `${current}/${total} Dateien (${errorCount} Fehler${gapInfo} gefunden)`;
    if (skippedPaths && skippedPaths.length > 0) {
      text += ` — ${skippedPaths.length} Pfade übersprungen`;
    }
    status.textContent = text;
  } else {
    state.analyzeIsRunning = false;
    document.getElementById('analyzeStartBtn').style.display = '';
    document.getElementById('analyzeCancelBtn').style.display = 'none';
    updateAnalyzeButtons();
    if (aborted) {
      status.textContent = `⏹ Abgebrochen: ${current}/${total} Dateien, ${errorCount} Fehler${gapInfo}`;
    } else if (total === 0) {
      // Endungen nennen: sonst raetselt man, wonach ueberhaupt gesucht wurde.
      status.textContent = '⚠️ Keine .log/.json-Dateien gefunden in den angegebenen Pfaden';
    } else {
      status.textContent = `✅ Abgeschlossen: ${errorCount} Fehler${gapInfo} in ${total} Dateien`;
    }
  }
  // Lesestopp-Banner: eigenes Element, damit analyzeStatus reiner Text bleibt.
  // Nur am Ende eines Laufs — waehrend der Analyse ist die Zahl noch im Fluss.
  showAnalyzeTruncatedHint(running ? 0 : (opts && opts.truncatedFiles) || 0, total, opts && opts.limit);
}

// Zeigt an, dass das Analyse-Limit das Lesen abgebrochen hat. Das war vorher
// unsichtbar: das Ergebnis sah vollstaendig aus, obwohl der hintere Teil der
// Datei nie gelesen wurde.
function showAnalyzeTruncatedHint(truncatedFiles, total, limit) {
  const hint = document.getElementById('analyzeTruncatedHint');
  if (!hint) return;
  if (!truncatedFiles) { hint.style.display = 'none'; hint.textContent = ''; return; }
  const dateiWort = truncatedFiles === 1 ? 'Datei' : 'Dateien';
  const limitInfo = limit ? ` (Limit ${limit} erreicht)` : '';
  hint.innerHTML = `⚠ <b>${truncatedFiles} von ${total} ${dateiWort} unvollständig gelesen</b>${limitInfo}. `
    + 'Spätere Fehler in diesen Dateien sind ungeprüft — Limit erhöhen und erneut starten.';
  hint.style.display = '';
}

// --- Import ---

function toggleAnalyzeImport() {
  const area = document.getElementById('analyzeImportArea');
  const show = area.style.display === 'none';
  area.style.display = show ? 'block' : 'none';
  if (show) {
    document.getElementById('analyzeImportText').value = '';
    document.getElementById('analyzeImportPreview').textContent = '';
  }
}

function importAnalyzePaths() {
  const text = document.getElementById('analyzeImportText').value.trim();
  if (!text) { showToast('Keine Pfade eingegeben', 'warn'); return; }

  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const existing = state.analyzePaths.map(p => p.toLowerCase());

  let added = 0, skipped = 0;
  for (const line of lines) {
    const p = line.split(/[;\t]/)[0]?.trim();
    if (!p) continue;
    if (existing.includes(p.toLowerCase())) { skipped++; continue; }
    state.analyzePaths.push(p);
    existing.push(p.toLowerCase());
    added++;
  }

  const msg = `${added} Pfad(e) importiert` + (skipped ? `, ${skipped} bereits vorhanden` : '');
  showToast(msg, added > 0 ? 'success' : 'warn');
  toggleAnalyzeImport();
  renderAnalyzePaths();
  updateAnalyzeButtons();
}

// Drag & Drop + Live-Vorschau für Analyse-Import
document.addEventListener('DOMContentLoaded', () => {
  const textarea = document.getElementById('analyzeImportText');
  if (textarea) {
    textarea.addEventListener('input', () => {
      const lines = textarea.value.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      const existing = state.analyzePaths.map(p => p.toLowerCase());
      const newCount = lines.filter(l => {
        const p = l.split(/[;\t]/)[0]?.trim();
        return p && !existing.includes(p.toLowerCase());
      }).length;
      const preview = document.getElementById('analyzeImportPreview');
      preview.textContent = lines.length > 0 ? `${newCount} neue Pfade erkannt` : '';
    });
  }

  const dropZone = document.getElementById('analyzeDropZone');
  if (dropZone) {
    const overlay = document.getElementById('analyzeDropOverlay');
    let dragCounter = 0;

    dropZone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (overlay) overlay.style.display = 'flex';
      dropZone.style.borderColor = '#2ea043';
    });
    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        if (overlay) overlay.style.display = 'none';
        dropZone.style.borderColor = '';
      }
    });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      if (overlay) overlay.style.display = 'none';
      dropZone.style.borderColor = '';
      const file = e.dataTransfer.files[0];
      if (!file) return;
      handleAnalyzeImportFile(file);
    });
  }
});

function handleAnalyzeImportFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const textarea = document.getElementById('analyzeImportText');

  if (ext === 'csv' || ext === 'txt') {
    const reader = new FileReader();
    reader.onload = (e) => {
      textarea.value = e.target.result;
      textarea.dispatchEvent(new Event('input'));
      showToast(`📄 ${file.name} geladen`, 'success');
    };
    reader.readAsText(file, 'utf-8');
  } else {
    showToast(`Nicht unterstütztes Format: .${ext} (CSV oder TXT erwartet)`, 'warn');
  }
}

// Drop-Bereich verdrahten. Muster wie beim Pfad-Import: Listener beim
// DOMContentLoaded, damit die Verdrahtung an einer Stelle steht.
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('analyzeLogDrop');
  if (!zone) return;
  let depth = 0;
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; zone.classList.add('is-over'); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); });
  zone.addEventListener('dragleave', (e) => { e.preventDefault(); if (--depth <= 0) { depth = 0; zone.classList.remove('is-over'); } });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    zone.classList.remove('is-over');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      uploadDroppedFiles(e.dataTransfer.files);
    }
  });
  // Aenderungen an den Zahlenfeldern muessen den Speichern-Knopf aufwecken.
  // Das Analyse-Panel liegt ausserhalb von #configPanel, die dortige
  // Change-Erkennung greift hier also nicht.
  ['analyzeMaxErrors', 'analyzeGapWarnSeconds', 'analyzeGapIdleMinutes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateAnalyzeButtons);
  });

  // Auch per Klick auswaehlbar — Drag & Drop ist bequem, aber nicht fuer alle
  // und nicht mit der Tastatur bedienbar.
  const picker = document.getElementById('analyzeLogPicker');
  if (picker) {
    zone.addEventListener('click', () => picker.click());
    picker.addEventListener('change', () => {
      uploadDroppedFiles(picker.files);
      picker.value = '';
    });
  }

  // Ordnerauswahl. Eigener Knopf statt zweiter Zeile in der Ablageflaeche:
  // die Flaeche reagiert bereits auf Klick, ein zweites Ziel darin waere
  // ohne den vorhandenen Klick nicht sauber zu treffen.
  const folderPicker = document.getElementById('analyzeLogFolderPicker');
  if (folderPicker) {
    folderPicker.addEventListener('change', () => {
      uploadDroppedFiles(folderPicker.files, { fromFolder: true });
      folderPicker.value = '';
    });
  }
});

window.Keasy.analyze = {
  toggleAnalyzePanel, loadAnalyzeConfig, addAnalyzePath, removeAnalyzePath, renderAnalyzePaths, updateAnalyzeButtons,
  startAnalysis, cancelAnalysis, clearAnalysis, saveAnalyzePaths,
  showAnalyzeStatus, updateAnalyzeProgress, toggleAnalyzeImport, importAnalyzePaths, pickAnalyzeFolder,
  markAnalyzeSaved,
  loadDroppedFiles, uploadDroppedFiles, removeDroppedFile, clearDroppedFiles, openAnalyzePath,
  pickAnalyzeLogFolder, toggleDroppedSkipped, dismissDroppedSkipped
};

Object.assign(window, {
  toggleAnalyzePanel, addAnalyzePath, removeAnalyzePath, startAnalysis, cancelAnalysis,
  clearAnalysis, saveAnalyzePaths, updateAnalyzeButtons,
  renderAnalyzePaths, updateAnalyzeProgress, showAnalyzeStatus,
  toggleAnalyzeImport, importAnalyzePaths, pickAnalyzeFolder,
  removeDroppedFile, clearDroppedFiles, dismissDroppedReject, openAnalyzePath,
  pickAnalyzeLogFolder, toggleDroppedSkipped, dismissDroppedSkipped
});
})();
