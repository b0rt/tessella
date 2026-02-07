# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WV Data Displays is a WebSocket-based multi-display installation system for controlling multiple laptop screens from a single master control panel. Designed for LAN-based operation without internet dependency.

## Commands

```bash
# Install dependencies
npm install

# Start server (port 3000)
npm start
```

**Access URLs:**
- Client displays: `http://<IP>:3000/`
- Master control: `http://<IP>:3000/master`

## Architecture

```
Master Control Panel (browser)
         ↓ WebSocket
   Node.js HTTP Server (port 3000)
         ↓ WebSocket
   Client Displays (browsers)
```

**Files:**
- `server.js` - HTTP + WebSocket server, handles client registration, message routing, content history, and static file serving
- `client.html` - Display interface with animations, effects, auto-reconnect, and idle breathing animation
- `master.html` - Control panel with client list, content controls, and activity logging
- `scripts/copy-fonts.js` - Postinstall script that copies fonts from node_modules to `/fonts`

## Communication Protocol

JSON messages over WebSocket with structure:
```javascript
{
  type: 'send-text' | 'send-image' | 'send-color' | 'cascade-text' | 'cascade-words' | 'clear' | 'effect',
  target: 'all' | <client-id>,
  // ... type-specific payload fields
}
```

**Key server functions:**
- `handleMasterMessage()` - Routes master commands to clients
- Client state tracked with auto-incrementing IDs ("Laptop N" naming)
- Content history replicated to newly connected clients

## Styling Conventions

- Dark theme with accent color `#c8f540` (lime green)
- CSS variables for theming in both HTML files
- Animation classes: `anim-fade-in`, `anim-slide-up`, `effect-glitch`, `effect-pulse`, `effect-wave`
- Position classes: `pos-top`, `pos-bottom`, `pos-left`, `pos-right`

## Extending

1. Add new message type to `server.js` in `handleMasterMessage()` switch statement
2. Add corresponding handler in `client.html` `handleMessage()` function
3. Add UI controls in `master.html` if needed

## Notes

- UI text is in German
- No build step, linting, or testing configured
- No authentication (LAN-only design)
- Client auto-reconnects on disconnect (2s interval)
- Fonts are local (no internet required) - installed via fontsource packages and copied to `/fonts` during `npm install`
