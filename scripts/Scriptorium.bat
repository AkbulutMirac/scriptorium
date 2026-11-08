@echo off
chcp 65001 >nul
cd /d "%~dp0.."
rem Genelde Scriptorium.vbs ile pencere acilmadan calisir. Ciktilar server\data\*.log dosyalarina yazilir.
if not exist server\data mkdir server\data

rem Sunucu zaten calisiyorsa sadece tarayiciyi ac
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7777/api/health -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  start "" http://localhost:7777
  exit /b 0
)

rem Ilk acilista paketleri kur
if not exist node_modules (
  call npm install > server\data\install.log 2>&1
  if errorlevel 1 (
    start "" notepad server\data\install.log
    exit /b 1
  )
)

call npm run build:ui -w web > server\data\build.log 2>&1
if errorlevel 1 (
  rem Pencere gizli oldugu icin hatayi Not Defteri'nde goster
  start "" notepad server\data\build.log
  exit /b 1
)

rem Sunucu ayaga kalkinca tarayiciyi ac
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 40; $i++) { try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7777/api/health -TimeoutSec 1 | Out-Null; Start-Process 'http://localhost:7777'; break } catch { Start-Sleep -Milliseconds 500 } }"
call npm run start -w server > server\data\server.log 2>&1
