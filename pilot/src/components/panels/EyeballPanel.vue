<script setup lang="ts">
import { ref, onUnmounted, computed } from 'vue'
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

// Eyeball state
const eyeballActive = ref(false)
const irisColor = ref('#4a7c59')
const bgColor = ref('#0a0a0a')

// Face tracking state
const tracking = ref(false)
const videoRef = ref<HTMLVideoElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const detector = ref<any>(null)
const trackingInterval = ref<number | null>(null)
const faceDetected = ref(false)
const lastFacePos = ref({ x: 0, y: 0 })
const isInitializing = ref(false)
const tfLock = ref(false)

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
  if (tracking.value || isInitializing.value || tfLock.value) return

  isInitializing.value = true
  tfLock.value = true
  emit('log', 'Initialisiere Face Detection...')

  try {
    // 1. Get webcam first (most likely to fail/timeout)
    emit('log', 'Starte Webcam...')
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { 
        width: { ideal: 640 }, 
        height: { ideal: 480 }, 
        facingMode: 'user' 
      }
    })

    // Check if we were stopped while waiting for the camera
    if (!isInitializing.value || !eyeballActive.value) {
      emit('log', 'Webcam gestoppt (Initialisierung abgebrochen)')
      stream.getTracks().forEach(track => track.stop())
      return
    }

    if (videoRef.value) {
      videoRef.value.srcObject = stream
      
      // Wait for metadata with timeout
      await new Promise((resolve, reject) => {
        if (!videoRef.value) return resolve(null)
        if (videoRef.value.readyState >= 1) return resolve(null)
        
        const timeout = setTimeout(() => {
          if (videoRef.value) videoRef.value.onloadedmetadata = null
          reject(new Error('Timeout beim Laden der Video-Metadaten'))
        }, 10000)
        
        videoRef.value.onloadedmetadata = () => {
          clearTimeout(timeout)
          resolve(null)
        }
      })
      
      try {
        await videoRef.value.play()
      } catch (playError) {
        console.warn('Video play error:', playError)
        // Many browsers require user gesture for play() if not muted, 
        // but we should be muted. Try again just in case.
        if (videoRef.value) {
          videoRef.value.muted = true
          await videoRef.value.play()
        }
      }
    }

    // 2. Initialize TensorFlow.js
    // Check if TensorFlow.js and BlazeFace are loaded (via script tags)
    // @ts-ignore - global tf and blazeface from script tags
    if (typeof window.tf === 'undefined' || typeof window.blazeface === 'undefined') {
      throw new Error('TensorFlow.js nicht geladen. Bitte Seite neu laden.')
    }

    // @ts-ignore
    const tf = window.tf
    // @ts-ignore
    const blazeface = window.blazeface

    // Explicitly set WebGL backend and wait for it to be ready
    emit('log', 'Initialisiere WebGL Backend...')
    
    try {
      // Set environment flags for better performance and stability
      tf.env().set('WEBGL_PACK', true)
      // Be conservative with texture deletion to avoid race conditions with internal BlazeFace tensors
      tf.env().set('WEBGL_DELETE_TEXTURE_THRESHOLD', -1) 
      
      // Ensure we are starting fresh
      await tf.ready()
      
      // Force webgl if possible
      try {
        await tf.setBackend('webgl')
        await tf.ready()
      } catch (e) {
        console.warn('WebGL initialization failed, checking current backend', e)
      }

      if (tf.getBackend() !== 'webgl') {
        emit('log', '⚠ WebGL nicht verfügbar, nutze CPU (langsamer)...')
        await tf.setBackend('cpu')
        await tf.ready()
      }
    } catch (backendError) {
      emit('log', `⚠ Backend-Fehler: ${(backendError as Error).message}`)
      throw backendError
    }
    
    emit('log', `TensorFlow.js Backend: ${tf.getBackend()}`)

    // 3. Load BlazeFace model
    emit('log', 'Lade BlazeFace Model...')
    
    // Ensure TF is ready before loading model
    await tf.ready()
    
    detector.value = await blazeface.load({
      modelUrl: '/lib/blazeface-model/model.json'
    })

    // Warmup the model
    try {
      emit('log', 'Wärme Modell auf...')
      // Give it a moment to stabilize
      await new Promise(resolve => setTimeout(resolve, 300))
      
      const warmupInput = (videoRef.value && videoRef.value.readyState >= 2) 
        ? videoRef.value 
        : document.createElement('canvas')
      
      if (warmupInput instanceof HTMLCanvasElement) {
        warmupInput.width = 128
        warmupInput.height = 128
      }
      
      await detector.value.estimateFaces(warmupInput, false)
      emit('log', 'Warmup erfolgreich')
    } catch (e) {
      console.warn('Warmup failed:', e)
      const errorMessage = e instanceof Error ? e.message : String(e)
      if (errorMessage.includes('backend') || errorMessage.includes('defined')) {
        throw new Error(`Warmup-Backend-Fehler: ${errorMessage}`)
      }
    }

    tracking.value = true
    emit('log', 'Face Tracking gestartet')

    // Start detection loop
    detectFaces()
  } catch (err) {
    emit('log', `⚠ Fehler: ${(err as Error).message}`)
    console.error('Face tracking error:', err)
    stopTracking()
    
    // Auto-recovery attempt if it was a backend or camera error during initialization
    const errorMessage = (err as Error).message || String(err)
    const errorName = (err as any).name || ''
    
    if (
      errorMessage.includes('backend') || 
      errorMessage.includes('defined') || 
      errorMessage.includes('Warmup') ||
      errorMessage.includes('Timeout') ||
      errorName === 'AbortError' ||
      errorName === 'NotReadableError'
    ) {
      setTimeout(() => {
        if (!tracking.value && eyeballActive.value) {
          emit('log', 'Versuche Neustart nach Initialisierungsfehler...')
          startTracking()
        }
      }, 5000) // Delay for recovery
    }
  } finally {
    isInitializing.value = false
    tfLock.value = false
  }
}

