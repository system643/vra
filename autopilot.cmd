@echo off
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable : lance d'abord setup.cmd.
  exit /b 1
)
node "%~dp0setup\autopilot.mjs" %*
