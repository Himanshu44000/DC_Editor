import argparse
from .app import Expense, total_expenses

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Expense CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    add = sub.add_parser("total", help="calculate total")
    add.add_argument("--item", action="append", default=[], help="Format: label:amount")
    return parser

def main() -> int:
    args = build_parser().parse_args()
    if args.command == "total":
        expenses: list[Expense] = []
        for raw in args.item:
            label, amount = raw.split(":", 1)
            expenses.append(Expense(label=label.strip(), amount=float(amount)))
        print(f"Total: {total_expenses(expenses):.2f}")
        return 0
    return 1