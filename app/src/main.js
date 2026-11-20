// MeTube Mobile Application & Desktop Simulator Controller
import { api, getServerUrl, setServerUrl, DEFAULT_SERVER_URL, startServerKeepAlive, getDeviceId } from './api.js';

// Live In-App System Diagnostics & Log Interceptor
export const capturedLogs = [];
const MAX_LOGS = 250;
function logToSystem(level, ...args) {
  const ts = new Date().toISOString().substring(11, 19);
  const text = args.map(a => {
    try {
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack || ''}`;
      if (typeof a === 'object') return JSON.stringify(a);
      return String(a);
    } catch (_) {
      return String(a);
    }
  }).join(' ');
  capturedLogs.push(`[${ts}] [${level}] ${text}`);
  if (capturedLogs.length > MAX_LOGS) capturedLogs.shift();
  const box = document.getElementById('diag-log-container');
  if (box) {
    box.textContent = capturedLogs.join('\n');
    box.scrollTop = box.scrollHeight;
  }
}

const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
const origErr = console.error.bind(console);
console.log = (...args) => { origLog(...args); logToSystem('INFO', ...args); };
console.warn = (...args) => { origWarn(...args); logToSystem('WARN', ...args); };
console.error = (...args) => { origErr(...args); logToSystem('ERR', ...args); };
window.addEventListener('error', (e) => { logToSystem('WINDOW_ERR', e.message, `${e.filename}:${e.lineno}`); });
window.addEventListener('unhandledrejection', (e) => { logToSystem('PROMISE_REJECT', e.reason); });
console.log('[System] MeTube pure mobile engine initialized.');

// Background Play & Lockscreen Support: Prevent WebView / YouTube from pausing when minimized or screen locked
try {
  Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
} catch (_) {}
document.addEventListener('visibilitychange', (e) => { e.stopImmediatePropagation(); }, true);
window.addEventListener('visibilitychange', (e) => { e.stopImmediatePropagation(); }, true);
window.addEventListener('pagehide', (e) => { e.stopImmediatePropagation(); }, true);

// Fast return to foreground resync: if audio is playing in background, seamlessly snap video to match
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.activeVideo) {
    if (window.onAppForegroundResume) {
      window.onAppForegroundResume();
    }
  }
});

// Web Audio Keep-Alive: Keeps the Android audio sink active with zero hardware shutdown delay
let _keepAliveAudioCtx = null;
export function ensureAudioKeepAlive() {
  try {
    if (!_keepAliveAudioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        _keepAliveAudioCtx = new AudioCtx();
        const osc = _keepAliveAudioCtx.createOscillator();
        const gain = _keepAliveAudioCtx.createGain();
        gain.gain.value = 0.00001;
        osc.connect(gain);
        gain.connect(_keepAliveAudioCtx.destination);
        osc.start();
      }
    }
    if (_keepAliveAudioCtx && _keepAliveAudioCtx.state === 'suspended') {
      _keepAliveAudioCtx.resume().catch(() => {});
    }
  } catch (_) {}
}

// Modern Minimalist SVG Iconography (Zero Emojis)
export const ICONS = {
  play: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2.5"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  chevronDown: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  chevronUp: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  headphones: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  dotsVertical: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>',
  fullscreenEnter: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>',
  fullscreenExit: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6m0 0v6m0-6l-7 7m17-11h-6m0 0V4m0 6l7-7"/></svg>',
  volumeHigh: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
  volumeMute: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
  thumbsUp: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>',
  thumbsDown: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>',
  share: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  shorts: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M17.77 10.32l-1.2-.5a3.9 3.9 0 0 0-5.18-1.57l-.39.22V6.5A4.5 4.5 0 0 0 6.5 2C4 2 2 4 2 6.5v11A4.5 4.5 0 0 0 6.5 22c1.78 0 3.33-1.04 4.07-2.55l1.2.5a3.9 3.9 0 0 0 5.18-1.57l3.05-5.28a3.9 3.9 0 0 0-2.23-2.78zM10 14.5v-5l4.5 2.5-4.5 2.5z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  subscriptions: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M5 4h14M8 1h8"/><polygon points="10 11 15 14 10 17 10 11" fill="currentColor"/></svg>',
  playlists: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" width="16" height="16" fill="#FF0000"><polygon points="7 4 19 12 7 20 7 4"/></svg>',
  video: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'
};

// App State
const state = {
  activeTab: 'home',
  activeCategory: 'all',
  searchQuery: '',
  videos: [],
  shorts: [],
  shortsList: [],
  currentShortIndex: 0,
  isShortMuted: false,
  downloads: [],
  activeVideo: null,
  activeChannel: null,
  selectedFormat: { type: 'mp3', quality: '320k', label: 'MP3 High (320 kbps)' },
  isSubscribed: false,
  isAudioMode: (() => { try { return localStorage.getItem('metube_bg_play') !== '0'; } catch (_) { return true; } })(),
  isLooping: false,
  targetActionVideo: null,
  suggestedVideos: [],
  feedPage: 1,
  feedNextToken: '',
  emptyPageStreak: 0,
  shortsPage: 1,
  shortsNextToken: '',
  shortsSeenIds: [],
  shortsSessionSeed: Date.now(),
  selectedQuality: 'auto',
  playbackRate: 1.0,
  autoplay: true,
  captionsOn: false,
  fullscreenLandscape: false,
  nativeDmProgress: {},
  availableResolutions: [360, 480, 720],
  isLoadingFeed: false,
  isLoadingMore: false,
  hasMore: true,
  playbackEngine: 'youtube',
  activeFeedSessionToken: 0,
  activeSearchSessionToken: 0
};

let currentFeedSessionToken = 0;
let currentSearchSessionToken = 0;

// Formatting helpers
function formatViews(views) {
  if (!views) return 'Trending';
  const num = Number(views);
  if (isNaN(num)) return views;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M views`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(0)}k views`;
  return `${num} views`;
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const secs = parseInt(seconds, 10);
  if (isNaN(secs)) return seconds;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}:${remMins.toString().padStart(2, '0')}:${remSecs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${remSecs.toString().padStart(2, '0')}`;
}

export function showToast(message, duration = 2800) {
  let toast = document.getElementById('metube-global-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'metube-global-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 74px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: rgba(28, 28, 28, 0.95);
      color: #FFFFFF;
      padding: 10px 18px;
      border-radius: 24px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      border: 1px solid rgba(255,255,255,0.15);
      z-index: 99999;
      pointer-events: none;
      opacity: 0;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: 90%;
      text-align: center;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';
  
  if (window._metubeToastTimer) clearTimeout(window._metubeToastTimer);
  window._metubeToastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
  }, duration);
}

// Official Real YouTube Creator Channel Profile Logos
const OFFICIAL_CREATOR_AVATARS = {
  'MrBeast': 'https://yt3.googleusercontent.com/nxYrc_1_2f77DoBadyxMTmv7ZpRZapHR5jbuYe7PlPd5cIRJxtNNEYyOC0ZsxaDyJJzXrnJiuDE=s176-c-k-c0x00ffffff-no-rj',
  'PewDiePie': 'https://yt3.googleusercontent.com/vik8mAiwHQbXiFyKfZ3__p55_VBdGvwxPpuPJBBwdbF0PjJxikXhrP-C3nLQAMAxGNd_-xQCIg=s176-c-k-c0x00ffffff-no-rj',
  'MKBHD': 'https://yt3.googleusercontent.com/qu4TmIaYUlS41-dJ9gZ7DUR3nilvmB5_11i6OKSdvNnBNiyOusZP1bMN6ICnuxtjFBb6ioKgRQ=s176-c-k-c0x00ffffff-no-rj',
  'Lofi Girl': 'https://yt3.googleusercontent.com/IcZW-YBFLCGKQ7BvC8yevab9YAG1SmkEwCd80kcYrhwb0dH39Trfp3DMsI5ZJCsp9wTE60OH428=s176-c-k-c0x00ffffff-no-rj',
  'Veritasium': 'https://yt3.googleusercontent.com/7vCbvtCqtjQ3YLgsJt7Y952MQV1sBvhllSCSxHP8_sVZdcPCBrITfhkN2RdyCuwPnsByq-1GoA=s176-c-k-c0x00ffffff-no-rj',
  'T-Series': 'https://yt3.googleusercontent.com/VunTf0NzCeboiPjbesBdnQuxaF3Lja7UGRbBGQAWRJgMSTj9TTLO3pS1X9qPOJGCNnmPrXeY=s176-c-k-c0x00ffffff-no-rj',
  'TED-Ed': 'https://yt3.googleusercontent.com/PKUi-Lc3VFjUfsIhjK3n-FJDNBf-XQLdg4G4bv4fPFF96D3MVnkbub9ePpLoWdmdFgl5I1Zd=s176-c-k-c0x00ffffff-no-rj',
  'Rick Astley': 'https://yt3.googleusercontent.com/_ShEGOdg-t5YGJse14Ooq6FYBZqX_QSlhaTNjG06miYusm5lWm1UroLyVxnYtahADfRTVLtuVQ=s176-c-k-c0x00ffffff-no-rj'
};

export function getSvgAvatarDataUrl(name) {
  const clean = (name || 'M').replace(/^@+/, '').trim();
  const initial = (clean[0] || 'M').toUpperCase();
  let hash = 0;
  for (let i = 0; i < clean.length; i++) hash = clean.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88" viewBox="0 0 88 88"><rect width="88" height="88" rx="44" fill="hsl(${hue},45%,28%)"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="system-ui,-apple-system,sans-serif" font-size="38" font-weight="700">${initial.replace(/[<>&"']/g, '')}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function getAvatarFallback(channelName) {
  const clean = (channelName || 'Creator').trim();
  if (OFFICIAL_CREATOR_AVATARS[clean]) {
    return OFFICIAL_CREATOR_AVATARS[clean];
  }
  return getSvgAvatarDataUrl(clean);
}

export function resolveAvatarUrl(avatar, channelName, channelId) {
  const clean = (channelName || 'Creator').trim();
  let a = avatar ? String(avatar).trim() : '';
  if (a.startsWith('//')) a = 'https:' + a;
  if (a && a.startsWith('http') && !a.includes('localhost') && !a.includes('127.0.0.1') && !a.includes('default-user') && !a.includes('default_user')) {
    return a;
  }
  if (a && (a.startsWith('data:image/svg+xml') || a.startsWith('<svg'))) {
    if (a.startsWith('<svg')) {
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(a);
    }
    return a;
  }
  if (OFFICIAL_CREATOR_AVATARS[clean]) {
    return OFFICIAL_CREATOR_AVATARS[clean];
  }
  // Fall back to server's live resolver which fetches real channel avatar via Innertube
  const server = getServerUrl();
  return `${server}/api/channel/avatar?name=${encodeURIComponent(clean)}&id=${encodeURIComponent(channelId || '')}&raw=1`;
}

export function attachAvatarHandlers(imgEl, channelName, channelId) {
  if (!imgEl) return;
  imgEl.referrerPolicy = 'no-referrer';
  imgEl.onerror = () => {
    if (!imgEl.dataset.avatarRetried) {
      imgEl.dataset.avatarRetried = '1';
      imgEl.src = api.getChannelAvatarRefreshUrl(channelId || '', channelName || '', true);
      return;
    }
    imgEl.onerror = null;
    imgEl.src = getSvgAvatarDataUrl(channelName);
  };
  imgEl.addEventListener('load', () => {
    if (imgEl.naturalWidth > 0 && imgEl.naturalWidth < 4) {
      if (!imgEl.dataset.avatarRetried) {
        imgEl.dataset.avatarRetried = '1';
        imgEl.src = api.getChannelAvatarRefreshUrl(channelId || '', channelName || '', true);
      } else {
        imgEl.src = getSvgAvatarDataUrl(channelName);
      }
    }
  });
}

function getChannelAvatarUrl(channelName, channelId) {
  return resolveAvatarUrl(null, channelName, channelId);
}

export function getSvgBannerDataUrl(channelName) {
  const clean = (channelName || 'Creator').trim();
  const gradients = [
    ['#1a1a2e', '#16213e'],
    ['#0f2027', '#203a43'],
    ['#2c3e50', '#000000'],
    ['#1f1c2c', '#928dab'],
    ['#141e30', '#243b55'],
    ['#232526', '#414345']
  ];
  let h = 0;
  for (let i = 0; i < clean.length; i++) h = (h * 31 + clean.charCodeAt(i)) >>> 0;
  const [c1, c2] = gradients[h % gradients.length];
  const safe = clean.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="320" viewBox="0 0 1200 320">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
      <linearGradient id="sh" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="rgba(0,0,0,0.6)"/>
        <stop offset="100%" stop-color="transparent"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="320" fill="url(#bg)"/>
    <circle cx="1100" cy="60" r="180" fill="rgba(255,255,255,0.04)"/>
    <circle cx="100" cy="280" r="140" fill="rgba(255,255,255,0.03)"/>
    <rect width="1200" height="320" fill="url(#sh)"/>
    <text x="60" y="270" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="28" font-weight="800" fill="rgba(255,255,255,0.9)">${safe}</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export function resolveBannerUrl(banner, channelName, channelId) {
  const clean = (channelName || 'Creator').trim();
  let b = banner ? String(banner).trim() : '';
  if (b.startsWith('//')) b = 'https:' + b;
  if (b && b.startsWith('http') && !b.includes('localhost') && !b.includes('127.0.0.1')) {
    return b;
  }
  if (b && (b.startsWith('data:image/svg+xml') || b.startsWith('<svg'))) {
    if (b.startsWith('<svg')) {
      return 'data:image/svg+xml;utf8,' + encodeURIComponent(b);
    }
    return b;
  }
  const server = getServerUrl();
  return `${server}/api/channel/banner?id=${encodeURIComponent(channelId || '')}&name=${encodeURIComponent(clean)}&raw=1`;
}

export function attachBannerHandlers(imgEl, channelName, channelId) {
  if (!imgEl) return;
  imgEl.referrerPolicy = 'no-referrer';
  imgEl.alt = '';
  imgEl.onerror = () => {
    if (!imgEl.dataset.bannerRetried) {
      imgEl.dataset.bannerRetried = '1';
      const server = getServerUrl();
      const clean = (channelName || 'Creator').trim();
      imgEl.src = `${server}/api/channel/banner?id=${encodeURIComponent(channelId || '')}&name=${encodeURIComponent(clean)}&raw=1&refresh=1`;
      return;
    }
    imgEl.onerror = null;
    imgEl.src = getSvgBannerDataUrl(channelName);
  };
  imgEl.addEventListener('load', () => {
    if (imgEl.naturalWidth > 0 && imgEl.naturalWidth < 10) {
      if (!imgEl.dataset.bannerRetried) {
        imgEl.dataset.bannerRetried = '1';
        const server = getServerUrl();
        const clean = (channelName || 'Creator').trim();
        imgEl.src = `${server}/api/channel/banner?id=${encodeURIComponent(channelId || '')}&name=${encodeURIComponent(clean)}&raw=1&refresh=1`;
      } else {
        imgEl.src = getSvgBannerDataUrl(channelName);
      }
    }
  });
}

function getChannelBannerUrl(channelName, channelId) {
  return resolveBannerUrl(null, channelName, channelId);
}

// Subscriptions Management System (Clean User-Only Subscriptions)
const SUBSCRIPTIONS_KEY = 'metube_subscriptions';

function getSubscriptions() {
  try {
    const raw = localStorage.getItem(SUBSCRIPTIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Automatically purge any hardcoded default channel sets
        const defaultNames = ['MrBeast', 'PewDiePie', 'MKBHD', 'Lofi Girl', 'Veritasium', 'T-Series', 'TED-Ed'];
        const isLegacyDefault = parsed.some(s => defaultNames.includes(s.name));
        if (isLegacyDefault) {
          localStorage.removeItem(SUBSCRIPTIONS_KEY);
          return [];
        }
        return parsed;
      }
    }
  } catch (e) {}
  return [];
}

function isChannelSubscribed(channelId, channelName) {
  const subs = getSubscriptions();
  return subs.some((s) => (channelId && s.id === channelId) || (channelName && s.name.toLowerCase() === channelName.toLowerCase()));
}

function toggleChannelSubscription(creator) {
  if (!creator || (!creator.name && !creator.channel)) return false;
  const cName = creator.name || creator.channel;
  const cId = creator.id || creator.channel_id || '';
  const cAvatar = creator.avatar || creator.channel_avatar || '';
  let subs = getSubscriptions();
  const index = subs.findIndex((s) => (cId && s.id === cId) || s.name.toLowerCase() === cName.toLowerCase());
  let nowSubscribed = false;

  if (index >= 0) {
    subs.splice(index, 1);
    nowSubscribed = false;
    api.unsubscribe(cId || cName, cName).catch((err) => console.debug('Online unsubscribe sync:', err));
  } else {
    subs.unshift({ id: cId, name: cName, avatar: cAvatar });
    nowSubscribed = true;
    api.subscribe(cId || cName, cName).catch((err) => console.debug('Online subscribe sync:', err));
  }

  try {
    localStorage.setItem(SUBSCRIPTIONS_KEY, JSON.stringify(subs));
  } catch (e) {}

  renderSubscriptionsBar();
  return nowSubscribed;
}

function renderSubscriptionsBar() {
  const listElem = document.getElementById('subscriptions-scroll-list');
  const subBar = document.getElementById('subscriptions-bar');
  if (subBar) subBar.style.display = 'none';
  if (listElem) listElem.innerHTML = '';
}

// Watch History & Dynamic Feed Personalization System
const WATCH_HISTORY_KEY = 'metube_watch_history';

function getWatchHistory() {
  try {
    const raw = localStorage.getItem(WATCH_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveToWatchHistory(video) {
  if (!video || !video.id) return;
  try {
    const list = getWatchHistory();
    const filtered = list.filter((v) => v.id !== video.id);
    filtered.unshift({
      id: video.id,
      title: video.title || 'Untitled',
      channel: video.channel || 'Creator',
      channel_id: video.channel_id || '',
      thumbnail: video.thumbnail || '',
      duration: video.duration || '',
      duration_string: video.duration_string || '',
      view_count: video.view_count || '',
      channel_avatar: video.channel_avatar || '',
      watchedAt: Date.now()
    });
    localStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(filtered.slice(0, 50)));
  } catch (e) {}
}

function getRecentInterestKeywords() {
  const history = getWatchHistory();
  if (history.length === 0) return null;
  const keywords = [];
  const recent = history.slice(0, 10);
  for (const item of recent) {
    if (item.channel && item.channel !== 'Creator' && item.channel !== 'Unknown Channel') {
      keywords.push(item.channel);
    }
    if (item.title) {
      const words = item.title
        .replace(/[^\w\s]/gi, '')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !['official', 'video', 'full', 'song', 'music', 'best', '2025', '2026', 'trending', 'shorts'].includes(w.toLowerCase()));
      if (words.length > 0) {
        keywords.push(words.slice(0, 2).join(' '));
      }
    }
  }
  return keywords.length > 0 ? keywords[Math.floor(Math.random() * Math.min(keywords.length, 6))] : null;
}

// =========================================================
// 1. DESKTOP SIMULATOR & DEVICE CONTROLS
// =========================================================
function initSimulator() {
  const deviceSelect = document.getElementById('device-select');
  const chassis = document.getElementById('phone-chassis');
  const notchBtn = document.getElementById('btn-toggle-notch');
  const notch = document.getElementById('phone-notch');
  const clock = document.getElementById('live-clock');
  const toolbar = document.getElementById('desktop-toolbar');
  const collapseBtn = document.getElementById('btn-collapse-toolbar');
  const togglePill = document.getElementById('sim-toggle-pill');

  // Update live clock
  function updateClock() {
    const now = new Date();
    const hrs = now.getHours().toString().padStart(2, '0');
    const mins = now.getMinutes().toString().padStart(2, '0');
    if (clock) clock.textContent = `${hrs}:${mins}`;
  }
  updateClock();
  setInterval(updateClock, 10000);

  // Collapse / Show Simulator Toolbar
  collapseBtn?.addEventListener('click', () => {
    toolbar.classList.add('collapsed');
    if (togglePill) togglePill.style.display = 'block';
  });

  togglePill?.addEventListener('click', () => {
    toolbar.classList.remove('collapsed');
    togglePill.style.display = 'none';
  });

  // Device switcher
  if (deviceSelect && chassis) {
    deviceSelect.addEventListener('change', (e) => {
      chassis.className = `phone-chassis ${e.target.value}`;
    });
  }

  // Toggle Notch
  if (notchBtn && notch) {
    notchBtn.addEventListener('click', () => {
      notch.style.display = notch.style.display === 'none' ? 'flex' : 'none';
    });
  }

  // Auto-detect mobile device or small viewport
  function isNativeOrMobileViewport() {
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    const isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    const minSide = Math.min(window.innerWidth || 9999, window.innerHeight || 9999);
    return isCapacitor || isMobileUA || minSide < 768;
  }

  function checkMobileViewport() {
    if (isNativeOrMobileViewport()) {
      document.body.classList.add('is-mobile-device');
      if (chassis) chassis.className = 'phone-chassis device-fullscreen';
      if (deviceSelect) deviceSelect.value = 'device-fullscreen';
    } else {
      document.body.classList.remove('is-mobile-device');
    }
  }
  checkMobileViewport();
  window.addEventListener('resize', checkMobileViewport);

  // Reload feed button
  document.getElementById('btn-refresh-feed')?.addEventListener('click', () => {
    loadFeed(state.activeCategory);
  });
}

// =========================================================
// 2. SERVER HEALTH & PING
// =========================================================
async function checkServerHealth() {
  const pill = document.getElementById('server-status-indicator');
  const text = document.getElementById('server-status-text');
  try {
    await api.checkHealth();
    if (pill) pill.className = 'server-status-pill';
    if (text) text.textContent = 'Cloud Online';
  } catch (err) {
    if (pill) pill.className = 'server-status-pill offline';
    if (text) text.textContent = 'Offline';
  }
}

// =========================================================
// 3. NAVIGATION & TABS
// =========================================================
function initNavigation() {
  updateNavYouAvatar();
  // Bottom Tab Buttons
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Header Brand Logo click goes to Home
  document.getElementById('brand-home-btn')?.addEventListener('click', () => {
    switchTab('home');
    state.searchQuery = '';
    loadFeed('all');
  });

  // Header Notifications shortcut: Open authentic notifications modal & clear badge dot
  const notifModal = document.getElementById('notifications-modal');
  const closeNotifBtn = document.getElementById('btn-close-notif-modal');
  const clearNotifsBtn = document.getElementById('btn-clear-notifs');
  const notifDot = document.getElementById('header-notif-dot');

  const openNotifs = () => {
    if (notifDot) notifDot.style.display = 'none';
    if (notifModal) {
      notifModal.style.display = 'flex';
      notifModal.classList.add('open');
      syncNativeOverlayFlag();
    }
  };

  const closeNotifs = () => {
    if (notifModal) {
      notifModal.classList.remove('open');
      notifModal.style.display = 'none';
      syncNativeOverlayFlag();
    }
  };

  document.getElementById('btn-header-notifications')?.addEventListener('click', openNotifs);
  closeNotifBtn?.addEventListener('click', closeNotifs);
  clearNotifsBtn?.addEventListener('click', () => {
    showToast('Notifications marked as read');
    closeNotifs();
  });
  notifModal?.addEventListener('click', (e) => {
    if (e.target === notifModal) closeNotifs();
  });

  // Header Downloads shortcut
  document.getElementById('btn-header-downloads')?.addEventListener('click', () => {
    switchTab('downloads');
  });

  // Header Create shortcut
  document.getElementById('btn-header-create')?.addEventListener('click', () => {
    switchTab('downloads');
  });

  // Sidebar Open/Close
  const sidebar = document.getElementById('sidebar-overlay');
  document.getElementById('btn-open-sidebar')?.addEventListener('click', () => {
    sidebar.classList.add('open');
    syncNativeOverlayFlag();
  });
  document.getElementById('btn-close-sidebar')?.addEventListener('click', () => {
    sidebar.classList.remove('open');
    syncNativeOverlayFlag();
  });
  sidebar?.addEventListener('click', (e) => {
    if (e.target === sidebar) {
      sidebar.classList.remove('open');
      syncNativeOverlayFlag();
    }
  });

  // Sidebar Links
  document.querySelectorAll('.sidebar-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const action = link.dataset.action;
      sidebar.classList.remove('open');
      if (action === 'home') {
        switchTab('home');
        loadFeed('all');
      } else if (action === 'downloads') {
        switchTab('downloads');
      } else if (action === 'history') {
        switchTab('history');
      } else if (action === 'subscriptions') {
        switchTab('home');
        document.getElementById('subscriptions-bar')?.scrollIntoView({ behavior: 'smooth' });
      } else if (action === 'settings') {
        switchTab('settings');
      } else if (action && action.startsWith('cat-')) {
        const cat = action.replace('cat-', '');
        switchTab('home');
        selectCategory(cat);
      }
    });
  });

  // Category Filter Pills
  document.querySelectorAll('.cat-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const cat = pill.dataset.cat;
      if (cat === 'subs') {
        switchTab('subscriptions');
      } else if (cat) {
        selectCategory(cat);
      }
    });
  });

  // Search Bar Controls (Expandable Mobile Mode & Desktop)
  const header = document.getElementById('metube-header');
  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');
  const clearBtn = document.getElementById('btn-clear-search');
  const openSearchBtn = document.getElementById('btn-open-search');
  const closeSearchBtn = document.getElementById('btn-close-search');
  const banner = document.getElementById('search-banner');
  const bannerQuery = document.getElementById('search-banner-query');
  const exitSearchBtn = document.getElementById('btn-exit-search');

  openSearchBtn?.addEventListener('click', () => {
    header?.classList.add('search-mode-open');
    searchInput?.focus();
  });

  closeSearchBtn?.addEventListener('click', () => {
    header?.classList.remove('search-mode-open');
    if (state.searchQuery) {
      state.searchQuery = '';
      state.searchChannel = null;
      if (searchInput) searchInput.value = '';
      if (clearBtn) clearBtn.style.display = 'none';
      syncNativeOverlayFlag();
      loadFeed('all');
    }
  });

  searchInput?.addEventListener('input', () => {
    if (clearBtn) clearBtn.style.display = searchInput.value ? 'flex' : 'none';
  });

  searchInput?.addEventListener('paste', () => {
    setTimeout(() => {
      const val = (searchInput.value || '').trim();
      const directVideoId = extractYouTubeVideoId(val);
      if (directVideoId) {
        searchInput.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        header?.classList.remove('search-mode-open');
        showToast('Opening pasted YouTube video...');
        openVideoById(directVideoId);
      } else if (/^https?:\/\/\S+/i.test(val)) {
        searchInput.value = '';
        if (clearBtn) clearBtn.style.display = 'none';
        header?.classList.remove('search-mode-open');
        openUniversalUrl(val);
      }
    }, 60);
  });

  clearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.style.display = 'none';
    searchInput.focus();
  });

  const pasteBtn = document.getElementById('btn-paste-search-link');
  pasteBtn?.addEventListener('click', async () => {
    try {
      let text = '';
      if (navigator.clipboard && navigator.clipboard.readText) {
        try { text = await navigator.clipboard.readText(); } catch (_) {}
      }
      if (!text) {
        text = prompt('Paste YouTube or any video URL here:');
      }
      if (text) {
        const cleanText = text.trim();
        const directVideoId = extractYouTubeVideoId(cleanText);
        if (directVideoId) {
          showToast('Opening pasted YouTube video...');
          header?.classList.remove('search-mode-open');
          openVideoById(directVideoId);
        } else if (/^https?:\/\/\S+/i.test(cleanText)) {
          header?.classList.remove('search-mode-open');
          openUniversalUrl(cleanText);
        } else {
          searchInput.value = cleanText;
          if (clearBtn) clearBtn.style.display = 'flex';
          searchForm?.dispatchEvent(new Event('submit', { cancelable: true }));
        }
      }
    } catch (_) {
      const manual = prompt('Paste YouTube or any video URL here:');
      if (manual) {
        const clean = manual.trim();
        const vid = extractYouTubeVideoId(clean);
        if (vid) openVideoById(vid);
        else if (/^https?:\/\/\S+/i.test(clean)) openUniversalUrl(clean);
      }
    }
  });

  searchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = (searchInput.value || '').trim();
    if (!query) return;

    // Immediately dismiss mobile keyboard and edit handle
    searchInput?.blur();
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard) {
        window.Capacitor.Plugins.Keyboard.hide();
      }
    } catch (_) {}

    // Direct YouTube Link or Video ID paste detection
    const directVideoId = extractYouTubeVideoId(query);
    if (directVideoId) {
      searchInput.value = '';
      if (clearBtn) clearBtn.style.display = 'none';
      header?.classList.remove('search-mode-open');
      showToast('Opening direct YouTube link...');
      openVideoById(directVideoId);
      return;
    }

    // Any external platform URL (Instagram, Facebook, TikTok, X, SoundCloud, etc.)
    if (/^https?:\/\/\S+/i.test(query)) {
      searchInput.value = '';
      if (clearBtn) clearBtn.style.display = 'none';
      header?.classList.remove('search-mode-open');
      openUniversalUrl(query);
      return;
    }

    state.searchQuery = query;
    // Keep search mode open so query stays visible in header search bar, just like real YouTube
    header?.classList.add('search-mode-open');
    if (clearBtn) clearBtn.style.display = 'flex';
    syncNativeOverlayFlag();
    loadFeedSearchResults(query);
  });

  const searchSubmitBtn = searchForm?.querySelector('.search-submit-btn');
  searchSubmitBtn?.addEventListener('click', () => {
    searchInput?.blur();
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard) {
        window.Capacitor.Plugins.Keyboard.hide();
      }
    } catch (_) {}
  });

  exitSearchBtn?.addEventListener('click', () => {
    state.searchQuery = '';
    state.searchChannel = null;
    searchInput.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    header?.classList.remove('search-mode-open');
    syncNativeOverlayFlag();
    loadFeed('all');
  });

  // Continuous Feed Loading / Infinite Scroll on #content-viewport
  const viewport = document.getElementById('content-viewport');
  viewport?.addEventListener('scroll', () => {
    if (state.activeTab !== 'home') return;
    if (state.isLoadingMore || !state.hasMore) return;
    const threshold = 350;
    if (viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - threshold) {
      loadMoreFeedVideos();
    }
  });

  // Instant cache load for download counter
  try {
    const cached = localStorage.getItem('metube_downloads_cache');
    if (cached) {
      const items = JSON.parse(cached);
      const activeCount = items.filter(
        (d) => d.status === 'downloading' || d.status === 'queued' || d.status === 'converting'
      ).length;
      const counter = document.getElementById('nav-download-counter');
      if (counter && activeCount > 0) {
        counter.style.display = 'inline-block';
        counter.textContent = activeCount;
      }
    }
  } catch (e) {}
}

