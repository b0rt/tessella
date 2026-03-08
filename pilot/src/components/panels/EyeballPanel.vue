<script setup lang="ts">
import { ref, onUnmounted, computed } from 'vue'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision'
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

// Face tracking state
const tracking = ref(false)
const videoRef = ref<HTMLVideoElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const faceDetected = ref(false)
const lastFacePos = ref({ x: 0, y: 0 })
const isInitializing = ref(false)

// Tracking performance settings
const targetFps = ref(8)
const movementThreshold = ref(0.02)

let detector: FaceDetector | null = null
let lastVideoTime = -1
let animFrameId: number | null = null
let detectionTimeout: ReturnType<typeof setTimeout> | null = null
let lastSentX = 0
let lastSentY = 0
let lastSentZ = 0

// Poisson-distributed interval: next delay drawn from exponential distribution
function poissonDelay(): number {
  const meanInterval = 1000 / targetFps.value
  // Exponential distribution: -mean * ln(U), clamped to reasonable bounds
  const u = Math.max(0.001, Math.random())
  return Math.min(Math.max(meanInterval * -Math.log(u), 20), meanInterval * 3)
}

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
  stopTracking()
  emit('log', 'Eyeball deaktiviert')
}

async function startTracking() {
  if (tracking.value || isInitializing.value) return

  // Auto-show eyeball if not already active
  if (!eyeballActive.value) {
    showEyeball()
  }

  isInitializing.value = true
  emit('log', 'Initialisiere Face Detection...')

  try {
    // 1. Get webcam
    emit('log', 'Starte Webcam...')
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user'
      }
    })

    if (!isInitializing.value) {
      emit('log', 'Webcam gestoppt (Initialisierung abgebrochen)')
      stream.getTracks().forEach(track => track.stop())
      return
    }

    if (videoRef.value) {
      videoRef.value.srcObject = stream

      await new Promise<void>((resolve, reject) => {
        if (!videoRef.value) return resolve()
        if (videoRef.value.readyState >= 1) return resolve()

        const timeout = setTimeout(() => {
          reject(new Error('Timeout beim Laden der Video-Metadaten'))
        }, 10000)

        videoRef.value.onloadedmetadata = () => {
          clearTimeout(timeout)
          resolve()
        }
      })

      await videoRef.value.play()
    }

    // 2. Initialize MediaPipe Face Detector
    emit('log', 'Lade MediaPipe Vision...')
    const vision = await FilesetResolver.forVisionTasks('/lib/mediapipe/wasm')

    emit('log', 'Lade Face Detection Model...')
    detector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: '/lib/mediapipe/blaze_face_short_range.tflite',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5
    })

    tracking.value = true
    lastVideoTime = -1
    emit('log', 'Face Tracking gestartet')

    // Start detection loop
    detectFaces()
  } catch (err) {
    emit('log', `Fehler: ${(err as Error).message}`)
    console.error('Face tracking error:', err)
    stopTracking()
  } finally {
    isInitializing.value = false
  }
}

