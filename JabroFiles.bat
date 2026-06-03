@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo Starting JabroFiles...

rem Prefer local electron (after npm install) for offline / faster startup
if exist "node_modules\.bin\electron.cmd" (
    call "node_modules\.bin\electron.cmd" .
) else (
    echo Using npx (first run may download Electron)...
    npx electron .
)

endlocal
