<script setup lang="ts">
import { onMounted, watch, ref } from 'vue'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { usePrecompose } from '@/composables/usePrecompose'
import type { Client, PrecomposeStatus, PrecomposedSlot } from '@/composables/useWebSocket'

const props = defineProps<{
  clients: Client[]
  selectedTarget: number | 'all'
  precomposeStatus: PrecomposeStatus
}>()

const emit = defineEmits<{
  send: [msg: Record<string, unknown>]
  log: [message: string]
  'update:selectedTarget': [value: number | 'all']
}>()

function sendMsg(msg: Record<string, unknown>): boolean {
  emit('send', msg)
  return true
}

const {
  layout,
  isActive,
  syncFromServer,
  loadLayout,
  addSlot,
  removeSlot,
  updateSlot,
  updateLayoutName,
  setAssignmentMode,
  assignClient,
  unassignClient,
  pushSlot,
  pushAll,
  activate,
  deactivate,
  addContentToSlot,
  removeContentFromSlot,
  reorderSlots,
} = usePrecompose(sendMsg, props.precomposeStatus as unknown as { value: PrecomposeStatus })

// Sync from WebSocket status updates
watch(() => props.precomposeStatus, () => {
  syncFromServer()
}, { deep: true })

onMounted(() => {
  loadLayout()
})

// --- Slot editor state ---
const editingSlotId = ref<string | null>(null)
const contentType = ref('send-text')
const contentText = ref('')
const contentUrl = ref('')
const contentColor = ref('#ffffff')
const contentFontSize = ref('10vw')
const contentStyle = ref('fade')
const contentPosition = ref('center')
const contentFit = ref('contain')

function toggleEdit(slotId: string) {
  editingSlotId.value = editingSlotId.value === slotId ? null : slotId
  resetContentForm()
}

function resetContentForm() {
  contentType.value = 'send-text'
  contentText.value = ''
  contentUrl.value = ''
  contentColor.value = '#ffffff'
  contentFontSize.value = '10vw'
  contentStyle.value = 'fade'
  contentPosition.value = 'center'
  contentFit.value = 'contain'
}

function handleAddContent(slotId: string) {
  const item: Record<string, unknown> = { type: contentType.value }

  switch (contentType.value) {
    case 'send-text':
      if (!contentText.value.trim()) return
      item.text = contentText.value.trim()
      item.fontSize = contentFontSize.value
      item.color = contentColor.value
      item.style = contentStyle.value
      item.position = contentPosition.value
      break
    case 'send-image':
      if (!contentUrl.value.trim()) return
      item.url = contentUrl.value.trim()
      item.style = contentStyle.value
      item.fit = contentFit.value
      item.position = contentPosition.value
      break
    case 'send-video':
      if (!contentUrl.value.trim()) return
      item.url = contentUrl.value.trim()
      item.style = contentStyle.value
      item.fit = contentFit.value
      item.loop = true
      item.muted = true
      item.autoplay = true
      item.position = contentPosition.value
      break
    case 'send-color':
      item.color = contentColor.value
      break
    case 'show-eyeball':
      item.irisColor = contentColor.value
      break
  }

  addContentToSlot(slotId, item)
  emit('log', `Inhalt zu Slot hinzugefügt: ${contentType.value}`)
  resetContentForm()
}

function handleRemoveContent(slotId: string, index: number) {
  removeContentFromSlot(slotId, index)
  emit('log', 'Inhalt aus Slot entfernt')
}

function handleActivate() {
  activate()
  emit('log', 'Precompose-Layout aktiviert')
}

function handleDeactivate() {
  deactivate()
  emit('log', 'Precompose-Layout deaktiviert')
}

function handlePush(slotId: string, slotName: string) {
  pushSlot(slotId)
  emit('log', `Inhalt gesendet an Slot "${slotName}"`)
}

function handlePushAll() {
  pushAll()
  emit('log', 'Alle Slot-Inhalte gesendet')
}

function handleRemoveSlot(slotId: string, slotName: string) {
  removeSlot(slotId)
  emit('log', `Slot entfernt: "${slotName}"`)
}

