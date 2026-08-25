window.Keasy = window.Keasy || {};

window.Keasy.state = {
  // Monitor
  errors: {},
  fileLabels: {},
  oversizedFiles: {},
  maxLogFileSizeMB: 6,
  // Wird beim init vom Server überschrieben — Grundlage der Kürzung im Client
  // (Obergrenze maxErrorsPerFile * 2, identisch zum Server)
  maxErrorsPerFile: 10,
  paused: false,
  totalErrors: 0,
  criticalErrors: 0,
  searchTerm: '',
  searchRegex: null,

  // Sources
  pausedSources: new Set(),
  emailDisabledSources: new Set(),
  emailConfiguredSources: new Set(),
  nextEmailSendTime: null,
  collapsedSources: JSON.parse(localStorage.getItem('keasy-collapsed-sources') || '{}'),

  // Copilot-Export: ist der jeweilige Zielpfad konfiguriert? Kommt mit der
  // init-Nachricht (pro Benutzer) und steuert, ob die 🤖/🚀-Knöpfe bedienbar
  // sind — die Einstellungskarte verspricht „Leer = Button deaktiviert".
  copilotDevelopSet: false,
  copilotReleaseSet: false,

  // Analyse
  analyzeErrors: {},
  analyzeLabels: {},
  analyzeUser: '',
  analyzePaths: [],
  analyzeIsRunning: false,
  // Vergleichsstand für „Pfade speichern": null = noch nicht geladen, dann gibt
  // es auch nichts zu speichern. Sonst der Stand der zuletzt gespeicherten
  // Werte — weicht die Anzeige davon ab, ist der Knopf aktiv.
  analyzeSavedSnapshot: null,
  // Per Drag & Drop übergebene Log-Dateien. Liegen serverseitig in einer
  // temporären Ablage je Benutzer, nicht in der Config — deshalb nur hier.
  analyzeDropped: [],
  analyzeDroppedRejected: [],
  analyzeDroppedBusy: false,
  // Ordner-Durchlauf: still uebersprungene Dateien werden gesammelt und
  // einmal zusammengefasst statt einzeln aufgelistet.
  analyzeDroppedSkipped: [],
  analyzeDroppedSkippedOpen: false,
  analyzeDroppedProgress: null,

  // Performance-Lücken (⏱️)
  performanceEntries: {},
  performanceLabels: {},

  // Fehler-Index (Seitenleiste)
  // navEntries wird bei jedem renderAll() neu aufgebaut und hält je Eintrag eine
  // Referenz auf das Fehler-Objekt. Darüber wird der angesprungene Eintrag nach
  // einem Neuaufbau wiedergefunden — eine laufende Nummer taugt dafür nicht,
  // weil sich die Reihenfolge mit jedem neuen Fehler verschiebt.
  navEntries: [],
  currentEntry: null,
  indexVisible: localStorage.getItem('keasy-index-visible') !== 'off',
  indexSide: localStorage.getItem('keasy-index-side') === 'right' ? 'right' : 'left',
  indexCritOnly: localStorage.getItem('keasy-index-crit') === 'on',
  // Auf-/Zu-Zustand der Quellen teilt sich der Index mit der Hauptansicht
  // (collapsedSources weiter oben) — zwei Gedächtnisse liefen auseinander.

  // Papierkorb
  trashData: {},
  trashTotalCount: 0,
  trashRevision: 0,
  trashCollapsed: true,

  // Config
  currentConfig: null,
  savedConfig: null,
  configFilterPatterns: [],
  configThresholdRules: [],
  configPriorityRules: [],
  // Auf-/Zu-Zustand der Hinweistexte im Tab „Regeln".
  // Gespeichert werden nur die offenen — die Vorgabe „eingeklappt" gilt damit
  // ohne Sonderfall, auch für später hinzukommende Karten.
  hintsOpen: JSON.parse(localStorage.getItem('keasy-hints-open') || '{}'),

  // Date Filter
  currentDateStr: '',
  timeFilterHours: 0,

  // UI
  serverStopped: false,
  ws: null,

  // CSS Editor
  cssLoaded: false,
  cssDirty: false,
  cssSavedContent: '',
  cssCurrentTab: 'general',

  // Docs
  docsLoaded: false,

  // Notifications
  notificationsEnabled: localStorage.getItem('keasy-notifications') !== 'off',
  lastNotificationTime: 0,
  // Eigener Zeitstempel für kritische Meldungen — sonst hungert eine Flut
  // normaler Fehler die kritische Benachrichtigung aus
  lastCriticalNotificationTime: 0,

  // Preload
  preloadHideTimer: null,

  // Auth
  currentUser: null,
  authEnabled: true
};
