// MeTube Mobile Application & Desktop Simulator Controller
import { api, getServerUrl, setServerUrl, DEFAULT_SERVER_URL, startServerKeepAlive } from './api.js';

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

// App State
const state = {
  activeTab: 'home',
  activeCategory: 'all',
  searchQuery: '',
  videos: [],
  shorts: [],
  downloads: [],
  activeVideo: null,
  activeChannel: null,
  selectedFormat: { type: 'mp3', quality: '320k', label: 'MP3 High (320 kbps)' },
  isSubscribed: false,
  isAudioMode: false,
  isLooping: false,
  targetActionVideo: null,
  feedPage: 1,
  isLoadingFeed: false,
  isLoadingMore: false,
  hasMore: true
};

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

const DEFAULT_YOUTUBE_AVATAR = 'https://yt3.googleusercontent.com/a/default-user=s176-c-k-c0x00ffffff-no-rj';

function getAvatarFallback(channelName) {
  const clean = (channelName || 'Creator').trim();
  if (OFFICIAL_CREATOR_AVATARS[clean]) {
    return OFFICIAL_CREATOR_AVATARS[clean];
  }
  return DEFAULT_YOUTUBE_AVATAR;
}

function getChannelAvatarUrl(channelName, channelId) {
  const clean = (channelName || 'Creator').trim();
  if (OFFICIAL_CREATOR_AVATARS[clean]) {
    return OFFICIAL_CREATOR_AVATARS[clean];
  }
  const server = getServerUrl();
  if (channelId && channelId.startsWith('UC')) {
    return `${server}/api/channel/avatar?id=${encodeURIComponent(channelId)}&name=${encodeURIComponent(clean)}`;
  }
  return DEFAULT_YOUTUBE_AVATAR;
}

function getChannelBannerUrl(channelName, channelId) {
  const clean = (channelName || 'Creator').trim();
  const server = getServerUrl();
  if (channelId && channelId.startsWith('UC')) {
    return `${server}/api/channel/banner?id=${encodeURIComponent(channelId)}&name=${encodeURIComponent(clean)}`;
  }
  return 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80';
}

// Subscriptions Management System (With curated starter channels)
const SUBSCRIPTIONS_KEY = 'metube_subscriptions';

const DEFAULT_CURATED_CREATORS = [
  { id: 'UCX6OQ3DkcsbYNE6H8uQQuVA', name: 'MrBeast', avatar: OFFICIAL_CREATOR_AVATARS['MrBeast'] },
  { id: 'UC-lHJZR3Gqxm24_Vd_AJ5Yw', name: 'PewDiePie', avatar: OFFICIAL_CREATOR_AVATARS['PewDiePie'] },
  { id: 'UCBJycsmduvYEL83R_U4JriQ', name: 'MKBHD', avatar: OFFICIAL_CREATOR_AVATARS['MKBHD'] },
  { id: 'UCSJ4gkVC6NrvII8umztf0Ow', name: 'Lofi Girl', avatar: OFFICIAL_CREATOR_AVATARS['Lofi Girl'] },
  { id: 'UCHnyfMqiRRG1u-2MsSQLbXA', name: 'Veritasium', avatar: OFFICIAL_CREATOR_AVATARS['Veritasium'] },
  { id: 'UCq-Fj5jknLsUf-MWSy4_brA', name: 'T-Series', avatar: OFFICIAL_CREATOR_AVATARS['T-Series'] },
  { id: 'UCsooa4yRKGN_zEE8iknghZA', name: 'TED-Ed', avatar: OFFICIAL_CREATOR_AVATARS['TED-Ed'] }
];

