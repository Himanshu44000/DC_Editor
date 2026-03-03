# hmm

Python CLI starter aligned with standard VS Code Python workflows (venv, debugging, testing, linting, type-checking).

## Requirements

- Python 3.10+

## Quick Start

1. Create virtual environment

   ```bash
   python -m venv .venv
   ```

2. Activate environment

   Windows PowerShell:

   ```powershell
   .\.venv\Scripts\Activate.ps1
   ```

   macOS/Linux:

   ```bash
   source .venv/bin/activate
   ```

3. Install project + dev tooling

   ```bash
   python -m pip install --upgrade pip
   python -m pip install -r requirements-dev.txt
   ```

4. Run CLI

   ```bash
   python -m hmm.main greet --name Developer
   ```

   or via generated command:

   ```bash
   hmm greet --name Developer
   ```

## Watch Mode (auto-rerun on changes)

   ```bash
   python -m watchfiles --filter python "python -m hmm.main greet --name Developer" src tests
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
