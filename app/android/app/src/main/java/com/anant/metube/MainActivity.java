package com.anant.metube;

import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebSettings;
import android.webkit.DownloadListener;
import android.webkit.CookieManager;
import android.webkit.WebViewClient;
import android.content.Intent;
import android.net.Uri;
import android.app.Dialog;
import android.app.DownloadManager;
import android.os.Environment;
import android.webkit.URLUtil;
import android.widget.LinearLayout;
import android.widget.Button;
import android.widget.Toast;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Enable Chrome remote debugging (chrome://inspect)
        WebView.setWebContentsDebuggingEnabled(true);

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();

            // Allow video autoplay without user gesture blocking
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

            // Expose Direct In-App 1-Tap Google / YouTube Sign-In Bridge
            webView.addJavascriptInterface(new Object() {
                @android.webkit.JavascriptInterface
                public void launchYouTubeLogin() {
                    runOnUiThread(() -> {
                        try {
                            Dialog dialog = new Dialog(MainActivity.this, android.R.style.Theme_NoTitleBar_Fullscreen);

                            LinearLayout root = new LinearLayout(MainActivity.this);
                            root.setOrientation(LinearLayout.VERTICAL);
                            root.setBackgroundColor(0xFF0F0F0F);

                            // Simple clean header bar
                            Button closeBtn = new Button(MainActivity.this);
                            closeBtn.setText("✕ Cancel / Close");
                            closeBtn.setTextColor(0xFFFF4444);
                            closeBtn.setBackgroundColor(0xFF1E1E1E);
                            closeBtn.setTextSize(14);
                            closeBtn.setOnClickListener(v -> dialog.dismiss());
                            root.addView(closeBtn);

                            // Login WebView
                            WebView authView = new WebView(MainActivity.this);
                            authView.setLayoutParams(new LinearLayout.LayoutParams(
                                LinearLayout.LayoutParams.MATCH_PARENT,
                                LinearLayout.LayoutParams.MATCH_PARENT
                            ));
                            WebSettings ws = authView.getSettings();
                            ws.setJavaScriptEnabled(true);
                            ws.setDomStorageEnabled(true);
                            ws.setDatabaseEnabled(true);
                            // Mobile Chrome User-Agent so Google allows login
                            ws.setUserAgentString("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36");

                            authView.setWebViewClient(new WebViewClient() {
                                private boolean captured = false;

                                @Override
                                public void onPageFinished(WebView view, String url) {
                                    super.onPageFinished(view, url);
                                    if (captured) return;

                                    CookieManager cm = CookieManager.getInstance();
                                    String cookieStr = cm.getCookie("https://youtube.com");
                                    if (cookieStr == null || cookieStr.isEmpty()) {
                                        cookieStr = cm.getCookie(url);
                                    }

                                    if (cookieStr != null && (cookieStr.contains("SAPISID") || cookieStr.contains("LOGIN_INFO") || cookieStr.contains("SID="))) {
                                        captured = true;
                                        final String b64 = Base64.encodeToString(cookieStr.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
                                        runOnUiThread(() -> {
                                            if (getBridge() != null && getBridge().getWebView() != null) {
                                                String js = "if (window.handleNativeYouTubeLoginB64) { window.handleNativeYouTubeLoginB64('" + b64 + "'); }";
                                                getBridge().getWebView().evaluateJavascript(js, null);
                                            }
                                            Toast.makeText(MainActivity.this, "YouTube Account Connected!", Toast.LENGTH_SHORT).show();
                                            dialog.dismiss();
                                        });
                                    }
                                }
                            });

                            authView.loadUrl("https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fm.youtube.com%2F");
                            root.addView(authView);
                            dialog.setContentView(root);
                            dialog.show();
                        } catch (Exception e) {
                            Toast.makeText(MainActivity.this, "Could not open sign-in: " + e.getMessage(), Toast.LENGTH_LONG).show();
                        }
                    });
                }

                @android.webkit.JavascriptInterface
                public boolean isNativeAuthAvailable() {
                    return true;
                }
            }, "AndroidAuth");

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

        handleIncomingIntent(getIntent());
    }

    @Override
    protected void onResume() {
        super.onResume();
        handleIncomingIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    private void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();

        String target = null;
        if (Intent.ACTION_SEND.equals(action) && "text/plain".equals(type)) {
            target = intent.getStringExtra(Intent.EXTRA_TEXT);
        } else if (Intent.ACTION_VIEW.equals(action)) {
            Uri data = intent.getData();
            if (data != null) {
                target = data.toString();
            }
        }

        if (target != null && !target.isEmpty()) {
            final String b64 = Base64.encodeToString(target.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().postDelayed(() -> {
                    String js = "if (window.handleSharedYouTubeUrlB64) { window.handleSharedYouTubeUrlB64('" + b64 + "'); }";
                    getBridge().getWebView().evaluateJavascript(js, null);
                }, 1200);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().evaluateJavascript("window.handleAndroidBack ? window.handleAndroidBack() : false;", value -> {
                if (!"true".equals(value)) {
                    MainActivity.super.onBackPressed();
                }
            });
        } else {
            super.onBackPressed();
        }
    }
}
