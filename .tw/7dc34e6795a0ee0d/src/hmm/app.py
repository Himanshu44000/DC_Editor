from dataclasses import dataclass

@dataclass(slots=True)
class Expense:
    label: str
    amount: float

def total_expenses(items: list[Expense]) -> float:
    return round(sum(item.amount for item in items), 2)