function handleAssign(slotId: string, clientId: string) {
  const id = clientId ? parseInt(clientId) : null
  if (id) {
    assignClient(slotId, id)
    const client = props.clients.find(c => c.id === id)
    emit('log', `${client?.name || 'Display'} zugewiesen`)
  }
}

function handleUnassign(slotId: string) {
  unassignClient(slotId)
  emit('log', 'Zuweisung aufgehoben')
}

function getContentLabel(item: Record<string, unknown>): string {
  switch (item.type) {
    case 'send-text': return `Text: "${(item.text as string || '').substring(0, 20)}..."`
    case 'send-image': return `Bild: ${(item.url as string || '').split('/').pop()}`
    case 'send-video': return `Video: ${(item.url as string || '').split('/').pop()}`
    case 'send-color': return `Farbe: ${item.color}`
    case 'show-eyeball': return 'Augapfel'
    default: return String(item.type)
  }
}

function getContentBadge(type: string): string {
  switch (type) {
    case 'send-text': return 'T'
    case 'send-image': return 'B'
    case 'send-video': return 'V'
    case 'send-color': return 'F'
    case 'show-eyeball': return 'A'
    default: return '?'
  }
}

function getAssignedClientName(slot: PrecomposedSlot): string {
  if (!slot.assignedClientId) return 'Nicht zugewiesen'
  const client = props.clients.find(c => c.id === slot.assignedClientId)
  return client ? client.name : `Display #${slot.assignedClientId}`
}

function getUnassignedClients(): Client[] {
  if (!layout.value) return props.clients
  const assignedIds = new Set(layout.value.slots.map(s => s.assignedClientId).filter(Boolean))
  return props.clients.filter(c => !assignedIds.has(c.id))
}

// --- Drag reorder ---
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
  reorderSlots(dragIndex, toIndex)
  dragIndex = null
}

