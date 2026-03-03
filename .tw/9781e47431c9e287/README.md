# hmm

FastAPI project with modular structure and simple startup options.

## Run (No VS Code Required)

### If you are using this web IDE terminal

Run:

.\start.ps1

If script policy blocks it:

powershell -ExecutionPolicy Bypass -File .\start.ps1

Then keep terminal running and open http://127.0.0.1:8000/docs in browser.

### Local machine alternatives

- Windows File Explorer: double-click start.bat
- macOS/Linux terminal: chmod +x start.sh && ./start.sh

## What startup scripts do

- Use the project folder as working directory
- Create .venv if missing
- Install or update packages from requirements.txt
- Copy .env.example to .env if .env is missing
- Start FastAPI with uvicorn main:app --reload

By default, logs are quiet for users (clean output).
Set FASTAPI_VERBOSE=1 before running script to show full pip + uvicorn logs.

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

## OS note for web IDE terminals

The terminal runs on the machine/container hosting this app, not on the browser user's device.
So command style should match the runtime OS of that terminal environment.

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
