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
; Deliberately NOT the app version. This stub carries its own, and it only changes if the
; stub itself changes — so the compiled file stays the same release after release, which
; means it can be code-signed once and that one signed copy reused forever (see build.sh).
; If it tracked the app version, every release would ship an unsigned .exe that Defender has
; never seen before, on the very file the customer clicks every day.
VIAddVersionKey "FileVersion"     "1.0.0.0"
VIAddVersionKey "ProductVersion"  "1.0.0.0"
VIProductVersion "1.0.0.0"

Section
  ; Run from wherever the launcher itself lives, so a copied/renamed install still works.
  SetOutPath "$EXEDIR"
  IfFileExists "$EXEDIR\StreamGraphics Pro.vbs" 0 noapp
  Exec 'wscript.exe "$EXEDIR\StreamGraphics Pro.vbs"'
  Return
noapp:
  MessageBox MB_ICONSTOP "StreamGraphics Pro can't find its program files.$\n$\nThis launcher has to stay in the folder it was installed into."
SectionEnd
