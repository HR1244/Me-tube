@echo off
title Push MeTube Updates to GitHub
echo ========================================================
echo        Pushing latest updates to GitHub origin main
echo ========================================================
echo.
git push origin main
if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================================
    echo  [SUCCESS] Pushed to GitHub!
    echo  GitHub Actions is now compiling your fresh MeTube.apk.
    echo ========================================================
) else (
    echo.
    echo [NOTICE] Please complete the GitHub sign-in popup in your browser.
)
pause

