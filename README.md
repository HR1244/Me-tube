# FreeTube (SnapTube & TubeMate Clone)

A high-performance mobile application and backend service built for **ad-free YouTube streaming** and **multi-resolution MP3/MP4 downloading**, inspired by SnapTube and TubeMate.

---

## 🌟 Key Features

1. **100% Ad-Free Video Streaming**
   - Strips pre-roll, mid-roll, and banner advertisements directly at the stream extraction layer.
   - Clean native HTML5 / progressive stream playback.

2. **Screen-Off Background Audio Mode ("Listen Only")**
   - Listen to music, podcasts, speeches, and interviews with low data and battery usage while multitasking or with your screen turned off.

3. **SnapTube-Style Multi-Resolution Download Modal**
   - **Audio (MP3)**: 320 kbps (High Quality), 192 kbps (Medium), 128 kbps (Standard) with automatic FFmpeg post-processing.
   - **Video (MP4)**: 1080p Full HD, 720p HD, 480p SD, 360p Data Saver.
   - Instant file size estimations for each format before downloading.

4. **Background Download Manager**
   - Real-time progress percentage, download speed (`MB/s`), and estimated time of arrival (`ETA`).
   - Integrated offline media player to listen to downloaded MP3s or watch MP4s directly in the app.
   - One-tap "Save to Device" to export to your device storage.

5. **Search & Category Feeds**
   - Instant search bar with live YouTube queries.
   - Category filter pills: All, Music, Gaming, Tech & Gadgets, News.

---

## 🛠️ Architecture

- **Mobile App**: React Native with Expo (Cross-platform: Android, iOS, and Web).
- **Backend Server**: Python 3 (FastAPI + `yt-dlp` + standalone embedded `FFmpeg`).
- **Network**: Binds to `0.0.0.0:8000` so mobile phones on the same Wi-Fi can connect directly.

---

## 🚀 Running the Project

### 1. Start the Backend Server (Port 8000)
Open PowerShell in the `server` directory:
```powershell
cd "c:\Users\Anant\OneDrive\Desktop\Projects\free youtube\server"
.\venv\Scripts\python -m uvicorn main:app --host 0.0.0.0 --port 8000
```
- API Docs & Swagger: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/api/health`

### 2. Start the Mobile App (Expo)
Open a second PowerShell terminal in the `mobile` directory:
```powershell
cd "c:\Users\Anant\OneDrive\Desktop\Projects\free youtube\mobile"
npx expo start
```

#### How to Run on Different Targets:
- **Web Browser**: Press `w` in terminal or visit `http://localhost:8081`.
- **Android Phone (Expo Go)**:
  1. Install the **Expo Go** app from Google Play Store.
  2. Scan the QR code shown in your terminal.
  3. In the app's **Settings** tab, verify the backend URL is set to your machine's Wi-Fi IP (e.g., `http://10.181.252.122:8000`).
- **Android Emulator**: Press `a` in the terminal.
- **Standalone Android APK**:
  ```powershell
  npx eas-cli build -p android --profile preview
  ```

---

## 📂 Project Structure

```
free youtube/
├── server/
│   ├── downloads/               # Downloaded MP3 and MP4 files
│   ├── venv/                    # Python virtual environment
│   ├── main.py                  # FastAPI server endpoints & yt-dlp/ffmpeg engine
│   └── requirements.txt         # Dependencies
├── mobile/
│   ├── src/
│   │   ├── api/
│   │   │   └── client.js        # Backend API communicator
│   │   ├── components/
│   │   │   ├── Header.js        # Branding & search bar
│   │   │   ├── CategoryBar.js   # Trending pills
│   │   │   ├── VideoCard.js     # Video feed cards
│   │   │   ├── DownloadModal.js # SnapTube resolution selector
│   │   │   ├── VideoPlayerModal.js # Ad-free video & audio player
│   │   │   └── BottomNavBar.js  # Navigation tabs with badges
│   │   ├── screens/
│   │   │   ├── HomeScreen.js    # Trending & search feed
│   │   │   ├── DownloadsScreen.js # Download manager & offline player
│   │   │   └── SettingsScreen.js  # Backend IP configuration
│   │   └── theme.js             # Modern dark OLED theme tokens
│   ├── App.js                   # Application root
│   └── package.json
└── README.md
```
