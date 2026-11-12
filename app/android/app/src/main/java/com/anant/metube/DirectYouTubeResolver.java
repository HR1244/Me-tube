package com.anant.metube;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Resolves direct YouTube CDN audio & progressive MP4 streams directly from the device's
 * residential IP via InnerTube ANDROID/IOS clients, bypassing cloud datacenter bot blocks.
 */
public final class DirectYouTubeResolver {
    private static final String TAG = "DirectYTResolver";
    private static final String INNERTUBE_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
    private static final long CACHE_TTL_MS = 15 * 60 * 1000L;

    public static final String UA_ANDROID =
        "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip";
    public static final String UA_IOS =
        "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";

    public static final class ResolvedStream {
        public final String videoId;
        public final String title;
        public final String author;
        public final long durationMs;
        public final String audioUrl;
        public final String videoUrl;
        public final String hlsUrl;
        public final String audioExt;
        public final String audioMime;
        public final String userAgent;
        public final long expiresAtMs;

        ResolvedStream(
            String videoId, String title, String author, long durationMs,
            String audioUrl, String videoUrl, String hlsUrl,
            String audioExt, String audioMime, String userAgent
        ) {
            this.videoId = videoId;
            this.title = title;
            this.author = author;
            this.durationMs = durationMs;
            this.audioUrl = audioUrl;
            this.videoUrl = videoUrl;
            this.hlsUrl = hlsUrl;
            this.audioExt = audioExt;
            this.audioMime = audioMime;
            this.userAgent = userAgent;
            this.expiresAtMs = System.currentTimeMillis() + CACHE_TTL_MS;
        }

        public boolean isExpired() {
            return System.currentTimeMillis() >= expiresAtMs;
        }
    }

    private static final ConcurrentHashMap<String, ResolvedStream> CACHE = new ConcurrentHashMap<>();
    private static final ExecutorService PREWARM_EXEC = Executors.newCachedThreadPool();

    private DirectYouTubeResolver() {}

    public static boolean isValidYouTubeId(String videoId) {
        return videoId != null && videoId.matches("^[A-Za-z0-9_-]{11}$");
    }

    public static ResolvedStream getCached(String videoId) {
        if (!isValidYouTubeId(videoId)) return null;
        ResolvedStream cached = CACHE.get(videoId);
        if (cached != null && !cached.isExpired()) return cached;
        if (cached != null) CACHE.remove(videoId);
        return null;
    }

    public static void prewarmAsync(String videoId) {
        if (!isValidYouTubeId(videoId) || getCached(videoId) != null) return;
        PREWARM_EXEC.submit(() -> resolve(videoId));
    }

    public static ResolvedStream resolve(String videoId) {
        return resolve(videoId, false);
    }

    public static ResolvedStream resolve(String videoId, boolean forceRefresh) {
        if (!isValidYouTubeId(videoId)) return null;
        if (!forceRefresh) {
            ResolvedStream cached = getCached(videoId);
            if (cached != null) return cached;
        }

        // Strategy 1: ANDROID client (fast progressive itag 18 MP4 + itag 140/139 M4A audio)
        ResolvedStream res = callInnerTube(videoId, false);
        if (res != null && ((res.audioUrl != null && !res.audioUrl.isEmpty()) || (res.videoUrl != null && !res.videoUrl.isEmpty()))) {
            CACHE.put(videoId, res);
            return res;
        }

        // Strategy 2: IOS client (broad music/age/geo compatibility + HLS fallback)
        ResolvedStream iosRes = callInnerTube(videoId, true);
        if (iosRes != null && ((iosRes.audioUrl != null && !iosRes.audioUrl.isEmpty()) || (iosRes.videoUrl != null && !iosRes.videoUrl.isEmpty()) || (iosRes.hlsUrl != null && !iosRes.hlsUrl.isEmpty()))) {
            CACHE.put(videoId, iosRes);
            return iosRes;
        }
        return null;
    }

