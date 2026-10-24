// MeTube High-Performance API Client
const STORAGE_KEY = 'metube_server_url';
export const DEFAULT_SERVER_URL = 'https://me-tube-o48b.onrender.com';

export function getServerUrl() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && saved.trim()) {
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

export async function request(endpoint, options = {}) {
  const base = getServerUrl();
  const url = `${base}${endpoint}`;
  const config = {
    ...options,
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  };

  const res = await fetch(url, config);
  if (!res.ok) {
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
}

export const api = {
  checkHealth() {
    return request('/api/health');
  },
  getTrending(category = 'all', page = 1) {
    return request(`/api/trending?category=${encodeURIComponent(category)}&page=${page}`);
  },
  search(q, page = 1) {
    return request(`/api/search?q=${encodeURIComponent(q)}&page=${page}`);
  },
  getVideo(id) {
    return request(`/api/video/${encodeURIComponent(id)}`);
  },
  getChannel(channelId, tab = 'videos', limit = 30) {
    return request(`/api/channel?channel_id=${encodeURIComponent(channelId)}&tab=${encodeURIComponent(tab)}&limit=${limit}`);
  },
  getPlaylist(playlistId, limit = 30) {
    return request(`/api/playlist/${encodeURIComponent(playlistId)}?limit=${limit}`);
  },
  getFormats(id) {
    return request(`/api/formats/${encodeURIComponent(id)}`);
  },
  startDownload(videoId, formatType, quality, title) {
    return request('/api/download/start', {
      method: 'POST',
      body: JSON.stringify({
        video_id: videoId,
        format_type: formatType,
        quality: quality,
        title: title || ''
      })
    });
  },
  getDownloadStatus(jobId) {
    return request(`/api/download/status/${encodeURIComponent(jobId)}`);
  },
  listDownloads() {
    return request('/api/download/list');
  },
  deleteDownload(jobId) {
    return request(`/api/download/${encodeURIComponent(jobId)}`, {
      method: 'DELETE'
    });
  },
  getFileDownloadUrl(filename) {
    const base = getServerUrl();
    return `${base}/api/download/file/${encodeURIComponent(filename)}`;
  }
};
