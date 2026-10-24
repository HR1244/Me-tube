@echo off
title MeTube - Push to GitHub and Trigger Render Auto-Deploy
echo ========================================================
echo          MeTube - Deploy Updates to Render
echo ========================================================
echo.
echo Pushing latest code to GitHub origin/main...
git push origin main
echo.
if %ERRORLEVEL% equ 0 (
    echo [SUCCESS] Code pushed to GitHub!
    echo Render will automatically detect the commit and deploy within 1-2 minutes.
    echo Server URL: https://me-tube-o48b.onrender.com
) else (
    echo [ERROR] Git push failed. Please check your credentials or run:
    echo git push origin main
)
echo.
pause
