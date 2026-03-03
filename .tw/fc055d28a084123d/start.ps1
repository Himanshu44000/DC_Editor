$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

Write-Host '[FastAPI] Starting setup...'

if (-not (Test-Path 'requirements.txt')) {
  throw '[FastAPI] requirements.txt not found in this folder.'
}

if (-not (Test-Path '.\.venv\Scripts\python.exe')) {
  Write-Host '[FastAPI] Creating virtual environment...'
  if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 -m venv .venv
  } elseif (Get-Command python -ErrorAction SilentlyContinue) {
    & python -m venv .venv
  } else {
    throw '[FastAPI] Python not found. Install Python 3 and try again.'
  }
}

Write-Host '[FastAPI] Installing/updating dependencies...'
$pythonExe = '.\.venv\Scripts\python.exe'
$pipFlags = @('--disable-pip-version-check', '--no-input')
$uvicornFlags = @('--log-level', 'warning', '--no-access-log')
if (-not $env:FASTAPI_VERBOSE) {
  $pipFlags += '-q'
} else {
  $uvicornFlags = @('--log-level', 'info')
}
if ($env:FASTAPI_RELOAD) {
  $uvicornFlags += '--reload'
}
& $pythonExe -m pip install @pipFlags --upgrade pip
& $pythonExe -m pip install @pipFlags -r requirements.txt

if (-not (Test-Path '.env') -and (Test-Path '.env.example')) {
  Copy-Item '.env.example' '.env'
}

$appTarget = $env:FASTAPI_APP
if (-not $appTarget) {
  if (Test-Path 'main.py') {
    $appTarget = 'main:app'
  } elseif (Test-Path 'app\\main.py') {
    $appTarget = 'app.main:app'
  } elseif (Test-Path 'src\\main.py') {
    $appTarget = 'src.main:app'
  } elseif (Test-Path 'app.py') {
    $appTarget = 'app:app'
  } else {
    $appTarget = 'main:app'
  }
}

Write-Host "[FastAPI] Server running at http://127.0.0.1:8000 ($appTarget)"
& $pythonExe -m uvicorn $appTarget @uvicornFlags
