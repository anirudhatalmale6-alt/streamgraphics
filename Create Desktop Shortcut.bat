@echo off
cd /d "%~dp0"
echo Creating a "StreamGraphics Pro" shortcut on your Desktop...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$lnk = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\StreamGraphics Pro.lnk');" ^
  "$lnk.TargetPath = '%~dp0Start StreamGraphics (no window).vbs';" ^
  "$lnk.WorkingDirectory = '%~dp0';" ^
  "$lnk.IconLocation = '%~dp0assets\streamgraphics.ico';" ^
  "$lnk.Description = 'Launch StreamGraphics Pro';" ^
  "$lnk.Save()"

if errorlevel 1 (
  echo.
  echo   Could not create the shortcut automatically.
  echo   You can still launch the app by double-clicking "Start StreamGraphics.bat".
) else (
  echo.
  echo   Done! Look for "StreamGraphics Pro" on your Desktop.
)
echo.
pause
