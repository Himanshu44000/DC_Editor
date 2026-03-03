# Project1

FastAPI project with modular structure and simple startup options.

## Run (No VS Code Required)

### Windows users

1. Double-click start.bat
2. Keep the opened terminal window running
3. Open http://127.0.0.1:8000/docs in browser

If setup fails, the window stays open and shows the error.

### macOS/Linux users

1. chmod +x start.sh
2. ./start.sh
3. Open http://127.0.0.1:8000/docs in browser

## What start.bat/start.sh does

- Uses the project folder as working directory
- Creates .venv if missing
- Installs or updates required packages from requirements.txt
- Copies .env.example to .env if .env is missing
- Starts FastAPI server with uvicorn main:app --reload

## Manual commands (optional)

Use these only if you want to run each step manually (for debugging or custom setup) instead of start.bat/start.sh.

Windows:

python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn main:app --reload

macOS/Linux:

python3 -m venv .venv
./.venv/bin/python -m pip install -r requirements.txt
./.venv/bin/python -m uvicorn main:app --reload

## Important

Running .bat/.sh prepares and runs the API locally on that user machine.
It does not deploy to the public web automatically.
For end users on internet, deploy this backend to a hosting provider.

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
