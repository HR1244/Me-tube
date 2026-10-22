# Free Hosting & Standalone Android APK Guide

This guide explains how to host your FreeTube Python backend **100% free with fast response times** (no sleeping/freezing), handle **Age-Restricted content**, and compile a **standalone Android APK** (no Expo Go required).

---

## 🌐 1. Best Free Platforms to Host the Backend

Since our backend runs **FastAPI + yt-dlp + FFmpeg**, standard serverless hosts like Vercel or Netlify won't work because they lack FFmpeg and terminate requests after 10–15 seconds. 

Here are the top platforms that support Docker containers with FFmpeg:

| Platform | Cost | Specs | Response Time | Sleeps/Inactivity? | Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **🏆 Hugging Face Spaces** | **100% FREE** | **2 vCPU, 16 GB RAM** | ⚡ **Very Fast (<150ms)** | ❌ **Never Sleeps (24/7)** | **Top Pick (#1)** |
| **Render.com** | Free tier | 512 MB RAM | Fast (~200ms) | ⚠️ Sleeps after 15m (50s cold start) | Good backup |
| **Koyeb** | Free tier | 512 MB RAM, 2 GB disk | ⚡ Fast worldwide | ❌ Stays awake | Great alternative |
| **Oracle Cloud** | Free Forever | 4 ARM CPUs, 24 GB RAM | ⚡ Blazing fast | ❌ Stays awake | Best for power users |

---

### 🚀 Deploying to Hugging Face Spaces (Recommended — 2 Minutes)
Hugging Face Spaces offers **free 16 GB RAM containers that run 24/7 with zero sleeping**:

1. Go to [huggingface.co](https://huggingface.co/) and sign up for a free account.
2. Click your profile icon at the top right and select **"New Space"**.
3. Fill in:
   - **Space name**: `freetube-backend` (or any name you like)
   - **Space SDK**: Choose **Docker** -> **Blank**.
   - **Space hardware**: Free (2 vCPU, 16 GB RAM).
   - **Visibility**: Public.
4. Clone or upload your `server/` files (`main.py`, `requirements.txt`, `Dockerfile`).
5. In Hugging Face Settings, set the environment variable:
   - `PORT` = `7860`
6. Click **Build**. Within 1–2 minutes, Hugging Face gives you a permanent HTTPS API URL:
   `https://<your-username>-freetube-backend.hf.space`
7. Put that URL into your FreeTube app Settings, and your mobile app will work anywhere in the world!

---

## 🔒 2. Unlocking Age-Restricted Content (18+)

### Why does YouTube show the "Sign in to confirm your age" message?
YouTube restricts adult-rated content and blocks direct stream scraping unless an authenticated user session is provided.

### How FreeTube Handles It:
1. **In-App Embed Fallback**: The app automatically catches age-restricted videos and falls back to YouTube's player embed so it doesn't crash.
2. **Permanent Server Unlock (Cookies)**:
   - Install a browser extension like **"Get cookies.txt LOCALLY"** in Chrome/Firefox.
   - Go to `youtube.com` (logged in to any account).
   - Export your cookies as a `cookies.txt` file.
   - Place this file in `server/cookies.txt`.
   - FreeTube's `yt-dlp` will automatically detect `cookies.txt` and unlock **all age-restricted streaming and MP3/MP4 downloads** seamlessly!

---

## 📱 3. Compiling Standalone Android APK (No Expo Go)

You can build a standalone installable `.apk` file (like SnapTube or TubeMate) using **EAS (Expo Application Services)**:

### Step 1: Install EAS CLI
```powershell
npm install -g eas-cli
```

### Step 2: Login to Expo (Free)
```powershell
eas login
```
*(If you don't have an Expo account, create one free at [expo.dev](https://expo.dev))*

### Step 3: Trigger APK Build
Run inside the `mobile` directory:
```powershell
cd "c:\Users\Anant\OneDrive\Desktop\Projects\free youtube\mobile"
eas build -p android --profile preview
```

### What happens next?
- EAS compiles a standalone `.apk` in the cloud.
- Once finished (approx. 5–8 minutes), it provides a direct download link or QR code to download the `.apk` straight to your phone.
- Tap the `.apk` on your Android device to install FreeTube as a native Android app!
