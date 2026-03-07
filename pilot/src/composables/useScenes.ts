import { ref } from 'vue'

export interface SceneItem {
  type: string
  target: 'all' | number
  [key: string]: unknown
}

export interface Scene {
  id: string
  name: string
  items: SceneItem[]
  durationMs: number
  transition: string
  bgColor: string
}

type PlaybackMode = 'manual' | 'auto' | 'random'

const scenes = ref<Scene[]>([])
const activeSceneIndex = ref(-1)
const playbackMode = ref<PlaybackMode>('manual')
const isPlaying = ref(false)
let autoTimer: ReturnType<typeof setTimeout> | null = null

export function useScenes(send: (msg: Record<string, unknown>) => boolean) {

  async function loadScenes() {
    try {
      const res = await fetch('/api/scenes')
      scenes.value = await res.json()
    } catch (e) {
      console.error('Failed to load scenes:', e)
    }
  }

  async function saveScenes() {
    try {
      await fetch('/api/scenes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scenes.value),
      })
    } catch (e) {
      console.error('Failed to save scenes:', e)
    }
  }

  async function captureScene(): Promise<Scene | null> {
    try {
      const res = await fetch('/api/scenes/capture', { method: 'POST' })
      const scene: Scene = await res.json()
      scenes.value.push(scene)
      return scene
    } catch (e) {
      console.error('Failed to capture scene:', e)
      return null
    }
  }

  function addScene(scene: Scene) {
    scenes.value.push(scene)
    saveScenes()
  }

  function updateScene(index: number, updates: Partial<Scene>) {
    if (index >= 0 && index < scenes.value.length) {
      Object.assign(scenes.value[index]!, updates)
      saveScenes()
    }
  }

  function removeScene(index: number) {
    scenes.value.splice(index, 1)
    if (activeSceneIndex.value >= scenes.value.length) {
      activeSceneIndex.value = scenes.value.length - 1
    }
    saveScenes()
  }

  function duplicateScene(index: number) {
    const original = scenes.value[index]
    if (!original) return
    const copy: Scene = {
      ...JSON.parse(JSON.stringify(original)),
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: original.name + ' (Kopie)',
    }
    scenes.value.splice(index + 1, 0, copy)
    saveScenes()
  }

  function reorderScenes(fromIndex: number, toIndex: number) {
    const moved = scenes.value.splice(fromIndex, 1)[0]
    if (!moved) return
    scenes.value.splice(toIndex, 0, moved)
    // Adjust active index
    if (activeSceneIndex.value === fromIndex) {
      activeSceneIndex.value = toIndex
    } else if (fromIndex < activeSceneIndex.value && toIndex >= activeSceneIndex.value) {
      activeSceneIndex.value--
    } else if (fromIndex > activeSceneIndex.value && toIndex <= activeSceneIndex.value) {
      activeSceneIndex.value++
    }
    saveScenes()
  }

  function playScene(index: number) {
    if (index < 0 || index >= scenes.value.length) return
    activeSceneIndex.value = index
    const scene = scenes.value[index]!
    send({
      type: 'play-scene',
      items: scene.items,
      transition: scene.transition,
      bgColor: scene.bgColor || '#0a0a0a',
    })
  }

  function nextScene() {
    if (scenes.value.length === 0) return
    if (playbackMode.value === 'random') {
      const next = Math.floor(Math.random() * scenes.value.length)
      playScene(next)
    } else {
      const next = (activeSceneIndex.value + 1) % scenes.value.length
      playScene(next)
    }
  }

  function prevScene() {
    if (scenes.value.length === 0) return
    const prev = activeSceneIndex.value <= 0
      ? scenes.value.length - 1
      : activeSceneIndex.value - 1
    playScene(prev)
  }

  function startAutoPlay() {
    if (scenes.value.length === 0) return
    isPlaying.value = true
    if (activeSceneIndex.value < 0) {
      playScene(0)
    }
    scheduleNext()
  }

  function scheduleNext() {
    stopTimer()
    if (!isPlaying.value || scenes.value.length === 0) return
    const scene = scenes.value[activeSceneIndex.value]
    const delay = scene ? scene.durationMs : 5000
    autoTimer = setTimeout(() => {
      if (isPlaying.value) {
        nextScene()
        scheduleNext()
      }
    }, delay)
  }

  function stopAutoPlay() {
    isPlaying.value = false
    stopTimer()
  }

  function stopTimer() {
    if (autoTimer) {
      clearTimeout(autoTimer)
      autoTimer = null
    }
  }

  function togglePlayback() {
    if (isPlaying.value) {
      stopAutoPlay()
    } else {
      startAutoPlay()
    }
  }

  function setPlaybackMode(mode: string) {
    playbackMode.value = mode as PlaybackMode
  }

  return {
    scenes,
    activeSceneIndex,
    playbackMode,
    isPlaying,
    loadScenes,
    saveScenes,
    captureScene,
    addScene,
    updateScene,
    removeScene,
    duplicateScene,
    reorderScenes,
    playScene,
    nextScene,
    prevScene,
    startAutoPlay,
    stopAutoPlay,
    togglePlayback,
    setPlaybackMode,
  }
}
