import os
import sys
import uuid
import time
import json
import logging
import threading
from typing import Optional, List, Dict, Any
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel
import imageio_ffmpeg
import yt_dlp

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("free_youtube_server")

app = FastAPI(title="Free YouTube API (SnapTube / TubeMate style)", version="1.0.0")

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

COOKIES_FILE = BASE_DIR / "cookies.txt"

def get_base_ydl_opts() -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "ffmpeg_location": FFMPEG_EXE,
        "js_runtimes": {"node": {}},
        "remote_components": ["ejs:github"],
        "socket_timeout": 30,
        "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    }
    if COOKIES_FILE.exists() and COOKIES_FILE.stat().st_size > 0:
        opts["cookiefile"] = str(COOKIES_FILE)
        logger.info(f"Using YouTube cookies from: {COOKIES_FILE}")
    return opts

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

@app.get("/api/trending")
def get_trending(category: str = Query("all", description="all, music, gaming, tech, news")):
    category_queries = {
        "all": "ytsearch20:trending videos today",
        "music": "ytsearch20:trending official music videos",
        "gaming": "ytsearch20:trending gaming gameplay",
        "tech": "ytsearch20:latest tech reviews",
        "news": "ytsearch20:latest breaking news world",
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
                
                # Best thumbnail
                thumbs = item.get("thumbnails") or []
                thumbnail = thumbs[-1]["url"] if thumbs else f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg"
                
                clean_results.append({
                    "id": v_id,
                    "title": item.get("title") or "Untitled",
                    "channel": item.get("uploader") or item.get("channel") or "Unknown Channel",
                    "channel_id": item.get("channel_id") or item.get("uploader_id") or "",
                    "channel_url": item.get("channel_url") or item.get("uploader_url") or "",
                    "duration": item.get("duration"),
                    "duration_string": str(item.get("duration_string") or ""),
                    "view_count": item.get("view_count") or 0,
                    "thumbnail": thumbnail,
                    "url": f"https://www.youtube.com/watch?v={v_id}"
                })
            return {"category": category, "videos": clean_results}
    except Exception as e:
        logger.error(f"Error fetching trending: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/search")
def search_videos(q: str = Query(..., description="Search keyword")):
    if not q or not q.strip():
        return {"query": "", "videos": []}
    
    search_query = f"ytsearch25:{q.strip()}"
    opts = get_base_ydl_opts()
    opts["extract_flat"] = True
    
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            res = ydl.extract_info(search_query, download=False)
            entries = res.get("entries", []) if res else []
            
            clean_results = []
            for item in entries:
                if not item:
                    continue
                v_id = item.get("id")
                if not v_id:
                    continue
                
                thumbs = item.get("thumbnails") or []
                thumbnail = thumbs[-1]["url"] if thumbs else f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg"
                
                clean_results.append({
                    "id": v_id,
                    "title": item.get("title") or "Untitled",
                    "channel": item.get("uploader") or item.get("channel") or "Unknown Channel",
                    "channel_id": item.get("channel_id") or item.get("uploader_id") or "",
                    "channel_url": item.get("channel_url") or item.get("uploader_url") or "",
                    "duration": item.get("duration"),
                    "duration_string": str(item.get("duration_string") or ""),
                    "view_count": item.get("view_count") or 0,
                    "thumbnail": thumbnail,
                    "url": f"https://www.youtube.com/watch?v={v_id}"
                })
            return {"query": q, "videos": clean_results}
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
            
            # Find progressive mp4 formats (video + audio in one stream for quick playback)
            progressive = [
                f for f in formats 
                if f.get("vcodec") != "none" and f.get("acodec") != "none" and f.get("url") and f.get("protocol") in ["https", "http"]
            ]
            
            # Sort progressive by height descending
            progressive.sort(key=lambda x: x.get("height") or 0, reverse=True)
            
            # Find best audio-only stream (for background play or audio-only mode)
            audio_only = [
                f for f in formats 
                if f.get("vcodec") == "none" and f.get("acodec") != "none" and f.get("url") and f.get("protocol") in ["https", "http"]
            ]
            audio_only.sort(key=lambda x: x.get("abr") or 0, reverse=True)
            
            # Best stream url
            stream_url = progressive[0]["url"] if progressive else (formats[0]["url"] if formats else "")
            audio_url = audio_only[0]["url"] if audio_only else stream_url
            
            thumbs = info.get("thumbnails") or []
            thumbnail = thumbs[-1]["url"] if thumbs else f"https://i.ytimg.com/vi/{video_id}/maxresdefault.jpg"
            
            return {
                "id": video_id,
                "title": info.get("title"),
                "channel": info.get("uploader") or info.get("channel"),
                "channel_id": info.get("channel_id") or info.get("uploader_id") or "",
                "channel_url": info.get("channel_url") or info.get("uploader_url") or "",
                "channel_follower_count": info.get("channel_follower_count"),
                "description": info.get("description") or "",
                "duration": info.get("duration"),
                "duration_string": info.get("duration_string"),
                "view_count": info.get("view_count"),
                "like_count": info.get("like_count"),
                "thumbnail": thumbnail,
                "stream_url": stream_url,
                "audio_url": audio_url,
                "embed_url": f"https://www.youtube.com/embed/{video_id}?autoplay=1&modestbranding=1&rel=0&playsinline=1&enablejsapi=1",
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
        logger.error(f"Error extracting video stream for {video_id}: {err_msg}")
        if any(term in err_msg.lower() for term in ["age", "confirm your age", "sign in to confirm", "inappropriate"]):
            logger.warning(f"Video {video_id} is age-restricted")
            return {
                "id": video_id,
                "title": "Age-Restricted Video (18+)",
                "channel": "YouTube Age Gate",
                "channel_id": "",
                "channel_url": "",
                "channel_follower_count": None,
                "description": "This video is restricted to age 18+ by YouTube. YouTube blocks direct third-party stream scraping without an authenticated session.",
                "duration": 0,
                "duration_string": "",
                "view_count": 0,
                "like_count": 0,
                "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                "stream_url": "",
                "audio_url": "",
                "embed_url": f"https://www.youtube.com/embed/{video_id}?autoplay=1",
                "is_age_restricted": True,
                "age_restricted_message": "This video is age-restricted by YouTube. You can watch it directly using the button below or place a cookies.txt file into the server/ directory to unlock ad-free streaming & downloads.",
                "available_resolutions": []
            }
        raise HTTPException(status_code=500, detail=err_msg)

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

            avatar = ""
            for t in (res.get("thumbnails") or []):
                avatar = t.get("url") or avatar

            return {
                "channel_id": res.get("channel_id") or res.get("id") or clean_id,
                "title": res.get("channel") or res.get("uploader") or (res.get("title") or "").split(" - ")[0],
                "description": res.get("description") or "",
                "subscribers": res.get("channel_follower_count"),
                "avatar": avatar,
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
        logger.error(f"Error getting formats: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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
    
    opts = get_base_ydl_opts()
    opts["outtmpl"] = out_template
    opts["progress_hooks"] = [progress_hook]
    
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
        # MP4 video
        res_height = quality.replace("p", "") if "p" in quality else "720"
        opts["format"] = f"bestvideo[height<={res_height}]+bestaudio/best[height<={res_height}]/best"
        opts["merge_output_format"] = "mp4"

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
            
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