function getSubscriptions() {
  try {
    const raw = localStorage.getItem(SUBSCRIPTIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return DEFAULT_CURATED_CREATORS;
}

function isChannelSubscribed(channelId, channelName) {
  const subs = getSubscriptions();
  return subs.some((s) => (channelId && s.id === channelId) || (channelName && s.name.toLowerCase() === channelName.toLowerCase()));
}

function toggleChannelSubscription(creator) {
  if (!creator || (!creator.name && !creator.channel)) return false;
  const cName = creator.name || creator.channel;
  const cId = creator.id || creator.channel_id || '';
  let subs = getSubscriptions();
  const index = subs.findIndex((s) => (cId && s.id === cId) || s.name.toLowerCase() === cName.toLowerCase());
  let nowSubscribed = false;

  if (index >= 0) {
    subs.splice(index, 1);
    nowSubscribed = false;
  } else {
    subs.unshift({ id: cId, name: cName });
    nowSubscribed = true;
  }

  try {
    localStorage.setItem(SUBSCRIPTIONS_KEY, JSON.stringify(subs));
  } catch (e) {}

  renderSubscriptionsBar();
  return nowSubscribed;
}

function renderSubscriptionsBar() {
  const listElem = document.getElementById('subscriptions-scroll-list');
  if (!listElem) return;

  const subs = getSubscriptions();
  if (subs.length === 0) {
    listElem.innerHTML = '';
    return;
  }

  listElem.innerHTML = subs.map((sub, i) => {
    const avatar = getChannelAvatarUrl(sub.name, sub.id);
    const fallback = getAvatarFallback(sub.name);
    return `
      <div class="sub-story-item ${i < 3 ? 'has-unread' : ''}" data-channel-id="${sub.id || ''}" data-channel-name="${sub.name}">
        <div class="sub-story-avatar-ring">
          <img 
            class="sub-story-avatar-img" 
            src="${avatar}" 
            alt="${sub.name}" 
            loading="lazy"
            onerror="this.onerror=null; this.src='${fallback}';" 
          />
          ${i < 3 ? '<span class="sub-story-dot"></span>' : ''}
        </div>
        <span class="sub-story-name">${sub.name}</span>
      </div>
    `;
  }).join('');

  listElem.querySelectorAll('.sub-story-item').forEach((item) => {
    item.addEventListener('click', () => {
      const cId = item.dataset.channelId;
      const cName = item.dataset.channelName;
      openChannelExplorer({ channel: cName, channel_id: cId });
    });
  });
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
  const recent = history.slice(0, 6);
  for (const item of recent) {
    if (item.channel && item.channel !== 'Creator' && item.channel !== 'Unknown Channel') {
      keywords.push(item.channel);
    }
    if (item.title) {
      const words = item.title
        .replace(/[^\w\s]/gi, '')
        .split(/\s+/)
        .filter((w) => w.length > 3 && !['official', 'video', 'full', 'song', 'music', 'best', '2025', '2026', 'trending'].includes(w.toLowerCase()));
      if (words.length > 0) {
        keywords.push(words.slice(0, 2).join(' '));
      }
    }
  }
  return keywords.length > 0 ? keywords[Math.floor(Math.random() * keywords.length)] : null;
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
  function checkMobileViewport() {
    if (window.innerWidth < 768) {
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

  // Header Downloads shortcut
  document.getElementById('btn-header-downloads')?.addEventListener('click', () => {
    switchTab('downloads');
  });

  // Header Create shortcut
  document.getElementById('btn-header-create')?.addEventListener('click', () => {
    switchTab('downloads');
  });

  // Header Avatar shortcut -> Settings
  document.getElementById('btn-header-avatar')?.addEventListener('click', () => {
    switchTab('settings');
  });

  // Sidebar Open/Close
  const sidebar = document.getElementById('sidebar-overlay');
  document.getElementById('btn-open-sidebar')?.addEventListener('click', () => {
    sidebar.classList.add('open');
  });
  document.getElementById('btn-close-sidebar')?.addEventListener('click', () => {
    sidebar.classList.remove('open');
  });
  sidebar?.addEventListener('click', (e) => {
    if (e.target === sidebar) sidebar.classList.remove('open');
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
      if (cat) selectCategory(cat);
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
  });

  searchInput?.addEventListener('input', () => {
    if (clearBtn) clearBtn.style.display = searchInput.value ? 'flex' : 'none';
  });

  clearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.style.display = 'none';
    searchInput.focus();
  });

  searchForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = (searchInput.value || '').trim();
    if (!query) return;
    state.searchQuery = query;
    header?.classList.remove('search-mode-open');
    if (banner) {
      banner.style.display = 'flex';
      bannerQuery.textContent = `Search results for "${query}"`;
    }
    loadFeedSearchResults(query);
  });

  exitSearchBtn?.addEventListener('click', () => {
    state.searchQuery = '';
    searchInput.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    if (banner) banner.style.display = 'none';
    loadFeed(state.activeCategory);
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
  state.activeTab = tabId;

  // Update Bottom Nav active state
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });

  // View sections visibility
  const viewHome = document.getElementById('view-home');
  const viewDownloads = document.getElementById('view-downloads');
  const viewHistory = document.getElementById('view-history');
  const viewSettings = document.getElementById('view-settings');
  const catBar = document.getElementById('category-bar');
  const subBar = document.getElementById('subscriptions-bar');

  if (viewHome) viewHome.style.display = tabId === 'home' ? 'block' : 'none';
  if (viewDownloads) viewDownloads.style.display = tabId === 'downloads' ? 'block' : 'none';
  if (viewHistory) viewHistory.style.display = tabId === 'history' ? 'block' : 'none';
  if (viewSettings) viewSettings.style.display = tabId === 'settings' ? 'block' : 'none';
  
  const showBars = tabId === 'home' && !state.searchQuery;
  if (catBar) catBar.style.display = showBars ? 'flex' : 'none';
  if (subBar) subBar.style.display = showBars ? 'block' : 'none';

  if (tabId === 'downloads') {
    loadDownloadsList();
  } else if (tabId === 'history') {
    loadHistoryView();
  } else if (tabId === 'settings') {
    initSettingsView();
  }
}

