@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 20.6 or later from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
if not exist "node_modules\typescript\bin\tsc" (
  call npm.cmd ci
  if errorlevel 1 (
    echo Dependency installation failed. Check the message above and your network.
    pause
    exit /b 1
  )
)
call npm.cmd start
if errorlevel 1 pause
