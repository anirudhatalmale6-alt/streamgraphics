@echo off
cd /d "%~dp0"
title StreamGraphics Pro
echo Starting StreamGraphics Pro...
echo.
echo If your browser does not open on its own, open it and go to:
echo     http://localhost:4000
echo.
echo Keep this window open while you use StreamGraphics Pro. Close it to stop.
echo.
"%~dp0sgpro-engine.exe" "%~dp0server.js"
echo.
echo StreamGraphics Pro has stopped. Press any key to close.
pause >nul
