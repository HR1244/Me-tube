@echo off
setlocal enabledelayedexpansion
title MeTube Server Launcher
color 0A

:: Ensure we are in the project root directory
cd /d "%~dp0"

echo ========================================================================
echo                   METUBE LOCAL SERVER LAUNCHER
echo ========================================================================
echo.

:: 1. Apply power settings so the laptop does NOT sleep when the lid is closed
echo [*] Configuring Windows power settings (Lid Close = Keep Running)...
powercfg -change -standby-timeout-ac 0 >nul 2>&1
powercfg -setacvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0 >nul 2>&1
powercfg -setdcvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0 >nul 2>&1
powercfg -SetActive SCHEME_CURRENT >nul 2>&1
echo [OK] Laptop is configured to stay ON even when the lid is closed!
echo.

:: 2. Find local IPv4 address
set "LOCAL_IP="
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -ExpandProperty IPv4Address).IPAddress" 2^>nul') do (
    set "LOCAL_IP=%%i"
)

if "%LOCAL_IP%"=="" (
    set "LOCAL_IP=127.0.0.1"
)

:: 3. Check Python venv in server directory
if not exist "server\venv\Scripts\python.exe" (
    echo [*] Setting up Python virtual environment in server\venv...
    cd server
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install --upgrade pip
    pip install -r requirements.txt
    cd ..
    echo [OK] Dependencies installed!
)

echo ========================================================================
echo   SERVER STATUS: ONLINE & READY
echo ========================================================================
echo.
echo   [PC Browser URL]:     http://localhost:8000
echo   [Android Phone URL]:  http://%LOCAL_IP%:8000
echo.
echo ------------------------------------------------------------------------
echo   HOW TO CONNECT FROM YOUR ANDROID PHONE:
echo   1. Connect your Android phone to the same Wi-Fi as this laptop.
echo   2. Open the MeTube app on your phone.
echo   3. Go to Settings (gear icon) -^> Custom Backend Server URL.
echo   4. Type in:  http://%LOCAL_IP%:8000
echo   5. Tap "Connect & Save".
echo.
echo   TIPS FOR 24/7 RUNNING:
echo   - Keep your laptop plugged into its charger.
echo   - You can close the lid now! The screen turns off to save power,
echo     but your MeTube server will continue running uninterrupted.
echo ========================================================================
echo.
echo Starting FastAPI & Uvicorn on 0.0.0.0:8000...
echo (Press Ctrl+C to stop the server)
echo.

cd server
venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
pause
