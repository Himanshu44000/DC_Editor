$ErrorActionPreference = 'Stop'

python -m venv .venv

$pythonExe = '.\.venv\Scripts\python.exe'
$pipFlags = @('--disable-pip-version-check', '--no-input')
if (-not $env:FASTAPI_VERBOSE) {
  $pipFlags += '-q'
}
& $pythonExe -m pip install @pipFlags --upgrade pip
& $pythonExe -m pip install @pipFlags -r requirements.txt

if (-not (Test-Path '.env') -and (Test-Path '.env.example')) {
  Copy-Item '.env.example' '.env'
}

Write-Host 'FastAPI environment is ready.'
Write-Host 'Run: .\.venv\Scripts\python.exe -m uvicorn main:app --reload'
