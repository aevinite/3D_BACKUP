@echo off
REM ── AEVIDINE PRINT STATION · Windows ───────────────────────────────────────────────────────────
REM Double-click this file on the PC the thermal printer is plugged into. It opens ONE Chrome window,
REM in kiosk mode, on the kitchen panel, with every setting that stops Chrome from going to sleep
REM behind another window — which is why auto-print used to stop the moment somebody minimised it or
REM opened another app.
REM
REM It is a NORMAL Chrome in its OWN profile: log in once and it stays logged in. Your everyday
REM Chrome is untouched.
REM
REM Change these two lines and nothing else.
set "URL=https://3-d-backup.vercel.app/kitchen"
set "PROFILE=%LOCALAPPDATA%\AevidinePrintStation"

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo Google Chrome isn't installed at the usual place. Install Chrome, then run this again.
  pause
  exit /b 1
)

REM Never sleep, never turn the screen off while the station is meant to be printing.
powercfg /change standby-timeout-ac 0 >nul 2>&1
powercfg /change monitor-timeout-ac 0 >nul 2>&1

start "" "%CHROME%" --kiosk --kiosk-printing ^
 --user-data-dir="%PROFILE%" ^
 --disable-background-timer-throttling ^
 --disable-backgrounding-occluded-windows ^
 --disable-renderer-backgrounding ^
 --disable-features=CalculateNativeWinOcclusion ^
 --no-first-run --no-default-browser-check ^
 --autoplay-policy=no-user-gesture-required ^
 "%URL%"