function switchTab(tabId) {
  if (tabId !== 'shorts') {
    closeShortsReel();
  }

  state.activeTab = tabId;

  if (tabId === 'shorts') {
    openShortsFeedReel();
    return;
  }

  // Update Bottom Nav active state
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });

  // View sections visibility
  const viewHome = document.getElementById('view-home');
  const viewDownloads = document.getElementById('view-downloads');
  const viewSubscriptions = document.getElementById('view-subscriptions');
  const viewHistory = document.getElementById('view-history');
  const viewSettings = document.getElementById('view-settings');
  const catBar = document.getElementById('category-bar');
  const subBar = document.getElementById('subscriptions-bar');

  if (viewHome) viewHome.style.display = tabId === 'home' ? 'block' : 'none';
  if (viewDownloads) viewDownloads.style.display = tabId === 'downloads' ? 'block' : 'none';
  if (viewSubscriptions) viewSubscriptions.style.display = tabId === 'subscriptions' ? 'block' : 'none';
  if (viewHistory) viewHistory.style.display = tabId === 'history' ? 'block' : 'none';
  if (viewSettings) viewSettings.style.display = tabId === 'settings' ? 'block' : 'none';
  
  const showBars = tabId === 'home' && !state.searchQuery;
  if (catBar) catBar.style.display = showBars ? 'flex' : 'none';
  if (subBar) subBar.style.display = 'none'; // Subscriptions story bar removed from Home

  if (tabId === 'downloads') {
    loadDownloadsList();
  } else if (tabId === 'subscriptions') {
    loadSubscriptionsView();
  } else if (tabId === 'history') {
    loadHistoryView();
  } else if (tabId === 'settings') {
    initSettingsView();
  }
  syncNativeOverlayFlag();
}

function loadHistoryView() {
  const container = document.getElementById('history-feed-list');
  if (!container) return;
  const history = getWatchHistory();

  if (history.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:50px 20px; color:var(--text-gray);">
        <div style="margin-bottom:12px; color:var(--text-gray);">${ICONS.clock}</div>
        <div style="font-size:15px; font-weight:700; color:#FFF;">No watch history yet</div>
        <div style="font-size:12px; margin-top:6px; max-width:280px; margin-left:auto; margin-right:auto; line-height:18px;">
          Videos you play in MeTube will appear here and dynamically personalize your Home feed!
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  history.forEach((video) => {
    container.appendChild(createVideoCardElement(video));
  });
}

function selectCategory(category) {
  state.activeCategory = category;
  state.searchQuery = '';
  const banner = document.getElementById('search-banner');
  if (banner) banner.style.display = 'none';
  const searchInp = document.getElementById('search-input');
  if (searchInp) searchInp.value = '';

  document.querySelectorAll('.cat-pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.cat === category);
  });

  syncNativeOverlayFlag();
  loadFeed(category);
}

// =========================================================
// 4. FEED RENDERING (CLEAN SPINNER ONLY, NO TEXT!)
// =========================================================
async function loadFeed(category = 'all') {
  if (state.isLoadingFeed) return;
  if (state.searchQuery) return; // Do not overwrite active search results!
  state.isLoadingFeed = true;

  const thisFeedToken = ++currentFeedSessionToken;
  state.activeFeedSessionToken = thisFeedToken;

  const container = document.getElementById('videos-feed-list');
  if (!container) {
    state.isLoadingFeed = false;
    return;
  }
  state.feedPage = 1;
  state.feedNextToken = '';
  state.emptyPageStreak = 0;
  state.hasMore = true;
  state.isLoadingMore = false;

  // 1. Instant Cache-First (0ms Render on App Open & Category Switch)
  const cacheKey = `metube_feed_cache_${category}`;
  let hadCache = false;
  if (!state.searchQuery) {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.videos && parsed.videos.length > 0 && !state.searchQuery && state.activeFeedSessionToken === thisFeedToken) {
          state.videos = parsed.videos;
          state.shorts = parsed.shorts || [];
          renderFeed();
          hadCache = true;
        }
      }
    } catch (_) {}
  }

  // Show spinner only if no cache exists yet and search is not active
  if (!hadCache && !state.searchQuery) {
    container.innerHTML = `
      <div class="spinner-box">
        <div class="spinner"></div>
      </div>
    `;
  }

  try {
    // 1. Authenticated User Personalized Feed: Subscriptions & Watch History
    const hasAccount = Boolean(localStorage.getItem('metube_account_name')) || Boolean(localStorage.getItem('metube_user_authenticated'));
    const userFeedPromise = (hasAccount || category === 'all' || category === 'subs')
      ? api.getUserFeed().catch(() => null)
      : Promise.resolve(null);

    // 2. Watch-History-Driven Dynamic Personalization:
    // If on "all" category, personalize using recent watch interests!
    const interestKw = (category === 'all' && !state.searchQuery) ? getRecentInterestKeywords() : null;

    let trendingPromise;
    if (interestKw) {
      trendingPromise = Promise.all([
        api.search(interestKw, 1).catch(() => ({ videos: [] })),
        api.getTrending(category, 1).catch(() => ({ videos: [] }))
      ]).then(([searchRes, trendRes]) => {
        const searchVids = (searchRes && searchRes.videos) || [];
        const trendVids = (trendRes && trendRes.videos) || [];
        const seen = new Set();
        const merged = [];
        let s = 0, t = 0;
        while ((s < searchVids.length || t < trendVids.length) && merged.length < 30) {
          if (s < searchVids.length) {
            if (!seen.has(searchVids[s].id)) {
              seen.add(searchVids[s].id);
              merged.push(searchVids[s]);
            }
            s++;
          }
          if (t < trendVids.length) {
            if (!seen.has(trendVids[t].id)) {
              seen.add(trendVids[t].id);
              merged.push(trendVids[t]);
            }
            t++;
          }
        }
        return {
          videos: merged.length > 0 ? merged : trendVids,
          next_token: (trendRes && trendRes.next_token) || (searchRes && searchRes.next_token) || ''
        };
      }).catch(() => api.getTrending(category, 1));
    } else {
      trendingPromise = api.getTrending(category, 1);
    }

    const [trendingRes, shortsRes, userFeedRes] = await Promise.all([
      trendingPromise,
      category === 'all' || category === 'shorts'
        ? api.getShorts(1, { interests: interestKw || '', seed: Date.now() })
            .catch(() => api.getTrending('shorts', 1).catch(() => ({ videos: [] })))
        : Promise.resolve({ videos: [] }),
      userFeedPromise
    ]);

    // Check if feed was superseded by search or a newer category request
    if (state.searchQuery || state.activeFeedSessionToken !== thisFeedToken) {
      state.isLoadingFeed = false;
      return;
    }

    let finalVideos = [];
    const seen = new Set();

    // Prioritize authentic personalized feed videos (user's real YouTube account subscriptions & recommendations)
    if (userFeedRes && userFeedRes.videos && userFeedRes.videos.length > 0) {
      for (const v of userFeedRes.videos) {
        if (!seen.has(v.id)) {
          seen.add(v.id);
          finalVideos.push(v);
        }
      }
    }

    // Blend with trending/general recommendations
    const genericVideos = (trendingRes && trendingRes.videos) || [];
    for (const v of genericVideos) {
      if (!seen.has(v.id) && finalVideos.length < 40) {
        seen.add(v.id);
        finalVideos.push(v);
      }
    }

    if (state.searchQuery || state.activeFeedSessionToken !== thisFeedToken) {
      state.isLoadingFeed = false;
      return;
    }

    state.videos = finalVideos.length > 0 ? finalVideos : genericVideos;
    state.feedNextToken = (trendingRes && trendingRes.next_token) || '';
    state.shorts = (shortsRes && (shortsRes.shorts || shortsRes.videos)) || [];

    // Save to instant startup cache
    if (!state.searchQuery && state.videos.length > 0) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ videos: state.videos, shorts: state.shorts }));
      } catch (_) {}
    }

    renderFeed();
  } catch (err) {
    if (state.searchQuery || state.activeFeedSessionToken !== thisFeedToken) {
      return;
    }
    container.innerHTML = `
      <div class="spinner-box">
        <button id="btn-retry-feed" style="background:var(--metube-red); color:#FFF; border:none; padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">Retry</button>
      </div>
    `;
    document.getElementById('btn-retry-feed')?.addEventListener('click', () => loadFeed(category));
  } finally {
    if (state.activeFeedSessionToken === thisFeedToken) {
      state.isLoadingFeed = false;
    }
  }
}

async function loadFeedSearchResults(query) {
  const container = document.getElementById('videos-feed-list');
  if (!container) return;

  const thisSearchToken = ++currentSearchSessionToken;
  state.activeSearchSessionToken = thisSearchToken;
  // Cancel / invalidate any in-flight loadFeed requests immediately!
  state.activeFeedSessionToken = ++currentFeedSessionToken;
  state.isLoadingFeed = false;

  state.feedPage = 1;
  state.feedNextToken = '';
  state.emptyPageStreak = 0;
  state.hasMore = true;
  state.isLoadingMore = false;
  state.searchChannel = null;

  if (typeof switchTab === 'function' && state.activeTab !== 'home') {
    switchTab('home');
  }
  const viewport = document.getElementById('content-viewport');
  if (viewport) {
    viewport.scrollTop = 0;
  }

  // Only show the clean spinner icon, NO text (as requested by user)
  container.innerHTML = `
    <div class="spinner-box" style="padding: 60px 20px; display: flex; align-items: center; justify-content: center;">
      <div class="spinner"></div>
    </div>
  `;

  try {
    const res = await api.search(query, 1);
    if (state.activeSearchSessionToken !== thisSearchToken || state.searchQuery !== query) {
      return;
    }
    state.videos = res.videos || [];
    state.feedNextToken = (res && res.next_token) || '';
    state.searchChannel = (res && res.channel) || null;
    state.shorts = [];
    renderFeed();
  } catch (err) {
    if (state.activeSearchSessionToken !== thisSearchToken || state.searchQuery !== query) {
      return;
    }
    container.innerHTML = `
      <div class="spinner-box" style="flex-direction: column; gap: 12px; padding: 40px 20px;">
        <div style="font-size: 14px; color: var(--text-gray); font-weight: 600;">Unable to load search results</div>
        <button id="btn-retry-search" style="padding: 8px 18px; border-radius: 18px; background: var(--surface-pill); border: 1px solid var(--border); color: var(--text-white); font-weight: 700; cursor: pointer;">Retry Search</button>
      </div>
    `;
    document.getElementById('btn-retry-search')?.addEventListener('click', () => loadFeedSearchResults(query));
  }
}

async function loadMoreFeedVideos() {
  if (state.isLoadingMore || !state.hasMore || state.isLoadingFeed) return;
  if (document.getElementById('feed-bottom-spinner')) return; // Prevent double loading!
  state.isLoadingMore = true;

  const container = document.getElementById('videos-feed-list');
  if (!container) {
    state.isLoadingMore = false;
    return;
  }

  const bottomLoader = document.createElement('div');
  bottomLoader.className = 'feed-loader-bottom';
  bottomLoader.id = 'feed-bottom-spinner';
  bottomLoader.innerHTML = '<div class="spinner"></div>';
  container.appendChild(bottomLoader);

  try {
    const nextPage = state.feedPage + 1;
    let res;
    if (state.searchQuery) {
      res = await api.search(state.searchQuery, nextPage, state.feedNextToken || '');
    } else {
      res = await api.getTrending(state.activeCategory, nextPage, state.feedNextToken || '');
    }

    let newVideos = (res && res.videos) || [];
    let nextTok = (res && res.next_token) || '';
    const existingIds = new Set(state.videos.map((v) => v.id));
    let freshVideos = newVideos.filter((v) => v && v.id && !existingIds.has(v.id));

    // If token returned empty on Home feed, rotate cleanly into next topic page instead of stopping feed!
    if (freshVideos.length === 0 && !state.searchQuery) {
      const fallbackRes = await api.getTrending(state.activeCategory, nextPage + 1, '');
      newVideos = (fallbackRes && fallbackRes.videos) || [];
      nextTok = (fallbackRes && fallbackRes.next_token) || nextTok;
      freshVideos = newVideos.filter((v) => v && v.id && !existingIds.has(v.id));
    }

    bottomLoader.remove();
    state.feedNextToken = nextTok;
    state.feedPage = nextPage;

    if (freshVideos.length === 0) {
      state.emptyPageStreak = (state.emptyPageStreak || 0) + 1;
      if (state.searchQuery && !nextTok && state.emptyPageStreak >= 3) {
        state.hasMore = false;
      } else if (!state.searchQuery) {
        // Continuous infinite feed: Rotate into dynamic YouTube discovery topics so the feed never halts!
        const discoveryTopics = ['trending', 'popular music', 'top gaming', 'viral entertainment', 'tech highlights', 'world news'];
        const topic = discoveryTopics[(state.emptyPageStreak || 0) % discoveryTopics.length];
        try {
          const discRes = await api.search(topic, Math.floor(((state.emptyPageStreak || 0) / discoveryTopics.length) + 1));
          const discVideos = (discRes && discRes.videos) || [];
          const discFresh = discVideos.filter((v) => v && v.id && !existingIds.has(v.id));
          if (discFresh.length > 0) {
            state.emptyPageStreak = 0;
            state.videos.push(...discFresh);
            discFresh.forEach((v) => container.appendChild(createVideoCardElement(v)));
          }
        } catch (_) {}
      }
    } else {
      state.emptyPageStreak = 0;
      state.videos.push(...freshVideos);
      freshVideos.forEach((v) => {
        container.appendChild(createVideoCardElement(v));
      });
    }
  } catch (err) {
    bottomLoader.remove();
    // Do not permanently disable feed on a transient network hiccup
  } finally {
    state.isLoadingMore = false;
  }
}

function renderFeed() {
  const container = document.getElementById('videos-feed-list');
  if (!container) return;
  container.innerHTML = '';

  // 1. If this is a search result and a matching YouTube Channel was found, render Channel Card at top
  if (state.searchQuery && state.searchChannel) {
    try {
      const ch = state.searchChannel;
      const isSub = isChannelSubscribed(ch.channel_id, ch.title);
      const chCard = document.createElement('div');
      chCard.className = 'search-channel-card';
      chCard.innerHTML = `
        <div class="search-channel-header-row">
          <img class="search-channel-avatar" src="${escapeHtml(ch.channel_avatar || './icon.png')}" alt="${escapeHtml(ch.title || 'Creator')}" onerror="this.src='./icon.png'" />
          <div class="search-channel-info">
            <div class="search-channel-title">${escapeHtml(ch.title || 'Creator')}</div>
            <div class="search-channel-meta">${escapeHtml(ch.subscriber_count_text || ch.video_count_text || 'YouTube Channel')}</div>
          </div>
        </div>
        <div class="search-channel-actions">
          <button class="btn-channel-subscribe ${isSub ? 'subscribed' : ''}" id="btn-search-subscribe" data-channel-id="${escapeHtml(ch.channel_id || '')}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M10 20h4c0 1.1-.9 2-2 2s-2-.9-2-2zm10-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C9.63 5.36 8 7.92 8 11v5l-2 2v1h16v-1l-2-2z"/></svg>
            <span class="sub-text">${isSub ? 'Subscribed' : 'Subscribe'}</span>
          </button>
          <button class="btn-channel-action" id="btn-search-view-channel">
            <span>View Channel</span>
          </button>
        </div>
      `;

      chCard.querySelector('.search-channel-header-row')?.addEventListener('click', () => {
        openChannelExplorer({ channel: ch.title, channel_id: ch.channel_id, channel_avatar: ch.channel_avatar });
      });
      chCard.querySelector('#btn-search-view-channel')?.addEventListener('click', () => {
        openChannelExplorer({ channel: ch.title, channel_id: ch.channel_id, channel_avatar: ch.channel_avatar });
      });

      const subBtn = chCard.querySelector('#btn-search-subscribe');
      subBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const nowSubbed = toggleChannelSubscription({
          id: ch.channel_id,
          name: ch.title,
          avatar: ch.channel_avatar
        });
        subBtn.classList.toggle('subscribed', nowSubbed);
        subBtn.querySelector('.sub-text').textContent = nowSubbed ? 'Subscribed' : 'Subscribe';
        showToast(nowSubbed ? `Subscribed to ${ch.title}` : `Unsubscribed from ${ch.title}`);
      });

      container.appendChild(chCard);

      if (state.videos.length > 0) {
        const heading = document.createElement('div');
        heading.className = 'search-section-header';
        heading.textContent = 'Latest videos';
        container.appendChild(heading);
      }
    } catch (chErr) {
      console.warn('Channel card render error:', chErr);
    }
  }

  if (state.videos.length === 0 && !state.searchChannel) {
    if (state.searchQuery) {
      container.innerHTML = `
        <div style="text-align:center; padding:60px 20px; color:var(--text-gray);">
          <div style="font-size:15px; font-weight:700; color:var(--text-white); margin-bottom:6px;">No results found</div>
          <div style="font-size:12px;">Try different keywords or check spelling</div>
        </div>
      `;
      return;
    }
    container.innerHTML = `
      <div class="spinner-box">
        <div class="spinner"></div>
      </div>
    `;
    return;
  }

  const topVideos = state.videos.slice(0, 2);
  const remainingVideos = state.videos.slice(2);

  // Render top 2 videos
  topVideos.forEach((video) => {
    container.appendChild(createVideoCardElement(video));
  });

  // Render Shorts Shelf (only on Home feed, not inside search results)
  if (state.shorts.length > 0 && !state.searchQuery) {
    container.appendChild(createShortsShelfElement(state.shorts));
  }

  // Render remaining videos
  remainingVideos.forEach((video) => {
    container.appendChild(createVideoCardElement(video));
  });

  // Fade out cold-start splash screen smoothly now that feed has rendered
  dismissSplashScreen();
}

export function dismissSplashScreen() {
  const splash = document.getElementById('metube-splash-screen');
  if (splash && !splash.classList.contains('splash-hidden')) {
    splash.classList.add('splash-hidden');
    setTimeout(() => {
      try { splash.remove(); } catch (_) {}
    }, 450);
  }
}
window.dismissSplashScreen = dismissSplashScreen;

function createVideoCardElement(video) {
  const durationText = video.duration_string || formatDuration(video.duration);
  const viewsText = formatViews(video.view_count);
  const channelName = video.channel || 'Creator';
  const avatarUrl = resolveAvatarUrl(video.channel_avatar, channelName, video.channel_id);
  const card = document.createElement('article');
  card.className = 'video-card';

  card.innerHTML = `
    <div class="video-thumb-container">
      <img class="video-thumb-img" src="${video.thumbnail}" alt="${video.title}" loading="lazy" />
      ${durationText ? `<span class="badge-duration">${durationText}</span>` : ''}
    </div>
    <div class="video-info-row">
      <div class="channel-avatar-box">
        <img 
          class="channel-avatar-img" 
          src="${avatarUrl}" 
          alt="${channelName}"
          loading="lazy"
          referrerpolicy="no-referrer"
        />
      </div>
      <div class="video-text-col">
        <div class="video-title-row">
          <h3 class="video-title">${video.title}</h3>
          <div class="video-actions-quick">
            <button class="quick-btn btn-card-dots" title="More options">
              <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
            </button>
          </div>
        </div>
        <div class="video-meta-line">
          <span class="channel-name-link">
            <span>${channelName}</span>
            <span class="verified-icon"><svg viewBox="0 0 24 24"><polygon points="9 16.2 4.8 12 3.4 13.4 9 19 21 7 19.6 5.6 9 16.2"/></svg></span>
          </span>
          <span>•</span>
          <span>${viewsText}</span>
        </div>
      </div>
    </div>
  `;

  // Click card thumbnail / title -> Watch Video
  attachAvatarHandlers(card.querySelector('.channel-avatar-img'), channelName, video.channel_id);
  card.querySelector('.video-thumb-container').addEventListener('click', (e) => {
    e.stopPropagation();
    openVideoPlayer(video);
  });
  card.querySelector('.video-title').addEventListener('click', (e) => {
    e.stopPropagation();
    openVideoPlayer(video);
  });
  card.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('.channel-avatar-box') || e.target.closest('.channel-name-link')) return;
    openVideoPlayer(video);
  });

  // Click channel -> Open Channel Explorer
  card.querySelector('.channel-avatar-box').addEventListener('click', (e) => {
    e.stopPropagation();
    openChannelExplorer(video);
  });
  card.querySelector('.channel-name-link').addEventListener('click', (e) => {
    e.stopPropagation();
    openChannelExplorer(video);
  });

  // Click direct download (if present)
  card.querySelector('.btn-card-download')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openDownloadModal(video);
  });

  // Click 3-dots
  card.querySelector('.btn-card-dots').addEventListener('click', (e) => {
    e.stopPropagation();
    openActionsSheet(video);
  });

  return card;
}

function createShortsShelfElement(shortsList) {
  const shelf = document.createElement('div');
  shelf.className = 'shorts-shelf';

  shelf.innerHTML = `
    <div class="shorts-shelf-header">
      <div class="shorts-shelf-logo">
        <svg viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4"/></svg>
      </div>
      <h2 class="shorts-shelf-title">Shorts</h2>
      <button class="icon-button shorts-shelf-dots" title="More" style="margin-left:auto; width:28px; height:28px;">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
      </button>
    </div>
    <div class="shorts-carousel">
      ${shortsList.map((short) => `
        <div class="short-card" data-short-id="${short.id}">
          <div class="short-thumb-wrapper">
            <img class="short-thumb-img" src="${short.thumbnail}" alt="${short.title}" loading="lazy" />
            <div class="short-card-overlay">
              <button class="short-more-btn" title="Options">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="#FFF"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
              </button>
              <div class="short-overlay-title">${short.title}</div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  // Attach click events on shorts
  shelf.querySelectorAll('.short-card').forEach((card) => {
    const sId = card.dataset.shortId;
    const shortObj = shortsList.find((s) => s.id === sId);
    card.addEventListener('click', (e) => {
      if (e.target.closest('.short-more-btn')) {
        e.stopPropagation();
        openActionsSheet(shortObj);
      } else {
        state.shortsList = shortsList;
        openShortsModal(shortObj);
      }
    });
  });

  return shelf;
}

// =========================================================
// 5. VIDEO PLAYER (SPINNER ONLY, NO TEXT!) & URL DIRECT OPEN
// =========================================================
export function extractYouTubeVideoId(input) {
  if (!input) return null;
  const str = String(input).trim();

  // 1. Raw 11-char YouTube ID (e.g. dQw4w9WgXcQ)
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) {
    return str;
  }

  // 2. youtu.be/<id> or /shorts/<id> or /embed/<id> or /live/<id> or /v/<id>
  const shortMatch = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|live\/))([a-zA-Z0-9_-]{11})/i);
  if (shortMatch) return shortMatch[1];

  // 3. /watch?v=<id> (handles www.youtube.com, m.youtube.com, etc.)
  const watchMatch = str.match(/[?&]v=([a-zA-Z0-9_-]{11})/i);
  if (watchMatch) return watchMatch[1];

  // 4. Any YouTube link anywhere in the text (e.g. shared text from other apps)
  const looseMatch = str.match(/(?:v=|youtu\.be\/|shorts\/|live\/)([a-zA-Z0-9_-]{11})/i);
  if (looseMatch) return looseMatch[1];

  return null;
}

export async function openVideoById(videoId) {
  if (!videoId) return;
  console.log(`[Player] Opening video from link/ID: ${videoId}`);

  const initialVideo = {
    id: videoId,
    title: 'Loading YouTube Video...',
    channel: 'YouTube',
    channel_id: '',
    channel_avatar: '',
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    view_count: 'Views',
    duration: 0
  };

  // Launch player immediately with 0ms visual feedback
  openVideoPlayer(initialVideo);

  // Fetch real metadata in background to update title & channel
  try {
    const details = await api.getVideo(videoId);
    if (details && details.title) {
      const fullVideo = {
        ...initialVideo,
        title: details.title,
        channel: details.channel || 'Creator',
        channel_id: details.channel_id || '',
        channel_avatar: details.channel_avatar || '',
        thumbnail: details.thumbnail || initialVideo.thumbnail,
        view_count: details.view_count || 0,
        description: details.description || ''
      };
      state.activeVideo = fullVideo;
      const titleElem = document.getElementById('player-video-title');
      const channelElem = document.getElementById('player-channel-name');
      const avatarElem = document.getElementById('player-channel-avatar');
      if (titleElem) titleElem.textContent = fullVideo.title;
      if (channelElem) channelElem.textContent = fullVideo.channel;
      if (avatarElem) avatarElem.src = resolveAvatarUrl(fullVideo.channel_avatar, fullVideo.channel, fullVideo.channel_id);
      saveToWatchHistory(fullVideo);
    }
  } catch (_) {}
}

export async function openUniversalUrl(url) {
  if (!url) return;
  const cleanUrl = String(url).trim();
  const ytId = extractYouTubeVideoId(cleanUrl);
  if (ytId) {
    return openVideoById(ytId);
  }

  showToast('Extracting media from link...');
  try {
    const info = await api.resolveUrl(cleanUrl);
    if (!info || (!info.direct_stream_url && !info.direct_audio_url && !info.id)) {
      throw new Error('Could not find playable media at this link');
    }
    const videoObj = {
      id: info.id || `ext_${Date.now()}`,
      url: info.url || cleanUrl,
      title: info.title || 'External Media',
      channel: info.channel || info.extractor || 'Web Video',
      channel_id: '',
      channel_avatar: '',
      thumbnail: info.thumbnail || '',
      duration: info.duration || 0,
      view_count: info.view_count || 0,
      direct_stream_url: info.direct_stream_url || '',
      direct_audio_url: info.direct_audio_url || '',
      available_resolutions: info.available_resolutions || [360, 480, 720],
      formats: info.formats || [],
      isExternal: true
    };
    state.playbackEngine = 'native';
    openVideoPlayer(videoObj);
  } catch (err) {
    showToast(`Link extract failed: ${err.message}`);
  }
}

