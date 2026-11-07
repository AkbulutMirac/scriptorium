@echo off
chcp 65001 >nul
title Scriptorium sunucusu
cd /d "%~dp0.."

rem Sunucu zaten calisiyorsa sadece tarayiciyi ac
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7777/api/health -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  start "" http://localhost:7777
  exit /b 0
)

echo Scriptorium baslatiliyor. Bu pencereyi kapatirsan sunucu da kapanir.
call npm run build:ui -w web
if errorlevel 1 (
  echo Arayuz derlenemedi.
  pause
  exit /b 1
)

rem Sunucu ayaga kalkinca tarayiciyi ac
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 40; $i++) { try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7777/api/health -TimeoutSec 1 | Out-Null; Start-Process 'http://localhost:7777'; break } catch { Start-Sleep -Milliseconds 500 } }"
call npm run start -w server
pause
