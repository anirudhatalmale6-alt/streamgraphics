; StreamGraphics Pro - Windows installer (per-user, no admin required)
; Built with NSIS (makensis). Bundles the Node runtime so end users install nothing else.
; Build it with ./build.sh (which stages files into ./build/app first). See BUILD.md.

Unicode true
!include "MUI2.nsh"

!define APPNAME     "StreamGraphics Pro"
!define COMPANY     "Manhattan Beach Studios LLC"
!define VERSION     "0.43.0"
!define APPDIRNAME  "StreamGraphics Pro"
!define STAGE       "build\app"          ; staging dir created by build.sh (relative to this script)

Name "${APPNAME}"
OutFile "build\StreamGraphicsProSetup.exe"
InstallDir "$LOCALAPPDATA\${APPDIRNAME}"
InstallDirRegKey HKCU "Software\${APPDIRNAME}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "${APPNAME} ${VERSION} - ${COMPANY}"

VIProductVersion "0.43.0.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "CompanyName" "${COMPANY}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "LegalCopyright" "(c) ${COMPANY}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

!define MUI_ICON   "${STAGE}\assets\streamgraphics.ico"
!define MUI_UNICON "${STAGE}\assets\streamgraphics.ico"
!define MUI_ABORTWARNING

!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Start StreamGraphics Pro now"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchApp"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\README.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Open the Getting Started notes"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${STAGE}\LICENSE.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function LaunchApp
  ExecShell "" "$INSTDIR\StreamGraphics Pro.vbs"
FunctionEnd

Section "Install"
  ; Stop any copy that's already running so we can overwrite the engine cleanly
  ; (installing an update on top of a running app). Silent — no console flash.
  nsExec::Exec 'taskkill /F /IM sgpro-engine.exe /T'
  SetOutPath "$INSTDIR"
  File /r "${STAGE}\*.*"

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"                  "$INSTDIR\StreamGraphics Pro.vbs"                 "" "$INSTDIR\assets\streamgraphics.ico" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Troubleshoot (show console).lnk" "$INSTDIR\StreamGraphics Pro (troubleshoot).bat" "" "$INSTDIR\assets\streamgraphics.ico" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Getting Started.lnk"             "$INSTDIR\README.txt"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk"        "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\StreamGraphics Pro.vbs" "" "$INSTDIR\assets\streamgraphics.ico" 0

  WriteRegStr HKCU "Software\${APPDIRNAME}" "InstallDir" "$INSTDIR"

  !define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPDIRNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName"     "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion"  "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher"       "${COMPANY}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon"     "$INSTDIR\assets\streamgraphics.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1

  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  ; Stop only our own engine (uniquely named) so files aren't locked - never touches other Node apps
  ExecWait 'taskkill /F /IM sgpro-engine.exe /T'

  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  RMDir /r "$INSTDIR"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPDIRNAME}"
  DeleteRegKey HKCU "Software\${APPDIRNAME}"
SectionEnd