// =========================================================
// FLOATING MINI-PLAYER & BACKGROUND AUDIO CONTROLLER
// =========================================================
export let isUserPaused = false;
let isMiniPaused = false;

export function setMediaSessionPlaybackState(stateStr) {
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.playbackState = stateStr;
    } catch (_) {}
  }
}

export function updateMediaSession(video) {
  if (!('mediaSession' in navigator) || !video) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: video.title || 'MeTube Video',
      artist: video.channel || 'MeTube Creator',
      album: 'MeTube Background Audio',
      artwork: [
        { src: video.thumbnail || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`, sizes: '512x512', type: 'image/jpeg' }
      ]
    });
    navigator.mediaSession.setActionHandler('play', () => {
      resumeCurrentPlayback();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      pauseCurrentPlayback();
    });
    navigator.mediaSession.setActionHandler('stop', () => {
      stopAllPlayback();
      hideMiniPlayer();
    });
    try {
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime != null && Number.isFinite(details.seekTime)) {
          const v = document.getElementById('html5-video-element');
          if (v) v.currentTime = details.seekTime;
        }
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const v = document.getElementById('html5-video-element');
        if (v) v.currentTime = Math.min(v.duration || 0, v.currentTime + (details.seekOffset || 10));
      });
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const v = document.getElementById('html5-video-element');
        if (v) v.currentTime = Math.max(0, v.currentTime - (details.seekOffset || 10));
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        document.getElementById('btn-st-next')?.click();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        document.getElementById('btn-st-prev')?.click();
      });
    } catch (_) {}
  } catch (err) {
    console.warn('[MediaSession] Error registering metadata:', err);
  }
}

export function minimizeToMiniPlayer() {
  const modal = document.getElementById('player-modal');
  setFullscreenLandscape(false);
  if (!modal || !state.activeVideo) return;

  // Float seamlessly to bottom-right corner matching authentic YouTube
  modal.classList.add('mini-floating');
  modal.classList.add('open');

  const videoElem = document.getElementById('html5-video-element');
  const playing = state.playbackEngine === 'native' && videoElem ? !videoElem.paused : (!isMiniPaused && !isUserPaused);
  updatePlayPauseIcons(playing);
  syncNativeMediaService(playing, true);
  syncNativeOverlayFlag();
}

export function expandFromMiniPlayer() {
  const modal = document.getElementById('player-modal');
  if (!modal) return;
  modal.classList.remove('mini-floating');
  modal.classList.add('open');
  syncNativeOverlayFlag();
}

export function hideMiniPlayer() {
  const modal = document.getElementById('player-modal');
  if (modal) {
    modal.classList.remove('mini-floating');
  }
  const miniBar = document.getElementById('mini-player-bar');
  if (miniBar) miniBar.style.display = 'none';
}

export function resumeCurrentPlayback() {
  isUserPaused = false;
  isMiniPaused = false;
  if (state.playbackEngine === 'youtube') {
    const iframe = document.getElementById('youtube-embed-player');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
    }
    ytIsPlaying = true;
  } else {
    const videoElem = document.getElementById('html5-video-element');
    const audioElem = document.getElementById('html5-audio-element');
    if (videoElem) videoElem.play().catch(() => {});
    if (audioElem && audioElem.src && videoElem?.muted) audioElem.play().catch(() => {});
  }
  updatePlayPauseIcons(true);
  syncNativeMediaService(true, true);
}

export function pauseCurrentPlayback() {
  isUserPaused = true;
  isMiniPaused = true;
  if (state.playbackEngine === 'youtube') {
    const iframe = document.getElementById('youtube-embed-player');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
    }
    ytIsPlaying = false;
  } else {
    const videoElem = document.getElementById('html5-video-element');
    const audioElem = document.getElementById('html5-audio-element');
    if (videoElem) videoElem.pause();
    if (audioElem) audioElem.pause();
  }
  updatePlayPauseIcons(false);
  syncNativeMediaService(false, true);
}

export function toggleMiniPlayPause() {
  if (isUserPaused || isMiniPaused) {
    resumeCurrentPlayback();
  } else {
    pauseCurrentPlayback();
  }
}

export function syncNativeOverlayFlag() {
  try {
    const authModal = document.getElementById('auth-modal');
    const hasOverlay = Boolean(
      document.getElementById('player-settings-sheet')?.style.display === 'flex' ||
      state.fullscreenLandscape ||
      (authModal && authModal.style.display && authModal.style.display !== 'none') ||
      document.getElementById('diagnostics-modal')?.classList.contains('open') ||
      document.getElementById('download-modal')?.classList.contains('open') ||
      document.getElementById('actions-modal')?.classList.contains('open') ||
      document.getElementById('channel-modal')?.classList.contains('open') ||
      document.getElementById('shorts-modal')?.classList.contains('open') ||
      document.getElementById('player-modal')?.classList.contains('open') ||
      document.getElementById('sidebar-overlay')?.classList.contains('open') ||
      state.searchQuery ||
      state.activeTab !== 'home'
    );
    window.AndroidUI?.setHasOpenOverlay?.(hasOverlay);
  } catch (_) {}
}

let _lastNativeSyncAt = 0;
let ytIsPlaying = false;
let ytCurrentTimeSec = 0;
let ytDurationSec = 0;
let _nativeHandoffLockUntil = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    try {
      if (!event?.data || typeof event.data !== 'string') return;
      if (!event.origin || !event.origin.includes('youtube')) return;
      const msg = JSON.parse(event.data);
      if (msg.event === 'infoDelivery' && msg.info) {
        if (typeof msg.info.currentTime === 'number' && Number.isFinite(msg.info.currentTime)) {
          ytCurrentTimeSec = msg.info.currentTime;
        }
        if (typeof msg.info.duration === 'number' && Number.isFinite(msg.info.duration) && msg.info.duration > 0) {
          ytDurationSec = msg.info.duration;
        }
        if (typeof msg.info.playerState === 'number') {
          const st = msg.info.playerState;
          if (st === 1 || st === 3) ytIsPlaying = true;
          else if (st === 0) ytIsPlaying = false;
          else if (st === 2 && isUserPaused) ytIsPlaying = false;
        }
        syncNativeMediaService(null, false);
      } else if (msg.event === 'onStateChange') {
        const st = Number(msg.info);
        if (st === 1 || st === 3) {
          ytIsPlaying = true;
          isUserPaused = false;
          syncNativeMediaService(true, true);
        } else if (st === 0) {
          ytIsPlaying = false;
          syncNativeMediaService(false, true);
          if (state.autoplay && state.suggestedVideos && state.suggestedVideos.length > 0) {
            openVideoPlayer(state.suggestedVideos[0]);
          }
        } else if (st === 2) {
          // If paused by OS background transition or window blur, do NOT cancel background audio!
          if (!isUserPaused && state.isAudioMode && (_isAppInBackground || document.hidden)) {
            return;
          }
          if (isUserPaused) {
            ytIsPlaying = false;
            syncNativeMediaService(false, true);
          }
        }
      }
    } catch (_) {}
  });
}

// Keep YT iframe handshake, timeline & BG audio readiness synced reliably
let _lastYtSyncTime = 0;
setInterval(() => {
  if (state.playbackEngine === 'youtube' && state.activeVideo && !state.activeVideo.isExternal && !state.activeVideo.isOffline) {
    const iframe = document.getElementById('youtube-embed-player');
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage('{"event":"listening","id":1,"channel":"widget"}', '*');
      } catch (_) {}
    }
    if (ytIsPlaying) {
      ytCurrentTimeSec += 1;
      if (ytDurationSec > 0 && ytCurrentTimeSec > ytDurationSec) ytCurrentTimeSec = ytDurationSec;
      const now = Date.now();
      if (now - _lastYtSyncTime >= 4000) {
        _lastYtSyncTime = now;
        syncNativeMediaService(true, false);
      }
    }
  }
}, 1000);

const _nativeInnerTubeCbs = new Map();
window.__onNativeInnerTube = (callbackId, b64) => {
  const cb = _nativeInnerTubeCbs.get(callbackId);
  if (!cb) return;
  _nativeInnerTubeCbs.delete(callbackId);
  try {
    const bin = atob(b64 || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const jsonStr = new TextDecoder('utf-8').decode(bytes);
    cb(JSON.parse(jsonStr));
  } catch (err) {
    cb({ ok: false, error: err?.message || 'Native InnerTube parse failed' });
  }
};

export function resolveViaNativeInnerTube(videoId, formatType = 'audio') {
  return new Promise((resolve) => {
    if (!videoId || !window.AndroidInnerTube?.resolveForDownloadAsync) {
      resolve({ ok: false, error: 'Native InnerTube unavailable' });
      return;
    }
    const cbId = `it_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      if (_nativeInnerTubeCbs.has(cbId)) {
        _nativeInnerTubeCbs.delete(cbId);
        resolve({ ok: false, error: 'Native resolution timed out' });
      }
    }, 15000);
    _nativeInnerTubeCbs.set(cbId, (res) => {
      clearTimeout(timer);
      resolve(res || { ok: false, error: 'Empty response' });
    });
    try {
      window.AndroidInnerTube.resolveForDownloadAsync(cbId, videoId, formatType === 'audio' ? 'audio' : 'video');
    } catch (err) {
      clearTimeout(timer);
      _nativeInnerTubeCbs.delete(cbId);
      resolve({ ok: false, error: err?.message || 'Bridge invocation failed' });
    }
  });
}

export function syncNativeMediaService(playingOverride = null, force = false) {
  try {
    if (!window.AndroidMediaService?.syncState) return;

    // ONLY LONG VIDEOS ON BG - Shorts must never play in background!
    const shortsOpen = Boolean(document.getElementById('shorts-modal')?.classList.contains('open'));
    if (shortsOpen) {
      window.AndroidMediaService.syncState(false, false, 0, 0, '', '', '', '', '');
      return;
    }

    if (playingOverride === false && Date.now() < _nativeHandoffLockUntil && !force) return;
    const now = Date.now();
    if (!force && now - _lastNativeSyncAt < 3500) return;
    _lastNativeSyncAt = now;

    const video = state.activeVideo;
    if (!video) {
      window.AndroidMediaService.syncState(false, false, 0, 0, '', '', '', '', '');
      return;
    }

    const videoElem = document.getElementById('html5-video-element');
    const audioElem = document.getElementById('html5-audio-element');
    const isYtIframe = state.playbackEngine === 'youtube' && !video.isExternal && !video.isOffline;
    const isAudioPlaying = audioElem ? (!audioElem.paused && !audioElem.ended) : false;
    const isElemPlaying = (videoElem ? (!videoElem.paused && !videoElem.ended) : false) || isAudioPlaying;
    const isPlaying = playingOverride !== null
      ? Boolean(playingOverride)
      : (isYtIframe ? ytIsPlaying : isElemPlaying);

    let posMs = 0;
    let durMs = Math.floor((video.duration || 0) * 1000);
    if (isYtIframe) {
      posMs = Math.floor((ytCurrentTimeSec || 0) * 1000);
      if (ytDurationSec > 0) durMs = Math.floor(ytDurationSec * 1000);
    } else if (audioElem && audioElem.src && isAudioPlaying) {
      posMs = Number.isFinite(audioElem.currentTime) ? Math.floor(audioElem.currentTime * 1000) : 0;
      durMs = Number.isFinite(audioElem.duration) ? Math.floor(audioElem.duration * 1000) : durMs;
    } else if (videoElem) {
      posMs = Number.isFinite(videoElem.currentTime) ? Math.floor(videoElem.currentTime * 1000) : 0;
      durMs = Number.isFinite(videoElem.duration) ? Math.floor(videoElem.duration * 1000) : durMs;
    }

    const serverBase = getServerUrl();
    let audioUrl = '';
    if (video.isOffline && video.direct_stream_url) {
      audioUrl = video.direct_stream_url.startsWith('http') ? video.direct_stream_url : `${serverBase}${video.direct_stream_url}`;
    } else if (video.isExternal) {
      audioUrl = api.getStreamProxyUrl(video.direct_audio_url || video.direct_stream_url || '');
    } else if (audioElem && audioElem.src && audioElem.src.startsWith('http')) {
      audioUrl = audioElem.src;
    } else {
      audioUrl = `${serverBase}/api/stream/${video.id}?audio=true&proxy=true&device_id=${encodeURIComponent(getDeviceId())}`;
    }

    const thumbUrl = video.thumbnail || (video.isExternal ? '' : `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`);
    window.AndroidMediaService.syncState(
      Boolean(isPlaying),
      Boolean(state.isAudioMode),
      posMs,
      durMs,
      String(video.id || ''),
      String(video.title || 'MeTube'),
      String(video.channel || 'MeTube'),
      audioUrl,
      String(thumbUrl || '')
    );
  } catch (_) {}
}

let _isAppInBackground = false;

window.onAppBackground = function() {
  _isAppInBackground = true;

  // ONLY LONG VIDEOS ON BG - Shorts must immediately stop on app minimize!
  const shortsOpen = Boolean(document.getElementById('shorts-modal')?.classList.contains('open'));
  if (shortsOpen) {
    const shortsIframe = document.getElementById('shorts-embed-player');
    if (shortsIframe && shortsIframe.contentWindow) {
      try {
        shortsIframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
      } catch (_) {}
    }
    const shortsVideo = document.getElementById('shorts-video-element');
    if (shortsVideo && !shortsVideo.paused) {
      try { shortsVideo.pause(); } catch (_) {}
    }
    try {
      window.AndroidMediaService?.syncState?.(false, false, 0, 0, '', '', '', '', '');
      window.AndroidMediaService?.stopNativePlayback?.();
      window.AndroidMediaService?.stopService?.();
    } catch (_) {}
    return;
  }

  // Pause video iframe in WebView so only high-priority native ExoPlayer plays audio in background
  if (state.playbackEngine === 'youtube') {
    const iframe = document.getElementById('youtube-embed-player');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
    }
  }
};

window.onAppForegroundResume = function(nativePosMs, wasPlaying) {
  _isAppInBackground = false;
  if (!state.activeVideo || isUserPaused) return;

  const shortsOpen = Boolean(document.getElementById('shorts-modal')?.classList.contains('open'));
  if (shortsOpen) {
    const shortsIframe = document.getElementById('shorts-embed-player');
    if (shortsIframe && shortsIframe.contentWindow) {
      shortsIframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
    }
    const shortsVideo = document.getElementById('shorts-video-element');
    if (shortsVideo && shortsVideo.paused) {
      shortsVideo.play().catch(() => {});
    }
    return;
  }

  if (state.playbackEngine === 'youtube') {
    const iframe = document.getElementById('youtube-embed-player');
    if (iframe && iframe.contentWindow) {
      if (typeof nativePosMs === 'number' && nativePosMs > 0 && Math.abs((ytCurrentTimeSec || 0) - (nativePosMs / 1000)) > 1.2) {
        iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [nativePosMs / 1000, true] }), '*');
      }
      iframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
      ytIsPlaying = true;
    }
    updatePlayPauseIcons(true);
    syncNativeMediaService(true, true);
  } else {
    const videoElem = document.getElementById('html5-video-element');
    const audioElem = document.getElementById('html5-audio-element');
    if (audioElem && audioElem.src && !audioElem.paused && videoElem) {
      videoElem.currentTime = audioElem.currentTime;
    }
    if (videoElem && videoElem.paused) videoElem.play().catch(() => {});
    if (audioElem && audioElem.src && audioElem.paused) audioElem.play().catch(() => {});
    updatePlayPauseIcons(true);
    syncNativeMediaService(true, true);
  }
};

window.pauseWebMediaForNativeHandoff = function() {
  try {
    _nativeHandoffLockUntil = Date.now() + 2500;
    const videoElem = document.getElementById('html5-video-element');
    if (videoElem && !videoElem.paused) videoElem.pause();
    const iframe = document.getElementById('youtube-embed-player');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
    }
    const shortsVideo = document.getElementById('shorts-video-element');
    if (shortsVideo && !shortsVideo.paused) shortsVideo.pause();
  } catch (_) {}
};

window.resumeWebMediaFromNative = function(posMs, playing) {
  try {
    _nativeHandoffLockUntil = 0;
    const releaseNative = () => {
      try { window.AndroidMediaService?.stopNativePlayback?.(); } catch (_) {}
    };

    const shortsOpen = Boolean(document.getElementById('shorts-modal')?.classList.contains('open'));
    if (shortsOpen) {
      const shortsIframe = document.getElementById('shorts-embed-player');
      if (shortsIframe && shortsIframe.contentWindow) {
        shortsIframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
      }
      releaseNative();
      return;
    }

    if (!state.activeVideo) {
      releaseNative();
      return;
    }

    if (state.playbackEngine === 'youtube' && !state.activeVideo.isExternal && !state.activeVideo.isOffline) {
      const iframe = document.getElementById('youtube-embed-player');
      if (iframe && iframe.contentWindow) {
        if (typeof posMs === 'number' && posMs > 0 && Math.abs((ytCurrentTimeSec || 0) - (posMs / 1000)) > 1.2) {
          iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'seekTo', args: [posMs / 1000, true] }), '*');
        }
        if (!isUserPaused) {
          iframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
          ytIsPlaying = true;
        }
      }
      updatePlayPauseIcons(true);
      setTimeout(releaseNative, 400);
      return;
    }

    const videoElem = document.getElementById('html5-video-element');
    if (!videoElem) {
      releaseNative();
      return;
    }

    // Media is actively playing seamlessly in WebView: NEVER seek, reload, or flicker video!
    if (!videoElem.paused && !videoElem.ended) {
      releaseNative();
      updatePlayPauseIcons(true);
      return;
    }

    // Only if unexpectedly paused by OS background transition and user wanted playback
    if (playing && !isUserPaused) {
      videoElem.play().catch(() => {});
      updatePlayPauseIcons(true);
    } else {
      videoElem.pause();
      updatePlayPauseIcons(false);
    }
    releaseNative();
  } catch (_) {}
};

window.onPipModeChanged = function(isInPip) {
  try {
    const playerModal = document.getElementById('player-modal');
    const customOverlay = document.getElementById('st-custom-overlay');
    if (isInPip) {
      if (playerModal) playerModal.classList.add('in-pip');
      if (customOverlay) customOverlay.classList.add('controls-hidden');
    } else {
      if (playerModal) playerModal.classList.remove('in-pip');
    }
  } catch (_) {}
};

window.handleNativeMediaEvent = function(cmd, posMs, playing) {
  if (cmd === 'next') {
    document.getElementById('btn-st-next')?.click();
    return;
  }
  if (cmd === 'prev') {
    document.getElementById('btn-st-prev')?.click();
    return;
  }
  if (cmd === 'stop') {
    stopAllPlayback();
    hideMiniPlayer();
    document.getElementById('player-modal')?.classList.remove('open');
    syncNativeOverlayFlag();
    return;
  }
  if (cmd === 'play') {
    resumeCurrentPlayback();
  } else if (cmd === 'pause') {
    pauseCurrentPlayback();
  } else if (typeof cmd === 'string' && cmd.startsWith('seek:')) {
    const s = parseFloat(cmd.replace('seek:', '')) / 1000;
    const v = document.getElementById('html5-video-element');
    const a = document.getElementById('html5-audio-element');
    if (v && Number.isFinite(s)) v.currentTime = s;
    if (a && Number.isFinite(s) && a.src) {
      try { a.currentTime = s; } catch (_) {}
    }
  }
  updatePlayPauseIcons(cmd === 'play' || Boolean(playing));
};

function setFullscreenLandscape(enabled) {
  state.fullscreenLandscape = Boolean(enabled);
  const modal = document.getElementById('player-modal');
  const fsBtn = document.getElementById('btn-st-fullscreen');
  if (modal) modal.classList.toggle('fullscreen-landscape', state.fullscreenLandscape);
  if (fsBtn) fsBtn.innerHTML = state.fullscreenLandscape ? ICONS.fullscreenExit : ICONS.fullscreenEnter;
  try {
    window.AndroidUI?.setFullscreenOrientation?.(state.fullscreenLandscape);
    const wrapper = document.getElementById('player-media-box');
    if (!window.AndroidUI && state.fullscreenLandscape && wrapper?.requestFullscreen) {
      wrapper.requestFullscreen().catch(() => {});
    } else if (!window.AndroidUI && !state.fullscreenLandscape && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  } catch (_) {}
  syncNativeOverlayFlag();
}

function updatePlayPauseIcons(isPlaying) {
  isMiniPaused = !isPlaying;
  const stBtn = document.getElementById('btn-st-playpause');
  const miniBtn = document.getElementById('btn-mini-play-pause');
  const floatPlay = document.getElementById('mini-float-play-icon');
  const floatPause = document.getElementById('mini-float-pause-icon');
  if (stBtn) stBtn.innerHTML = isPlaying ? ICONS.pause : ICONS.play;
  if (miniBtn) miniBtn.innerHTML = isPlaying ? ICONS.pause : ICONS.play;
  if (floatPlay && floatPause) {
    floatPlay.style.display = isPlaying ? 'none' : 'block';
    floatPause.style.display = isPlaying ? 'block' : 'none';
  }
  setMediaSessionPlaybackState(isPlaying ? 'playing' : 'paused');
}

export function stopAllPlayback(preserve = null) {
  isUserPaused = true;
  isMiniPaused = true;
  // If preserving nothing, hide floating mini-player and stop native BG audio service
  if (!preserve || preserve.startsWith('shorts')) {
    hideMiniPlayer();
    if (!preserve) {
      ytIsPlaying = false;
      ytCurrentTimeSec = 0;
      ytDurationSec = 0;
      try { window.AndroidMediaService?.stopService?.(); } catch (_) {}
      setFullscreenLandscape(false);
    }
  }

  // 1. Teardown Main YouTube Embed Player
  if (preserve !== 'main-youtube') {
    const iframeContainer = document.getElementById('embed-iframe-container');
    if (iframeContainer) {
      iframeContainer.innerHTML = '';
      iframeContainer.style.display = 'none';
    }
  }

  // 2. Teardown Main HTML5 Video Player
  if (preserve !== 'main-native') {
    const videoElem = document.getElementById('html5-video-element');
    if (videoElem) {
      videoElem.onerror = null;
      videoElem.onloadeddata = null;
      videoElem.oncanplay = null;
      videoElem.onplaying = null;
      videoElem.onplay = null;
      videoElem.onpause = null;
      videoElem.ontimeupdate = null;
      videoElem.onwaiting = null;
      videoElem.onended = null;
      videoElem.onloadedmetadata = null;
      try {
        videoElem.pause();
        videoElem.removeAttribute('src');
        videoElem.load();
      } catch (_) {}
      videoElem.style.display = 'none';
    }
    const audioElem = document.getElementById('html5-audio-element');
    if (audioElem) {
      try {
        audioElem.pause();
        audioElem.removeAttribute('src');
        audioElem.load();
      } catch (_) {}
    }
    const spinner = document.getElementById('player-video-spinner');
    if (spinner) spinner.style.display = 'none';
  }

  // 3. Teardown Shorts YouTube Embed Player
  if (preserve !== 'shorts-youtube') {
    const shortsEmbed = document.getElementById('shorts-embed-container');
    if (shortsEmbed) {
      shortsEmbed.innerHTML = '';
      shortsEmbed.style.display = 'none';
    }
  }

  // 4. Teardown Shorts HTML5 Video
  if (preserve !== 'shorts-native') {
    const shortsVideo = document.getElementById('shorts-video-element');
    if (shortsVideo) {
      shortsVideo.onerror = null;
      shortsVideo.onloadeddata = null;
      shortsVideo.oncanplay = null;
      shortsVideo.onplaying = null;
      shortsVideo.onplay = null;
      shortsVideo.onpause = null;
      shortsVideo.ontimeupdate = null;
      shortsVideo.onwaiting = null;
      shortsVideo.onended = null;
      shortsVideo.onloadedmetadata = null;
      try {
        shortsVideo.pause();
        shortsVideo.removeAttribute('src');
        shortsVideo.load();
      } catch (_) {}
      shortsVideo.style.display = 'none';
    }
    const shortsSpinner = document.getElementById('shorts-spinner');
    if (shortsSpinner) shortsSpinner.style.display = 'none';
  }

  if (nativeBufferWatchdog) {
    clearTimeout(nativeBufferWatchdog);
    nativeBufferWatchdog = null;
  }
}

async function openVideoPlayer(video) {
  if (!video) return;
  isUserPaused = false;
  isMiniPaused = false;
  state.activeVideo = video;
  state.playbackEngine = (video.isExternal || video.isOffline) ? 'native' : 'youtube';

  // Instantly hide prior video frame to eliminate any glimpse of previous video
  const priorVideo = document.getElementById('html5-video-element');
  if (priorVideo) priorVideo.style.display = 'none';

  // 1. OPEN PLAYER MODAL IMMEDIATELY WITH METADATA - 0ms LATENCY
  const modal = document.getElementById('player-modal');
  const titleElem = document.getElementById('player-video-title');
  const overlayTitleElem = document.getElementById('st-overlay-title');
  const topbarTitleElem = document.getElementById('player-topbar-title');
  const viewsElem = document.getElementById('player-video-views');
  const channelNameElem = document.getElementById('player-channel-name');
  const channelAvatarImg = document.getElementById('player-channel-avatar-img');
  const channelSubsElem = document.getElementById('player-channel-subs');
  const descElem = document.getElementById('player-video-desc');
  const subBtn = document.getElementById('btn-sub-toggle');
  const bgBtn = document.getElementById('btn-bg-audio');

  if (modal) {
    modal.classList.remove('mini-floating');
    modal.style.display = 'flex';
    modal.classList.add('open');
  }
  const safeTitle = video.title || 'Playing Video';
  if (titleElem) titleElem.textContent = safeTitle;
  if (overlayTitleElem) overlayTitleElem.textContent = safeTitle;
  if (topbarTitleElem) topbarTitleElem.textContent = safeTitle;
  if (viewsElem) viewsElem.textContent = video.isExternal ? (video.channel || 'Universal Link Media') : formatViews(video.view_count);

  const commentCountElem = document.getElementById('player-comments-count');
  const commentSnippetElem = document.getElementById('player-comment-snippet');
  if (commentCountElem) {
    const rawCount = video.view_count ? Math.max(14, Math.round(video.view_count / 1200)) : 240;
    commentCountElem.textContent = formatViews(rawCount);
  }
  if (commentSnippetElem) {
    const safeSnippet = video.channel ? `Great breakdown from ${video.channel}! Watching this on repeat.` : 'Awesome explanation!';
    commentSnippetElem.textContent = safeSnippet;
  }

  const cName = video.channel || 'Creator';
  if (channelNameElem) channelNameElem.textContent = cName;
  if (channelSubsElem) channelSubsElem.textContent = video.isExternal ? 'Extracted Stream' : 'Creator';

  if (bgBtn) {
    bgBtn.classList.toggle('active', Boolean(state.isAudioMode));
    bgBtn.innerHTML = `${ICONS.headphones}<span>${state.isAudioMode ? 'Active' : 'Background'}</span>`;
    bgBtn.title = state.isAudioMode ? 'Background Play: ON (Tap to toggle)' : 'Background Play: OFF (Tap to toggle)';
  }
  const rawResolutions = (Array.isArray(video.available_resolutions) && video.available_resolutions.length)
    ? video.available_resolutions
    : [1080, 720, 480, 360];
  state.availableResolutions = rawResolutions
    .map((r) => (typeof r === 'object' && r ? r.height : parseInt(r, 10)))
    .filter((h) => Number.isFinite(h) && h >= 144);
  state.availableResolutions = Array.from(new Set(state.availableResolutions)).sort((a, b) => b - a);
  if (!state.availableResolutions.length) state.availableResolutions = [1080, 720, 480, 360];
  renderQualityOptionsSheet();
  syncNativeOverlayFlag();

  // Update Floating Mini-Player info
  const miniThumb = document.getElementById('mini-player-thumb');
  const miniTitle = document.getElementById('mini-player-title');
  const miniChannel = document.getElementById('mini-player-channel');
  const miniBar = document.getElementById('mini-player-bar');
  if (miniThumb) miniThumb.src = video.thumbnail || (video.isExternal ? '' : `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`);
  if (miniTitle) miniTitle.textContent = safeTitle;
  if (miniChannel) miniChannel.textContent = cName;
  if (miniBar) miniBar.style.display = 'none';

  // Update Subscribe button state
  const isSubbed = isChannelSubscribed(video.channel_id, cName);
  state.isSubscribed = isSubbed;
  if (subBtn) {
    subBtn.textContent = isSubbed ? 'Subscribed' : 'Subscribe';
    subBtn.classList.toggle('subscribed', isSubbed);
    subBtn.style.background = '';
    subBtn.style.color = '';
  }

  // Reset Player Like button
  const playerLikeBtn = document.getElementById('btn-player-like');
  if (playerLikeBtn) {
    playerLikeBtn.classList.remove('active');
    playerLikeBtn.style.color = 'var(--text-white)';
    const countElem = document.getElementById('player-like-count');
    if (countElem) countElem.textContent = 'Like';
  }

  // Record watch history to update user's dynamic feed & account
  if (video.id && !video.isExternal && !video.isOffline) {
    api.recordWatch(video.id).catch((err) => console.debug('Watch history sync:', err));
  }

  // Real Channel Avatar Image with auto-refreshing Fallback
  const avatarUrl = resolveAvatarUrl(video.channel_avatar, cName, video.channel_id);
  if (channelAvatarImg) {
    channelAvatarImg.src = avatarUrl;
    attachAvatarHandlers(channelAvatarImg, cName, video.channel_id);
  }

  if (descElem) {
    const desc = (video.description || '').trim();
    descElem.textContent = desc;
    descElem.style.display = desc ? 'block' : 'none';
  }

  // Show loading spinner immediately
  const prevSpinner = document.getElementById('player-video-spinner');
  if (prevSpinner) prevSpinner.style.display = 'flex';

  // Halt any previous playback completely (zero simultaneous audio/video, zero glimpses)
  stopAllPlayback();

  // Persist to Watch History immediately to drive dynamic personalized feed!
  try {
    saveToWatchHistory(video);
  } catch (_) {}

  // Setup MediaSession & native BG service state
  try {
    updateMediaSession(video);
    syncNativeMediaService(true, true);
  } catch (_) {}

  // Setup Player Engine (Native Snaptube Custom UI or YouTube Engine)
  setupPlayerPlayback(video);

  // Load Suggested Videos immediately
  loadSuggestedVideos(video);

  if (video.isExternal) return;

  // Fetch full details in background for follower count, resolutions, and description
  try {
    const details = await api.getVideo(video.id);
    if (details && state.activeVideo?.id === video.id) {
      if (details.channel_follower_count && channelSubsElem) {
        channelSubsElem.textContent = `${formatViews(details.channel_follower_count)} subscribers`;
      }
      if (details.description && descElem) {
        descElem.textContent = details.description;
        descElem.style.display = 'block';
      }
      if (details.channel_avatar && !video.channel_avatar && channelAvatarImg) {
        channelAvatarImg.src = resolveAvatarUrl(details.channel_avatar, details.channel || cName, details.channel_id || video.channel_id);
      }
      if (Array.isArray(details.available_resolutions) && details.available_resolutions.length) {
        state.availableResolutions = details.available_resolutions
          .map((r) => (typeof r === 'object' && r ? r.height : parseInt(r, 10)))
          .filter((h) => Number.isFinite(h) && h >= 144);
        state.availableResolutions = Array.from(new Set(state.availableResolutions)).sort((a, b) => b - a);
        renderQualityOptionsSheet();
      }
    }
  } catch (err) {
    // Continues smoothly
  }
}

let nativeBufferWatchdog = null;
let overlayAutoHideTimer = null;
let isUserSeekingSlider = false;

function scheduleOverlayAutoHide() {
  const overlay = document.getElementById('player-custom-overlay');
  if (overlayAutoHideTimer) clearTimeout(overlayAutoHideTimer);
  if (!overlay) return;
  overlay.classList.remove('controls-hidden');
  overlayAutoHideTimer = setTimeout(() => {
    const videoElem = document.getElementById('html5-video-element');
    if (state.playbackEngine === 'native' && videoElem && !videoElem.paused) {
      overlay.classList.add('controls-hidden');
    }
  }, 3400);
}

function changeVideoQuality(newQ) {
  if (!state.activeVideo) return;
  const video = state.activeVideo;
  const videoElem = document.getElementById('html5-video-element');
  const audioElem = document.getElementById('html5-audio-element');
  if (!videoElem) return;

  const resumeAt = (audioElem && audioElem.src && !audioElem.paused && Number.isFinite(audioElem.currentTime))
    ? audioElem.currentTime
    : (Number.isFinite(videoElem.currentTime) ? videoElem.currentTime : 0);
  const wasPlaying = (!videoElem.paused && !videoElem.ended) || (audioElem && !audioElem.paused && !audioElem.ended);
  const serverBase = getServerUrl();
  const devId = encodeURIComponent(getDeviceId());
  const qParam = (newQ && newQ !== 'auto') ? `&quality=${encodeURIComponent(newQ)}` : '';

  const newVideoUrl = video.isExternal
    ? (video.direct_stream_url || api.getStreamProxyUrl(video.url))
    : `${serverBase}/api/stream/${video.id}?proxy=true&device_id=${devId}${qParam}`;

  const audioUrl = `${serverBase}/api/stream/${video.id}?audio=true&proxy=true&device_id=${devId}`;
  const useDualStream = !video.isExternal && !video.isOffline;

  if (useDualStream && audioElem) {
    if (audioElem.src !== audioUrl) {
      audioElem.src = audioUrl;
      try { audioElem.currentTime = resumeAt; } catch (_) {}
    }
    videoElem.muted = true;
    if (wasPlaying && audioElem.paused) {
      audioElem.play().catch(() => {});
    }
  } else {
    videoElem.muted = false;
    if (audioElem) {
      audioElem.pause();
      audioElem.removeAttribute('src');
    }
  }

  const onMeta = () => {
    if (resumeAt > 0 && Number.isFinite(videoElem.duration)) {
      try { videoElem.currentTime = resumeAt; } catch (_) {}
    }
    if (wasPlaying) {
      videoElem.play().catch(() => {});
    }
  };
  videoElem.addEventListener('loadedmetadata', onMeta, { once: true });
  videoElem.src = newVideoUrl;
  try { videoElem.currentTime = resumeAt; } catch (_) {}
  if (wasPlaying) {
    videoElem.play().catch(() => {});
  }
}

function renderQualityOptionsSheet() {
  const container = document.getElementById('setting-quality-options');
  const valSpan = document.getElementById('setting-val-quality');
  const badgeSpan = document.getElementById('player-quality-badge');
  const qLabel = state.selectedQuality === 'auto' ? 'Auto' : `${state.selectedQuality}p`;
  if (valSpan) valSpan.textContent = qLabel;
  if (badgeSpan) badgeSpan.innerHTML = `${ICONS.gear} <span>${qLabel}</span>`;
  if (!container) return;

  const resList = state.availableResolutions && state.availableResolutions.length
    ? state.availableResolutions
    : [1080, 720, 480, 360];
  const opts = ['auto', ...resList.map(String)];
  container.innerHTML = opts.map((q) => {
    const active = String(state.selectedQuality) === q ? 'active' : '';
    const txt = q === 'auto' ? 'Auto' : `${q}p`;
    return `<button type="button" class="st-q-pill ${active}" data-quality="${q}">${txt}</button>`;
  }).join('');

  container.querySelectorAll('.st-q-pill').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newQ = btn.dataset.quality || 'auto';
      if (String(state.selectedQuality) === newQ) return;
      state.selectedQuality = newQ;
      renderQualityOptionsSheet();
      const sheet = document.getElementById('player-settings-sheet');
      if (sheet) sheet.style.display = 'none';
      if (state.activeVideo) {
        changeVideoQuality(newQ);
        showToast(`Quality switched to ${newQ === 'auto' ? 'Auto' : `${newQ}p`}`);
      }
    });
  });
}

