<script setup lang="ts">
import { ref, computed } from 'vue'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
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
const imageUrl = ref('')
const uploadedImageUrl = ref<string | null>(null)
const previewSrc = ref<string | null>(null)
const uploading = ref(false)
const fit = ref('contain')
const style = ref('fade')
const tileCols = ref(5)
const tileRows = ref(2)
const preserveAspect = ref(true)

const tileInfo = computed(() => {
  const total = tileCols.value * tileRows.value
  const clientCount = props.clients.length

  if (clientCount === 0) {
    return { text: `${tileCols.value}×${tileRows.value} = ${total} Kacheln (keine Displays verbunden)`, warning: true }
  } else if (clientCount < total) {
    return { text: `${tileCols.value}×${tileRows.value} = ${total} Kacheln, aber nur ${clientCount} Display(s) verbunden`, warning: true }
  } else if (clientCount > total) {
    return { text: `${tileCols.value}×${tileRows.value} = ${total} Kacheln für ${clientCount} Displays (${clientCount - total} ohne Bild)`, warning: false }
  }
  return { text: `${tileCols.value}×${tileRows.value} = ${total} Kacheln für ${clientCount} Displays ✓`, warning: false }
})

const currentImage = computed(() => uploadedImageUrl.value || imageUrl.value)

async function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (!file.type.startsWith('image/')) {
    emit('log', '⚠ Nur Bilddateien erlaubt')
    return
  }

  uploading.value = true
  emit('log', `Lade hoch: ${file.name}...`)

  const reader = new FileReader()
  reader.onload = async (e) => {
    const base64Data = e.target?.result as string
    previewSrc.value = base64Data

    try {
      const response = await fetch('/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Data }),
      })
      const data = await response.json()

      if (data.url) {
        uploadedImageUrl.value = data.url
        imageUrl.value = ''
        emit('log', `✓ Bild hochgeladen: ${file.name}`)
      } else {
        throw new Error(data.error || 'Upload failed')
      }
    } catch (err) {
      emit('log', `⚠ Upload fehlgeschlagen: ${(err as Error).message}`)
      clearUpload()
    } finally {
      uploading.value = false
    }
  }
  reader.readAsDataURL(file)
}

function clearUpload() {
  uploadedImageUrl.value = null
  previewSrc.value = null
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  const files = event.dataTransfer?.files
  if (files?.length) {
    const input = document.createElement('input')
    input.type = 'file'
    input.files = files
    handleFileUpload({ target: input } as unknown as Event)
  }
}

function sendImage() {
  if (!currentImage.value) {
    emit('log', '⚠ Kein Bild ausgewählt')
    return
  }

  emit('send', {
    type: 'send-image',
    url: currentImage.value,
    fit: fit.value,
    style: style.value,
    target: props.selectedTarget,
  })

  emit('log', uploadedImageUrl.value ? 'Hochgeladenes Bild gesendet' : `Bild gesendet: ${imageUrl.value.substring(0, 50)}...`)
}

function sendTiledImage() {
  if (!currentImage.value) {
    emit('log', '⚠ Kein Bild ausgewählt')
    return
  }

  if (props.clients.length === 0) {
    emit('log', '⚠ Keine Displays verbunden')
    return
  }

  emit('send', {
    type: 'send-tiled-image',
    url: currentImage.value,
    cols: tileCols.value,
    rows: tileRows.value,
    style: style.value,
    preserveAspect: preserveAspect.value,
  })

  emit('log', `Gekacheltes Bild gesendet: ${tileCols.value}×${tileRows.value} Raster${preserveAspect.value ? ' (Seitenverhältnis)' : ''}`)
}
</script>

<template>
  <Card>
    <CardHeader class="cursor-pointer select-none" @click="collapsed = !collapsed">
      <CardTitle class="flex items-center justify-between">
        Bild senden
        <span class="text-muted-foreground text-sm">{{ collapsed ? '▸' : '▾' }}</span>
      </CardTitle>
    </CardHeader>
    <CardContent v-show="!collapsed" class="space-y-4">
      <!-- Upload dropzone -->
      <div>
        <Label>Bild hochladen</Label>
        <div
          class="mt-1.5 relative border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer transition-colors hover:border-primary hover:bg-primary/5"
          :class="{ 'opacity-50 pointer-events-none': uploading }"
          @dragover.prevent
          @drop="handleDrop"
          @click="($refs.fileInput as HTMLInputElement).click()"
        >
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            class="hidden"
            @change="handleFileUpload"
          />

          <div v-if="previewSrc" class="relative inline-block">
            <img :src="previewSrc" class="max-h-32 rounded" alt="Preview" />
            <button
              class="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-white rounded-full text-sm flex items-center justify-center hover:scale-110 transition-transform"
              @click.stop="clearUpload"
            >
              ✕
            </button>
          </div>

          <div v-else class="space-y-2">
            <div class="text-2xl">📁</div>
            <div class="text-sm text-muted-foreground">
              Bild hierher ziehen oder klicken
            </div>
          </div>

          <div v-if="uploading" class="absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg">
            <span class="text-primary">Hochladen...</span>
          </div>
        </div>
      </div>

      <!-- URL input -->
      <div>
        <Label>Oder Bild-URL</Label>
        <Input
          v-model="imageUrl"
          type="url"
          placeholder="https://example.com/bild.jpg"
          class="mt-1.5"
          :disabled="!!uploadedImageUrl"
        />
      </div>

      <!-- Options -->
      <div class="grid grid-cols-2 gap-3">
        <div>
          <Label>Darstellung</Label>
          <Select v-model="fit" class="mt-1.5">
            <option value="contain">Einpassen</option>
            <option value="cover">Füllen</option>
          </Select>
        </div>
        <div>
          <Label>Animation</Label>
          <Select v-model="style" class="mt-1.5">
            <option value="fade">Einblenden</option>
            <option value="slide">Hochschieben</option>
          </Select>
        </div>
      </div>

      <Button @click="sendImage" :disabled="!currentImage">
        Senden
      </Button>

      <!-- Tiling section -->
      <div class="pt-4 border-t border-border space-y-4">
        <Label>Kachel-Raster (Bild auf Displays verteilen)</Label>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <Label>Spalten</Label>
            <Input
              v-model="tileCols"
              type="number"
              :min="1"
              :max="30"
              class="mt-1.5"
            />
          </div>
          <div>
            <Label>Zeilen</Label>
            <Input
              v-model="tileRows"
              type="number"
              :min="1"
              :max="30"
              class="mt-1.5"
            />
          </div>
        </div>

        <div
          class="text-sm p-2 rounded bg-muted"
          :class="{ 'text-destructive': tileInfo.warning }"
        >
          {{ tileInfo.text }}
        </div>

        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            v-model="preserveAspect"
            class="w-4 h-4 rounded border-border"
          />
          <span class="text-sm">Seitenverhältnis beibehalten</span>
        </label>

        <Button @click="sendTiledImage" :disabled="!currentImage">
          🔲 Gekachelt senden
        </Button>
      </div>
    </CardContent>
  </Card>
</template>
