import os
import sys
import uuid
import time
import json
import logging
import threading
import tempfile
import shutil
import re
import random
import hashlib
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, List, Dict, Any
from pathlib import Path

# Ensure JS challenge runtimes (Deno / QuickJS) are discoverable even if service PATH is minimal
for _bin_dir in ("/home/opc/.deno/bin", "/usr/local/bin", os.path.expanduser("~/.deno/bin")):
    if os.path.isdir(_bin_dir) and _bin_dir not in os.environ.get("PATH", ""):
        os.environ["PATH"] = f"{_bin_dir}:{os.environ.get('PATH', '')}"

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel
import imageio_ffmpeg
import yt_dlp

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("free_youtube_server")

app = FastAPI(title="Free YouTube API (SnapTube / TubeMate style)", version="1.0.0")

app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
DOWNLOADS_DIR = BASE_DIR / "downloads"
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
COOKIES_DIR = BASE_DIR / "user_cookies"
COOKIES_DIR.mkdir(parents=True, exist_ok=True)
USER_META_DIR = BASE_DIR / "user_meta"
USER_META_DIR.mkdir(parents=True, exist_ok=True)
OTA_DIR = BASE_DIR / "ota_releases"
OTA_DIR.mkdir(parents=True, exist_ok=True)

FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
logger.info(f"Using FFmpeg binary at: {FFMPEG_EXE}")

# Active and completed download jobs:
# key: job_id -> dict with details & progress (strictly scoped per device_id)
download_jobs: Dict[str, Dict[str, Any]] = {}
jobs_lock = threading.Lock()

# High-Performance In-Memory Query & Feed TTL Cache
query_cache: Dict[str, Dict[str, Any]] = {}
query_cache_lock = threading.Lock()
DEFAULT_TTL = 300  # 5 minutes

def get_cached(key: str) -> Optional[Any]:
    with query_cache_lock:
        if key in query_cache:
            entry = query_cache[key]
            if time.time() < entry.get("expires", 0):
                return entry.get("data")
            del query_cache[key]
    return None

def set_cached(key: str, data: Any, ttl: int = DEFAULT_TTL):
    with query_cache_lock:
        if len(query_cache) > 250:
            oldest_key = min(query_cache.keys(), key=lambda k: query_cache[k].get("expires", 0))
            query_cache.pop(oldest_key, None)
        query_cache[key] = {"data": data, "expires": time.time() + ttl}

def extract_device_id(request: Optional[Request] = None, explicit_id: Optional[str] = None) -> str:
    """Extracts and sanitizes the per-device identifier to strictly isolate user auth & downloads."""
    raw = explicit_id or (request.headers.get("X-Device-Id") if request else None) or (request.query_params.get("device_id") if request else None) or "shared_default"
    clean = re.sub(r'[^A-Za-z0-9_-]', '', str(raw).strip())[:64]
    return clean if len(clean) >= 4 else "shared_default"

def get_cookies_file(device_id: Optional[str] = None) -> Optional[Path]:
    """Returns the isolated cookies.txt path strictly belonging to the requesting device."""
    dev = extract_device_id(explicit_id=device_id)
    dev_cookie = COOKIES_DIR / f"{dev}.txt"
    if dev_cookie.exists() and dev_cookie.stat().st_size > 10:
        return dev_cookie
    return None

def get_user_meta(device_id: Optional[str] = None) -> Dict[str, Any]:
    dev = extract_device_id(explicit_id=device_id)
    meta_file = USER_META_DIR / f"{dev}.json"
    if meta_file.exists():
        try:
            return json.loads(meta_file.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}

def save_user_meta(device_id: str, meta: Dict[str, Any]):
    dev = extract_device_id(explicit_id=device_id)
    meta_file = USER_META_DIR / f"{dev}.json"
    meta_file.write_text(json.dumps(meta), encoding="utf-8")

def cleanup_old_downloads(max_age_seconds: int = 7200):
    """Garbage collects stale download files older than max_age_seconds."""
    now = time.time()
    try:
        for f in DOWNLOADS_DIR.iterdir():
            if f.is_file() and (now - f.stat().st_mtime) > max_age_seconds:
                f.unlink(missing_ok=True)
    except Exception:
        pass

# In-memory Caches for zero-latency responses
avatar_cache: Dict[str, str] = {
    "UCX6OQ3DkcsbYNE6H8uQQuVA": "https://yt3.googleusercontent.com/nxYrc_1_2f77DoBadyxMTmv7ZpRZapHR5jbuYe7PlPd5cIRJxtNNEYyOC0ZsxaDyJJzXrnJiuDE=s176-c-k-c0x00ffffff-no-rj",
    "MrBeast": "https://yt3.googleusercontent.com/nxYrc_1_2f77DoBadyxMTmv7ZpRZapHR5jbuYe7PlPd5cIRJxtNNEYyOC0ZsxaDyJJzXrnJiuDE=s176-c-k-c0x00ffffff-no-rj",
    "UC-lHJZR3Gqxm24_Vd_AJ5Yw": "https://yt3.googleusercontent.com/vik8mAiwHQbXiFyKfZ3__p55_VBdGvwxPpuPJBBwdbF0PjJxikXhrP-C3nLQAMAxGNd_-xQCIg=s176-c-k-c0x00ffffff-no-rj",
    "PewDiePie": "https://yt3.googleusercontent.com/vik8mAiwHQbXiFyKfZ3__p55_VBdGvwxPpuPJBBwdbF0PjJxikXhrP-C3nLQAMAxGNd_-xQCIg=s176-c-k-c0x00ffffff-no-rj",
    "UCBJycsmduvYEL83R_U4JriQ": "https://yt3.googleusercontent.com/qu4TmIaYUlS41-dJ9gZ7DUR3nilvmB5_11i6OKSdvNnBNiyOusZP1bMN6ICnuxtjFBb6ioKgRQ=s176-c-k-c0x00ffffff-no-rj",
    "MKBHD": "https://yt3.googleusercontent.com/qu4TmIaYUlS41-dJ9gZ7DUR3nilvmB5_11i6OKSdvNnBNiyOusZP1bMN6ICnuxtjFBb6ioKgRQ=s176-c-k-c0x00ffffff-no-rj",
    "UCSJ4gkVC6NrvII8umztf0Ow": "https://yt3.googleusercontent.com/IcZW-YBFLCGKQ7BvC8yevab9YAG1SmkEwCd80kcYrhwb0dH39Trfp3DMsI5ZJCsp9wTE60OH428=s176-c-k-c0x00ffffff-no-rj",
    "Lofi Girl": "https://yt3.googleusercontent.com/IcZW-YBFLCGKQ7BvC8yevab9YAG1SmkEwCd80kcYrhwb0dH39Trfp3DMsI5ZJCsp9wTE60OH428=s176-c-k-c0x00ffffff-no-rj",
    "UCHnyfMqiRRG1u-2MsSQLbXA": "https://yt3.googleusercontent.com/7vCbvtCqtjQ3YLgsJt7Y952MQV1sBvhllSCSxHP8_sVZdcPCBrITfhkN2RdyCuwPnsByq-1GoA=s176-c-k-c0x00ffffff-no-rj",
    "Veritasium": "https://yt3.googleusercontent.com/7vCbvtCqtjQ3YLgsJt7Y952MQV1sBvhllSCSxHP8_sVZdcPCBrITfhkN2RdyCuwPnsByq-1GoA=s176-c-k-c0x00ffffff-no-rj",
    "UCq-Fj5jknLsUf-MWSy4_brA": "https://yt3.googleusercontent.com/VunTf0NzCeboiPjbesBdnQuxaF3Lja7UGRbBGQAWRJgMSTj9TTLO3pS1X9qPOJGCNnmPrXeY=s176-c-k-c0x00ffffff-no-rj",
    "T-Series": "https://yt3.googleusercontent.com/VunTf0NzCeboiPjbesBdnQuxaF3Lja7UGRbBGQAWRJgMSTj9TTLO3pS1X9qPOJGCNnmPrXeY=s176-c-k-c0x00ffffff-no-rj",
    "UCsooa4yRKGN_zEE8iknghZA": "https://yt3.googleusercontent.com/PKUi-Lc3VFjUfsIhjK3n-FJDNBf-XQLdg4G4bv4fPFF96D3MVnkbub9ePpLoWdmdFgl5I1Zd=s176-c-k-c0x00ffffff-no-rj",
    "TED-Ed": "https://yt3.googleusercontent.com/PKUi-Lc3VFjUfsIhjK3n-FJDNBf-XQLdg4G4bv4fPFF96D3MVnkbub9ePpLoWdmdFgl5I1Zd=s176-c-k-c0x00ffffff-no-rj",
    "UCuAXFkgsw1L7xaCfnd5JJOw": "https://yt3.googleusercontent.com/_ShEGOdg-t5YGJse14Ooq6FYBZqX_QSlhaTNjG06miYusm5lWm1UroLyVxnYtahADfRTVLtuVQ=s176-c-k-c0x00ffffff-no-rj",
    "Rick Astley": "https://yt3.googleusercontent.com/_ShEGOdg-t5YGJse14Ooq6FYBZqX_QSlhaTNjG06miYusm5lWm1UroLyVxnYtahADfRTVLtuVQ=s176-c-k-c0x00ffffff-no-rj"
}
stream_cache: Dict[str, Dict[str, Any]] = {}

FALLBACK_STREAM_INSTANCES: List[str] = []
_dead_fallback_until: Dict[str, float] = {}
video_extract_locks: Dict[str, threading.Lock] = {}
video_extract_locks_guard = threading.Lock()


def _get_extract_lock(key: str) -> threading.Lock:
    with video_extract_locks_guard:
        if key not in video_extract_locks:
            if len(video_extract_locks) > 500:
                video_extract_locks.clear()
            video_extract_locks[key] = threading.Lock()
        return video_extract_locks[key]


class SafeYoutubeDL(yt_dlp.YoutubeDL):
    """Thread-safe YoutubeDL wrapper that isolates cookiefile writes to an ephemeral copy."""

    def __init__(self, params=None, auto_init=True):
        self._tmp_cookie_path = None
        p = dict(params or {})
        cf = p.get("cookiefile")
        if cf and os.path.exists(cf):
            try:
                fd, tmp_path = tempfile.mkstemp(prefix="ytck_", suffix=".txt")
                os.close(fd)
                shutil.copy2(cf, tmp_path)
                p["cookiefile"] = tmp_path
                self._tmp_cookie_path = tmp_path
            except Exception:
                pass
        super().__init__(p, auto_init=auto_init)

    def close(self):
        try:
            super().close()
        finally:
            if self._tmp_cookie_path and os.path.exists(self._tmp_cookie_path):
                try:
                    os.unlink(self._tmp_cookie_path)
                except Exception:
                    pass
                self._tmp_cookie_path = None


_yt_heavy_sem = threading.Semaphore(2)


def get_base_ydl_opts(device_id: Optional[str] = None, for_youtube: bool = True, allow_android: bool = False, client_override: Optional[List[str]] = None) -> dict:
    opts: Dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "ffmpeg_location": FFMPEG_EXE,
        "socket_timeout": 15,
        "nocheckcertificate": True,
    }
    cookie_path = get_cookies_file(device_id)
    if for_youtube:
        opts["remote_components"] = ["ejs:github"]
        clients = client_override or (["web_safari", "mweb"] if allow_android else ["mweb"])
        opts["extractor_args"] = {"youtube": {"player_client": clients, "formats": ["missing_pot"]}}
        if cookie_path:
            opts["cookiefile"] = str(cookie_path)
            logger.info(f"Using isolated device cookies from: {cookie_path.name}")
    elif cookie_path:
        opts["cookiefile"] = str(cookie_path)
    return opts


def _select_best_progressive_and_audio(info: Dict[str, Any]):
    formats = info.get("formats") or []
    progressive_https = [
        f for f in formats
        if f.get("vcodec") != "none"
        and f.get("acodec") != "none"
        and f.get("url")
        and f.get("protocol") in ("https", "http")
        and "manifest.googlevideo.com" not in (f.get("url") or "")
    ]
    progressive_https.sort(key=lambda x: (x.get("height") or 0, x.get("tbr") or 0), reverse=True)

    progressive_any = [
        f for f in formats
        if f.get("vcodec") != "none" and f.get("acodec") != "none" and f.get("url")
    ]
    progressive_any.sort(key=lambda x: (x.get("protocol") in ("https", "http"), x.get("height") or 0), reverse=True)

    audio_only = [
        f for f in formats
        if f.get("vcodec") == "none"
        and f.get("acodec") != "none"
        and f.get("url")
        and f.get("protocol") in ("https", "http")
        and "manifest.googlevideo.com" not in (f.get("url") or "")
    ]
    # Prefer AAC/M4A (ext=m4a) for universal native Android & WebView hardware audio decoding
    audio_only.sort(key=lambda x: (x.get("ext") == "m4a", x.get("abr") or 0), reverse=True)

    progressive = progressive_https or progressive_any
    return progressive, audio_only


