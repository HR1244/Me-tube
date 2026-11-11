import os
import sys
import uuid
import time
import json
import logging
import threading
import re
import urllib.request
import urllib.parse
from typing import Optional, List, Dict, Any
from pathlib import Path

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

FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
logger.info(f"Using FFmpeg binary at: {FFMPEG_EXE}")

# Active and completed download jobs:
# key: job_id -> dict with details & progress
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
        if len(query_cache) > 200:
            oldest_key = min(query_cache.keys(), key=lambda k: query_cache[k].get("expires", 0))
            query_cache.pop(oldest_key, None)
        query_cache[key] = {"data": data, "expires": time.time() + ttl}

COOKIES_FILE = BASE_DIR / "cookies.txt"

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

FALLBACK_STREAM_INSTANCES = [
    "https://pipedapi.ducks.party",
    "https://piped.video"
]

def get_base_ydl_opts() -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "ffmpeg_location": FFMPEG_EXE,
        "socket_timeout": 12,
        "extractor_args": {
            "youtube": {
                "player_client": ["android"]
            }
        },
    }
    if COOKIES_FILE.exists() and COOKIES_FILE.stat().st_size > 0:
        opts["cookiefile"] = str(COOKIES_FILE)
        logger.info(f"Using YouTube cookies from: {COOKIES_FILE}")
    return opts

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

def resolve_channel_avatar(channel_id: Optional[str], channel_name: Optional[str]) -> str:
    """Resolves real YouTube circular avatar or returns fast dynamic SVG."""
    clean_name = (channel_name or "Creator").strip()
    cache_key = channel_id or clean_name
    
    if cache_key in avatar_cache:
        return avatar_cache[cache_key]
    return f"/api/channel/avatar?name={urllib.parse.quote(clean_name)}"

def resolve_channel_banner(channel_id: Optional[str], channel_name: Optional[str]) -> str:
    """Scrapes and caches the real YouTube channel panoramic banner."""
    clean_name = (channel_name or "Creator").strip()
    fallback_banner = "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80"
    
    if channel_id and channel_id in banner_cache:
        return banner_cache[channel_id]
        
    if not channel_id or not channel_id.startswith("UC"):
        return fallback_banner
        
    try:
        url = f"https://api.piped.private.coffee/channel/{channel_id}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=3) as res:
            data = json.loads(res.read().decode("utf-8", errors="ignore"))
            banner = data.get("bannerUrl")
            if banner:
                banner_cache[channel_id] = banner
                return banner
    except Exception:
        pass
        
    banner_cache[channel_id] = fallback_banner
    return fallback_banner

class DownloadRequest(BaseModel):
    video_id: str
    format_type: str  # 'mp3' or 'mp4'
    quality: str      # '1080p', '720p', '480p', '360p', '320k', '192k', '128k'
    title: Optional[str] = "video"

@app.get("/api/health")
def health_check():
    has_cookies = bool(COOKIES_FILE.exists() and COOKIES_FILE.stat().st_size > 0)
    return {
        "status": "online",
        "ffmpeg": bool(FFMPEG_EXE and os.path.exists(FFMPEG_EXE)),
        "ffmpeg_path": FFMPEG_EXE,
        "downloads_dir": str(DOWNLOADS_DIR),
        "yt_dlp_version": yt_dlp.version.__version__,
        "cookies_loaded": has_cookies,
        "cookies_path": str(COOKIES_FILE),
    }

@app.get("/api/channel/avatar")
def get_channel_avatar_endpoint(id: Optional[str] = None, name: Optional[str] = None):
    """Returns the creator's avatar image instantly with 0ms latency."""
    clean_name = (name or "Creator").strip()
    cache_key = id or clean_name
    
    if cache_key in avatar_cache:
        return RedirectResponse(url=avatar_cache[cache_key], status_code=302)
    
    # Return high-resolution dynamic SVG avatar (guaranteed 200 OK!)
    svg = generate_channel_avatar_svg(clean_name)
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*"
        }
    )

class CookiePayload(BaseModel):
    cookies: str

@app.post("/api/auth/cookies")
def save_user_cookies(payload: CookiePayload):
    """Saves YouTube cookies for authenticated sessions and personalized feeds."""
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
        formatted = "\n".join(lines) + "\n"
    else:
        formatted = raw

    COOKIES_FILE.write_text(formatted, encoding="utf-8")
    logger.info("Successfully updated YouTube cookies for authenticated session!")
    return {"status": "success", "message": "YouTube account connected successfully!"}

