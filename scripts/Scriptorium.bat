@echo off
set "NOBROWSER=" & if /i "%~1"=="--no-browser" set "NOBROWSER=1"
chcp 65001 >nul
cd /d "%~dp0.."
rem Usually run by Scriptorium.vbs without a console window. Output goes to server\data\*.log.
if not exist server\data mkdir server\data

rem If the server is already running, just open the browser (unless --no-browser)
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7777/api/health -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  if not defined NOBROWSER start "" http://localhost:7777
  exit /b 0
)

rem Install packages on first launch
if not exist node_modules (
  call npm install > server\data\install.log 2>&1
  if errorlevel 1 (
    start "" notepad server\data\install.log
    exit /b 1
  )
)

call npm run build:ui -w web > server\data\build.log 2>&1
if errorlevel 1 (
  rem The window is hidden, so show the error in Notepad
  start "" notepad server\data\build.log
  exit /b 1
)

rem Open the browser once the server is up (unless --no-browser)
if not defined NOBROWSER start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for ($i = 0; $i -lt 40; $i++) { try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:7777/api/health -TimeoutSec 1 | Out-Null; Start-Process 'http://localhost:7777'; break } catch { Start-Sleep -Milliseconds 500 } }"
call npm run start -w server > server\data\server.log 2>&1
