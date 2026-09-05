@echo off
setlocal enabledelayedexpansion
title Neon Glow installer

echo.
echo   Neon Glow
echo   =========
echo.

rem ---------------------------------------------------------------- VS Code
rem Each check is its own line on purpose: %ProgramFiles(x86)% carries a ")"
rem that would close a parenthesised if/for block early.
set "VSCODE="
if exist "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" set "VSCODE=%LOCALAPPDATA%\Programs\Microsoft VS Code"
if not defined VSCODE if exist "%ProgramFiles%\Microsoft VS Code\Code.exe" set "VSCODE=%ProgramFiles%\Microsoft VS Code"
if not defined VSCODE if exist "%ProgramFiles(x86)%\Microsoft VS Code\Code.exe" set "VSCODE=%ProgramFiles(x86)%\Microsoft VS Code"

if not defined VSCODE (
  echo   VS Code was not found in any of the usual places.
  echo   Install VS Code first, then run this again.
  goto :stop
)
echo   VS Code   : !VSCODE!

rem ------------------------------------------------------------------- VSIX
set "VSIX="
set "VSIXNAME="
for %%f in ("%~dp0*.vsix") do (
  set "VSIX=%%~ff"
  set "VSIXNAME=%%~nf"
)
if not defined VSIX (
  echo   No .vsix file sits next to this script.
  echo   Keep install.cmd and the .vsix in the same folder.
  goto :stop
)
echo   Package   : !VSIXNAME!.vsix
echo.

echo   [1/2] Installing the extension...
call "!VSCODE!\bin\code.cmd" --install-extension "!VSIX!" --force
if errorlevel 1 (
  echo.
  echo   The extension failed to install.
  goto :stop
)

rem ------------------------------------------------------------------ patch
rem The extension ships install.js, so patch from the copy that was just
rem installed. VS Code is Electron, so Code.exe doubles as the Node that runs
rem it - nothing else has to be on the machine.
set "VER=!VSIXNAME:neon-glow-=!"
set "EXTROOT=%USERPROFILE%\.vscode\extensions"
set "EXTDIR=!EXTROOT!\ruminem.vscode-neon-glow-!VER!"
if not exist "!EXTDIR!\install.js" (
  set "EXTDIR="
  for /d %%d in ("!EXTROOT!\ruminem.vscode-neon-glow-*") do set "EXTDIR=%%~fd"
)
if not defined EXTDIR (
  echo.
  echo   The extension installed, but its folder could not be found.
  echo   Open VS Code and run "Neon Glow: Install (patch workbench)" instead.
  goto :stop
)

echo   [2/2] Patching the workbench bundle...
set ELECTRON_RUN_AS_NODE=1
"!VSCODE!\Code.exe" "!EXTDIR!\install.js"
if errorlevel 1 (
  echo.
  echo   Could not write to the VS Code install directory.
  echo   Right-click install.cmd and choose "Run as administrator", then retry.
  goto :stop
)

echo.
echo   Done. Now quit VS Code COMPLETELY and start it again.
echo   "Reload Window" is not enough - it replays the old bundle from cache.
echo.
pause
exit /b 0

:stop
echo.
pause
exit /b 1