@app.get("/api/auth/status")
def get_auth_status():
    has_cookies = bool(COOKIES_FILE.exists() and COOKIES_FILE.stat().st_size > 10)
    return {
        "authenticated": has_cookies,
        "source": "cookies.txt" if has_cookies else "none"
    }

@app.post("/api/auth/logout")
def logout_auth():
    if COOKIES_FILE.exists():
        COOKIES_FILE.unlink()
    return {"status": "success", "authenticated": False}

@app.get("/api/user/feed")
def get_user_personalized_feed():
    """Fetches user's subscriptions and personalized videos when authenticated."""
    if not (COOKIES_FILE.exists() and COOKIES_FILE.stat().st_size > 10):
        return {"authenticated": False, "videos": []}
    
    opts = get_base_ydl_opts()
    opts["extract_flat"] = True
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            res = ydl.extract_info("https://www.youtube.com/feed/subscriptions", download=False)
            entries = res.get("entries", []) if res else []
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
                clean_results.append({
                    "id": v_id,
                    "title": item.get("title") or "Untitled",
                    "channel": c_name,
                    "channel_id": item.get("channel_id") or "",
                    "channel_avatar": f"/api/channel/avatar?name={urllib.parse.quote(c_name)}",
                    "duration": item.get("duration"),
                    "duration_string": str(item.get("duration_string") or ""),
                    "view_count": item.get("view_count") or 0,
                    "thumbnail": thumbnail,
                    "url": f"https://www.youtube.com/watch?v={v_id}"
                })
            return {"authenticated": True, "videos": clean_results}
    except Exception as e:
        logger.error(f"User feed fetch error: {e}")
        return {"authenticated": True, "videos": []}

@app.get("/api/shorts")
def get_shorts_feed(page: int = Query(1)):
    """Fetches strictly vertical YouTube Shorts (duration <= 60 seconds)."""
    cache_key = f"shorts_{page}"
    cached = get_cached(cache_key)
    if cached:
        return cached

    page_modifiers = ["viral", "trending", "funny", "top", "popular"]
    kw = page_modifiers[(max(1, page) - 1) % len(page_modifiers)]
    opts = get_base_ydl_opts()
    opts["extract_flat"] = True
    query = f"ytsearch40:#shorts {kw}"
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            res = ydl.extract_info(query, download=False)
            entries = res.get("entries", []) if res else []
            shorts_list = []
            for item in entries:
                if not item:
                    continue
                v_id = item.get("id")
                dur = item.get("duration") or 0
                if dur and dur > 65:
                    continue
                c_name = item.get("uploader") or item.get("channel") or "Creator"
                shorts_list.append({
                    "id": v_id,
                    "title": item.get("title") or "Short",
                    "channel": c_name,
                    "channel_id": item.get("channel_id") or "",
                    "duration": dur,
                    "duration_string": f"{int(dur)}s" if dur else "0:30",
                    "view_count": item.get("view_count") or 0,
                    "thumbnail": f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg",
                    "url": f"https://www.youtube.com/watch?v={v_id}",
                    "is_short": True
                })
            result = {"page": page, "shorts": shorts_list[:20]}
            set_cached(cache_key, result, ttl=300)
            return result
    except Exception as e:
        logger.error(f"Shorts fetch error: {e}")
        return {"page": page, "shorts": []}

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

def extract_direct_stream_url(video_id: str, audio_only: bool = False) -> Optional[str]:
    """Extracts and caches the direct googlevideo MP4/audio stream URL using native yt-dlp with datacenter fallback."""
    now = time.time()
    cache_key = f"{video_id}_audio" if audio_only else video_id
    if cache_key in stream_cache:
        cached = stream_cache[cache_key]
        if cached.get("expires", 0) > now and cached.get("url"):
            return cached["url"]

    opts = get_base_ydl_opts()
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
                    "expires": now + 14400,
                    "title": info.get("title", "")
                }
                return chosen_url
    except Exception as e:
        logger.warning(f"yt-dlp stream extraction failed for {video_id} ({e}), activating datacenter fallback...")

    # Datacenter Fallback
    fb = resolve_stream_fallback(video_id)
    if audio_only and fb.get("audio_url"):
        return fb["audio_url"]
    if fb.get("url"):
        return fb["url"]

    return None

