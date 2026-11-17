@echo off
REM   run_gta_ai.bat             -> start the AI (paused; press F8 to go live)
REM   run_gta_ai.bat preflight   -> capture + gamepad checks
REM   run_gta_ai.bat mock        -> full pipeline with a fake brain (no API cost)
cd /d "%~dp0"
call .venv\Scripts\activate.bat
if /i "%1"=="preflight" (
  python -m gta_ai.preflight -c config.toml --capture --pad
  goto :eof
)
if /i "%1"=="mock" (
  python -m gta_ai -c config.toml --brain mock
  goto :eof
)
python -m gta_ai -c config.toml %*
