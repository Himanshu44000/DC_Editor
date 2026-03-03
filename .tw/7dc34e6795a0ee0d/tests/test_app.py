from my_python_cli.app import Expense, total_expenses

def test_total_expenses() -> None:
    items = [Expense("hosting", 1200), Expense("email", 700)]
    assert total_expenses(items) == 1900