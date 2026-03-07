<script setup lang="ts">
import { ref } from 'vue'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'

const props = defineProps<{
  selectedTarget: number | 'all'
}>()

const emit = defineEmits<{
  send: [msg: Record<string, unknown>]
  log: [message: string]
}>()

const collapsed = ref(true)
const text = ref('')
const style = ref('fade')
const fontSize = ref('10vw')
const color = ref('#ffffff')
const position = ref('center')

function sendText() {
  if (!text.value.trim()) return

  emit('send', {
    type: 'send-text',
    text: text.value.trim(),
    style: style.value,
    fontSize: fontSize.value,
    color: color.value,
    position: position.value,
    target: props.selectedTarget,
  })
  emit('log', `Text gesendet: "${text.value.substring(0, 40)}..."`)
}

function cascadeText() {
  if (!text.value.trim()) return

  emit('send', {
    type: 'cascade-text',
    text: text.value.trim(),
    style: style.value,
    fontSize: fontSize.value,
    color: color.value,
    position: position.value,
    delay: 500,
  })
  emit('log', `Kaskade gesendet: "${text.value.substring(0, 40)}..."`)
}

function cascadeWords() {
  if (!text.value.trim()) return

  emit('send', {
    type: 'cascade-words',
    text: text.value.trim(),
    fontSize: fontSize.value,
    color: color.value,
    delay: 300,
  })
  emit('log', `Wörter verteilt: "${text.value.substring(0, 40)}..."`)
}
</script>

<template>
  <Card>
    <CardHeader class="cursor-pointer select-none" @click="collapsed = !collapsed">
      <CardTitle class="flex items-center justify-between">
        Text senden
        <span class="text-muted-foreground text-sm">{{ collapsed ? '▸' : '▾' }}</span>
      </CardTitle>
    </CardHeader>
    <CardContent v-show="!collapsed" class="space-y-4">
      <div>
        <Label>Text</Label>
        <Textarea
          v-model="text"
          placeholder="Text eingeben..."
          class="mt-1.5"
        />
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <Label>Animation</Label>
          <Select v-model="style" class="mt-1.5">
            <option value="fade">Einblenden</option>
            <option value="typewriter">Schreibmaschine</option>
            <option value="slide">Hochschieben</option>
          </Select>
        </div>
        <div>
          <Label>Schriftgröße</Label>
          <Select v-model="fontSize" class="mt-1.5">
            <option value="1.2rem">Klein</option>
            <option value="2rem">Normal</option>
            <option value="3.5rem">Groß</option>
            <option value="6rem">Riesig</option>
            <option value="10vw">Maximal</option>
          </Select>
        </div>
        <div>
          <Label>Farbe</Label>
          <Input
            v-model="color"
            type="color"
            class="mt-1.5 h-10 p-1 cursor-pointer"
          />
        </div>
        <div>
          <Label>Position</Label>
          <Select v-model="position" class="mt-1.5">
            <option value="center">Mitte</option>
            <option value="top">Oben</option>
            <option value="bottom">Unten</option>
          </Select>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button @click="sendText">Senden</Button>
        <Button variant="outline" size="sm" @click="cascadeText">
          Kaskade ▶▶
        </Button>
        <Button variant="outline" size="sm" @click="cascadeWords">
          Wörter verteilen
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
