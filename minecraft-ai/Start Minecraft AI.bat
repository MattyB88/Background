@echo off
title Minecraft AI Buddies
cd /d "%~dp0"
set "NODE=%~dp0data\runtime\node\node.exe"

if not exist "%NODE%" (
  echo First run: downloading a private copy of Node.js, about 30 MB...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\get-node.ps1"
  if errorlevel 1 (
    echo.
    echo Could not download Node.js. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

"%NODE%" "%~dp0app\launcher.js"
if errorlevel 1 pause
