<script setup lang="ts">
import { ref, computed } from 'vue'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'

const props = defineProps<{
  selectedTarget: number | 'all'
}>()

const emit = defineEmits<{
  send: [msg: Record<string, unknown>]
  log: [message: string]
}>()

const videoUrl = ref('')
const uploadedVideoUrl = ref<string | null>(null)
const previewSrc = ref<string | null>(null)
const uploading = ref(false)
const uploadProgress = ref(0)
const fit = ref('contain')
const style = ref('fade')
const loop = ref(true)
const muted = ref(true)
const autoplay = ref(true)

const currentVideo = computed(() => uploadedVideoUrl.value || videoUrl.value)

async function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (!file.type.startsWith('video/')) {
    emit('log', '⚠ Nur Videodateien erlaubt')
    return
  }

  if (file.size > 500 * 1024 * 1024) {
    emit('log', '⚠ Video zu gross (max 500MB)')
    return
  }

  uploading.value = true
  uploadProgress.value = 0
  emit('log', `Lade hoch: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`)

  const reader = new FileReader()
  reader.onprogress = (e) => {
    if (e.lengthComputable) {
      uploadProgress.value = Math.round((e.loaded / e.total) * 50)
    }
  }
  reader.onload = async (e) => {
    const base64Data = e.target?.result as string
    previewSrc.value = base64Data
    uploadProgress.value = 50

    try {
      const response = await fetch('/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video: base64Data }),
      })
      uploadProgress.value = 90
      const data = await response.json()

      if (data.url) {
        uploadedVideoUrl.value = data.url
        videoUrl.value = ''
        uploadProgress.value = 100
        emit('log', `✓ Video hochgeladen: ${file.name}`)
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
  uploadedVideoUrl.value = null
  previewSrc.value = null
  uploadProgress.value = 0
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

function sendVideo() {
  if (!currentVideo.value) {
    emit('log', '⚠ Kein Video ausgewählt')
    return
  }

  emit('send', {
    type: 'send-video',
    url: currentVideo.value,
    fit: fit.value,
    style: style.value,
    loop: loop.value,
    muted: muted.value,
    autoplay: autoplay.value,
    target: props.selectedTarget,
  })

  emit('log', uploadedVideoUrl.value ? 'Video gesendet' : `Video gesendet: ${videoUrl.value.substring(0, 50)}...`)
}

function sendControl(action: string) {
  emit('send', {
    type: 'video-control',
    action,
    target: props.selectedTarget,
  })
  emit('log', `Video: ${action}`)
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Video senden</CardTitle>
    </CardHeader>
    <CardContent class="space-y-4">
      <!-- Upload dropzone -->
      <div>
        <Label>Video hochladen</Label>
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
            accept="video/*"
            class="hidden"
            @change="handleFileUpload"
          />

          <div v-if="previewSrc" class="relative inline-block">
            <video :src="previewSrc" class="max-h-32 rounded" muted />
            <button
              class="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-white rounded-full text-sm flex items-center justify-center hover:scale-110 transition-transform"
              @click.stop="clearUpload"
            >
              ✕
            </button>
          </div>

          <div v-else class="space-y-2">
            <div class="text-2xl">🎬</div>
            <div class="text-sm text-muted-foreground">
              Video hierher ziehen oder klicken
            </div>
            <div class="text-xs text-muted-foreground">
              MP4, WebM, OGG (max 500MB)
            </div>
          </div>

          <div v-if="uploading" class="absolute inset-0 flex flex-col items-center justify-center bg-background/80 rounded-lg">
            <span class="text-primary mb-2">Hochladen... {{ uploadProgress }}%</span>
            <div class="w-3/4 h-2 bg-muted rounded-full overflow-hidden">
              <div class="h-full bg-primary transition-all" :style="{ width: `${uploadProgress}%` }" />
            </div>
          </div>
        </div>
      </div>

      <!-- URL input -->
      <div>
        <Label>Oder Video-URL</Label>
        <Input
          v-model="videoUrl"
          type="url"
          placeholder="https://example.com/video.mp4"
          class="mt-1.5"
          :disabled="!!uploadedVideoUrl"
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

      <!-- Playback options -->
      <div class="flex flex-wrap gap-4">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="loop" class="w-4 h-4 rounded border-border" />
          <span class="text-sm">Wiederholen</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="muted" class="w-4 h-4 rounded border-border" />
          <span class="text-sm">Stumm</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" v-model="autoplay" class="w-4 h-4 rounded border-border" />
          <span class="text-sm">Autoplay</span>
        </label>
      </div>

      <Button @click="sendVideo" :disabled="!currentVideo">
        Video senden
      </Button>

      <!-- Playback controls -->
      <div class="pt-4 border-t border-border space-y-3">
        <Label>Wiedergabe-Steuerung</Label>
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" @click="sendControl('play')">
            ▶ Play
          </Button>
          <Button variant="outline" size="sm" @click="sendControl('pause')">
            ⏸ Pause
          </Button>
          <Button variant="outline" size="sm" @click="sendControl('stop')">
            ⏹ Stop
          </Button>
          <Button variant="outline" size="sm" @click="sendControl('mute')">
            🔇 Stumm
          </Button>
          <Button variant="outline" size="sm" @click="sendControl('unmute')">
            🔊 Ton an
          </Button>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