async function detectFaces() {
  if (!tracking.value || !detector.value || !videoRef.value || tfLock.value) {
    if (tracking.value) {
      setTimeout(() => requestAnimationFrame(detectFaces), 50)
    }
    return
  }

  tfLock.value = true
  
  try {
    // Ensure video is ready
    if (videoRef.value.readyState < 2) {
      tfLock.value = false
      requestAnimationFrame(detectFaces)
      return
    }

    // @ts-ignore
    const tf = window.tf
    if (!tf || !detector.value) {
      tfLock.value = false
      return
    }

    // Log memory occasionally
    if (Math.random() < 0.01) {
      console.log('TF Memory:', tf.memory())
    }
    
    // BlazeFace returns predictions array
    let predictions = []
    try {
      // EXTRA GUARD: Check again before calling estimateFaces
      if (tracking.value && detector.value) {
        // Use a local reference to the video element to avoid potential nulling during await
        const videoElement = videoRef.value
        if (videoElement && videoElement.videoWidth > 0) {
          // Double check backend is still valid and not lost
          const backend = tf.backend()
          if (tf.getBackend() === 'webgl' && backend && typeof (backend as any).getGPGPUContext === 'function') {
            const gl = (backend as any).getGPGPUContext().gl
            if (gl && gl.isContextLost()) {
              throw new Error('WebGL context lost')
            }
          }

          if (tf.getBackend() && backend) {
            // estimateFaces is async, BlazeFace handles its own internal tensors
            predictions = await detector.value.estimateFaces(videoElement, false)
          } else {
            throw new Error('Backend lost before estimation')
          }
        }
      }
    } catch (e) {
      console.error('BlazeFace estimation error:', e)
      // If backend is lost, try to recover
      const errorMessage = e instanceof Error ? e.message : String(e)
      if (
        errorMessage.includes('backend') || 
        errorMessage.includes('defined') || 
        errorMessage.includes('context lost') ||
        errorMessage.includes('Timeout')
      ) {
        emit('log', '⚠ Backend verloren, versuche Recovery...')
        tfLock.value = false
        stopTracking()
        
        // Auto-recovery attempt
        setTimeout(() => {
          if (!tracking.value && eyeballActive.value) {
            emit('log', 'Versuche Neustart nach Fehler...')
            startTracking()
          }
        }, 3000)
        return
      }
    }

    if (predictions.length > 0) {
      faceDetected.value = true
      const face = predictions[0]

      // BlazeFace provides topLeft and bottomRight as arrays [x, y]
      const topLeft: number[] = Array.isArray(face.topLeft) ? face.topLeft : [0, 0]
      const bottomRight: number[] = Array.isArray(face.bottomRight) ? face.bottomRight : [0, 0]

      const width = (bottomRight[0] ?? 0) - (topLeft[0] ?? 0)
      const height = (bottomRight[1] ?? 0) - (topLeft[1] ?? 0)

      // Calculate center of face
      const centerX = (topLeft[0] ?? 0) + width / 2
      const centerY = (topLeft[1] ?? 0) + height / 2

      // Normalize to -1 to 1 (invert X for mirror effect)
      const normalizedX = -((centerX / 640) * 2 - 1)
      const normalizedY = -((centerY / 480) * 2 - 1)

      // Estimate depth from face size (larger face = closer)
      const faceSize = width * height
      const normalizedZ = Math.max(1, 10 - (faceSize / 10000))

      lastFacePos.value = { x: normalizedX, y: normalizedY }

      // Send gaze update
      emit('send', {
        type: 'eyeball-gaze',
        target: 'all',
        x: normalizedX * 3, // Scale to room coordinates
        y: normalizedY * 2,
        z: normalizedZ
      })

      // Draw on canvas for preview
      if (canvasRef.value) {
        const ctx = canvasRef.value.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, 160, 120)
          ctx.drawImage(videoRef.value, 0, 0, 160, 120)
          ctx.strokeStyle = '#00ff00'
          ctx.lineWidth = 2
          ctx.strokeRect(
            (topLeft[0] ?? 0) / 4,
            (topLeft[1] ?? 0) / 4,
            width / 4,
            height / 4
          )
        }
      }
    } else {
      faceDetected.value = false
    }
  } catch (err) {
    console.error('Detection error:', err)
  } finally {
    tfLock.value = false
  }

  // Continue loop with throttling
  if (tracking.value) {
    // Check one more time before scheduling next frame
    setTimeout(() => {
      if (tracking.value) {
        requestAnimationFrame(detectFaces)
      }
    }, 50) // ~20 FPS
  }
}

