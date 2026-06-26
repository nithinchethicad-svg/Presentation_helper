@echo off
title AI Slidekick DevTools Launcher
echo Checking if AI Slidekick is already running...

set "PROJECT_DIR=%~dp0"
set "NEED_WAIT=0"

:: Check if backend (port 5000) is already listening
netstat -ano | findstr LISTENING | findstr :5000 > nul
if %errorlevel% equ 0 (
    echo Backend is already running.
) else (
    echo Starting Backend Server...
    start "AI Slidekick Backend" /min cmd /c "cd /d %PROJECT_DIR%backend && npm run dev"
    set "NEED_WAIT=1"
)

:: Check if frontend (port 5173) is already listening
netstat -ano | findstr LISTENING | findstr :5173 > nul
if %errorlevel% equ 0 (
    echo Frontend is already running.
) else (
    echo Starting Frontend Server...
    start "AI Slidekick Frontend" /min cmd /c "cd /d %PROJECT_DIR%frontend && npm run dev"
    set "NEED_WAIT=1"
)

:: Only wait for initialization if we started a new server
if "%NEED_WAIT%"=="1" (
    echo Waiting for servers to initialize...
    timeout /t 3 /nobreak > nul
)

:: Open the DevTools in the default browser
echo Opening AI Slidekick DevTools...
start http://localhost:5173/#/devtools

exit