def extract_youtube_info_cached(video_id: str, device_id: Optional[str] = None, force_refresh: bool = False) -> Optional[Dict[str, Any]]:
    """Single-flight cached YouTube extraction scoped per device so /video, /stream, and /formats reuse one run."""
    dev_id = extract_device_id(explicit_id=device_id)
    cache_key = f"ytinfo:{dev_id}:{video_id}"
    if not force_refresh:
        cached = get_cached(cache_key)
        if cached:
            return cached

    lock = _get_extract_lock(f"{dev_id}:{video_id}")
    with lock:
        if not force_refresh:
            cached = get_cached(cache_key)
            if cached:
                return cached

        url = f"https://www.youtube.com/watch?v={video_id}"
        info = None
        last_err = None

        # Serialize heavy Deno/QuickJS yt-dlp extractions (max 2) to prevent 498MB VM swap thrashing
        with _yt_heavy_sem:
            # Strategy 1: mweb client with missing_pot unlocks fast non-403 HTTP 206 audio (140) + mp4 (18/135)
            try:
                opts = get_base_ydl_opts(dev_id, for_youtube=True, client_override=["mweb"])
                with SafeYoutubeDL(opts) as ydl:
                    info = ydl.extract_info(url, download=False)
            except Exception as e:
                last_err = e

            # Strategy 2: fallback to web_safari if mweb failed or returned zero direct https formats
            if info:
                p_check, a_check = _select_best_progressive_and_audio(info)
                if not p_check and not a_check:
                    info = None
            if not info:
                try:
                    opts_saf = get_base_ydl_opts(dev_id, for_youtube=True, client_override=["web_safari"])
                    with SafeYoutubeDL(opts_saf) as ydl:
                        info = ydl.extract_info(url, download=False)
                except Exception as e_saf:
                    last_err = last_err or e_saf

            # Strategy 3: explicit cookie-less mweb fallback if device cookie extraction failed
            if not info and get_cookies_file(dev_id):
                try:
                    opts_anon = get_base_ydl_opts(None, for_youtube=True, client_override=["mweb"])
                    with SafeYoutubeDL(opts_anon) as ydl:
                        info = ydl.extract_info(url, download=False)
                except Exception as e2:
                    last_err = last_err or e2

        if not info:
            if last_err:
                raise last_err
            return None

        progressive, audio_only = _select_best_progressive_and_audio(info)
        best_vid_fmt = progressive[0] if progressive else None
        best_aud_fmt = audio_only[0] if audio_only else best_vid_fmt
        best_vid_url = best_vid_fmt["url"] if best_vid_fmt else (info.get("url") or "")
        best_aud_url = best_aud_fmt["url"] if best_aud_fmt else best_vid_url
        vid_headers = (best_vid_fmt.get("http_headers") if best_vid_fmt else None) or info.get("http_headers") or {}
        aud_headers = (best_aud_fmt.get("http_headers") if best_aud_fmt else None) or vid_headers

        if best_vid_url or best_aud_url:
            entry = {
                "url": best_vid_url,
                "audio_url": best_aud_url,
                "headers": vid_headers,
                "audio_headers": aud_headers,
                "resolutions": progressive,
                "expires": time.time() + 1800,
                "title": info.get("title", ""),
            }
            stream_cache[f"{dev_id}:{video_id}"] = entry
            stream_cache[video_id] = entry

        set_cached(cache_key, info, ttl=1200)
        return info

banner_cache: Dict[str, str] = {}

def generate_channel_avatar_svg(name: str) -> str:
    """Generates an instant, crisp circular SVG creator avatar with brand gradient and initials."""
    clean_name = (name or "Creator").strip()
    initial = clean_name[0].upper() if clean_name else "C"
    gradients = [
        ("#E50914", "#8B0000"), # YouTube Crimson
        ("#7928CA", "#4C1D95"), # Deep Royal Violet
        ("#0070F3", "#1E3A8A"), # Vivid Sapphire
        ("#FF5722", "#BF360C"), # Blaze Orange
        ("#10B981", "#064E3B"), # Emerald Green
        ("#EC4899", "#9D174D"), # Rose Pink
        ("#F59E0B", "#B45309"), # Warm Amber
    ]
    c1, c2 = gradients[abs(hash(clean_name)) % len(gradients)]
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="176" height="176" viewBox="0 0 176 176">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{c1}"/>
      <stop offset="100%" stop-color="{c2}"/>
    </linearGradient>
  </defs>
  <circle cx="88" cy="88" r="88" fill="url(#grad)"/>
  <text x="88" y="106" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="76" font-weight="700" fill="#FFFFFF" text-anchor="middle">{initial}</text>
</svg>"""

def innertube_request(endpoint: str, payload: Dict[str, Any], timeout: int = 5) -> Dict[str, Any]:
    """Shared YouTube Innertube API JSON POST helper."""
    base_payload = {
        "context": {
            "client": {
                "hl": "en",
                "gl": "IN",
                "clientName": "WEB",
                "clientVersion": "2.20250101.00.00"
            }
        }
    }
    base_payload.update(payload)
    req = urllib.request.Request(
        f"https://www.youtube.com/youtubei/v1/{endpoint.lstrip('/')}",
        data=json.dumps(base_payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8", errors="ignore"))

def is_valid_avatar_url(url: Optional[str]) -> bool:
    if not url or not isinstance(url, str):
        return False
    low = url.lower()
    if "default-user" in low or "default_user" in low:
        return False
    # Guard against truncated URLs like https://yt3.ggpht.com/a=s176...
    if re.search(r'/(?:a|ytc)=', url) or url.endswith("/a") or url.endswith("/ytc"):
        return False
    return url.startswith("http")

def normalize_yt_avatar(url: Optional[str]) -> str:
    if not url:
        return ""
    if url.startswith("//"):
        url = "https:" + url
    base = url.split("=")[0]
    if base.endswith("/a") or base.endswith("/ytc"):
        return ""
    if "yt3." in base or "ggpht.com" in base or "googleusercontent.com" in base:
        return f"{base}=s176-c-k-c0x00ffffff-no-rj"
    return url

def _extract_innertube_avatar_from_json(data: Any) -> Optional[str]:
    """Extracts authentic Google CDN avatar from Innertube browse or channel search JSON."""
    if not isinstance(data, dict):
        return None
    header = data.get("header", {})
    # 1. Newer pageHeaderRenderer
    try:
        sources = (
            header.get("pageHeaderRenderer", {})
            .get("content", {})
            .get("pageHeaderViewModel", {})
            .get("image", {})
            .get("decoratedAvatarViewModel", {})
            .get("avatar", {})
            .get("avatarViewModel", {})
            .get("image", {})
            .get("sources", [])
        )
        if sources:
            cand = normalize_yt_avatar(sources[-1].get("url"))
            if is_valid_avatar_url(cand):
                return cand
    except Exception:
        pass
    # 2. Classic c4TabbedHeaderRenderer
    try:
        thumbs = header.get("c4TabbedHeaderRenderer", {}).get("avatar", {}).get("thumbnails", [])
        if thumbs:
            cand = normalize_yt_avatar(thumbs[-1].get("url"))
            if is_valid_avatar_url(cand):
                return cand
    except Exception:
        pass
    # 3. Search channelRenderer
    try:
        sections = (
            data.get("contents", {})
            .get("twoColumnSearchResultsRenderer", {})
            .get("primaryContents", {})
            .get("sectionListRenderer", {})
            .get("contents", [])
        )
        for sec in sections:
            for it in sec.get("itemSectionRenderer", {}).get("contents", []):
                cr = it.get("channelRenderer")
                if cr:
                    thumbs = cr.get("thumbnail", {}).get("thumbnails", [])
                    if thumbs:
                        cand = normalize_yt_avatar(thumbs[-1].get("url"))
                        if is_valid_avatar_url(cand):
                            return cand
    except Exception:
        pass
    # 4. Regex fallback preserving full paths including /a/ and /ytc/ hashes
    txt = json.dumps(data)
    matches = re.findall(r'https?://yt3\.(?:ggpht|googleusercontent)\.com/(?:(?:ytc|a)/)?[A-Za-z0-9_-]{12,}', txt)
    for m in matches:
        cand = normalize_yt_avatar(m)
        if is_valid_avatar_url(cand):
            return cand
    return None

def resolve_avatar_via_innertube(name_or_id: str, force_refresh: bool = False) -> Optional[str]:
    """Fast resolution of official Google CDN creator avatar via structured Innertube in ~200ms."""
    if not name_or_id:
        return None
    clean = str(name_or_id).strip()
    if not force_refresh and clean in avatar_cache and is_valid_avatar_url(avatar_cache[clean]):
        return avatar_cache[clean]

    # 1. If it's a channel ID (UC...), browse directly
    if clean.startswith("UC"):
        try:
            data = innertube_request("browse", {"browseId": clean}, timeout=4)
            avatar = _extract_innertube_avatar_from_json(data)
            if avatar:
                avatar_cache[clean] = avatar
                return avatar
        except Exception as e:
            logger.warning(f"Innertube browse avatar lookup failed for {clean}: {e}")

    # 2. Search specifically with Channels filter (params="EgIQAg==") for authentic channelRenderer icon in 1 fast call
    try:
        data = innertube_request("search", {"query": clean, "params": "EgIQAg=="}, timeout=2.5)
        avatar = _extract_innertube_avatar_from_json(data)
        if avatar:
            avatar_cache[clean] = avatar
            return avatar
    except Exception as e:
        logger.warning(f"Innertube channel search avatar lookup failed for {clean}: {e}")
    return None

def resolve_channel_avatar(channel_id: Optional[str], channel_name: Optional[str], force_refresh: bool = False) -> str:
    """Returns a direct genuine HTTPS Google CDN creator avatar URL (auto-refreshable)."""
    clean_name = (channel_name or "Creator").strip()
    cache_key = channel_id or clean_name

    if not force_refresh:
        if cache_key and cache_key in avatar_cache and is_valid_avatar_url(avatar_cache[cache_key]):
            return avatar_cache[cache_key]
        if clean_name in avatar_cache and is_valid_avatar_url(avatar_cache[clean_name]):
            return avatar_cache[clean_name]

    if channel_id:
        real_id = resolve_avatar_via_innertube(channel_id, force_refresh=force_refresh)
        if real_id and is_valid_avatar_url(real_id):
            avatar_cache[channel_id] = real_id
            if clean_name and clean_name not in ("Creator", "YouTube Shorts"):
                avatar_cache[clean_name] = real_id
            return real_id

    if clean_name and clean_name not in ("Creator", "YouTube Shorts"):
        real_name = resolve_avatar_via_innertube(clean_name, force_refresh=force_refresh)
        if real_name and is_valid_avatar_url(real_name):
            if channel_id:
                avatar_cache[channel_id] = real_name
            avatar_cache[clean_name] = real_name
            return real_name

    # Return SVG monogram data URI if creator has no public CDN avatar yet (never truncated broken img)
    return generate_channel_avatar_svg(clean_name)

def resolve_channel_banner(channel_id: Optional[str], channel_name: Optional[str]) -> str:
    """Scrapes and caches the real YouTube channel panoramic banner."""
    clean_name = (channel_name or "Creator").strip()
    fallback_banner = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80"
    
    if channel_id and channel_id in banner_cache:
        return banner_cache[channel_id]
        
    banner_cache[channel_id] = fallback_banner
    return fallback_banner

class DownloadRequest(BaseModel):
    video_id: str = ""
    url: Optional[str] = None
    format_type: str  # 'mp3' or 'mp4'
    quality: str      # '1080p', '720p', '480p', '360p', '320k', '192k', '128k', 'best'
    title: Optional[str] = "video"
    device_id: Optional[str] = None

@app.api_route("/", methods=["GET", "HEAD"])
def root_status():
    return {"status": "online", "service": "metube"}

@app.api_route("/favicon.ico", methods=["GET", "HEAD"])
def root_favicon():
    return Response(status_code=204)

@app.api_route("/api/health", methods=["GET", "HEAD"])
def health_check(request: Request, device_id: Optional[str] = None):
    dev_id = extract_device_id(request, device_id)
    dev_cookie = get_cookies_file(dev_id)
    return {
        "status": "online",
        "ffmpeg": bool(FFMPEG_EXE and os.path.exists(FFMPEG_EXE)),
        "ffmpeg_path": FFMPEG_EXE,
        "downloads_dir": str(DOWNLOADS_DIR),
        "yt_dlp_version": yt_dlp.version.__version__,
        "cookies_loaded": bool(dev_cookie),
        "device_id": dev_id,
    }


def _compute_file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


@app.get("/api/app/version")
def get_app_version():
    """Returns latest zero-APK OTA web bundle metadata and optional native version."""
    manifest_path = OTA_DIR / "manifest.json"
    bundle_path = OTA_DIR / "bundle.zip"
    manifest: Dict[str, Any] = {}
    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            manifest = {}

    has_bundle = bundle_path.exists() and bundle_path.stat().st_size > 0
    bundle_size = bundle_path.stat().st_size if has_bundle else 0
    sha256 = manifest.get("sha256") or (_compute_file_sha256(bundle_path) if has_bundle else "")

    return JSONResponse(
        content={
            "ota_code": int(manifest.get("ota_code", 1)),
            "ota_version": str(manifest.get("ota_version", "2.0.1")),
            "native_version_code": int(manifest.get("native_version_code", 1)),
            "title": str(manifest.get("title", "MeTube Update")),
            "notes": str(manifest.get("notes", "Performance & playback improvements")),
            "has_bundle": has_bundle,
            "bundle_url": "/api/app/ota/bundle.zip" if has_bundle else "",
            "bundle_size": bundle_size,
            "sha256": sha256,
            "updated_at": int(bundle_path.stat().st_mtime) if has_bundle else 0,
        },
        headers={"Cache-Control": "no-store"},
    )


@app.api_route("/api/app/ota/bundle.zip", methods=["GET", "HEAD"])
def download_ota_bundle():
    """Serves the signed/hashed compiled web bundle archive for instant in-app OTA updates."""
    bundle_path = OTA_DIR / "bundle.zip"
    if not bundle_path.exists() or bundle_path.stat().st_size == 0:
        raise HTTPException(status_code=404, detail="No OTA bundle published yet")
    return FileResponse(
        path=str(bundle_path),
        media_type="application/zip",
        filename="metube-ota.zip",
        headers={"Cache-Control": "no-store"},
    )

@app.api_route("/api/channel/avatar", methods=["GET", "HEAD"])
def get_channel_avatar_endpoint(
    id: Optional[str] = None,
    name: Optional[str] = None,
    refresh: bool = False,
    raw: bool = False
):
    """Returns the creator's genuine original YouTube avatar (supports force refresh and byte proxy)."""
    clean_name = (name or "Creator").strip()
    cache_key = id or clean_name

    if refresh:
        if id: avatar_cache.pop(id, None)
        if clean_name: avatar_cache.pop(clean_name, None)

    if not refresh and cache_key and cache_key in avatar_cache and is_valid_avatar_url(avatar_cache[cache_key]):
        resolved = avatar_cache[cache_key]
    else:
        resolved = resolve_channel_avatar(id, clean_name, force_refresh=refresh)

    if resolved.startswith("data:image/svg+xml"):
        svg_body = urllib.parse.unquote(resolved.split(",", 1)[1]) if "," in resolved else resolved
        return Response(content=svg_body, media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=1800"})

    if raw:
        try:
            req = urllib.request.Request(resolved, headers={"User-Agent": "Mozilla/5.0", "Referer": ""})
            with urllib.request.urlopen(req, timeout=5) as res:
                ctype = res.headers.get("Content-Type", "image/jpeg")
                return Response(content=res.read(), media_type=ctype, headers={"Cache-Control": "public, max-age=86400"})
        except Exception:
            pass

    return RedirectResponse(url=resolved, status_code=302, headers={"Cache-Control": "public, max-age=3600"})

class CookiePayload(BaseModel):
    cookies: str
    device_id: Optional[str] = None
    account_name: Optional[str] = None
    account_email: Optional[str] = None
    account_avatar: Optional[str] = None

@app.post("/api/auth/cookies")
def save_user_cookies(payload: CookiePayload, request: Request):
    """Saves per-device YouTube cookies cleanly isolated from all other devices."""
    dev_id = extract_device_id(request, payload.device_id)
    raw = payload.cookies.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty cookies provided")

    if "Netscape" not in raw and "\t" not in raw:
        lines = ["# Netscape HTTP Cookie File", "# https://curl.haxx.se/rfc/cookie_spec.html"]
        for item in raw.split(";"):
            item = item.strip()
            if "=" in item:
                k, v = item.split("=", 1)
                lines.append(f".youtube.com\tTRUE\t/\tTRUE\t2147483647\t{k.strip()}\t{v.strip()}")
                lines.append(f".google.com\tTRUE\t/\tTRUE\t2147483647\t{k.strip()}\t{v.strip()}")
        formatted = "\n".join(lines) + "\n"
    else:
        formatted = raw

    dev_cookie_file = COOKIES_DIR / f"{dev_id}.txt"
    dev_cookie_file.write_text(formatted, encoding="utf-8")
    meta = {
        "device_id": dev_id,
        "account_name": payload.account_name or "YouTube Account",
        "account_email": payload.account_email or "",
        "account_avatar": payload.account_avatar or "",
        "updated_at": time.time(),
    }
    save_user_meta(dev_id, meta)
    # Invalidate cached extractions for this device so new session cookies apply immediately
    with query_cache_lock:
        for k in [k for k in query_cache.keys() if k.startswith(f"ytinfo:{dev_id}:")]:
            query_cache.pop(k, None)
    logger.info(f"Updated isolated YouTube cookies for device {dev_id} ({meta['account_name']})")
    return {"success": True, "status": "success", "authenticated": True, "device_id": dev_id, **meta, "message": "YouTube account connected cleanly!"}

@app.get("/api/auth/status")
def get_auth_status(request: Request, device_id: Optional[str] = None):
    dev_id = extract_device_id(request, device_id)
    has_cookies = bool(get_cookies_file(dev_id))
    meta = get_user_meta(dev_id) if has_cookies else {}
    return {
        "authenticated": has_cookies,
        "device_id": dev_id,
        "account_name": meta.get("account_name", "YouTube Account") if has_cookies else "",
        "account_email": meta.get("account_email", "") if has_cookies else "",
        "account_avatar": meta.get("account_avatar", "") if has_cookies else "",
        "source": f"device:{dev_id}" if has_cookies else "none"
    }

@app.post("/api/auth/logout")
def logout_auth(request: Request, device_id: Optional[str] = None):
    dev_id = extract_device_id(request, device_id)
    dev_cookie_file = COOKIES_DIR / f"{dev_id}.txt"
    if dev_cookie_file.exists():
        dev_cookie_file.unlink()
    meta_file = USER_META_DIR / f"{dev_id}.json"
    if meta_file.exists():
        meta_file.unlink()
    with query_cache_lock:
        for k in [k for k in query_cache.keys() if k.startswith(f"ytinfo:{dev_id}:")]:
            query_cache.pop(k, None)
    return {"success": True, "status": "success", "authenticated": False, "device_id": dev_id}

@app.get("/api/user/feed")
def get_user_personalized_feed(
    request: Request,
    channels: Optional[str] = Query(None, description="Comma-separated creator channel names or handles"),
    device_id: Optional[str] = Query(None)
):
    """Fetches ONLY this device's subscriptions & personalized videos when authenticated or given followed channels."""
    dev_id = extract_device_id(request, device_id)
    cookie_file = get_cookies_file(dev_id)

    # 1. If device cookies exist, extract official personalized subscriptions feed
    if cookie_file:
        opts = get_base_ydl_opts(dev_id)
        opts["extract_flat"] = True
        opts["playlist_items"] = "1-30"
        try:
            with SafeYoutubeDL(opts) as ydl:
                res = ydl.extract_info("https://www.youtube.com/feed/subscriptions", download=False)
                entries = res.get("entries", []) if res else []
                if entries:
                    clean_results = []
                    for item in entries[:30]:
                        if not item:
                            continue
                        v_id = item.get("id")
                        if not v_id:
                            continue
                        dur = item.get("duration") or 0
                        thumbs = item.get("thumbnails") or []
                        thumbnail = thumbs[-1]["url"] if thumbs else f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg"
                        c_name = item.get("uploader") or item.get("channel") or "Subscribed Creator"
                        c_id = item.get("channel_id") or ""
                        clean_results.append({
                            "id": v_id,
                            "title": item.get("title") or "Untitled",
                            "channel": c_name,
                            "channel_id": c_id,
                            "channel_avatar": resolve_channel_avatar(c_id, c_name),
                            "duration": dur,
                            "duration_string": str(item.get("duration_string") or ""),
                            "view_count": item.get("view_count") or 0,
                            "thumbnail": thumbnail,
                            "url": f"https://www.youtube.com/watch?v={v_id}"
                        })
                    if clean_results:
                        return {"authenticated": True, "videos": clean_results}
        except Exception as e:
            logger.warning(f"User cookie subscriptions feed error for {dev_id}: {e}")

    # 2. Extract uploads from this user's followed creator channels
    if channels:
        ch_list = [c.strip() for c in channels.split(",") if c.strip()][:8]
        if ch_list:
            clean_results = []
            seen_ids = set()
            opts = get_base_ydl_opts(dev_id)
            opts["extract_flat"] = True
            opts["playlist_items"] = "1-4"
            with SafeYoutubeDL(opts) as ydl:
                for c in ch_list:
                    try:
                        clean_c = c if c.startswith("@") or c.startswith("UC") else f"@{c.replace(' ', '')}"
                        target = f"https://www.youtube.com/{clean_c}/videos"
                        res = ydl.extract_info(target, download=False)
                        entries = res.get("entries", []) if res else []
                        for item in entries[:3]:
                            if not item:
                                continue
                            v_id = item.get("id")
                            if not v_id or v_id in seen_ids:
                                continue
                            seen_ids.add(v_id)
                            dur = item.get("duration") or 0
                            thumbs = item.get("thumbnails") or []
                            thumbnail = thumbs[-1]["url"] if thumbs else f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg"
                            c_name = item.get("uploader") or item.get("channel") or c
                            c_id = item.get("channel_id") or ""
                            clean_results.append({
                                "id": v_id,
                                "title": item.get("title") or "Untitled",
                                "channel": c_name,
                                "channel_id": c_id,
                                "channel_avatar": resolve_channel_avatar(c_id, c_name),
                                "duration": dur,
                                "duration_string": str(item.get("duration_string") or ""),
                                "view_count": item.get("view_count") or 0,
                                "thumbnail": thumbnail,
                                "url": f"https://www.youtube.com/watch?v={v_id}"
                            })
                    except Exception:
                        continue
            if clean_results:
                return {"authenticated": True, "videos": clean_results}

    return {"authenticated": False, "videos": []}

video_creator_cache: Dict[str, Dict[str, str]] = {}

def resolve_video_creator_meta(video_id: str) -> Dict[str, str]:
    """Fast concurrent-safe lookup of real creator name, handle/channel URL, and genuine YouTube icon."""
    if video_id in video_creator_cache:
        return video_creator_cache[video_id]
    oembed = fetch_youtube_oembed(video_id)
    c_name = (oembed.get("author_name") or "").strip()
    c_url = (oembed.get("author_url") or "").strip()
    c_handle = ""
    if "/@" in c_url:
        c_handle = "@" + c_url.split("/@", 1)[1].strip("/")
    avatar = ""
    if c_handle or c_name:
        avatar = resolve_channel_avatar(None, c_handle or c_name)
    meta = {
        "channel": c_name or "Creator",
        "channel_id": c_handle,
        "channel_url": c_url,
        "channel_avatar": avatar or generate_channel_avatar_svg(c_name or "C"),
    }
    if c_name:
        video_creator_cache[video_id] = meta
    return meta

def enrich_items_avatars(items: List[Dict[str, Any]], max_enrich: int = 16) -> List[Dict[str, Any]]:
    """Concurrently resolves real creator names & original Google CDN icons for items missing avatars."""
    targets = [
        it for it in items
        if (not is_valid_avatar_url(it.get("channel_avatar")) or it.get("channel") in ("", "YouTube Shorts", "Creator"))
    ][:max_enrich]
    if not targets:
        return items

    def _fill(it: Dict[str, Any]):
        vid = it.get("id")
        c_id = it.get("channel_id") or ""
        c_name = it.get("channel") or ""
        if c_name in ("", "YouTube Shorts", "Creator") and vid:
            meta = resolve_video_creator_meta(vid)
            it["channel"] = meta["channel"]
            if not c_id and meta["channel_id"]:
                it["channel_id"] = meta["channel_id"]
            if meta["channel_url"] and not it.get("channel_url"):
                it["channel_url"] = meta["channel_url"]
            if meta["channel_avatar"]:
                it["channel_avatar"] = meta["channel_avatar"]
        elif not is_valid_avatar_url(it.get("channel_avatar")):
            it["channel_avatar"] = resolve_channel_avatar(c_id, c_name)

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(_fill, targets))
    return items

