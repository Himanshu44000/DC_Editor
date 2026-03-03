# tm1

Practical Python CLI starter with argument parsing and a clean app entrypoint.

## Requirements

- Python 3.10+

## Quick Start

1. Create and activate virtual environment

   ```bash
   python -m venv .venv
   # Windows PowerShell
   .\.venv\Scripts\Activate.ps1
   # macOS/Linux
   # source .venv/bin/activate
   ```

2. Install dependencies

   ```bash
   pip install -r requirements.txt
   ```

3. Run CLI

   ```bash
   python src/main.py --name Developer
   ```

## Structure

- `src/main.py` entrypoint
- `src/app.py` application logic
- `requirements.txt` dependencies