function loadHistoryView() {
  const container = document.getElementById('history-feed-list');
  if (!container) return;
  const history = getWatchHistory();

  if (history.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:50px 20px; color:var(--text-gray);">
        <div style="font-size:36px; margin-bottom:12px;">🕒</div>
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
  document.getElementById('search-banner').style.display = 'none';
  document.getElementById('search-input').value = '';

  document.querySelectorAll('.cat-pill').forEach((p) => {
    p.classList.toggle('active', p.dataset.cat === category);
  });

  loadFeed(category);
}

// =========================================================
// 4. FEED RENDERING (CLEAN SPINNER ONLY, NO TEXT!)
// =========================================================
async function loadFeed(category = 'all') {
  if (state.isLoadingFeed) return;
  state.isLoadingFeed = true;

  const container = document.getElementById('videos-feed-list');
  if (!container) {
    state.isLoadingFeed = false;
    return;
  }
  state.feedPage = 1;
  state.hasMore = true;
  state.isLoadingMore = false;

  // Clean spinner icon only, NO text
  container.innerHTML = `
    <div class="spinner-box">
      <div class="spinner"></div>
    </div>
  `;

  try {
    // Watch-History-Driven Dynamic Personalization:
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
        return { videos: merged.length > 0 ? merged : trendVids };
      }).catch(() => api.getTrending(category, 1));
    } else {
      trendingPromise = api.getTrending(category, 1);
    }

    const [trendingRes, shortsRes] = await Promise.all([
      trendingPromise,
      category === 'all' || category === 'shorts'
        ? api.getTrending('shorts', 1).catch(() => ({ videos: [] }))
        : Promise.resolve({ videos: [] })
    ]);

    state.videos = (trendingRes && trendingRes.videos) || [];
    state.shorts = (shortsRes && shortsRes.videos) || [];

    renderFeed();
  } catch (err) {
    container.innerHTML = `
      <div class="spinner-box">
        <button id="btn-retry-feed" style="background:var(--metube-red); color:#FFF; border:none; padding:8px 16px; border-radius:8px; font-weight:700; cursor:pointer;">Retry</button>
      </div>
    `;
    document.getElementById('btn-retry-feed')?.addEventListener('click', () => loadFeed(category));
  } finally {
    state.isLoadingFeed = false;
  }
}

async function loadFeedSearchResults(query) {
  const container = document.getElementById('videos-feed-list');
  if (!container) return;
  state.feedPage = 1;
  state.hasMore = true;
  state.isLoadingMore = false;

  container.innerHTML = `
    <div class="spinner-box">
      <div class="spinner"></div>
    </div>
  `;

  try {
    const res = await api.search(query, 1);
    state.videos = res.videos || [];
    state.shorts = [];
    renderFeed();
  } catch (err) {
    container.innerHTML = `
      <div class="spinner-box">
        <div class="spinner"></div>
      </div>
    `;
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
      res = await api.search(state.searchQuery, nextPage);
    } else {
      res = await api.getTrending(state.activeCategory, nextPage);
    }

    bottomLoader.remove();
    const newVideos = (res && res.videos) || [];

    if (newVideos.length === 0) {
      state.hasMore = false;
    } else {
      state.feedPage = nextPage;
      const existingIds = new Set(state.videos.map((v) => v.id));
      const freshVideos = newVideos.filter((v) => !existingIds.has(v.id));

      if (freshVideos.length === 0) {
        state.hasMore = false;
      } else {
        state.videos.push(...freshVideos);
        freshVideos.forEach((v) => {
          container.appendChild(createVideoCardElement(v));
        });
      }
    }
  } catch (err) {
    bottomLoader.remove();
    state.hasMore = false;
  } finally {
    state.isLoadingMore = false;
  }
}

