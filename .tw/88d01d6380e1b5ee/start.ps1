$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

if (-not (Test-Path '.\.venv\Scripts\python.exe')) {
  python -m venv .venv
}

$pythonExe = '.\.venv\Scripts\python.exe'
& $pythonExe -m pip install --upgrade pip | Out-Null
& $pythonExe -m pip install -r requirements-dev.txt | Out-Null

if ($args.Count -eq 0) {
  & $pythonExe -m pr.main greet --name Developer
} else {
  & $pythonExe -m pr.main @args
}
