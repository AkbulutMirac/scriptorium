# Creates a "Scriptorium" shortcut on the desktop:
#   powershell -ExecutionPolicy Bypass -File scripts\CreateShortcut.ps1
$repo = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut((Join-Path $desktop "Scriptorium.lnk"))
$lnk.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
$lnk.Arguments = '"' + (Join-Path $repo "scripts\Scriptorium.vbs") + '"'
$lnk.WorkingDirectory = Join-Path $repo "scripts"
$lnk.IconLocation = (Join-Path $repo "scripts\scriptorium.ico") + ",0"
$lnk.Save()
Write-Host "Shortcut created: $(Join-Path $desktop 'Scriptorium.lnk')"
