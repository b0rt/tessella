<script setup lang="ts">
import { ref, computed } from 'vue'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import type { Client } from '@/composables/useWebSocket'

const props = defineProps<{
  selectedTarget: number | 'all'
  clients: Client[]
}>()

const emit = defineEmits<{
  send: [msg: Record<string, unknown>]
  log: [message: string]
}>()

const collapsed = ref(true)

// Eyeball state
const eyeballActive = ref(false)
const irisColor = ref('#4a7c59')
const bgColor = ref('#0a0a0a')

// Display configurations
const displayConfigs = ref<Record<number, { x: number; y: number; z: number; rotation: number }>>({})

// Initialize display configs for connected clients
const clientConfigs = computed(() => {
  const configs: { id: number; name: string; x: number; y: number; z: number; rotation: number }[] = []
  for (const client of props.clients) {
    const saved = displayConfigs.value[client.id] || { x: 0, y: 0, z: 0, rotation: 0 }
    configs.push({
      id: client.id,
      name: client.name,
      ...saved
    })
  }
  return configs
})

function updateDisplayConfig(clientId: number, field: 'x' | 'y' | 'z' | 'rotation', value: number) {
  if (!displayConfigs.value[clientId]) {
    displayConfigs.value[clientId] = { x: 0, y: 0, z: 0, rotation: 0 }
  }
  displayConfigs.value[clientId][field] = value
}

function applyConfig(clientId: number) {
  const config = displayConfigs.value[clientId]
  if (!config) return

  emit('send', {
    type: 'config-display',
    target: clientId,
    position: { x: config.x, y: config.y, z: config.z },
    rotation: config.rotation
  })
  emit('log', `Display #${clientId} konfiguriert`)
}

function applyAllConfigs() {
  for (const client of props.clients) {
    applyConfig(client.id)
  }
  emit('log', 'Alle Displays konfiguriert')
}

function showEyeball() {
  emit('send', {
    type: 'show-eyeball',
    target: props.selectedTarget,
    irisColor: irisColor.value,
    bgColor: bgColor.value
  })
  eyeballActive.value = true
  emit('log', 'Eyeball aktiviert')
}

function hideEyeball() {
  emit('send', {
    type: 'hide-eyeball',
    target: props.selectedTarget
  })
  eyeballActive.value = false
  emit('log', 'Eyeball deaktiviert')
}
</script>

<template>
  <Card>
    <CardHeader class="cursor-pointer select-none" @click="collapsed = !collapsed">
      <CardTitle class="flex items-center justify-between">
        Eyeball
        <span class="text-muted-foreground text-sm">{{ collapsed ? '▸' : '▾' }}</span>
      </CardTitle>
    </CardHeader>
    <CardContent v-show="!collapsed" class="space-y-4">
      <!-- Eyeball controls -->
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <Label>Iris-Farbe</Label>
            <div class="flex gap-2 mt-1.5">
              <input
                type="color"
                v-model="irisColor"
                class="w-10 h-10 rounded border border-border cursor-pointer"
              />
              <Input v-model="irisColor" class="flex-1" />
            </div>
          </div>
          <div>
            <Label>Hintergrund</Label>
            <div class="flex gap-2 mt-1.5">
              <input
                type="color"
                v-model="bgColor"
                class="w-10 h-10 rounded border border-border cursor-pointer"
              />
              <Input v-model="bgColor" class="flex-1" />
            </div>
          </div>
        </div>

        <div class="flex gap-2">
          <Button @click="showEyeball" :disabled="eyeballActive">
            Eyeball anzeigen
          </Button>
          <Button variant="outline" @click="hideEyeball" :disabled="!eyeballActive">
            Ausblenden
          </Button>
        </div>
      </div>

      <!-- Display configuration -->
      <div class="pt-4 border-t border-border space-y-3">
        <div class="flex items-center justify-between">
          <Label>Display-Positionen im Raum</Label>
          <Button size="sm" variant="outline" @click="applyAllConfigs">
            Alle anwenden
          </Button>
        </div>

        <div class="text-xs text-muted-foreground mb-2">
          X: Links/Rechts, Y: Oben/Unten, Z: Entfernung, Rotation: Blickrichtung (0° = zur Kamera)
        </div>

        <div class="space-y-2 max-h-48 overflow-y-auto">
          <div
            v-for="config in clientConfigs"
            :key="config.id"
            class="p-2 rounded bg-muted/50 space-y-2"
          >
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">{{ config.name }}</span>
              <Button size="sm" variant="ghost" @click="applyConfig(config.id)">
                Anwenden
              </Button>
            </div>
            <div class="grid grid-cols-4 gap-2">
              <div>
                <Label class="text-xs">X</Label>
                <Input
                  type="number"
                  step="0.5"
                  :model-value="config.x"
                  @update:model-value="v => updateDisplayConfig(config.id, 'x', Number(v))"
                  class="h-8 text-sm"
                />
              </div>
              <div>
                <Label class="text-xs">Y</Label>
                <Input
                  type="number"
                  step="0.5"
                  :model-value="config.y"
                  @update:model-value="v => updateDisplayConfig(config.id, 'y', Number(v))"
                  class="h-8 text-sm"
                />
              </div>
              <div>
                <Label class="text-xs">Z</Label>
                <Input
                  type="number"
                  step="0.5"
                  :model-value="config.z"
                  @update:model-value="v => updateDisplayConfig(config.id, 'z', Number(v))"
                  class="h-8 text-sm"
                />
              </div>
              <div>
                <Label class="text-xs">Rot</Label>
                <Input
                  type="number"
                  step="15"
                  :model-value="config.rotation"
                  @update:model-value="v => updateDisplayConfig(config.id, 'rotation', Number(v))"
                  class="h-8 text-sm"
                />
              </div>
            </div>
          </div>

          <div v-if="clientConfigs.length === 0" class="text-sm text-muted-foreground text-center py-4">
            Keine Displays verbunden
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
