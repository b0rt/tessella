# Tessella Pilot – Control Panel

Vue.js-basierte Steueroberfläche für das [Tessella](../) Multi-Display-System.

## Tech Stack

- Vue 3 + TypeScript (`<script setup>` SFCs)
- Vite (Build + Dev-Server)
- Tailwind CSS v3
- Radix Vue (UI-Primitives)

## Development

```bash
# Dev-Server starten (Hot-Reload, Port 5173)
npm run dev

# Der Hauptserver muss parallel laufen (npm start im Root-Verzeichnis)
```

Der Dev-Server proxied API-Aufrufe (`/api`, `/upload`, `/uploads`, `/fonts`, `/lib`) zum Hauptserver auf Port 3000.

## Build

```bash
npm run build
```

Output: `../dist/pilot/` (wird vom Hauptserver ausgeliefert).

## Struktur

```
src/
├── App.vue
├── components/
│   ├── ClientList.vue
│   ├── panels/          # Feature-Panels (Text, Bild, Video, Effekte, etc.)
│   └── ui/              # Basis-UI-Komponenten (Radix Vue)
└── composables/
    ├── useWebSocket.ts  # WebSocket-Verbindung zum Server
    ├── useScenes.ts     # Szenen-Verwaltung
    └── useTheme.ts      # Theme-Umschaltung
```
