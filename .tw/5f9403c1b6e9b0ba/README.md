# Project1

FastAPI project with modular structure and simple startup options.

## Run (No VS Code Required)

### Windows users

Use one option:

- Local machine (File Explorer): double-click start.bat
- Browser/cloud terminal with PowerShell: run .\start.ps1
- Browser/cloud terminal with cmd shell: run start.bat

Then keep terminal running and open http://127.0.0.1:8000/docs in browser.

### macOS/Linux users

1. chmod +x start.sh
2. ./start.sh
3. Open http://127.0.0.1:8000/docs in browser

## What startup scripts do

- Use the project folder as working directory
- Create .venv if missing
- Install or update packages from requirements.txt
- Copy .env.example to .env if .env is missing
- Start FastAPI with uvicorn main:app --reload

## Manual commands (optional)

Use these only if you want to run each step manually (debugging/custom setup) instead of startup scripts.

Windows (PowerShell/cmd):

python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn main:app --reload

macOS/Linux:

python3 -m venv .venv
./.venv/bin/python -m pip install -r requirements.txt
./.venv/bin/python -m uvicorn main:app --reload

Do not run ./.venv/bin/python on Windows. That path is only for macOS/Linux.

## Important

Running .bat/.ps1/.sh prepares and runs the API locally on that machine.
It does not deploy to the public web automatically.
For internet users, deploy this backend to a hosting provider.

## Endpoints

- http://127.0.0.1:8000/
- http://127.0.0.1:8000/api/health
- http://127.0.0.1:8000/docs

## Structure

- app/main.py (application bootstrap)
- api/routes/health.py (API router)
- core/config.py (environment settings)
- schemas/ping.py (response model)
- main.py (entrypoint)
