<script setup>
const props = defineProps({
  tasks: { type: Array, required: true },
})

const emit = defineEmits(['toggle-task', 'delete-task'])
</script>

<template>
  <div class="card">
    <h3>Tasks</h3>
    <p v-if="tasks.length === 0" class="muted">No tasks found.</p>

    <div v-for="task in tasks" :key="task.id" class="task">
      <div>
        <p :class="{ done: task.done }" class="title">{{ task.title }}</p>
        <p v-if="task.note" class="muted">{{ task.note }}</p>
        <span class="badge" :data-priority="task.priority">{{ task.priority }}</span>
      </div>
      <div class="row">
        <button @click="emit('toggle-task', task.id)">
          {{ task.done ? 'Undo' : 'Done' }}
        </button>
        <button class="danger" @click="emit('delete-task', task.id)">Delete</button>
      </div>
    </div>
  </div>
</template>