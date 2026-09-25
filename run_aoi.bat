@echo off
REM One-click AOI start on Windows. First run installs dependencies.
cd /d %~dp0
python -m pip install -q -r requirements-aoi.txt
start "" http://localhost:5050
python -m aoi.app
