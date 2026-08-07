@echo off
title StreamGraphics Pro
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   StreamGraphics Pro needs Node.js, which doesn't seem to be installed.
  echo   1^) Go to https://nodejs.org  and download the "LTS" version.
  echo   2^) Install it ^(just click Next / Next / Finish^).
  echo   3^) Double-click this file again.
  echo.
  pause
  exit /b
)

echo.
echo   Starting StreamGraphics Pro...
echo   Your browser will open in a moment. Keep this window open while you work.
echo   To stop the app, close this window ^(or press Ctrl+C^).
echo.
node server.js
echo.
echo   StreamGraphics Pro has stopped.
pause
