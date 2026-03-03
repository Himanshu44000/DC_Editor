<script setup>
import { ref } from 'vue'

const emit = defineEmits(['add-task'])

const title = ref('')
const note = ref('')
const priority = ref('medium')

const submit = () => {
  const trimmed = title.value.trim()
  if (!trimmed) return

  emit('add-task', {
    title: trimmed,
    note: note.value.trim(),
    priority: priority.value,
  })

  title.value = ''
  note.value = ''
  priority.value = 'medium'
}
</script>

<template>
  <form class="card form" @submit.prevent="submit">
    <h3>Add Task</h3>
    <input v-model="title" placeholder="Task title" />
    <textarea v-model="note" placeholder="Optional note"></textarea>
    <div class="row">
      <select v-model="priority">
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
      <button type="submit">Add</button>
    </div>
  </form>
</template>