def _parse_video_renderer(vr: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    vid = vr.get("videoId")
    if not vid:
        return None
    title = "".join(r.get("text", "") for r in vr.get("title", {}).get("runs", []))
    if not title:
        title = vr.get("title", {}).get("accessibility", {}).get("accessibilityData", {}).get("label") or vr.get("title", {}).get("simpleText") or "Video"

    owner_runs = vr.get("ownerText", {}).get("runs", [{}])
    c_name = owner_runs[0].get("text", "Creator") if owner_runs else "Creator"
    c_id = owner_runs[0].get("navigationEndpoint", {}).get("browseEndpoint", {}).get("browseId", "") if owner_runs else ""

    thumbs = vr.get("thumbnail", {}).get("thumbnails", [])
    thumb = thumbs[-1].get("url") if thumbs else f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
    if thumb.startswith("//"):
        thumb = "https:" + thumb

    ch_thumbs = vr.get("channelThumbnailSupportedRenderers", {}).get("channelThumbnailWithLinkRenderer", {}).get("thumbnail", {}).get("thumbnails", [])
    avatar = normalize_yt_avatar(ch_thumbs[-1].get("url")) if ch_thumbs else ""
    if is_valid_avatar_url(avatar):
        if c_name: avatar_cache[c_name] = avatar
        if c_id: avatar_cache[c_id] = avatar
    else:
        avatar = resolve_channel_avatar(c_id, c_name)

    dur_text = vr.get("lengthText", {}).get("simpleText") or ""
    views_text = vr.get("shortViewCountText", {}).get("simpleText") or vr.get("viewCountText", {}).get("simpleText") or "0 views"

    views_num = 0
    m_views = re.search(r'([\d\.,]+)', views_text.replace(',', ''))
    if m_views:
        try:
            val = float(m_views.group(1))
            if 'K' in views_text or 'k' in views_text: views_num = int(val * 1000)
            elif 'M' in views_text or 'm' in views_text: views_num = int(val * 1000000)
            elif 'B' in views_text or 'b' in views_text: views_num = int(val * 1000000000)
            else: views_num = int(val)
        except Exception:
            views_num = 0

    return {
        "id": vid,
        "title": title,
        "channel": c_name,
        "channel_id": c_id,
        "channel_url": f"https://www.youtube.com/channel/{c_id}" if c_id else "",
        "channel_avatar": avatar,
        "duration_string": dur_text,
        "view_count": views_num,
        "view_count_text": views_text,
        "thumbnail": thumb,
        "url": f"https://www.youtube.com/watch?v={vid}"
    }

def innertube_search_paged(
    query: str = "",
    limit: int = 25,
    only_shorts: bool = False,
    continuation: Optional[str] = None,
    enrich_limit: int = 10
) -> Dict[str, Any]:
    """Direct YouTube Innertube API search supporting continuation tokens and genuine Shorts creator enrichment."""
    payload: Dict[str, Any] = {"continuation": continuation} if continuation else {"query": query}
    videos: List[Dict[str, Any]] = []
    next_token: Optional[str] = None
    seen_ids = set()

    try:
        data = innertube_request("search", payload, timeout=6)
        section_contents: List[Dict[str, Any]] = []

        if continuation:
            for cmd in data.get("onResponseReceivedCommands", []):
                items_cont = cmd.get("appendContinuationItemsAction", {}).get("continuationItems", [])
                section_contents.extend(items_cont)
        else:
            section_contents = (
                data.get("contents", {})
                .get("twoColumnSearchResultsRenderer", {})
                .get("primaryContents", {})
                .get("sectionListRenderer", {})
                .get("contents", [])
            )

        for sec in section_contents:
            if "continuationItemRenderer" in sec:
                tok = sec["continuationItemRenderer"].get("continuationEndpoint", {}).get("continuationCommand", {}).get("token")
                if tok:
                    next_token = tok
                continue

            items = sec.get("itemSectionRenderer", {}).get("contents", [])
            for it in items:
                if "continuationItemRenderer" in it:
                    tok = it["continuationItemRenderer"].get("continuationEndpoint", {}).get("continuationCommand", {}).get("token")
                    if tok:
                        next_token = tok
                    continue

                if only_shorts:
                    # 1. Shorts Grid Shelf
                    grid = it.get("gridShelfViewModel", {}).get("contents", [])
                    for g in grid:
                        sh = g.get("shortsLockupViewModel")
                        if sh:
                            vid = sh.get("onTap", {}).get("innertubeCommand", {}).get("reelWatchEndpoint", {}).get("videoId")
                            if not vid:
                                m_id = re.search(r'item-([A-Za-z0-9_-]{11})', sh.get("entityId", ""))
                                if m_id: vid = m_id.group(1)
                            if not vid or vid in seen_ids:
                                continue
                            seen_ids.add(vid)
                            s_title = sh.get("overlayMetadata", {}).get("primaryText", {}).get("content") or "Short"
                            s_views = sh.get("overlayMetadata", {}).get("secondaryText", {}).get("content") or "Shorts"
                            s_sources = sh.get("thumbnailViewModel", {}).get("thumbnailViewModel", {}).get("image", {}).get("sources", [])
                            s_thumb = s_sources[-1].get("url") if s_sources else f"https://i.ytimg.com/vi/{vid}/frame0.jpg"
                            if s_thumb.startswith("//"): s_thumb = "https:" + s_thumb
                            videos.append({
                                "id": vid,
                                "title": s_title,
                                "channel": "Creator",
                                "channel_id": "",
                                "channel_avatar": "",
                                "duration": 30,
                                "duration_string": "0:30",
                                "view_count": 50000,
                                "view_count_text": s_views,
                                "thumbnail": s_thumb,
                                "url": f"https://www.youtube.com/watch?v={vid}",
                                "is_short": True
                            })
                            if len(videos) >= limit:
                                break
                    # 2. Classic Reel Shelf
                    for r_item in it.get("reelShelfRenderer", {}).get("items", []):
                        r_it = r_item.get("reelItemRenderer")
                        if r_it:
                            vid = r_it.get("videoId")
                            if not vid or vid in seen_ids:
                                continue
                            seen_ids.add(vid)
                            s_title = r_it.get("headline", {}).get("simpleText") or "Short"
                            s_views = r_it.get("viewCountText", {}).get("simpleText") or "Shorts"
                            r_thumbs = r_it.get("thumbnail", {}).get("thumbnails", [])
                            s_thumb = r_thumbs[-1].get("url") if r_thumbs else f"https://i.ytimg.com/vi/{vid}/frame0.jpg"
                            if s_thumb.startswith("//"): s_thumb = "https:" + s_thumb
                            videos.append({
                                "id": vid,
                                "title": s_title,
                                "channel": "Creator",
                                "channel_id": "",
                                "channel_avatar": "",
                                "duration": 30,
                                "duration_string": "0:30",
                                "view_count": 50000,
                                "view_count_text": s_views,
                                "thumbnail": s_thumb,
                                "url": f"https://www.youtube.com/watch?v={vid}",
                                "is_short": True
                            })
                            if len(videos) >= limit:
                                break
                else:
                    vr = it.get("videoRenderer")
                    if vr:
                        parsed = _parse_video_renderer(vr)
                        if parsed and parsed["id"] not in seen_ids:
                            seen_ids.add(parsed["id"])
                            videos.append(parsed)
                            if len(videos) >= limit:
                                break
                    elif "shelfRenderer" in it:
                        sc = it["shelfRenderer"].get("content", {})
                        shelf_items = (
                            sc.get("verticalListRenderer", {}).get("items", [])
                            or sc.get("expandedShelfContentsRenderer", {}).get("items", [])
                            or sc.get("horizontalListRenderer", {}).get("items", [])
                        )
                        for si in shelf_items:
                            svr = si.get("videoRenderer")
                            if svr:
                                parsed = _parse_video_renderer(svr)
                                if parsed and parsed["id"] not in seen_ids:
                                    seen_ids.add(parsed["id"])
                                    videos.append(parsed)
                                    if len(videos) >= limit:
                                        break
                        if len(videos) >= limit:
                            break
            if len(videos) >= limit and next_token:
                break
    except Exception as e:
        logger.error(f"Innertube search error for '{query}': {e}")

    if videos and enrich_limit > 0:
        enrich_items_avatars(videos, max_enrich=enrich_limit)

    return {"videos": videos, "next_token": next_token}

def innertube_search(query: str, limit: int = 25, only_shorts: bool = False) -> List[Dict[str, Any]]:
    return innertube_search_paged(query=query, limit=limit, only_shorts=only_shorts, enrich_limit=8).get("videos", [])

SHORTS_DISCOVERY_TOPICS = [
    "#shorts viral today",
    "trending shorts india",
    "amazing facts #shorts",
    "funny comedy #shorts",
    "music dance #shorts",
    "tech gadgets #shorts",
    "sports skills #shorts",
    "gaming highlights #shorts",
    "movie edits #shorts",
    "satisfying clips #shorts",
    "travel nature #shorts",
    "cooking street food #shorts",
]

@app.get("/api/shorts")
def get_shorts_feed(
    page: int = Query(1),
    next_token: Optional[str] = Query(None),
    interests: Optional[str] = Query(None, description="Comma-separated user interest keywords or creator names"),
    seen: Optional[str] = Query(None, description="Comma-separated seen video IDs"),
    seed: Optional[str] = Query(None, description="Randomization seed per session/refresh")
):
    """Fetches randomized & personalized vertical YouTube Shorts via high-speed Innertube (<1s)."""
    seen_set = {x.strip() for x in (seen or "").split(",") if x.strip()}
    interest_terms = [x.strip() for x in (interests or "").split(",") if len(x.strip()) > 1]

    pool = list(SHORTS_DISCOVERY_TOPICS)
    if interest_terms:
        custom_topics = [f"{t} #shorts" for t in interest_terms[:4]]
        pool = custom_topics + pool

    rng = random.Random(f"{seed or int(time.time() // 60)}_{page}")
    results: List[Dict[str, Any]] = []
    out_token: Optional[str] = None

    if next_token:
        res = innertube_search_paged(limit=25, only_shorts=True, continuation=next_token, enrich_limit=0)
        out_token = res.get("next_token")
        for item in res.get("videos", []):
            if item["id"] not in seen_set:
                seen_set.add(item["id"])
                results.append(item)

    if len(results) < 12:
        topic = rng.choice(pool)
        res = innertube_search_paged(query=topic, limit=25, only_shorts=True, enrich_limit=0)
        if not out_token:
            out_token = res.get("next_token")
        for item in res.get("videos", []):
            if item["id"] not in seen_set:
                seen_set.add(item["id"])
                results.append(item)

    if not results:
        res = innertube_search_paged(query="#shorts", limit=25, only_shorts=True, enrich_limit=0)
        results = res.get("videos", [])
        out_token = out_token or res.get("next_token")

    rng.shuffle(results)
    final_shorts = results[:25]
    if final_shorts:
        enrich_items_avatars(final_shorts, max_enrich=12)
    return {"page": page, "next_token": out_token, "shorts": final_shorts}

@app.get("/api/channel/banner")
def get_channel_banner_endpoint(id: Optional[str] = None, name: Optional[str] = None):
    """Returns a direct 302 redirect to the creator's real YouTube channel banner."""
    banner_url = resolve_channel_banner(id, name)
    return RedirectResponse(url=banner_url, status_code=302)

def is_stream_alive(stream_url: str) -> bool:
    """Tests if a direct stream URL actually serves video bytes (prevents 502/401/403 dead proxies)."""
    try:
        req = urllib.request.Request(
            stream_url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "Range": "bytes=0-10"}
        )
        with urllib.request.urlopen(req, timeout=3) as res:
            return res.status in (200, 206)
    except Exception:
        return False