@app.get("/api/stream/{video_id}")
def stream_video_proxy(video_id: str, request: Request, audio: bool = False, direct: bool = False):
    """
    Native HTTP 206 partial content stream proxy with direct fallback.
    Streams video/mp4 or audio directly to HTML5 <video> / audio with zero YouTube watermark and zero CORS restrictions.
    """
    direct_url = extract_direct_stream_url(video_id, audio_only=audio)
    if not direct_url:
        raise HTTPException(status_code=404, detail="Stream not available")

    if direct:
        return RedirectResponse(url=direct_url, status_code=307)

    range_header = request.headers.get("range")
    req_headers = {
        "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
    }
    if range_header:
        req_headers["Range"] = range_header

    try:
        req = urllib.request.Request(direct_url, headers=req_headers)
        upstream = urllib.request.urlopen(req, timeout=15)
        
        status_code = upstream.status
        default_type = "audio/mp4" if audio else "video/mp4"
        content_type = upstream.headers.get("Content-Type", default_type)
        content_length = upstream.headers.get("Content-Length")
        content_range = upstream.headers.get("Content-Range")
        accept_ranges = upstream.headers.get("Accept-Ranges", "bytes")

        resp_headers = {
            "Accept-Ranges": accept_ranges,
            "Content-Type": content_type,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Range",
            "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
        }
        if content_length:
            resp_headers["Content-Length"] = content_length
        if content_range:
            resp_headers["Content-Range"] = content_range

        def iter_stream():
            try:
                while True:
                    chunk = upstream.read(128 * 1024)
                    if not chunk:
                        break
                    yield chunk
            finally:
                upstream.close()

        return StreamingResponse(
            iter_stream(),
            status_code=status_code,
            media_type=content_type,
            headers=resp_headers
        )
    except Exception as e:
        logger.warning(f"Stream proxy fallback to 307 redirect for {video_id}: {e}")
        return RedirectResponse(url=direct_url, status_code=307)

@app.get("/api/trending")
def get_trending(
    category: str = Query("all", description="all, shorts, music, gaming, tech, news, podcasts"),
    page: int = Query(1, description="Page number for continuous infinite feed")
):
    cache_key = f"trending_{category.lower()}_{page}"
    cached = get_cached(cache_key)
    if cached:
        return cached

    page_modifiers = ["today", "viral", "popular", "trending", "featured", "best"]
    kw = page_modifiers[(max(1, page) - 1) % len(page_modifiers)]
    
    category_queries = {
        "all": f"ytsearch20:trending videos {kw}",
        "shorts": f"ytsearch20:#shorts viral {kw}",
        "music": f"ytsearch20:trending official music {kw}",
        "gaming": f"ytsearch20:trending gaming {kw}",
        "tech": f"ytsearch20:tech reviews {kw}",
        "news": f"ytsearch20:latest news {kw}",
        "podcasts": f"ytsearch20:trending podcasts {kw}",
        "unwatched": f"ytsearch20:popular videos {kw}",
        "live": "ytsearch20:live stream now",
    }
    query = category_queries.get(category.lower(), category_queries["all"])
    
    opts = get_base_ydl_opts()
    opts["extract_flat"] = True
    
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            res = ydl.extract_info(query, download=False)
            entries = res.get("entries", []) if res else []
            
            clean_results = []
            for item in entries:
                if not item:
                    continue
                v_id = item.get("id")
                if not v_id:
                    continue
                
                dur = item.get("duration") or 0
                if category.lower() == "shorts" and dur and dur > 65:
                    continue
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
                    "channel_avatar": f"/api/channel/avatar?id={c_id}&name={urllib.parse.quote(c_name)}",
                    "duration": item.get("duration"),
                    "duration_string": str(item.get("duration_string") or ""),
                    "view_count": item.get("view_count") or 0,
                    "thumbnail": thumbnail,
                    "url": f"https://www.youtube.com/watch?v={v_id}"
                })
            result = {"category": category, "page": page, "videos": clean_results}
            set_cached(cache_key, result, ttl=300)
            return result
    except Exception as e:
        logger.error(f"Error fetching trending: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/search")
