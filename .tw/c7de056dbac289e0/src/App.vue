<script setup lang="ts">
import { computed, ref } from "vue"

type Expense = { id: number; label: string; amount: number }

const label = ref("")
const amount = ref("")
const list = ref<Expense[]>([
  { id: 1, label: "Hosting", amount: 1200 },
  { id: 2, label: "Email", amount: 700 },
])

const total = computed(() => list.value.reduce((sum, item) => sum + item.amount, 0))

function addExpense() {
  const v = Number(amount.value)
  const l = label.value.trim()
  if (!l || !Number.isFinite(v) || v <= 0) return
  list.value.push({ id: Date.now(), label: l, amount: v })
  label.value = ""
  amount.value = ""
}
</script>

<template>
  <main style="max-width: 700px; margin: 24px auto; padding: 0 16px;">
    <h1>Vue TS Expense Sheet</h1>
    <div style="display:flex; gap:8px;">
      <input v-model="label" placeholder="Label" />
      <input v-model="amount" placeholder="Amount" />
      <button @click="addExpense">Add</button>
    </div>
    <h3>Total: ₹{{ total }}</h3>
    <ul>
      <li v-for="item in list" :key="item.id">{{ item.label }} — ₹{{ item.amount }}</li>
    </ul>
  </main>
</template>