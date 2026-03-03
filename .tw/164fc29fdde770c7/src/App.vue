<script setup>
import { computed, ref, watch } from 'vue'
import TaskForm from './components/TaskForm.vue'
import TaskList from './components/TaskList.vue'

const STORAGE_KEY = 'vue_vite_tasks_v1'

const tasks = ref(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'))
const search = ref('')
const filter = ref('all')

watch(
  tasks,
  (value) => localStorage.setItem(STORAGE_KEY, JSON.stringify(value)),
  { deep: true },
)

const addTask = ({ title, note, priority }) => {
  tasks.value.unshift({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    title,
    note,
    priority,
    done: false,
    createdAt: Date.now(),
  })
}

const toggleTask = (id) => {
  tasks.value = tasks.value.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
}

const deleteTask = (id) => {
  tasks.value = tasks.value.filter((t) => t.id !== id)
}

const stats = computed(() => {
  const total = tasks.value.length
  const done = tasks.value.filter((t) => t.done).length
  return { total, done, open: total - done }
})

const filteredTasks = computed(() => {
  const q = search.value.trim().toLowerCase()
  return tasks.value
    .filter((t) => {
      if (filter.value === 'open') return !t.done
      if (filter.value === 'done') return t.done
      return true
    })
    .filter((t) => {
      if (!q) return true
      return t.title.toLowerCase().includes(q) || t.note.toLowerCase().includes(q)
    })
})
</script>

<template>
  <main class="container">
    <header class="card">
      <h1>Vue Task Board</h1>
      <p class="muted">Vite + Vue (JavaScript) test app with localStorage persistence.</p>
      <div class="stats">
        <span>Total: {{ stats.total }}</span>
        <span>Open: {{ stats.open }}</span>
        <span>Done: {{ stats.done }}</span>
      </div>
    </header>

    <TaskForm @add-task="addTask" />

    <section class="card row">
      <input v-model="search" placeholder="Search tasks..." />
      <select v-model="filter">
        <option value="all">All</option>
        <option value="open">Open</option>
        <option value="done">Done</option>
      </select>
    </section>

    <TaskList :tasks="filteredTasks" @toggle-task="toggleTask" @delete-task="deleteTask" />
  </main>
</template>