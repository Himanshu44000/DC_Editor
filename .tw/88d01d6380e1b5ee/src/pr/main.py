import argparse

from .app import add_expense, clear_expenses, format_rows, get_total, load_expenses


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Expense CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    add_cmd = sub.add_parser("add", help="add an expense")
    add_cmd.add_argument("--label", required=True, help="Expense label")
    add_cmd.add_argument("--amount", required=True, type=float, help="Expense amount")

    sub.add_parser("list", help="list all expenses")
    sub.add_parser("total", help="show total amount")
    sub.add_parser("clear", help="remove all expenses")

    return parser


def main() -> int:
    args = build_parser().parse_args()

    if args.command == "add":
        row = add_expense(args.label, args.amount)
        print(f"Added: {row['label']} = Rs{row['amount']:.2f}")
        return 0

    if args.command == "list":
        rows = load_expenses()
        if not rows:
            print("No expenses found.")
            return 0
        print(format_rows(rows))
        return 0

    if args.command == "total":
        print(f"Total: Rs{get_total():.2f}")
        return 0

    if args.command == "clear":
        clear_expenses()
        print("All expenses cleared.")
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())