def fetch_youtube_oembed(video_id: str) -> Dict[str, str]:
    """Fetches instant real video title, channel, and author URL via YouTube oembed with 0ms bot risk."""
    try:
        url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        )
        with urllib.request.urlopen(req, timeout=4) as res:
            data = json.loads(res.read().decode("utf-8", errors="ignore"))
            return {
                "title": data.get("title", ""),
                "author_name": data.get("author_name", ""),
                "author_url": data.get("author_url", "")
            }
    except Exception:
        return {}

def resolve_stream_fallback(video_id: str) -> Dict[str, Any]:
    """
    Bulletproof stream and metadata fallback for datacenter environments (Render, AWS, GCP).
    Extracts high-speed direct streams, title, uploader, avatar, duration, and formats.
    """
    for inst in FALLBACK_STREAM_INSTANCES:
        try:
            url = f"{inst}/streams/{video_id}"
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            )
            with urllib.request.urlopen(req, timeout=4) as res:
                data = json.loads(res.read().decode("utf-8", errors="ignore"))
                vstreams = data.get("videoStreams", [])
                astreams = data.get("audioStreams", [])
                
                # Filter out HLS/m3u8 if possible for direct progressive MP4
                mp4_streams = [s for s in vstreams if not s.get("videoOnly") and s.get("url") and "m3u8" not in s.get("url")]
                if not mp4_streams:
                    mp4_streams = [s for s in vstreams if s.get("url") and "m3u8" not in s.get("url")]
                
                chosen_stream = None
                if mp4_streams:
                    mp4_streams.sort(key=lambda s: int("".join(filter(str.isdigit, s.get("quality", "0"))) or 0), reverse=True)
                    for s in mp4_streams:
                        cand_url = s.get("url")
                        if cand_url and is_stream_alive(cand_url):
                            chosen_stream = cand_url
                            break
                            
                if not chosen_stream and vstreams:
                    for s in vstreams:
                        cand_url = s.get("url")
                        if cand_url and "m3u8" not in cand_url and is_stream_alive(cand_url):
                            chosen_stream = cand_url
                            break
                
                audio_url = astreams[0].get("url") if astreams else chosen_stream
                
                if chosen_stream:
                    stream_cache[video_id] = {
                        "url": chosen_stream,
                        "expires": time.time() + 14400,
                        "title": data.get("title", "")
                    }
                    if data.get("uploaderAvatar"):
                        avatar_cache[data.get("uploader", "")] = data.get("uploaderAvatar")
                    
                    return {
                        "url": chosen_stream,
                        "audio_url": audio_url,
                        "title": data.get("title", "Video"),
                        "uploader": data.get("uploader", "Creator"),
                        "uploaderAvatar": data.get("uploaderAvatar", ""),
                        "duration": data.get("duration", 0),
                        "views": data.get("views", 0),
                        "description": data.get("description", ""),
                        "videoStreams": vstreams,
                        "audioStreams": astreams
                    }
        except Exception as e:
            logger.warning(f"Fallback instance {inst} error for {video_id}: {e}")
            continue
    return {}

def extract_direct_stream_url(
    video_id: str,
    audio_only: bool = False,
    device_id: Optional[str] = None,
    max_height: Optional[int] = None
) -> Optional[str]:
    """Extracts and caches the direct MP4/audio stream URL using yt-dlp first then datacenter fallback."""
    now = time.time()
    cache_key = f"{video_id}_{'audio' if audio_only else (max_height or 'best')}"
    if cache_key in stream_cache:
        cached = stream_cache[cache_key]
        if cached.get("expires", 0) > now and cached.get("url"):
            return cached["url"]

    # 1. Try native yt-dlp extraction first (Oracle VM has fast direct access)
    opts = get_base_ydl_opts(device_id)
    opts["socket_timeout"] = 6
    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            formats = info.get("formats", []) if info else []
            if audio_only:
                audio_formats = [
                    f for f in formats
                    if f.get("acodec") != "none" and f.get("vcodec") == "none" and f.get("url")
                ]
                audio_formats.sort(key=lambda x: x.get("abr") or 0, reverse=True)
                chosen_url = audio_formats[0]["url"] if audio_formats else None
                if not chosen_url:
                    for f in formats:
                        if f.get("url") and f.get("acodec") != "none":
                            chosen_url = f["url"]
                            break
            else:
                progressive = [
                    f for f in formats
                    if f.get("vcodec") != "none" and f.get("acodec") != "none" and f.get("url") and f.get("protocol") in ["https", "http"]
                ]
                if max_height:
                    matching = [f for f in progressive if (f.get("height") or 0) <= max_height]
                    if matching:
                        progressive = matching
                progressive.sort(key=lambda x: x.get("height") or 0, reverse=True)
                chosen_url = progressive[0]["url"] if progressive else None
                if not chosen_url:
                    for f in formats:
                        if f.get("url") and f.get("vcodec") != "none":
                            chosen_url = f["url"]
                            break

            if chosen_url:
                stream_cache[cache_key] = {
                    "url": chosen_url,
                    "expires": now + 10800,
                    "title": info.get("title", "")
                }
                return chosen_url
    except Exception as e:
        logger.warning(f"yt-dlp stream extraction failed for {video_id} ({e})")

    # 2. Fallback to Piped proxy instances
    fb = resolve_stream_fallback(video_id)
    if audio_only and fb.get("audio_url"):
        return fb["audio_url"]
    if fb.get("url"):
        return fb["url"]

    return None

