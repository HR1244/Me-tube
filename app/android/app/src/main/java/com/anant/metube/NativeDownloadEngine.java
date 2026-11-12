package com.anant.metube;

import android.app.DownloadManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

/**
 * In-process native downloader + on-device MediaExtractor AAC->M4A extractor + Scoped Storage writer.
 * Runs inside the app process so IP-bound YouTube CDN URLs match DirectYouTubeResolver's IP stack
 * and avoids OS DownloadManager 403 / 1001 scoped-storage errors.
 */
public final class NativeDownloadEngine {
    private static final String TAG = "NativeDownloadEngine";
    private static final String DL_CHANNEL_ID = "metube_downloads_ch";
    private static final String DEFAULT_UA =
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36";

    private static final AtomicLong NEXT_ID = new AtomicLong(900_000_000L);
    private static final ConcurrentHashMap<Long, TaskState> TASKS = new ConcurrentHashMap<>();
    private static final ExecutorService EXEC = Executors.newFixedThreadPool(3);

    public static final class TaskState {
        public volatile int status = DownloadManager.STATUS_PENDING;
        public volatile long downloadedBytes = 0L;
        public volatile long totalBytes = 0L;
        public volatile String localUri = "";
        public volatile String mimeType = "video/mp4";
        public volatile String filename = "MeTube_Media.mp4";
        public volatile String error = "";
    }

    private NativeDownloadEngine() {}

    public static long enqueue(
        Context ctx,
        String url,
        String filename,
        String mimeType,
        String customUa,
        boolean extractAudio
    ) {
        if (ctx == null || url == null || url.isEmpty()) return -1L;
        final Context appCtx = ctx.getApplicationContext();
        ensureChannel(appCtx);

        long id = NEXT_ID.getAndIncrement();
        TaskState st = new TaskState();
        String lower = filename != null ? filename.toLowerCase() : "";
        String safeMime = (mimeType != null && !mimeType.isEmpty())
            ? mimeType
            : (lower.endsWith(".mp3") ? "audio/mpeg" : (lower.endsWith(".m4a") ? "audio/mp4" : "video/mp4"));
        st.mimeType = safeMime;
        st.filename = sanitizeFilename(filename, extractAudio ? "MeTube_Audio.m4a" : "MeTube_Video.mp4");
        TASKS.put(id, st);

        EXEC.submit(() -> runDownload(appCtx, id, st, url, customUa, extractAudio));
        return id;
    }

    public static boolean handlesId(long id) {
        return TASKS.containsKey(id);
    }

    public static String getProgressJson(long id) {
        JSONObject res = new JSONObject();
        try {
            TaskState st = TASKS.get(id);
            if (st == null) {
                res.put("status", 0);
                res.put("statusText", "unknown");
                return res.toString();
            }
            int code = st.status;
            String text = "running";
            if (code == DownloadManager.STATUS_PENDING) text = "pending";
            else if (code == DownloadManager.STATUS_SUCCESSFUL) text = "successful";
            else if (code == DownloadManager.STATUS_FAILED) text = "failed";
            else if (code == DownloadManager.STATUS_PAUSED) text = "paused";

            double pct = st.totalBytes > 0
                ? Math.min(100.0, (st.downloadedBytes * 100.0 / st.totalBytes))
                : (code == DownloadManager.STATUS_SUCCESSFUL ? 100.0 : 0.0);

            res.put("status", code);
            res.put("statusText", text);
            res.put("reason", 0);
            res.put("downloadedBytes", st.downloadedBytes);
            res.put("totalBytes", st.totalBytes);
            res.put("percent", Math.round(pct * 10.0) / 10.0);
            res.put("localUri", st.localUri != null ? st.localUri : "");
            res.put("mimeType", st.mimeType != null ? st.mimeType : "video/mp4");
            if (st.error != null && !st.error.isEmpty()) res.put("error", st.error);
            return res.toString();
        } catch (Exception ignored) {}
        return "{\"status\":0,\"statusText\":\"unknown\"}";
    }

