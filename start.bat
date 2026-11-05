@echo off
cd /d "%~dp0"
if not defined LINGUA_AUTO_OPEN set LINGUA_AUTO_OPEN=1
set "LINGUA_RUNTIME=%~dp0runtime\node.exe"

if not exist "%~dp0.unblocked" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1
  >"%~dp0.unblocked" echo ready
)

if not exist "%LINGUA_RUNTIME%" (
  echo.
  echo [Lingua Player] Startup failed: runtime\node.exe is missing.
  echo Download again, extract the entire ZIP, then run start.bat.
  echo.
  pause
  exit /b 1
)

"%LINGUA_RUNTIME%" server.js
set "LINGUA_EXIT_CODE=%errorlevel%"

if not "%LINGUA_EXIT_CODE%"=="0" (
  echo.
  echo [Lingua Player] Startup failed. Error code: %LINGUA_EXIT_CODE%
  echo Keep this window open and send a screenshot for support.
  echo.
  pause
)
