<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import { useScenes, type Scene } from '@/composables/useScenes'
import type { Client } from '@/composables/useWebSocket'
import SceneEditor from './SceneEditor.vue'

const props = defineProps<{
  selectedTarget: number | 'all'
  clients: Client[]
}>()

const emit = defineEmits<{
  send: [msg: Record<string, unknown>]
  log: [message: string]
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

const editingIndex = ref(-1)

onMounted(() => {
  loadScenes()
})

async function handleCapture() {
  const scene = await captureScene()
  if (scene) {
    emit('log', `Szene erfasst: "${scene.name}" (${scene.items.length} Elemente)`)
  }
}

function handlePlay(index: number) {
  playScene(index)
  emit('log', `Szene abspielen: "${scenes.value[index]!.name}"`)
}

function handleDelete(index: number) {
  const name = scenes.value[index]!.name
  removeScene(index)
  if (editingIndex.value === index) editingIndex.value = -1
  emit('log', `Szene gelöscht: "${name}"`)
}

function handleDuplicate(index: number) {
  duplicateScene(index)
  emit('log', `Szene dupliziert: "${scenes.value[index]!.name}"`)
}

function handleUpdate(index: number, updates: Partial<Scene>) {
  updateScene(index, updates)
}

function toggleEdit(index: number) {
  editingIndex.value = editingIndex.value === index ? -1 : index
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
  if (editingIndex.value === dragIndex) editingIndex.value = toIndex
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
          <span class="flex-1 text-sm font-medium truncate">{{ scene.name }}</span>
          <Badge variant="outline" class="text-xs">{{ scene.items.length }}</Badge>
          <span class="text-xs text-muted-foreground">{{ scene.durationMs / 1000 }}s</span>
          <Button size="sm" variant="ghost" class="h-7 px-2" @click="handlePlay(index)">▶</Button>
          <Button size="sm" variant="ghost" class="h-7 px-2" @click="toggleEdit(index)">
            {{ editingIndex === index ? '✕' : '✎' }}
          </Button>
          <Button size="sm" variant="ghost" class="h-7 px-2" @click="handleDuplicate(index)">⧉</Button>
          <Button size="sm" variant="ghost" class="h-7 px-2 text-destructive" @click="handleDelete(index)">🗑</Button>
        </div>

        <!-- Inline editor -->
        <SceneEditor
          v-if="editingIndex === index"
          :scene="scene"
          :clients="clients"
          @update="handleUpdate(index, $event)"
        />
      </div>
    </CardContent>
  </Card>
</template>