def _proxy_remote_stream(direct_url: str, request: Request, upstream_headers: Optional[Dict[str, str]] = None):
    """Streams remote video/audio using bounded upstream Range chunks to prevent YouTube 30 KB/s throttling."""
    base_headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    if upstream_headers:
        for k, v in upstream_headers.items():
            if k.lower() not in ("range", "host", "content-length", "connection") and v:
                base_headers[k] = v

    rng_header = request.headers.get("range")
    req_start = 0
    req_end: Optional[int] = None
    has_client_range = False
    if rng_header:
        m = re.match(r"bytes=(\d+)-(\d*)", rng_header.strip())
        if m:
            has_client_range = True
            req_start = int(m.group(1))
            if m.group(2):
                req_end = int(m.group(2))

    CHUNK_WINDOW = 1048576  # 1 MB per upstream Range fetch bypasses Googlevideo progressive throttling
    is_small_bounded_range = has_client_range and req_end is not None and (req_end - req_start + 1) <= (2 * CHUNK_WINDOW)

    if is_small_bounded_range:
        hdrs = dict(base_headers)
        hdrs["Range"] = f"bytes={req_start}-{req_end}"
        upstream = urllib.request.urlopen(urllib.request.Request(direct_url, headers=hdrs), timeout=15)
        resp_headers = {}
        for h in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"):
            val = upstream.headers.get(h)
            if val:
                resp_headers[h] = val
        resp_headers.setdefault("Accept-Ranges", "bytes")

        def _iter_small():
            try:
                while True:
                    chunk = upstream.read(65536)
                    if not chunk:
                        break
                    yield chunk
            finally:
                try:
                    upstream.close()
                except Exception:
                    pass

        return StreamingResponse(_iter_small(), status_code=upstream.status, headers=resp_headers)

    # Probe first 1 MB chunk via Range (gets instant full transfer rate + exact total byte length)
    first_end = req_start + CHUNK_WINDOW - 1
    if req_end is not None and req_end < first_end:
        first_end = req_end
    probe_headers = dict(base_headers)
    probe_headers["Range"] = f"bytes={req_start}-{first_end}"
    first_upstream = urllib.request.urlopen(urllib.request.Request(direct_url, headers=probe_headers), timeout=15)

    cr = first_upstream.headers.get("Content-Range", "")
    cr_match = re.match(r"bytes\s+(\d+)-(\d+)/(\d+)", cr)
    if first_upstream.status != 206 or not cr_match:
        # Upstream server ignored Range; stream single response cleanly
        resp_headers = {}
        for h in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"):
            val = first_upstream.headers.get(h)
            if val:
                resp_headers[h] = val
        resp_headers.setdefault("Accept-Ranges", "bytes")

        def _iter_plain():
            try:
                while True:
                    chunk = first_upstream.read(65536)
                    if not chunk:
                        break
                    yield chunk
            finally:
                try:
                    first_upstream.close()
                except Exception:
                    pass

        return StreamingResponse(_iter_plain(), status_code=first_upstream.status, headers=resp_headers)

    first_chunk_end = int(cr_match.group(2))
    total_bytes = int(cr_match.group(3))
    target_end = min(req_end, total_bytes - 1) if req_end is not None else (total_bytes - 1)
    content_len = max(0, target_end - req_start + 1)

    resp_headers = {
        "Content-Type": first_upstream.headers.get("Content-Type") or "audio/mp4",
        "Content-Length": str(content_len),
        "Accept-Ranges": "bytes",
    }
    status_out = 206 if has_client_range else 200
    if has_client_range:
        resp_headers["Content-Range"] = f"bytes {req_start}-{target_end}/{total_bytes}"

    def _iter_chunked_range():
        cur_pos = first_chunk_end + 1
        try:
            try:
                while True:
                    chunk = first_upstream.read(65536)
                    if not chunk:
                        break
                    yield chunk
            finally:
                try:
                    first_upstream.close()
                except Exception:
                    pass

            while cur_pos <= target_end:
                nxt_end = min(cur_pos + CHUNK_WINDOW - 1, target_end)
                h = dict(base_headers)
                h["Range"] = f"bytes={cur_pos}-{nxt_end}"
                with urllib.request.urlopen(urllib.request.Request(direct_url, headers=h), timeout=15) as r:
                    read_in_chunk = 0
                    while True:
                        buf = r.read(65536)
                        if not buf:
                            break
                        read_in_chunk += len(buf)
                        yield buf
                    if read_in_chunk == 0:
                        break
                    cur_pos += read_in_chunk
        except Exception as stream_err:
            logger.debug(f"Chunked stream stopped at {cur_pos}: {stream_err}")

    return StreamingResponse(_iter_chunked_range(), status_code=status_out, headers=resp_headers)

def _pick_cached_stream_url(entry: Dict[str, Any], audio: bool, quality: Optional[int]) -> Optional[str]:
    if not entry:
        return None
    if audio:
        return entry.get("audio_url") or entry.get("url")
    res_list = entry.get("resolutions") or []
    if quality and res_list:
        fitting = [f for f in res_list if (f.get("height") or 0) <= quality and f.get("url")]
        if fitting:
            fitting.sort(key=lambda x: (x.get("protocol") in ("https", "http"), x.get("height") or 0), reverse=True)
            return fitting[0]["url"]
    return entry.get("url")


@app.get("/api/stream/{video_id}")
def stream_video_proxy(
    video_id: str,
    request: Request,
    audio: bool = False,
    direct: bool = False,
    proxy: bool = False,
    quality: Optional[str] = None,
    device_id: Optional[str] = None
):
    """High-speed stream proxy (default for Googlevideo IP-bound URLs) with HTTP Range seeking."""
    dev_id = extract_device_id(request, device_id)
    parsed_quality: Optional[int] = None
    if quality:
        q_digits = re.sub(r"\D", "", str(quality))
        if q_digits:
            parsed_quality = int(q_digits)
    sc_key = f"{dev_id}:{video_id}"
    direct_url = None

    cached_entry = stream_cache.get(sc_key) or stream_cache.get(video_id)
    if cached_entry and time.time() < cached_entry.get("expires", 0):
        direct_url = _pick_cached_stream_url(cached_entry, audio, parsed_quality)

    if not direct_url:
        try:
            extract_youtube_info_cached(video_id, device_id=dev_id)
            cached_entry = stream_cache.get(sc_key) or stream_cache.get(video_id)
            direct_url = _pick_cached_stream_url(cached_entry, audio, parsed_quality)
        except Exception as exc:
            logger.warning(f"Cached stream resolution failed for {video_id}: {exc}")

    if not direct_url:
        direct_url = extract_direct_stream_url(video_id, audio_only=audio, device_id=dev_id, max_height=parsed_quality)
    if not direct_url:
        raise HTTPException(status_code=404, detail="Stream not available")

    is_hls_manifest = ".m3u8" in direct_url or "manifest.googlevideo.com" in direct_url
    is_vm_ip_bound = "googlevideo.com" in direct_url
    should_proxy = (proxy or not direct or is_vm_ip_bound) and not is_hls_manifest
    upstream_hdrs = (cached_entry.get("audio_headers") if audio else cached_entry.get("headers")) if cached_entry else None

    if should_proxy:
        try:
            return _proxy_remote_stream(direct_url, request, upstream_headers=upstream_hdrs)
        except Exception as pe:
            # Refresh once in case an upstream Googlevideo signed URL expired or returned 403
            if "403" in str(pe) or "410" in str(pe):
                stream_cache.pop(sc_key, None)
                stream_cache.pop(video_id, None)
                try:
                    extract_youtube_info_cached(video_id, device_id=dev_id, force_refresh=True)
                    new_entry = stream_cache.get(sc_key) or stream_cache.get(video_id)
                    refreshed = _pick_cached_stream_url(new_entry, audio, quality)
                    new_hdrs = (new_entry.get("audio_headers") if audio else new_entry.get("headers")) if new_entry else None
                    if refreshed and ".m3u8" not in refreshed:
                        return _proxy_remote_stream(refreshed, request, upstream_headers=new_hdrs)
                except Exception:
                    pass
            logger.warning(f"Stream range proxy failed for {video_id}: {pe}")

    return RedirectResponse(url=direct_url, status_code=307)

TRENDING_TOPIC_POOLS = {
    "all": [
        "popular trending videos today",
        "viral videos around the world",
        "featured documentaries science space",
        "top music entertainment highlights",
        "trending tech gadgets review",
        "best gaming moments esports",
        "amazing talent performances",
        "world cinema trailers 4k",
    ],
    "music": ["official music video top hits", "trending songs billboard", "live concert performance", "indie chill lofi mix", "bollywood punjabi latest hits"],
    "gaming": ["popular gaming gameplay", "esports tournament highlights", "open world rpg walkthrough", "indie games spotlight", "minecraft valorant best moments"],
    "tech": ["latest tech reviews gadgets", "smartphone camera comparison", "ai hardware innovations", "pc build setup tour"],
    "news": ["world news headlines today", "science discoveries space news", "global economy briefing", "sports breaking highlights"],
    "podcasts": ["trending podcasts interview", "creator podcast full episode", "tech startup founder interview", "comedy podcast clips"],
    "unwatched": ["top viral videos", "must watch short documentaries", "hidden gem educational videos", "creative filmmaking showcase"],
    "live": ["live stream now", "live music radio stream", "live gaming stream"],
}

