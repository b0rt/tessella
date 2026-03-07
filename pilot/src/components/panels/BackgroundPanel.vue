<script setup lang="ts">
import { ref } from 'vue'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'

const props = defineProps<{
  selectedTarget: number | 'all'
}>()

const emit = defineEmits<{
  send: [msg: Record<string, unknown>]
  log: [message: string]
}>()

const collapsed = ref(true)
const bgColor = ref('#0a0a0a')

function sendColor() {
  emit('send', {
    type: 'send-color',
    color: bgColor.value,
    target: props.selectedTarget,
  })
  emit('log', `Hintergrund: ${bgColor.value}`)
}
</script>

<template>
  <Card>
    <CardHeader class="cursor-pointer select-none" @click="collapsed = !collapsed">
      <CardTitle class="flex items-center justify-between">
        Hintergrund
        <span class="text-muted-foreground text-sm">{{ collapsed ? '▸' : '▾' }}</span>
      </CardTitle>
    </CardHeader>
    <CardContent v-show="!collapsed">
      <div class="flex items-end gap-3">
        <div class="flex-1">
          <Label>Farbe</Label>
          <Input
            v-model="bgColor"
            type="color"
            class="mt-1.5 h-10 p-1 cursor-pointer"
          />
        </div>
        <Button variant="outline" size="sm" @click="sendColor">
          Hintergrund ändern
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
