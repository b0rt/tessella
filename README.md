# 🖥️ Laptop Installation – Multi-Display WebSocket System

Interaktive Installation: 10 Laptops zeigen synchron Texte, Bilder und Effekte,
gesteuert von einem Master-Computer im selben LAN.

## Architektur

```
  ┌──────────────┐      WebSocket       ┌────────────────┐
  │   Master UI  │ ──────────────────── │   Node.js      │
  │  /master     │                      │   Server       │
  └──────────────┘                      │   :3000        │
                                        └───────┬────────┘
                                                │ WebSocket
                    ┌───────────────────────────┼───────────────────┐
                    │         │         │        │       │           │
                 ┌──┴──┐  ┌──┴──┐  ┌──┴──┐  ┌──┴──┐ ┌──┴──┐  ┌──┴──┐
                 │ L1  │  │ L2  │  │ L3  │  │ L4  │ │ L5  │  │ ... │
                 └─────┘  └─────┘  └─────┘  └─────┘ └─────┘  └─────┘
                              10 Laptops → /client
```

## Setup

### 1. Voraussetzungen
- Node.js (v14+) auf dem Server-Rechner
- Alle Geräte im selben LAN/WLAN

### 2. Installation
```bash
cd laptop-installation
npm install
```

### 3. Server starten
```bash
npm start
```

### 4. IP-Adresse ermitteln
```bash
# Linux/Mac:
hostname -I
# oder
ip addr show | grep "inet "
```

### 5. Laptops verbinden
Auf jedem Laptop im Browser öffnen:
```
http://<SERVER-IP>:3000/
```
→ Klick auf "Vollbild" für Kiosk-Modus

### 6. Master öffnen
Auf dem Steuer-Computer:
```
http://<SERVER-IP>:3000/master
```

## Features

### Master Control Panel
- **Text senden** – mit Animationen (Fade, Schreibmaschine, Slide)
- **Bilder senden** – per URL
- **Hintergrundfarbe** – auf allen oder einzelnen Displays
- **Effekte** – Pulsieren, Glitch, Welle, Flash
- **Kaskade** – Text erscheint nacheinander auf jedem Display
- **Wörter verteilen** – ein Satz wird auf alle Displays aufgeteilt
- **Zielauswahl** – alle Displays oder einzelne ansprechen

### Keyboard Shortcuts (Master)
- `Ctrl+Enter` – Text senden
- `Escape` – Alle Displays leeren

### Client Features
- Auto-Reconnect bei Verbindungsabbruch
- Fullscreen-Modus
- Subtile Idle-Animation wenn leer
- Connection-Status-Indikator

## Tipps für die Installation

### Browser-Kiosk-Modus
Für einen cleanen Look ohne Browser-UI:

**Chromium/Chrome:**
```bash
chromium-browser --kiosk http://<IP>:3000/
```

**Firefox:**
```bash
firefox --kiosk http://<IP>:3000/
```

### Screensaver deaktivieren
```bash
# Linux:
xset s off
xset -dpms
xset s noblank
```

### Auto-Start beim Booten (Linux)
Erstelle `~/.config/autostart/installation.desktop`:
```ini
[Desktop Entry]
Type=Application
Name=Installation Display
Exec=chromium-browser --kiosk http://<SERVER-IP>:3000/
```

## Erweitern

Das Protokoll ist einfach erweiterbar. Neue Message-Types in `server.js`
hinzufügen und in `client.html` in `handleMessage()` behandeln.

Ideen:
- Video-Streams einbinden
- Audio-Synchronisation
- Resolume-Integration via OSC
- Interaktive Inputs (Kamera, Mikrofon)
- AI-generierte Inhalte live einspeisen
