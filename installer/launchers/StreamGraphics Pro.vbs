' StreamGraphics Pro - starts the app using its own bundled engine (no separate install needed).
' The app opens your web browser automatically at http://localhost:4000
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = appDir
sh.Run """" & appDir & "\sgpro-engine.exe"" """ & appDir & "\server.js""", 0, False
