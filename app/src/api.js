// MeTube High-Performance API Client
const STORAGE_KEY = 'metube_server_url';
export const DEFAULT_SERVER_URL = 'http://130.210.49.14';

export function getDeviceId() {
  let id = localStorage.getItem('metube_device_id');
  if (!id) {
    const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
    id = `dev_${rand}`;
    localStorage.setItem('metube_device_id', id);
  }
  return id;
}

export function getServerUrl() {
  const saved = localStorage.getItem(STORAGE_KEY);
  
  // If running inside native Capacitor on mobile phone, use Cloud Server
  if (typeof window !== 'undefined' && (window.Capacitor?.isNativePlatform?.() || window.Capacitor !== undefined)) {
    if (saved && saved.trim() && !saved.includes('localhost') && !saved.includes('onrender.com')) {
      return saved.trim().replace(/\/+$/, '');
    }
    return DEFAULT_SERVER_URL;
  }

  // If running locally in developer browser on PC, use local FastAPI on port 8000
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    if (!saved || saved.includes('onrender.com')) {
      return 'http://localhost:8000';
    }
  }

  if (saved && saved.trim() && !saved.includes('onrender.com')) {
    return saved.trim().replace(/\/+$/, '');
  }
  return DEFAULT_SERVER_URL;
}

export function setServerUrl(url) {
  const cleaned = (url || '').trim().replace(/\/+$/, '');
  if (!cleaned) {
    localStorage.removeItem(STORAGE_KEY);
    return DEFAULT_SERVER_URL;
  }
  localStorage.setItem(STORAGE_KEY, cleaned);
  return cleaned;
}