function setupPlayerPlayback(video, seekSeconds = 0) {
  if (!video || !video.id) return;
  const iframeContainer = document.getElementById('embed-iframe-container');
  const videoElem = document.getElementById('html5-video-element');
  const spinner = document.getElementById('player-video-spinner');
  const engineLabel = document.getElementById('engine-toggle-label');
  const customOverlay = document.getElementById('player-custom-overlay');
  const legacyTopbar = document.getElementById('player-legacy-topbar');

  if (nativeBufferWatchdog) {
    clearTimeout(nativeBufferWatchdog);
    nativeBufferWatchdog = null;
  }

  if (state.playbackEngine === 'youtube' && !video.isExternal) {
    stopAllPlayback('main-youtube');
    if (videoElem) videoElem.style.display = 'none';
    if (engineLabel) engineLabel.innerHTML = `${ICONS.youtube} <span>YouTube</span>`;
    if (spinner) spinner.style.display = 'none';
    if (customOverlay) customOverlay.style.display = 'none';
    if (legacyTopbar) legacyTopbar.style.display = 'flex';

    ytIsPlaying = true;
    ytCurrentTimeSec = seekSeconds || 0;
    ytDurationSec = video.duration || 0;
    if (iframeContainer) {
      const startParam = seekSeconds > 0 ? `&start=${Math.floor(seekSeconds)}` : '';
      iframeContainer.style.display = 'block';
      iframeContainer.innerHTML = `
        <iframe 
          id="youtube-embed-player"
          src="https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&controls=1${startParam}"
          title="${(video.title || 'Video').replace(/"/g, '&quot;')}"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
          style="width:100%; height:100%; border:none; display:block;"
        ></iframe>
      `;
      const ytFrame = document.getElementById('youtube-embed-player');
      if (ytFrame) {
        ytFrame.addEventListener('load', () => {
          try {
            ytFrame.contentWindow?.postMessage('{"event":"listening","id":1,"channel":"widget"}', '*');
            ytFrame.contentWindow?.postMessage('{"event":"command","func":"addEventListener","args":["onStateChange"]}', '*');
          } catch (_) {}
        });
      }
    }
    syncNativeMediaService(true, true);
    console.log(`[Player] YouTube Engine activated for ${video.id}`);
  } else {
    // Snaptube Custom Native Player (works for YouTube + External Instagram/FB/TikTok/X URLs)
    stopAllPlayback('main-native');
    if (engineLabel) engineLabel.innerHTML = `${ICONS.video} <span>Native</span>`;
    if (spinner) spinner.style.display = 'flex';
    if (legacyTopbar) legacyTopbar.style.display = 'none';
    if (customOverlay) {
      customOverlay.style.display = 'flex';
      scheduleOverlayAutoHide();
    }

    if (videoElem) {
      // Clear any prior listeners to guarantee zero recursive error loops
      videoElem.onerror = null;
      videoElem.onloadeddata = null;
      videoElem.oncanplay = null;
      videoElem.onplaying = null;
      videoElem.onplay = null;
      videoElem.onpause = null;
      videoElem.ontimeupdate = null;
      videoElem.onwaiting = null;
      videoElem.onended = null;
      videoElem.onloadedmetadata = null;

      videoElem.style.display = 'none'; // Keep hidden until bytes load to eliminate any glimpse of previous video
      videoElem.loop = Boolean(state.isLooping);
      videoElem.playbackRate = Number(state.playbackRate || 1.0);

      const showVideoWhenReady = () => {
        if (state.activeVideo?.id !== video.id) return;
        videoElem.style.display = 'block';
        if (spinner) spinner.style.display = 'none';
      };

      const serverBase = getServerUrl();
      const devId = encodeURIComponent(getDeviceId());
      const qParam = (state.selectedQuality && state.selectedQuality !== 'auto') ? `&quality=${encodeURIComponent(state.selectedQuality)}` : '';

      const primaryStreamUrl = video.isExternal
        ? (video.direct_stream_url || api.getStreamProxyUrl(video.url))
        : `${serverBase}/api/stream/${video.id}?proxy=true&device_id=${devId}${qParam}`;

      const fallbackStreamUrl = video.isExternal
        ? api.getStreamProxyUrl(video.direct_stream_url || video.url)
        : `${serverBase}/api/stream/${video.id}?proxy=true&device_id=${devId}&quality=360p`;

      const audioElem = document.getElementById('html5-audio-element');
      const useDualStream = !video.isExternal && !video.isOffline;

      let triedFallback = false;
      const startVideoSource = (srcUrl) => {
        if (state.activeVideo?.id !== video.id || state.playbackEngine !== 'native') return;
        if (!srcUrl) return;

        if (useDualStream && audioElem) {
          const audioUrl = `${serverBase}/api/stream/${video.id}?audio=true&proxy=true&device_id=${devId}`;
          if (audioElem.src !== audioUrl) {
            audioElem.src = audioUrl;
            if (seekSeconds > 0) {
              try { audioElem.currentTime = seekSeconds; } catch (_) {}
            }
          }
          videoElem.muted = true;
          audioElem.play().catch(() => {});
        } else {
          videoElem.muted = false;
          if (audioElem) {
            audioElem.pause();
            audioElem.removeAttribute('src');
          }
        }

        if (videoElem.src !== srcUrl) {
          videoElem.src = srcUrl;
        }
        videoElem.play().catch((err) => {
          console.log(`[Player] Autoplay note: ${err}`);
        });
      };

      if (!video.isExternal && !useDualStream && window.AndroidInnerTube?.resolveForDownloadAsync) {
        resolveViaNativeInnerTube(video.id, 'video').then((nativeRes) => {
          if (state.activeVideo?.id !== video.id || state.playbackEngine !== 'native') return;
          if (nativeRes?.ok && nativeRes.url) {
            startVideoSource(nativeRes.url);
          } else {
            startVideoSource(primaryStreamUrl);
          }
        });
      } else {
        startVideoSource(primaryStreamUrl);
      }

      const curTimeLbl = document.getElementById('st-time-current');
      const durTimeLbl = document.getElementById('st-time-duration');
      const slider = document.getElementById('player-seek-slider');

      const updateSliderUI = () => {
        const cur = videoElem.currentTime || 0;
        const dur = Number.isFinite(videoElem.duration) ? videoElem.duration : (video.duration || 0);
        if (curTimeLbl) curTimeLbl.textContent = formatDuration(cur);
        if (durTimeLbl) durTimeLbl.textContent = formatDuration(dur);
        if (slider && !isUserSeekingSlider && dur > 0) {
          slider.value = String(Math.min(1000, Math.max(0, Math.round((cur / dur) * 1000))));
        }
      };

      videoElem.onloadedmetadata = () => {
        if (seekSeconds > 0 && Number.isFinite(videoElem.duration) && seekSeconds < videoElem.duration) {
          try {
            videoElem.currentTime = seekSeconds;
          } catch (_) {}
        }
        updateSliderUI();
      };

      const onPlaying = () => {
        showVideoWhenReady();
        if (nativeBufferWatchdog) {
          clearTimeout(nativeBufferWatchdog);
          nativeBufferWatchdog = null;
        }
        isUserPaused = false;
        isMiniPaused = false;
        ensureAudioKeepAlive();
        if (useDualStream && audioElem && audioElem.src && audioElem.paused) {
          audioElem.play().catch(() => {});
        }
        updatePlayPauseIcons(true);
        syncNativeMediaService(true, true);
        scheduleOverlayAutoHide();
      };

      videoElem.onloadeddata = showVideoWhenReady;
      videoElem.oncanplay = showVideoWhenReady;
      videoElem.onplaying = onPlaying;
      videoElem.onplay = onPlaying;
      videoElem.onpause = () => {
        if (audioElem && audioElem.src && videoElem.muted && isUserPaused) {
          audioElem.pause();
        }
        if (isUserPaused) {
          updatePlayPauseIcons(false);
          if (Date.now() >= _nativeHandoffLockUntil) {
            syncNativeMediaService(false, true);
          }
          customOverlay?.classList.remove('controls-hidden');
          return;
        }
        if (state.activeVideo && state.isAudioMode) {
          // In background: dedicated audio track continues playing with ZERO pause!
          if (useDualStream && audioElem && audioElem.src && audioElem.paused) {
            audioElem.play().catch(() => {});
          }
          return;
        }
        updatePlayPauseIcons(false);
        // Do not overwrite native foreground playback state when paused by our own OS background handoff
        if (Date.now() >= _nativeHandoffLockUntil) {
          syncNativeMediaService(false, true);
        }
        customOverlay?.classList.remove('controls-hidden');
      };
      videoElem.ontimeupdate = () => {
        updateSliderUI();
        if (audioElem && audioElem.src && videoElem.muted && !videoElem.paused && !document.hidden) {
          const diff = videoElem.currentTime - audioElem.currentTime;
          if (Math.abs(diff) > 0.25) {
            try { videoElem.currentTime = audioElem.currentTime; } catch (_) {}
          }
        }
        syncNativeMediaService(null, false);
      };
      if (audioElem) {
        audioElem.ontimeupdate = () => {
          if (document.hidden && !audioElem.paused) {
            const cur = audioElem.currentTime || 0;
            const dur = Number.isFinite(audioElem.duration) ? audioElem.duration : (video.duration || 0);
            if (curTimeLbl) curTimeLbl.textContent = formatDuration(cur);
            if (durTimeLbl) durTimeLbl.textContent = formatDuration(dur);
            if (slider && !isUserSeekingSlider && dur > 0) {
              slider.value = String(Math.min(1000, Math.max(0, Math.round((cur / dur) * 1000))));
            }
            syncNativeMediaService(true, false);
          }
        };
      }
      videoElem.onwaiting = () => {
        if (spinner) spinner.style.display = 'flex';
      };
      videoElem.onended = () => {
        if (!state.isLooping && state.autoplay && state.suggestedVideos && state.suggestedVideos.length > 0) {
          openVideoPlayer(state.suggestedVideos[0]);
        } else {
          updatePlayPauseIcons(false);
          syncNativeMediaService(false, true);
        }
      };

      videoElem.onerror = () => {
        // Guard: ignore errors if src was cleared or during teardown
        if (!videoElem.src || videoElem.src === window.location.href || videoElem.src === '') return;
        if (state.activeVideo?.id !== video.id || state.playbackEngine !== 'native') return;

        if (!triedFallback && fallbackStreamUrl && videoElem.src !== fallbackStreamUrl) {
          triedFallback = true;
          console.warn('[Player] Trying backup stream source...');
          startVideoSource(fallbackStreamUrl);
          return;
        }
        if (spinner) spinner.style.display = 'none';
        if (!video.isExternal) {
          console.warn('[Player] Native stream failed, switching to YouTube player fallback');
          showToast('Switching to YouTube player...');
          state.playbackEngine = 'youtube';
          setupPlayerPlayback(video, seekSeconds);
        } else {
          showToast('Stream playback error. Try Download instead.');
        }
      };

      // Watchdog: if native stream hasn't buffered within 9s on a YouTube video, seamlessly switch to YouTube engine
      nativeBufferWatchdog = setTimeout(() => {
        if (state.activeVideo?.id === video.id && state.playbackEngine === 'native' && videoElem.readyState < 2 && !video.isExternal) {
          console.warn('[Player] Native stream watchdog -> activating YouTube player');
          state.playbackEngine = 'youtube';
          setupPlayerPlayback(video, seekSeconds);
        }
      }, 9000);
    }
  }
}

async function loadSuggestedVideos(currentVideo) {
  const container = document.getElementById('player-suggested-list');
  if (!container) return;

  container.innerHTML = `
    <div style="display:flex; justify-content:center; padding:25px;">
      <div class="spinner" style="width:24px; height:24px;"></div>
    </div>
  `;

  try {
    let searchTerms = currentVideo.channel || '';
    if (currentVideo.title) {
      const cleanKeywords = currentVideo.title
        .replace(/[^\w\s]/gi, '')
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 3)
        .join(' ');
      if (cleanKeywords) searchTerms = cleanKeywords;
    }

    let list = [];
    try {
      const res = await api.search(searchTerms || 'trending', 1);
      list = res && res.videos ? res.videos.filter((v) => v.id !== currentVideo.id) : [];
    } catch (_) {}

    if (list.length === 0) {
      const fallback = await api.getTrending('all', 1);
      list = fallback && fallback.videos ? fallback.videos.filter((v) => v.id !== currentVideo.id) : [];
    }

    state.suggestedVideos = list.slice(0, 12);
    renderSuggestedVideos(state.suggestedVideos);
  } catch (err) {
    container.innerHTML = '<div style="padding:15px; text-align:center; color:var(--text-gray); font-size:12px;">No related videos found</div>';
  }
}

