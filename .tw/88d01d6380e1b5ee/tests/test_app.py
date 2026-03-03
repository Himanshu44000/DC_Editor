from pathlib import Path
import importlib


def test_add_and_total(tmp_path: Path, monkeypatch) -> None:
    import <package_name>.app as app  # replace <package_name>
    monkeypatch.setattr(app, "_DB_PATH", tmp_path / "expenses.json")

    app.add_expense("Hosting", 1200)
    app.add_expense("Email", 700)

    assert app.get_total() == 1900.0
    assert len(app.load_expenses()) == 2