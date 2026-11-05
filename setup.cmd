@echo off
rem VRA - installation en une commande : double-clic, ou "setup.cmd -NoGui -Yes" dans un terminal.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\setup.ps1" %*
