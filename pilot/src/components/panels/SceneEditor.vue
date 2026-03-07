<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import type { Scene, SceneItem } from '@/composables/useScenes'
import type { Client } from '@/composables/useWebSocket'

const props = defineProps<{
  scene: Scene
  clients: Client[]
}>()

const emit = defineEmits<{
  update: [updates: Partial<Scene>]
}>()

// --- Add item form state ---
const newItemType = ref('send-text')
const newItemTarget = ref<'all' | number>('all')
const newItemText = ref('')
const newItemUrl = ref('')
const newItemColor = ref('#ffffff')
const newItemFontSize = ref('2rem')
const newItemIrisColor = ref('#3b82f6')

const typeLabels: Record<string, string> = {
  'send-text': 'Text',
  'send-image': 'Bild',
  'send-video': 'Video',
  'send-color': 'Farbe',
  'show-eyeball': 'Auge',
}

function targetLabel(target: 'all' | number): string {
  if (target === 'all') return 'Alle'
  return `Slot ${target}`
}

function itemSummary(item: SceneItem): string {
  switch (item.type) {
    case 'send-text': return `"${String(item.text || '').substring(0, 30)}"`
    case 'send-image': return String(item.url || '').split('/').pop() || 'Bild'
    case 'send-video': return String(item.url || '').split('/').pop() || 'Video'
    case 'send-color': return String(item.color || '')
    case 'show-eyeball': return 'Augapfel'
    default: return item.type
  }
}

function addItem() {
  const item: SceneItem = { type: newItemType.value, target: newItemTarget.value }

  switch (newItemType.value) {
    case 'send-text':
      if (!newItemText.value.trim()) return
      item.text = newItemText.value.trim()
      item.fontSize = newItemFontSize.value
      item.color = newItemColor.value
      item.style = 'fade'
      item.position = 'center'
      break
    case 'send-image':
      if (!newItemUrl.value.trim()) return
      item.url = newItemUrl.value.trim()
      item.style = 'fade'
      item.fit = 'contain'
      break
    case 'send-video':
      if (!newItemUrl.value.trim()) return
      item.url = newItemUrl.value.trim()
      item.style = 'fade'
      item.fit = 'contain'
      item.loop = true
      item.muted = true
      break
    case 'send-color':
      item.color = newItemColor.value
      break
    case 'show-eyeball':
      item.irisColor = newItemIrisColor.value
      break
  }

  const newItems = [...props.scene.items, item]
  emit('update', { items: newItems })
  newItemText.value = ''
  newItemUrl.value = ''
}

function removeItem(index: number) {
  const newItems = props.scene.items.filter((_, i) => i !== index)
  emit('update', { items: newItems })
}

// --- Drag reorder items ---
let dragItemIndex: number | null = null

function onDragStartItem(index: number, event: DragEvent) {
  dragItemIndex = index
  event.dataTransfer!.effectAllowed = 'move'
}

function onDragOverItem(event: DragEvent) {
  event.preventDefault()
  event.dataTransfer!.dropEffect = 'move'
}

function onDropItem(toIndex: number) {
  if (dragItemIndex === null || dragItemIndex === toIndex) return
  const items = [...props.scene.items]
  const moved = items.splice(dragItemIndex, 1)[0]!
  items.splice(toIndex, 0, moved)
  emit('update', { items })
  dragItemIndex = null
}
</script>

