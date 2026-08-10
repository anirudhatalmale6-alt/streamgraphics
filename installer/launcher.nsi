; StreamGraphics Pro — a real .exe launcher.
;
; Windows will not let you pin a .vbs shortcut to the taskbar, and when one does run it
; borrows wscript's icon. So the app ships a tiny compiled launcher instead: it carries the
; StreamGraphics icon, it can be pinned, and all it does is hand off to the same VBS that
; starts the engine with no console window. It exits immediately — the app itself has no
; window of its own, it just opens your browser.

!include "FileFunc.nsh"

Name          "StreamGraphics Pro"
OutFile       "build\StreamGraphics Pro.exe"
Icon          "build\app\assets\streamgraphics.ico"
SilentInstall silent
RequestExecutionLevel user

VIAddVersionKey "ProductName"     "StreamGraphics Pro"
VIAddVersionKey "FileDescription" "StreamGraphics Pro"
VIAddVersionKey "CompanyName"     "Manhattan Beach Studios LLC"
VIAddVersionKey "LegalCopyright"  "Manhattan Beach Studios LLC"
VIAddVersionKey "FileVersion"     "${APPVER}.0"
VIAddVersionKey "ProductVersion"  "${APPVER}.0"
VIProductVersion "${APPVER}.0"

Section
  ; Run from wherever the launcher itself lives, so a copied/renamed install still works.
  SetOutPath "$EXEDIR"
  IfFileExists "$EXEDIR\StreamGraphics Pro.vbs" 0 noapp
  Exec 'wscript.exe "$EXEDIR\StreamGraphics Pro.vbs"'
  Return
noapp:
  MessageBox MB_ICONSTOP "StreamGraphics Pro can't find its program files.$\n$\nThis launcher has to stay in the folder it was installed into."
SectionEnd
