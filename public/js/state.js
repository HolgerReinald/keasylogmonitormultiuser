window.Keasy = window.Keasy || {};

window.Keasy.state = {
  // Monitor
  errors: {},
  fileLabels: {},
  oversizedFiles: {},
  maxLogFileSizeMB: 6,
  paused: false,
  totalErrors: 0,
  searchTerm: '',
  searchRegex: null,

  // Sources
  pausedSources: new Set(),
  emailDisabledSources: new Set(),
  emailConfiguredSources: new Set(),
  nextEmailSendTime: null,
  collapsedSources: JSON.parse(localStorage.getItem('keasy-collapsed-sources') || '{}'),

  // Analyse
  analyzeErrors: {},
  analyzeLabels: {},
  analyzeUser: '',
  analyzePaths: [],
  analyzeIsRunning: false,

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

  // Preload
  preloadHideTimer: null,

  // Auth
  currentUser: null,
  authEnabled: true
};
