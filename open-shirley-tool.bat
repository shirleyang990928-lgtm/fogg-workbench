@echo off
cd /d "%~dp0"
echo Starting local server at http://localhost:8090
start "" "http://localhost:8090"
python serve.py
pause