def search_videos(
    q: str = Query(..., description="Search keyword"),
    page: int = Query(1, description="Page number")
):
    if not q or not q.strip():
        return {"query": "", "page": 1, "videos": []}
    
    clean_q = q.strip().lower()
    cache_key = f"search_{clean_q}_{page}"
    cached = get_cached(cache_key)
    if cached:
        return cached

    fetch_count = min(100, max(1, page) * 20)
    search_query = f"ytsearch{fetch_count}:{q.strip()}"
    opts = get_base_ydl_opts()
    opts["extract_flat"] = True
    
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            res = ydl.extract_info(search_query, download=False)
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
                    "channel_avatar": f"/api/channel/avatar?id={c_id}&name={urllib.parse.quote(c_name)}",
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
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/video/{video_id}")
def get_video_stream_info(video_id: str):
    """
    Extracts ad-free direct stream playback URLs for native player (video and audio only).
    """
    url = f"https://www.youtube.com/watch?v={video_id}"
    opts = get_base_ydl_opts()
    
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                raise HTTPException(status_code=404, detail="Video not found")
            
            formats = info.get("formats", [])
            progressive = [
                f for f in formats 
                if f.get("vcodec") != "none" and f.get("acodec") != "none" and f.get("url") and f.get("protocol") in ["https", "http"]
            ]
            progressive.sort(key=lambda x: x.get("height") or 0, reverse=True)
            
            audio_only = [
                f for f in formats 
                if f.get("vcodec") == "none" and f.get("acodec") != "none" and f.get("url") and f.get("protocol") in ["https", "http"]
            ]
            audio_only.sort(key=lambda x: x.get("abr") or 0, reverse=True)
            
            raw_stream_url = progressive[0]["url"] if progressive else (formats[0]["url"] if formats else "")
            audio_url = audio_only[0]["url"] if audio_only else raw_stream_url
            
            thumbs = info.get("thumbnails") or []
            thumbnail = thumbs[-1]["url"] if thumbs else f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg"
            c_name = info.get("uploader") or info.get("channel") or "Creator"
            c_id = info.get("channel_id") or info.get("uploader_id") or ""
            
            # Cache stream URL for proxy
            if raw_stream_url:
                stream_cache[video_id] = {
                    "url": raw_stream_url,
                    "expires": time.time() + 7200,
                    "title": info.get("title", "")
                }
            
            return {
                "id": video_id,
                "title": info.get("title"),
                "channel": c_name,
                "channel_id": c_id,
                "channel_url": info.get("channel_url") or info.get("uploader_url") or "",
                "channel_avatar": f"/api/channel/avatar?id={c_id}&name={urllib.parse.quote(c_name)}",
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
            c_avatar = fb.get("uploaderAvatar") or f"/api/channel/avatar?name={urllib.parse.quote(c_name)}"
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
        c_avatar = f"/api/channel/avatar?name={urllib.parse.quote(real_channel)}"

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

@app.get("/api/channel")
def get_channel_content(
    id: str = Query(..., description="Channel ID, handle (@username), name, or URL"),
    tab: str = Query("videos", description="videos, shorts, playlists"),
    limit: int = Query(30, description="Max items to return")
):
    """
    Fetches a channel's details and items for videos, shorts, or playlists.
    """
    clean_id = id.strip()
    if clean_id.startswith("http://") or clean_id.startswith("https://"):
        base_url = clean_id.rstrip("/")
    elif clean_id.startswith("@"):
        base_url = f"https://www.youtube.com/{clean_id}"
    elif clean_id.startswith("UC"):
        base_url = f"https://www.youtube.com/channel/{clean_id}"
    else:
        base_url = f"https://www.youtube.com/@{clean_id}"

    tab_lower = tab.lower()
    if tab_lower in ["shorts", "short"]:
        target_url = f"{base_url}/shorts"
    elif tab_lower in ["playlists", "playlist"]:
        target_url = f"{base_url}/playlists"
    else:
        target_url = f"{base_url}/videos"

    opts = get_base_ydl_opts()
    opts["extract_flat"] = True
    opts["playlist_items"] = f"1-{limit}"

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            res = ydl.extract_info(target_url, download=False)
            if not res:
                raise HTTPException(status_code=404, detail="Channel not found")

            entries = res.get("entries", []) or []
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
                    "channel": item.get("uploader") or res.get("uploader") or res.get("channel") or "",
                    "channel_id": item.get("channel_id") or res.get("channel_id") or "",
                    "duration": item.get("duration"),
                    "duration_string": str(item.get("duration_string") or ""),
                    "view_count": item.get("view_count") or 0,
                    "thumbnail": thumbnail,
                    "url": item.get("url") or f"https://www.youtube.com/watch?v={item_id}",
                    "item_count": item.get("playlist_count") or item.get("item_count"),
                    "type": "playlist" if tab_lower in ["playlists", "playlist"] else ("short" if tab_lower in ["shorts", "short"] else "video")
                })

            c_id = res.get("channel_id") or res.get("id") or clean_id
            c_title = res.get("channel") or res.get("uploader") or (res.get("title") or "").split(" - ")[0]
            avatar = f"/api/channel/avatar?id={c_id}&name={urllib.parse.quote(c_title)}"
            banner = f"/api/channel/banner?id={c_id}&name={urllib.parse.quote(c_title)}"

            return {
                "channel_id": c_id,
                "title": c_title,
                "description": res.get("description") or "",
                "subscribers": res.get("channel_follower_count"),
                "avatar": avatar,
                "banner": banner,
                "tab": tab_lower,
                "items": clean_items
            }
    except Exception as e:
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

