@echo off
echo ============================================
echo   Keasy Log Monitor - Starte...
echo ============================================
echo.

cd /d "%~dp0"

:: Prüfe ob Node.js installiert ist
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo FEHLER: Node.js ist nicht installiert!
    echo Bitte installieren: https://nodejs.org/
    pause
    exit /b 1
)

:: Installiere Dependencies falls nötig
if not exist "node_modules" (
    echo Installiere Dependencies...
    call npm install --quiet
    echo.
)

:: Starte den Monitor
echo Starte Log Monitor...
node server.js

pause