    private static ResolvedStream callInnerTube(String videoId, boolean useIos) {
        HttpURLConnection conn = null;
        try {
            JSONObject client = new JSONObject();
            if (useIos) {
                client.put("clientName", "IOS");
                client.put("clientVersion", "20.10.4");
                client.put("deviceModel", "iPhone16,2");
                client.put("osName", "iPhone");
                client.put("osVersion", "18.3.2.22D82");
            } else {
                client.put("clientName", "ANDROID");
                client.put("clientVersion", "20.10.38");
                client.put("androidSdkVersion", 34);
                client.put("osName", "Android");
                client.put("osVersion", "14");
            }
            client.put("hl", "en");
            client.put("gl", "US");

            JSONObject ctx = new JSONObject().put("client", client);
            JSONObject payload = new JSONObject()
                .put("context", ctx)
                .put("videoId", videoId)
                .put("contentCheckOk", true)
                .put("racyCheckOk", true);

            String ua = useIos ? UA_IOS : UA_ANDROID;
            URL url = new URL(INNERTUBE_PLAYER_URL);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(10000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("User-Agent", ua);
            conn.setRequestProperty("X-YouTube-Client-Name", useIos ? "5" : "3");
            conn.setRequestProperty("X-YouTube-Client-Version", useIos ? "20.10.4" : "20.10.38");

            byte[] bodyBytes = payload.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(bodyBytes);
            }

            if (conn.getResponseCode() < 200 || conn.getResponseCode() >= 300) {
                return null;
            }

            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = br.readLine()) != null) sb.append(line);
            }

            JSONObject root = new JSONObject(sb.toString());
            JSONObject playStatus = root.optJSONObject("playabilityStatus");
            String status = playStatus != null ? playStatus.optString("status", "") : "";
            if (!"OK".equals(status) && !"LIVE_STREAM_OFFLINE".equals(status)) {
                Log.w(TAG, (useIos ? "IOS" : "ANDROID") + " playability=" + status + " for " + videoId);
                return null;
            }

            JSONObject vd = root.optJSONObject("videoDetails");
            String title = vd != null ? vd.optString("title", "MeTube") : "MeTube";
            String author = vd != null ? vd.optString("author", "Creator") : "Creator";
            String lenRaw = vd != null ? vd.optString("lengthSeconds", "0").replaceAll("[^0-9]", "") : "0";
            long lenSec = lenRaw.isEmpty() ? 0L : Long.parseLong(lenRaw);

            JSONObject sd = root.optJSONObject("streamingData");
            if (sd == null) return null;

            String hlsUrl = sd.optString("hlsManifestUrl", "");

            // Best progressive MP4 (muxed video + audio)
            String bestProgUrl = "";
            int bestProgScore = -1;
            JSONArray formats = sd.optJSONArray("formats");
            if (formats != null) {
                for (int i = 0; i < formats.length(); i++) {
                    JSONObject f = formats.optJSONObject(i);
                    if (f == null) continue;
                    String u = f.optString("url", "");
                    if (u.isEmpty()) continue;
                    int h = f.optInt("height", 0);
                    int br = f.optInt("bitrate", 0);
                    int score = h * 100000 + br;
                    if (score > bestProgScore) {
                        bestProgScore = score;
                        bestProgUrl = u;
                    }
                }
            }

            // Best direct audio stream (prefer M4A/AAC itag 140/139 over WebM)
            String bestAudUrl = "";
            String bestAudExt = "m4a";
            String bestAudMime = "audio/mp4";
            int bestAudScore = -1;
            JSONArray adaptive = sd.optJSONArray("adaptiveFormats");
            if (adaptive != null) {
                for (int i = 0; i < adaptive.length(); i++) {
                    JSONObject f = adaptive.optJSONObject(i);
                    if (f == null) continue;
                    String u = f.optString("url", "");
                    String mime = f.optString("mimeType", "");
                    if (u.isEmpty() || !mime.startsWith("audio/")) continue;
                    boolean isMp4 = mime.contains("audio/mp4");
                    int itag = f.optInt("itag", 0);
                    int br = f.optInt("bitrate", 0);
                    // Score boosts: audio/mp4 (+10M), itag 140 (+5M), bitrate
                    int score = (isMp4 ? 10_000_000 : 0) + (itag == 140 ? 5_000_000 : 0) + br;
                    if (score > bestAudScore) {
                        bestAudScore = score;
                        bestAudUrl = u;
                        bestAudExt = isMp4 ? "m4a" : "webm";
                        bestAudMime = isMp4 ? "audio/mp4" : "audio/webm";
                    }
                }
            }

            if (bestAudUrl.isEmpty() && !bestProgUrl.isEmpty()) {
                bestAudUrl = bestProgUrl;
                bestAudExt = "mp4";
                bestAudMime = "video/mp4";
            }
            if (bestProgUrl.isEmpty() && !hlsUrl.isEmpty()) {
                bestProgUrl = hlsUrl;
            }

            return new ResolvedStream(
                videoId, title, author, lenSec * 1000L,
                bestAudUrl, bestProgUrl, hlsUrl,
                bestAudExt, bestAudMime, ua
            );
        } catch (Exception e) {
            Log.w(TAG, (useIos ? "IOS" : "ANDROID") + " resolve failed for " + videoId + ": " + e.getMessage());
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }
}