function selectSlotClient(slot: PrecomposedSlot) {
  if (slot.assignedClientId) {
    emit('update:selectedTarget', slot.assignedClientId)
  }
}
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex items-center justify-between">
        <CardTitle>Precompose Displays</CardTitle>
        <div class="flex items-center gap-2">
          <Badge :variant="isActive ? 'default' : 'secondary'">
            {{ isActive ? 'Aktiv' : 'Inaktiv' }}
          </Badge>
          <Badge variant="outline">{{ layout?.slots?.length || 0 }} Slots</Badge>
        </div>
      </div>
    </CardHeader>
    <CardContent class="space-y-4">
      <!-- Layout toolbar -->
      <div class="flex flex-wrap items-center gap-2">
        <Input
          :model-value="layout?.name || ''"
          @change="updateLayoutName(($event.target as HTMLInputElement).value)"
          placeholder="Layout-Name"
          class="w-48 h-8 text-sm"
        />
        <Select
          :model-value="layout?.assignmentMode || 'manual'"
          @update:model-value="setAssignmentMode($event as 'auto' | 'manual')"
          class="w-36"
        >
          <option value="manual">Manuell</option>
          <option value="auto">Automatisch</option>
        </Select>

        <div class="flex-1" />

        <Button
          v-if="!isActive"
          size="sm"
          @click="handleActivate"
          :disabled="!layout || (layout.slots?.length || 0) === 0"
        >
          Aktivieren
        </Button>
        <Button
          v-else
          size="sm"
          variant="destructive"
          @click="handleDeactivate"
        >
          Deaktivieren
        </Button>

        <Button
          size="sm"
          variant="outline"
          @click="handlePushAll"
          :disabled="!isActive || !layout?.slots?.some(s => s.assignedClientId)"
        >
          Alle senden
        </Button>
      </div>

      <!-- Slot list -->
      <div v-if="!layout || (layout.slots?.length || 0) === 0" class="text-sm text-muted-foreground py-4 text-center">
        Noch keine Slots definiert — klicke "+ Display-Slot hinzufügen" um zu starten.
      </div>

      <div v-for="(slot, index) in layout?.slots || []" :key="slot.id" class="space-y-1">
        <div
          class="flex items-center gap-2 p-2 rounded-md border"
          :class="slot.assignedClientId ? 'border-primary bg-primary/5' : 'border-border'"
          draggable="true"
          @dragstart="onDragStart(index, $event)"
          @dragover="onDragOver"
          @drop="onDrop(index)"
        >
          <span class="text-muted-foreground text-xs w-5 cursor-grab">☰</span>

          <!-- Slot name -->
          <input
            type="text"
            :value="slot.name"
            @change="updateSlot(slot.id, { name: ($event.target as HTMLInputElement).value })"
            class="w-36 text-sm font-medium truncate bg-transparent border-0 border-b border-transparent hover:border-border focus:border-primary focus:outline-none px-0"
          />

          <!-- Assignment status -->
          <Badge
            :variant="slot.assignedClientId ? 'default' : 'outline'"
            class="text-xs cursor-pointer"
            @click="selectSlotClient(slot)"
          >
            {{ getAssignedClientName(slot) }}
          </Badge>

          <!-- Content badges -->
          <div class="flex gap-0.5">
            <Badge
              v-for="(item, ci) in slot.content"
              :key="ci"
              variant="outline"
              class="text-xs px-1"
              :title="getContentLabel(item)"
            >
              {{ getContentBadge(String(item.type)) }}
            </Badge>
          </div>

          <div class="flex-1" />

          <!-- Background color -->
          <input
            type="color"
            :value="slot.bgColor || '#0a0a0a'"
            @change="updateSlot(slot.id, { bgColor: ($event.target as HTMLInputElement).value })"
            class="w-7 h-7 p-0.5 rounded border border-border bg-background cursor-pointer"
            title="Hintergrundfarbe"
          />

          <!-- Manual assignment dropdown -->
          <select
            v-if="layout?.assignmentMode === 'manual'"
            :value="slot.assignedClientId || ''"
            @change="($event.target as HTMLSelectElement).value ? handleAssign(slot.id, ($event.target as HTMLSelectElement).value) : handleUnassign(slot.id)"
            class="h-7 text-xs rounded border border-border bg-background px-1"
            title="Display zuweisen"
          >
            <option value="">— Zuweisen —</option>
            <option
              v-for="client in getUnassignedClients()"
              :key="client.id"
              :value="client.id"
            >
              {{ client.name }}
            </option>
            <option
              v-if="slot.assignedClientId"
              :value="slot.assignedClientId"
              selected
            >
              {{ getAssignedClientName(slot) }} (aktuell)
            </option>
          </select>

          <!-- Actions -->
          <Button
            size="sm"
            variant="ghost"
            class="h-7 px-2"
            @click="toggleEdit(slot.id)"
            title="Bearbeiten"
          >
            {{ editingSlotId === slot.id ? '▾' : '▸' }}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 px-2"
            @click="handlePush(slot.id, slot.name)"
            :disabled="!slot.assignedClientId"
            title="Senden"
          >
            ▶
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="h-7 px-2 text-destructive"
            @click="handleRemoveSlot(slot.id, slot.name)"
            title="Entfernen"
          >
            🗑
          </Button>
        </div>

        <!-- Slot editor (expanded) -->
        <div v-if="editingSlotId === slot.id" class="ml-7 p-3 rounded-md border border-border bg-muted/30 space-y-3">
          <!-- Existing content items -->
          <div v-if="slot.content.length > 0" class="space-y-1">
            <Label class="text-xs text-muted-foreground">Inhalte</Label>
            <div
              v-for="(item, ci) in slot.content"
              :key="ci"
              class="flex items-center gap-2 text-sm"
            >
              <Badge variant="outline" class="text-xs px-1">{{ getContentBadge(String(item.type)) }}</Badge>
              <span class="flex-1 truncate text-xs">{{ getContentLabel(item) }}</span>
              <Button
                size="sm"
                variant="ghost"
                class="h-6 px-1 text-destructive text-xs"
                @click="handleRemoveContent(slot.id, ci)"
              >
                ×
              </Button>
            </div>
          </div>

          <!-- Add content form -->
          <div class="space-y-2 pt-2 border-t border-border">
            <Label class="text-xs text-muted-foreground">Inhalt hinzufügen</Label>
            <div class="flex flex-wrap items-end gap-2">
              <div>
                <Select v-model="contentType" class="w-32 h-8 text-xs">
                  <option value="send-text">Text</option>
                  <option value="send-image">Bild</option>
                  <option value="send-video">Video</option>
                  <option value="send-color">Farbe</option>
                  <option value="show-eyeball">Augapfel</option>
                </Select>
              </div>

              <!-- Text fields -->
              <template v-if="contentType === 'send-text'">
                <Textarea
                  v-model="contentText"
                  placeholder="Text eingeben..."
                  class="flex-1 min-w-[200px] h-8 text-xs"
                />
                <Select v-model="contentFontSize" class="w-24 h-8 text-xs">
                  <option value="1.2rem">Klein</option>
                  <option value="2rem">Normal</option>
                  <option value="3.5rem">Groß</option>
                  <option value="6rem">Riesig</option>
                  <option value="10vw">Maximal</option>
                </Select>
                <Input v-model="contentColor" type="color" class="w-8 h-8 p-0.5 cursor-pointer" />
                <Select v-model="contentPosition" class="w-24 h-8 text-xs">
                  <option value="center">Mitte</option>
                  <option value="top">Oben</option>
                  <option value="bottom">Unten</option>
                </Select>
              </template>

              <!-- Image/Video fields -->
              <template v-if="contentType === 'send-image' || contentType === 'send-video'">
                <Input
                  v-model="contentUrl"
                  placeholder="/uploads/..."
                  class="flex-1 min-w-[200px] h-8 text-xs"
                />
                <Select v-model="contentFit" class="w-24 h-8 text-xs">
                  <option value="contain">Contain</option>
                  <option value="cover">Cover</option>
                </Select>
              </template>

              <!-- Color field -->
              <template v-if="contentType === 'send-color' || contentType === 'show-eyeball'">
                <Input v-model="contentColor" type="color" class="w-8 h-8 p-0.5 cursor-pointer" />
              </template>

              <Button size="sm" class="h-8 text-xs" @click="handleAddContent(slot.id)">
                + Hinzufügen
              </Button>
            </div>
          </div>

          <!-- Display config -->
          <div class="space-y-2 pt-2 border-t border-border">
            <Label class="text-xs text-muted-foreground">Display-Konfiguration (optional)</Label>
            <div class="grid grid-cols-4 gap-2">
              <div>
                <Label class="text-xs">X</Label>
                <Input
                  type="number"
                  :model-value="slot.displayConfig?.x ?? 0"
                  @change="updateSlot(slot.id, { displayConfig: { ...(slot.displayConfig || { x: 0, y: 0, z: 0, rotation: 0 }), x: Number(($event.target as HTMLInputElement).value) } })"
                  class="h-7 text-xs"
                  step="0.1"
                />
              </div>
              <div>
                <Label class="text-xs">Y</Label>
                <Input
                  type="number"
                  :model-value="slot.displayConfig?.y ?? 0"
                  @change="updateSlot(slot.id, { displayConfig: { ...(slot.displayConfig || { x: 0, y: 0, z: 0, rotation: 0 }), y: Number(($event.target as HTMLInputElement).value) } })"
                  class="h-7 text-xs"
                  step="0.1"
                />
              </div>
              <div>
                <Label class="text-xs">Z</Label>
                <Input
                  type="number"
                  :model-value="slot.displayConfig?.z ?? 0"
                  @change="updateSlot(slot.id, { displayConfig: { ...(slot.displayConfig || { x: 0, y: 0, z: 0, rotation: 0 }), z: Number(($event.target as HTMLInputElement).value) } })"
                  class="h-7 text-xs"
                  step="0.1"
                />
              </div>
              <div>
                <Label class="text-xs">Rotation</Label>
                <Input
                  type="number"
                  :model-value="slot.displayConfig?.rotation ?? 0"
                  @change="updateSlot(slot.id, { displayConfig: { ...(slot.displayConfig || { x: 0, y: 0, z: 0, rotation: 0 }), rotation: Number(($event.target as HTMLInputElement).value) } })"
                  class="h-7 text-xs"
                  step="1"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Add slot button -->
      <Button size="sm" variant="outline" class="w-full" @click="addSlot">
        + Display-Slot hinzufügen
      </Button>
    </CardContent>
  </Card>
</template>
