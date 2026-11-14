@echo off
rem Double-click to run the watcher. If it ever exits, it is restarted after 10 seconds.
rem Close this window to stop it.
cd /d "%~dp0"
title GT Ticket Watcher
:loop
call npm start
echo.
echo Watcher exited. Restarting in 10 seconds... (close this window to stop)
timeout /t 10 /nobreak >nul
goto loop
