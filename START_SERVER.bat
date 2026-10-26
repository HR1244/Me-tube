@echo off
title MeTube Server + Worldwide Tunnel Launcher
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\run_server_with_tunnel.ps1"
if %ERRORLEVEL% neq 0 (
    echo.
    echo Server stopped.
    pause
)
