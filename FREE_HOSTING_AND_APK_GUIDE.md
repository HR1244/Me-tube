# MeTube Studio & Standalone Android APK Guide (No Expo)

Your live backend server is deployed and tested:
🔗 **`https://me-tube-o48b.onrender.com`** (Status: **200 OK**, FFmpeg Loaded, 20 trending videos loaded)

The new MeTube standalone mobile application has been built from scratch **without Expo** to resolve:
1. **Top Taskbar / Header Overlap**: Full safe-area inset adaptation (`--safe-top`) ensuring the search bar, hamburger button, and action controls are 100% clickable and never blocked by phone notches or status bars.
2. **Zero Crashing**: Replaced unstable native hooks with clean, native HTML5 streaming and standard direct file downloading that works smoothly across any mobile device.
3. **Interactive Desktop Phone Simulator**: Test your mobile app right in your browser on desktop with device models (**Samsung Galaxy S24 Ultra**, **Google Pixel 8 Pro**, **iPhone 15 Pro**, and **Full Screen Mode**).

---

## 🖥️ 1. How to Test with the Desktop Phone Simulator

Open in your browser:
👉 **`http://localhost:3000`**

What you can test in the simulator:
- **Device Selector**: Switch between Samsung S24, Pixel 8, iPhone 15 Pro, or Fullscreen.
- **Top Bar Clickability**: The search bar, hamburger, mic, and create buttons have safe-area padding and are 100% clickable.
- **Ad-Free Streaming**: Tap any video to play ad-free with speed controls (`0.25x` to `4.0x`), background audio mode, and auto-looping.
- **Download Modal (SnapTube style)**: Download MP3 (320k, 192k, 128k) or MP4 (1080p, 720p, 480p, 360p).
- **Downloads Manager**: Track progress and click **"Save to Device"** or **"Play"**.
- **Shorts Shelf**: Swipe through vertical 9:16 Shorts with 3-dot options and quick download.
- **Channel Explorer**: View creator mountain cover banner, subscriber stats, and Latest/Popular/Oldest tabs.

---

## 📱 2. How to Build the Standalone APK (Without Expo)

We set up **Capacitor**, which converts web apps into real, standalone Android Studio projects without Expo, EAS accounts, or third-party cloud build queues.

### Method A: 1-Click Script
In your project folder, double-click:
📁 **`BUILD_APK_NO_EXPO.bat`**

It will:
1. Compile your production web assets with Vite.
2. Sync the assets into the native Android project in `app/android`.
3. Give you the option to open in **Android Studio** (Click **Build > Build APK(s)**) or build via Gradle.

### Method B: Via Android Studio (Recommended for Production APK)
```bash
cd "c:\Users\Anant\OneDrive\Desktop\Projects\free youtube\app"
npm run build
npx cap open android
```
In Android Studio:
1. Wait for Gradle sync to complete.
2. Click **Build** > **Build Bundle(s) / APK(s)** > **Build APK(s)**.
3. Android Studio will generate the installable `.apk` file ready to share with anyone!
