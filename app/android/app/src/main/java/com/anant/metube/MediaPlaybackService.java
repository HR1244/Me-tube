package com.anant.metube;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MediaPlaybackService extends Service {
    private static final String TAG = "MeTubeMediaService";
    public static final String CHANNEL_ID = "metube_bg_playback";
    public static final int NOTIF_ID = 7001;

    public static final String ACTION_START_OR_UPDATE = "com.anant.metube.ACTION_START_OR_UPDATE";
    public static final String ACTION_HANDOFF_PLAY = "com.anant.metube.ACTION_HANDOFF_PLAY";
    public static final String ACTION_HANDOFF_RETURN = "com.anant.metube.ACTION_HANDOFF_RETURN";
    public static final String ACTION_PLAY_PAUSE = "com.anant.metube.ACTION_PLAY_PAUSE";
    public static final String ACTION_NEXT = "com.anant.metube.ACTION_NEXT";
    public static final String ACTION_PREV = "com.anant.metube.ACTION_PREV";
    public static final String ACTION_STOP = "com.anant.metube.ACTION_STOP";

    public static final String BROADCAST_MEDIA_EVENT = "com.anant.metube.BROADCAST_MEDIA_EVENT";

    // Shared atomic snapshot so MainActivity can inspect exact native handoff position synchronously
    public static volatile boolean isNativeAudioActive = false;
    public static volatile boolean isNativePlaying = false;
    public static volatile long nativePositionMs = 0L;
    public static volatile String currentStreamUrl = "";

    private static final String DEFAULT_UA =
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36";

    private ExoPlayer exoPlayer;
    private MediaSession mediaSession;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean retriedFallback = false;
    private int tickCounter = 0;
    private volatile int playSeq = 0;

    private String currentVideoId = "";
    private String currentFallbackUrl = "";
    private String currentUserAgent = DEFAULT_UA;
    private String currentTitle = "MeTube";
    private String currentArtist = "Background Audio";
    private String currentArtworkUrl = "";
    private Bitmap cachedArtwork = null;
    private long currentDurationMs = 0L;
    private long pendingSeekMs = 0L;

    private final Runnable positionTicker = new Runnable() {
        @Override
        public void run() {
            if (isNativeAudioActive && exoPlayer != null) {
                try {
                    long pos = exoPlayer.getCurrentPosition();
                    if (pos >= 0) nativePositionMs = pos;
                    long dur = exoPlayer.getDuration();
                    if (dur > 0 && dur != C.TIME_UNSET) currentDurationMs = dur;
                    tickCounter++;
                    if (tickCounter % 5 == 0) {
                        updateSessionPlaybackState();
                    }
                } catch (Exception ignored) {}
                mainHandler.postDelayed(this, 1000L);
            }
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MeTube::BgMediaWakeLock");
            wakeLock.setReferenceCounted(false);
        }
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null) {
            wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "MeTube::BgWifiLock");
            wifiLock.setReferenceCounted(false);
        }

        mediaSession = new MediaSession(this, "MeTubeSession");
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() { handleTogglePlayPause(true); }
            @Override
            public void onPause() { handleTogglePlayPause(false); }
            @Override
            public void onSkipToNext() { sendMediaBroadcast("next"); }
            @Override
            public void onSkipToPrevious() { sendMediaBroadcast("prev"); }
            @Override
            public void onSeekTo(long pos) {
                pendingSeekMs = Math.max(0L, pos);
                nativePositionMs = pendingSeekMs;
                if (exoPlayer != null && isNativeAudioActive) {
                    try { exoPlayer.seekTo(pendingSeekMs); } catch (Exception ignored) {}
                }
                sendMediaBroadcast("seek:" + pendingSeekMs);
                updateNotificationAndSession();
            }
            @Override
            public void onStop() {
                stopServiceCleanly();
                sendMediaBroadcast("stop");
            }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();
        if (action == null) action = ACTION_START_OR_UPDATE;

        if (ACTION_STOP.equals(action)) {
            sendMediaBroadcast("stop");
            stopServiceCleanly();
            return START_NOT_STICKY;
        }

        if (ACTION_PLAY_PAUSE.equals(action)) {
            handleTogglePlayPause(!isNativePlaying);
            return START_STICKY;
        }

        if (ACTION_NEXT.equals(action)) {
            sendMediaBroadcast("next");
            return START_STICKY;
        }

        if (ACTION_PREV.equals(action)) {
            sendMediaBroadcast("prev");
            return START_STICKY;
        }

        if (ACTION_HANDOFF_RETURN.equals(action)) {
            ++playSeq;
            snapshotPosition();
            isNativeAudioActive = false;
            mainHandler.removeCallbacks(positionTicker);
            releaseMediaPlayer();
            releaseLocks();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        // Update metadata from intent extras
        String videoId = intent.getStringExtra("videoId");
        String title = intent.getStringExtra("title");
        String artist = intent.getStringExtra("artist");
        String artwork = intent.getStringExtra("artwork");
        String streamUrl = intent.getStringExtra("streamUrl");
        long posMs = intent.getLongExtra("positionMs", 0L);
        long durMs = intent.getLongExtra("durationMs", 0L);
        boolean shouldPlay = intent.getBooleanExtra("isPlaying", true);

        if (videoId != null) currentVideoId = videoId;
        if (title != null && !title.isEmpty()) currentTitle = title;
        if (artist != null && !artist.isEmpty()) currentArtist = artist;
        if (durMs > 0) currentDurationMs = durMs;
        if (posMs >= 0) nativePositionMs = posMs;
        isNativePlaying = shouldPlay;

        if (artwork != null && !artwork.isEmpty() && !artwork.equals(currentArtworkUrl)) {
            currentArtworkUrl = artwork;
            fetchArtworkAsync(artwork);
        }

        // Promote immediately to Foreground Service before anything else
        promoteForeground();

        if (ACTION_HANDOFF_PLAY.equals(action) && ((streamUrl != null && !streamUrl.isEmpty()) || DirectYouTubeResolver.isValidYouTubeId(videoId))) {
            acquireLocks();
            retriedFallback = false;
            currentFallbackUrl = streamUrl != null ? streamUrl : "";
            isNativeAudioActive = true;
            isNativePlaying = shouldPlay;
            final int mySeq = ++playSeq;
            final boolean isOfflineFile = currentFallbackUrl.contains("/api/download/file/");

            if (!isOfflineFile && DirectYouTubeResolver.isValidYouTubeId(videoId)) {
                DirectYouTubeResolver.ResolvedStream cached = DirectYouTubeResolver.getCached(videoId);
                if (cached != null && cached.audioUrl != null && !cached.audioUrl.isEmpty()) {
                    startNativePlayer(cached.audioUrl, cached.userAgent, posMs, shouldPlay);
                } else {
                    updateNotificationAndSession();
                    new Thread(() -> {
                        DirectYouTubeResolver.ResolvedStream res = DirectYouTubeResolver.resolve(videoId);
                        if (mySeq != playSeq || !isNativeAudioActive) return;
                        String targetUrl = (res != null && res.audioUrl != null && !res.audioUrl.isEmpty()) ? res.audioUrl : currentFallbackUrl;
                        String targetUa = (res != null && res.audioUrl != null && !res.audioUrl.isEmpty()) ? res.userAgent : DEFAULT_UA;
                        if (res != null && res.durationMs > 0 && currentDurationMs <= 0) {
                            currentDurationMs = res.durationMs;
                        }
                        if (targetUrl != null && !targetUrl.isEmpty()) {
                            mainHandler.post(() -> {
                                if (mySeq == playSeq && isNativeAudioActive) {
                                    startNativePlayer(targetUrl, targetUa, posMs, shouldPlay);
                                }
                            });
                        }
                    }).start();
                }
            } else if (!currentFallbackUrl.isEmpty()) {
                startNativePlayer(currentFallbackUrl, DEFAULT_UA, posMs, shouldPlay);
            }
        } else if (ACTION_START_OR_UPDATE.equals(action)) {
            // Notification-only foreground tracking while WebView is foreground
            acquireLocks();
            updateNotificationAndSession();
        }

        return START_STICKY;
    }

    private void startNativePlayer(String url, String userAgent, long seekMs, boolean playWhenReady) {
        try {
            String effectiveUa = (userAgent != null && !userAgent.isEmpty()) ? userAgent : DEFAULT_UA;
            if (isNativeAudioActive && exoPlayer != null && url.equals(currentStreamUrl)) {
                if (seekMs > 0 && Math.abs(exoPlayer.getCurrentPosition() - seekMs) > 2500) {
                    exoPlayer.seekTo(seekMs);
                }
                exoPlayer.setPlayWhenReady(playWhenReady);
                if (playWhenReady && !exoPlayer.isPlaying()) exoPlayer.play();
                isNativePlaying = playWhenReady;
                updateNotificationAndSession();
                return;
            }

            releaseMediaPlayer();
            currentStreamUrl = url;
            currentUserAgent = effectiveUa;
            pendingSeekMs = Math.max(0L, seekMs);
            isNativeAudioActive = true;
            isNativePlaying = playWhenReady;

            DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent(effectiveUa)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(30000)
                .setReadTimeoutMs(30000);

            AudioAttributes attrs = new AudioAttributes.Builder()
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .setUsage(C.USAGE_MEDIA)
                .build();

            exoPlayer = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(this).setDataSourceFactory(httpFactory))
                .setAudioAttributes(attrs, true)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .build();

            exoPlayer.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int playbackState) {
                    if (!isNativeAudioActive || exoPlayer == null) return;
                    if (playbackState == Player.STATE_READY) {
                        long dur = exoPlayer.getDuration();
                        if (dur > 0 && dur != C.TIME_UNSET) currentDurationMs = dur;
                        updateNotificationAndSession();
                    } else if (playbackState == Player.STATE_ENDED) {
                        nativePositionMs = 0L;
                        isNativePlaying = false;
                        updateNotificationAndSession();
                        sendMediaBroadcast("ended");
                    }
                }

                @Override
                public void onIsPlayingChanged(boolean playing) {
                    if (!isNativeAudioActive) return;
                    isNativePlaying = playing;
                    snapshotPosition();
                    updateNotificationAndSession();
                }

                @Override
                public void onPlayerError(PlaybackException error) {
                    Log.e(TAG, "ExoPlayer background error (" + error.getErrorCodeName() + "): " + error.getMessage());
                    if (!retriedFallback) {
                        retriedFallback = true;
                        long posNow = Math.max(nativePositionMs, pendingSeekMs);
                        if (currentFallbackUrl != null && !currentFallbackUrl.isEmpty() && !currentFallbackUrl.equals(currentStreamUrl)) {
                            String nextUrl = currentFallbackUrl;
                            currentStreamUrl = "";
                            mainHandler.post(() -> startNativePlayer(nextUrl, DEFAULT_UA, posNow, true));
                            return;
                        }
                        if (currentStreamUrl != null && currentStreamUrl.contains("audio=true")) {
                            String fallbackUrl = currentStreamUrl.replace("audio=true", "audio=false");
                            currentStreamUrl = "";
                            mainHandler.post(() -> startNativePlayer(fallbackUrl, DEFAULT_UA, posNow, true));
                            return;
                        }
                    }
                    isNativeAudioActive = false;
                    isNativePlaying = false;
                    mainHandler.removeCallbacks(positionTicker);
                    updateNotificationAndSession();
                }
            });

            MediaItem mediaItem = new MediaItem.Builder().setUri(url).build();
            if (pendingSeekMs > 500) {
                exoPlayer.setMediaItem(mediaItem, pendingSeekMs);
            } else {
                exoPlayer.setMediaItem(mediaItem);
            }
            exoPlayer.setPlayWhenReady(playWhenReady);
            exoPlayer.prepare();

            mainHandler.removeCallbacks(positionTicker);
            mainHandler.postDelayed(positionTicker, 1000L);
            updateNotificationAndSession();
        } catch (Exception e) {
            Log.e(TAG, "Failed to start native ExoPlayer background service", e);
            isNativeAudioActive = false;
        }
    }

    private void handleTogglePlayPause(boolean targetPlay) {
        isNativePlaying = targetPlay;
        if (isNativeAudioActive && exoPlayer != null) {
            try {
                if (targetPlay) {
                    exoPlayer.setPlayWhenReady(true);
                    exoPlayer.play();
                } else {
                    snapshotPosition();
                    exoPlayer.pause();
                }
            } catch (Exception ignored) {}
        } else {
            sendMediaBroadcast(targetPlay ? "play" : "pause");
        }
        updateNotificationAndSession();
    }

    private void snapshotPosition() {
        if (isNativeAudioActive && exoPlayer != null) {
            try {
                long pos = exoPlayer.getCurrentPosition();
                if (pos >= 0) nativePositionMs = pos;
            } catch (Exception ignored) {}
        }
    }

    private void sendMediaBroadcast(String cmd) {
        Intent i = new Intent(BROADCAST_MEDIA_EVENT);
        i.setPackage(getPackageName());
        i.putExtra("command", cmd);
        i.putExtra("positionMs", nativePositionMs);
        i.putExtra("isPlaying", isNativePlaying);
        sendBroadcast(i);
    }

    private void promoteForeground() {
        Notification notif = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_ID, notif);
        }
    }

    private void updateSessionPlaybackState() {
        if (mediaSession == null) return;
        int stateCode = isNativePlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        snapshotPosition();
        PlaybackState.Builder ps = new PlaybackState.Builder()
            .setActions(
                PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE |
                PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT |
                PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP | PlaybackState.ACTION_SEEK_TO
            )
            .setState(stateCode, nativePositionMs, isNativePlaying ? 1.0f : 0.0f);
        mediaSession.setPlaybackState(ps.build());
    }

    private void updateNotificationAndSession() {
        updateSessionPlaybackState();
        if (mediaSession != null) {
            MediaMetadata.Builder mm = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, currentArtist);
            if (currentDurationMs > 0) {
                mm.putLong(MediaMetadata.METADATA_KEY_DURATION, currentDurationMs);
            }
            if (cachedArtwork != null) {
                mm.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, cachedArtwork);
            }
            mediaSession.setMetadata(mm.build());
        }

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIF_ID, buildNotification());
        }
    }

    private Notification buildNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent contentPi = PendingIntent.getActivity(
            this, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        PendingIntent prevPi = serviceActionPi(ACTION_PREV, 101);
        PendingIntent togglePi = serviceActionPi(ACTION_PLAY_PAUSE, 102);
        PendingIntent nextPi = serviceActionPi(ACTION_NEXT, 103);
        PendingIntent stopPi = serviceActionPi(ACTION_STOP, 104);

        int toggleIcon = isNativePlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
        String toggleLabel = isNativePlaying ? "Pause" : "Play";

        Notification.Builder nb = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        nb.setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist)
            .setContentIntent(contentPi)
            .setOngoing(isNativePlaying)
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Previous", prevPi).build())
            .addAction(new Notification.Action.Builder(toggleIcon, toggleLabel, togglePi).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Next", nextPi).build())
            .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Stop", stopPi).build());

        if (cachedArtwork != null) {
            nb.setLargeIcon(cachedArtwork);
        }

        if (mediaSession != null) {
            nb.setStyle(new Notification.MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2));
        }

        return nb.build();
    }

    private PendingIntent serviceActionPi(String action, int reqCode) {
        Intent i = new Intent(this, MediaPlaybackService.class);
        i.setAction(action);
        return PendingIntent.getService(this, reqCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void fetchArtworkAsync(String imageUrl) {
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                URL u = new URL(imageUrl);
                conn = (HttpURLConnection) u.openConnection();
                conn.setConnectTimeout(4000);
                conn.setReadTimeout(4000);
                conn.setRequestProperty("User-Agent", "Mozilla/5.0");
                try (InputStream is = conn.getInputStream()) {
                    Bitmap bmp = BitmapFactory.decodeStream(is);
                    if (bmp != null) {
                        cachedArtwork = bmp;
                        updateNotificationAndSession();
                    }
                }
            } catch (Exception ignored) {
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel chan = new NotificationChannel(
                CHANNEL_ID,
                "MeTube Background Playback",
                NotificationManager.IMPORTANCE_LOW
            );
            chan.setDescription("Keeps audio & video playback running seamlessly in the background");
            chan.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            chan.setShowBadge(false);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(chan);
        }
    }

    private void acquireLocks() {
        try {
            if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire(4 * 60 * 60 * 1000L);
            if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
        } catch (Exception ignored) {}
    }

    private void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Exception ignored) {}
    }

    private void releaseMediaPlayer() {
        mainHandler.removeCallbacks(positionTicker);
        if (exoPlayer != null) {
            try {
                exoPlayer.stop();
                exoPlayer.release();
            } catch (Exception ignored) {}
            exoPlayer = null;
        }
    }

    private void stopServiceCleanly() {
        isNativeAudioActive = false;
        isNativePlaying = false;
        nativePositionMs = 0L;
        pendingSeekMs = 0L;
        currentStreamUrl = "";
        releaseMediaPlayer();
        releaseLocks();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Keep playing seamlessly when user swipes recents or switches apps while BG audio is active
        if (!isNativeAudioActive && !isNativePlaying) {
            stopServiceCleanly();
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        isNativeAudioActive = false;
        isNativePlaying = false;
        releaseMediaPlayer();
        releaseLocks();
        if (mediaSession != null) {
            try {
                mediaSession.setActive(false);
                mediaSession.release();
            } catch (Exception ignored) {}
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