function renderSuggestedVideos(videos) {
  const container = document.getElementById('player-suggested-list');
  if (!container) return;
  container.innerHTML = '';

  if (videos.length === 0) {
    container.innerHTML = '';
    return;
  }

  videos.forEach((video) => {
    const card = document.createElement('div');
    card.className = 'suggested-card';
    const durationText = video.duration_string || formatDuration(video.duration);
    const viewsText = formatViews(video.view_count);
    const channelName = video.channel || 'Creator';

    card.innerHTML = `
      <div class="suggested-thumb-box">
        <img class="suggested-thumb-img" src="${video.thumbnail}" alt="${video.title}" loading="lazy" />
        ${durationText ? `<span class="suggested-duration-badge">${durationText}</span>` : ''}
      </div>
      <div class="suggested-info-box">
        <div class="suggested-video-title">${video.title}</div>
        <div class="suggested-channel-row">
          <div class="suggested-channel-text">${channelName} • ${viewsText}</div>
          <div class="suggested-actions">
            <button class="suggested-quick-download" title="Download">
              <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.suggested-quick-download')) {
        e.stopPropagation();
        openDownloadModal(video);
      } else {
        openVideoPlayer(video);
      }
    });

    container.appendChild(card);
  });
}

function initPlayerControls() {
  const modal = document.getElementById('player-modal');
  const videoElem = document.getElementById('html5-video-element');
  const speedSelect = document.getElementById('player-speed-select');
  const bgAudioBtn = document.getElementById('btn-bg-audio');
  const loopBtn = document.getElementById('btn-loop-toggle');
  const downloadBtn = document.getElementById('btn-player-download');
  const mediaBox = document.getElementById('player-media-box');
  const customOverlay = document.getElementById('player-custom-overlay');
  const settingsSheet = document.getElementById('player-settings-sheet');
  const qualityOptsDiv = document.getElementById('setting-quality-options');
  const seekSlider = document.getElementById('player-seek-slider');

  if (bgAudioBtn) bgAudioBtn.classList.toggle('active', Boolean(state.isAudioMode));

  document.getElementById('btn-minimize-player')?.addEventListener('click', () => {
    minimizeToMiniPlayer();
  });

  // Floating Mini-Player Click & Action Handlers
  modal?.addEventListener('click', (e) => {
    if (!modal.classList.contains('mini-floating')) return;

    if (e.target.closest('#btn-mini-float-close')) {
      e.stopPropagation();
      stopAllPlayback();
      hideMiniPlayer();
      modal.classList.remove('open');
      syncNativeOverlayFlag();
      return;
    }

    if (e.target.closest('#btn-mini-float-playpause')) {
      e.stopPropagation();
      const isPlaying = state.playbackEngine === 'native' && videoElem ? !videoElem.paused : (!isMiniPaused && !isUserPaused);
      if (isPlaying) {
        pauseCurrentPlayback();
      } else {
        resumeCurrentPlayback();
      }
      return;
    }

    // Tapping anywhere else on the floating card expands it back to fullscreen smoothly!
    expandFromMiniPlayer();
  });

  document.getElementById('btn-close-player')?.addEventListener('click', () => {
    stopAllPlayback();
    hideMiniPlayer();
    modal.classList.remove('open');
    syncNativeOverlayFlag();
    if (state.activeTab === 'home' && state.activeCategory === 'all' && !state.searchQuery) {
      loadFeed('all');
    }
  });

  // Tap video box -> toggle Snaptube custom controls visibility
  mediaBox?.addEventListener('click', (e) => {
    if (state.playbackEngine !== 'native' || !customOverlay) return;
    if (e.target.closest('button') || e.target.closest('input')) {
      scheduleOverlayAutoHide();
      return;
    }
    if (customOverlay.classList.contains('controls-hidden')) {
      scheduleOverlayAutoHide();
    } else {
      if (overlayAutoHideTimer) clearTimeout(overlayAutoHideTimer);
      customOverlay.classList.add('controls-hidden');
    }
  });

  // Snaptube Overlay Back button (exits fullscreen or minimizes cleanly with BG play preserved)
  document.getElementById('btn-st-back')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.fullscreenLandscape) {
      setFullscreenLandscape(false);
    } else {
      minimizeToMiniPlayer();
    }
  });

  document.getElementById('btn-st-playpause')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.playbackEngine === 'youtube') {
      if (ytIsPlaying) {
        pauseCurrentPlayback();
      } else {
        resumeCurrentPlayback();
      }
    } else {
      const v = document.getElementById('html5-video-element');
      if (!v) return;
      if (v.paused) {
        resumeCurrentPlayback();
      } else {
        pauseCurrentPlayback();
      }
    }
    scheduleOverlayAutoHide();
  });

  document.getElementById('btn-st-prev')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (videoElem && videoElem.currentTime > 4) {
      const targetSec = Math.max(0, videoElem.currentTime - 10);
      videoElem.currentTime = targetSec;
      const audioElem = document.getElementById('html5-audio-element');
      if (audioElem && audioElem.src && videoElem.muted) {
        try { audioElem.currentTime = targetSec; } catch (_) {}
      }
    } else {
      const hist = getWatchHistory();
      const prevVid = hist.find((v) => v.id !== state.activeVideo?.id);
      if (prevVid) openVideoPlayer(prevVid);
      else if (videoElem) {
        videoElem.currentTime = 0;
        const audioElem = document.getElementById('html5-audio-element');
        if (audioElem && audioElem.src && videoElem.muted) {
          try { audioElem.currentTime = 0; } catch (_) {}
        }
      }
    }
    scheduleOverlayAutoHide();
  });

  document.getElementById('btn-st-next')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.suggestedVideos && state.suggestedVideos.length > 0) {
      openVideoPlayer(state.suggestedVideos[0]);
    } else {
      showToast('Loading next video...');
    }
  });

  document.getElementById('btn-st-fullscreen')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setFullscreenLandscape(!state.fullscreenLandscape);
    scheduleOverlayAutoHide();
  });

  // Seek Slider
  seekSlider?.addEventListener('input', (e) => {
    e.stopPropagation();
    isUserSeekingSlider = true;
    if (overlayAutoHideTimer) clearTimeout(overlayAutoHideTimer);
    if (videoElem && Number.isFinite(videoElem.duration)) {
      const targetSec = (Number(seekSlider.value) / 1000) * videoElem.duration;
      const curTimeLbl = document.getElementById('st-time-current');
      if (curTimeLbl) curTimeLbl.textContent = formatDuration(targetSec);
    }
  });
  seekSlider?.addEventListener('change', (e) => {
    e.stopPropagation();
    isUserSeekingSlider = false;
    if (videoElem && Number.isFinite(videoElem.duration)) {
      const targetSec = (Number(seekSlider.value) / 1000) * videoElem.duration;
      videoElem.currentTime = targetSec;
      const audioElem = document.getElementById('html5-audio-element');
      if (audioElem && audioElem.src && videoElem.muted) {
        try { audioElem.currentTime = targetSec; } catch (_) {}
      }
      syncNativeMediaService(null, true);
    }
    scheduleOverlayAutoHide();
  });

  // Captions toggle (overlay CC badge + settings sheet row)
  const toggleCaptions = () => {
    state.captionsOn = !state.captionsOn;
    const ccBtn = document.getElementById('btn-st-cc');
    const ccVal = document.getElementById('setting-val-captions');
    if (ccBtn) ccBtn.classList.toggle('active', state.captionsOn);
    if (ccVal) ccVal.textContent = state.captionsOn ? 'On' : 'Off';
    if (videoElem && videoElem.textTracks) {
      for (let i = 0; i < videoElem.textTracks.length; i++) {
        videoElem.textTracks[i].mode = state.captionsOn ? 'showing' : 'hidden';
      }
    }
    showToast(state.captionsOn ? 'Captions Enabled (if available)' : 'Captions Off');
  };
  document.getElementById('btn-st-cc')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCaptions();
  });
  document.getElementById('row-setting-captions')?.addEventListener('click', toggleCaptions);

  // Settings Sheet Open/Close
  const openSettingsSheet = (e) => {
    e?.stopPropagation();
    if (!settingsSheet) return;
    renderQualityOptionsSheet();
    settingsSheet.style.display = 'flex';
    syncNativeOverlayFlag();
  };
  document.getElementById('btn-st-settings')?.addEventListener('click', openSettingsSheet);
  document.getElementById('btn-player-settings-pill')?.addEventListener('click', openSettingsSheet);
  settingsSheet?.addEventListener('click', (e) => {
    if (e.target === settingsSheet) {
      settingsSheet.style.display = 'none';
      syncNativeOverlayFlag();
    }
  });
  document.getElementById('row-setting-quality')?.addEventListener('click', () => {
    if (!qualityOptsDiv) return;
    qualityOptsDiv.style.display = qualityOptsDiv.style.display === 'none' ? 'flex' : 'none';
  });
  document.getElementById('row-setting-autoplay')?.addEventListener('click', () => {
    state.autoplay = !state.autoplay;
    const autoVal = document.getElementById('setting-val-autoplay');
    if (autoVal) autoVal.textContent = state.autoplay ? 'On' : 'Off';
    showToast(state.autoplay ? 'Autoplay Next ON' : 'Autoplay Next OFF');
  });

  // Floating Mini-Player bar listeners
  document.getElementById('mini-player-expand-btn')?.addEventListener('click', () => {
    expandFromMiniPlayer();
  });

  document.getElementById('btn-mini-play-pause')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMiniPlayPause();
  });

  document.getElementById('btn-mini-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    stopAllPlayback();
    hideMiniPlayer();
    syncNativeOverlayFlag();
  });

  speedSelect?.addEventListener('change', (e) => {
    state.playbackRate = Number(e.target.value) || 1.0;
    if (videoElem) videoElem.playbackRate = state.playbackRate;
  });

  loopBtn?.addEventListener('click', () => {
    state.isLooping = !state.isLooping;
    if (videoElem) videoElem.loop = state.isLooping;
    loopBtn.classList.toggle('active', state.isLooping);
    const loopVal = document.getElementById('setting-val-loop');
    if (loopVal) loopVal.textContent = state.isLooping ? 'On' : 'Off';
    showToast(state.isLooping ? 'Loop Video ON' : 'Loop Video OFF');
  });

  bgAudioBtn?.addEventListener('click', () => {
    state.isAudioMode = !state.isAudioMode;
    try { localStorage.setItem('metube_bg_play', state.isAudioMode ? '1' : '0'); } catch (_) {}
    bgAudioBtn.classList.toggle('active', state.isAudioMode);
    bgAudioBtn.innerHTML = `${ICONS.headphones}<span>${state.isAudioMode ? 'Active' : 'Background'}</span>`;
    bgAudioBtn.title = state.isAudioMode ? 'Background Play: ON (Tap to toggle)' : 'Background Play: OFF (Tap to toggle)';
    syncNativeMediaService(null, true);
    if (state.isAudioMode) {
      showToast('Background Play ON: Smooth gapless playback in background & recents');
    } else {
      try { window.AndroidMediaService?.stopService?.(); } catch (_) {}
      showToast('Background Play OFF');
    }
  });

  document.getElementById('btn-engine-toggle')?.addEventListener('click', () => {
    if (state.activeVideo?.isExternal) {
      showToast('External links use Native Player');
      return;
    }
    state.playbackEngine = state.playbackEngine === 'youtube' ? 'native' : 'youtube';
    if (state.activeVideo) {
      setupPlayerPlayback(state.activeVideo);
    }
  });

  downloadBtn?.addEventListener('click', () => {
    if (state.activeVideo) openDownloadModal(state.activeVideo);
  });

  // Channel Card click
  document.getElementById('player-channel-card')?.addEventListener('click', () => {
    if (state.activeVideo && !state.activeVideo.isExternal) {
      minimizeToMiniPlayer();
      openChannelExplorer(state.activeVideo);
    }
  });

  // Subscribe button
  const subBtn = document.getElementById('btn-sub-toggle');
  subBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!state.activeVideo) return;
    const isNowSubbed = toggleChannelSubscription({
      id: state.activeVideo.channel_id,
      name: state.activeVideo.channel || 'Creator'
    });
    state.isSubscribed = isNowSubbed;
    subBtn.textContent = isNowSubbed ? 'Subscribed' : 'Subscribe';
    subBtn.classList.toggle('subscribed', isNowSubbed);
    subBtn.style.background = '';
    subBtn.style.color = '';
  });

  // Like button
  const playerLikeBtn = document.getElementById('btn-player-like');
  playerLikeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!state.activeVideo || !state.activeVideo.id) return;
    const isLiked = playerLikeBtn.classList.toggle('active');
    playerLikeBtn.style.color = isLiked ? '#FF0000' : 'var(--text-white)';
    const countElem = document.getElementById('player-like-count');
    if (countElem) countElem.textContent = isLiked ? 'Liked' : 'Like';
    showToast(isLiked ? 'Added to Liked videos' : 'Removed from Liked videos');
    api.likeVideo(state.activeVideo.id, isLiked ? 'like' : 'none').catch((err) => console.debug('Player like sync:', err));
  });
}

// =========================================================
// 6. SNAPTUBE DOWNLOAD RESOLUTION MODAL
// =========================================================
function formatBytesMb(bytes) {
  if (!bytes || bytes <= 0) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function openDownloadModal(video) {
  state.activeVideo = video;
  const modal = document.getElementById('download-modal');
  const thumb = document.getElementById('download-modal-thumb');
  const title = document.getElementById('download-modal-title');
  const channel = document.getElementById('download-modal-channel');
  const confirmText = document.getElementById('download-confirm-text');

  thumb.src = video.thumbnail || (video.isExternal ? '' : `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`);
  title.textContent = video.title || 'Media Download';
  channel.textContent = video.channel || 'Creator';
  confirmText.textContent = `Download ${state.selectedFormat.label}`;

  modal.style.display = 'flex';
  modal.classList.add('open');
  syncNativeOverlayFlag();

  // Populate accurate estimated sizes for audio & video presets
  api.getFormats(video.isExternal ? (video.url || video.id) : video.id, Boolean(video.isExternal))
    .then((fmtData) => {
      if (!fmtData) return;
      if (fmtData.url && state.activeVideo && !state.activeVideo.url) {
        state.activeVideo.url = fmtData.url;
      }
      const allPresets = [...(fmtData.audio_presets || []), ...(fmtData.video_presets || [])];
      document.querySelectorAll('.preset-card-option').forEach((card) => {
        const match = allPresets.find(
          (p) => p.type === card.dataset.type && p.quality === card.dataset.quality
        );
        const tag = card.querySelector('.preset-size-tag');
        if (match && match.est_size_mb && tag) {
          tag.textContent = `~${match.est_size_mb} MB`;
        }
      });
    })
    .catch(() => {});
}

function initDownloadModal() {
  const modal = document.getElementById('download-modal');
  const confirmBtn = document.getElementById('btn-confirm-download');
  const confirmText = document.getElementById('download-confirm-text');

  const closeDownload = () => {
    modal.classList.remove('open');
    setTimeout(() => {
      if (!modal.classList.contains('open')) {
        modal.style.display = 'none';
      }
    }, 220);
    syncNativeOverlayFlag();
  };

  document.getElementById('btn-close-download-modal')?.addEventListener('click', closeDownload);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeDownload();
  });

  // Select format options
  document.querySelectorAll('.preset-card-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.preset-card-option').forEach((o) => o.classList.remove('selected'));
      opt.classList.add('selected');
      state.selectedFormat = {
        type: opt.dataset.type,
        quality: opt.dataset.quality,
        label: opt.querySelector('.preset-name').textContent
      };
      confirmText.textContent = `Download ${state.selectedFormat.label}`;
    });
  });

  // Fast Direct Browser Download fallback
  document.getElementById('btn-fast-browser-download')?.addEventListener('click', () => {
    if (!state.activeVideo) return;
    const directWebUrl = state.activeVideo.isExternal
      ? (state.activeVideo.direct_stream_url || state.activeVideo.url)
      : `https://y2mate.is/en/?url=https://www.youtube.com/watch?v=${state.activeVideo.id}`;
    if (!directWebUrl) return;
    if (typeof window !== 'undefined' && (window.Capacitor?.isNativePlatform?.() || window.Capacitor !== undefined)) {
      window.open(directWebUrl, '_system');
    } else {
      window.open(directWebUrl, '_blank');
    }
    modal.classList.remove('open');
    syncNativeOverlayFlag();
  });

  // Start download click (YouTube OR ANY platform URL)
  confirmBtn?.addEventListener('click', async () => {
    if (!state.activeVideo) return;
    confirmBtn.disabled = true;
    confirmText.textContent = 'Starting Download...';

    try {
      const isAudioFmt = (t) => ['audio', 'mp3', 'm4a'].includes(String(t || '').toLowerCase());
      const canUseNativeDirect = !state.activeVideo.isExternal
        && Boolean(state.activeVideo.id)
        && Boolean(window.AndroidInnerTube?.resolveForDownloadAsync)
        && Boolean(window.AndroidDownloader?.startDownloadFull || window.AndroidDownloader?.startDownloadWithUa || window.AndroidDownloader?.startDownload);

      if (canUseNativeDirect) {
        const wantAudio = isAudioFmt(state.selectedFormat.type);
        const fmtType = wantAudio ? 'audio' : 'video';
        const nativeRes = await resolveViaNativeInnerTube(state.activeVideo.id, fmtType);
        if (nativeRes?.ok && nativeRes.url) {
          const rawTitle = state.activeVideo.title || nativeRes.title || state.activeVideo.id;
          const safeTitle = rawTitle.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim().slice(0, 60) || state.activeVideo.id;
          const ext = wantAudio ? (state.selectedFormat.type === 'mp3' ? 'mp3' : (nativeRes.ext || 'm4a')) : (nativeRes.ext || 'mp4');
          const filename = `${safeTitle}.${ext}`;
          const jobId = `local_${state.activeVideo.id}_${fmtType}_${Date.now()}`;
          const isSourceVideo = Boolean(nativeRes.extractAudio) || (nativeRes.mimeType && nativeRes.mimeType.startsWith('video/'));
          const extractAudio = wantAudio && isSourceVideo;
          const mimeType = wantAudio ? (ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4') : (nativeRes.mimeType || 'video/mp4');
          const localJob = {
            job_id: jobId,
            video_id: state.activeVideo.id,
            title: rawTitle,
            format_type: fmtType,
            quality: wantAudio ? (ext.toUpperCase() + ' Audio') : (state.selectedFormat.quality || 'Direct'),
            status: 'downloading',
            percent: 5,
            filename,
            client_direct_url: nativeRes.url,
            userAgent: nativeRes.userAgent || '',
            mimeType,
            extractAudio,
            isLocalDirect: true,
            created_at: Date.now()
          };
          state.localDownloads = [localJob, ...(state.localDownloads || [])].slice(0, 40);
          saveLocalDownloads(state.localDownloads);
          autoSavedJobIds.add(jobId);
          saveSetToStorage(AUTOSAVED_JOBS_KEY, autoSavedJobIds);
          triggerSaveToDevice(nativeRes.url, filename, jobId, nativeRes.userAgent || '', mimeType, extractAudio);

          modal.classList.remove('open');
          confirmBtn.disabled = false;
          confirmText.textContent = `Download ${state.selectedFormat.label}`;
          syncNativeOverlayFlag();
          lastDownloadsSyncAt = 0;
          loadDownloadsList(true);
          switchTab('downloads');
          return;
        }
      }

      await api.startDownload(
        state.activeVideo.isExternal ? '' : state.activeVideo.id,
        state.selectedFormat.type,
        state.selectedFormat.quality,
        state.activeVideo.title || 'Media',
        state.activeVideo.url || ''
      );

      modal.classList.remove('open');
      confirmBtn.disabled = false;
      confirmText.textContent = `Download ${state.selectedFormat.label}`;
      syncNativeOverlayFlag();

      lastDownloadsSyncAt = 0;
      loadDownloadsList(true);
      switchTab('downloads');
    } catch (err) {
      alert(`Could not start download: ${err.message}`);
      confirmBtn.disabled = false;
      confirmText.textContent = `Download ${state.selectedFormat.label}`;
    }
  });
}

// =========================================================
// 7. DOWNLOADS MANAGER & REAL-TIME PROGRESS (INSTANT CACHE-FIRST)
// =========================================================
// Track completed download jobs that have been dispatched to native storage
const AUTOSAVED_JOBS_KEY = 'metube_autosaved_jobs';
const NATIVE_DM_MAP_KEY = 'metube_native_dm_map';

function loadSetFromStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch (_) {
    return new Set();
  }
}

function saveSetToStorage(key, s) {
  try { localStorage.setItem(key, JSON.stringify([...s].slice(-100))); } catch (_) {}
}

function loadNativeDmMap() {
  try {
    const raw = localStorage.getItem(NATIVE_DM_MAP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function saveNativeDmMap(map) {
  try { localStorage.setItem(NATIVE_DM_MAP_KEY, JSON.stringify(map)); } catch (_) {}
}

const LOCAL_DL_KEY = 'metube_local_downloads';
function loadLocalDownloads() {
  try {
    const raw = localStorage.getItem(LOCAL_DL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}
function saveLocalDownloads(list) {
  try { localStorage.setItem(LOCAL_DL_KEY, JSON.stringify((list || []).slice(0, 40))); } catch (_) {}
}

const autoSavedJobIds = loadSetFromStorage(AUTOSAVED_JOBS_KEY);
const autoRecoveredJobIds = new Set();
state.nativeDmProgress = loadNativeDmMap();
state.localDownloads = loadLocalDownloads();
let downloadPollTimer = null;
let downloadsInFlight = null;
let lastDownloadsSyncAt = 0;

export function triggerSaveToDevice(url, filename, jobId = null, customUa = null, explicitMime = null, extractAudio = false) {
  console.log(`[Download] Triggering device download for ${filename}: ${url}`);
  const absoluteUrl = url.startsWith('http') ? url : `${getServerUrl()}${url}`;

  // 1. Native Android APK Downloader Bridge (in-process stream + scoped storage writer + MediaExtractor audio convert)
  if (typeof window !== 'undefined' && (window.AndroidDownloader?.startDownloadFull || window.AndroidDownloader?.startDownloadWithUa || window.AndroidDownloader?.startDownload)) {
    console.log('[Download] Using native AndroidDownloader bridge for:', absoluteUrl);
    const lowerName = (filename || '').toLowerCase();
    const mime = explicitMime || (lowerName.endsWith('.mp3') ? 'audio/mpeg' : (lowerName.endsWith('.m4a') ? 'audio/mp4' : 'video/mp4'));
    const dmId = window.AndroidDownloader.startDownloadFull
      ? Number(window.AndroidDownloader.startDownloadFull(absoluteUrl, filename, mime, customUa || '', Boolean(extractAudio)) || -1)
      : (window.AndroidDownloader.startDownloadWithUa
        ? Number(window.AndroidDownloader.startDownloadWithUa(absoluteUrl, filename, mime, customUa || '') || -1)
        : Number(window.AndroidDownloader.startDownload(absoluteUrl, filename, mime) || -1));
    if (jobId && dmId > 0) {
      state.nativeDmProgress[jobId] = {
        dmId,
        status: 1,
        percent: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        localUri: '',
        mimeType: mime,
        filename,
        customUa: customUa || '',
        extractAudio: Boolean(extractAudio)
      };
      saveNativeDmMap(state.nativeDmProgress);
    }
    showToast(`Saving ${filename || 'file'} to Downloads/MeTube...`);
    return;
  }

  // 2. Capacitor native shell fallback
  if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
    console.log('[Download] Opening via Capacitor system browser:', absoluteUrl);
    window.open(absoluteUrl, '_system');
    return;
  }

  // 3. Standard Web browser download
  try {
    const a = document.createElement('a');
    a.href = absoluteUrl;
    a.download = filename || 'download';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) document.body.removeChild(a);
    }, 1000);
  } catch (_) {
    window.location.href = absoluteUrl;
  }
}

function getMergedDownloadsList() {
  const local = Array.isArray(state.localDownloads) ? state.localDownloads : [];
  const localIds = new Set(local.map((l) => l.job_id));
  const remote = Array.isArray(state.downloads) ? state.downloads.filter((d) => !localIds.has(d.job_id)) : [];
  return [...local, ...remote];
}

function isAudioFmtType(t) {
  return ['audio', 'mp3', 'm4a'].includes(String(t || '').toLowerCase());
}

async function recoverJobViaNativeInnerTube(item) {
  if (!item?.video_id || !window.AndroidInnerTube?.resolveForDownloadAsync) return false;
  const fmtType = isAudioFmtType(item.format_type) ? 'audio' : 'video';
  const res = await resolveViaNativeInnerTube(item.video_id, fmtType);
  if (!res?.ok || !res.url) return false;
  const safeBase = (item.title || res.title || item.video_id).replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim().slice(0, 60) || item.video_id;
  const ext = res.ext || (fmtType === 'audio' ? 'm4a' : 'mp4');
  const filename = `${safeBase}.${ext}`;
  const recoveredJob = {
    job_id: item.job_id,
    video_id: item.video_id,
    title: item.title || res.title || item.video_id,
    format_type: fmtType,
    quality: fmtType === 'audio' ? 'M4A Audio' : (item.quality || 'Direct'),
    status: 'client_ready',
    filename,
    client_direct_url: res.url,
    userAgent: res.userAgent || '',
    mimeType: res.mimeType || (fmtType === 'audio' ? 'audio/mp4' : 'video/mp4'),
    extractAudio: Boolean(res.extractAudio),
    isLocalDirect: true,
    created_at: item.created_at || Date.now()
  };
  state.localDownloads = [recoveredJob, ...(state.localDownloads || []).filter((d) => d.job_id !== item.job_id)].slice(0, 40);
  saveLocalDownloads(state.localDownloads);
  autoSavedJobIds.add(item.job_id);
  saveSetToStorage(AUTOSAVED_JOBS_KEY, autoSavedJobIds);
  triggerSaveToDevice(res.url, filename, item.job_id, res.userAgent || '', recoveredJob.mimeType, Boolean(res.extractAudio));
  return true;
}

async function loadDownloadsList(force = false) {
  const container = document.getElementById('downloads-list');
  const counter = document.getElementById('nav-download-counter');
  if (!container) return;

  if (downloadsInFlight) return downloadsInFlight;
  const now = Date.now();
  if (!force && (now - lastDownloadsSyncAt) < 550) return;

  // 1. Instant Cache-First (0ms Render)
  let hadCache = false;
  try {
    const cached = localStorage.getItem('metube_downloads_cache');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) state.downloads = parsed;
    }
  } catch (e) {}
  const initialMerged = getMergedDownloadsList();
  if (initialMerged.length > 0) {
    renderDownloadsDOM(container, counter, initialMerged);
    hadCache = true;
  }

  if (!hadCache) {
    container.innerHTML = `
      <div class="spinner-box">
        <div class="spinner"></div>
      </div>
    `;
  }

  lastDownloadsSyncAt = now;
  if (downloadPollTimer) {
    clearTimeout(downloadPollTimer);
    downloadPollTimer = null;
  }

  // 2. Background Sync (device-isolated via X-Device-Id / device_id)
  downloadsInFlight = (async () => {
    try {
      const res = await api.listDownloads();
      state.downloads = res.downloads || [];
      localStorage.setItem('metube_downloads_cache', JSON.stringify(state.downloads));

      // Auto-save completed downloads to Android device storage once & track DownloadManager progress
      let hasActiveNative = false;
      const merged = getMergedDownloadsList();
      merged.forEach((item) => {
        const isReady = item.status === 'completed' || item.status === 'client_ready';
        if (!item.isLocalDirect && item.status === 'error' && item.video_id && !autoRecoveredJobIds.has(item.job_id) && window.AndroidInnerTube?.resolveForDownloadAsync) {
          autoRecoveredJobIds.add(item.job_id);
          recoverJobViaNativeInnerTube(item).then((ok) => {
            if (ok) loadDownloadsList(true);
          });
        } else if (isReady && item.filename && !autoSavedJobIds.has(item.job_id)) {
          autoSavedJobIds.add(item.job_id);
          saveSetToStorage(AUTOSAVED_JOBS_KEY, autoSavedJobIds);
          const rawUrl = item.status === 'completed'
            ? api.getFileDownloadUrl(item.filename)
            : (item.client_direct_url || item.download_url || '');
          if (!item.isLocalDirect && rawUrl && String(rawUrl).includes('/api/stream/') && item.video_id && !autoRecoveredJobIds.has(item.job_id) && window.AndroidInnerTube?.resolveForDownloadAsync) {
            autoRecoveredJobIds.add(item.job_id);
            recoverJobViaNativeInnerTube(item).then((ok) => {
              if (!ok) {
                const fileUrl = rawUrl.startsWith('http') ? rawUrl : `${getServerUrl()}${rawUrl}`;
                triggerSaveToDevice(fileUrl, item.filename, item.job_id);
              }
              loadDownloadsList(true);
            });
          } else if (rawUrl) {
            const fileUrl = rawUrl.startsWith('http') ? rawUrl : `${getServerUrl()}${rawUrl}`;
            triggerSaveToDevice(fileUrl, item.filename, item.job_id, item.userAgent || null, item.mimeType || null);
          }
        }

        const dmEntry = state.nativeDmProgress[item.job_id];
        if (dmEntry && dmEntry.dmId > 0 && window.AndroidDownloader?.getDownloadProgress) {
          try {
            const rawProg = window.AndroidDownloader.getDownloadProgress(dmEntry.dmId);
            const parsedProg = JSON.parse(rawProg || '{}');
            const rawSt = parsedProg?.status;
            const normSt = typeof rawSt === 'number'
              ? rawSt
              : (rawSt === 'pending' ? 1 : (rawSt === 'running' ? 2 : (rawSt === 'paused' ? 4 : (rawSt === 'successful' ? 8 : (rawSt === 'failed' ? 16 : 0)))));
            if (parsedProg && normSt > 0) {
              parsedProg.status = normSt;
              state.nativeDmProgress[item.job_id] = {
                ...dmEntry,
                ...parsedProg
              };
              if (item.isLocalDirect) {
                if (normSt === 8) {
                  item.status = 'completed';
                  item.percent = 100;
                  saveLocalDownloads(state.localDownloads);
                } else if (normSt === 16) {
                  item.status = 'error';
                  item.error = parsedProg.error || 'Download failed';
                  saveLocalDownloads(state.localDownloads);
                } else {
                  item.status = 'downloading';
                  item.percent = parsedProg.percent || item.percent || 15;
                  item.downloaded_bytes = parsedProg.downloadedBytes;
                  item.total_bytes = parsedProg.totalBytes;
                }
              }
              if (normSt === 1 || normSt === 2 || normSt === 4) {
                hasActiveNative = true;
              }
            }
          } catch (_) {}
        }
      });
      saveNativeDmMap(state.nativeDmProgress);

      const finalMerged = getMergedDownloadsList();
      renderDownloadsDOM(container, counter, finalMerged);

      // Active polling if server OR phone DownloadManager is still working
      const hasActiveServer = state.downloads.some(
        (d) => d.status === 'downloading' || d.status === 'queued' || d.status === 'converting'
      );
      if (downloadPollTimer) {
        clearTimeout(downloadPollTimer);
        downloadPollTimer = null;
      }
      if (hasActiveServer || hasActiveNative) {
        downloadPollTimer = setTimeout(() => loadDownloadsList(true), 1200);
      }
    } catch (err) {
      const offlineMerged = getMergedDownloadsList();
      if (offlineMerged.length > 0) {
        renderDownloadsDOM(container, counter, offlineMerged);
      } else if (!hadCache) {
        container.innerHTML = `
          <div style="text-align:center; padding:30px; color:var(--text-gray); font-size:13px;">
            No downloads found.
          </div>
        `;
      }
    } finally {
      downloadsInFlight = null;
    }
  })();
  return downloadsInFlight;
}

