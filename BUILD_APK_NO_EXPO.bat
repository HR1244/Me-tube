@echo off
title MeTube - Standalone APK Builder (No Expo)
echo ========================================================
echo        MeTube Standalone Android APK Builder
echo               (Capacitor - Pure Native)
echo ========================================================
echo.
echo Connected Cloud Server: https://me-tube-o48b.onrender.com
echo.
echo 1. Building Web App Production Bundle...
cd /d "%~dp0app"
call npm run build
echo.
echo 2. Syncing Native Android Assets...
call npx cap sync android
echo.
echo 3. Build Options:
echo [1] Open directly in Android Studio (Build -^> Build APK)
echo [2] Build APK via Command Line Gradle
echo.
set /p choice="Select an option (1 or 2): "

if "%choice%"=="1" (
    echo Opening native project in Android Studio...
    call npx cap open android
) else (
    echo Compiling APK via Gradle...
    cd android
    call gradlew.bat assembleDebug
    echo.
    echo If build succeeded, your APK is at:
    echo app\android\app\build\outputs\apk\debug\app-debug.apk
)

echo.
echo ========================================================
echo Done!
echo ========================================================
pause