    private static void runDownload(
        Context ctx,
        long id,
        TaskState st,
        String startUrl,
        String customUa,
        boolean extractAudio
    ) {
        File tmpIn = new File(ctx.getCacheDir(), "metube_dl_" + id + ".tmp");
        File tmpM4a = new File(ctx.getCacheDir(), "metube_aud_" + id + ".m4a");
        HttpURLConnection conn = null;
        try {
            st.status = DownloadManager.STATUS_RUNNING;
            String ua = (customUa != null && !customUa.isEmpty()) ? customUa : DEFAULT_UA;
            conn = openWithRedirects(startUrl, ua, 5);
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new IllegalStateException("HTTP " + code);
            }

            long cl = conn.getContentLengthLong();
            if (cl > 0) st.totalBytes = cl;

            long lastNotifAt = 0L;
            try (InputStream is = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(tmpIn)) {
                byte[] buf = new byte[32768];
                long downloaded = 0L;
                int r;
                while ((r = is.read(buf)) != -1) {
                    fos.write(buf, 0, r);
                    downloaded += r;
                    st.downloadedBytes = downloaded;
                    long now = System.currentTimeMillis();
                    if (now - lastNotifAt > 650) {
                        lastNotifAt = now;
                        int pct = st.totalBytes > 0 ? (int) Math.min(99, (downloaded * 100L) / st.totalBytes) : 0;
                        postNotification(ctx, id, st.filename, "Downloading... " + (st.totalBytes > 0 ? pct + "%" : formatMb(downloaded)), pct, true, null);
                    }
                }
                fos.flush();
            }

            if (!tmpIn.exists() || tmpIn.length() == 0) {
                throw new IllegalStateException("Empty download stream");
            }

            File sourceFile = tmpIn;
            String outName = st.filename;
            String outMime = st.mimeType;

            if (extractAudio) {
                postNotification(ctx, id, outName, "Converting audio track...", 97, true, null);
                if (extractAudioToM4a(tmpIn, tmpM4a) && tmpM4a.exists() && tmpM4a.length() > 1024) {
                    sourceFile = tmpM4a;
                    outMime = "audio/mp4";
                    outName = replaceExtension(outName, ".m4a");
                } else {
                    outMime = "video/mp4";
                    outName = replaceExtension(outName, ".mp4");
                }
            }

            st.filename = outName;
            st.mimeType = outMime;
            String savedUri = saveToPublicDownloads(ctx, sourceFile, outName, outMime);
            st.localUri = savedUri != null ? savedUri : "";
            long finalLen = sourceFile.length();
            st.downloadedBytes = finalLen;
            st.totalBytes = finalLen;
            st.status = DownloadManager.STATUS_SUCCESSFUL;

            postNotification(ctx, id, outName, "Saved to Downloads/MeTube", 100, false, st.localUri);
        } catch (Exception e) {
            Log.e(TAG, "Download " + id + " failed: " + e.getMessage(), e);
            st.error = e.getMessage() != null ? e.getMessage() : "Download error";
            st.status = DownloadManager.STATUS_FAILED;
            postNotification(ctx, id, st.filename, "Download failed: " + st.error, 0, false, null);
        } finally {
            if (conn != null) conn.disconnect();
            if (tmpIn.exists()) tmpIn.delete();
            if (tmpM4a.exists()) tmpM4a.delete();
        }
    }

    private static HttpURLConnection openWithRedirects(String urlStr, String ua, int maxHops) throws Exception {
        String curr = urlStr;
        for (int hop = 0; hop <= maxHops; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(curr).openConnection();
            c.setRequestMethod("GET");
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", ua);
            int code = c.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null || loc.isEmpty()) throw new IllegalStateException("Empty redirect");
                curr = new URL(new URL(curr), loc).toString();
                continue;
            }
            return c;
        }
        throw new IllegalStateException("Too many redirects");
    }

    private static boolean extractAudioToM4a(File inputMp4, File outM4a) {
        MediaExtractor extractor = null;
        MediaMuxer muxer = null;
        try {
            extractor = new MediaExtractor();
            extractor.setDataSource(inputMp4.getAbsolutePath());
            int trackIndex = -1;
            MediaFormat audioFormat = null;
            int count = extractor.getTrackCount();
            for (int i = 0; i < count; i++) {
                MediaFormat fmt = extractor.getTrackFormat(i);
                String mime = fmt.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    trackIndex = i;
                    audioFormat = fmt;
                    break;
                }
            }
            if (trackIndex < 0 || audioFormat == null) return false;

            extractor.selectTrack(trackIndex);
            muxer = new MediaMuxer(outM4a.getAbsolutePath(), MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
            int outTrack = muxer.addTrack(audioFormat);
            muxer.start();

            int bufSize = 256 * 1024;
            try {
                if (audioFormat.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                    bufSize = Math.max(bufSize, audioFormat.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE));
                }
            } catch (Exception ignored) {}

            ByteBuffer buffer = ByteBuffer.allocate(bufSize);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            while (true) {
                int sampleSize = extractor.readSampleData(buffer, 0);
                if (sampleSize < 0) break;
                info.offset = 0;
                info.size = sampleSize;
                info.presentationTimeUs = Math.max(0L, extractor.getSampleTime());
                info.flags = (extractor.getSampleFlags() & MediaExtractor.SAMPLE_FLAG_SYNC) != 0
                    ? MediaCodec.BUFFER_FLAG_KEY_FRAME
                    : 0;
                muxer.writeSampleData(outTrack, buffer, info);
                extractor.advance();
            }
            muxer.stop();
            return true;
        } catch (Exception e) {
            Log.w(TAG, "Audio mux extraction fallback to MP4: " + e.getMessage());
            return false;
        } finally {
            if (muxer != null) {
                try { muxer.release(); } catch (Exception ignored) {}
            }
            if (extractor != null) {
                try { extractor.release(); } catch (Exception ignored) {}
            }
        }
    }

    private static String saveToPublicDownloads(Context ctx, File sourceFile, String displayName, String mimeType) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = ctx.getContentResolver();
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
            cv.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
            cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/MeTube");
            cv.put(MediaStore.MediaColumns.IS_PENDING, 1);

            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
            if (uri == null) {
                throw new IllegalStateException("MediaStore insert failed");
            }
            try (FileInputStream fis = new FileInputStream(sourceFile); OutputStream os = resolver.openOutputStream(uri)) {
                if (os == null) throw new IllegalStateException("MediaStore stream open failed");
                byte[] buf = new byte[32768];
                int r;
                while ((r = fis.read(buf)) != -1) {
                    os.write(buf, 0, r);
                }
                os.flush();
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            return uri.toString();
        }

        File dlDir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "MeTube");
        if (!dlDir.exists()) dlDir.mkdirs();
        File dest = new File(dlDir, displayName);
        if (dest.exists()) {
            dest = new File(dlDir, System.currentTimeMillis() + "_" + displayName);
        }
        try (FileInputStream fis = new FileInputStream(sourceFile); FileOutputStream fos = new FileOutputStream(dest)) {
            byte[] buf = new byte[32768];
            int r;
            while ((r = fis.read(buf)) != -1) {
                fos.write(buf, 0, r);
            }
            fos.flush();
        }
        MediaScannerConnection.scanFile(ctx, new String[]{dest.getAbsolutePath()}, new String[]{mimeType}, null);
        return Uri.fromFile(dest).toString();
    }

    private static String sanitizeFilename(String raw, String fallback) {
        String name = (raw != null && !raw.trim().isEmpty()) ? raw.trim() : fallback;
        name = name.replaceAll("[<>:\"/\\\\|?*\\x00-\\x1F]", "_").replaceAll("\\s+", " ").trim();
        if (name.isEmpty()) name = fallback;
        if (name.length() > 80) {
            int dot = name.lastIndexOf('.');
            String ext = (dot > 0 && dot > name.length() - 8) ? name.substring(dot) : "";
            name = name.substring(0, Math.max(10, 76 - ext.length())) + ext;
        }
        return name;
    }

    private static String replaceExtension(String filename, String newExt) {
        int dot = filename.lastIndexOf('.');
        if (dot > 0 && dot > filename.length() - 8) {
            return filename.substring(0, dot) + newExt;
        }
        return filename + newExt;
    }

    private static String formatMb(long bytes) {
        return String.format(java.util.Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0));
    }

    private static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(DL_CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(DL_CHANNEL_ID, "MeTube Downloads", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Shows file download progress in MeTube");
                nm.createNotificationChannel(ch);
            }
        }
    }

    private static void postNotification(
        Context ctx,
        long id,
        String title,
        String text,
        int progress,
        boolean ongoing,
        String openUri
    ) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            Intent intent = new Intent(ctx, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            if (openUri != null && !openUri.isEmpty()) {
                intent.putExtra("open_tab", "downloads");
            }
            int notifId = (int) (80000 + (id % 10000));
            PendingIntent pi = PendingIntent.getActivity(ctx, notifId, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Notification.Builder nb = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                ? new Notification.Builder(ctx, DL_CHANNEL_ID)
                : new Notification.Builder(ctx);
            nb.setSmallIcon(ongoing ? android.R.drawable.stat_sys_download : android.R.drawable.stat_sys_download_done)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(pi)
                .setOnlyAlertOnce(true)
                .setOngoing(ongoing)
                .setAutoCancel(!ongoing);
            if (ongoing) {
                nb.setProgress(100, Math.max(0, Math.min(100, progress)), progress <= 0);
            }
            nm.notify(notifId, nb.build());
        } catch (Exception ignored) {}
    }
}