<template>
  <div class="space-y-4 border border-border rounded-md p-4">
    <!-- Scene metadata -->
    <div class="grid grid-cols-3 gap-3">
      <div>
        <Label>Name</Label>
        <Input
          :model-value="scene.name"
          @update:model-value="emit('update', { name: String($event) })"
          class="mt-1.5"
        />
      </div>
      <div>
        <Label>Dauer (ms)</Label>
        <Input
          type="number"
          :model-value="String(scene.durationMs)"
          @update:model-value="emit('update', { durationMs: Number($event) })"
          class="mt-1.5"
          min="0"
          step="500"
        />
      </div>
      <div>
        <Label>Übergang</Label>
        <Select
          :model-value="scene.transition"
          @update:model-value="emit('update', { transition: $event })"
          class="mt-1.5"
        >
          <option value="fade">Einblenden</option>
          <option value="cut">Schnitt</option>
        </Select>
      </div>
    </div>

    <!-- Item list -->
    <div>
      <Label class="mb-2 block">Elemente ({{ scene.items.length }})</Label>
      <div v-if="scene.items.length === 0" class="text-sm text-muted-foreground py-2">
        Keine Elemente — füge unten welche hinzu.
      </div>
      <div
        v-for="(item, i) in scene.items"
        :key="i"
        class="flex items-center gap-2 py-1.5 border-b border-border last:border-0 cursor-grab"
        draggable="true"
        @dragstart="onDragStartItem(i, $event)"
        @dragover="onDragOverItem"
        @drop="onDropItem(i)"
      >
        <span class="text-muted-foreground text-xs w-5">{{ i + 1 }}</span>
        <Badge variant="secondary" class="text-xs">{{ typeLabels[item.type] || item.type }}</Badge>
        <Badge variant="outline" class="text-xs">{{ targetLabel(item.target) }}</Badge>
        <span class="text-sm truncate flex-1">{{ itemSummary(item) }}</span>
        <Button variant="ghost" size="sm" class="h-6 w-6 p-0 text-muted-foreground" @click="removeItem(i)">
          ✕
        </Button>
      </div>
    </div>

    <!-- Add item -->
    <div class="border-t border-border pt-3 space-y-3">
      <Label class="block">Element hinzufügen</Label>
      <div class="grid grid-cols-3 gap-3">
        <div>
          <Label class="text-xs">Typ</Label>
          <Select v-model="newItemType" class="mt-1">
            <option value="send-text">Text</option>
            <option value="send-image">Bild</option>
            <option value="send-video">Video</option>
            <option value="send-color">Farbe</option>
            <option value="show-eyeball">Auge</option>
          </Select>
        </div>
        <div>
          <Label class="text-xs">Ziel</Label>
          <Select
            :model-value="String(newItemTarget)"
            @update:model-value="newItemTarget = $event === 'all' ? 'all' : Number($event)"
            class="mt-1"
          >
            <option value="all">Alle</option>
            <option v-for="(_, idx) in clients" :key="idx" :value="idx">
              Slot {{ idx }} ({{ clients[idx]?.name }})
            </option>
          </Select>
        </div>
      </div>

      <!-- Type-specific inputs -->
      <div v-if="newItemType === 'send-text'" class="grid grid-cols-3 gap-3">
        <div class="col-span-2">
          <Label class="text-xs">Text</Label>
          <Input v-model="newItemText" placeholder="Text eingeben..." class="mt-1" />
        </div>
        <div>
          <Label class="text-xs">Farbe</Label>
          <Input v-model="newItemColor" type="color" class="mt-1 h-10 p-1 cursor-pointer" />
        </div>
      </div>

      <div v-if="newItemType === 'send-image' || newItemType === 'send-video'">
        <Label class="text-xs">URL</Label>
        <Input v-model="newItemUrl" placeholder="/uploads/..." class="mt-1" />
      </div>

      <div v-if="newItemType === 'send-color'">
        <Label class="text-xs">Farbe</Label>
        <Input v-model="newItemColor" type="color" class="mt-1 h-10 w-20 p-1 cursor-pointer" />
      </div>

      <div v-if="newItemType === 'show-eyeball'">
        <Label class="text-xs">Irisfarbe</Label>
        <Input v-model="newItemIrisColor" type="color" class="mt-1 h-10 w-20 p-1 cursor-pointer" />
      </div>

      <Button size="sm" @click="addItem">Hinzufügen</Button>
    </div>
  </div>
</template>
