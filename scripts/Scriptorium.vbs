' Starts Scriptorium without a console window. To stop it: Settings > Quit Scriptorium in the app.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\Scriptorium.bat""", 0, False
