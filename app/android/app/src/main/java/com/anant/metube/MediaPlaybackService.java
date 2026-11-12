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
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

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

    private MediaPlayer mediaPlayer;
    private MediaSession mediaSession;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    private String currentTitle = "MeTube";
    private String currentArtist = "Background Audio";
    private String currentArtworkUrl = "";
    private Bitmap cachedArtwork = null;
    private long currentDurationMs = 0L;
    private long pendingSeekMs = 0L;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
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
                pendingSeekMs = pos;
                nativePositionMs = pos;
                if (mediaPlayer != null && isNativeAudioActive) {
                    try { mediaPlayer.seekTo((int) pos); } catch (Exception ignored) {}
                }
                sendMediaBroadcast("seek:" + pos);
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
            snapshotPosition();
            releaseMediaPlayer();
            isNativeAudioActive = false;
            releaseLocks();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        // Update metadata from intent extras
        String title = intent.getStringExtra("title");
        String artist = intent.getStringExtra("artist");
        String artwork = intent.getStringExtra("artwork");
        String streamUrl = intent.getStringExtra("streamUrl");
        long posMs = intent.getLongExtra("positionMs", 0L);
        long durMs = intent.getLongExtra("durationMs", 0L);
        boolean shouldPlay = intent.getBooleanExtra("isPlaying", true);

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

        if (ACTION_HANDOFF_PLAY.equals(action) && streamUrl != null && !streamUrl.isEmpty()) {
            acquireLocks();
            requestFocus();
            startNativePlayer(streamUrl, posMs, shouldPlay);
        } else if (ACTION_START_OR_UPDATE.equals(action)) {
            // Notification-only foreground tracking while WebView is foreground
            acquireLocks();
            updateNotificationAndSession();
        }

        return START_STICKY;
    }

    private void startNativePlayer(String url, long seekMs, boolean playWhenReady) {
        try {
            if (isNativeAudioActive && mediaPlayer != null && url.equals(currentStreamUrl)) {
                if (seekMs > 0 && Math.abs(mediaPlayer.getCurrentPosition() - seekMs) > 2500) {
                    mediaPlayer.seekTo((int) seekMs);
                }
                if (playWhenReady && !mediaPlayer.isPlaying()) mediaPlayer.start();
                isNativePlaying = playWhenReady;
                updateNotificationAndSession();
                return;
            }

            releaseMediaPlayer();
            currentStreamUrl = url;
            pendingSeekMs = Math.max(0L, seekMs);
            isNativeAudioActive = true;
            isNativePlaying = playWhenReady;

            mediaPlayer = new MediaPlayer();
            mediaPlayer.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);
            mediaPlayer.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .build()
            );

            Map<String, String> headers = new HashMap<>();
            headers.put("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36");
            mediaPlayer.setDataSource(getApplicationContext(), android.net.Uri.parse(url), headers);

            mediaPlayer.setOnPreparedListener(mp -> {
                if (!isNativeAudioActive) {
                    try { mp.release(); } catch (Exception ignored) {}
                    return;
                }
                long dur = mp.getDuration();
                if (dur > 0) currentDurationMs = dur;
                if (pendingSeekMs > 500 && (dur <= 0 || pendingSeekMs < dur - 500)) {
                    try { mp.seekTo((int) pendingSeekMs); } catch (Exception ignored) {}
                }
                if (isNativePlaying) {
                    mp.start();
                }
                updateNotificationAndSession();
            });

            mediaPlayer.setOnCompletionListener(mp -> {
                nativePositionMs = 0L;
                sendMediaBroadcast("ended");
            });

            mediaPlayer.setOnErrorListener((mp, what, extra) -> {
                Log.e(TAG, "Native MediaPlayer error: what=" + what + " extra=" + extra);
                isNativeAudioActive = false;
                updateNotificationAndSession();
                return true;
            });

            mediaPlayer.prepareAsync();
            updateNotificationAndSession();
        } catch (Exception e) {
            Log.e(TAG, "Failed to start native background audio player", e);
            isNativeAudioActive = false;
        }
    }

    private void handleTogglePlayPause(boolean targetPlay) {
        isNativePlaying = targetPlay;
        if (isNativeAudioActive && mediaPlayer != null) {
            try {
                if (targetPlay) {
                    requestFocus();
                    mediaPlayer.start();
                } else {
                    snapshotPosition();
                    mediaPlayer.pause();
                }
            } catch (Exception ignored) {}
        } else {
            sendMediaBroadcast(targetPlay ? "play" : "pause");
        }
        updateNotificationAndSession();
    }

    private void snapshotPosition() {
        if (isNativeAudioActive && mediaPlayer != null) {
            try {
                int pos = mediaPlayer.getCurrentPosition();
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

    private void updateNotificationAndSession() {
        if (mediaSession != null) {
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

    private void requestFocus() {
        if (audioManager == null) return;
        AudioManager.OnAudioFocusChangeListener listener = focusChange -> {
            if (focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT || focusChange == AudioManager.AUDIOFOCUS_LOSS) {
                if (isNativeAudioActive && mediaPlayer != null && mediaPlayer.isPlaying()) {
                    snapshotPosition();
                    mediaPlayer.pause();
                    isNativePlaying = false;
                    updateNotificationAndSession();
                }
            }
        };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setOnAudioFocusChangeListener(listener)
                .build();
            audioManager.requestAudioFocus(audioFocusRequest);
        } else {
            audioManager.requestAudioFocus(listener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
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
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) mediaPlayer.stop();
                mediaPlayer.reset();
                mediaPlayer.release();
            } catch (Exception ignored) {}
            mediaPlayer = null;
        }
    }

    private void stopServiceCleanly() {
        isNativeAudioActive = false;
        isNativePlaying = false;
        nativePositionMs = 0L;
        currentStreamUrl = "";
        releaseMediaPlayer();
        releaseLocks();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
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
