package com.anant.metube;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
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
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;

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

    @Override
    public void onCreate(Bundle savedInstanceState) {
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
                    mediaDurationMs = Math.max(0L, durationMs);
                    activeVideoId = videoId != null ? videoId : "";
                    activeTitle = title != null && !title.isEmpty() ? title : "MeTube";
                    activeArtist = artist != null && !artist.isEmpty() ? artist : "Playing";
                    activeAudioUrl = audioUrl != null ? audioUrl : "";
                    activeThumbUrl = thumbUrl != null ? thumbUrl : "";

                    if (bgEnabled && isPlaying) {
                        startMediaServiceAction(MediaPlaybackService.ACTION_START_OR_UPDATE, false);
                    } else if (!bgEnabled && !MediaPlaybackService.isNativeAudioActive) {
                        stopMediaService();
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

            // 4. Direct Native DownloadManager JS Bridge with real byte-level progress polling
            webView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public long startDownload(String url, String filename, String mimeType) {
                    try {
                        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                        String lower = filename != null ? filename.toLowerCase() : "";
                        String safeMime = (mimeType != null && !mimeType.isEmpty())
                            ? mimeType
                            : (lower.endsWith(".mp3") ? "audio/mpeg" : (lower.endsWith(".m4a") ? "audio/mp4" : "video/mp4"));
                        request.setMimeType(safeMime);
                        request.setDescription("Downloading to phone storage via MeTube");
                        request.addRequestHeader("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 MeTube/2.0");
                        String safeTitle = (filename != null && !filename.isEmpty())
                            ? filename.replaceAll("[^a-zA-Z0-9._-]", "_")
                            : "MeTube_Media.mp4";
                        request.setTitle(safeTitle);
                        request.setAllowedOverMetered(true);
                        request.setAllowedOverRoaming(true);
                        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        try {
                            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "MeTube/" + safeTitle);
                        } catch (Exception subEx) {
                            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, safeTitle);
                        }
                        DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                        if (dm != null) {
                            return dm.enqueue(request);
                        }
                    } catch (Exception e) {
                        runOnUiThread(() -> {
                            try {
                                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                                startActivity(intent);
                            } catch (Exception ignored) {}
                        });
                    }
                    return -1L;
                }

                @JavascriptInterface
                public String getDownloadProgress(long dmId) {
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
        svc.putExtra("title", activeTitle);
        svc.putExtra("artist", activeArtist);
        svc.putExtra("artwork", activeThumbUrl);
        svc.putExtra("streamUrl", activeAudioUrl);
        svc.putExtra("positionMs", lastPositionMs);
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
        Intent svc = new Intent(this, MediaPlaybackService.class);
        svc.setAction(MediaPlaybackService.ACTION_STOP);
        try {
            stopService(svc);
        } catch (Exception ignored) {}
    }

    @Override
    public void onPause() {
        super.onPause();
        if (bgAudioEnabled && mediaIsPlaying && !activeAudioUrl.isEmpty()) {
            // Seamlessly hand audio playback over to OS-level MediaPlaybackService
            startMediaServiceAction(MediaPlaybackService.ACTION_HANDOFF_PLAY, true);
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().evaluateJavascript(
                    "window.pauseWebMediaForNativeHandoff && window.pauseWebMediaForNativeHandoff();",
                    null
                );
                getBridge().getWebView().resumeTimers();
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        pushSafeInsetsToWebView();
        if (MediaPlaybackService.isNativeAudioActive) {
            long nativePos = MediaPlaybackService.nativePositionMs;
            boolean nativePlaying = MediaPlaybackService.isNativePlaying;
            Intent ret = new Intent(this, MediaPlaybackService.class);
            ret.setAction(MediaPlaybackService.ACTION_HANDOFF_RETURN);
            startService(ret);
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().postDelayed(() ->
                    getBridge().getWebView().evaluateJavascript(
                        "window.resumeWebMediaFromNative && window.resumeWebMediaFromNative(" + nativePos + "," + nativePlaying + ");",
                        null
                    ),
                120);
            }
        }
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