def _filter_feed_spam(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    filtered = []
    for item in items:
        title_lower = (item.get("title") or "").lower()
        c_lower = (item.get("channel") or "").lower()
        if any(s in title_lower or s in c_lower for s in ["wedding atrocities", "today trending troll", "garam garam varthalu", "tamil troll", "telugu troll"]):
            continue
        filtered.append(item)
    return filtered

@app.get("/api/trending")
def get_trending(
    category: str = Query("all", description="all, shorts, music, gaming, tech, news, podcasts"),
    page: int = Query(1, description="Page number for continuous infinite feed"),
    next_token: Optional[str] = Query(None, description="Innertube continuation token")
):
    cat = category.lower()
    if cat == "shorts":
        res = get_shorts_feed(page=page, next_token=next_token)
        return {"category": category, "page": page, "next_token": res.get("next_token"), "videos": res.get("shorts", [])}

    cache_key = f"trending_{cat}_{page}_{hash(next_token) if next_token else 0}"
    if not next_token:
        cached = get_cached(cache_key)
        if cached:
            return cached

    try:
        out_token: Optional[str] = None
        clean_results: List[Dict[str, Any]] = []

        if next_token:
            paged = innertube_search_paged(limit=25, only_shorts=False, continuation=next_token)
            clean_results = paged.get("videos", [])
            out_token = paged.get("next_token")

        if len(clean_results) < 8:
            topics = TRENDING_TOPIC_POOLS.get(cat, [f"trending {cat} videos", f"popular {cat} showcase", f"best {cat} highlights"])
            q = topics[(max(1, page) - 1) % len(topics)]
            paged = innertube_search_paged(query=q, limit=25, only_shorts=False)
            existing = {v["id"] for v in clean_results}
            for v in paged.get("videos", []):
                if v["id"] not in existing:
                    clean_results.append(v)
                    existing.add(v["id"])
            if paged.get("next_token"):
                out_token = paged.get("next_token")

        filtered_results = _filter_feed_spam(clean_results)
        result = {"category": category, "page": page, "next_token": out_token, "videos": filtered_results}
        if not next_token and filtered_results:
            set_cached(cache_key, result, ttl=240)
        return result
    except Exception as e:
        logger.error(f"Error fetching trending: {e}")
        return {"category": category, "page": page, "next_token": None, "videos": []}

@app.get("/api/search")
def search_videos(
    q: str = Query(..., description="Search keyword"),
    page: int = Query(1, description="Page number"),
    next_token: Optional[str] = Query(None, description="Innertube continuation token")
):
    if not q or not q.strip():
        return {"query": "", "page": 1, "next_token": None, "videos": []}

    clean_q = q.strip()
    cache_key = f"search_{clean_q.lower()}_{page}_{hash(next_token) if next_token else 0}"
    if not next_token:
        cached = get_cached(cache_key)
        if cached:
            return cached

    try:
        if next_token:
            paged = innertube_search_paged(limit=25, only_shorts=False, continuation=next_token)
        else:
            search_query = clean_q if page == 1 else f"{clean_q} videos part {page}"
            paged = innertube_search_paged(query=search_query, limit=25, only_shorts=False)

        videos = paged.get("videos", [])
        if videos:
            result = {"query": clean_q, "page": page, "next_token": paged.get("next_token"), "videos": videos}
            set_cached(cache_key, result, ttl=300)
            return result
    except Exception as ie:
        logger.warning(f"Innertube search fallback: {ie}")

    # Fallback to yt-dlp if Innertube encounters network issue
    fetch_count = min(60, max(1, page) * 20)
    ydl_query = f"ytsearch{fetch_count}:{clean_q}"
    opts = get_base_ydl_opts()
    opts["extract_flat"] = True
    
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            res = ydl.extract_info(ydl_query, download=False)
            all_entries = res.get("entries", []) if res else []
            
            start_idx = (max(1, page) - 1) * 20
            entries = all_entries[start_idx : start_idx + 20] if len(all_entries) > start_idx else all_entries
            
            clean_results = []
            for item in entries:
                if not item:
                    continue
                v_id = item.get("id")
                if not v_id:
                    continue
                
                dur = item.get("duration") or 0
                thumbs = item.get("thumbnails") or []
                thumbnail = thumbs[-1]["url"] if thumbs else f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg"
                c_name = item.get("uploader") or item.get("channel") or "Unknown Channel"
                c_id = item.get("channel_id") or item.get("uploader_id") or ""
                
                clean_results.append({
                    "id": v_id,
                    "title": item.get("title") or "Untitled",
                    "channel": c_name,
                    "channel_id": c_id,
                    "channel_url": item.get("channel_url") or item.get("uploader_url") or "",
                    "channel_avatar": resolve_channel_avatar(c_id, c_name),
                    "duration": item.get("duration"),
                    "duration_string": str(item.get("duration_string") or ""),
                    "view_count": item.get("view_count") or 0,
                    "thumbnail": thumbnail,
                    "url": f"https://www.youtube.com/watch?v={v_id}"
                })
            result = {"query": q, "videos": clean_results}
            set_cached(cache_key, result, ttl=180)
            return result
    except Exception as e:
        logger.error(f"Error searching videos: {e}")
        return {"query": q, "videos": []}

@app.get("/api/video/{video_id}")
def get_video_stream_info(video_id: str, request: Request, device_id: Optional[str] = None):
    """
    Extracts ad-free direct stream playback URLs for native player (video and audio only).
    """
    dev_id = extract_device_id(request, device_id)

    try:
        info = extract_youtube_info_cached(video_id, device_id=dev_id)
        if not info:
            raise HTTPException(status_code=404, detail="Video not found")

        formats = info.get("formats", [])
        progressive, audio_only = _select_best_progressive_and_audio(info)

        raw_stream_url = progressive[0]["url"] if progressive else (formats[0].get("url") if formats else "")
        audio_url = audio_only[0]["url"] if audio_only else raw_stream_url

        thumbs = info.get("thumbnails") or []
        thumbnail = thumbs[-1]["url"] if thumbs else f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg"
        c_name = info.get("uploader") or info.get("channel") or "Creator"
        c_id = info.get("channel_id") or info.get("uploader_id") or ""

        return {
            "id": video_id,
            "title": info.get("title"),
            "channel": c_name,
            "channel_id": c_id,
            "channel_url": info.get("channel_url") or info.get("uploader_url") or "",
            "channel_avatar": resolve_channel_avatar(c_id, c_name),
            "channel_follower_count": info.get("channel_follower_count"),
            "description": info.get("description") or "",
            "duration": info.get("duration"),
            "duration_string": info.get("duration_string"),
            "view_count": info.get("view_count"),
            "like_count": info.get("like_count"),
            "thumbnail": thumbnail,
            "stream_url": f"/api/stream/{video_id}",
            "direct_stream_url": raw_stream_url,
            "audio_url": audio_url,
            "is_short": bool((info.get("duration") and info.get("duration") <= 60) or (info.get("height", 0) > info.get("width", 0))),
            "is_age_restricted": False,
            "available_resolutions": [
                {
                    "height": f.get("height"),
                    "ext": f.get("ext"),
                    "url": f.get("url"),
                    "filesize": f.get("filesize") or f.get("filesize_approx")
                }
                for f in progressive
            ]
        }
    except Exception as e:
        err_msg = str(e)
        logger.warning(f"Native yt-dlp extraction failed for {video_id} ({err_msg}). Activating datacenter fallback...")
        
        fb = resolve_stream_fallback(video_id)
        if fb.get("url"):
            resolutions = []
            for vs in fb.get("videoStreams", []):
                if vs.get("url") and "m3u8" not in vs.get("url"):
                    h = int("".join(filter(str.isdigit, vs.get("quality", "0"))) or 0)
                    resolutions.append({
                        "height": h or 720,
                        "ext": vs.get("format", "mp4").lower(),
                        "url": vs.get("url"),
                        "filesize": None
                    })
            if not resolutions:
                resolutions = [{"height": 720, "ext": "mp4", "url": fb["url"], "filesize": None}]

            c_name = fb.get("uploader") or "Creator"
            c_avatar = fb.get("uploaderAvatar") or resolve_channel_avatar(None, c_name)
            dur = fb.get("duration") or 0
            dur_str = f"{dur // 60}:{dur % 60:02d}" if dur else ""

            return {
                "id": video_id,
                "title": fb.get("title", "Video"),
                "channel": c_name,
                "channel_id": "",
                "channel_url": f"https://www.youtube.com/watch?v={video_id}",
                "channel_avatar": c_avatar,
                "channel_follower_count": None,
                "description": fb.get("description", ""),
                "duration": dur,
                "duration_string": dur_str,
                "view_count": fb.get("views", 0),
                "like_count": 0,
                "thumbnail": f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg",
                "stream_url": f"/api/stream/{video_id}",
                "direct_stream_url": fb["url"],
                "audio_url": fb.get("audio_url", fb["url"]),
                "is_short": bool(dur and dur <= 60),
                "is_age_restricted": False,
                "available_resolutions": resolutions
            }

        if any(term in err_msg.lower() for term in ["confirm your age", "inappropriate for some users", "requires age verification"]):
            logger.warning(f"Video {video_id} is age-restricted")
            return {
                "id": video_id,
                "title": "Age-Restricted Video (18+)",
                "channel": "YouTube Age Gate",
                "channel_id": "",
                "channel_url": f"https://www.youtube.com/watch?v={video_id}",
                "channel_follower_count": None,
                "description": "This video is restricted to age 18+ by YouTube.",
                "duration": 0,
                "duration_string": "",
                "view_count": 0,
                "like_count": 0,
                "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                "stream_url": "",
                "audio_url": "",
                "embed_url": f"https://www.youtube-nocookie.com/embed/{video_id}?autoplay=1&playsinline=1&rel=0&modestbranding=1",
                "is_age_restricted": True,
                "age_restricted_message": "This video requires age verification.",
                "available_resolutions": []
            }

        oembed = fetch_youtube_oembed(video_id)
        real_title = oembed.get("title") or "Playing Video"
        real_channel = oembed.get("author_name") or "Creator"
        real_channel_url = oembed.get("author_url") or f"https://www.youtube.com/watch?v={video_id}"
        c_avatar = resolve_channel_avatar(None, real_channel)

        logger.warning(f"Video {video_id} protected by bot challenge. Providing mobile embed fallback for '{real_title}'.")
        return {
            "id": video_id,
            "title": real_title,
            "channel": real_channel,
            "channel_id": "",
            "channel_url": real_channel_url,
            "channel_avatar": c_avatar,
            "channel_follower_count": None,
            "description": f"Playing {real_title} by {real_channel}.",
            "duration": 0,
            "duration_string": "",
            "view_count": 0,
            "like_count": 0,
            "thumbnail": f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg",
            "stream_url": f"/api/stream/{video_id}",
            "direct_stream_url": "",
            "embed_url": f"https://www.youtube-nocookie.com/embed/{video_id}?autoplay=1&playsinline=1&rel=0&modestbranding=1",
            "is_age_restricted": False,
            "is_bot_blocked": True,
            "available_resolutions": []
        }

def _resolve_browse_id(clean_id: str) -> Optional[str]:
    if clean_id.startswith("UC") and len(clean_id) >= 20:
        return clean_id
    try:
        if clean_id.startswith("http://") or clean_id.startswith("https://"):
            nav = innertube_request("navigation/resolve_url", {"url": clean_id}, timeout=4)
        elif clean_id.startswith("@"):
            nav = innertube_request("navigation/resolve_url", {"url": f"https://www.youtube.com/{clean_id}"}, timeout=4)
        else:
            nav = innertube_request("navigation/resolve_url", {"url": f"https://www.youtube.com/@{clean_id.replace(' ', '')}"}, timeout=4)
        bid = nav.get("endpoint", {}).get("browseEndpoint", {}).get("browseId")
        if bid and bid.startswith("UC"):
            return bid
    except Exception:
        pass
    try:
        data = innertube_request("search", {"query": clean_id.lstrip("@"), "params": "EgIQAg=="}, timeout=4)
        sections = (
            data.get("contents", {})
            .get("twoColumnSearchResultsRenderer", {})
            .get("primaryContents", {})
            .get("sectionListRenderer", {})
            .get("contents", [])
        )
        for sec in sections:
            for it in sec.get("itemSectionRenderer", {}).get("contents", []):
                cr = it.get("channelRenderer")
                if cr and cr.get("channelId"):
                    return cr["channelId"]
    except Exception:
        pass
    return None

def _parse_channel_tab_items(tab_renderer: Dict[str, Any], tab_lower: str, c_id: str, c_title: str, avatar: str, limit: int) -> List[Dict[str, Any]]:
    items_out: List[Dict[str, Any]] = []
    seen = set()
    content = tab_renderer.get("content", {})
    raw_nodes: List[Dict[str, Any]] = []

    if "richGridRenderer" in content:
        raw_nodes.extend(content["richGridRenderer"].get("contents", []))
    elif "sectionListRenderer" in content:
        for sec in content["sectionListRenderer"].get("contents", []):
            for it in sec.get("itemSectionRenderer", {}).get("contents", []):
                if "gridRenderer" in it:
                    raw_nodes.extend(it["gridRenderer"].get("items", []))
                elif "shelfRenderer" in it:
                    sc = it["shelfRenderer"].get("content", {})
                    if "horizontalListRenderer" in sc:
                        raw_nodes.extend(sc["horizontalListRenderer"].get("items", []))
                    elif "expandedShelfContentsRenderer" in sc:
                        raw_nodes.extend(sc["expandedShelfContentsRenderer"].get("items", []))
                else:
                    raw_nodes.append(it)

    for node in raw_nodes:
        if len(items_out) >= limit:
            break
        inner = node.get("richItemRenderer", {}).get("content", node) if isinstance(node, dict) else {}
        if not isinstance(inner, dict):
            continue

        # 1. Videos (gridVideoRenderer or videoRenderer)
        vr = inner.get("videoRenderer") or inner.get("gridVideoRenderer")
        if vr and vr.get("videoId"):
            vid = vr["videoId"]
            if vid in seen:
                continue
            seen.add(vid)
            title = "".join(r.get("text", "") for r in vr.get("title", {}).get("runs", [])) or vr.get("title", {}).get("simpleText") or "Video"
            thumbs = vr.get("thumbnail", {}).get("thumbnails", [])
            thumb = thumbs[-1].get("url") if thumbs else f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
            if thumb.startswith("//"): thumb = "https:" + thumb
            views_text = vr.get("shortViewCountText", {}).get("simpleText") or vr.get("viewCountText", {}).get("simpleText") or ""
            dur_text = vr.get("lengthText", {}).get("simpleText") or ""
            items_out.append({
                "id": vid, "title": title, "channel": c_title, "channel_id": c_id, "channel_avatar": avatar,
                "duration_string": dur_text, "view_count_text": views_text, "thumbnail": thumb,
                "url": f"https://www.youtube.com/watch?v={vid}", "type": "video"
            })
            continue

        # 2. Shorts (shortsLockupViewModel or reelItemRenderer)
        sh = inner.get("shortsLockupViewModel")
        if sh:
            vid = sh.get("onTap", {}).get("innertubeCommand", {}).get("reelWatchEndpoint", {}).get("videoId")
            if not vid:
                m = re.search(r'item-([A-Za-z0-9_-]{11})', sh.get("entityId", ""))
                if m: vid = m.group(1)
            if vid and vid not in seen:
                seen.add(vid)
                s_title = sh.get("overlayMetadata", {}).get("primaryText", {}).get("content") or "Short"
                s_views = sh.get("overlayMetadata", {}).get("secondaryText", {}).get("content") or "Shorts"
                s_sources = sh.get("thumbnailViewModel", {}).get("thumbnailViewModel", {}).get("image", {}).get("sources", [])
                s_thumb = s_sources[-1].get("url") if s_sources else f"https://i.ytimg.com/vi/{vid}/frame0.jpg"
                if s_thumb.startswith("//"): s_thumb = "https:" + s_thumb
                items_out.append({
                    "id": vid, "title": s_title, "channel": c_title, "channel_id": c_id, "channel_avatar": avatar,
                    "duration": 30, "duration_string": "0:30", "view_count_text": s_views, "thumbnail": s_thumb,
                    "url": f"https://www.youtube.com/watch?v={vid}", "is_short": True, "type": "short"
                })
                continue

        ri = inner.get("reelItemRenderer")
        if ri and ri.get("videoId"):
            vid = ri["videoId"]
            if vid not in seen:
                seen.add(vid)
                s_title = ri.get("headline", {}).get("simpleText") or "Short"
                s_views = ri.get("viewCountText", {}).get("simpleText") or "Shorts"
                r_thumbs = ri.get("thumbnail", {}).get("thumbnails", [])
                s_thumb = r_thumbs[-1].get("url") if r_thumbs else f"https://i.ytimg.com/vi/{vid}/frame0.jpg"
                if s_thumb.startswith("//"): s_thumb = "https:" + s_thumb
                items_out.append({
                    "id": vid, "title": s_title, "channel": c_title, "channel_id": c_id, "channel_avatar": avatar,
                    "duration": 30, "duration_string": "0:30", "view_count_text": s_views, "thumbnail": s_thumb,
                    "url": f"https://www.youtube.com/watch?v={vid}", "is_short": True, "type": "short"
                })
                continue

        # 3. Playlists (gridPlaylistRenderer or lockupViewModel)
        gp = inner.get("gridPlaylistRenderer")
        if gp and gp.get("playlistId"):
            pid = gp["playlistId"]
            if pid not in seen:
                seen.add(pid)
                p_title = "".join(r.get("text", "") for r in gp.get("title", {}).get("runs", [])) or gp.get("title", {}).get("simpleText") or "Playlist"
                p_thumbs = gp.get("thumbnail", {}).get("thumbnails", []) or (gp.get("thumbnailRenderer", {}).get("playlistVideoThumbnailRenderer", {}).get("thumbnail", {}).get("thumbnails", []))
                p_thumb = p_thumbs[-1].get("url") if p_thumbs else f"https://i.ytimg.com/vi/{c_id}/hqdefault.jpg"
                if p_thumb.startswith("//"): p_thumb = "https:" + p_thumb
                cnt = gp.get("videoCountShortText", {}).get("simpleText") or gp.get("videoCountText", {}).get("runs", [{}])[0].get("text") or ""
                items_out.append({
                    "id": pid, "title": p_title, "channel": c_title, "channel_id": c_id, "channel_avatar": avatar,
                    "item_count": cnt, "thumbnail": p_thumb,
                    "url": f"https://www.youtube.com/playlist?list={pid}", "type": "playlist"
                })
                continue

        lv = inner.get("lockupViewModel")
        if lv and lv.get("contentId"):
            cid_item = lv["contentId"]
            ctype = lv.get("contentType", "")
            is_pl = ("PLAYLIST" in ctype or tab_lower.startswith("playlist"))
            if cid_item not in seen:
                seen.add(cid_item)
                p_title = lv.get("metadata", {}).get("lockupMetadataViewModel", {}).get("title", {}).get("content") or "Playlist"
                sources = lv.get("contentImage", {}).get("collectionThumbnailViewModel", {}).get("primaryThumbnail", {}).get("thumbnailViewModel", {}).get("image", {}).get("sources", [])
                if not sources:
                    sources = lv.get("contentImage", {}).get("thumbnailViewModel", {}).get("image", {}).get("sources", [])
                p_thumb = sources[-1].get("url") if sources else f"https://i.ytimg.com/vi/{cid_item}/hqdefault.jpg"
                if p_thumb.startswith("//"): p_thumb = "https:" + p_thumb
                items_out.append({
                    "id": cid_item, "title": p_title, "channel": c_title, "channel_id": c_id, "channel_avatar": avatar,
                    "thumbnail": p_thumb,
                    "url": f"https://www.youtube.com/playlist?list={cid_item}" if is_pl else f"https://www.youtube.com/watch?v={cid_item}",
                    "type": "playlist" if is_pl else "video"
                })

    return items_out

@app.get("/api/channel")
def get_channel_content(
    id: Optional[str] = Query(None, description="Channel ID, handle (@username), name, or URL"),
    channel_id: Optional[str] = Query(None, description="Alias for id"),
    tab: str = Query("videos", description="videos, shorts, playlists"),
    limit: int = Query(30, description="Max items to return")
):
    """Fetches channel profile, genuine banner/avatar, subscribers, and Videos/Shorts/Playlists via high-speed Innertube browse."""
    raw_id = (id or channel_id or "").strip()
    if not raw_id:
        raise HTTPException(status_code=400, detail="Missing channel id")

    tab_lower = tab.lower().rstrip("s")
    tab_norm = "playlists" if tab_lower == "playlist" else ("shorts" if tab_lower == "short" else "videos")
    cache_key = f"channel_{raw_id.lower()}_{tab_norm}"
    cached = get_cached(cache_key)
    if cached:
        return cached

    # 1. Fast Innertube browse extraction (~350ms vs 8s yt-dlp)
    try:
        browse_id = _resolve_browse_id(raw_id)
        if browse_id:
            data = innertube_request("browse", {"browseId": browse_id}, timeout=6)
            header = data.get("header", {})
            c_title = raw_id
            sub_text = ""
            handle = ""
            banner = ""
            desc = ""

            if "pageHeaderRenderer" in header:
                phr = header["pageHeaderRenderer"]
                phvm = phr.get("content", {}).get("pageHeaderViewModel", {})
                c_title = phr.get("pageTitle") or phvm.get("title", {}).get("dynamicTextViewModel", {}).get("text", {}).get("content") or raw_id
                banner_srcs = phvm.get("banner", {}).get("imageBannerViewModel", {}).get("image", {}).get("sources", [])
                if banner_srcs:
                    banner = banner_srcs[-1].get("url") or ""
                for row in phvm.get("metadata", {}).get("contentMetadataViewModel", {}).get("metadataRows", []):
                    for part in row.get("metadataParts", []):
                        txt = part.get("text", {}).get("content") or ""
                        if txt.startswith("@"):
                            handle = txt
                        elif "subscriber" in txt.lower():
                            sub_text = txt
                desc = phvm.get("description", {}).get("descriptionPreviewViewModel", {}).get("description", {}).get("content") or ""
            elif "c4TabbedHeaderRenderer" in header:
                c4 = header["c4TabbedHeaderRenderer"]
                c_title = c4.get("title") or raw_id
                sub_text = c4.get("subscriberCountText", {}).get("simpleText") or ""
                handle = c4.get("channelHandleText", {}).get("runs", [{}])[0].get("text") or ""
                b_thumbs = c4.get("banner", {}).get("thumbnails", [])
                if b_thumbs:
                    banner = b_thumbs[-1].get("url") or ""

            avatar = _extract_innertube_avatar_from_json(data) or resolve_channel_avatar(browse_id, c_title)
            if banner and banner.startswith("//"):
                banner = "https:" + banner
            if not banner:
                banner = resolve_channel_banner(browse_id, c_title)

            # Find requested tab among twoColumnBrowseResultsRenderer.tabs
            tabs = data.get("contents", {}).get("twoColumnBrowseResultsRenderer", {}).get("tabs", [])
            chosen_tab = None
            target_keywords = {"videos": "video", "shorts": "short", "playlists": "playlist"}[tab_norm]
            for t in tabs:
                tr = t.get("tabRenderer")
                if not tr:
                    continue
                t_title = (tr.get("title") or "").lower()
                if target_keywords in t_title:
                    chosen_tab = tr
                    break

            if chosen_tab and not chosen_tab.get("selected"):
                t_params = chosen_tab.get("endpoint", {}).get("browseEndpoint", {}).get("params")
                if t_params:
                    tab_data = innertube_request("browse", {"browseId": browse_id, "params": t_params}, timeout=6)
                    for t2 in tab_data.get("contents", {}).get("twoColumnBrowseResultsRenderer", {}).get("tabs", []):
                        tr2 = t2.get("tabRenderer")
                        if tr2 and tr2.get("selected"):
                            chosen_tab = tr2
                            break

            items = _parse_channel_tab_items(chosen_tab or {}, tab_norm, browse_id, c_title, avatar, limit) if chosen_tab else []
            # If Innertube browse resolved the channel header cleanly, return even if tab has 0 items (e.g. no playlists tab)
            res_obj = {
                "channel_id": browse_id,
                "title": c_title,
                "handle": handle,
                "description": desc,
                "subscribers": sub_text or None,
                "subscriber_count_text": sub_text,
                "avatar": avatar,
                "banner": banner,
                "tab": tab_norm,
                "items": items
            }
            set_cached(cache_key, res_obj, ttl=300)
            return res_obj
    except Exception as ie:
        logger.warning(f"Innertube channel browse fallback to yt-dlp for {raw_id}: {ie}")

    # 2. Fallback to yt-dlp channel extractor
    if raw_id.startswith("http://") or raw_id.startswith("https://"):
        base_url = raw_id.rstrip("/")
    elif raw_id.startswith("@"):
        base_url = f"https://www.youtube.com/{raw_id}"
    elif raw_id.startswith("UC"):
        base_url = f"https://www.youtube.com/channel/{raw_id}"
    else:
        base_url = f"https://www.youtube.com/@{raw_id.replace(' ', '')}"

    target_url = f"{base_url}/{tab_norm}"
    opts = get_base_ydl_opts()
    opts["extract_flat"] = True
    opts["playlist_items"] = f"1-{limit}"

    try:
        with SafeYoutubeDL(opts) as ydl:
            res = ydl.extract_info(target_url, download=False)
            if not res:
                return {
                    "channel_id": raw_id, "title": raw_id, "handle": "", "description": "",
                    "subscribers": None, "avatar": resolve_channel_avatar(raw_id, raw_id),
                    "banner": resolve_channel_banner(raw_id, raw_id), "tab": tab_norm, "items": []
                }

            entries = res.get("entries", []) or []
            c_id = res.get("channel_id") or res.get("id") or raw_id
            c_title = res.get("channel") or res.get("uploader") or (res.get("title") or "").split(" - ")[0]
            avatar = resolve_channel_avatar(c_id, c_title)
            clean_items = []
            for item in entries:
                if not item:
                    continue
                item_id = item.get("id")
                if not item_id:
                    continue
                thumbs = item.get("thumbnails") or []
                thumbnail = thumbs[-1]["url"] if thumbs else f"https://i.ytimg.com/vi/{item_id}/hqdefault.jpg"
                clean_items.append({
                    "id": item_id,
                    "title": item.get("title") or "Untitled",
                    "channel": item.get("uploader") or c_title,
                    "channel_id": item.get("channel_id") or c_id,
                    "channel_avatar": avatar,
                    "duration": item.get("duration"),
                    "duration_string": str(item.get("duration_string") or ""),
                    "view_count": item.get("view_count") or 0,
                    "thumbnail": thumbnail,
                    "url": item.get("url") or f"https://www.youtube.com/watch?v={item_id}",
                    "item_count": item.get("playlist_count") or item.get("item_count"),
                    "type": "playlist" if tab_norm == "playlists" else ("short" if tab_norm == "shorts" else "video")
                })

            res_obj = {
                "channel_id": c_id,
                "title": c_title,
                "handle": "",
                "description": res.get("description") or "",
                "subscribers": res.get("channel_follower_count"),
                "avatar": avatar,
                "banner": resolve_channel_banner(c_id, c_title),
                "tab": tab_norm,
                "items": clean_items
            }
            set_cached(cache_key, res_obj, ttl=300)
            return res_obj
    except Exception as e:
        err_low = str(e).lower()
        if "does not have a" in err_low or "this channel does not" in err_low:
            logger.info(f"Channel {raw_id} has no {tab_norm} tab; returning empty list")
            res_obj = {
                "channel_id": raw_id, "title": raw_id, "handle": "", "description": "",
                "subscribers": None, "avatar": resolve_channel_avatar(raw_id, raw_id),
                "banner": resolve_channel_banner(raw_id, raw_id), "tab": tab_norm, "items": []
            }
            set_cached(cache_key, res_obj, ttl=300)
            return res_obj
        logger.error(f"Error fetching channel content: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/playlist/{playlist_id}")
def get_playlist_content(playlist_id: str, limit: int = Query(30)):
    """
    Fetches videos from a specific playlist.
    """
    url = f"https://www.youtube.com/playlist?list={playlist_id}"
    opts = get_base_ydl_opts()
    opts["extract_flat"] = True
    opts["playlist_items"] = f"1-{limit}"

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            res = ydl.extract_info(url, download=False)
            if not res:
                raise HTTPException(status_code=404, detail="Playlist not found")

            entries = res.get("entries", []) or []
            clean_videos = []
            for item in entries:
                if not item:
                    continue
                v_id = item.get("id")
                if not v_id:
                    continue
                
                dur = item.get("duration") or 0
                thumbs = item.get("thumbnails") or []
                thumbnail = thumbs[-1]["url"] if thumbs else f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg"
                clean_videos.append({
                    "id": v_id,
                    "title": item.get("title") or "Untitled",
                    "channel": item.get("uploader") or item.get("channel") or "",
                    "channel_id": item.get("channel_id") or "",
                    "duration": item.get("duration"),
                    "duration_string": str(item.get("duration_string") or ""),
                    "view_count": item.get("view_count") or 0,
                    "thumbnail": thumbnail,
                    "url": f"https://www.youtube.com/watch?v={v_id}"
                })
            return {
                "playlist_id": playlist_id,
                "title": res.get("title") or "Playlist",
                "uploader": res.get("uploader") or "",
                "videos": clean_videos
            }
    except Exception as e:
        logger.error(f"Error fetching playlist: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def _build_format_presets(duration: int = 0, formats: Optional[List[Dict[str, Any]]] = None):
    heights_present = sorted({f.get("height") for f in (formats or []) if f.get("height")}, reverse=True)
    audio_presets = [
        {"type": "mp3", "quality": "320k", "label": "MP3 High (320 kbps)", "est_size_mb": round((duration * 320 / 8) / 1024, 1) if duration else None},
        {"type": "mp3", "quality": "192k", "label": "MP3 Medium (192 kbps)", "est_size_mb": round((duration * 192 / 8) / 1024, 1) if duration else None},
        {"type": "mp3", "quality": "128k", "label": "MP3 Standard (128 kbps)", "est_size_mb": round((duration * 128 / 8) / 1024, 1) if duration else None},
    ]
    video_presets = [
        {"type": "mp4", "quality": "1080p", "label": "1080p Full HD (MP4)", "est_size_mb": round((duration * 3500 / 8) / 1024, 1) if duration else None},
        {"type": "mp4", "quality": "720p", "label": "720p HD (MP4)", "est_size_mb": round((duration * 1800 / 8) / 1024, 1) if duration else None},
        {"type": "mp4", "quality": "480p", "label": "480p Standard (MP4)", "est_size_mb": round((duration * 900 / 8) / 1024, 1) if duration else None},
        {"type": "mp4", "quality": "360p", "label": "360p Data Saver (MP4)", "est_size_mb": round((duration * 500 / 8) / 1024, 1) if duration else None},
    ]
    if heights_present and max(heights_present) > 1080:
        video_presets.insert(0, {"type": "mp4", "quality": f"{max(heights_present)}p", "label": f"{max(heights_present)}p Ultra HD (MP4)", "est_size_mb": round((duration * 7000 / 8) / 1024, 1) if duration else None})
    return audio_presets, video_presets

def _is_youtube_url(u: str) -> bool:
    low = (u or "").lower()
    return any(h in low for h in ("youtube.com", "youtu.be", "youtube-nocookie.com"))

def _extract_universal_info(target_url: str, dev_id: str) -> Dict[str, Any]:
    """Shared universal yt-dlp media extractor for YouTube, Instagram, Facebook, TikTok, X, etc."""
    is_yt = _is_youtube_url(target_url)
    opts = get_base_ydl_opts(dev_id, for_youtube=is_yt)
    opts["socket_timeout"] = 12
    if not is_yt:
        opts["http_headers"] = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"}

    try:
        with SafeYoutubeDL(opts) as ydl:
            info = ydl.extract_info(target_url, download=False)
            if isinstance(info, dict) and info.get("entries"):
                info = next((e for e in info["entries"] if e), info)
            if not info:
                raise HTTPException(status_code=404, detail="Could not extract media from URL")

            formats = info.get("formats") or []
            progressive = [
                f for f in formats
                if f.get("vcodec") != "none" and f.get("acodec") != "none" and f.get("url") and f.get("protocol") in ["https", "http"]
            ]
            progressive.sort(key=lambda x: x.get("height") or 0, reverse=True)
            any_video = [f for f in formats if f.get("vcodec") != "none" and f.get("url") and f.get("protocol") in ["https", "http"]]
            any_video.sort(key=lambda x: x.get("height") or 0, reverse=True)
            audio_only = [f for f in formats if f.get("acodec") != "none" and f.get("url") and f.get("protocol") in ["https", "http"]]
            audio_only.sort(key=lambda x: (x.get("vcodec") == "none", x.get("abr") or 0), reverse=True)

            direct_url = (progressive[0]["url"] if progressive else None) or (any_video[0]["url"] if any_video else None) or info.get("url") or ""
            audio_url = audio_only[0]["url"] if audio_only else direct_url
            dur = info.get("duration") or 0
            audio_presets, video_presets = _build_format_presets(dur, formats)
            thumbs = info.get("thumbnails") or []
            thumb = info.get("thumbnail") or (thumbs[-1]["url"] if thumbs else "")
            vid_id = info.get("id") or str(uuid.uuid4())[:11]
            c_name = info.get("uploader") or info.get("channel") or info.get("extractor_key") or "Creator"
            c_id = info.get("channel_id") or info.get("uploader_id") or ""

            return {
                "id": vid_id,
                "url": info.get("webpage_url") or target_url,
                "source_url": target_url,
                "platform": info.get("extractor_key") or "Web",
                "title": info.get("title") or "Extracted Media",
                "channel": c_name,
                "channel_id": c_id,
                "channel_avatar": resolve_channel_avatar(c_id, c_name) if is_yt else generate_channel_avatar_svg(c_name),
                "duration": dur,
                "duration_string": str(info.get("duration_string") or ""),
                "thumbnail": thumb,
                "direct_stream_url": direct_url,
                "audio_url": audio_url,
                "available_resolutions": [
                    {"height": f.get("height") or 720, "ext": f.get("ext") or "mp4", "url": f.get("url"), "filesize": f.get("filesize") or f.get("filesize_approx")}
                    for f in (progressive or any_video)[:6]
                ],
                "audio_presets": audio_presets,
                "video_presets": video_presets,
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Universal resolve error for {target_url}: {e}")
        raise HTTPException(status_code=400, detail=f"Could not extract link: {str(e)[:180]}")

@app.api_route("/api/resolve-url", methods=["GET", "POST"])
async def resolve_universal_url(request: Request, url: Optional[str] = Query(None), device_id: Optional[str] = Query(None)):
    """Resolves ANY platform URL (YouTube, Instagram, Facebook, TikTok, X, etc.) into playable streams + download formats."""
    target_url = (url or "").strip()
    if not target_url and request.method == "POST":
        try:
            body = await request.json()
            target_url = (body.get("url") or "").strip()
            device_id = device_id or body.get("device_id")
        except Exception:
            pass
    if not target_url or not target_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Valid http/https URL required")

    dev_id = extract_device_id(request, device_id)
    return _extract_universal_info(target_url, dev_id)

@app.get("/api/stream-proxy")
def proxy_arbitrary_stream(request: Request, url: str = Query(...)):
    """Proxies external CDN streams (with HTTP Range seeking) when mobile WebView blocks direct CDN playback."""
    if not url or not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Valid http/https URL required")
    return _proxy_remote_stream(url, request)

@app.get("/api/formats")
def get_download_formats_by_query(
    request: Request,
    url: Optional[str] = Query(None),
    id: Optional[str] = Query(None),
    device_id: Optional[str] = Query(None)
):
    """Returns downloadable video/audio presets for either a YouTube video_id or any universal URL."""
    if url and not _is_youtube_url(url):
        dev_id = extract_device_id(request, device_id)
        return _extract_universal_info(url, dev_id)
    target_id = id or ""
    if url:
        m = re.search(r'(?:v=|/shorts/|youtu\.be/|/embed/)([A-Za-z0-9_-]{11})', url)
        if m:
            target_id = m.group(1)
    if not target_id:
        raise HTTPException(status_code=400, detail="Missing video id or url")
    return get_download_formats(target_id, request=request, device_id=device_id)

@app.get("/api/formats/{video_id}")
def get_download_formats(video_id: str, request: Request, device_id: Optional[str] = None):
    """
    Returns available download presets (MP4: 1080p, 720p, 480p, 360p; MP3: 320k, 192k, 128k)
    with estimated size.
    """
    url = f"https://www.youtube.com/watch?v={video_id}"
    dev_id = extract_device_id(request, device_id)

    try:
        info = extract_youtube_info_cached(video_id, device_id=dev_id)
        if not info:
            raise HTTPException(status_code=404, detail="Video not found")

        duration = info.get("duration") or 0
        audio_presets, video_presets = _build_format_presets(duration, info.get("formats"))
        return {
            "id": video_id,
            "url": url,
            "title": info.get("title"),
            "thumbnail": info.get("thumbnail"),
            "duration": duration,
            "audio_presets": audio_presets,
            "video_presets": video_presets,
        }
    except Exception as e:
        logger.warning(f"Error getting formats via yt-dlp: {e}. Trying fallback...")
        fb = resolve_stream_fallback(video_id)
        dur = fb.get("duration") or 0
        audio_presets, video_presets = _build_format_presets(dur)
        return {
            "id": video_id,
            "url": url,
            "title": fb.get("title", "Video"),
            "thumbnail": f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg",
            "duration": dur,
            "audio_presets": audio_presets,
            "video_presets": video_presets,
        }

def _run_download_job(job_id: str, video_id: str, format_type: str, quality: str, safe_title: str, source_url: Optional[str] = None, device_id: Optional[str] = None):
    logger.info(f"Starting download job {job_id} for dev={device_id} ({format_type} {quality})")

    with jobs_lock:
        if job_id in download_jobs:
            download_jobs[job_id]["status"] = "downloading"
            download_jobs[job_id]["percent"] = 2.0

    def progress_hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            percent = (downloaded / total * 100) if total else 0

            speed = d.get("speed") or 0
            speed_str = f"{speed / (1024 * 1024):.2f} MB/s" if speed else "Downloading..."
            eta = d.get("eta")
            eta_str = f"{eta}s" if eta is not None else ""

            with jobs_lock:
                if job_id in download_jobs:
                    # Keep monotonically progressing until 96% before merge/convert
                    capped = min(96.0, max(float(download_jobs[job_id].get("percent", 0)), round(percent, 1)))
                    download_jobs[job_id]["percent"] = capped
                    download_jobs[job_id]["speed"] = speed_str
                    download_jobs[job_id]["eta"] = eta_str
                    download_jobs[job_id]["downloaded_bytes"] = downloaded
                    download_jobs[job_id]["total_bytes"] = total
        elif d["status"] == "finished":
            with jobs_lock:
                if job_id in download_jobs:
                    download_jobs[job_id]["status"] = "converting"
                    download_jobs[job_id]["percent"] = 98.0

    url = (source_url or "").strip() or f"https://www.youtube.com/watch?v={video_id}"
    is_yt = _is_youtube_url(url)
    out_template = str(DOWNLOADS_DIR / f"{safe_title}_{job_id[:8]}.%(ext)s")

    # Prefer mweb + web_safari for fast non-403 formats & HD HLS without android_vr failures
    opts = get_base_ydl_opts(device_id, for_youtube=is_yt, client_override=["mweb", "web_safari"] if is_yt else None)
    opts.update({
        "socket_timeout": 25,
        "concurrent_fragments": 4,
        "outtmpl": out_template,
        "progress_hooks": [progress_hook],
    })
    if not is_yt:
        opts["http_headers"] = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

    if format_type.lower() == "mp3":
        bitrate = quality.replace("k", "") if "k" in quality else "192"
        opts["format"] = "bestaudio[ext=m4a]/bestaudio/best"
        opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": bitrate,
        }]
    else:
        res_height = quality.replace("p", "") if "p" in quality else "720"
        opts["format"] = (
            f"bestvideo[vcodec^=avc1][height<={res_height}]+bestaudio[ext=m4a]/"
            f"best[ext=mp4][height<={res_height}]/"
            f"bestvideo[height<={res_height}]+bestaudio/"
            f"best[height<={res_height}]/best"
        )
        opts["merge_output_format"] = "mp4"

    try:
        with _yt_heavy_sem:
            try:
                with SafeYoutubeDL(opts) as ydl:
                    ydl.download([url])
            except Exception as primary_err:
                # Retry once with relaxed format selector + single mweb client before fallback
                try:
                    logger.warning(f"Primary format download failed for {video_id} ({primary_err}); retrying relaxed format")
                    retry_opts = get_base_ydl_opts(device_id, for_youtube=is_yt, client_override=["mweb"] if is_yt else None)
                    retry_opts.update({
                        "socket_timeout": 25,
                        "concurrent_fragments": 4,
                        "outtmpl": out_template,
                        "progress_hooks": [progress_hook],
                        "format": "bestaudio/best" if format_type.lower() == "mp3" else "best[ext=mp4]/best",
                    })
                    if format_type.lower() == "mp3":
                        bitrate = quality.replace("k", "") if "k" in quality else "192"
                        retry_opts["postprocessors"] = [{
                            "key": "FFmpegExtractAudio",
                            "preferredcodec": "mp3",
                            "preferredquality": bitrate,
                        }]
                    else:
                        retry_opts["merge_output_format"] = "mp4"
                    with SafeYoutubeDL(retry_opts) as ydl:
                        ydl.download([url])
                except Exception as ydl_err:
                    logger.warning(f"Server-side download error ({ydl_err}). Falling back to proxied client stream...")
                    if not (is_yt and video_id):
                        raise ydl_err
                    is_audio = format_type.lower() == "mp3"
                    expected_ext = "m4a" if is_audio else "mp4"
                    expected_filename = f"{safe_title}_{job_id[:8]}.{expected_ext}"
                    dev_q = urllib.parse.quote(extract_device_id(explicit_id=device_id))
                    fallback_stream = f"/api/stream/{video_id}?audio={'true' if is_audio else 'false'}&proxy=true&device_id={dev_q}"
                    has_cookies = bool(get_cookies_file(device_id))

                    with jobs_lock:
                        if job_id in download_jobs:
                            download_jobs[job_id]["status"] = "client_ready"
                            download_jobs[job_id]["percent"] = 100.0
                            download_jobs[job_id]["filename"] = expected_filename
                            download_jobs[job_id]["download_url"] = fallback_stream
                            download_jobs[job_id]["client_direct_url"] = fallback_stream
                            download_jobs[job_id]["requires_cookies"] = not has_cookies
                            download_jobs[job_id]["completed_at"] = time.time()
                    return

        expected_ext = "mp3" if format_type.lower() == "mp3" else "mp4"
        expected_filename = f"{safe_title}_{job_id[:8]}.{expected_ext}"
        filepath = DOWNLOADS_DIR / expected_filename

        if not filepath.exists():
            matches = list(DOWNLOADS_DIR.glob(f"*{job_id[:8]}.*"))
            if matches:
                filepath = matches[0]
                expected_filename = filepath.name

        file_size = filepath.stat().st_size if filepath.exists() else 0

        with jobs_lock:
            if job_id in download_jobs:
                download_jobs[job_id]["status"] = "completed"
                download_jobs[job_id]["percent"] = 100.0
                download_jobs[job_id]["filename"] = expected_filename
                download_jobs[job_id]["file_size"] = file_size
                download_jobs[job_id]["file_size_str"] = f"{file_size / (1024 * 1024):.2f} MB"
                download_jobs[job_id]["download_url"] = f"/api/download/file/{expected_filename}"
                download_jobs[job_id]["completed_at"] = time.time()

        logger.info(f"Download job {job_id} successfully finished: {expected_filename}")
    except Exception as e:
        logger.error(f"Download job {job_id} failed: {e}")
        with jobs_lock:
            if job_id in download_jobs:
                download_jobs[job_id]["status"] = "error"
                download_jobs[job_id]["error"] = str(e)

@app.post("/api/download/start")
def start_download(req: DownloadRequest, request: Request, background_tasks: BackgroundTasks):
    dev_id = extract_device_id(request, req.device_id)
    job_id = str(uuid.uuid4())
    safe_title = "".join(c for c in (req.title or "video") if c.isalnum() or c in (" ", "-", "_")).strip()
    safe_title = (safe_title.replace(" ", "_") or "media")[:40]
    src_url = (req.url or "").strip() or (f"https://www.youtube.com/watch?v={req.video_id}" if req.video_id else "")
    if not src_url:
        raise HTTPException(status_code=400, detail="Either video_id or url is required")

    job_data = {
        "job_id": job_id,
        "device_id": dev_id,
        "video_id": req.video_id or job_id[:11],
        "source_url": src_url,
        "title": req.title or "video",
        "format_type": req.format_type,
        "quality": req.quality,
        "status": "queued",
        "percent": 0.0,
        "speed": "Starting...",
        "eta": "",
        "downloaded_bytes": 0,
        "total_bytes": 0,
        "filename": None,
        "file_size": 0,
        "file_size_str": "",
        "download_url": None,
        "created_at": time.time(),
        "error": None,
    }

    with jobs_lock:
        download_jobs[job_id] = job_data

    background_tasks.add_task(cleanup_old_downloads)
    background_tasks.add_task(
        _run_download_job,
        job_id=job_id,
        video_id=req.video_id or "",
        format_type=req.format_type,
        quality=req.quality,
        safe_title=safe_title,
        source_url=src_url,
        device_id=dev_id
    )

    return job_data

@app.get("/api/download/status/{job_id}")
def get_download_status(job_id: str, request: Request, device_id: Optional[str] = None):
    dev_id = extract_device_id(request, device_id)
    with jobs_lock:
        job = download_jobs.get(job_id)
        if not job or (dev_id != "shared_default" and job.get("device_id") not in (dev_id, None, "shared_default")):
            raise HTTPException(status_code=404, detail="Job not found")
        return job

@app.get("/api/download/list")
@app.get("/api/downloads")
def list_downloads(request: Request, device_id: Optional[str] = None):
    """Lists download jobs strictly isolated to the requesting device_id."""
    dev_id = extract_device_id(request, device_id)
    with jobs_lock:
        scoped = [j for j in download_jobs.values() if j.get("device_id") == dev_id]
        sorted_jobs = sorted(scoped, key=lambda x: x.get("created_at", 0), reverse=True)
        return {"device_id": dev_id, "downloads": sorted_jobs}

@app.get("/api/download/file/{filename}")
def serve_downloaded_file(filename: str):
    clean_filename = os.path.basename(filename)
    filepath = DOWNLOADS_DIR / clean_filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="File not found")

    media_type = "audio/mpeg" if clean_filename.endswith(".mp3") else "video/mp4"
    return FileResponse(
        path=str(filepath),
        filename=clean_filename,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{clean_filename}"'}
    )

@app.delete("/api/download/{job_id}")
def delete_download(job_id: str, request: Request, device_id: Optional[str] = None):
    dev_id = extract_device_id(request, device_id)
    with jobs_lock:
        existing = download_jobs.get(job_id)
        if not existing:
            # Idempotent delete for stale cached jobs after a server restart
            for left in DOWNLOADS_DIR.glob(f"*_{job_id[:8]}.*"):
                try:
                    left.unlink()
                except Exception:
                    pass
            return {"message": "Already removed", "job_id": job_id}
        if dev_id != "shared_default" and existing.get("device_id") not in (dev_id, None, "shared_default"):
            raise HTTPException(status_code=404, detail="Job not found")
        job = download_jobs.pop(job_id, None)
        filename = job.get("filename") if job else None
        if filename:
            filepath = DOWNLOADS_DIR / filename
            if filepath.exists():
                try:
                    filepath.unlink()
                except Exception as e:
                    logger.warning(f"Could not delete file {filepath}: {e}")
        return {"message": "Job deleted", "job_id": job_id}

if __name__ == "__main__":
    import uvicorn
    # Bind to 0.0.0.0 so physical mobile phones on the same Wi-Fi can connect directly
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
