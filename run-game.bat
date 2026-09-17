@echo off
title Desmon Run
cd /d "%~dp0"
echo Starting Desmon Run at http://localhost:8000/game/
start "" http://localhost:8000/game/
python -m http.server 8000
pause
