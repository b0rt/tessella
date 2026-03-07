<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { useScenes, type Scene } from '@/composables/useScenes'
import type { Client } from '@/composables/useWebSocket'

const props = defineProps<{
  selectedTarget: number | 'all'
  clients: Client[]
}>()

const emit = defineEmits<{
  send: [msg: Record<string, unknown>]
  log: [message: string]
  captured: []
}>()

function sendMsg(msg: Record<string, unknown>): boolean {
  emit('send', msg)
  return true
}

const {
  scenes,
  activeSceneIndex,
  playbackMode,
  isPlaying,
  loadScenes,
  captureScene,
  updateScene,
  removeScene,
  duplicateScene,
  reorderScenes,
  playScene,
  nextScene,
  prevScene,
  togglePlayback,
  setPlaybackMode,
} = useScenes(sendMsg)

onMounted(() => {
  loadScenes()
})

async function handleCapture() {
  const scene = await captureScene()
  if (scene) {
    emit('log', `Szene erfasst: "${scene.name}" (${scene.items.length} Elemente)`)
    emit('captured')
  }
}

function handlePlay(index: number) {
  playScene(index)
  emit('log', `Szene abspielen: "${scenes.value[index]!.name}"`)
}

function handleDelete(index: number) {
  const name = scenes.value[index]!.name
  removeScene(index)
  emit('log', `Szene gelöscht: "${name}"`)
}

function handleDuplicate(index: number) {
  duplicateScene(index)
  emit('log', `Szene dupliziert: "${scenes.value[index]!.name}"`)
}

function handleUpdate(index: number, updates: Partial<Scene>) {
  updateScene(index, updates)
}

// --- Export / Import ---
function handleExport() {
  window.location.href = '/api/scenes/export'
  emit('log', 'Szenen exportiert')
}

const importInput = ref<HTMLInputElement | null>(null)

function triggerImport() {
  importInput.value?.click()
}

async function handleImport(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return

  try {
    const res = await fetch('/api/scenes/import', {
      method: 'POST',
      body: file
    })
    const data = await res.json()
    if (data.ok) {
      await loadScenes()
      emit('log', `${data.scenes} Szenen importiert (${data.media} Medien)`)
    } else {
      emit('log', `Import fehlgeschlagen: ${data.error}`)
    }
  } catch (e) {
    emit('log', 'Import fehlgeschlagen')
  }

  // Reset file input
  if (importInput.value) importInput.value.value = ''
}

// --- Drag reorder scenes ---
let dragIndex: number | null = null

function onDragStart(index: number, event: DragEvent) {
  dragIndex = index
  event.dataTransfer!.effectAllowed = 'move'
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
  event.dataTransfer!.dropEffect = 'move'
}

function onDrop(toIndex: number) {
  if (dragIndex === null || dragIndex === toIndex) return
  reorderScenes(dragIndex, toIndex)
  dragIndex = null
}
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex items-center justify-between">
        <CardTitle>Szenen & Timeline</CardTitle>
        <Badge variant="secondary">{{ scenes.length }}</Badge>
      </div>
    </CardHeader>
    <CardContent class="space-y-4">
      <!-- Toolbar -->
      <div class="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" @click="handleCapture">
          Aktuelle Ansicht erfassen
        </Button>
        <Button size="sm" variant="outline" @click="handleExport" :disabled="scenes.length === 0">
          Exportieren
        </Button>
        <Button size="sm" variant="outline" @click="triggerImport">
          Importieren
        </Button>
        <input
          ref="importInput"
          type="file"
          accept=".zip"
          class="hidden"
          @change="handleImport"
        />

        <div class="flex-1" />

        <!-- Playback controls -->
        <Button size="sm" variant="ghost" @click="prevScene" :disabled="scenes.length === 0">
          ⏮
        </Button>
        <Button size="sm" :variant="isPlaying ? 'default' : 'outline'" @click="togglePlayback" :disabled="scenes.length === 0">
          {{ isPlaying ? '⏸' : '▶' }}
        </Button>
        <Button size="sm" variant="ghost" @click="nextScene" :disabled="scenes.length === 0">
          ⏭
        </Button>

        <Select
          :model-value="playbackMode"
          @update:model-value="setPlaybackMode($event)"
          class="w-32"
        >
          <option value="manual">Manuell</option>
          <option value="auto">Automatisch</option>
          <option value="random">Zufall</option>
        </Select>
      </div>

      <!-- Scene list -->
      <div v-if="scenes.length === 0" class="text-sm text-muted-foreground py-4 text-center">
        Noch keine Szenen — sende Inhalte an Displays und klicke "Aktuelle Ansicht erfassen".
      </div>

      <div v-for="(scene, index) in scenes" :key="scene.id" class="space-y-2">
        <div
          class="flex items-center gap-2 p-2 rounded-md border"
          :class="activeSceneIndex === index ? 'border-primary bg-primary/5' : 'border-border'"
          draggable="true"
          @dragstart="onDragStart(index, $event)"
          @dragover="onDragOver"
          @drop="onDrop(index)"
        >
          <span class="text-muted-foreground text-xs w-5 cursor-grab">☰</span>
          <input
            type="text"
            :value="scene.name"
            @change="handleUpdate(index, { name: ($event.target as HTMLInputElement).value })"
            class="flex-1 text-sm font-medium truncate bg-transparent border-0 border-b border-transparent hover:border-border focus:border-primary focus:outline-none px-0"
          />
          <Badge variant="outline" class="text-xs">{{ scene.items.length }}</Badge>
          <input
            type="number"
            :value="scene.durationMs / 1000"
            @change="handleUpdate(index, { durationMs: Number(($event.target as HTMLInputElement).value) * 1000 })"
            min="1"
            step="1"
            class="w-16 h-7 text-xs text-center rounded border border-border bg-background px-1"
            title="Dauer in Sekunden"
          />
          <span class="text-xs text-muted-foreground">s</span>
          <input
            type="color"
            :value="scene.bgColor || '#0a0a0a'"
            @change="handleUpdate(index, { bgColor: ($event.target as HTMLInputElement).value })"
            class="w-7 h-7 p-0.5 rounded border border-border bg-background cursor-pointer"
            title="Hintergrundfarbe"
          />
          <Button size="sm" variant="ghost" class="h-7 px-2" @click="handlePlay(index)">▶</Button>
          <Button size="sm" variant="ghost" class="h-7 px-2" @click="handleDuplicate(index)">⧉</Button>
          <Button size="sm" variant="ghost" class="h-7 px-2 text-destructive" @click="handleDelete(index)">🗑</Button>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
