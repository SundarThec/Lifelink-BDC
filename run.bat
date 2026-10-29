@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title LifeLink - Centralized Blood Donation Community Platform
cd /d "%~dp0."

echo ============================================================
echo   LifeLink Blood Donation Community Platform Launcher
echo ============================================================
echo.

:: 1. Check Node.js installation
echo [Step 1/6] Checking Node.js environment...
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 goto NODE_FOUND
echo.
echo [ERROR] Node.js was not found in your system PATH.
echo Please install Node.js (version 18 or higher) from https://nodejs.org/
echo.
pause
exit /b 1

:NODE_FOUND
for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo [OK] Found Node.js %NODE_VERSION%

:: 2. Check dependencies
echo.
echo [Step 2/6] Checking project dependencies...
if exist "node_modules\" goto DEPS_FOUND
echo [INFO] Folder 'node_modules' not found. Installing packages via npm...
call npm.cmd install
if %ERRORLEVEL% EQU 0 goto DEPS_FOUND
echo.
echo [ERROR] npm install encountered an error.
pause
exit /b 1

:DEPS_FOUND
echo [OK] Node modules are installed.

:: 3. Check for .env file
echo.
echo [Step 3/6] Verifying environment configuration...
if exist ".env" goto ENV_FOUND
if exist ".env.example" (
    echo [INFO] .env not found. Initializing from .env.example...
    copy ".env.example" ".env" >nul
    echo [OK] Created .env from template.
    goto ENV_DONE
)
echo [WARNING] No .env or .env.example found. Default settings will be used.
goto ENV_DONE

:ENV_FOUND
echo [OK] .env configuration file detected.

:ENV_DONE

:: 4. Check Email Notification Service status
echo.
echo [Step 4/6] Checking Real Email Notification Service...
set EMAIL_STATUS_LINE=
set EMAIL_USER=
set EMAIL_SERVICE=

for /f "tokens=1,2,3 delims=|" %%a in ('node server/utils/configureEmailCLI.js status ^| findstr "^STATUS:"') do (
    set EMAIL_STATUS_LINE=%%a
    set EMAIL_USER=%%b
    set EMAIL_SERVICE=%%c
)

if "%EMAIL_STATUS_LINE%"=="STATUS:CONFIGURED" (
    echo [OK] Real Email Notifications: ACTIVE
    echo [OK] Dispatching Account: !EMAIL_USER! (!EMAIL_SERVICE!)
    echo [INFO] Live emergency blood requests will alert nearby donors via real email.
) else (
    echo [INFO] Real Email Notifications: NOT CONFIGURED
    echo [INFO] Emergency requests will alert in-app, but real emails are disabled.
    echo.
    set /p "SETUP_EMAIL=Would you like to configure your Gmail or SMTP credentials now? [y/N]: "
    if /i "!SETUP_EMAIL!"=="y" (
        node server/utils/configureEmailCLI.js setup
    )
)

:: 5. Check and start MongoDB Database service
echo.
echo [Step 5/6] Checking MongoDB Database service...
netstat -ano | findstr ":27017" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto MONGO_OK

echo [INFO] MongoDB is not running on port 27017. Attempting to start Windows MongoDB service...
sc query MongoDB >nul 2>&1
if errorlevel 1 goto MONGO_NO_SVC

net start MongoDB >nul 2>&1
netstat -ano | findstr ":27017" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [OK] MongoDB service started successfully.
    goto MONGO_DONE
)
echo [WARNING] Could not start MongoDB service automatically.
echo [INFO] If permission was denied, please run this script as Administrator or start MongoDB manually.
goto MONGO_DONE

:MONGO_NO_SVC
echo [WARNING] Windows service 'MongoDB' was not found.
echo [INFO] If MongoDB is running in Docker or standalone mongod, please ensure it listens on port 27017.
goto MONGO_DONE

:MONGO_OK
echo [OK] MongoDB is running on port 27017.

:MONGO_DONE

:: 6. Free port 5000 if occupied by an orphaned server instance
echo.
echo [Step 6/6] Checking application port 5000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do (
    echo [INFO] Port 5000 is occupied by process PID %%p. Freeing port...
    taskkill /F /PID %%p >nul 2>&1
)
ping 127.0.0.1 -n 2 >nul

echo.
echo ============================================================
echo   Starting LifeLink Server...
echo   Web Client URL:  http://localhost:5000
echo   API Endpoint:    http://localhost:5000/api/v1
echo   Configure Email: Run setup_email.bat anytime
echo ============================================================
echo.

:: Launch default browser after 3 seconds
start "" cmd /c "ping 127.0.0.1 -n 4 >nul & start http://localhost:5000"

:: Launch Node.js server
node server/server.js

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [WARNING] Server stopped with exit code: %ERRORLEVEL%
)

echo.
echo ============================================================
echo Server stopped. Press any key to close this terminal.
echo ============================================================
pause
