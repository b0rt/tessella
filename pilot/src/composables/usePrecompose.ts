import { ref, computed } from 'vue'
import type { PrecomposeLayout, PrecomposedSlot, PrecomposeStatus } from './useWebSocket'

const layout = ref<PrecomposeLayout | null>(null)
const isActive = ref(false)

export function usePrecompose(
  send: (msg: Record<string, unknown>) => boolean,
  precomposeStatus: { value: PrecomposeStatus }
) {

  function syncFromServer() {
    layout.value = precomposeStatus.value.layout
    isActive.value = precomposeStatus.value.active
  }

  async function loadLayout() {
    try {
      const res = await fetch('/api/precompose')
      const data = await res.json()
      layout.value = data.layout
      isActive.value = data.active
    } catch (e) {
      console.error('Failed to load precompose layout:', e)
    }
  }

  async function saveLayout() {
    try {
      await fetch('/api/precompose', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: layout.value, active: isActive.value }),
      })
    } catch (e) {
      console.error('Failed to save precompose layout:', e)
    }
  }

  function ensureLayout() {
    if (!layout.value) {
      layout.value = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: 'Layout',
        slots: [],
        createdAt: new Date().toISOString(),
        assignmentMode: 'manual',
      }
    }
  }

  function addSlot() {
    ensureLayout()
    const slotNum = (layout.value!.slots.length || 0) + 1
    const slot: PrecomposedSlot = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: `Display ${slotNum}`,
      assignedClientId: null,
      content: [],
      bgColor: '#0a0a0a',
      displayConfig: null,
    }
    layout.value!.slots.push(slot)
    saveLayout()
  }

  function removeSlot(slotId: string) {
    if (!layout.value) return
    const idx = layout.value.slots.findIndex(s => s.id === slotId)
    if (idx >= 0) {
      const slot = layout.value.slots[idx]!
      if (slot.assignedClientId) {
        send({ type: 'precompose-unassign', slotId: slot.id })
      }
      layout.value.slots.splice(idx, 1)
      saveLayout()
    }
  }

  function updateSlot(slotId: string, updates: Partial<PrecomposedSlot>) {
    if (!layout.value) return
    const slot = layout.value.slots.find(s => s.id === slotId)
    if (slot) {
      Object.assign(slot, updates)
      saveLayout()
    }
  }

  function updateLayoutName(name: string) {
    ensureLayout()
    layout.value!.name = name
    saveLayout()
  }

  function setAssignmentMode(mode: 'auto' | 'manual') {
    ensureLayout()
    layout.value!.assignmentMode = mode
    saveLayout()
  }

  function assignClient(slotId: string, clientId: number | null) {
    send({ type: 'precompose-assign', slotId, clientId })
  }

  function unassignClient(slotId: string) {
    send({ type: 'precompose-unassign', slotId })
  }

  function pushSlot(slotId: string) {
    send({ type: 'precompose-push', slotId })
  }

  function pushAll() {
    send({ type: 'precompose-push-all' })
  }

  function activate() {
    ensureLayout()
    saveLayout().then(() => {
      send({ type: 'precompose-activate' })
    })
  }

  function deactivate() {
    send({ type: 'precompose-deactivate' })
  }

  function addContentToSlot(slotId: string, item: Record<string, unknown>) {
    if (!layout.value) return
    const slot = layout.value.slots.find(s => s.id === slotId)
    if (slot) {
      slot.content.push(item)
      saveLayout()
    }
  }

  function removeContentFromSlot(slotId: string, contentIndex: number) {
    if (!layout.value) return
    const slot = layout.value.slots.find(s => s.id === slotId)
    if (slot && contentIndex >= 0 && contentIndex < slot.content.length) {
      slot.content.splice(contentIndex, 1)
      saveLayout()
    }
  }

  function reorderSlots(fromIndex: number, toIndex: number) {
    if (!layout.value) return
    const moved = layout.value.slots.splice(fromIndex, 1)[0]
    if (!moved) return
    layout.value.slots.splice(toIndex, 0, moved)
    saveLayout()
  }

  const assignedSlots = computed(() => {
    if (!layout.value) return []
    return layout.value.slots.filter(s => s.assignedClientId !== null)
  })

  const unassignedSlots = computed(() => {
    if (!layout.value) return []
    return layout.value.slots.filter(s => s.assignedClientId === null)
  })

  return {
    layout,
    isActive,
    assignedSlots,
    unassignedSlots,
    syncFromServer,
    loadLayout,
    saveLayout,
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
  }
}