function renderDownloadsDOM(container, counter, downloadsList) {
  const activeCount = downloadsList.filter((d) => {
    const dm = state.nativeDmProgress[d.job_id];
    const dmRunning = dm && (dm.status === 1 || dm.status === 2 || dm.status === 4);
    return d.status === 'downloading' || d.status === 'queued' || d.status === 'converting' || dmRunning;
  }).length;

  if (counter) {
    counter.style.display = activeCount > 0 ? 'inline-block' : 'none';
    counter.textContent = activeCount;
  }

  if (downloadsList.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:40px 20px; color:var(--text-gray);">
        <div style="margin-bottom:10px; color:var(--text-gray);">${ICONS.download}</div>
        <div style="font-size:14px; font-weight:700; color:#FFF;">No downloads yet</div>
        <div style="font-size:11px; margin-top:4px;">Tap download on any video or paste a link to start!</div>
      </div>
    `;
    return;
  }

  container.innerHTML = downloadsList.map((item) => {
    const isCompleted = item.status === 'completed' || item.status === 'client_ready';
    const isProgressing = item.status === 'downloading' || item.status === 'queued' || item.status === 'converting';
    const isError = item.status === 'error';
    const rawUrl = item.status === 'completed'
      ? api.getFileDownloadUrl(item.filename)
      : (item.client_direct_url || item.download_url || '#');
    const fileUrl = isCompleted ? (rawUrl.startsWith('http') ? rawUrl : `${getServerUrl()}${rawUrl}`) : '#';

    const dm = state.nativeDmProgress[item.job_id];
    const dmActive = isCompleted && dm && (dm.status === 1 || dm.status === 2 || dm.status === 4);
    const dmSuccess = isCompleted && dm && dm.status === 8;
    const dmFailed = isCompleted && dm && dm.status === 16;

    const rawServerPct = Math.round(item.percent ?? item.progress_percent ?? 0);
    const serverPct = isProgressing ? Math.max(item.status === 'queued' ? 6 : 8, Math.min(99, rawServerPct)) : 100;
    const dmPct = dm ? Math.max(5, Math.min(100, Math.round(dm.percent || 0))) : 100;
    const errText = item.error ?? item.error_message ?? 'Download failed';

    const serverBytesText = (item.downloaded_bytes || item.total_bytes)
      ? `${formatBytesMb(item.downloaded_bytes) || '0 MB'}${item.total_bytes ? ` / ${formatBytesMb(item.total_bytes)}` : ''}`
      : '';
    const dmBytesText = dm && (dm.downloadedBytes || dm.totalBytes)
      ? `${formatBytesMb(dm.downloadedBytes) || '0 MB'}${dm.totalBytes ? ` / ${formatBytesMb(dm.totalBytes)}` : ''}`
      : '';

    return `
      <div style="background:#181818; border:1px solid var(--border); border-radius:10px; padding:12px;" data-job-id="${item.job_id}">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="font-size:10px; font-weight:800; background:#272727; color:#FFF; padding:2px 7px; border-radius:4px;">
            ${(item.format_type || 'MP4').toUpperCase()} • ${item.quality}
          </span>
          <button class="quick-btn btn-delete-download" data-job="${item.job_id}" data-local="${item.isLocalDirect ? '1' : '0'}" title="Delete">${ICONS.trash}</button>
        </div>
        <div style="font-size:13px; font-weight:700; color:#FFF; line-height:17px;">${item.title}</div>
        
        ${isProgressing ? `
          <div style="margin-top:8px;">
            <div style="height:6px; background:#282828; border-radius:3px; overflow:hidden;">
              <div style="height:100%; width:${serverPct}%; background:linear-gradient(90deg,#FF0000,#F59E0B); border-radius:3px; transition:width 0.35s ease;"></div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-gray); margin-top:4px;">
              <span>${item.status === 'converting' ? 'Converting & merging audio...' : (item.status === 'queued' ? 'Preparing stream...' : `${serverBytesText || item.speed || 'Fetching'} ${item.eta ? `• ETA ${item.eta}` : ''}`)}</span>
              <span style="font-weight:700; color:#FFF;">${rawServerPct > 0 ? `${rawServerPct}%` : '...'}</span>
            </div>
          </div>
        ` : ''}

        ${dmActive ? `
          <div style="margin-top:8px;">
            <div style="height:6px; background:#282828; border-radius:3px; overflow:hidden;">
              <div style="height:100%; width:${dmPct}%; background:linear-gradient(90deg,#22C55E,#4ADE80); border-radius:3px; transition:width 0.35s ease;"></div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:10px; color:#A7F3D0; margin-top:4px;">
              <span>Saving to Downloads/MeTube ${dmBytesText ? `(${dmBytesText})` : ''}</span>
              <span style="font-weight:700;">${dmPct}%</span>
            </div>
          </div>
        ` : ''}

        ${isError ? `
          <div style="margin-top:8px; font-size:11px; color:#FF5252; background:rgba(255,82,82,0.1); padding:8px 10px; border-radius:6px;">
            <div style="margin-bottom:4px;">${errText}</div>
            ${item.video_id ? `<button class="btn-fast-dl-card" data-job="${item.job_id}" data-video-id="${item.video_id}" data-type="${item.format_type || 'video'}" style="margin-top:4px; background:#272727; color:#FFF; border:1px solid #444; padding:6px 10px; border-radius:6px; font-size:11px; font-weight:700; width:100%; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">${ICONS.refresh} <span>Retry On Device</span></button>` : ''}
          </div>
        ` : ''}

        ${(isCompleted && !dmActive) ? `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:10px; padding-top:8px; border-top:1px solid var(--border-subtle);">
            ${(dmSuccess || item.isLocalDirect) ? `
              <span style="font-size:11px; font-weight:700; color:#4ADE80; display:inline-flex; align-items:center; gap:4px;">${ICONS.check} <span>Downloaded to MeTube</span></span>
              <button class="btn-open-native" data-uri="${dm?.localUri || ''}" data-mime="${dm?.mimeType || item.mimeType || ''}" data-url="${fileUrl}" data-filename="${item.filename}" data-type="${item.format_type}" style="background:#FFF; color:#000; border:none; padding:8px 18px; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
                ${ICONS.play} <span>Play</span>
              </button>
            ` : `
              <button class="btn-save-device" data-job="${item.job_id}" data-video-id="${item.video_id || ''}" data-type="${item.format_type || 'video'}" data-url="${fileUrl}" data-filename="${item.filename}" data-ua="${(item.userAgent || dm?.customUa || '').replace(/"/g, '&quot;')}" data-mime="${(item.mimeType || dm?.mimeType || '').replace(/"/g, '&quot;')}" style="flex:1; background:#272727; color:#FFF; border:1px solid #444; padding:9px 12px; border-radius:6px; font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
                <span>${dmFailed ? 'Retry Download' : 'Save to Phone'}</span>
              </button>
              <button class="btn-play-offline" data-uri="${dm?.localUri || ''}" data-mime="${dm?.mimeType || item.mimeType || ''}" data-url="${fileUrl}" data-filename="${item.filename}" data-type="${item.format_type}" style="background:#FFF; color:#000; border:none; padding:9px 16px; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
                ${ICONS.play} <span>Play</span>
              </button>
            `}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  // Attach Save to Device event (with fresh InnerTube re-resolution on failed YouTube items)
  container.querySelectorAll('.btn-save-device').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const jobId = btn.dataset.job || null;
      const vId = btn.dataset.videoId || '';
      const fmtType = btn.dataset.type || 'video';
      const dm = jobId ? state.nativeDmProgress[jobId] : null;
      if (vId && window.AndroidInnerTube?.resolveForDownloadAsync && (dm?.status === 16 || dm?.status === 0 || !dm || String(btn.dataset.url).includes('/api/stream/'))) {
        btn.disabled = true;
        const fresh = await resolveViaNativeInnerTube(vId, isAudioFmtType(fmtType) ? 'audio' : 'video');
        btn.disabled = false;
        if (fresh?.ok && fresh.url) {
          triggerSaveToDevice(fresh.url, btn.dataset.filename, jobId, fresh.userAgent || '', fresh.mimeType || btn.dataset.mime || null, Boolean(fresh.extractAudio));
          setTimeout(() => loadDownloadsList(true), 600);
          return;
        }
      }
      triggerSaveToDevice(btn.dataset.url, btn.dataset.filename, jobId, btn.dataset.ua || null, btn.dataset.mime || null, Boolean(dm?.extractAudio));
      setTimeout(() => loadDownloadsList(true), 600);
    });
  });

  // Attach Open Saved File event
  container.querySelectorAll('.btn-open-native').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.uri && window.AndroidDownloader?.openDownloadedFile) {
        window.AndroidDownloader.openDownloadedFile(btn.dataset.uri, btn.dataset.mime || 'video/mp4');
      } else {
        openOfflinePlayer(btn.dataset.url || api.getFileDownloadUrl(btn.dataset.filename), btn.dataset.filename, btn.dataset.type);
      }
    });
  });

  // Attach Retry On Device (or external fallback) event on error cards
  container.querySelectorAll('.btn-fast-dl-card').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const vId = btn.dataset.videoId;
      const jobId = btn.dataset.job;
      const fmtType = btn.dataset.type === 'audio' ? 'audio' : 'video';
      if (!vId) return;
      if (window.AndroidInnerTube?.resolveForDownloadAsync) {
        btn.disabled = true;
        btn.textContent = 'Resolving on phone...';
        const existing = getMergedDownloadsList().find((d) => d.job_id === jobId) || { job_id: jobId, video_id: vId, format_type: fmtType };
        const ok = await recoverJobViaNativeInnerTube(existing);
        if (ok) {
          loadDownloadsList(true);
          return;
        }
        btn.disabled = false;
        btn.textContent = 'Open Web Downloader';
      }
      const directWebUrl = `https://y2mate.is/en/?url=https://www.youtube.com/watch?v=${vId}`;
      if (typeof window !== 'undefined' && (window.Capacitor?.isNativePlatform?.() || window.Capacitor !== undefined)) {
        window.open(directWebUrl, '_system');
      } else {
        window.open(directWebUrl, '_blank');
      }
    });
  });

  // Attach Delete event
  container.querySelectorAll('.btn-delete-download').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const jobId = btn.dataset.job;
      const isLocal = btn.dataset.local === '1';
      delete state.nativeDmProgress[jobId];
      autoSavedJobIds.delete(jobId);
      saveNativeDmMap(state.nativeDmProgress);
      saveSetToStorage(AUTOSAVED_JOBS_KEY, autoSavedJobIds);
      state.localDownloads = (state.localDownloads || []).filter((d) => d.job_id !== jobId);
      saveLocalDownloads(state.localDownloads);
      if (!isLocal) {
        try {
          await api.deleteDownload(jobId);
        } catch (_) {}
      }
      loadDownloadsList(true);
    });
  });

  // Attach Play Offline event
  container.querySelectorAll('.btn-play-offline').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.uri && window.AndroidDownloader?.openDownloadedFile) {
        window.AndroidDownloader.openDownloadedFile(btn.dataset.uri, btn.dataset.mime || 'video/mp4');
        return;
      }
      const rawUrl = btn.dataset.url;
      const fileUrl = (rawUrl && rawUrl !== '#' && !rawUrl.includes('undefined'))
        ? rawUrl
        : api.getFileDownloadUrl(btn.dataset.filename);
      openOfflinePlayer(fileUrl, btn.dataset.filename, btn.dataset.type);
    });
  });
}

function openOfflinePlayer(fileUrl, filename, formatType) {
  const modal = document.getElementById('player-modal');
  const videoElem = document.getElementById('html5-video-element');
  const iframeContainer = document.getElementById('embed-iframe-container');
  const titleElem = document.getElementById('player-video-title');
  const channelElem = document.getElementById('player-channel-name');
  const bgAudioBtn = document.getElementById('btn-bg-audio');

  stopAllPlayback('main-native');
  state.playbackEngine = 'native';
  state.activeVideo = {
    id: `offline_${filename || Date.now()}`,
    title: filename || 'Downloaded Media',
    channel: 'Offline Downloads',
    isExternal: true,
    isOffline: true,
    direct_stream_url: fileUrl,
    direct_audio_url: fileUrl
  };

  modal.classList.add('open');
  syncNativeOverlayFlag();
  titleElem.textContent = filename || 'Downloaded Media';
  if (channelElem) channelElem.textContent = 'Offline Downloads';
  if (bgAudioBtn) bgAudioBtn.classList.toggle('active', Boolean(state.isAudioMode));
  if (iframeContainer) {
    iframeContainer.style.display = 'none';
    iframeContainer.innerHTML = '';
  }
  if (videoElem) {
    videoElem.style.display = 'block';
    videoElem.src = fileUrl;
    videoElem.onplay = () => {
      updatePlayPauseIcons(true);
      syncNativeMediaService(true, true);
    };
    videoElem.onpause = () => {
      if (!isMiniPaused && state.isAudioMode) {
        videoElem.play().catch(() => {});
        return;
      }
      updatePlayPauseIcons(false);
      if (Date.now() >= _nativeHandoffLockUntil) syncNativeMediaService(false, true);
    };
    videoElem.ontimeupdate = () => syncNativeMediaService(null, false);
    videoElem.play().catch(() => {});
    syncNativeMediaService(true, true);
  }
}

// =========================================================
// 8. CHANNEL PROFILE EXPLORER
// =========================================================
let activeChannelTab = 'videos';

async function loadChannelTab(tab = 'videos') {
  activeChannelTab = tab;
  const video = state.activeChannel;
  const container = document.getElementById('channel-videos-container');
  const avatarBigImg = document.getElementById('channel-avatar-big-img');
  const bannerImg = document.getElementById('channel-banner-img');
  const titleName = document.getElementById('channel-name-title');
  const topName = document.getElementById('channel-top-name');
  const statsLine = document.getElementById('channel-stats-line');
  const bioLine = document.getElementById('channel-bio-line');

  document.querySelectorAll('[data-chantab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.chantab === tab);
  });

  if (!container || !video) return;
  container.innerHTML = `<div class="spinner-box"><div class="spinner"></div></div>`;

  const lookup = video.channel_id || video.channel || '';
  if (!lookup) {
    container.innerHTML = `<div style="text-align:center; padding:40px 20px; color:var(--text-gray);">Channel details unavailable.</div>`;
    return;
  }

  try {
    const res = await api.getChannel(lookup, tab === 'live' ? 'videos' : tab, 30);
    if (res) {
      if (res.title) {
        if (titleName) titleName.textContent = res.title;
        if (topName) topName.textContent = res.title;
        if (state.activeChannel) state.activeChannel.channel = res.title;
      }
      if (res.channel_id && state.activeChannel && !state.activeChannel.channel_id) {
        state.activeChannel.channel_id = res.channel_id;
      }
      if (res.avatar && avatarBigImg) {
        avatarBigImg.src = resolveAvatarUrl(res.avatar, res.title || video.channel, res.channel_id || video.channel_id);
      }
      if (res.banner && bannerImg) {
        bannerImg.dataset.bannerRetried = '';
        bannerImg.src = resolveBannerUrl(res.banner, res.title || video.channel, res.channel_id || video.channel_id);
        attachBannerHandlers(bannerImg, res.title || video.channel, res.channel_id || video.channel_id);
      }
      const handleStr = res.handle || `@${(res.title || video.channel || 'Creator').replace(/\s+/g, '')}`;
      const subStr = res.subscribers || res.subscriber_count_text || 'Official Channel';
      if (statsLine) statsLine.textContent = `${handleStr} • ${subStr}`;
      if (bioLine && res.description) {
        bioLine.textContent = res.description.slice(0, 120) + (res.description.length > 120 ? '...' : '');
      }
    }

    const items = (res && res.items) || [];
    container.innerHTML = '';

    if (items.length === 0) {
      const label = tab.charAt(0).toUpperCase() + tab.slice(1);
      container.innerHTML = `
        <div style="text-align:center; padding:42px 20px; color:var(--text-gray);">
          <div style="margin-bottom:8px; color:var(--text-gray);">${ICONS.subscriptions}</div>
          <div style="font-size:14px; font-weight:700; color:#FFF;">No ${label} on this channel</div>
          <div style="font-size:12px; margin-top:4px;">Try switching to Videos or Shorts above.</div>
        </div>
      `;
      return;
    }

    items.forEach((item) => {
      if (item.type === 'playlist' || tab === 'playlists') {
        const plCard = document.createElement('div');
        plCard.style.cssText = 'display:flex; gap:12px; padding:10px 14px; border-bottom:1px solid var(--border-subtle); cursor:pointer; align-items:center;';
        plCard.innerHTML = `
          <div style="position:relative; width:136px; height:76px; border-radius:8px; overflow:hidden; flex-shrink:0; background:#222;">
            <img src="${item.thumbnail || ''}" style="width:100%; height:100%; object-fit:cover;" loading="lazy" />
            <div style="position:absolute; bottom:4px; right:4px; background:rgba(0,0,0,0.8); color:#FFF; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; display:inline-flex; align-items:center; gap:3px;">${ICONS.playlists} <span>${item.item_count || 'Playlist'}</span></div>
          </div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:13px; font-weight:700; color:#FFF; line-height:17px;">${item.title || 'Playlist'}</div>
            <div style="font-size:11px; color:var(--text-gray); margin-top:4px;">${res.title || video.channel} • Playlist</div>
          </div>
        `;
        plCard.addEventListener('click', async () => {
          container.innerHTML = `<div class="spinner-box"><div class="spinner"></div></div>`;
          try {
            const plData = await api.getPlaylist(item.id, 30);
            const vids = (plData && (plData.videos || plData.items)) || [];
            container.innerHTML = `
              <div style="padding:10px 14px; display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--border-subtle);">
                <span style="font-size:13px; font-weight:700; color:#FFF; display:inline-flex; align-items:center; gap:6px;">${ICONS.playlists} <span>${item.title || 'Playlist'}</span></span>
                <button id="btn-back-to-playlists" style="background:#272727; color:#FFF; border:none; padding:5px 10px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">${ICONS.chevronLeft} <span>Back</span></button>
              </div>
            `;
            document.getElementById('btn-back-to-playlists')?.addEventListener('click', () => loadChannelTab('playlists'));
            if (vids.length === 0) {
              container.innerHTML += `<div style="text-align:center; padding:30px; color:var(--text-gray);">Playlist is empty.</div>`;
            } else {
              vids.forEach((pv) => container.appendChild(createVideoCardElement(pv)));
            }
          } catch (_) {
            showToast('Could not open playlist');
            loadChannelTab('playlists');
          }
        });
        container.appendChild(plCard);
      } else if (item.type === 'short' || item.is_short || tab === 'shorts') {
        const sCard = createVideoCardElement(item);
        const thumbBox = sCard.querySelector('.video-thumb-container');
        if (thumbBox) {
          thumbBox.onclick = (ev) => {
            ev.stopPropagation();
            state.shortsList = items;
            openShortsModal(item);
          };
        }
        container.appendChild(sCard);
      } else {
        container.appendChild(createVideoCardElement(item));
      }
    });
  } catch (err) {
    container.innerHTML = `
      <div style="text-align:center; padding:36px 20px;">
        <div style="font-size:13px; color:var(--text-gray); margin-bottom:10px;">Could not load channel (${err.message || 'Network error'})</div>
        <button id="btn-retry-channel" style="background:var(--metube-red); color:#FFF; border:none; padding:8px 18px; border-radius:8px; font-weight:700; cursor:pointer;">Retry</button>
      </div>
    `;
    document.getElementById('btn-retry-channel')?.addEventListener('click', () => loadChannelTab(tab));
  }
}

async function openChannelExplorer(video) {
  state.activeChannel = { ...video };
  const modal = document.getElementById('channel-modal');
  const topName = document.getElementById('channel-top-name');
  const titleName = document.getElementById('channel-name-title');
  const avatarBigImg = document.getElementById('channel-avatar-big-img');
  const bannerImg = document.getElementById('channel-banner-img');
  const statsLine = document.getElementById('channel-stats-line');
  const bioLine = document.getElementById('channel-bio-line');
  const subBtn = document.getElementById('btn-channel-sub');

  const channelName = video.channel || 'Creator';
  const channelId = video.channel_id || '';
  if (topName) topName.textContent = channelName;
  if (titleName) titleName.textContent = channelName;
  if (statsLine) statsLine.textContent = `@${channelName.replace(/\s+/g, '')} • Official Channel`;
  if (bioLine) bioLine.textContent = 'Official creator channel';

  if (bannerImg) {
    bannerImg.dataset.bannerRetried = '';
    attachBannerHandlers(bannerImg, channelName, channelId);
    bannerImg.src = getSvgBannerDataUrl(channelName);
    const targetBanner = resolveBannerUrl(video.channel_banner, channelName, channelId);
    const preloader = new Image();
    preloader.referrerPolicy = 'no-referrer';
    preloader.onload = () => {
      if (state.activeChannel?.channel === channelName) {
        bannerImg.src = targetBanner;
      }
    };
    preloader.onerror = () => {
      const server = getServerUrl();
      const refUrl = `${server}/api/channel/banner?id=${encodeURIComponent(channelId || '')}&name=${encodeURIComponent(channelName)}&raw=1&refresh=1`;
      const retryImg = new Image();
      retryImg.referrerPolicy = 'no-referrer';
      retryImg.onload = () => {
        if (state.activeChannel?.channel === channelName) {
          bannerImg.src = refUrl;
        }
      };
      retryImg.src = refUrl;
    };
    preloader.src = targetBanner;
  }

  if (avatarBigImg) {
    avatarBigImg.dataset.avatarRetried = '';
    attachAvatarHandlers(avatarBigImg, channelName, channelId);
    avatarBigImg.src = resolveAvatarUrl(video.channel_avatar, channelName, channelId);
  }

  const isSub = isChannelSubscribed(channelId, channelName);
  state.isSubscribed = isSub;
  if (subBtn) {
    subBtn.textContent = isSub ? 'Subscribed' : 'Subscribe';
    subBtn.style.background = isSub ? '#272727' : '#FFFFFF';
    subBtn.style.color = isSub ? '#FFFFFF' : '#0F0F0F';
  }

  modal.classList.add('open');
  syncNativeOverlayFlag();
  await loadChannelTab('videos');
}

function initChannelModal() {
  document.getElementById('btn-close-channel')?.addEventListener('click', () => {
    document.getElementById('channel-modal').classList.remove('open');
    syncNativeOverlayFlag();
  });

  document.querySelectorAll('[data-chantab]').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      loadChannelTab(tabBtn.dataset.chantab || 'videos');
    });
  });

  const subBtn = document.getElementById('btn-channel-sub');
  subBtn?.addEventListener('click', () => {
    if (!state.activeChannel) return;
    const isNowSubbed = toggleChannelSubscription({
      id: state.activeChannel.channel_id,
      name: state.activeChannel.channel || 'Creator'
    });
    state.isSubscribed = isNowSubbed;
    subBtn.textContent = isNowSubbed ? 'Subscribed' : 'Subscribe';
    subBtn.style.background = isNowSubbed ? '#272727' : '#FFFFFF';
    subBtn.style.color = isNowSubbed ? '#FFFFFF' : '#0F0F0F';
  });
}

// =========================================================
// 9. 3-DOTS ACTION SHEET
// =========================================================
function openActionsSheet(video) {
  state.targetActionVideo = video;
  const modal = document.getElementById('actions-modal');
  document.getElementById('action-sheet-video-title').textContent = video.title;
  modal.classList.add('open');
  syncNativeOverlayFlag();
}

function initActionsSheet() {
  const modal = document.getElementById('actions-modal');
  document.getElementById('btn-close-action-sheet')?.addEventListener('click', () => {
    modal.classList.remove('open');
    syncNativeOverlayFlag();
  });

  document.getElementById('btn-action-download')?.addEventListener('click', () => {
    modal.classList.remove('open');
    syncNativeOverlayFlag();
    if (state.targetActionVideo) openDownloadModal(state.targetActionVideo);
  });

  document.getElementById('btn-action-watch')?.addEventListener('click', () => {
    modal.classList.remove('open');
    syncNativeOverlayFlag();
    if (state.targetActionVideo) openVideoPlayer(state.targetActionVideo);
  });

  document.getElementById('btn-action-channel')?.addEventListener('click', () => {
    modal.classList.remove('open');
    syncNativeOverlayFlag();
    if (state.targetActionVideo) openChannelExplorer(state.targetActionVideo);
  });
}

// =========================================================
// APPEARANCE & THEME MANAGER (Light, Dark, System Default)
// =========================================================
function applyTheme(theme) {
  document.body.classList.remove('theme-dark', 'theme-light', 'theme-system');
  if (theme === 'dark') {
    document.body.classList.add('theme-dark');
  } else if (theme === 'light') {
    document.body.classList.add('theme-light');
  } else {
    document.body.classList.add('theme-system');
  }

  // Update active state on settings theme buttons
  document.querySelectorAll('.theme-select-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });

  // Update meta theme-color for system bars
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia && !window.matchMedia('(prefers-color-scheme: light)').matches);
  let metaTheme = document.querySelector('meta[name="theme-color"]');
  if (!metaTheme) {
    metaTheme = document.createElement('meta');
    metaTheme.name = 'theme-color';
    document.head.appendChild(metaTheme);
  }
  metaTheme.content = isDark ? '#0F0F0F' : '#FFFFFF';
}

function initThemeManager() {
  const currentTheme = localStorage.getItem('metube_theme') || 'system';
  applyTheme(currentTheme);

  // Wire buttons in Settings
  document.querySelectorAll('.theme-select-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const selected = btn.dataset.theme || 'system';
      try { localStorage.setItem('metube_theme', selected); } catch (_) {}
      applyTheme(selected);
      showToast(`Appearance: ${selected === 'system' ? 'Device theme' : (selected === 'dark' ? 'Dark theme' : 'Light theme')}`);
    });
  });

  // Listen to OS theme changes if on system default
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      const active = localStorage.getItem('metube_theme') || 'system';
      if (active === 'system') applyTheme('system');
    });
  }
}

// =========================================================
// 10. SETTINGS VIEW
// =========================================================
function initSettingsView() {
  const input = document.getElementById('setting-server-url');
  const saveBtn = document.getElementById('btn-save-server');
  const testBtn = document.getElementById('btn-test-server');
  const output = document.getElementById('settings-health-output');

  if (input) input.value = getServerUrl();
  if (input && input.dataset.inited === '1') {
    updateAuthStatusUI();
    return;
  }
  if (input) input.dataset.inited = '1';

  saveBtn?.addEventListener('click', () => {
    const saved = setServerUrl(input.value);
    output.textContent = `Server URL saved: ${saved}`;
    checkServerHealth();
  });

  testBtn?.addEventListener('click', async () => {
    output.textContent = 'Testing connection...';
    try {
      const data = await api.checkHealth();
      output.textContent = `Connected! Status: ${data.status}`;
      checkServerHealth();
    } catch (e) {
      output.textContent = `Error connecting: ${e.message}`;
    }
  });

  document.getElementById('btn-settings-signin')?.addEventListener('click', () => {
    if (window.AndroidAuth?.launchYouTubeLogin) {
      window.AndroidAuth.launchYouTubeLogin(false);
    } else {
      openAuthModal();
    }
  });

  document.getElementById('btn-settings-switch-ac')?.addEventListener('click', () => {
    if (window.AndroidAuth?.launchYouTubeLogin) {
      window.AndroidAuth.launchYouTubeLogin(true);
    } else {
      openAuthModal();
    }
  });

  document.getElementById('btn-settings-signout')?.addEventListener('click', async () => {
    if (!confirm('Sign out of connected YouTube account on this device?')) return;
    try {
      await api.logout();
      localStorage.removeItem('metube_account_name');
      window.AndroidAuth?.clearYouTubeCookies?.();
      updateAuthStatusUI(true);
      showToast('Signed out on this device');
      if (state.activeTab === 'home') loadFeed(state.activeCategory);
    } catch (err) {
      showToast(`Sign out error: ${err.message}`);
    }
  });

  updateAuthStatusUI();
}

// =========================================================
// 10. REAL-TIME SYSTEM DIAGNOSTICS & LOG VIEWER
// =========================================================
function initDiagnostics() {
  const modal = document.getElementById('diagnostics-modal');
  const openBtn = document.getElementById('btn-open-diagnostics');
  const debugBtn = document.getElementById('btn-player-debug');
  const closeBtn = document.getElementById('btn-close-diagnostics');
  const pingBtn = document.getElementById('btn-diag-test-server');
  const testStreamBtn = document.getElementById('btn-diag-test-stream');
  const forcePlayBtn = document.getElementById('btn-diag-force-play');
  const copyBtn = document.getElementById('btn-diag-copy-logs');
  const clearBtn = document.getElementById('btn-diag-clear-logs');
  const logBox = document.getElementById('diag-log-container');

  const updateDiagnosticsUI = () => {
    const sUrl = document.getElementById('diag-server-url');
    const vInfo = document.getElementById('diag-video-info');
    const vSrc = document.getElementById('diag-video-src');
    const vState = document.getElementById('diag-video-state');
    const vErr = document.getElementById('diag-video-error');
    const videoElem = document.getElementById('html5-video-element');

    if (sUrl) sUrl.textContent = `Server: ${getServerUrl()}`;
    if (vInfo) vInfo.textContent = state.activeVideo ? `${state.activeVideo.title} (${state.activeVideo.id})` : 'No video selected';
    if (vSrc && videoElem) vSrc.textContent = `Src: ${videoElem.src || '(none)'}`;
    
    if (vState && videoElem) {
      const states = ['0 (HAVE_NOTHING)', '1 (HAVE_METADATA)', '2 (HAVE_CURRENT_DATA)', '3 (HAVE_FUTURE_DATA)', '4 (HAVE_ENOUGH_DATA)'];
      vState.textContent = `ReadyState: ${states[videoElem.readyState] || videoElem.readyState} | Paused: ${videoElem.paused} | Time: ${Math.round(videoElem.currentTime)}s / ${Math.round(videoElem.duration || 0)}s`;
    }
    
    if (vErr && videoElem) {
      const err = videoElem.error;
      vErr.textContent = err ? `Error: Code ${err.code} (${err.message || 'Media decode/network error'})` : 'Error: None (Healthy)';
    }

    if (logBox) {
      logBox.textContent = capturedLogs.join('\n');
      logBox.scrollTop = logBox.scrollHeight;
    }
  };

  const showDiagModal = () => {
    modal?.classList.add('open');
    syncNativeOverlayFlag();
    updateDiagnosticsUI();
  };

  openBtn?.addEventListener('click', showDiagModal);
  debugBtn?.addEventListener('click', showDiagModal);
  closeBtn?.addEventListener('click', () => {
    modal?.classList.remove('open');
    syncNativeOverlayFlag();
  });

  pingBtn?.addEventListener('click', async () => {
    const sPing = document.getElementById('diag-server-ping');
    if (sPing) sPing.textContent = 'Ping: Testing round-trip latency...';
    const t0 = performance.now();
    try {
      const res = await api.checkHealth();
      const ms = Math.round(performance.now() - t0);
      if (sPing) sPing.textContent = `Ping: ${ms}ms (Status: ${res.status}, yt-dlp: ${res.yt_dlp_version || 'active'})`;
    } catch (e) {
      if (sPing) sPing.textContent = `Ping: Error: ${e.message}`;
    }
  });

  testStreamBtn?.addEventListener('click', async () => {
    const out = document.getElementById('diag-stream-test-result');
    const videoElem = document.getElementById('html5-video-element');
    const streamUrl = videoElem?.src;
    if (!streamUrl) {
      if (out) out.textContent = 'No stream URL loaded.';
      return;
    }
    if (out) out.textContent = 'Testing Range bytes 0-1000...';
    try {
      const res = await fetch(streamUrl, {
        headers: { 'Range': 'bytes=0-1000' }
      });
      const ct = res.headers.get('content-type');
      const cr = res.headers.get('content-range');
      const cl = res.headers.get('content-length');
      if (out) out.textContent = `Result: HTTP ${res.status} | Type: ${ct} | Range: ${cr} | Length: ${cl}`;
    } catch (err) {
      if (out) out.textContent = `Fetch Failed: ${err.message}`;
    }
  });

  forcePlayBtn?.addEventListener('click', () => {
    const videoElem = document.getElementById('html5-video-element');
    if (videoElem) {
      videoElem.play().then(() => {
        console.log('[Player] Force Play triggered successfully.');
      }).catch((e) => {
        console.error('[Player] Force Play rejected:', e);
      });
      updateDiagnosticsUI();
    }
  });

  copyBtn?.addEventListener('click', () => {
    const text = capturedLogs.join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.innerHTML = `${ICONS.copy} <span>Copy Logs</span>`; }, 2000);
    }).catch(() => {
      alert('Could not auto-copy. Select text manually from log box.');
    });
  });

  clearBtn?.addEventListener('click', () => {
    capturedLogs.length = 0;
    if (logBox) logBox.textContent = '';
  });
}