function detectFaces() {
  if (!tracking.value || !detector || !videoRef.value) return

  if (videoRef.value.readyState >= 2 && videoRef.value.currentTime !== lastVideoTime) {
    lastVideoTime = videoRef.value.currentTime

    try {
      const result = detector.detectForVideo(videoRef.value, performance.now())

      const face = result.detections[0]
      if (face && face.boundingBox) {
        faceDetected.value = true
        const box = face.boundingBox

        const centerX = box.originX + box.width / 2
        const centerY = box.originY + box.height / 2

        // Normalize to -1 to 1 (invert X for mirror effect)
        const videoWidth = videoRef.value.videoWidth || 640
        const videoHeight = videoRef.value.videoHeight || 480
        const normalizedX = -((centerX / videoWidth) * 2 - 1)
        const normalizedY = -((centerY / videoHeight) * 2 - 1)

        // Estimate depth from face size (larger face = closer)
        const faceSize = box.width * box.height
        const normalizedZ = Math.max(1, 10 - (faceSize / 10000))

        lastFacePos.value = { x: normalizedX, y: normalizedY }

        // Only send gaze update if position changed beyond threshold
        const gazeX = normalizedX * 3
        const gazeY = normalizedY * 2
        const dx = Math.abs(gazeX - lastSentX)
        const dy = Math.abs(gazeY - lastSentY)
        const dz = Math.abs(normalizedZ - lastSentZ)

        if (dx > movementThreshold.value || dy > movementThreshold.value || dz > 0.5) {
          lastSentX = gazeX
          lastSentY = gazeY
          lastSentZ = normalizedZ

          emit('send', {
            type: 'eyeball-gaze',
            target: 'all',
            x: gazeX,
            y: gazeY,
            z: normalizedZ
          })
        }

        // Draw on canvas for preview
        if (canvasRef.value) {
          const ctx = canvasRef.value.getContext('2d')
          if (ctx) {
            ctx.clearRect(0, 0, 160, 120)
            ctx.drawImage(videoRef.value, 0, 0, 160, 120)
            ctx.strokeStyle = '#00ff00'
            ctx.lineWidth = 2
            ctx.strokeRect(
              box.originX / (videoWidth / 160),
              box.originY / (videoHeight / 120),
              box.width / (videoWidth / 160),
              box.height / (videoHeight / 120)
            )
          }
        }
      } else {
        faceDetected.value = false
      }
    } catch (err) {
      console.error('Detection error:', err)
    }
  }

  // Continue loop with Poisson-distributed intervals
  if (tracking.value) {
    const delay = poissonDelay()
    detectionTimeout = setTimeout(() => {
      animFrameId = requestAnimationFrame(detectFaces)
    }, delay)
  }
}

function stopTracking() {
  tracking.value = false
  isInitializing.value = false
  faceDetected.value = false

  if (detectionTimeout !== null) {
    clearTimeout(detectionTimeout)
    detectionTimeout = null
  }

  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId)
    animFrameId = null
  }

  if (videoRef.value?.srcObject) {
    const stream = videoRef.value.srcObject as MediaStream
    stream.getTracks().forEach(track => track.stop())
    videoRef.value.srcObject = null
  }

  if (canvasRef.value) {
    const ctx = canvasRef.value.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, 160, 120)
  }

  if (detector) {
    detector.close()
    detector = null
  }

  emit('log', 'Face Tracking gestoppt')
}

onUnmounted(() => {
  stopTracking()
})
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

      <!-- Face tracking -->
      <div class="pt-4 border-t border-border space-y-3">
        <Label>Face Tracking</Label>

        <div class="flex gap-4 items-start">
          <div class="relative">
            <video
              ref="videoRef"
              class="hidden"
              width="640"
              height="480"
              autoplay
              playsinline
              muted
            />
            <canvas
              ref="canvasRef"
              width="160"
              height="120"
              class="rounded border border-border bg-black"
            />
            <div
              v-if="tracking"
              class="absolute top-1 right-1 w-2 h-2 rounded-full"
              :class="faceDetected ? 'bg-green-500' : 'bg-red-500'"
            />
          </div>

          <div class="space-y-2 flex-1">
            <div class="flex gap-2">
              <Button
                size="sm"
                @click="startTracking"
                :disabled="tracking || isInitializing"
              >
                Starten
              </Button>
              <Button
                size="sm"
                variant="outline"
                @click="stopTracking"
                :disabled="!tracking"
              >
                Stoppen
              </Button>
            </div>

            <div class="space-y-1">
              <div class="flex gap-2 items-center">
                <Label class="text-xs whitespace-nowrap">FPS:</Label>
                <Input
                  type="number"
                  v-model.number="targetFps"
                  min="1"
                  max="30"
                  step="1"
                  class="h-7 text-xs w-16"
                  :disabled="tracking"
                />
                <span class="text-xs text-muted-foreground">(Poisson)</span>
              </div>
            </div>

            <div v-if="tracking" class="text-sm text-muted-foreground">
              <div>Status: {{ faceDetected ? 'Gesicht erkannt' : 'Kein Gesicht' }}</div>
              <div v-if="faceDetected">
                X: {{ lastFacePos.x.toFixed(2) }}, Y: {{ lastFacePos.y.toFixed(2) }}
              </div>
            </div>
          </div>
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
