# Scenes & Timeline Feature

## Context

The pilot currently sends content to displays one action at a time. The user wants to save combinations of content as named **scenes** (e.g. "an image on display 1, text on display 2, eyeball on display 3") and then **play those scenes sequentially** as a timeline — with manual stepping, auto-advance, and random mode.

## Data Model

```typescript
interface SceneItem {
  type: string           // "send-text" | "send-image" | "send-video" | "send-color" | "show-eyeball" | etc.
  target: 'all' | number // number = slot index (0-based position in client list)
  [key: string]: unknown // payload fields (text, url, color, style, fontSize, etc.)
}

interface Scene {
  id: string
  name: string
  items: SceneItem[]
  durationMs: number     // auto-advance delay (default 5000, 0 = manual only)
  transition: string     // "fade" | "cut"
}
```

Scenes stored as JSON in `data/scenes.json`. Slot indices (not ephemeral client IDs) used for targets so scenes survive restarts.

## Changes

### 1. Server (`server.js`)

**Add data directory setup** (after uploads dir, ~line 12):
- `DATA_DIR = path.join(__dirname, "data")`, ensure exists

**Add REST API endpoints** (after `/upload` handler, before static routes at line 121):

| Endpoint | Purpose |
|----------|---------|
| `GET /api/scenes` | Return scenes JSON (or empty default) |
| `PUT /api/scenes` | Save full scenes array to disk |
| `POST /api/scenes/capture` | Snapshot current `contentHistory` into a new scene, mapping client IDs → slot indices |

**Add WebSocket handler** in `handlePilotMessage()` (after `config-display` case, ~line 492):
- `play-scene`: Clear all displays, wait for animation, then replay each scene item through existing `handlePilotMessage` (resolving slot indices → current client IDs)

### 2. Vite Proxy (`pilot/vite.config.ts`)

Add `'/api': 'http://localhost:3000'` to proxy config.

### 3. Composable (`pilot/src/composables/useScenes.ts`) — NEW

State management for scenes and playback:
- `scenes`, `activeSceneIndex`, `playbackMode` ('manual'|'auto'|'random'), `isPlaying` refs
- CRUD: `loadScenes()`, `saveScenes()`, `captureScene()`, `addScene()`, `updateScene()`, `removeScene()`, `reorderScenes()`
- Playback: `playScene()`, `nextScene()`, `prevScene()`, `startAutoPlay()`, `stopAutoPlay()`
- Takes `send` function from `useWebSocket` as parameter

### 4. Scene Editor (`pilot/src/components/panels/SceneEditor.vue`) — NEW

Inline editor shown when editing a scene:
- Scene name, duration, transition inputs
- Item list with type badges, target selectors, content summaries, remove buttons
- "Element hinzufugen" section with type-specific mini-forms (text, image, video, color, eyeball)
- Drag-to-reorder items (native HTML5 drag API)

### 5. Scenes Panel (`pilot/src/components/panels/ScenesPanel.vue`) — NEW

Main UI panel (follows existing Card panel pattern):
- **Toolbar**: "Aktuelle Ansicht erfassen" button, playback controls (prev/play-pause/next), mode selector (Manuell/Automatisch/Zufall)
- **Scene list**: Each scene shows name (editable), item count badge, duration, play/edit/duplicate/delete buttons, active highlight
- **Editor area**: Renders SceneEditor inline when a scene is selected for editing
- Drag-to-reorder scenes

### 6. App Integration (`pilot/src/App.vue`)

- Import and add `ScenesPanel` between `ControlPanel` and `ActivityLog`
- Pass `:selectedTarget`, `:clients`, `@send`, `@log`

### 7. Gitignore (`.gitignore`)

Add `/data/` entry.

## Implementation Order

1. Server: data dir + REST endpoints + `play-scene` WebSocket handler
2. `.gitignore` + `vite.config.ts` proxy
3. `useScenes.ts` composable
4. `SceneEditor.vue` component
5. `ScenesPanel.vue` component
6. `App.vue` integration

## Verification

1. Start server (`npm start`), use curl to test `GET/PUT /api/scenes` and `POST /api/scenes/capture`
2. Build pilot (`npm run build`), open pilot UI, verify ScenesPanel renders
3. Send content to displays, click "Aktuelle Ansicht erfassen", verify scene appears in list
4. Edit a scene (rename, add/remove items, change duration)
5. Click play on a scene — displays should clear and show the scene's content
6. Test auto-advance: set durations, click play, verify scenes advance
7. Test random mode: verify different scene each time
8. Restart server, verify scenes persist from `data/scenes.json`
