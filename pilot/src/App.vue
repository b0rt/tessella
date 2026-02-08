<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useWebSocket } from '@/composables/useWebSocket'
import ClientList from '@/components/ClientList.vue'
import TextPanel from '@/components/panels/TextPanel.vue'
import ImagePanel from '@/components/panels/ImagePanel.vue'
import VideoPanel from '@/components/panels/VideoPanel.vue'
import BackgroundPanel from '@/components/panels/BackgroundPanel.vue'
import EffectsPanel from '@/components/panels/EffectsPanel.vue'
import ControlPanel from '@/components/panels/ControlPanel.vue'
import ActivityLog from '@/components/panels/ActivityLog.vue'

const { connected, clients, logs, send, log, clearLogs } = useWebSocket()

const selectedTarget = ref<number | 'all'>('all')

function handleSend(msg: Record<string, unknown>) {
  send(msg)
}

function handleLog(message: string) {
  log(message)
}

// Keyboard shortcuts
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    send({
      type: 'clear',
      target: selectedTarget.value,
      style: 'fade',
    })
    log('Displays geleert')
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="min-h-screen bg-background">
    <!-- Header -->
    <header class="border-b border-border px-6 py-4 flex items-center justify-between">
      <h1 class="text-sm font-medium uppercase tracking-widest text-primary">
        🎛️ Installation Control
      </h1>
      <div class="flex items-center gap-2 text-sm text-muted-foreground">
        <span
          class="w-2 h-2 rounded-full"
          :class="connected ? 'bg-green-500' : 'bg-red-500'"
        />
        <span>{{ connected ? 'Verbunden' : 'Getrennt – verbinde...' }}</span>
      </div>
    </header>

    <!-- Main layout -->
    <div class="flex h-[calc(100vh-65px)]">
      <!-- Sidebar -->
      <aside class="w-72 border-r border-border p-4 flex-shrink-0">
        <ClientList
          :clients="clients"
          v-model:selectedTarget="selectedTarget"
        />
      </aside>

      <!-- Main content -->
      <main class="flex-1 overflow-y-auto p-6 space-y-6">
        <TextPanel
          :selectedTarget="selectedTarget"
          @send="handleSend"
          @log="handleLog"
        />

        <ImagePanel
          :selectedTarget="selectedTarget"
          :clients="clients"
          @send="handleSend"
          @log="handleLog"
        />

        <VideoPanel
          :selectedTarget="selectedTarget"
          @send="handleSend"
          @log="handleLog"
        />

        <BackgroundPanel
          :selectedTarget="selectedTarget"
          @send="handleSend"
          @log="handleLog"
        />

        <EffectsPanel
          :selectedTarget="selectedTarget"
          @send="handleSend"
          @log="handleLog"
        />

        <ControlPanel
          :selectedTarget="selectedTarget"
          @send="handleSend"
          @log="handleLog"
        />

        <ActivityLog
          :logs="logs"
          @clear="clearLogs"
        />
      </main>
    </div>
  </div>
</template>
