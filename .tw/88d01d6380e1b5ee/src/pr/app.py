from pathlib import Path
import json
from typing import TypedDict


class Expense(TypedDict):
    label: str
    amount: float


_DB_PATH = Path(__file__).resolve().parents[2] / "expenses.json"


def load_expenses() -> list[Expense]:
    if not _DB_PATH.exists():
        return []
    data = json.loads(_DB_PATH.read_text(encoding="utf-8"))
    rows: list[Expense] = []
    for item in data:
        rows.append({"label": str(item["label"]), "amount": float(item["amount"])})
    return rows


def save_expenses(rows: list[Expense]) -> None:
    _DB_PATH.write_text(json.dumps(rows, indent=2), encoding="utf-8")


def add_expense(label: str, amount: float) -> Expense:
    rows = load_expenses()
    row: Expense = {"label": label.strip(), "amount": float(amount)}
    rows.append(row)
    save_expenses(rows)
    return row


def get_total() -> float:
    return round(sum(item["amount"] for item in load_expenses()), 2)


def clear_expenses() -> None:
    save_expenses([])


def format_rows(rows: list[Expense]) -> str:
    lines = [f"- {item['label']}: ₹{item['amount']:.2f}" for item in rows]
    return "\n".join(lines)