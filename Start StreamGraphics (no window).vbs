' StreamGraphics Pro — quiet launcher.
' Starts the app with NO console window and lets your browser pop open on its own.
' This is what the desktop shortcut points at, so it feels like opening a normal app.
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here

' Is Node installed?  "where node" returns 0 if found, 1 if not.
nodeMissing = sh.Run("cmd /c where node", 0, True)
If nodeMissing <> 0 Then
  ' Node isn't installed — open the visible launcher so the user sees the friendly instructions.
  sh.Run """" & here & "\Start StreamGraphics.bat""", 1, False
  WScript.Quit
End If

' 0 = hidden window, False = don't wait. server.js opens the browser itself.
sh.Run "node """ & here & "\server.js""", 0, False
