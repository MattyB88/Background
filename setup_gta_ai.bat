@echo off
REM One-time setup on Windows: creates .venv and installs dependencies.
REM vgamepad's installer will offer to install the ViGEmBus driver - accept it, then reboot.
cd /d "%~dp0"
py -3.12 -m venv .venv 2>nul || py -3 -m venv .venv || python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements-gta-ai.txt
if not exist config.toml copy config.example.toml config.toml
echo.
echo Setup done. Next:
echo   1. set ANTHROPIC_API_KEY=sk-ant-...   (or setx ANTHROPIC_API_KEY ... once)
echo   2. edit config.toml
echo   3. run_gta_ai.bat preflight   then   run_gta_ai.bat
pause
