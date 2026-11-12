package com.anant.metube;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

public class YouTubeAuthActivity extends AppCompatActivity {
    public static final String EXTRA_SWITCH_ACCOUNT = "switch_account";
    public static final String RESULT_COOKIES = "cookies";
    public static final String RESULT_ACCOUNT_NAME = "account_name";

    private WebView authWebView;
    private boolean finishedAlready = false;

    // Clean Chrome Mobile User-Agent without "; wv" so Google Sign-In allows authentication cleanly
    private static final String CHROME_MOBILE_UA =
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.127 Mobile Safari/537.36";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        boolean switchAccount = getIntent().getBooleanExtra(EXTRA_SWITCH_ACCOUNT, false);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.parseColor("#0F0F0F"));
        root.setFitsSystemWindows(true);

        // Top Toolbar
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#181818"));
        int padH = dp(12);
        int padV = dp(10);
        bar.setPadding(padH, padV, padH, padV);

        Button backBtn = new Button(this);
        backBtn.setText("✕ Close");
        backBtn.setTextColor(Color.WHITE);
        backBtn.setBackgroundColor(Color.TRANSPARENT);
        backBtn.setAllCaps(false);
        backBtn.setOnClickListener(v -> {
            setResult(Activity.RESULT_CANCELED);
            finish();
        });

        TextView titleTv = new TextView(this);
        titleTv.setText(switchAccount ? "Switch YouTube Account" : "Sign in to YouTube");
        titleTv.setTextColor(Color.WHITE);
        titleTv.setTextSize(16f);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        titleLp.setMargins(dp(8), 0, dp(8), 0);
        titleTv.setLayoutParams(titleLp);

        Button switchBtn = new Button(this);
        switchBtn.setText("Switch A/C");
        switchBtn.setTextColor(Color.parseColor("#60A5FA"));
        switchBtn.setBackgroundColor(Color.TRANSPARENT);
        switchBtn.setAllCaps(false);
        switchBtn.setOnClickListener(v -> {
            CookieManager.getInstance().removeAllCookies(unused -> {
                CookieManager.getInstance().flush();
                if (authWebView != null) {
                    authWebView.loadUrl("https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fm.youtube.com%2F");
                }
            });
        });

        Button syncBtn = new Button(this);
        syncBtn.setText("Sync ✓");
        syncBtn.setTextColor(Color.parseColor("#22C55E"));
        syncBtn.setBackgroundColor(Color.TRANSPARENT);
        syncBtn.setAllCaps(false);
        syncBtn.setOnClickListener(v -> captureAndFinish(true));

        bar.addView(backBtn);
        bar.addView(titleTv);
        bar.addView(switchBtn);
        bar.addView(syncBtn);

        authWebView = new WebView(this);
        LinearLayout.LayoutParams wvLp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
        );
        authWebView.setLayoutParams(wvLp);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(authWebView, true);

        WebSettings ws = authWebView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setUserAgentString(CHROME_MOBILE_UA);
        ws.setJavaScriptCanOpenWindowsAutomatically(true);
        ws.setSupportMultipleWindows(false);

        authWebView.setWebChromeClient(new WebChromeClient());
        authWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url != null && (url.startsWith("https://m.youtube.com") || url.startsWith("https://www.youtube.com")) && !url.contains("ServiceLogin")) {
                    captureAndFinish(false);
                }
            }
        });

        root.addView(bar);
        root.addView(authWebView);
        setContentView(root);

        String targetUrl = switchAccount
            ? "https://accounts.google.com/AccountChooser?service=youtube&continue=https%3A%2F%2Fm.youtube.com%2F"
            : "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=https%3A%2F%2Fm.youtube.com%2F";

        if (switchAccount) {
            cm.removeAllCookies(unused -> {
                cm.flush();
                authWebView.loadUrl("https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fm.youtube.com%2F");
            });
        } else {
            authWebView.loadUrl(targetUrl);
        }
    }

    private void captureAndFinish(boolean userTriggered) {
        if (finishedAlready) return;
        CookieManager cm = CookieManager.getInstance();
        cm.flush();
        String ytCookies = cm.getCookie("https://www.youtube.com");
        String mCookies = cm.getCookie("https://m.youtube.com");
        String combined = (ytCookies != null && !ytCookies.isEmpty()) ? ytCookies : (mCookies != null ? mCookies : "");

        boolean hasSession = combined.contains("SID=") || combined.contains("SAPISID=") || combined.contains("LOGIN_INFO=") || combined.contains("__Secure-3PAPISID=");
        if (!hasSession) {
            if (userTriggered) {
                Toast.makeText(this, "Finish signing into your Google/YouTube account first!", Toast.LENGTH_SHORT).show();
            }
            return;
        }

        finishedAlready = true;
        if (authWebView != null) {
            authWebView.evaluateJavascript(
                "(function(){ try { var img=document.querySelector('img#img.yt-img-shadow, button[aria-label*=\"Account\"] img'); var name=(document.querySelector('[id*=\"account-name\"], ytm-active-account-header-renderer #account-name')||{}).innerText || ''; return JSON.stringify({name:name.trim()}); } catch(e){ return '{}'; } })()",
                val -> {
                    String acctName = "YouTube Account";
                    if (val != null && val.contains("name")) {
                        try {
                            String unquoted = val.replaceAll("^\"|\"$", "").replace("\\\"", "\"");
                            int idx = unquoted.indexOf("\"name\":\"");
                            if (idx >= 0) {
                                String sub = unquoted.substring(idx + 8);
                                int end = sub.indexOf("\"");
                                if (end > 0) acctName = sub.substring(0, end);
                            }
                        } catch (Exception ignored) {}
                    }
                    Intent res = new Intent();
                    res.putExtra(RESULT_COOKIES, combined);
                    res.putExtra(RESULT_ACCOUNT_NAME, acctName.isEmpty() ? "YouTube Account" : acctName);
                    setResult(Activity.RESULT_OK, res);
                    finish();
                }
            );
        } else {
            Intent res = new Intent();
            res.putExtra(RESULT_COOKIES, combined);
            res.putExtra(RESULT_ACCOUNT_NAME, "YouTube Account");
            setResult(Activity.RESULT_OK, res);
            finish();
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onDestroy() {
        if (authWebView != null) {
            authWebView.stopLoading();
            authWebView.destroy();
        }
        super.onDestroy();
    }
}