function renderFeed() {
  const container = document.getElementById('videos-feed-list');
  if (!container) return;
  container.innerHTML = '';

  if (state.videos.length === 0) {
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

  // Render Shorts Shelf
  if (state.shorts.length > 0 && !state.searchQuery) {
    container.appendChild(createShortsShelfElement(state.shorts));
  }

  // Render remaining videos
  remainingVideos.forEach((video) => {
    container.appendChild(createVideoCardElement(video));
  });
}

function createVideoCardElement(video) {
  const durationText = video.duration_string || formatDuration(video.duration);
  const viewsText = formatViews(video.view_count);
  const channelName = video.channel || 'Creator';
  const avatarUrl = video.channel_avatar
    ? (video.channel_avatar.startsWith('http') ? video.channel_avatar : `${getServerUrl()}${video.channel_avatar}`)
    : getChannelAvatarUrl(channelName, video.channel_id);
  const fallbackAvatar = getAvatarFallback(channelName);
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
          onerror="this.onerror=null; this.src='${fallbackAvatar}';" 
        />
      </div>
      <div class="video-text-col">
        <div class="video-title-row">
          <h3 class="video-title">${video.title}</h3>
          <div class="video-actions-quick">
            <button class="quick-btn btn-card-download" title="Download">
              <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
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
  card.querySelector('.video-thumb-container').addEventListener('click', () => openVideoPlayer(video));
  card.querySelector('.video-title').addEventListener('click', () => openVideoPlayer(video));

  // Click channel -> Open Channel Explorer
  card.querySelector('.channel-avatar-box').addEventListener('click', (e) => {
    e.stopPropagation();
    openChannelExplorer(video);
  });
  card.querySelector('.channel-name-link').addEventListener('click', (e) => {
    e.stopPropagation();
    openChannelExplorer(video);
  });

  // Click direct download
  card.querySelector('.btn-card-download').addEventListener('click', (e) => {
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
    </div>
    <div class="shorts-carousel">
      ${shortsList.map((short) => `
        <div class="short-card" data-short-id="${short.id}">
          <div class="short-thumb-wrapper">
            <img class="short-thumb-img" src="${short.thumbnail}" alt="${short.title}" loading="lazy" />
            <button class="short-download-quick" title="Download Short">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
          </div>
          <div class="short-info">
            <h4 class="short-title">${short.title}</h4>
            <div class="short-views">${formatViews(short.view_count)}</div>
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
      if (e.target.closest('.short-download-quick')) {
        e.stopPropagation();
        openDownloadModal(shortObj);
      } else {
        openVideoPlayer({ ...shortObj, is_short: true });
      }
    });
  });

  return shelf;
}

// =========================================================
// 5. VIDEO PLAYER (SPINNER ONLY, NO TEXT!)
// =========================================================
async function openVideoPlayer(video) {
  state.activeVideo = video;
  
  // Persist to Watch History immediately to drive dynamic personalized feed!
  saveToWatchHistory(video);

  const modal = document.getElementById('player-modal');
  const videoElem = document.getElementById('html5-video-element');
  const iframeContainer = document.getElementById('embed-iframe-container');
  const titleElem = document.getElementById('player-video-title');
  const viewsElem = document.getElementById('player-video-views');
  const channelNameElem = document.getElementById('player-channel-name');
  const channelAvatarImg = document.getElementById('player-channel-avatar-img');
  const channelSubsElem = document.getElementById('player-channel-subs');
  const descElem = document.getElementById('player-video-desc');
  const spinner = document.getElementById('player-video-spinner');
  const subBtn = document.getElementById('btn-sub-toggle');

  modal.classList.add('open');
  titleElem.textContent = video.title || 'Playing Video';
  viewsElem.textContent = formatViews(video.view_count);
  
  const cName = video.channel || 'Creator';
  channelNameElem.textContent = cName;
  channelSubsElem.textContent = 'Creator';

  // Update Subscribe button state
  const isSubbed = isChannelSubscribed(video.channel_id, cName);
  state.isSubscribed = isSubbed;
  if (subBtn) {
    subBtn.textContent = isSubbed ? 'Subscribed' : 'Subscribe';
    subBtn.style.background = isSubbed ? '#272727' : '#FFFFFF';
    subBtn.style.color = isSubbed ? '#FFFFFF' : '#0F0F0F';
  }
  
  // Real Channel Avatar Image with crisp graphic fallback
  const avatarUrl = video.channel_avatar
    ? (video.channel_avatar.startsWith('http') ? video.channel_avatar : `${getServerUrl()}${video.channel_avatar}`)
    : getChannelAvatarUrl(cName, video.channel_id);
  channelAvatarImg.src = avatarUrl;
  channelAvatarImg.onerror = () => {
    channelAvatarImg.src = getAvatarFallback(cName);
  };

  descElem.textContent = video.description || '';

  // Clean Native Video Streaming (NO YouTube iframe, NO watermark)
  if (spinner) spinner.style.display = 'flex';
  videoElem.style.display = 'block';
  if (iframeContainer) {
    iframeContainer.style.display = 'none';
    iframeContainer.innerHTML = '';
  }

  // Load Suggested Videos smoothly in background (NO duplicate spinner!)
  loadSuggestedVideos(video);

  // Clean stream initialization for Android WebView & HTML5
  try {
    videoElem.pause();
    videoElem.removeAttribute('src');
    videoElem.load();
  } catch (_) {}

  const streamSrc = `${getServerUrl()}/api/stream/${video.id}`;
  console.log(`[Player] Initializing stream: ${streamSrc}`);
  videoElem.src = streamSrc;
  videoElem.playbackRate = Number(document.getElementById('player-speed-select')?.value || 1.0);
  try {
    videoElem.load();
  } catch (_) {}

  let triedFallback = false;
  let loadTimeout = null;

  const triggerDirectFallback = async (reason = '') => {
    if (triedFallback) return;
    triedFallback = true;
    if (loadTimeout) clearTimeout(loadTimeout);
    console.warn(`[Player] Triggering stream fallback for ${video.id} (${reason})`);

    let embedFallbackUrl = `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;
    try {
      const details = await api.getVideo(video.id);
      if (details) {
        if (details.title && details.title !== 'Untitled') {
          titleElem.textContent = details.title;
        }
        if (details.channel_follower_count) {
          channelSubsElem.textContent = `${formatViews(details.channel_follower_count)} subscribers`;
        }
        if (details.description) {
          descElem.textContent = details.description;
        }
        if (details.direct_stream_url) {
          console.log(`[Player] Switching to fallback direct stream: ${details.direct_stream_url.substring(0, 60)}...`);
          videoElem.src = details.direct_stream_url;
          videoElem.load();
          const p = videoElem.play();
          if (p !== undefined) p.catch(() => {});
          return;
        }
        if (details.embed_url) {
          embedFallbackUrl = details.embed_url;
        }
      }
    } catch (err) {
      console.error('[Player] Fallback fetch failed:', err);
    }

    // Direct MP4 stream unavailable on datacenter IP; seamlessly activate clean mobile player!
    console.log(`[Player] Direct MP4 stream unavailable. Activating mobile player fallback for ${video.id}...`);
    if (spinner) spinner.style.display = 'none';
    videoElem.style.display = 'none';
    try { videoElem.pause(); } catch (_) {}
    if (iframeContainer) {
      iframeContainer.style.display = 'block';
      iframeContainer.innerHTML = `
        <iframe 
          src="${embedFallbackUrl}" 
          style="width:100%; height:100%; border:none; background:#000;" 
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
          allowfullscreen>
        </iframe>
      `;
      console.log('[Player] Mobile clean player activated successfully!');
    }
  };

  // If after 9 seconds readyState is still 0 (HAVE_NOTHING), try fallback
  loadTimeout = setTimeout(() => {
    if (videoElem.readyState === 0 && !triedFallback) {
      triggerDirectFallback('timeout_readyState_0');
    }
  }, 9000);

  const onCanPlay = () => {
    if (loadTimeout) clearTimeout(loadTimeout);
    if (spinner) spinner.style.display = 'none';
    const p = videoElem.play();
    if (p !== undefined) {
      p.catch((err) => {
        console.log('[Player] Autoplay waiting for user tap/unmuted gesture:', err.message);
      });
    }
  };

  videoElem.onloadedmetadata = () => {
    console.log(`[Player] Metadata loaded: ${videoElem.videoWidth}x${videoElem.videoHeight}, duration: ${videoElem.duration}s`);
  };
  videoElem.oncanplay = onCanPlay;
  videoElem.onloadeddata = onCanPlay;
  videoElem.onplaying = () => {
    if (loadTimeout) clearTimeout(loadTimeout);
    if (spinner) spinner.style.display = 'none';
    console.log('[Player] Video is now playing smoothly.');
  };
  videoElem.onerror = () => {
    const err = videoElem.error;
    const code = err ? err.code : 'unknown';
    console.error(`[Player] Media error code ${code}: ${err ? err.message : ''}`);
    triggerDirectFallback(`media_error_${code}`);
  };

  // Fetch full details in background for follower count and description
  try {
    const details = await api.getVideo(video.id);
    if (details.channel_follower_count) {
      channelSubsElem.textContent = `${formatViews(details.channel_follower_count)} subscribers`;
    }
    if (details.description) {
      descElem.textContent = details.description;
    }
  } catch (err) {
    // Native stream continues smoothly
  }
}

async function loadSuggestedVideos(currentVideo) {
  const container = document.getElementById('player-suggested-list');
  if (!container) return;

  // Clean container without jarring second spinner (Prevents double loading!)
  container.innerHTML = '';

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

    const res = await api.search(searchTerms || 'music', 1);
    const list = res && res.videos ? res.videos.filter((v) => v.id !== currentVideo.id) : [];

    if (list.length === 0) {
      const fallback = await api.getTrending('all', 1);
      const fallbackList = fallback && fallback.videos ? fallback.videos.filter((v) => v.id !== currentVideo.id) : [];
      renderSuggestedVideos(fallbackList.slice(0, 8));
      return;
    }

    renderSuggestedVideos(list.slice(0, 10));
  } catch (err) {
    container.innerHTML = '';
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

  document.getElementById('btn-close-player')?.addEventListener('click', () => {
    videoElem.pause();
    videoElem.src = '';
    const iframeContainer = document.getElementById('embed-iframe-container');
    if (iframeContainer) {
      iframeContainer.style.display = 'none';
      iframeContainer.innerHTML = '';
    }
    videoElem.style.display = 'block';
    modal.classList.remove('open');
    // If user was on Home 'all' feed, refresh dynamic recommendations immediately based on the newly watched video!
    if (state.activeTab === 'home' && state.activeCategory === 'all' && !state.searchQuery) {
      loadFeed('all');
    }
  });

  speedSelect?.addEventListener('change', (e) => {
    videoElem.playbackRate = Number(e.target.value);
  });

  loopBtn?.addEventListener('click', () => {
    state.isLooping = !state.isLooping;
    videoElem.loop = state.isLooping;
    loopBtn.classList.toggle('active', state.isLooping);
  });

  bgAudioBtn?.addEventListener('click', () => {
    state.isAudioMode = !state.isAudioMode;
    bgAudioBtn.classList.toggle('active', state.isAudioMode);
    videoElem.style.opacity = state.isAudioMode ? '0.05' : '1';
  });

  downloadBtn?.addEventListener('click', () => {
    if (state.activeVideo) openDownloadModal(state.activeVideo);
  });

  // Channel Card click
  document.getElementById('player-channel-card')?.addEventListener('click', () => {
    if (state.activeVideo) {
      document.getElementById('btn-close-player').click();
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
    subBtn.style.background = isNowSubbed ? '#272727' : '#FFFFFF';
    subBtn.style.color = isNowSubbed ? '#FFFFFF' : '#0F0F0F';
  });
}

// =========================================================
// 6. SNAPTUBE DOWNLOAD RESOLUTION MODAL
// =========================================================
function openDownloadModal(video) {
  state.activeVideo = video;
  const modal = document.getElementById('download-modal');
  const thumb = document.getElementById('download-modal-thumb');
  const title = document.getElementById('download-modal-title');
  const channel = document.getElementById('download-modal-channel');
  const confirmText = document.getElementById('download-confirm-text');

  thumb.src = video.thumbnail;
  title.textContent = video.title;
  channel.textContent = video.channel || 'Creator';
  confirmText.textContent = `Download ${state.selectedFormat.label}`;

  modal.classList.add('open');
}

function initDownloadModal() {
  const modal = document.getElementById('download-modal');
  const confirmBtn = document.getElementById('btn-confirm-download');
  const confirmText = document.getElementById('download-confirm-text');

  document.getElementById('btn-close-download-modal')?.addEventListener('click', () => {
    modal.classList.remove('open');
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

  // Start download click
  confirmBtn?.addEventListener('click', async () => {
    if (!state.activeVideo) return;
    confirmBtn.disabled = true;
    confirmText.textContent = 'Queueing Download...';

    try {
      await api.startDownload(
        state.activeVideo.id,
        state.selectedFormat.type,
        state.selectedFormat.quality,
        state.activeVideo.title
      );

      modal.classList.remove('open');
      confirmBtn.disabled = false;
      confirmText.textContent = `Download ${state.selectedFormat.label}`;

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
async function loadDownloadsList() {
  const container = document.getElementById('downloads-list');
  const counter = document.getElementById('nav-download-counter');
  if (!container) return;

  // 1. Instant Cache-First (0ms Render)
  let hadCache = false;
  try {
    const cached = localStorage.getItem('metube_downloads_cache');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        state.downloads = parsed;
        renderDownloadsDOM(container, counter, parsed);
        hadCache = true;
      }
    }
  } catch (e) {}

  if (!hadCache && state.downloads.length === 0) {
    container.innerHTML = `
      <div class="spinner-box">
        <div class="spinner"></div>
      </div>
    `;
  }

  // 2. Background Sync
  try {
    const res = await api.listDownloads();
    state.downloads = res.downloads || [];
    localStorage.setItem('metube_downloads_cache', JSON.stringify(state.downloads));
    renderDownloadsDOM(container, counter, state.downloads);
  } catch (err) {
    if (!hadCache) {
      container.innerHTML = `
        <div style="text-align:center; padding:30px; color:var(--text-gray); font-size:13px;">
          No downloads found.
        </div>
      `;
    }
  }
}

function renderDownloadsDOM(container, counter, downloadsList) {
  const activeCount = downloadsList.filter(
    (d) => d.status === 'downloading' || d.status === 'queued' || d.status === 'converting'
  ).length;

  if (counter) {
    counter.style.display = activeCount > 0 ? 'inline-block' : 'none';
    counter.textContent = activeCount;
  }

  if (downloadsList.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:40px 20px; color:var(--text-gray);">
        <div style="font-size:32px; margin-bottom:10px;">📥</div>
        <div style="font-size:14px; font-weight:700; color:#FFF;">No downloads yet</div>
        <div style="font-size:11px; margin-top:4px;">Tap download on any video or audio track to start!</div>
      </div>
    `;
    return;
  }

  container.innerHTML = downloadsList.map((item) => {
    const isCompleted = item.status === 'completed';
    const isProgressing = item.status === 'downloading' || item.status === 'queued' || item.status === 'converting';
    const isError = item.status === 'error';
    const fileUrl = isCompleted ? api.getFileDownloadUrl(item.filename) : '#';

    return `
      <div style="background:#181818; border:1px solid var(--border); border-radius:10px; padding:12px;" data-job-id="${item.job_id}">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="font-size:10px; font-weight:800; background:#272727; color:#FFF; padding:2px 7px; border-radius:4px;">
            ${(item.format_type || 'MP4').toUpperCase()} • ${item.quality}
          </span>
          <button class="quick-btn btn-delete-download" data-job="${item.job_id}" title="Delete">🗑️</button>
        </div>
        <div style="font-size:13px; font-weight:700; color:#FFF; line-height:17px;">${item.title}</div>
        
        ${isProgressing ? `
          <div style="margin-top:8px;">
            <div style="height:5px; background:#282828; border-radius:3px; overflow:hidden;">
              <div style="height:100%; width:${Math.max(5, item.progress_percent || 0)}%; background:#FFF; border-radius:3px;"></div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-gray); margin-top:4px;">
              <span>${item.status === 'converting' ? 'Processing file...' : `${item.speed || ''} • ${item.eta ? `ETA ${item.eta}` : 'Downloading...'}`}</span>
              <span style="font-weight:700; color:#FFF;">${Math.round(item.progress_percent || 0)}%</span>
            </div>
          </div>
        ` : ''}

        ${isError ? `
          <div style="margin-top:8px; font-size:11px; color:#FF5252; background:rgba(255,82,82,0.1); padding:6px 10px; border-radius:6px;">
            ${item.error_message || 'Download failed'}
          </div>
        ` : ''}

        ${isCompleted ? `
          <div style="display:flex; gap:8px; margin-top:10px; padding-top:8px; border-top:1px solid var(--border-subtle);">
            <a href="${fileUrl}" download="${item.filename}" data-url="${fileUrl}" data-filename="${item.filename}" class="btn-save-device" target="_blank" style="flex:1; background:#272727; color:#FFF; text-decoration:none; padding:7px; border-radius:6px; font-size:11px; font-weight:700; display:flex; align-items:center; justify-content:center; gap:5px;">
              <span>💾 Save to Device</span>
            </a>
            <button class="btn-play-offline" data-filename="${item.filename}" data-type="${item.format_type}" style="background:#FFF; color:#000; border:none; padding:7px 14px; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer;">
              Play
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  // Attach Save to Device event
  container.querySelectorAll('.btn-save-device').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const url = btn.dataset.url;
      console.log(`[Download] Saving to device: ${url}`);
      if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
        e.preventDefault();
        window.open(url, '_system');
      }
    });
  });

  // Attach Delete event
  container.querySelectorAll('.btn-delete-download').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api.deleteDownload(btn.dataset.job);
      loadDownloadsList();
    });
  });

  // Attach Play Offline event
  container.querySelectorAll('.btn-play-offline').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fileUrl = api.getFileDownloadUrl(btn.dataset.filename);
      openOfflinePlayer(fileUrl, btn.dataset.filename, btn.dataset.type);
    });
  });
}

function openOfflinePlayer(fileUrl, filename, formatType) {
  const modal = document.getElementById('player-modal');
  const videoElem = document.getElementById('html5-video-element');
  const titleElem = document.getElementById('player-video-title');

  modal.classList.add('open');
  titleElem.textContent = filename;
  videoElem.style.display = 'block';
  document.getElementById('embed-iframe-container').style.display = 'none';

  videoElem.src = fileUrl;
  videoElem.play().catch(() => {});
}

// =========================================================
// 8. CHANNEL PROFILE EXPLORER
// =========================================================
async function openChannelExplorer(video) {
  state.activeChannel = video;
  const modal = document.getElementById('channel-modal');
  const topName = document.getElementById('channel-top-name');
  const titleName = document.getElementById('channel-name-title');
  const avatarBigImg = document.getElementById('channel-avatar-big-img');
  const bannerImg = document.getElementById('channel-banner-img');
  const statsLine = document.getElementById('channel-stats-line');
  const container = document.getElementById('channel-videos-container');
  const subBtn = document.getElementById('btn-channel-sub');

  const channelName = video.channel || 'Creator';
  const channelId = video.channel_id || '';
  topName.textContent = channelName;
  titleName.textContent = channelName;
  statsLine.textContent = `@${channelName.replace(/\s+/g, '')} • Official Channel`;

  // Set real channel banner image
  if (bannerImg) {
    bannerImg.src = getChannelBannerUrl(channelName, channelId);
  }
  
  // Set real channel avatar image with graphic fallback
  const avatarUrl = video.channel_avatar
    ? (video.channel_avatar.startsWith('http') ? video.channel_avatar : `${getServerUrl()}${video.channel_avatar}`)
    : getChannelAvatarUrl(channelName, channelId);
  avatarBigImg.src = avatarUrl;
  avatarBigImg.onerror = () => {
    avatarBigImg.src = getAvatarFallback(channelName);
  };

  // Set Subscribe button state
  const isSub = isChannelSubscribed(channelId, channelName);
  state.isSubscribed = isSub;
  if (subBtn) {
    subBtn.textContent = isSub ? 'Subscribed' : 'Subscribe';
    subBtn.style.background = isSub ? '#272727' : '#FFFFFF';
    subBtn.style.color = isSub ? '#FFFFFF' : '#0F0F0F';
  }

  container.innerHTML = `
    <div class="spinner-box">
      <div class="spinner"></div>
    </div>
  `;

  modal.classList.add('open');

  try {
    const res = await api.getChannel(video.channel_id || video.channel, 'videos', 20);
    const channelVideos = res.items || [];
    container.innerHTML = '';
    channelVideos.forEach((v) => {
      container.appendChild(createVideoCardElement(v));
    });
  } catch (err) {
    container.innerHTML = `
      <div class="spinner-box">
        <div class="spinner"></div>
      </div>
    `;
  }
}

function initChannelModal() {
  document.getElementById('btn-close-channel')?.addEventListener('click', () => {
    document.getElementById('channel-modal').classList.remove('open');
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
}

function initActionsSheet() {
  const modal = document.getElementById('actions-modal');
  document.getElementById('btn-close-action-sheet')?.addEventListener('click', () => {
    modal.classList.remove('open');
  });

  document.getElementById('btn-action-download')?.addEventListener('click', () => {
    modal.classList.remove('open');
    if (state.targetActionVideo) openDownloadModal(state.targetActionVideo);
  });

  document.getElementById('btn-action-watch')?.addEventListener('click', () => {
    modal.classList.remove('open');
    if (state.targetActionVideo) openVideoPlayer(state.targetActionVideo);
  });

  document.getElementById('btn-action-channel')?.addEventListener('click', () => {
    modal.classList.remove('open');
    if (state.targetActionVideo) openChannelExplorer(state.targetActionVideo);
  });
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

  saveBtn?.addEventListener('click', () => {
    const saved = setServerUrl(input.value);
    output.textContent = `Server URL saved: ${saved}`;
    checkServerHealth();
  });

  testBtn?.addEventListener('click', async () => {
    output.textContent = 'Testing connection...';
    try {
      const data = await api.checkHealth();
      output.textContent = `✅ Connected! Status: ${data.status}`;
      checkServerHealth();
    } catch (e) {
      output.textContent = `❌ Error connecting: ${e.message}`;
    }
  });
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
    updateDiagnosticsUI();
  };

  openBtn?.addEventListener('click', showDiagModal);
  debugBtn?.addEventListener('click', showDiagModal);
  closeBtn?.addEventListener('click', () => modal?.classList.remove('open'));

  pingBtn?.addEventListener('click', async () => {
    const sPing = document.getElementById('diag-server-ping');
    if (sPing) sPing.textContent = 'Ping: Testing round-trip latency...';
    const t0 = performance.now();
    try {
      const res = await api.checkHealth();
      const ms = Math.round(performance.now() - t0);
      if (sPing) sPing.textContent = `Ping: ✅ ${ms}ms (Status: ${res.status}, yt-dlp: ${res.yt_dlp_version || 'active'})`;
    } catch (e) {
      if (sPing) sPing.textContent = `Ping: ❌ Error: ${e.message}`;
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
      copyBtn.textContent = '✅ Copied!';
      setTimeout(() => { copyBtn.textContent = '📋 Copy Logs'; }, 2000);
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
// INITIALIZATION ON PAGE LOAD
// =========================================================
window.addEventListener('DOMContentLoaded', () => {
  initSimulator();
  initNavigation();
  initPlayerControls();
  initDownloadModal();
  initChannelModal();
  initActionsSheet();
  initDiagnostics();
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

  // Periodically check server health and poll active downloads
  setInterval(() => {
    checkServerHealth();
    if (state.activeTab === 'downloads') loadDownloadsList();
  }, 4000);
});
