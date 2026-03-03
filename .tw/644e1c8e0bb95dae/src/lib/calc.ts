export type Expense = { id: number; label: string; amount: number }

export const expenses: Expense[] = [
  { id: 1, label: "Hosting", amount: 1200 },
  { id: 2, label: "Email Service", amount: 800 },
  { id: 3, label: "Analytics", amount: 500 },
]

export const totalExpense = (items: Expense[]) => items.reduce((sum, x) => sum + x.amount, 0)
export const averageExpense = (items: Expense[]) => (items.length ? Math.round(totalExpense(items) / items.length) : 0)