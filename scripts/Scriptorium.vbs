' Scriptorium'u pencere acmadan baslatir. Kapatmak icin arayuzde Ayarlar > Scriptorium'u kapat.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\Scriptorium.bat""", 0, False
