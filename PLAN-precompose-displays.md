# Plan: Precompose Display Configurations

## Concept

Define **logical display slots** with pre-configured content before any physical display connects. When displays come online, they get assigned to slots and automatically receive their configuration.

## Data Model

```typescript
interface PrecomposedSlot {
  id: string                       // stable unique ID
  name: string                     // user label, e.g., "Eingang Links"
  assignedClientId: number | null  // connected client ID, or null
  content: SlotContent[]           // content items to push on assignment
  bgColor: string
  displayConfig: {
    x: number
    y: number
    z: number
    rotation: number
  } | null
}

interface SlotContent {
  type: string        // "send-text" | "send-image" | "send-video" | "send-color" | "show-eyeball" etc.
  [key: string]: unknown  // type-specific payload
}

interface PrecomposeLayout {
  id: string
  name: string
  slots: PrecomposedSlot[]
  createdAt: string
  assignmentMode: 'auto' | 'manual'
}
```

Persisted to `data/precompose.json` (same pattern as existing scenes).

## Assignment Modes

- **Auto**: displays assigned to slots in FIFO order as they connect
- **Manual**: user selects which display maps to which slot via UI

## Implementation Steps

### Step 1: Data model + persistence (server.js)

- Add REST endpoints `GET /api/precompose` and `PUT /api/precompose`
- Load/save `data/precompose.json` on startup and on updates
- Add state: `precomposeLayout`, `slotAssignments` map

### Step 2: Server assignment logic (server.js)

- Modify client connection handler (lines ~370-427): when precompose layout is active and `assignmentMode === 'auto'`, assign new client to first unassigned slot and push content
- On client disconnect: mark slot as unassigned, notify pilot
- Add WebSocket message types:
  - `precompose-assign` — manually assign a client to a slot
  - `precompose-unassign` — remove a client from a slot
  - `precompose-push` — push a single slot's content to its assigned client
  - `precompose-push-all` — push all slots' content
- Send `precompose-status` messages to pilot with current assignment state

### Step 3: `usePrecompose.ts` composable (new file)

- Follows `useScenes.ts` pattern (refs, CRUD, API calls, send function parameter)
- State: `layout` ref, `isActive` ref, `assignments` computed
- CRUD: `loadLayout()`, `saveLayout()`, `addSlot()`, `removeSlot()`, `updateSlot()`, `reorderSlots()`
- Assignment: `assignClient()`, `unassignClient()`, `activateLayout()`, `deactivateLayout()`
- Content: `addContentToSlot()`, `removeContentFromSlot()`, `updateSlotContent()`

### Step 4: `SlotEditor.vue` (new component)

- Inline editor for a single slot's content
- Mini forms for each content type (reuse patterns from TextPanel/ImagePanel/VideoPanel)
- Content item list with type badges, summaries, remove buttons
- Display config fields (x, y, z, rotation)
- Background color picker

### Step 5: `PrecomposePanel.vue` (new panel)

- Collapsible Card panel (matching existing panel pattern)
- Layout toolbar: name input, "Aktivieren"/"Deaktivieren" toggle, assignment mode selector
- Slot list: each slot as a card with:
  - Editable name
  - Assignment status badge (green "Laptop 3" or gray "Nicht zugewiesen")
  - Manual assignment dropdown (when mode=manual)
  - Content summary (icons/badges for each content item)
  - "Bearbeiten" / "Senden" / "Entfernen" buttons
- "+ Display-Slot hinzufügen" button

### Step 6: `ClientList.vue` modifications

- When precompose is active, show precomposed slots with assignment status
- Unassigned connected clients shown separately at the bottom with "Zuweisen" action
- Clicking a slot sets `selectedTarget` to the slot's assigned client ID

### Step 7: `App.vue` integration

- Import and add `PrecomposePanel` to the main content area
- Pass `clients`, `selectedTarget`, `send`, `log` props

### Step 8: `useWebSocket.ts` modifications

- Handle `precompose-status` message type from server
- Expose precompose-related state to components

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| More displays than slots | Extras remain unassigned; shown in sidebar, controllable manually |
| Fewer displays than slots | Unassigned slots wait; content auto-pushed when a display connects |
| Display reconnects | Slot marked unassigned on disconnect, re-assigned on reconnect |
| Display connects before activation | Normal behavior until layout is activated |
| Content update while active | Edit slot content and click "Senden" to push to assigned client |
| Switching layouts | Deactivate current (clears displays), activate new one |
| Scenes + Precompose | Scene slot indices map to precomposed slot order when active |

## Open Design Decisions

1. **Single layout vs. multiple saved layouts?** — Recommend starting with one active layout, expand later
2. **Auto-push on assignment vs. explicit "Send" button?** — Recommend auto-push with manual override
3. **Should the slot editor mirror existing panels exactly, or provide a simplified subset?**

## Critical Files

- `server.js` — client registration (~line 370), message routing, REST API
- `pilot/src/composables/useWebSocket.ts` — WebSocket state management
- `pilot/src/composables/useScenes.ts` — reference pattern for new composable
- `pilot/src/components/ClientList.vue` — display list UI
- `pilot/src/components/panels/ScenesPanel.vue` — reference pattern for new panel
- `pilot/src/App.vue` — panel wiring