// =========================================================
// 11. SHORTS FULLSCREEN VERTICAL REEL CONTROLLER
// =========================================================
let currentShortsSessionToken = 0;
let shortsFallbackWatchdog = null;

export function closeShortsReel() {
  currentShortsSessionToken++;
  if (shortsFallbackWatchdog) {
    clearTimeout(shortsFallbackWatchdog);
    shortsFallbackWatchdog = null;
  }
  const modal = document.getElementById('shorts-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.style.display = 'none';
  }
  const shortsVideo = document.getElementById('shorts-video-element');
  if (shortsVideo) {
    shortsVideo.onerror = null;
    shortsVideo.onloadeddata = null;
    shortsVideo.oncanplay = null;
    shortsVideo.onplaying = null;
    shortsVideo.onplay = null;
    shortsVideo.onpause = null;
    shortsVideo.ontimeupdate = null;
    try {
      shortsVideo.pause();
      shortsVideo.currentTime = 0;
      shortsVideo.removeAttribute('src');
      shortsVideo.load();
    } catch (_) {}
    shortsVideo.style.display = 'none';
  }
  const embedContainer = document.getElementById('shorts-embed-container');
  if (embedContainer) {
    embedContainer.innerHTML = '';
    embedContainer.style.display = 'none';
  }
  const poster = document.getElementById('shorts-poster-bg');
  if (poster) {
    poster.style.display = 'none';
    poster.removeAttribute('src');
  }
  const spinner = document.getElementById('shorts-spinner');
  if (spinner) spinner.style.display = 'none';

  // Immediately stop any native media service playback: ONLY LONG VIDEOS ON BG
  try {
    window.AndroidMediaService?.syncState?.(false, false, 0, 0, '', '', '', '', '');
    window.AndroidMediaService?.stopNativePlayback?.();
    window.AndroidMediaService?.stopService?.();
  } catch (_) {}

  syncNativeOverlayFlag();
}

async function openShortsFeedReel() {
  state.activeTab = 'shorts';
  const modal = document.getElementById('shorts-modal');
  const spinner = document.getElementById('shorts-spinner');
  if (modal) {
    modal.style.display = 'block';
    modal.classList.add('open');
  }
  if (spinner) spinner.style.display = 'flex';
  syncNativeOverlayFlag();

  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === 'shorts');
  });

  const sessionToken = ++currentShortsSessionToken;
  state.shortsSessionSeed = Date.now();
  state.shortsPage = 1;
  state.shortsNextToken = '';
  const interestKw = getRecentInterestKeywords() || '';
  const seenStr = (state.shortsSeenIds || []).slice(-60).join(',');

  try {
    const res = await api.getShorts(1, {
      interests: interestKw,
      seen: seenStr,
      seed: state.shortsSessionSeed
    });
    if (sessionToken !== currentShortsSessionToken || state.activeTab !== 'shorts') return;
    if (res && res.shorts && res.shorts.length > 0) {
      state.shortsList = res.shorts;
      state.shortsNextToken = res.next_token || '';
      state.currentShortIndex = 0;
    } else if (state.shorts && state.shorts.length > 0) {
      state.shortsList = [...state.shorts].sort(() => Math.random() - 0.5);
      state.currentShortIndex = 0;
    }
  } catch (e) {
    if (sessionToken !== currentShortsSessionToken || state.activeTab !== 'shorts') return;
    if (state.shorts && state.shorts.length > 0) {
      state.shortsList = [...state.shorts].sort(() => Math.random() - 0.5);
      state.currentShortIndex = 0;
    }
  }

  if (sessionToken !== currentShortsSessionToken || state.activeTab !== 'shorts') return;

  if (state.shortsList.length > 0) {
    openShortsModal(state.shortsList[0]);
  } else {
    try {
      const resTrend = await api.getTrending('shorts', 1);
      if (sessionToken !== currentShortsSessionToken || state.activeTab !== 'shorts') return;
      if (resTrend && resTrend.videos && resTrend.videos.length > 0) {
        state.shortsList = resTrend.videos;
        openShortsModal(state.shortsList[0]);
        return;
      }
    } catch (_) {}
    if (spinner) spinner.style.display = 'none';
    showToast('Could not load Shorts. Please check connection.');
  }
}

function openShortsModal(short) {
  if (!short) return;
  state.activeTab = 'shorts';
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === 'shorts');
  });
  const modal = document.getElementById('shorts-modal');
  const embedContainer = document.getElementById('shorts-embed-container');
  const videoElem = document.getElementById('shorts-video-element');
  const spinner = document.getElementById('shorts-spinner');

  if (!modal) return;

  const thisShortsToken = ++currentShortsSessionToken;
  const isShortsActive = () => {
    const m = document.getElementById('shorts-modal');
    return thisShortsToken === currentShortsSessionToken &&
           state.activeTab === 'shorts' &&
           m && (m.classList.contains('open') || m.style.display === 'block');
  };

  if (shortsFallbackWatchdog) {
    clearTimeout(shortsFallbackWatchdog);
    shortsFallbackWatchdog = null;
  }

  // Zero simultaneous playback: teardown all main audio/video + native service immediately!
  stopAllPlayback('shorts-native');

  // ONLY LONG VIDEOS ON BG: Shorts must NEVER play in background!
  try {
    window.AndroidMediaService?.syncState?.(false, false, 0, 0, '', '', '', '', '');
    window.AndroidMediaService?.stopNativePlayback?.();
    window.AndroidMediaService?.stopService?.();
  } catch (_) {}

  let idx = state.shortsList.findIndex((s) => s.id === short.id);
  if (idx < 0) {
    state.shortsList.unshift(short);
    idx = 0;
  }
  state.currentShortIndex = idx;

  const currentShort = state.shortsList[idx];
  if (!state.shortsSeenIds.includes(currentShort.id)) {
    state.shortsSeenIds.push(currentShort.id);
    if (state.shortsSeenIds.length > 100) state.shortsSeenIds.shift();
  }

  modal.style.display = 'block';
  modal.classList.add('open');
  syncNativeOverlayFlag();

  const cName = currentShort.channel || 'Creator';
  const channelNameElem = document.getElementById('shorts-channel-name');
  const avatarImg = document.getElementById('shorts-channel-avatar');
  if (channelNameElem) channelNameElem.textContent = `@${cName.replace(/\s+/g, '')}`;
  if (avatarImg) {
    avatarImg.src = resolveAvatarUrl(currentShort.channel_avatar, cName, currentShort.channel_id);
    attachAvatarHandlers(avatarImg, cName, currentShort.channel_id);
  }

  // Instant visual feedback: display high-res poster backdrop immediately (0ms visual)
  const posterImg = document.getElementById('shorts-poster-bg');
  if (posterImg) {
    const thumb = currentShort.thumbnail || `https://i.ytimg.com/vi/${currentShort.id}/hqdefault.jpg`;
    posterImg.src = thumb;
    posterImg.style.display = 'block';
    posterImg.style.opacity = '1';
  }

  // Pre-fetch next short's thumbnail in background memory cache for instant swiping
  const nextShort = state.shortsList[idx + 1];
  if (nextShort) {
    const preImg = new Image();
    preImg.src = nextShort.thumbnail || `https://i.ytimg.com/vi/${nextShort.id}/hqdefault.jpg`;
  }

  const launchShortsEmbed = () => {
    if (!isShortsActive()) return;
    if (state.shortsList[state.currentShortIndex]?.id !== currentShort.id) return;
    if (shortsFallbackWatchdog) {
      clearTimeout(shortsFallbackWatchdog);
      shortsFallbackWatchdog = null;
    }
    if (videoElem) {
      videoElem.onerror = null;
      videoElem.onloadeddata = null;
      videoElem.onplaying = null;
      videoElem.onplay = null;
      videoElem.onpause = null;
      try { videoElem.pause(); videoElem.removeAttribute('src'); videoElem.load(); } catch (_) {}
      videoElem.style.display = 'none';
    }
    if (spinner) spinner.style.display = 'none';
    if (embedContainer) {
      embedContainer.style.display = 'block';
      const muteParam = state.isShortMuted ? 1 : 0;
      const existingIframe = document.getElementById('shorts-embed-player');
      if (existingIframe && existingIframe.contentWindow) {
        existingIframe.title = (currentShort.title || 'Short').replace(/"/g, '&quot;');
        // Seamless instant video transition using IFrame API (no page or script reload!)
        existingIframe.contentWindow.postMessage(JSON.stringify({
          event: 'command',
          func: 'loadVideoById',
          args: [currentShort.id, 0]
        }), '*');
        existingIframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
      } else {
        // Clean YouTube embed with pointer-events:none so gestures pass to gesture surface
        embedContainer.innerHTML = `
          <iframe 
            id="shorts-embed-player"
            src="https://www.youtube-nocookie.com/embed/${currentShort.id}?autoplay=1&playsinline=1&controls=0&loop=1&playlist=${currentShort.id}&modestbranding=1&rel=0&iv_load_policy=3&enablejsapi=1&mute=${muteParam}"
            title="${(currentShort.title || 'Short').replace(/"/g, '&quot;')}"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            style="width:100%; height:100%; border:none; pointer-events:none;"
          ></iframe>
        `;
      }
    }
  };

  // Launch official YouTube Shorts player directly & immediately
  launchShortsEmbed();
}

function showShortsCenterFeedback(type) {
  const el = document.getElementById('shorts-center-feedback');
  if (!el) return;
  let iconHtml = '';
  if (type === 'play') {
    iconHtml = `<svg viewBox="0 0 24 24" width="38" height="38" fill="#FFF"><polygon points="6 4 20 12 6 20 6 4"/></svg>`;
  } else if (type === 'pause') {
    iconHtml = `<svg viewBox="0 0 24 24" width="38" height="38" fill="#FFF"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
  } else if (type === 'liked') {
    iconHtml = `<svg viewBox="0 0 24 24" width="50" height="50" fill="#FF0000"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
  }
  el.innerHTML = iconHtml;
  el.style.display = 'flex';
  el.classList.remove('animate');
  void el.offsetWidth;
  el.classList.add('animate');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => {
    el.style.display = 'none';
    el.classList.remove('animate');
  }, 480);
}

function initShortsPlayer() {
  const modal = document.getElementById('shorts-modal');
  const videoElem = document.getElementById('shorts-video-element');
  const closeBtn = document.getElementById('btn-close-shorts');
  const soundBtn = document.getElementById('btn-shorts-sound');
  const prevBtn = document.getElementById('btn-shorts-prev');
  const nextBtn = document.getElementById('btn-shorts-next');
  const likeBtn = document.getElementById('btn-shorts-like');
  const downloadBtn = document.getElementById('btn-shorts-download');
  const creatorRow = document.getElementById('shorts-creator-pill');

  closeBtn?.addEventListener('click', () => {
    closeShortsReel();
    switchTab('home');
  });

  soundBtn?.addEventListener('click', (e) => {
    e?.stopPropagation?.();
    state.isShortMuted = !state.isShortMuted;
    const frame = document.getElementById('shorts-embed-player');
    if (frame && frame.contentWindow) {
      const func = state.isShortMuted ? 'mute' : 'unMute';
      frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: '' }), '*');
    }
    if (videoElem) videoElem.muted = state.isShortMuted;
    if (soundBtn) soundBtn.innerHTML = state.isShortMuted ? ICONS.volumeMute : ICONS.volumeHigh;
  });

  creatorRow?.addEventListener('click', (e) => {
    e.stopPropagation();
    const cur = state.shortsList[state.currentShortIndex];
    if (!cur) return;
    if (videoElem && !videoElem.paused) videoElem.pause();
    openChannelExplorer(cur);
  });

  let isPrefetchingShorts = false;
  const prefetchMoreShorts = async () => {
    if (isPrefetchingShorts) return;
    isPrefetchingShorts = true;
    try {
      state.shortsPage = (state.shortsPage || 1) + 1;
      const seedVal = Date.now() + Math.floor(Math.random() * 100000);
      const moreRes = await api.getShorts(state.shortsPage, {
        nextToken: state.shortsNextToken || '',
        interests: getRecentInterestKeywords() || '',
        seen: (state.shortsSeenIds || []).slice(-80).join(','),
        seed: seedVal
      });
      state.shortsNextToken = (moreRes && moreRes.next_token) || '';
      if (moreRes && moreRes.shorts && moreRes.shorts.length > 0) {
        const existing = new Set(state.shortsList.map((s) => s.id));
        const seenSet = new Set(state.shortsSeenIds || []);
        // Randomize incoming batch so shorts feed is always diverse and never monotonic
        const incoming = [...moreRes.shorts].sort(() => Math.random() - 0.5);
        const fresh = incoming.filter((s) => !existing.has(s.id) && !seenSet.has(s.id));
        if (fresh.length > 0) {
          state.shortsList.push(...fresh);
        } else {
          const extra = incoming.filter((s) => !existing.has(s.id));
          if (extra.length > 0) {
            state.shortsList.push(...extra);
          } else {
            // Fresh search query for trending shorts
            const queryRes = await api.search('trending shorts viral dance comedy music', 1);
            const queryShorts = (queryRes?.videos || []).filter((v) => !existing.has(v.id)).map((v) => ({ ...v, is_short: true, type: 'short' }));
            if (queryShorts.length > 0) state.shortsList.push(...queryShorts);
          }
        }
      }
    } catch (_) {} finally {
      isPrefetchingShorts = false;
    }
  };

  let isNavigatingShorts = false;
  const goToNextShort = async () => {
    if (isNavigatingShorts) return;
    if (state.shortsList.length === 0) return;
    isNavigatingShorts = true;
    try {
      const nextIdx = state.currentShortIndex + 1;
      if (nextIdx < state.shortsList.length) {
        openShortsModal(state.shortsList[nextIdx]);
      } else {
        await prefetchMoreShorts();
        if (state.currentShortIndex + 1 < state.shortsList.length) {
          openShortsModal(state.shortsList[state.currentShortIndex + 1]);
        } else if (state.shortsList.length > 1) {
          // Pick a random short from the list instead of repeating
          const randIdx = Math.floor(Math.random() * state.shortsList.length);
          openShortsModal(state.shortsList[randIdx]);
        }
      }

      if (state.currentShortIndex >= state.shortsList.length - 4) {
        prefetchMoreShorts();
      }
    } finally {
      setTimeout(() => { isNavigatingShorts = false; }, 320);
    }
  };

  const goToPrevShort = () => {
    if (isNavigatingShorts) return;
    if (state.shortsList.length === 0) return;
    isNavigatingShorts = true;
    try {
      const prevIdx = Math.max(0, state.currentShortIndex - 1);
      openShortsModal(state.shortsList[prevIdx]);
    } finally {
      setTimeout(() => { isNavigatingShorts = false; }, 320);
    }
  };

  nextBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    goToNextShort();
  });
  prevBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    goToPrevShort();
  });

  let isShortPaused = false;
  const toggleShortsPlayPause = () => {
    const frame = document.getElementById('shorts-embed-player');
    const vid = document.getElementById('shorts-video-element');
    isShortPaused = !isShortPaused;
    if (frame && frame.contentWindow) {
      const func = isShortPaused ? 'pauseVideo' : 'playVideo';
      frame.contentWindow.postMessage(`{"event":"command","func":"${func}","args":""}`, '*');
    }
    if (vid) {
      if (isShortPaused) vid.pause();
      else vid.play().catch(() => {});
    }
    showShortsCenterFeedback(isShortPaused ? 'pause' : 'play');
  };

  likeBtn?.addEventListener('click', (e) => {
    e?.stopPropagation?.();
    const isLiked = likeBtn.classList.toggle('active');
    likeBtn.style.color = isLiked ? '#FF0000' : '#FFF';
    showShortsCenterFeedback('liked');
    const cur = state.shortsList[state.currentShortIndex];
    if (cur && cur.id) {
      api.likeVideo(cur.id, isLiked ? 'like' : 'none').catch((err) => console.debug('Short like sync:', err));
    }
  });

  downloadBtn?.addEventListener('click', (e) => {
    e?.stopPropagation?.();
    const cur = state.shortsList[state.currentShortIndex];
    if (cur) openDownloadModal(cur);
  });

  // 100% Reliable Mobile Swipe & Scroll Gestures on Gesture Catcher Surface
  const gestureSurface = document.getElementById('shorts-gesture-catcher') || modal;
  let touchStartY = 0;
  let touchStartX = 0;
  let touchStartTime = 0;
  let lastTapTime = 0;

  gestureSurface?.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches[0]) {
      touchStartY = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
      touchStartTime = Date.now();
    }
  }, { passive: true });

  gestureSurface?.addEventListener('touchend', (e) => {
    if (!e.changedTouches || !e.changedTouches[0]) return;
    const deltaY = e.changedTouches[0].clientY - touchStartY;
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const duration = Date.now() - touchStartTime;

    // Detect Vertical Swipe (Up = Next, Down = Prev)
    if (deltaY < -35 && Math.abs(deltaY) > Math.abs(deltaX) * 0.75) {
      goToNextShort();
      return;
    } else if (deltaY > 35 && Math.abs(deltaY) > Math.abs(deltaX) * 0.75) {
      goToPrevShort();
      return;
    }

    // Detect Tap (Play/Pause) & Double Tap (Like)
    if (Math.abs(deltaY) < 16 && Math.abs(deltaX) < 16 && duration < 320) {
      const now = Date.now();
      if (now - lastTapTime < 320) {
        likeBtn?.click();
      } else {
        toggleShortsPlayPause();
      }
      lastTapTime = now;
    }
  }, { passive: true });

  // Mouse wheel / trackpad scroll support
  let lastWheelAt = 0;
  gestureSurface?.addEventListener('wheel', (e) => {
    const now = Date.now();
    if (now - lastWheelAt < 350) return;
    if (e.deltaY > 25) {
      lastWheelAt = now;
      goToNextShort();
    } else if (e.deltaY < -25) {
      lastWheelAt = now;
      goToPrevShort();
    }
  }, { passive: true });
}

// =========================================================
// 12. YOUTUBE ACCOUNT / COOKIE AUTH & SUBSCRIPTIONS
// =========================================================
function openAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  syncNativeOverlayFlag();
  updateAuthStatusUI();
}

let authStatusInFlight = null;
let lastAuthStatusAt = 0;

function updateNavYouAvatar(avatarUrl = '', accountName = '') {
  const container = document.getElementById('nav-you-avatar-container');
  if (!container) return;
  const cachedAvatar = avatarUrl || localStorage.getItem('metube_account_avatar') || '';
  const cachedName = accountName || localStorage.getItem('metube_account_name') || '';

  if (cachedAvatar && /^https?:\/\//i.test(cachedAvatar)) {
    const escName = (cachedName || 'You').replace(/"/g, '&quot;');
    const initial = (cachedName.trim()[0] || 'Y').toUpperCase();
    container.innerHTML = `
      <img class="nav-you-avatar-img" src="${cachedAvatar}" alt="${escName}" referrerpolicy="no-referrer" onerror="this.onerror=null;this.outerHTML='<div class=\\'nav-you-avatar-initial\\'>${initial}</div>';" />
    `;
  } else if (cachedName) {
    const initial = (cachedName.trim()[0] || 'Y').toUpperCase();
    container.innerHTML = `<div class="nav-you-avatar-initial">${initial}</div>`;
  } else {
    container.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    `;
  }
}

async function updateAuthStatusUI(force = false) {
  if (authStatusInFlight) return authStatusInFlight;
  const now = Date.now();
  if (!force && (now - lastAuthStatusAt) < 4000) return;

  const badge = document.getElementById('auth-status-badge');
  const desc = document.getElementById('auth-status-desc');
  const logoutBtn = document.getElementById('btn-logout-cookies');
  const headerAvatar = document.getElementById('btn-header-avatar');
  const headerAcLabel = document.getElementById('header-ac-label');
  const settingsAcLabel = document.getElementById('settings-account-label');
  const settingsSignoutBtn = document.getElementById('btn-settings-signout');

  lastAuthStatusAt = now;
  authStatusInFlight = (async () => {
    try {
      const res = await api.getAuthStatus();
      if (res.authenticated) {
        const acctName = res.account_name || localStorage.getItem('metube_account_name') || 'YouTube';
        const acctAvatar = res.account_avatar || localStorage.getItem('metube_account_avatar') || '';
        localStorage.setItem('metube_account_name', acctName);
        if (acctAvatar) {
          localStorage.setItem('metube_account_avatar', acctAvatar);
        }
        if (badge) {
          badge.textContent = 'Connected';
          badge.style.background = '#00C853';
          badge.style.color = '#FFF';
        }
        if (desc) desc.textContent = `Signed in as ${acctName} (device isolated)`;
        if (logoutBtn) logoutBtn.style.display = 'block';
        if (headerAcLabel) headerAcLabel.textContent = `${acctName.split(/\s+/)[0].slice(0, 10)} ▾`;
        if (settingsAcLabel) settingsAcLabel.textContent = `Connected: ${acctName} (isolated to this device)`;
        if (settingsSignoutBtn) settingsSignoutBtn.style.display = 'inline-block';
        if (headerAvatar) {
          if (acctAvatar) {
            headerAvatar.innerHTML = `<img src="${acctAvatar}" referrerpolicy="no-referrer" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" onerror="this.onerror=null;this.parentNode.textContent='${acctName[0]?.toUpperCase() || 'Y'}';" />`;
            headerAvatar.style.background = 'transparent';
          } else {
            headerAvatar.textContent = acctName[0]?.toUpperCase() || 'Y';
            headerAvatar.style.background = '#00C853';
          }
          headerAvatar.style.borderColor = '#00E676';
        }
        updateNavYouAvatar(acctAvatar, acctName);
      } else {
        localStorage.removeItem('metube_account_name');
        localStorage.removeItem('metube_account_avatar');
        if (badge) {
          badge.textContent = 'Disconnected';
          badge.style.background = '#333';
          badge.style.color = '#aaa';
        }
        if (desc) desc.textContent = 'Sign in to sync your personal YouTube feed';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (headerAcLabel) headerAcLabel.textContent = 'Sign in';
        if (settingsAcLabel) settingsAcLabel.textContent = 'Not connected (isolated per device)';
        if (settingsSignoutBtn) settingsSignoutBtn.style.display = 'none';
        if (headerAvatar) {
          headerAvatar.textContent = 'M';
          headerAvatar.style.background = 'var(--metube-red, #FF0000)';
          headerAvatar.style.borderColor = 'transparent';
        }
        updateNavYouAvatar('', '');
      }
    } catch (err) {
      if (badge) badge.textContent = 'Unknown';
    } finally {
      authStatusInFlight = null;
    }
  })();
  return authStatusInFlight;
}

// Global Bridge Handler for Android 1-Tap Google / YouTube Login & Account Switcher
window.handleNativeYouTubeLogin = async function(payloadOrCookies) {
  if (!payloadOrCookies) return;
  let cookieString = payloadOrCookies;
  let accountName = '';
  if (typeof payloadOrCookies === 'string' && payloadOrCookies.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(payloadOrCookies);
      cookieString = parsed.cookies || '';
      accountName = parsed.account_name || '';
    } catch (_) {}
  } else if (typeof payloadOrCookies === 'object') {
    cookieString = payloadOrCookies.cookies || '';
    accountName = payloadOrCookies.account_name || '';
  }
  if (!cookieString) return;

  showToast('Connecting YouTube account to this device...');
  try {
    const res = await api.saveCookies(cookieString, { account_name: accountName });
    if (res && (res.authenticated || res.success || res.status === 'success')) {
      if (accountName) localStorage.setItem('metube_account_name', accountName);
      localStorage.removeItem('metube_feed_cache_all');
      localStorage.removeItem('metube_feed_cache_subs');
      showToast(`Connected${accountName ? ` (${accountName})` : ''}!`);
      updateAuthStatusUI(true);
      const modal = document.getElementById('auth-modal');
      if (modal) {
        modal.classList.remove('open');
        modal.style.display = 'none';
      }
      syncNativeOverlayFlag();
      loadSubscriptionsView();
      loadFeed('all');
    }
  } catch (err) {
    showToast('Could not sync account: ' + err.message);
  }
};

window.handleNativeYouTubeLoginB64 = function(b64) {
  try {
    const decoded = decodeURIComponent(escape(atob(b64)));
    if (window.handleNativeYouTubeLogin) {
      window.handleNativeYouTubeLogin(decoded);
    }
  } catch (e) {
    console.error('Failed to decode native login payload:', e);
  }
};

// Global Bridge Handler for Android Share Intent (YouTube + External URLs)
window.handleSharedYouTubeUrl = function(url) {
  if (!url) return;
  const vid = extractYouTubeVideoId(url);
  if (vid) {
    showToast('Opening shared YouTube video...');
    openVideoById(vid);
  } else if (/^https?:\/\/\S+/i.test(url.trim())) {
    openUniversalUrl(url.trim());
  }
};

window.handleSharedYouTubeUrlB64 = function(b64) {
  try {
    const url = decodeURIComponent(escape(atob(b64)));
    if (window.handleSharedYouTubeUrl) {
      window.handleSharedYouTubeUrl(url);
    }
  } catch (e) {
    console.error('Failed to decode shared URL:', e);
  }
};

