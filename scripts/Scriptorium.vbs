' Starts Scriptorium without a console window. To stop it: Settings > Quit Scriptorium in the app.
' Arguments are passed on to Scriptorium.bat (e.g. --no-browser).
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
args = ""
For Each arg In WScript.Arguments
  args = args & " """ & arg & """"
Next
CreateObject("WScript.Shell").Run """" & dir & "\Scriptorium.bat""" & args, 0, False
