<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useWebSocket } from '@/composables/useWebSocket'
import { useTheme } from '@/composables/useTheme'
import ClientList from '@/components/ClientList.vue'
import TextPanel from '@/components/panels/TextPanel.vue'
import ImagePanel from '@/components/panels/ImagePanel.vue'
import VideoPanel from '@/components/panels/VideoPanel.vue'
import EyeballPanel from '@/components/panels/EyeballPanel.vue'
import BackgroundPanel from '@/components/panels/BackgroundPanel.vue'
import EffectsPanel from '@/components/panels/EffectsPanel.vue'
import { Button } from '@/components/ui/button'
import ScenesPanel from '@/components/panels/ScenesPanel.vue'
import PrecomposePanel from '@/components/panels/PrecomposePanel.vue'
import ActivityLog from '@/components/panels/ActivityLog.vue'

const { connected, clients, logs, precomposeStatus, send, log, clearLogs } = useWebSocket()
const { theme, toggleTheme } = useTheme()

const selectedTarget = ref<number | 'all'>('all')
const footerTab = ref<'scenes' | 'precompose' | 'logs'>('scenes')
const formKey = ref(0)

function handleSceneCaptured() {
  // Clear all displays
  send({ type: 'clear', target: 'all', style: 'fade' })
  log('Displays geleert')
  // Reset form panels by remounting them
  formKey.value++
}

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
  <div class="h-screen flex flex-col bg-background">
    <!-- Header -->
    <header class="border-b border-border px-6 py-4 flex items-center justify-between">
      <h1 class="text-sm font-medium uppercase tracking-widest text-primary">
        🎛️ Tessella
      </h1>
      <div class="flex items-center gap-4">
        <Button
          variant="outline"
          size="sm"
          @click="toggleTheme"
          :title="theme === 'dark' ? 'Zum hellen Modus wechseln' : 'Zum dunklen Modus wechseln'"
        >
          <span v-if="theme === 'dark'">☀️ Hell</span>
          <span v-else>🌙 Dunkel</span>
        </Button>
        <Button variant="destructive" size="sm" @click="send({ type: 'clear', target: selectedTarget, style: 'fade' }); log('Displays geleert')">
          🗑 Alles stoppen
        </Button>
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <span
            class="w-2 h-2 rounded-full"
            :class="connected ? 'bg-green-500' : 'bg-red-500'"
          />
          <span>{{ connected ? 'Verbunden' : 'Getrennt – verbinde...' }}</span>
        </div>
      </div>
    </header>

    <!-- Main layout -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Sidebar -->
      <aside class="w-72 border-r border-border p-4 flex-shrink-0 overflow-y-auto">
        <ClientList
          :clients="clients"
          v-model:selectedTarget="selectedTarget"
          :precomposeStatus="precomposeStatus"
        />
      </aside>

      <!-- Main content -->
      <main class="flex-1 overflow-y-auto p-6 space-y-6">
        <TextPanel
          :key="formKey"
          :selectedTarget="selectedTarget"
          @send="handleSend"
          @log="handleLog"
        />

        <ImagePanel
          :key="formKey"
          :selectedTarget="selectedTarget"
          :clients="clients"
          @send="handleSend"
          @log="handleLog"
        />

        <VideoPanel
          :key="formKey"
          :selectedTarget="selectedTarget"
          @send="handleSend"
          @log="handleLog"
        />

        <EyeballPanel
          :key="formKey"
          :selectedTarget="selectedTarget"
          :clients="clients"
          @send="handleSend"
          @log="handleLog"
        />

        <BackgroundPanel
          :key="formKey"
          :selectedTarget="selectedTarget"
          @send="handleSend"
          @log="handleLog"
        />

        <EffectsPanel
          :key="formKey"
          :selectedTarget="selectedTarget"
          @send="handleSend"
          @log="handleLog"
        />
      </main>
    </div>

    <!-- Footer -->
    <footer class="border-t border-border flex-shrink-0 max-h-[40vh] flex flex-col">
      <div class="flex items-center gap-1 px-6 pt-2">
        <button
          class="px-3 py-1.5 text-sm font-medium rounded-t-md transition-colors"
          :class="footerTab === 'scenes' ? 'bg-background border border-b-0 border-border text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="footerTab = 'scenes'"
        >
          Szenen & Timeline
        </button>
        <button
          class="px-3 py-1.5 text-sm font-medium rounded-t-md transition-colors"
          :class="footerTab === 'precompose' ? 'bg-background border border-b-0 border-border text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="footerTab = 'precompose'"
        >
          Precompose
        </button>
        <button
          class="px-3 py-1.5 text-sm font-medium rounded-t-md transition-colors"
          :class="footerTab === 'logs' ? 'bg-background border border-b-0 border-border text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="footerTab = 'logs'"
        >
          Log
        </button>
      </div>
      <div class="flex-1 overflow-y-auto px-6 py-4">
        <ScenesPanel
          v-if="footerTab === 'scenes'"
          :selectedTarget="selectedTarget"
          :clients="clients"
          @send="handleSend"
          @log="handleLog"
          @captured="handleSceneCaptured"
        />
        <PrecomposePanel
          v-if="footerTab === 'precompose'"
          :selectedTarget="selectedTarget"
          :clients="clients"
          :precomposeStatus="precomposeStatus"
          @send="handleSend"
          @log="handleLog"
          @update:selectedTarget="selectedTarget = $event"
        />
        <ActivityLog
          v-if="footerTab === 'logs'"
          :logs="logs"
          @clear="clearLogs"
        />
      </div>
    </footer>
  </div>
</template>
