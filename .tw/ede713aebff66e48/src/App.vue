<script setup>
import { computed, ref } from "vue"

const input = ref("")
const todos = ref(["Read docs", "Write tests"])
const total = computed(() => todos.value.length)

function addTodo() {
  const v = input.value.trim()
  if (!v) return
  todos.value.unshift(v)
  input.value = ""
}
</script>

<template>
  <main style="max-width: 700px; margin: 24px auto; padding: 0 16px;">
    <h1>Vue JS Task Pad</h1>
    <div style="display:flex; gap:8px;">
      <input v-model="input" placeholder="New todo" />
      <button @click="addTodo">Add</button>
    </div>
    <p>Total: {{ total }}</p>
    <ul>
      <li v-for="(todo, idx) in todos" :key="idx">{{ todo }}</li>
    </ul>
  </main>
</template>