async function stopTracking() {
  if (!tracking.value && !isInitializing.value) return
  
  tracking.value = false
  isInitializing.value = false
  faceDetected.value = false

  // Wait for lock to be free (max 1s)
  let waitStart = Date.now()
  while (tfLock.value && Date.now() - waitStart < 1000) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  
  tfLock.value = true
  
  try {
    // First null the detector so no more inference can start
    const currentDetector = detector.value
    detector.value = null

    // Ensure any pending engine scopes are cleared immediately
    // @ts-ignore
    const tf = window.tf
    if (tf && tf.engine) {
      try {
        while (tf.engine().state.scopeStack.length > 0) {
          tf.engine().endScope()
        }
      } catch (e) {}
    }

    if (videoRef.value?.srcObject) {
      const stream = videoRef.value.srcObject as MediaStream
      stream.getTracks().forEach(track => track.stop())
      videoRef.value.srcObject = null
    }

    if (trackingInterval.value) {
      clearInterval(trackingInterval.value)
      trackingInterval.value = null
    }

    // Clear canvas
    if (canvasRef.value) {
      const ctx = canvasRef.value.getContext('2d')
      if (ctx) ctx.clearRect(0, 0, 160, 120)
    }

    // Dispose of detector if possible to free up WebGL memory
    if (currentDetector && typeof currentDetector.dispose === 'function') {
      try {
        currentDetector.dispose()
      } catch (e) {
        console.warn('detector dispose failed', e)
      }
    }
    
    // Clean up global TF state safely
    if (tf) {
      try {
        // Clear out any remaining engine scopes (already done above but safe to repeat)
        if (typeof tf.engine === 'function') {
          try {
            while (tf.engine().state.scopeStack.length > 0) {
              tf.engine().endScope()
            }
          } catch (e) {}
        }
        
        // Aggressively clear textures if we have many
        if (tf.getBackend() === 'webgl') {
          // @ts-ignore
          const numTextures = tf.memory().numTextures
          if (numTextures > 100) {
            console.log(`Cleaning up ${numTextures} textures...`)
            // This is a bit of a hack but can help force GC
            if (typeof tf.disposeVariables === 'function') {
              // tf.disposeVariables() // Still risky, but maybe necessary if numTextures is huge
            }
          }
        }
      } catch (e) {
        console.warn('tf cleanup failed', e)
      }
    }
  } finally {
    tfLock.value = false
  }

  emit('log', 'Face Tracking gestoppt')
}

onUnmounted(() => {
  stopTracking()
})
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Eyeball</CardTitle>
    </CardHeader>
    <CardContent class="space-y-4">
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
            👁️ Eyeball anzeigen
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
                📷 Starten
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
                <Label class="text-xs">Rot°</Label>
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