export async function request(endpoint, options = {}, retries = 2) {
  const base = getServerUrl();
  const url = `${base}${endpoint}`;
  const config = {
    ...options,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Device-Id': getDeviceId(),
      ...(options.headers || {})
    }
  };

  try {
    const res = await fetch(url, config);
    if (!res.ok) {
      if ((res.status === 502 || res.status === 503 || res.status === 504) && retries > 0) {
        await new Promise((r) => setTimeout(r, 400));
        return request(endpoint, options, retries - 1);
      }
      let errMessage = `Server error ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson && errJson.detail) errMessage = errJson.detail;
      } catch (_) {
        try {
          const text = await res.text();
          if (text) errMessage = text;
        } catch (_) {}
      }
      throw new Error(errMessage);
    }
    return res.json();
  } catch (err) {
    if (retries > 0 && (err.name === 'TypeError' || err.message.includes('fetch'))) {
      await new Promise((r) => setTimeout(r, 400));
      return request(endpoint, options, retries - 1);
    }
    throw err;
  }
}

// Background Keep-Alive to maintain hot server connection without sleeping
let keepAliveTimer = null;
export function startServerKeepAlive() {
  if (typeof window === 'undefined') return;
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  
  // Instant wake-up ping
  request('/api/health').catch(() => {});

  // Frequent 3-minute heartbeat ping to keep Render warm and responsive
  keepAliveTimer = setInterval(() => {
    request('/api/health').catch(() => {});
  }, 3 * 60 * 1000);
}

// High-Speed In-Memory Cache with TTL
const _apiCache = new Map();
function getCacheItem(key, maxAgeMs = 300000) {
  const item = _apiCache.get(key);
  if (!item) return null;
  if (Date.now() - item.ts > maxAgeMs) {
    _apiCache.delete(key);
    return null;
  }
  return item.data;
}
function setCacheItem(key, data) {
  if (_apiCache.size > 200) {
    const firstKey = _apiCache.keys().next().value;
    _apiCache.delete(firstKey);
  }
  _apiCache.set(key, { data, ts: Date.now() });
}

export const api = {
  checkHealth() {
    return request('/api/health');
  },
  async getTrending(category = 'all', page = 1, nextToken = '') {
    const key = `trend_${category}_${page}_${nextToken}`;
    if (page === 1 && !nextToken) {
      const cached = getCacheItem(key, 180000);
      if (cached) return cached;
    }
    const p = new URLSearchParams({ category, page: String(page), device_id: getDeviceId() });
    if (nextToken) p.set('next_token', nextToken);
    const res = await request(`/api/trending?${p.toString()}`);
    if (page === 1 && !nextToken && res && res.videos?.length) {
      setCacheItem(key, res);
    }
    return res;
  },
  async search(q, page = 1, nextToken = '') {
    const key = `search_${(q || '').toLowerCase().trim()}_${page}_${nextToken}`;
    if (page === 1 && !nextToken) {
      const cached = getCacheItem(key, 240000);
      if (cached) return cached;
    }
    const p = new URLSearchParams({ q, page: String(page) });
    if (nextToken) p.set('next_token', nextToken);
    const res = await request(`/api/search?${p.toString()}`);
    if (page === 1 && !nextToken && res && (res.videos?.length || res.channel)) {
      setCacheItem(key, res);
    }
    return res;
  },
  async getVideo(id) {
    const key = `vid_${id}`;
    const cached = getCacheItem(key, 900000);
    if (cached) return cached;
    const res = await request(`/api/video/${encodeURIComponent(id)}?device_id=${encodeURIComponent(getDeviceId())}`);
    if (res && res.id) setCacheItem(key, res);
    return res;
  },
  async getChannel(channelId, tab = 'videos', limit = 30) {
    const key = `ch_${(channelId || '').toLowerCase()}_${tab}_${limit}`;
    const cached = getCacheItem(key, 600000);
    if (cached) return cached;
    const res = await request(`/api/channel?id=${encodeURIComponent(channelId)}&tab=${encodeURIComponent(tab)}&limit=${limit}`);
    if (res && res.title) setCacheItem(key, res);
    return res;
  },
  resolveUrl(url) {
    return request(`/api/resolve-url?url=${encodeURIComponent(url)}&device_id=${encodeURIComponent(getDeviceId())}`);
  },
  getChannelAvatarRefreshUrl(channelId, channelName, raw = false) {
    const p = new URLSearchParams();
    if (channelId) p.set('id', channelId);
    if (channelName) p.set('name', channelName);
    p.set('refresh', '1');
    if (raw) p.set('raw', '1');
    return `${getServerUrl()}/api/channel/avatar?${p.toString()}`;
  },
  getPlaylist(playlistId, limit = 30) {
    return request(`/api/playlist/${encodeURIComponent(playlistId)}?limit=${limit}`);
  },
  getFormats(idOrUrl, isUrl = false) {
    if (isUrl) {
      return request(`/api/formats?url=${encodeURIComponent(idOrUrl)}&device_id=${encodeURIComponent(getDeviceId())}`);
    }
    return request(`/api/formats/${encodeURIComponent(idOrUrl)}?device_id=${encodeURIComponent(getDeviceId())}`);
  },
  startDownload(videoId, formatType, quality, title, url = '') {
    return request('/api/download/start', {
      method: 'POST',
      body: JSON.stringify({
        video_id: videoId || '',
        url: url || undefined,
        format_type: formatType,
        quality: quality,
        title: title || '',
        device_id: getDeviceId()
      })
    });
  },
  getDownloadStatus(jobId) {
    return request(`/api/download/status/${encodeURIComponent(jobId)}?device_id=${encodeURIComponent(getDeviceId())}`);
  },
  async listDownloads() {
    try {
      return await request(`/api/downloads?device_id=${encodeURIComponent(getDeviceId())}`);
    } catch (_) {
      return request(`/api/download/list?device_id=${encodeURIComponent(getDeviceId())}`);
    }
  },
  deleteDownload(jobId) {
    return request(`/api/download/${encodeURIComponent(jobId)}?device_id=${encodeURIComponent(getDeviceId())}`, {
      method: 'DELETE'
    });
  },
  getFileDownloadUrl(filename) {
    const base = getServerUrl();
    return `${base}/api/download/file/${encodeURIComponent(filename)}`;
  },
  getStreamProxyUrl(directUrl) {
    return `${getServerUrl()}/api/stream-proxy?url=${encodeURIComponent(directUrl)}`;
  },
  getShorts(page = 1, { nextToken = '', interests = '', seen = '', seed = '' } = {}) {
    const p = new URLSearchParams({ page: String(page), device_id: getDeviceId() });
    if (nextToken) p.set('next_token', nextToken);
    if (interests) p.set('interests', interests);
    if (seen) p.set('seen', seen);
    if (seed) p.set('seed', String(seed));
    return request(`/api/shorts?${p.toString()}`);
  },
  getAuthStatus() {
    return request(`/api/auth/status?device_id=${encodeURIComponent(getDeviceId())}`);
  },
  saveCookies(cookies, meta = {}) {
    return request('/api/auth/cookies', {
      method: 'POST',
      body: JSON.stringify({
        cookies,
        device_id: getDeviceId(),
        account_name: meta.account_name || '',
        account_email: meta.account_email || '',
        account_avatar: meta.account_avatar || ''
      })
    });
  },
  logout() {
    return request(`/api/auth/logout?device_id=${encodeURIComponent(getDeviceId())}`, { method: 'POST' });
  },
  getUserFeed(channels = '') {
    const p = new URLSearchParams({ device_id: getDeviceId() });
    if (channels) p.set('channels', channels);
    return request(`/api/user/feed?${p.toString()}`);
  },
  subscribe(channelId, channelName = '') {
    return request('/api/user/subscribe', {
      method: 'POST',
      body: JSON.stringify({ channel_id: channelId, channel_name: channelName, device_id: getDeviceId() })
    });
  },
  unsubscribe(channelId, channelName = '') {
    return request('/api/user/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ channel_id: channelId, channel_name: channelName, device_id: getDeviceId() })
    });
  },
  likeVideo(videoId, action = 'LIKE') {
    return request('/api/user/like', {
      method: 'POST',
      body: JSON.stringify({ video_id: videoId, action, device_id: getDeviceId() })
    });
  },
  recordWatch(videoId, title = '', channel = '') {
    return request('/api/user/watch', {
      method: 'POST',
      body: JSON.stringify({ video_id: videoId, title, channel, device_id: getDeviceId() })
    });
  },
  getAppVersion() {
    return request('/api/app/version', { cache: 'no-store' });
  }
};
