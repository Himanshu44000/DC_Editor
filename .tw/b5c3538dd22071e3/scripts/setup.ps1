$ErrorActionPreference = 'Stop'

python -m venv .venv

$pythonExe = '.\.venv\Scripts\python.exe'
& $pythonExe -m pip install --upgrade pip
& $pythonExe -m pip install -r requirements.txt

if (-not (Test-Path '.env') -and (Test-Path '.env.example')) {
  Copy-Item '.env.example' '.env'
}

Write-Host 'FastAPI environment is ready.'
Write-Host 'Run: .\.venv\Scripts\python.exe -m uvicorn main:app --reload'
