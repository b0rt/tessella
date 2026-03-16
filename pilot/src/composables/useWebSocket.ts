import { ref, onMounted } from 'vue'

export interface Client {
  id: number
  name: string
}

export interface LogEntry {
  time: string
  message: string
}

export interface PrecomposedSlot {
  id: string
  name: string
  assignedClientId: number | null
  content: Record<string, unknown>[]
  bgColor: string
  displayConfig: {
    x: number
    y: number
    z: number
    rotation: number
  } | null
}

export interface PrecomposeLayout {
  id: string
  name: string
  slots: PrecomposedSlot[]
  createdAt: string
  assignmentMode: 'auto' | 'manual'
}

export interface PrecomposeStatus {
  layout: PrecomposeLayout | null
  active: boolean
}

const ws = ref<WebSocket | null>(null)
const connected = ref(false)
const clients = ref<Client[]>([])
const logs = ref<LogEntry[]>([])
const precomposeStatus = ref<PrecomposeStatus>({ layout: null, active: false })

export function useWebSocket() {
  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    ws.value = new WebSocket(`${protocol}//${location.host}?role=pilot`)

    ws.value.onopen = () => {
      connected.value = true
      log('Pilot verbunden')
    }

    ws.value.onclose = () => {
      connected.value = false
      setTimeout(connect, 2000)
    }

    ws.value.onerror = () => {
      ws.value?.close()
    }

    ws.value.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'client-list') {
          clients.value = msg.clients
          log(`${msg.clients.length} Display(s) verbunden`)
        } else if (msg.type === 'precompose-status') {
          precomposeStatus.value = { layout: msg.layout, active: msg.active }
        }
      } catch (e) {
        console.error('Parse error:', e)
      }
    }
  }

  function send(msg: Record<string, unknown>): boolean {
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(msg))
      return true
    }
    log('⚠ Nicht verbunden')
    return false
  }

  function log(message: string) {
    const time = new Date().toLocaleTimeString('de-DE')
    logs.value.push({ time, message })
    // Keep only last 100 entries
    if (logs.value.length > 100) {
      logs.value = logs.value.slice(-100)
    }
  }

  function clearLogs() {
    logs.value = []
  }

  onMounted(() => {
    if (!ws.value) {
      connect()
    }
  })

  return {
    connected,
    clients,
    logs,
    precomposeStatus,
    send,
    log,
    clearLogs,
  }
}
