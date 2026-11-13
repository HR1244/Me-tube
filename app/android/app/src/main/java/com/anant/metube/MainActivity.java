package com.anant.metube;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public class MainActivity extends BridgeActivity {
    private long lastBackPressTime = 0;

    // Safe area insets converted to CSS px
    private volatile int safeTopCss = 0;
    private volatile int safeBottomCss = 0;
    private volatile int safeLeftCss = 0;
    private volatile int safeRightCss = 0;

    // Hybrid media playback state synced from JS for seamless background handoff
    private volatile boolean mediaIsPlaying = false;
    private volatile boolean bgAudioEnabled = false;
    private volatile long lastPositionMs = 0L;
    private volatile long lastSyncWallClock = 0L;
    private volatile long mediaDurationMs = 0L;
    private volatile String activeVideoId = "";
    private volatile String activeTitle = "MeTube";
    private volatile String activeArtist = "Playing";
    private volatile String activeAudioUrl = "";
    private volatile String activeThumbUrl = "";
    private volatile boolean jsHasOpenOverlay = false;

    // Fullscreen HTML5 custom view support
    private View customFullscreenView = null;
    private WebChromeClient.CustomViewCallback customViewCallback = null;
    private FrameLayout fullscreenContainer = null;

    private ActivityResultLauncher<Intent> ytAuthLauncher;
    private BroadcastReceiver mediaEventReceiver;

    // In-app zero-APK OTA bundle + 1-click APK self-updater state
    private volatile String otaStatus = "idle";
    private volatile int otaPercent = 0;
    private volatile String otaMessage = "";
    private volatile boolean otaBusy = false;
    private volatile File pendingApkInstallFile = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        validateSavedOtaPath();
        // Register ActivityResultLauncher before super.onStart
        ytAuthLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                    String cookies = result.getData().getStringExtra(YouTubeAuthActivity.RESULT_COOKIES);
                    String acctName = result.getData().getStringExtra(YouTubeAuthActivity.RESULT_ACCOUNT_NAME);
                    if (cookies != null && !cookies.isEmpty()) {
                        deliverAuthCookiesToJs(cookies, acctName != null ? acctName : "YouTube Account");
                    }
                }
            }
        );

        super.onCreate(savedInstanceState);

        // Edge-to-edge dark UI styling without content collision
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat insetsController =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (insetsController != null) {
            insetsController.setAppearanceLightStatusBars(false);
            insetsController.setAppearanceLightNavigationBars(false);
        }

        // Capture accurate system bars + display cutout + 3-button navbar insets into CSS vars
        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (v, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            float density = getResources().getDisplayMetrics().density;
            if (density <= 0) density = 1f;
            safeTopCss = Math.round(bars.top / density);
            safeBottomCss = Math.round(bars.bottom / density);
            safeLeftCss = Math.round(bars.left / density);
            safeRightCss = Math.round(bars.right / density);
            pushSafeInsetsToWebView();
            return insets;
        });

        // Request Android 13+ notification permission so background player controls can show
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this,
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    1001
                );
            }
        }

        // Intercept Android back button/gesture consistently before leaving app
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (customFullscreenView != null) {
                    exitCustomFullscreen();
                    return;
                }
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                        "window.handleAndroidBack ? window.handleAndroidBack() : false;",
                        value -> runOnUiThread(() -> {
                            if (!"true".equals(value)) {
                                if (jsHasOpenOverlay) {
                                    // Avoid abrupt exit while an overlay transition is closing
                                    return;
                                }
                                long now = System.currentTimeMillis();
                                if (now - lastBackPressTime < 2200) {
                                    MainActivity.this.finish();
                                } else {
                                    lastBackPressTime = now;
                                    Toast.makeText(MainActivity.this, "Press back again to exit", Toast.LENGTH_SHORT).show();
                                }
                            }
                        })
                    );
                } else {
                    MainActivity.this.finish();
                }
            }
        });

        WebView.setWebContentsDebuggingEnabled(true);

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();

            // Disable unintended pinch zoom on mobile chrome wrapper while enabling auto playback
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setLoadWithOverviewMode(true);
            settings.setUseWideViewPort(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(true);

            // Preserve Capacitor WebChromeClient while adding true native HTML5 fullscreen support
            webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
                @Override
                public void onShowCustomView(View view, CustomViewCallback callback) {
                    runOnUiThread(() -> enterCustomFullscreen(view, callback));
                }

                @Override
                public void onHideCustomView() {
                    runOnUiThread(() -> exitCustomFullscreen());
                }
            });

            // 1. Safe-area inset & back-overlay JS bridge
            webView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public String getSafeInsets() {
                    try {
                        JSONObject o = new JSONObject();
                        o.put("top", safeTopCss);
                        o.put("bottom", safeBottomCss);
                        o.put("left", safeLeftCss);
                        o.put("right", safeRightCss);
                        return o.toString();
                    } catch (Exception e) {
                        return "{\"top\":0,\"bottom\":0,\"left\":0,\"right\":0}";
                    }
                }

                @JavascriptInterface
                public void setHasOpenOverlay(boolean open) {
                    jsHasOpenOverlay = open;
                }

                @JavascriptInterface
                public void setFullscreenOrientation(boolean landscape) {
                    runOnUiThread(() -> {
                        if (landscape) {
                            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                            WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
                            if (ic != null) {
                                ic.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                                ic.hide(WindowInsetsCompat.Type.systemBars());
                            }
                        } else {
                            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                            WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
                            if (ic != null) {
                                ic.show(WindowInsetsCompat.Type.systemBars());
                            }
                        }
                    });
                }
            }, "AndroidUI");

            // 2. Hybrid Background Media Service JS Bridge (true Android ForegroundService + MediaPlayer)
            webView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void syncState(
                    boolean isPlaying,
                    boolean bgEnabled,
                    long positionMs,
                    long durationMs,
                    String videoId,
                    String title,
                    String artist,
                    String audioUrl,
                    String thumbUrl
                ) {
                    mediaIsPlaying = isPlaying;
                    bgAudioEnabled = bgEnabled;
                    lastPositionMs = Math.max(0L, positionMs);
                    lastSyncWallClock = System.currentTimeMillis();
                    mediaDurationMs = Math.max(0L, durationMs);
                    activeVideoId = videoId != null ? videoId : "";
                    activeTitle = title != null && !title.isEmpty() ? title : "MeTube";
                    activeArtist = artist != null && !artist.isEmpty() ? artist : "Playing";
                    activeAudioUrl = audioUrl != null ? audioUrl : "";
                    activeThumbUrl = thumbUrl != null ? thumbUrl : "";

                    if ((bgEnabled || isPlaying) && DirectYouTubeResolver.isValidYouTubeId(activeVideoId)) {
                        DirectYouTubeResolver.prewarmAsync(activeVideoId);
                    }
                    if (!MediaPlaybackService.isNativeAudioActive) {
                        if (bgEnabled && isPlaying) {
                            startMediaServiceAction(MediaPlaybackService.ACTION_START_OR_UPDATE, false);
                        } else if (!bgEnabled) {
                            stopMediaService();
                        }
                    }
                }

                @JavascriptInterface
                public void playBackgroundNow(
                    String audioUrl,
                    long positionMs,
                    long durationMs,
                    String title,
                    String artist,
                    String thumbUrl
                ) {
                    activeAudioUrl = audioUrl != null ? audioUrl : "";
                    lastPositionMs = Math.max(0L, positionMs);
                    mediaDurationMs = Math.max(0L, durationMs);
                    activeTitle = title != null && !title.isEmpty() ? title : "MeTube";
                    activeArtist = artist != null && !artist.isEmpty() ? artist : "Playing";
                    activeThumbUrl = thumbUrl != null ? thumbUrl : "";
                    mediaIsPlaying = true;
                    bgAudioEnabled = true;
                    startMediaServiceAction(MediaPlaybackService.ACTION_HANDOFF_PLAY, true);
                }

                @JavascriptInterface
                public void stopService() {
                    mediaIsPlaying = false;
                    stopMediaService();
                }

                @JavascriptInterface
                public void stopNativePlayback() {
                    if (MediaPlaybackService.isNativeAudioActive) {
                        Intent ret = new Intent(MainActivity.this, MediaPlaybackService.class);
                        ret.setAction(MediaPlaybackService.ACTION_HANDOFF_RETURN);
                        startService(ret);
                    }
                }

                @JavascriptInterface
                public String getNativeStatus() {
                    try {
                        JSONObject o = new JSONObject();
                        o.put("active", MediaPlaybackService.isNativeAudioActive);
                        o.put("playing", MediaPlaybackService.isNativePlaying);
                        o.put("positionMs", MediaPlaybackService.nativePositionMs);
                        return o.toString();
                    } catch (Exception e) {
                        return "{\"active\":false,\"playing\":false,\"positionMs\":0}";
                    }
                }
            }, "AndroidMediaService");

            // 3. In-App YouTube / Google Account Auth JS Bridge (supports login + switching accounts)
            webView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void launchYouTubeLogin(boolean switchAccount) {
                    runOnUiThread(() -> {
                        Intent intent = new Intent(MainActivity.this, YouTubeAuthActivity.class);
                        intent.putExtra(YouTubeAuthActivity.EXTRA_SWITCH_ACCOUNT, switchAccount);
                        ytAuthLauncher.launch(intent);
                    });
                }

                @JavascriptInterface
                public void clearYouTubeCookies() {
                    runOnUiThread(() -> {
                        CookieManager cm = CookieManager.getInstance();
                        cm.removeAllCookies(null);
                        cm.flush();
                    });
                }
            }, "AndroidAuth");

            // 4. Direct Native In-Process Downloader Bridge with MediaExtractor audio conversion + progress polling
            webView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public long startDownload(String url, String filename, String mimeType) {
                    return startDownloadFull(url, filename, mimeType, null, false);
                }

                @JavascriptInterface
                public long startDownloadWithUa(String url, String filename, String mimeType, String customUa) {
                    return startDownloadFull(url, filename, mimeType, customUa, false);
                }

                @JavascriptInterface
                public long startDownloadFull(String url, String filename, String mimeType, String customUa, boolean extractAudio) {
                    try {
                        long id = NativeDownloadEngine.enqueue(MainActivity.this, url, filename, mimeType, customUa, extractAudio);
                        if (id > 0) return id;
                    } catch (Exception ignored) {}
                    return -1L;
                }

                @JavascriptInterface
                public String getDownloadProgress(long dmId) {
                    if (NativeDownloadEngine.handlesId(dmId)) {
                        return NativeDownloadEngine.getProgressJson(dmId);
                    }
                    JSONObject res = new JSONObject();
                    try {
                        DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                        if (dm == null || dmId <= 0) {
                            res.put("status", 0);
                            res.put("statusText", "unknown");
                            return res.toString();
                        }
                        DownloadManager.Query q = new DownloadManager.Query().setFilterById(dmId);
                        try (Cursor c = dm.query(q)) {
                            if (c != null && c.moveToFirst()) {
                                int statusIdx = c.getColumnIndex(DownloadManager.COLUMN_STATUS);
                                int reasonIdx = c.getColumnIndex(DownloadManager.COLUMN_REASON);
                                int dlIdx = c.getColumnIndex(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR);
                                int totIdx = c.getColumnIndex(DownloadManager.COLUMN_TOTAL_SIZE_BYTES);
                                int uriIdx = c.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);

                                int st = statusIdx >= 0 ? c.getInt(statusIdx) : 0;
                                int reason = reasonIdx >= 0 ? c.getInt(reasonIdx) : 0;
                                long dl = dlIdx >= 0 ? c.getLong(dlIdx) : 0;
                                long tot = totIdx >= 0 ? c.getLong(totIdx) : 0;
                                String localUri = uriIdx >= 0 ? c.getString(uriIdx) : "";

                                if (st == DownloadManager.STATUS_SUCCESSFUL && (localUri == null || localUri.isEmpty() || localUri.startsWith("file://"))) {
                                    try {
                                        Uri dmContentUri = dm.getUriForDownloadedFile(dmId);
                                        if (dmContentUri != null) localUri = dmContentUri.toString();
                                    } catch (Exception ignored) {}
                                }

                                String statusStr = "running";
                                if (st == DownloadManager.STATUS_PENDING) statusStr = "pending";
                                else if (st == DownloadManager.STATUS_SUCCESSFUL) statusStr = "successful";
                                else if (st == DownloadManager.STATUS_FAILED) statusStr = "failed";
                                else if (st == DownloadManager.STATUS_PAUSED) statusStr = "paused";

                                double pct = tot > 0 ? Math.min(100.0, (dl * 100.0 / tot)) : (st == DownloadManager.STATUS_SUCCESSFUL ? 100.0 : 0.0);
                                res.put("status", st);
                                res.put("statusText", statusStr);
                                res.put("reason", reason);
                                res.put("downloadedBytes", dl);
                                res.put("totalBytes", tot);
                                res.put("percent", Math.round(pct * 10.0) / 10.0);
                                res.put("localUri", localUri != null ? localUri : "");
                                return res.toString();
                            }
                        }
                    } catch (Exception ignored) {}
                    try {
                        res.put("status", 0);
                        res.put("statusText", "unknown");
                    } catch (Exception ignored) {}
                    return res.toString();
                }

                @JavascriptInterface
                public void openDownloadedFile(String localUri, String mimeType) {
                    runOnUiThread(() -> {
                        try {
                            if (localUri == null || localUri.isEmpty()) return;
                            Uri targetUri = Uri.parse(localUri);
                            if ("file".equalsIgnoreCase(targetUri.getScheme()) && targetUri.getPath() != null) {
                                File file = new File(targetUri.getPath());
                                if (file.exists()) {
                                    targetUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", file);
                                }
                            }
                            Intent intent = new Intent(Intent.ACTION_VIEW);
                            intent.setDataAndType(targetUri, mimeType != null && !mimeType.isEmpty() ? mimeType : "*/*");
                            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(intent);
                        } catch (Exception e) {
                            Toast.makeText(MainActivity.this, "Saved inside Downloads/MeTube folder!", Toast.LENGTH_SHORT).show();
                        }
                    });
                }
            }, "AndroidDownloader");

            // 5. In-App Zero-APK OTA Web Bundle Updater Bridge
            webView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public String getUpdateState() {
                    JSONObject obj = new JSONObject();
                    try {
                        PackageInfo pInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
                        long nativeCode = PackageInfoCompat.getLongVersionCode(pInfo);
                        String nativeName = pInfo.versionName != null ? pInfo.versionName : "1.0";

                        SharedPreferences otaPrefs = getSharedPreferences("metube_ota", MODE_PRIVATE);
                        SharedPreferences capPrefs = getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, MODE_PRIVATE);
                        String serverPath = capPrefs.getString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, "");
                        boolean usingOta = serverPath != null && !serverPath.isEmpty() && new File(serverPath, "index.html").exists();

                        obj.put("nativeVersionCode", nativeCode);
                        obj.put("nativeVersionName", nativeName);
                        obj.put("otaCode", usingOta ? otaPrefs.getInt("ota_code", 0) : 0);
                        obj.put("otaVersion", usingOta ? otaPrefs.getString("ota_version", "") : "");
                        obj.put("usingOta", usingOta);
                        obj.put("status", otaStatus);
                        obj.put("percent", otaPercent);
                        obj.put("message", otaMessage);
                    } catch (Exception ignored) {}
                    return obj.toString();
                }

                @JavascriptInterface
                public String getOtaProgress() {
                    JSONObject obj = new JSONObject();
                    try {
                        obj.put("status", otaStatus);
                        obj.put("percent", otaPercent);
                        obj.put("message", otaMessage);
                        obj.put("busy", otaBusy);
                    } catch (Exception ignored) {}
                    return obj.toString();
                }

                @JavascriptInterface
                public void notifyPageReady() {
                    runOnUiThread(() -> pushSafeInsetsToWebView());
                }

                @JavascriptInterface
                public void installOtaUpdate(String bundleUrl, int targetCode, String targetVersion, String expectedSha256) {
                    if (otaBusy || bundleUrl == null || bundleUrl.isEmpty()) return;
                    otaBusy = true;
                    otaStatus = "downloading";
                    otaPercent = 2;
                    otaMessage = "Downloading update...";
                    new Thread(() -> performOtaUpdate(bundleUrl, targetCode, targetVersion, expectedSha256)).start();
                }

                @JavascriptInterface
                public void installApkUpdate(String apkUrl, String targetVersion) {
                    if (otaBusy || apkUrl == null || apkUrl.isEmpty()) return;
                    otaBusy = true;
                    otaStatus = "downloading_apk";
                    otaPercent = 2;
                    otaMessage = "Downloading APK v" + (targetVersion != null ? targetVersion : "") + "...";
                    new Thread(() -> performApkUpdate(apkUrl, targetVersion)).start();
                }

                @JavascriptInterface
                public void resetToBundled() {
                    getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, MODE_PRIVATE)
                        .edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, "").apply();
                    getSharedPreferences("metube_ota", MODE_PRIVATE).edit().clear().apply();
                    otaStatus = "idle";
                    otaPercent = 0;
                    otaMessage = "";
                    runOnUiThread(() -> {
                        Toast.makeText(MainActivity.this, "Restored built-in app bundle", Toast.LENGTH_SHORT).show();
                        if (getBridge() != null) {
                            getBridge().setServerAssetPath("public");
                        }
                    });
                }
            }, "AndroidUpdater");

            // 6. On-Device InnerTube Resolver Bridge (runs on phone's residential IP, zero datacenter bot block)
            webView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void resolveForDownloadAsync(String callbackId, String videoId, String formatType) {
                    new Thread(() -> {
                        JSONObject out = new JSONObject();
                        try {
                            DirectYouTubeResolver.ResolvedStream res = DirectYouTubeResolver.resolve(videoId);
                            boolean wantAudio = formatType != null && (formatType.equalsIgnoreCase("mp3") || formatType.equalsIgnoreCase("audio") || formatType.equalsIgnoreCase("m4a"));
                            if (res != null) {
                                boolean isAudioCandidate = res.audioUrl != null && !res.audioUrl.isEmpty();
                                String targetUrl = wantAudio
                                    ? (isAudioCandidate ? res.audioUrl : res.videoUrl)
                                    : (res.videoUrl != null && !res.videoUrl.isEmpty() ? res.videoUrl : res.audioUrl);
                                boolean isSourceVideo = !isAudioCandidate || (res.audioMime != null && res.audioMime.startsWith("video/"));
                                boolean extractAudio = wantAudio && isSourceVideo;
                                String ext = wantAudio ? (formatType != null && formatType.equalsIgnoreCase("mp3") ? "mp3" : "m4a") : "mp4";
                                String mime = wantAudio ? (formatType != null && formatType.equalsIgnoreCase("mp3") ? "audio/mpeg" : "audio/mp4") : "video/mp4";
                                if (targetUrl != null && !targetUrl.isEmpty() && !targetUrl.contains(".m3u8")) {
                                    out.put("ok", true);
                                    out.put("url", targetUrl);
                                    out.put("audioUrl", res.audioUrl);
                                    out.put("videoUrl", res.videoUrl);
                                    out.put("ext", ext);
                                    out.put("mimeType", mime);
                                    out.put("extractAudio", extractAudio);
                                    out.put("userAgent", res.userAgent);
                                    out.put("title", res.title);
                                } else {
                                    out.put("ok", false);
                                    out.put("error", "No direct progressive stream");
                                }
                            } else {
                                out.put("ok", false);
                                out.put("error", "Resolution unavailable");
                            }
                        } catch (Exception e) {
                            try {
                                out.put("ok", false);
                                out.put("error", e.getMessage());
                            } catch (Exception ignored) {}
                        }
                        String safeCb = callbackId != null ? callbackId.replace("'", "") : "";
                        String b64 = Base64.encodeToString(out.toString().getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
                        runOnUiThread(() -> {
                            if (getBridge() != null && getBridge().getWebView() != null) {
                                getBridge().getWebView().evaluateJavascript(
                                    "window.__onNativeInnerTube && window.__onNativeInnerTube('" + safeCb + "','" + b64 + "');",
                                    null
                                );
                            }
                        });
                    }).start();
                }
            }, "AndroidInnerTube");

            webView.setDownloadListener(new DownloadListener() {
                @Override
                public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                    try {
                        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                        String filename = URLUtil.guessFileName(url, contentDisposition, mimeType);
                        request.setMimeType(mimeType);
                        request.addRequestHeader("User-Agent", userAgent);
                        request.setDescription("Downloading file...");
                        request.setTitle(filename);
                        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "MeTube/" + filename);

                        DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                        if (dm != null) {
                            dm.enqueue(request);
                        } else {
                            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                            startActivity(intent);
                        }
                    } catch (Exception e) {
                        try {
                            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                            startActivity(intent);
                        } catch (Exception ignored) {}
                    }
                }
            });

            webView.postDelayed(this::pushSafeInsetsToWebView, 400);
        }

        // Listen for lockscreen/notification media control actions from MediaPlaybackService
        mediaEventReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null) return;
                String cmd = intent.getStringExtra("command");
                long posMs = intent.getLongExtra("positionMs", 0L);
                boolean playing = intent.getBooleanExtra("isPlaying", false);
                if (cmd != null && getBridge() != null && getBridge().getWebView() != null) {
                    String safeCmd = cmd.replace("'", "");
                    getBridge().getWebView().evaluateJavascript(
                        "window.handleNativeMediaEvent && window.handleNativeMediaEvent('" + safeCmd + "'," + posMs + "," + playing + ");",
                        null
                    );
                }
            }
        };
        IntentFilter filter = new IntentFilter(MediaPlaybackService.BROADCAST_MEDIA_EVENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(mediaEventReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(mediaEventReceiver, filter);
        }

        handleIncomingIntent(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    private void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String sharedText = null;
        if (Intent.ACTION_SEND.equals(action)) {
            sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
        } else if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
            sharedText = intent.getDataString();
        }
        if (sharedText != null && !sharedText.trim().isEmpty()) {
            String trimmed = sharedText.trim();
            if (getBridge() != null && getBridge().getWebView() != null) {
                String b64 = Base64.encodeToString(trimmed.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
                getBridge().getWebView().postDelayed(() -> {
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        getBridge().getWebView().evaluateJavascript(
                            "window.handleSharedYouTubeUrlB64 && window.handleSharedYouTubeUrlB64('" + b64 + "');",
                            null
                        );
                    }
                }, 900);
            }
        }
    }

    private void pushSafeInsetsToWebView() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        String js = String.format(
            "document.documentElement.style.setProperty('--safe-top','%dpx');" +
            "document.documentElement.style.setProperty('--safe-bottom','%dpx');" +
            "document.documentElement.style.setProperty('--safe-left','%dpx');" +
            "document.documentElement.style.setProperty('--safe-right','%dpx');",
            safeTopCss, safeBottomCss, safeLeftCss, safeRightCss
        );
        getBridge().getWebView().evaluateJavascript(js, null);
    }

    private void enterCustomFullscreen(View view, WebChromeClient.CustomViewCallback callback) {
        if (customFullscreenView != null) {
            if (callback != null) callback.onCustomViewHidden();
            return;
        }
        customFullscreenView = view;
        customViewCallback = callback;

        fullscreenContainer = new FrameLayout(this);
        fullscreenContainer.setBackgroundColor(Color.BLACK);
        fullscreenContainer.addView(view, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        ViewGroup decor = (ViewGroup) getWindow().getDecorView();
        decor.addView(fullscreenContainer, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(getWindow(), decor);
        if (ic != null) {
            ic.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            ic.hide(WindowInsetsCompat.Type.systemBars());
        }
    }

    private void exitCustomFullscreen() {
        if (customFullscreenView == null) return;
        ViewGroup decor = (ViewGroup) getWindow().getDecorView();
        if (fullscreenContainer != null) {
            decor.removeView(fullscreenContainer);
            fullscreenContainer = null;
        }
        customFullscreenView = null;
        if (customViewCallback != null) {
            try { customViewCallback.onCustomViewHidden(); } catch (Exception ignored) {}
            customViewCallback = null;
        }
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        WindowInsetsControllerCompat ic = WindowCompat.getInsetsController(getWindow(), decor);
        if (ic != null) {
            ic.show(WindowInsetsCompat.Type.systemBars());
        }
    }

    private void deliverAuthCookiesToJs(String cookies, String acctName) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        try {
            JSONObject obj = new JSONObject();
            obj.put("cookies", cookies);
            obj.put("account_name", acctName);
            String b64 = Base64.encodeToString(obj.toString().getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
            getBridge().getWebView().evaluateJavascript(
                "window.handleNativeYouTubeLoginB64 && window.handleNativeYouTubeLoginB64('" + b64 + "');",
                null
            );
        } catch (Exception ignored) {}
    }

    private void startMediaServiceAction(String action, boolean isHandoff) {
        Intent svc = new Intent(this, MediaPlaybackService.class);
        svc.setAction(action);
        svc.putExtra("videoId", activeVideoId);
        svc.putExtra("title", activeTitle);
        svc.putExtra("artist", activeArtist);
        svc.putExtra("artwork", activeThumbUrl);
        svc.putExtra("streamUrl", activeAudioUrl);

        // Wall-clock position extrapolation: guarantees 1ms-accurate positioning with zero backward repeats or lag
        long posToSend = lastPositionMs;
        if (mediaIsPlaying && lastSyncWallClock > 0) {
            long elapsed = System.currentTimeMillis() - lastSyncWallClock;
            if (elapsed > 0 && elapsed < 30000) {
                posToSend = lastPositionMs + elapsed;
            }
        }
        svc.putExtra("positionMs", posToSend);
        svc.putExtra("durationMs", mediaDurationMs);
        svc.putExtra("isPlaying", isHandoff || mediaIsPlaying);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(svc);
            } else {
                startService(svc);
            }
        } catch (Exception ignored) {
            try { startService(svc); } catch (Exception ignored2) {}
        }
    }

    private void stopMediaService() {
        MediaPlaybackService.stopImmediately();
        try {
            Intent svc = new Intent(this, MediaPlaybackService.class);
            svc.setAction(MediaPlaybackService.ACTION_STOP);
            startService(svc);
        } catch (Exception ignored) {}
        try {
            Intent svc = new Intent(this, MediaPlaybackService.class);
            stopService(svc);
        } catch (Exception ignored) {}
    }

    @Override
    public void onPause() {
        super.onPause();
        if (bgAudioEnabled && mediaIsPlaying) {
            // Keep WebView actively running so audio continues uninterrupted with ZERO pause/delay!
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().onResume();
            }
            startMediaServiceAction(MediaPlaybackService.ACTION_START_OR_UPDATE, false);
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        if (bgAudioEnabled && mediaIsPlaying) {
            // Maintain active WebView execution while device is locked or minimized
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().onResume();
            }
            startMediaServiceAction(MediaPlaybackService.ACTION_START_OR_UPDATE, false);
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        pushSafeInsetsToWebView();
        if (pendingApkInstallFile != null && pendingApkInstallFile.exists()) {
            boolean canInstall = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls();
            if (canInstall) {
                File f = pendingApkInstallFile;
                pendingApkInstallFile = null;
                launchApkInstaller(f);
            }
        }
        if (MediaPlaybackService.isNativeAudioActive) {
            long nativePos = MediaPlaybackService.nativePositionMs;
            boolean nativePlaying = MediaPlaybackService.isNativePlaying;
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(
                    "window.resumeWebMediaFromNative && window.resumeWebMediaFromNative(" + nativePos + "," + nativePlaying + ");",
                    null
                );
            }
        }
    }

    private void validateSavedOtaPath() {
        try {
            PackageInfo pInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
            long nativeCode = PackageInfoCompat.getLongVersionCode(pInfo);
            SharedPreferences otaPrefs = getSharedPreferences("metube_ota", MODE_PRIVATE);
            long savedNativeCode = otaPrefs.getLong("ota_native_code", -1L);
            SharedPreferences capPrefs = getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, MODE_PRIVATE);
            String path = capPrefs.getString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, "");
            if (path != null && !path.isEmpty()) {
                File idx = new File(path, "index.html");
                // If a newer native APK was installed, clear older OTA override so the APK's bundled UI loads
                if (!idx.exists() || idx.length() == 0 || (savedNativeCode >= 0 && nativeCode > savedNativeCode)) {
                    capPrefs.edit().putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, "").apply();
                    if (savedNativeCode >= 0 && nativeCode > savedNativeCode) {
                        otaPrefs.edit().clear().apply();
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    private HttpURLConnection openUpdaterUrlWithRedirects(String urlStr) throws Exception {
        String curr = urlStr;
        for (int hop = 0; hop <= 6; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(curr).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(45000);
            c.setRequestProperty("User-Agent", "MeTube-Updater/2.0");
            int code = c.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null || loc.isEmpty()) throw new RuntimeException("Empty redirect");
                curr = new URL(new URL(curr), loc).toString();
                continue;
            }
            return c;
        }
        throw new RuntimeException("Too many redirects");
    }

    private void performApkUpdate(String apkUrl, String targetVersion) {
        File updatesDir = new File(getCacheDir(), "updates");
        File apkFile = new File(updatesDir, "MeTube-update.apk");
        HttpURLConnection conn = null;
        try {
            if (!updatesDir.exists()) updatesDir.mkdirs();
            if (apkFile.exists()) apkFile.delete();

            conn = openUpdaterUrlWithRedirects(apkUrl);
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new RuntimeException("HTTP " + code);
            }

            long total = conn.getContentLengthLong();
            long downloaded = 0L;
            byte[] buf = new byte[32768];
            try (InputStream in = new BufferedInputStream(conn.getInputStream());
                 FileOutputStream fos = new FileOutputStream(apkFile)) {
                int read;
                while ((read = in.read(buf)) != -1) {
                    fos.write(buf, 0, read);
                    downloaded += read;
                    if (total > 0) {
                        otaPercent = Math.min(99, Math.max(4, (int) ((downloaded * 95L) / total)));
                    } else {
                        otaPercent = Math.min(92, otaPercent + 1);
                    }
                    otaMessage = String.format(java.util.Locale.US, "Downloading APK... %.1f MB", downloaded / (1024.0 * 1024.0));
                }
            }

            if (!apkFile.exists() || apkFile.length() < 100_000) {
                throw new IllegalStateException("Downloaded APK is incomplete");
            }

            otaPercent = 100;
            otaBusy = false;
            runOnUiThread(() -> launchApkInstaller(apkFile));
        } catch (Exception e) {
            otaStatus = "error";
            otaMessage = e.getMessage() != null ? e.getMessage() : "APK download failed";
            otaBusy = false;
            if (apkFile.exists()) apkFile.delete();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void launchApkInstaller(File apkFile) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
                pendingApkInstallFile = apkFile;
                otaStatus = "permission";
                otaMessage = "Allow 'Install unknown apps' to finish updating";
                Toast.makeText(this, "Enable 'Allow from this source' for MeTube to install the update", Toast.LENGTH_LONG).show();
                Intent permIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(permIntent);
                return;
            }
            otaStatus = "apk_ready";
            otaMessage = "Opening Android installer...";
            Uri apkUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", apkFile);
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(installIntent);
        } catch (Exception e) {
            otaStatus = "error";
            otaMessage = e.getMessage() != null ? e.getMessage() : "Could not launch installer";
        }
    }

    private void performOtaUpdate(String bundleUrl, int targetCode, String targetVersion, String expectedSha256) {
        File tmpZip = new File(getCacheDir(), "ota_bundle_tmp.zip");
        File otaRoot = new File(getFilesDir(), "ota_web");
        File stageDir = new File(otaRoot, "v_" + targetCode + "_stage");
        File finalDir = new File(otaRoot, "v_" + targetCode);
        HttpURLConnection conn = null;
        try {
            if (!otaRoot.exists()) otaRoot.mkdirs();
            if (tmpZip.exists()) tmpZip.delete();
            deleteRecursive(stageDir);

            conn = openUpdaterUrlWithRedirects(bundleUrl);
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new RuntimeException("HTTP " + code);
            }

            long total = conn.getContentLengthLong();
            long downloaded = 0;
            byte[] buf = new byte[16384];
            try (InputStream in = new BufferedInputStream(conn.getInputStream());
                 FileOutputStream fos = new FileOutputStream(tmpZip)) {
                int read;
                while ((read = in.read(buf)) != -1) {
                    fos.write(buf, 0, read);
                    downloaded += read;
                    if (total > 0) {
                        otaPercent = Math.min(80, Math.max(5, (int) ((downloaded * 80L) / total)));
                    } else {
                        otaPercent = Math.min(75, otaPercent + 2);
                    }
                }
            }

            if (expectedSha256 != null && !expectedSha256.trim().isEmpty()) {
                otaStatus = "verifying";
                otaPercent = 84;
                otaMessage = "Verifying package...";
                String actualSha = computeSha256Hex(tmpZip);
                if (!expectedSha256.trim().equalsIgnoreCase(actualSha)) {
                    throw new SecurityException("Update checksum mismatch");
                }
            }

            otaStatus = "extracting";
            otaPercent = 90;
            otaMessage = "Installing update...";
            extractZipSafe(tmpZip, stageDir);

            File indexFile = new File(stageDir, "index.html");
            if (!indexFile.exists() || indexFile.length() == 0) {
                throw new IllegalStateException("Update missing index.html");
            }

            deleteRecursive(finalDir);
            if (!stageDir.renameTo(finalDir)) {
                throw new IllegalStateException("Could not finalize OTA directory");
            }

            // Persist for future cold launches via Capacitor's built-in CAP_SERVER_PATH
            getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, finalDir.getAbsolutePath())
                .apply();
            long curNativeCode = 1L;
            try {
                curNativeCode = PackageInfoCompat.getLongVersionCode(getPackageManager().getPackageInfo(getPackageName(), 0));
            } catch (Exception ignored) {}
            getSharedPreferences("metube_ota", MODE_PRIVATE)
                .edit()
                .putInt("ota_code", targetCode)
                .putLong("ota_native_code", curNativeCode)
                .putString("ota_version", targetVersion != null ? targetVersion : "")
                .apply();

            // Clean up older OTA directories
            File[] siblings = otaRoot.listFiles();
            if (siblings != null) {
                for (File f : siblings) {
                    if (f.isDirectory() && !f.getName().equals(finalDir.getName())) {
                        deleteRecursive(f);
                    }
                }
            }
            if (tmpZip.exists()) tmpZip.delete();

            otaStatus = "ready";
            otaPercent = 100;
            otaMessage = "Updated to v" + (targetVersion != null ? targetVersion : targetCode);
            otaBusy = false;

            runOnUiThread(() -> {
                Toast.makeText(
                    MainActivity.this,
                    "MeTube updated to v" + (targetVersion != null ? targetVersion : String.valueOf(targetCode)) + "!",
                    Toast.LENGTH_SHORT
                ).show();
                if (getBridge() != null) {
                    getBridge().setServerBasePath(finalDir.getAbsolutePath());
                }
            });
        } catch (Exception e) {
            otaStatus = "error";
            otaMessage = e.getMessage() != null ? e.getMessage() : "Update failed";
            otaBusy = false;
            deleteRecursive(stageDir);
            if (tmpZip.exists()) tmpZip.delete();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String computeSha256Hex(File file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] buf = new byte[16384];
        try (InputStream is = new FileInputStream(file)) {
            int r;
            while ((r = is.read(buf)) != -1) {
                md.update(buf, 0, r);
            }
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private static void extractZipSafe(File zipFile, File destDir) throws Exception {
        if (!destDir.exists()) destDir.mkdirs();
        String destCanonical = destDir.getCanonicalPath() + File.separator;
        byte[] buf = new byte[16384];
        try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(new FileInputStream(zipFile)))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                String name = entry.getName().replace("\\", "/");
                while (name.startsWith("/")) name = name.substring(1);
                if (name.startsWith("dist/")) name = name.substring(5);
                else if (name.startsWith("public/")) name = name.substring(7);
                if (name.isEmpty()) continue;

                File outFile = new File(destDir, name);
                String outCanonical = outFile.getCanonicalPath();
                if (!outCanonical.startsWith(destCanonical)) {
                    throw new SecurityException("Blocked invalid zip entry: " + name);
                }

                if (entry.isDirectory()) {
                    outFile.mkdirs();
                } else {
                    File parent = outFile.getParentFile();
                    if (parent != null && !parent.exists()) parent.mkdirs();
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        int r;
                        while ((r = zis.read(buf)) != -1) {
                            fos.write(buf, 0, r);
                        }
                    }
                }
                zis.closeEntry();
            }
        }
    }

    private static void deleteRecursive(File target) {
        if (target == null || !target.exists()) return;
        if (target.isDirectory()) {
            File[] children = target.listFiles();
            if (children != null) {
                for (File c : children) deleteRecursive(c);
            }
        }
        target.delete();
    }

    @Override
    public void onDestroy() {
        if (mediaEventReceiver != null) {
            try { unregisterReceiver(mediaEventReceiver); } catch (Exception ignored) {}
        }
        stopMediaService();
        super.onDestroy();
    }
}