function initAuthModal() {
  const modal = document.getElementById('auth-modal');
  const closeBtn = document.getElementById('btn-close-auth-modal');
  const saveBtn = document.getElementById('btn-save-cookies');
  const logoutBtn = document.getElementById('btn-logout-cookies');
  const input = document.getElementById('auth-cookies-input');
  const syncBtn = document.getElementById('btn-sync-account');
  const avatarBtn = document.getElementById('btn-header-avatar');
  const headerSwitchAcBtn = document.getElementById('btn-header-switch-ac');
  const nativeLoginBtn = document.getElementById('btn-native-google-login');
  const switchGoogleAcBtn = document.getElementById('btn-switch-google-account');

  nativeLoginBtn?.addEventListener('click', () => {
    if (window.AndroidAuth && window.AndroidAuth.launchYouTubeLogin) {
      window.AndroidAuth.launchYouTubeLogin(false);
    } else {
      showToast('Opening Google sign-in...');
      window.open('https://accounts.google.com/ServiceLogin?service=youtube', '_blank');
    }
  });

  switchGoogleAcBtn?.addEventListener('click', () => {
    if (window.AndroidAuth && window.AndroidAuth.launchYouTubeLogin) {
      window.AndroidAuth.launchYouTubeLogin(true);
    } else {
      openAuthModal();
    }
  });

  headerSwitchAcBtn?.addEventListener('click', () => {
    openAuthModal();
  });

  closeBtn?.addEventListener('click', () => {
    if (modal) {
      modal.classList.remove('open');
      modal.style.display = 'none';
    }
    syncNativeOverlayFlag();
  });

  syncBtn?.addEventListener('click', openAuthModal);
  avatarBtn?.addEventListener('click', openAuthModal);

  saveBtn?.addEventListener('click', async () => {
    const cookiesText = input ? input.value.trim() : '';
    if (!cookiesText) {
      alert('Please paste your YouTube cookies or cookies.txt content first.');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Connecting...';

    try {
      await api.saveCookies(cookiesText);
      alert('YouTube account connected successfully!');
      if (modal) {
        modal.classList.remove('open');
        modal.style.display = 'none';
      }
      if (input) input.value = '';
      syncNativeOverlayFlag();
      updateAuthStatusUI(true);
      if (state.activeTab === 'subscriptions') {
        loadSubscriptionsView();
      }
    } catch (err) {
      alert(`Could not save cookies: ${err.message}`);
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `${ICONS.link} <span>Connect Account</span>`;
    }
  });

  logoutBtn?.addEventListener('click', async () => {
    if (!confirm('Disconnect your YouTube account cookies?')) return;
    try {
      await api.logout();
      localStorage.removeItem('metube_account_name');
      window.AndroidAuth?.clearYouTubeCookies?.();
      updateAuthStatusUI(true);
      if (modal) {
        modal.classList.remove('open');
        modal.style.display = 'none';
      }
      syncNativeOverlayFlag();
      if (state.activeTab === 'subscriptions') {
        loadSubscriptionsView();
      }
      if (state.activeTab === 'home') {
        loadFeed(state.activeCategory || 'all');
      }
    } catch (err) {
      alert(`Logout error: ${err.message}`);
    }
  });

  updateAuthStatusUI();
}

function showAddChannelPrompt() {
  const channel = prompt('Enter YouTube channel name or handle (e.g. @MrBeast, @mkbhd, Veritasium):');
  if (!channel || !channel.trim()) return;
  const clean = channel.trim();
  toggleChannelSubscription({ name: clean });
  showToast(`Followed ${clean}`);
  loadSubscriptionsView();
}

async function loadSubscriptionsView() {
  const container = document.getElementById('subscriptions-feed-list');
  if (!container) return;

  container.innerHTML = `
    <div class="spinner-box">
      <div class="spinner"></div>
    </div>
  `;

  try {
    const localSubs = getSubscriptions();
    const localChannelsStr = localSubs.map((s) => s.name || s.id).filter(Boolean).join(',');

    // Fetch account subscriptions feed (+ merge with local followed channels)
    const feed = await api.getUserFeed(localChannelsStr);
    const feedVideos = (feed && Array.isArray(feed.videos)) ? feed.videos : [];
    const serverSubs = (feed && Array.isArray(feed.subscribed_channels)) ? feed.subscribed_channels : [];

    // Merge authentic account subscriptions + local subscriptions
    const allSubsMap = new Map();
    // 1. Add server/authentic subscriptions
    serverSubs.forEach((s) => {
      const key = (s.name || s.id || '').trim().toLowerCase();
      if (key) allSubsMap.set(key, s);
    });
    // 2. Also extract channels from feed videos
    feedVideos.forEach((v) => {
      if (v.channel) {
        const key = v.channel.trim().toLowerCase();
        if (key && !allSubsMap.has(key)) {
          allSubsMap.set(key, { name: v.channel, id: v.channel_id || '', avatar: v.channel_avatar || '' });
        }
      }
    });
    // 3. Add local subscriptions
    localSubs.forEach((s) => {
      const key = (s.name || s.id || '').trim().toLowerCase();
      if (key && !allSubsMap.has(key)) {
        allSubsMap.set(key, s);
      }
    });

    const mergedSubs = Array.from(allSubsMap.values());

    const renderSubsHeaderHtml = () => `
      <div style="padding:12px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-subtle, #222);">
        <span style="font-size:13px; font-weight:700; color:var(--text-white, #FFF);">${mergedSubs.length} Subscriptions</span>
        <div style="display:flex; gap:8px;">
          <button id="btn-add-more-subs" style="background:var(--bg-card, #222); color:var(--text-white, #FFF); border:1px solid var(--border-subtle, #444); padding:6px 12px; border-radius:16px; font-size:12px; font-weight:700; cursor:pointer;">+ Add Channel</button>
          <button id="btn-sync-cookies-quick" style="background:var(--bg-card, #222); color:var(--text-gray, #aaa); border:1px solid var(--border-subtle, #333); padding:6px 10px; border-radius:16px; font-size:11px; cursor:pointer;">Sync A/C</button>
        </div>
      </div>
      <!-- Authentic YouTube Subscribed Channels Story Bar -->
      <div class="subs-channels-row" style="display:flex; gap:14px; overflow-x:auto; padding:12px 14px; border-bottom:1px solid var(--border-subtle, #222); scrollbar-width:none; -webkit-overflow-scrolling:touch;">
        ${mergedSubs.map((s, idx) => {
          const aUrl = resolveAvatarUrl(s.avatar, s.name, s.id);
          return `
            <div class="sub-channel-pill" data-idx="${idx}" style="display:flex; flex-direction:column; align-items:center; width:64px; flex-shrink:0; cursor:pointer;">
              <div style="position:relative; width:48px; height:48px; border-radius:50%; padding:2px; background:linear-gradient(45deg, #FF0000, #990000); margin-bottom:4px; box-shadow:0 2px 6px rgba(0,0,0,0.5);">
                <img class="sub-pill-avatar" data-idx="${idx}" src="${aUrl}" onerror="this.onerror=null;this.src='${getSvgAvatarDataUrl(s.name)}';" alt="${s.name}" referrerpolicy="no-referrer" style="width:100%; height:100%; border-radius:50%; object-fit:cover; background:#181818; display:block;" />
              </div>
              <span style="font-size:11px; font-weight:600; color:var(--text-white, #FFF); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:62px; text-align:center;">${s.name}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;

    const wireSubsHeaderEvents = () => {
      document.getElementById('btn-add-more-subs')?.addEventListener('click', showAddChannelPrompt);
      document.getElementById('btn-sync-cookies-quick')?.addEventListener('click', openAuthModal);
      container.querySelectorAll('.sub-channel-pill').forEach((pill) => {
        const idx = Number(pill.dataset.idx);
        const s = mergedSubs[idx];
        if (!s) return;
        const img = pill.querySelector('.sub-pill-avatar');
        if (img) attachAvatarHandlers(img, s.name, s.id);
        pill.addEventListener('click', () => {
          openChannelExplorer({ channel: s.name, channel_id: s.id, channel_avatar: s.avatar });
        });
      });
    };

    if (mergedSubs.length === 0) {
      const suggestedCreators = [
        { name: 'MrBeast', id: 'UCX6OQ3DkcsbYNE6H8uQQuVA' },
        { name: 'MKBHD', id: 'UCBJycsmduvYEL83R_U4JriQ' },
        { name: 'Veritasium', id: 'UCHnyfMqiRRG1u-2MsSQLbXA' },
        { name: 'Fireship', id: 'UCvjgXvBlbQiydffZU7m1_aw' },
        { name: 'Kurzgesagt', id: 'UCsXVk37bltHxD1rDPwtNM8Q' },
        { name: 'Lofi Girl', id: 'UCSJ4gkVC6NrvII8umztf0Ow' }
      ];

      container.innerHTML = `
        <div style="padding:24px 16px; max-width:480px; margin:0 auto;">
          <div style="text-align:center; margin-bottom:20px;">
            <div style="margin-bottom:8px; color:var(--text-gray);">${ICONS.subscriptions}</div>
            <div style="font-size:18px; font-weight:800; color:var(--text-white, #FFF);">Subscriptions Feed</div>
            <div style="font-size:12px; color:var(--text-gray); margin-top:4px; line-height:18px;">
              Sign in with your Google account to sync all your YouTube subscriptions, or follow creators below.
            </div>
          </div>

          <div style="text-align:center; margin-bottom:20px;">
            <button id="btn-subs-empty-login" style="background:var(--metube-red, #FF0000); color:#FFF; border:none; padding:10px 24px; border-radius:20px; font-weight:700; font-size:13px; cursor:pointer;">
              Sign In to YouTube
            </button>
          </div>

          <!-- Quick Add Channel Input -->
          <form id="form-sub-add" style="display:flex; gap:8px; margin-bottom:24px;">
            <input 
              id="input-sub-handle" 
              type="text" 
              placeholder="Type creator name (e.g. @MrBeast, @mkbhd)..." 
              style="flex:1; background:var(--bg-card, #1C1C1C); border:1px solid var(--border-subtle, #333); color:var(--text-white, #FFF); padding:10px 14px; border-radius:10px; font-size:13px; outline:none;" 
            />
            <button type="submit" style="background:var(--metube-red, #FF0000); color:#FFF; border:none; padding:10px 16px; border-radius:10px; font-weight:700; font-size:13px; cursor:pointer; white-space:nowrap;">
              + Follow
            </button>
          </form>

          <!-- Suggested Creators List -->
          <div style="font-size:13px; font-weight:700; color:var(--text-white, #FFF); margin-bottom:12px;">Suggested Creators:</div>
          <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:24px;">
            ${suggestedCreators.map(c => {
              const aUrl = resolveAvatarUrl(null, c.name, c.id);
              return `
                <div style="display:flex; align-items:center; justify-content:space-between; background:var(--bg-card, #181818); padding:10px 12px; border-radius:10px; border:1px solid var(--border-subtle, #282828);">
                  <div style="display:flex; align-items:center; gap:12px;">
                    <img class="suggested-avatar-img" data-name="${c.name}" data-id="${c.id}" src="${aUrl}" alt="${c.name}" referrerpolicy="no-referrer" style="width:40px; height:40px; border-radius:50%; object-fit:cover; background:#222;" />
                    <div>
                      <div style="font-size:13px; font-weight:700; color:var(--text-white, #FFF);">${c.name}</div>
                      <div style="font-size:11px; color:var(--text-gray);">YouTube Creator</div>
                    </div>
                  </div>
                  <button class="btn-follow-suggested" data-name="${c.name}" data-id="${c.id}" style="background:#FFFFFF; color:#0F0F0F; border:none; padding:6px 14px; border-radius:16px; font-weight:700; font-size:12px; cursor:pointer;">
                    Follow
                  </button>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;

      container.querySelectorAll('.suggested-avatar-img').forEach((img) => {
        attachAvatarHandlers(img, img.dataset.name, img.dataset.id);
      });

      document.getElementById('btn-subs-empty-login')?.addEventListener('click', openAuthModal);

      document.getElementById('form-sub-add')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('input-sub-handle');
        const val = (input?.value || '').trim();
        if (!val) return;
        toggleChannelSubscription({ name: val });
        showToast(`Followed ${val}`);
        loadSubscriptionsView();
      });

      container.querySelectorAll('.btn-follow-suggested').forEach((btn) => {
        btn.addEventListener('click', () => {
          const name = btn.dataset.name;
          const id = btn.dataset.id;
          const avatar = btn.dataset.avatar;
          toggleChannelSubscription({ id, name, avatar });
          showToast(`Followed ${name}`);
          loadSubscriptionsView();
        });
      });
      return;
    }

    if (feedVideos.length === 0) {
      container.innerHTML = `
        ${renderSubsHeaderHtml()}
        <div style="text-align:center; padding:40px 20px; color:var(--text-gray);">
          <div style="margin-bottom:10px; color:var(--text-gray);">${ICONS.subscriptions}</div>
          <div style="font-size:15px; font-weight:700; color:var(--text-white, #FFF);">No recent uploads right now</div>
          <div style="font-size:12px; margin-top:4px;">Check back later or follow more creators.</div>
        </div>
      `;
      wireSubsHeaderEvents();
      return;
    }

    container.innerHTML = renderSubsHeaderHtml();
    wireSubsHeaderEvents();

    feedVideos.forEach((video) => {
      container.appendChild(createVideoCardElement(video));
    });
  } catch (err) {
    container.innerHTML = `
      <div style="text-align:center; padding:30px; color:var(--text-gray); font-size:12px;">
        Could not load subscriptions feed. <button id="btn-retry-subs" style="margin-left:6px; background:#333; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Retry</button>
      </div>
    `;
    document.getElementById('btn-retry-subs')?.addEventListener('click', loadSubscriptionsView);
  }
}

// =========================================================
// NATIVE ANDROID HARDWARE & GESTURE BACK BUTTON INTERCEPTOR
// =========================================================
window.handleAndroidBack = function() {
  const settingsSheet = document.getElementById('player-settings-sheet');
  if (settingsSheet && settingsSheet.style.display && settingsSheet.style.display !== 'none') {
    settingsSheet.style.display = 'none';
    syncNativeOverlayFlag();
    return true;
  }
  if (state.fullscreenLandscape) {
    setFullscreenLandscape(false);
    return true;
  }
  const authModal = document.getElementById('auth-modal');
  if (authModal && authModal.style.display !== 'none' && authModal.style.display !== '') {
    authModal.style.display = 'none';
    syncNativeOverlayFlag();
    return true;
  }
  const diagModal = document.getElementById('diagnostics-modal');
  if (diagModal && diagModal.classList.contains('open')) {
    diagModal.classList.remove('open');
    syncNativeOverlayFlag();
    return true;
  }
  const dlModal = document.getElementById('download-modal');
  if (dlModal && dlModal.classList.contains('open')) {
    dlModal.classList.remove('open');
    syncNativeOverlayFlag();
    return true;
  }
  const actionsSheet = document.getElementById('actions-modal');
  if (actionsSheet && actionsSheet.classList.contains('open')) {
    actionsSheet.classList.remove('open');
    syncNativeOverlayFlag();
    return true;
  }
  const btnBackPl = document.getElementById('btn-back-to-playlists');
  if (btnBackPl) {
    btnBackPl.click();
    return true;
  }
  const channelModal = document.getElementById('channel-modal');
  if (channelModal && channelModal.classList.contains('open')) {
    channelModal.classList.remove('open');
    syncNativeOverlayFlag();
    return true;
  }
  const shortsModal = document.getElementById('shorts-modal');
  if (shortsModal && (shortsModal.classList.contains('open') || shortsModal.style.display === 'block')) {
    closeShortsReel();
    switchTab('home');
    return true;
  }
  const playerModal = document.getElementById('player-modal');
  if (playerModal && playerModal.classList.contains('open')) {
    // Minimize to mini-player so video audio keeps playing seamlessly in background!
    minimizeToMiniPlayer();
    return true;
  }
  const miniBar = document.getElementById('mini-player-bar');
  if (miniBar && miniBar.style.display && miniBar.style.display !== 'none') {
    hideMiniPlayer();
    return true;
  }
  const sidebar = document.getElementById('sidebar-overlay');
  if (sidebar && sidebar.classList.contains('open')) {
    sidebar.classList.remove('open');
    syncNativeOverlayFlag();
    return true;
  }
  if (state.searchQuery || document.getElementById('metube-header')?.classList.contains('search-mode-open')) {
    const closeBtn = document.getElementById('btn-close-search');
    if (closeBtn) closeBtn.click();
    else {
      state.searchQuery = '';
      state.searchChannel = null;
      document.getElementById('metube-header')?.classList.remove('search-mode-open');
      loadFeed('all');
    }
    syncNativeOverlayFlag();
    return true;
  }
  if (state.activeTab !== 'home') {
    switchTab('home');
    return true;
  }
  syncNativeOverlayFlag();
  return false;
};

window.addEventListener('popstate', () => {
  window.handleAndroidBack();
});

// =========================================================
// IN-APP ZERO-APK OTA AUTO-UPDATER
// =========================================================
const APP_OTA_CODE = 1;
const APP_OTA_VERSION = '2.0.1';
let pendingOtaInfo = null;
let otaPollTimer = null;

const GITHUB_MANIFEST_URL = 'https://github.com/HR1244/Me-tube/releases/download/latest/ota-manifest.json';

function getLocalUpdateMeta() {
  try {
    if (window.AndroidUpdater?.getUpdateState) {
      const parsed = JSON.parse(window.AndroidUpdater.getUpdateState() || '{}');
      const nativeCode = Number(parsed.nativeVersionCode || 1);
      const nativeVer = parsed.nativeVersionName || APP_OTA_VERSION;
      const otaCode = parsed.usingOta
        ? Math.max(APP_OTA_CODE, nativeCode, Number(parsed.otaCode || 0))
        : Math.max(APP_OTA_CODE, nativeCode);
      const otaVersion = (parsed.usingOta && parsed.otaVersion) ? parsed.otaVersion : nativeVer;
      return {
        otaCode,
        otaVersion,
        usingOta: Boolean(parsed.usingOta),
        nativeVersionCode: nativeCode
      };
    }
  } catch (_) {}
  return { otaCode: APP_OTA_CODE, otaVersion: APP_OTA_VERSION, usingOta: false, nativeVersionCode: 1 };
}

function updateSettingsVersionLabel(statusMsg = '') {
  const verEl = document.getElementById('settings-app-version');
  const statusEl = document.getElementById('settings-update-status');
  const meta = getLocalUpdateMeta();
  if (verEl) {
    verEl.textContent = `Version ${meta.otaVersion} (Build ${meta.otaCode}${meta.usingOta ? ' • OTA' : ''})`;
  }
  if (statusEl && statusMsg) {
    statusEl.textContent = statusMsg;
  }
}

async function fetchLatestManifestWithFallback() {
  let srvInfo = null;
  try {
    srvInfo = await api.getAppVersion();
  } catch (_) {}

  let ghInfo = null;
  try {
    const ghRes = await fetch(`${GITHUB_MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (ghRes.ok) {
      ghInfo = await ghRes.json();
    }
  } catch (_) {}

  const srvCode = Math.max(Number(srvInfo?.native_version_code || 0), Number(srvInfo?.ota_code || 0));
  const ghCode = Math.max(Number(ghInfo?.native_version_code || 0), Number(ghInfo?.ota_code || 0));

  if (ghCode > srvCode) {
    return ghInfo;
  }
  return srvInfo || ghInfo;
}

async function checkForAppUpdate(manual = false) {
  try {
    updateSettingsVersionLabel();
    const info = await fetchLatestManifestWithFallback();
    const meta = getLocalUpdateMeta();
    const updateBtn = document.getElementById('btn-header-update');
    const checkBtn = document.getElementById('btn-check-updates');

    const canUseOta = Boolean(
      info &&
      Number(info.ota_code || 0) > meta.otaCode &&
      info.has_bundle &&
      info.bundle_url &&
      window.AndroidUpdater?.installOtaUpdate
    );
    const hasNewOta = Boolean(
      info &&
      Number(info.ota_code || 0) > meta.otaCode &&
      info.has_bundle &&
      info.bundle_url
    );
    // Strict priority: NEVER prefer APK when an OTA bundle is available!
    const hasNewApk = Boolean(
      !canUseOta &&
      info &&
      Number(info.native_version_code || 0) > meta.nativeVersionCode &&
      info.has_apk &&
      info.apk_url &&
      window.AndroidUpdater?.installApkUpdate
    );

    if (hasNewOta || hasNewApk) {
      pendingOtaInfo = { ...info, _preferApk: !canUseOta && hasNewApk };
      if (updateBtn) {
        updateBtn.style.display = 'inline-flex';
        updateBtn.title = `Update v${info.ota_version} Ready — Tap to Install`;
      }
      if (checkBtn) {
        checkBtn.textContent = hasNewApk ? `Install APK v${info.ota_version}` : `Install v${info.ota_version}`;
      }
      updateSettingsVersionLabel(
        hasNewApk
          ? `New native build v${info.ota_version} ready: ${info.notes || 'Tap to update'}`
          : `New update v${info.ota_version} ready: ${info.notes || '1-click instant OTA update'}`
      );
      if (manual) {
        startAutoOtaUpdate(pendingOtaInfo);
      }
    } else {
      pendingOtaInfo = null;
      if (updateBtn) updateBtn.style.display = 'none';
      if (checkBtn) checkBtn.textContent = 'Check Update';
      updateSettingsVersionLabel('App is up to date (OTA auto-updates active).');
      if (manual) {
        showToast(`You are on the latest version (v${meta.otaVersion})`);
      }
    }
  } catch (err) {
    if (manual) {
      updateSettingsVersionLabel(`Update check failed: ${err.message}`);
      showToast('Could not check updates right now');
    }
  }
}

function startAutoOtaUpdate(info) {
  if (!info || (!info.bundle_url && !info.apk_url)) return;
  const serverBase = getServerUrl();

  const useOta = Boolean(info.has_bundle && info.bundle_url && window.AndroidUpdater?.installOtaUpdate && !info._preferApk);

  if (!useOta && info._preferApk && info.apk_url && window.AndroidUpdater?.installApkUpdate) {
    const updateBtn = document.getElementById('btn-header-update');
    const banner = document.getElementById('ota-progress-banner');
    const label = document.getElementById('ota-progress-label');
    const pctEl = document.getElementById('ota-progress-pct');
    const fill = document.getElementById('ota-progress-fill');

    updateBtn?.classList.add('installing');
    if (banner) banner.style.display = 'block';
    if (label) label.textContent = `Downloading v${info.ota_version || info.native_version_code}...`;
    if (pctEl) pctEl.textContent = '2%';
    if (fill) fill.style.width = '2%';

    window.AndroidUpdater.installApkUpdate(String(info.apk_url), String(info.ota_version || ''));
    if (otaPollTimer) clearInterval(otaPollTimer);
    otaPollTimer = setInterval(() => {
      try {
        const p = JSON.parse(window.AndroidUpdater.getOtaProgress() || '{}');
        const pct = Math.max(0, Math.min(100, Number(p.percent || 0)));
        if (label && p.message) label.textContent = p.message;
        if (pctEl) pctEl.textContent = `${pct}%`;
        if (fill) fill.style.width = `${pct}%`;

        if (p.status === 'apk_ready') {
          clearInterval(otaPollTimer);
          otaPollTimer = null;
          updateBtn?.classList.remove('installing');
          if (banner) banner.style.display = 'none';
        } else if (p.status === 'permission') {
          clearInterval(otaPollTimer);
          otaPollTimer = null;
          updateBtn?.classList.remove('installing');
          if (label) label.textContent = p.message || 'Allow Unknown Apps permission';
        } else if (p.status === 'error') {
          clearInterval(otaPollTimer);
          otaPollTimer = null;
          updateBtn?.classList.remove('installing');
          if (banner) banner.style.display = 'none';
          showToast(`APK update failed: ${p.message || 'Retry later'}`);
        }
      } catch (_) {}
    }, 250);
    return;
  }

  const absUrl = info.bundle_url.startsWith('http') ? info.bundle_url : `${serverBase}${info.bundle_url}`;

  if (!window.AndroidUpdater?.installOtaUpdate) {
    showToast('Reloading web app for latest update...');
    setTimeout(() => window.location.reload(), 600);
    return;
  }

  const updateBtn = document.getElementById('btn-header-update');
  const banner = document.getElementById('ota-progress-banner');
  const label = document.getElementById('ota-progress-label');
  const pctEl = document.getElementById('ota-progress-pct');
  const fill = document.getElementById('ota-progress-fill');

  updateBtn?.classList.add('installing');
  if (banner) banner.style.display = 'block';
  if (label) label.textContent = `Updating to v${info.ota_version || info.ota_code}...`;
  if (pctEl) pctEl.textContent = '5%';
  if (fill) fill.style.width = '5%';

  window.AndroidUpdater.installOtaUpdate(
    absUrl,
    Number(info.ota_code || 1),
    String(info.ota_version || ''),
    String(info.sha256 || '')
  );

  if (otaPollTimer) clearInterval(otaPollTimer);
  otaPollTimer = setInterval(() => {
    try {
      const p = JSON.parse(window.AndroidUpdater.getOtaProgress() || '{}');
      const pct = Math.max(0, Math.min(100, Number(p.percent || 0)));
      if (label && p.message) label.textContent = p.message;
      if (pctEl) pctEl.textContent = `${pct}%`;
      if (fill) fill.style.width = `${pct}%`;

      if (p.status === 'ready') {
        clearInterval(otaPollTimer);
        otaPollTimer = null;
        if (label) label.textContent = 'Applying update...';
      } else if (p.status === 'error') {
        clearInterval(otaPollTimer);
        otaPollTimer = null;
        updateBtn?.classList.remove('installing');
        if (banner) banner.style.display = 'none';
        showToast(`Update failed: ${p.message || 'Retry later'}`);
      }
    } catch (_) {}
  }, 250);
}

// =========================================================
// YOUTUBE AUTHENTIC PULL-TO-REFRESH
// =========================================================
function initPullToRefresh() {
  const viewport = document.getElementById('content-viewport');
  const spinner = document.getElementById('yt-pull-spinner');
  if (!viewport || !spinner) return;

  let startY = 0;
  let currentY = 0;
  let isPulling = false;
  let isRefreshing = false;
  const PULL_THRESHOLD = 70;

  viewport.addEventListener('touchstart', (e) => {
    if (isRefreshing) return;
    if (viewport.scrollTop <= 2) {
      startY = e.touches[0].clientY;
      currentY = startY;
      isPulling = true;
    } else {
      isPulling = false;
    }
  }, { passive: true });

  viewport.addEventListener('touchmove', (e) => {
    if (!isPulling || isRefreshing) return;
    currentY = e.touches[0].clientY;
    const diff = currentY - startY;

    if (diff > 8 && viewport.scrollTop <= 2) {
      const pull = Math.min(100, (diff - 8) * 0.42);
      const progress = Math.min(1, pull / PULL_THRESHOLD);
      const rotation = pull * 3.6;

      spinner.style.display = 'flex';
      spinner.style.transition = 'none';
      spinner.style.transform = `translateX(-50%) translateY(${pull}px) scale(${0.5 + progress * 0.5})`;
      spinner.style.opacity = String(progress);

      const icon = spinner.querySelector('.yt-pull-arrow-icon');
      if (icon) {
        icon.style.transform = `rotate(${rotation}deg)`;
      }
    } else {
      spinner.style.opacity = '0';
      spinner.style.transform = 'translateX(-50%) translateY(0px) scale(0.5)';
    }
  }, { passive: true });

  const finishRefresh = async () => {
    isRefreshing = true;
    spinner.classList.add('refreshing');
    spinner.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)';
    spinner.style.transform = `translateX(-50%) translateY(${PULL_THRESHOLD}px) scale(1)`;
    spinner.style.opacity = '1';

    try {
      if (state.activeTab === 'home') {
        await loadFeed(state.activeCategory || 'all');
      } else if (state.activeTab === 'subscriptions') {
        await loadPersonalizedSubscriptionsFeed();
      } else if (state.activeTab === 'history') {
        loadHistoryView();
      }
    } catch (_) {}

    setTimeout(() => {
      spinner.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.25s ease';
      spinner.style.transform = 'translateX(-50%) translateY(0px) scale(0.3)';
      spinner.style.opacity = '0';
      setTimeout(() => {
        spinner.classList.remove('refreshing');
        spinner.style.display = 'none';
        isRefreshing = false;
      }, 260);
    }, 450);
  };

  viewport.addEventListener('touchend', () => {
    if (!isPulling || isRefreshing) return;
    isPulling = false;
    const diff = currentY - startY;
    const pull = (diff - 8) * 0.42;

    if (diff > 8 && pull >= PULL_THRESHOLD && viewport.scrollTop <= 2) {
      finishRefresh();
    } else {
      spinner.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.2s ease';
      spinner.style.transform = 'translateX(-50%) translateY(0px) scale(0.5)';
      spinner.style.opacity = '0';
      setTimeout(() => {
        if (!isRefreshing) spinner.style.display = 'none';
      }, 230);
    }
  }, { passive: true });
}

// =========================================================
// INITIALIZATION ON PAGE LOAD
// =========================================================
window.addEventListener('DOMContentLoaded', () => {
  initThemeManager();
  initSimulator();
  initNavigation();
  initPullToRefresh();
  initPlayerControls();
  initDownloadModal();
  initChannelModal();
  initActionsSheet();
  initShortsPlayer();
  initAuthModal();
  initSettingsView();
  initDiagnostics();
  syncNativeOverlayFlag();
  // Render subscribed creators story row
  renderSubscriptionsBar();

  // Clear history button
  document.getElementById('btn-clear-history')?.addEventListener('click', () => {
    localStorage.removeItem(WATCH_HISTORY_KEY);
    loadHistoryView();
    if (state.activeTab === 'home' && state.activeCategory === 'all') {
      loadFeed('all');
    }
  });

  // Keep server connection warm and active
  startServerKeepAlive();

  // Load initial feed
  loadFeed('all');

  // Cold Start Splash Screen Safety Fallback: Ensure splash fades out within 1.2s max
  setTimeout(dismissSplashScreen, 1200);

  // Check for initial URL query parameter or deep link (e.g. ?v=... or ?url=...)
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const targetVideo = urlParams.get('v') || urlParams.get('url') || urlParams.get('id');
    if (targetVideo) {
      const vid = extractYouTubeVideoId(targetVideo);
      if (vid) {
        setTimeout(() => openVideoById(vid), 400);
      } else if (/^https?:\/\/\S+/i.test(targetVideo.trim())) {
        setTimeout(() => openUniversalUrl(targetVideo.trim()), 400);
      }
    }
  } catch (_) {}

  document.getElementById('btn-header-update')?.addEventListener('click', () => {
    if (pendingOtaInfo) {
      startAutoOtaUpdate(pendingOtaInfo);
    } else {
      checkForAppUpdate(true);
    }
  });

  document.getElementById('btn-check-updates')?.addEventListener('click', () => {
    if (pendingOtaInfo) {
      startAutoOtaUpdate(pendingOtaInfo);
    } else {
      checkForAppUpdate(true);
    }
  });

  updateSettingsVersionLabel();
  try { window.AndroidUpdater?.notifyPageReady?.(); } catch (_) {}
  setTimeout(() => checkForAppUpdate(false), 3000);

  // Periodically check server health, OTA updates (every 10 min), and active downloads
  checkServerHealth();
  let tickCount = 0;
  setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    checkServerHealth();
    if (state.activeTab === 'downloads' && !downloadPollTimer) loadDownloadsList();
    tickCount++;
    if (tickCount % 20 === 0) checkForAppUpdate(false);
  }, 30000);
});
