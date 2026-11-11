package com.anant.metube;

import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.DownloadListener;
import android.content.Intent;
import android.net.Uri;
import android.app.DownloadManager;
import android.os.Environment;
import android.webkit.URLUtil;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private long lastBackPressTime = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Intercept modern Android 13/14/15 predictive back & hardware back gestures
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                        "window.handleAndroidBack ? window.handleAndroidBack() : false;",
                        value -> {
                            // If JS returns false, user is already on Home feed with no open sheets
                            if (!"true".equals(value)) {
                                runOnUiThread(() -> {
                                    long now = System.currentTimeMillis();
                                    if (now - lastBackPressTime < 2000) {
                                        MainActivity.this.finish();
                                    } else {
                                        lastBackPressTime = now;
                                        Toast.makeText(MainActivity.this, "Press back again to exit", Toast.LENGTH_SHORT).show();
                                    }
                                });
                            }
                        }
                    );
                } else {
                    MainActivity.this.finish();
                }
            }
        });

        // Enable Chrome remote debugging (chrome://inspect)
        WebView.setWebContentsDebuggingEnabled(true);

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();

            // Allow video & audio autoplay without user gesture blocking
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setAllowFileAccess(true);

            // Expose Direct Native Download Interface to JavaScript (100% reliable)
            webView.addJavascriptInterface(new Object() {
                @android.webkit.JavascriptInterface
                public void startDownload(String url, String filename, String mimeType) {
                    runOnUiThread(() -> {
                        try {
                            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                            String safeMime = (mimeType != null && !mimeType.isEmpty()) ? mimeType : (filename != null && filename.endsWith(".mp3") ? "audio/mpeg" : "video/mp4");
                            request.setMimeType(safeMime);
                            request.setDescription("Downloading file via MeTube...");
                            String safeTitle = (filename != null && !filename.isEmpty()) ? filename : "MeTube_Media";
                            request.setTitle(safeTitle);
                            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, safeTitle);
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
                    });
                }
            }, "AndroidDownloader");

            // Native Android Download Manager listener for file downloads
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
                        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);

                        DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                        if (dm != null) {
                            dm.enqueue(request);
                        } else {
                            Intent intent = new Intent(Intent.ACTION_VIEW);
                            intent.setData(Uri.parse(url));
                            startActivity(intent);
                        }
                    } catch (Exception e) {
                        try {
                            Intent intent = new Intent(Intent.ACTION_VIEW);
                            intent.setData(Uri.parse(url));
                            startActivity(intent);
                        } catch (Exception ignored) {}
                    }
                }
            });
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // Keep timers and media playback active in background for background audio / screen lock
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().resumeTimers();
        }
    }
}
