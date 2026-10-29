@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title LifeLink - Real Email Notification Service Setup
cd /d "%~dp0."

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is required to configure email notifications.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

node server/utils/configureEmailCLI.js setup

echo.
echo Press any key to exit...
pause >nul
