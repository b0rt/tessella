<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Client, PrecomposeStatus } from '@/composables/useWebSocket'

const props = defineProps<{
  clients: Client[]
  selectedTarget: number | 'all'
  precomposeStatus: PrecomposeStatus
}>()

const emit = defineEmits<{
  'update:selectedTarget': [value: number | 'all']
}>()

const targetLabel = computed(() => {
  if (props.selectedTarget === 'all') {
    return `→ Alle ${props.clients.length} Displays`
  }
  const client = props.clients.find(c => c.id === props.selectedTarget)
  return `→ ${client ? client.name : 'Display #' + props.selectedTarget}`
})

const isPrecomposeActive = computed(() => props.precomposeStatus?.active && props.precomposeStatus?.layout)

const precomposeSlots = computed(() => {
  if (!isPrecomposeActive.value) return []
  return props.precomposeStatus.layout?.slots || []
})

const assignedClientIds = computed(() => {
  return new Set(precomposeSlots.value.map(s => s.assignedClientId).filter(Boolean))
})

const unassignedClients = computed(() => {
  if (!isPrecomposeActive.value) return []
  return props.clients.filter(c => !assignedClientIds.value.has(c.id))
})

function getSlotClient(clientId: number | null): Client | undefined {
  if (!clientId) return undefined
  return props.clients.find(c => c.id === clientId)
}

function selectClient(id: number) {
  emit('update:selectedTarget', props.selectedTarget === id ? 'all' : id)
}

function selectAll() {
  emit('update:selectedTarget', 'all')
}
</script>

<template>
  <div class="flex flex-col h-full">
    <h2 class="text-xs uppercase tracking-widest text-muted-foreground mb-4">
      {{ isPrecomposeActive ? 'Precompose Slots' : 'Verbundene Displays' }}
    </h2>

    <Button
      :variant="selectedTarget === 'all' ? 'default' : 'outline'"
      class="w-full mb-2 justify-start"
      @click="selectAll"
    >
      ✦ Alle Displays
    </Button>

    <ScrollArea class="flex-1 -mx-2 px-2">
      <!-- Precompose mode: show slots -->
      <template v-if="isPrecomposeActive">
        <div v-if="precomposeSlots.length === 0" class="text-center text-muted-foreground text-sm py-8 italic">
          Keine Slots definiert
        </div>
        <div v-else class="space-y-2">
          <button
            v-for="slot in precomposeSlots"
            :key="slot.id"
            class="w-full p-3 rounded-md border text-left transition-all hover:border-primary"
            :class="slot.assignedClientId && selectedTarget === slot.assignedClientId ? 'border-primary bg-primary/10' : slot.assignedClientId ? 'border-border' : 'border-dashed border-border opacity-60'"
            @click="slot.assignedClientId && selectClient(slot.assignedClientId)"
          >
            <div class="flex items-center justify-between">
              <span class="text-sm">{{ slot.name }}</span>
              <Badge
                :variant="slot.assignedClientId ? 'default' : 'outline'"
                class="text-xs"
              >
                {{ slot.assignedClientId ? (getSlotClient(slot.assignedClientId)?.name || `#${slot.assignedClientId}`) : 'frei' }}
              </Badge>
            </div>
          </button>
        </div>

        <!-- Unassigned clients -->
        <div v-if="unassignedClients.length > 0" class="mt-4 pt-4 border-t border-border">
          <p class="text-xs text-muted-foreground mb-2">Nicht zugewiesene Displays</p>
          <div class="space-y-1">
            <button
              v-for="client in unassignedClients"
              :key="client.id"
              class="w-full p-2 rounded-md border border-dashed text-left transition-all hover:border-primary text-sm"
              :class="selectedTarget === client.id ? 'border-primary bg-primary/10' : 'border-border'"
              @click="selectClient(client.id)"
            >
              💻 {{ client.name }}
            </button>
          </div>
        </div>
      </template>

      <!-- Normal mode: show clients -->
      <template v-else>
        <div v-if="clients.length === 0" class="text-center text-muted-foreground text-sm py-8 italic">
          Warte auf Verbindungen...
        </div>
        <div v-else class="space-y-2">
          <button
            v-for="client in clients"
            :key="client.id"
            class="w-full p-3 rounded-md border text-left transition-all hover:border-primary"
            :class="selectedTarget === client.id ? 'border-primary bg-primary/10' : 'border-border'"
            @click="selectClient(client.id)"
          >
            <div class="flex items-center justify-between">
              <span class="text-sm">💻 {{ client.name }}</span>
              <span class="text-xs text-muted-foreground">#{{ client.id }}</span>
            </div>
          </button>
        </div>
      </template>
    </ScrollArea>

    <div class="mt-4 pt-4 border-t border-border">
      <Badge :variant="selectedTarget === 'all' ? 'default' : 'secondary'">
        {{ targetLabel }}
      </Badge>
    </div>
  </div>
</template>
