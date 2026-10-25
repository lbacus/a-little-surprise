@echo off
rem Double-click to start the phone preview server in its own window.
rem It keeps running until you close this window, even if Claude restarts.
title Sofia preview server
cd /d "%~dp0"
node serve.js
pause