@app.get("/api/formats/{video_id}")
def get_download_formats(video_id: str):
    """
    Returns available download presets (MP4: 1080p, 720p, 480p, 360p; MP3: 320k, 192k, 128k)
    with estimated size.
    """
    url = f"https://www.youtube.com/watch?v={video_id}"
    opts = get_base_ydl_opts()
    
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info:
                raise HTTPException(status_code=404, detail="Video not found")
            
            duration = info.get("duration") or 0
            
            # Audio presets
            # Size estimate: duration (sec) * bitrate (kbps) / 8 / 1024 / 1024 MB
            audio_presets = [
                {
                    "type": "mp3",
                    "quality": "320k",
                    "label": "MP3 High (320 kbps)",
                    "est_size_mb": round((duration * 320 / 8) / 1024, 1) if duration else None
                },
                {
                    "type": "mp3",
                    "quality": "192k",
                    "label": "MP3 Medium (192 kbps)",
                    "est_size_mb": round((duration * 192 / 8) / 1024, 1) if duration else None
                },
                {
                    "type": "mp3",
                    "quality": "128k",
                    "label": "MP3 Standard (128 kbps)",
                    "est_size_mb": round((duration * 128 / 8) / 1024, 1) if duration else None
                },
            ]
            
            # Video presets
            video_presets = [
                {
                    "type": "mp4",
                    "quality": "1080p",
                    "label": "1080p Full HD (MP4)",
                    "est_size_mb": round((duration * 3500 / 8) / 1024, 1) if duration else None
                },
                {
                    "type": "mp4",
                    "quality": "720p",
                    "label": "720p HD (MP4)",
                    "est_size_mb": round((duration * 1800 / 8) / 1024, 1) if duration else None
                },
                {
                    "type": "mp4",
                    "quality": "480p",
                    "label": "480p Standard (MP4)",
                    "est_size_mb": round((duration * 900 / 8) / 1024, 1) if duration else None
                },
                {
                    "type": "mp4",
                    "quality": "360p",
                    "label": "360p Data Saver (MP4)",
                    "est_size_mb": round((duration * 500 / 8) / 1024, 1) if duration else None
                },
            ]
            
            return {
                "id": video_id,
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
        audio_presets = [
            {"type": "mp3", "quality": "320k", "label": "MP3 High (320 kbps)", "est_size_mb": round((dur * 320 / 8) / 1024, 1) if dur else None},
            {"type": "mp3", "quality": "192k", "label": "MP3 Medium (192 kbps)", "est_size_mb": round((dur * 192 / 8) / 1024, 1) if dur else None},
            {"type": "mp3", "quality": "128k", "label": "MP3 Standard (128 kbps)", "est_size_mb": round((dur * 128 / 8) / 1024, 1) if dur else None},
        ]
        video_presets = [
            {"type": "mp4", "quality": "1080p", "label": "1080p Full HD (MP4)", "est_size_mb": round((dur * 3500 / 8) / 1024, 1) if dur else None},
            {"type": "mp4", "quality": "720p", "label": "720p HD (MP4)", "est_size_mb": round((dur * 1800 / 8) / 1024, 1) if dur else None},
            {"type": "mp4", "quality": "480p", "label": "480p Standard (MP4)", "est_size_mb": round((dur * 900 / 8) / 1024, 1) if dur else None},
            {"type": "mp4", "quality": "360p", "label": "360p Data Saver (MP4)", "est_size_mb": round((dur * 500 / 8) / 1024, 1) if dur else None},
        ]
        return {
            "id": video_id,
            "title": fb.get("title", "Video"),
            "thumbnail": f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg",
            "duration": dur,
            "audio_presets": audio_presets,
            "video_presets": video_presets,
        }

def _run_download_job(job_id: str, video_id: str, format_type: str, quality: str, safe_title: str):
    logger.info(f"Starting download job {job_id} for {video_id} ({format_type} {quality})")
    
    with jobs_lock:
        download_jobs[job_id]["status"] = "downloading"
    
    def progress_hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            percent = (downloaded / total * 100) if total else 0
            
            speed = d.get("speed") or 0
            speed_str = f"{speed / (1024 * 1024):.2f} MB/s" if speed else "Calculating..."
            eta = d.get("eta")
            eta_str = f"{eta}s" if eta is not None else ""
            
            with jobs_lock:
                if job_id in download_jobs:
                    download_jobs[job_id]["percent"] = round(percent, 1)
                    download_jobs[job_id]["speed"] = speed_str
                    download_jobs[job_id]["eta"] = eta_str
                    download_jobs[job_id]["downloaded_bytes"] = downloaded
                    download_jobs[job_id]["total_bytes"] = total
        elif d["status"] == "finished":
            with jobs_lock:
                if job_id in download_jobs:
                    download_jobs[job_id]["status"] = "converting"
                    download_jobs[job_id]["percent"] = 99.0

    url = f"https://www.youtube.com/watch?v={video_id}"
    out_template = str(DOWNLOADS_DIR / f"{safe_title}_{job_id[:8]}.%(ext)s")
    
    opts = {
        "quiet": True,
        "no_warnings": True,
        "ffmpeg_location": FFMPEG_EXE,
        "socket_timeout": 30,
        "outtmpl": out_template,
        "progress_hooks": [progress_hook],
        "extractor_args": {
            "youtube": {
                "player_client": ["android"]
            }
        },
    }
    if COOKIES_FILE.exists() and COOKIES_FILE.stat().st_size > 0:
        opts["cookiefile"] = str(COOKIES_FILE)
    
    if format_type.lower() == "mp3":
        # Extract audio and convert to mp3
        bitrate = quality.replace("k", "") if "k" in quality else "192"
        opts["format"] = "bestaudio/best"
        opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": bitrate,
        }]
    else:
        # MP4 video with audio merge
        res_height = quality.replace("p", "") if "p" in quality else "720"
        opts["format"] = f"bestvideo[height<={res_height}]+bestaudio/bestvideo+bestaudio/best"
        opts["merge_output_format"] = "mp4"

    try:
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
        except Exception as ydl_err:
            logger.warning(f"Server-side download hit YouTube bot protection ({ydl_err}). Enabling client direct download...")
            is_audio = format_type.lower() == "mp3"
            direct_stream = extract_direct_stream_url(video_id, audio_only=is_audio)
            fallback_stream = direct_stream or f"/api/stream/{video_id}?audio={'true' if is_audio else 'false'}&direct=true"
            expected_ext = "mp3" if is_audio else "mp4"
            expected_filename = f"{safe_title}_{job_id[:8]}.{expected_ext}"
            has_cookies = bool(COOKIES_FILE.exists() and COOKIES_FILE.stat().st_size > 10)

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
            
        # Find the generated file
        expected_ext = "mp3" if format_type.lower() == "mp3" else "mp4"
        expected_filename = f"{safe_title}_{job_id[:8]}.{expected_ext}"
        filepath = DOWNLOADS_DIR / expected_filename
        
        # If filename differed slightly due to sanitize
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
def start_download(req: DownloadRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    safe_title = "".join(c for c in (req.title or "video") if c.isalnum() or c in (" ", "-", "_")).strip()
    safe_title = safe_title.replace(" ", "_")[:40]
    
    job_data = {
        "job_id": job_id,
        "video_id": req.video_id,
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
    
    background_tasks.add_task(
        _run_download_job,
        job_id=job_id,
        video_id=req.video_id,
        format_type=req.format_type,
        quality=req.quality,
        safe_title=safe_title
    )
    
    return job_data

@app.get("/api/download/status/{job_id}")
def get_download_status(job_id: str):
    with jobs_lock:
        job = download_jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return job

@app.get("/api/download/list")
@app.get("/api/downloads")
def list_downloads():
    with jobs_lock:
        # Return sorted by created_at descending
        sorted_jobs = sorted(list(download_jobs.values()), key=lambda x: x.get("created_at", 0), reverse=True)
        return {"downloads": sorted_jobs}

@app.get("/api/download/file/{filename}")
def serve_downloaded_file(filename: str):
    # Prevent directory traversal
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
def delete_download(job_id: str):
    with jobs_lock:
        job = download_jobs.pop(job_id, None)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        
        filename = job.get("filename")
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
