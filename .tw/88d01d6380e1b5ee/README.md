# pr

Python CLI starter aligned with standard VS Code Python workflows (venv, debugging, testing, linting, type-checking).

## Requirements

- Python 3.10+

## Simplest Run (recommended)

Windows PowerShell:

```powershell
.\start.ps1 greet --name Developer
```

If script policy blocks execution:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1 greet --name Developer
```

Windows Command Prompt:

```bat
start.bat greet --name Developer
```

macOS/Linux:

```bash
./start.sh greet --name Developer
```

These scripts create the .venv folder (if missing), install dependencies, then run the CLI.

## Manual Quick Start

1. Create virtual environment

   ```bash
   python -m venv .venv
   ```

2. Install project + dev tooling

   ```bash
   python -m pip install --upgrade pip
   python -m pip install -r requirements-dev.txt
   ```

3. Run CLI

   ```bash
   python -m pr.main greet --name Developer
   ```

   or via generated command:

   ```bash
   pr greet --name Developer
   ```

## Watch Mode (auto-rerun on changes)

   ```bash
   python -m watchfiles --filter python "python -m pr.main greet --name Developer" src tests
   ```

## Quality Commands

- `python -m pytest` run tests
- `python -m ruff check .` lint code
- `python -m ruff format .` format code
- `python -m mypy src` basic type-check

## VS Code

- Recommended extensions are included in `.vscode/extensions.json`.
- Press `F5` and run `Python: CLI Module` to debug the CLI.
- Tests are auto-discovered from `tests/`.
