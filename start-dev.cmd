@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-dev.ps1"
if errorlevel 1 (
    echo.
    echo Failed to start AI Hub development environment. See the error above.
    pause
    exit /b 1
)
endlocal
