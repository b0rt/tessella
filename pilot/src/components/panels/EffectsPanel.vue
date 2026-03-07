<script setup lang="ts">
import { ref } from 'vue'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const collapsed = ref(true)

const props = defineProps<{
  selectedTarget: number | 'all'
}>()

const emit = defineEmits<{
  send: [msg: Record<string, unknown>]
  log: [message: string]
}>()

const effects = [
  { id: 'pulse', emoji: '💓', label: 'Pulsieren' },
  { id: 'glitch', emoji: '⚡', label: 'Glitch' },
  { id: 'wave', emoji: '🌊', label: 'Welle' },
  { id: 'flash', emoji: '💥', label: 'Flash' },
]

function sendEffect(effect: string) {
  emit('send', {
    type: 'effect',
    effect,
    target: props.selectedTarget,
    duration: 2000,
  })
  emit('log', `Effekt: ${effect}`)
}
</script>

<template>
  <Card>
    <CardHeader class="cursor-pointer select-none" @click="collapsed = !collapsed">
      <CardTitle class="flex items-center justify-between">
        Effekte
        <span class="text-muted-foreground text-sm">{{ collapsed ? '▸' : '▾' }}</span>
      </CardTitle>
    </CardHeader>
    <CardContent v-show="!collapsed">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Button
          v-for="effect in effects"
          :key="effect.id"
          variant="outline"
          class="h-auto py-4 flex-col gap-1"
          @click="sendEffect(effect.id)"
        >
          <span class="text-xl">{{ effect.emoji }}</span>
          <span class="text-xs">{{ effect.label }}</span>
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
