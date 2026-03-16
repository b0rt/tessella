const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const AdmZip = require("adm-zip");

const PORT = 3000;
const UPLOADS_DIR = path.join(__dirname, "uploads");
const DATA_DIR = path.join(__dirname, "data");
const SCENES_FILE = path.join(DATA_DIR, "scenes.json");
const PRECOMPOSE_FILE = path.join(DATA_DIR, "precompose.json");

// --- Ensure directories exist ---
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// --- State ---
let clients = new Map(); // ws -> { id, name }
let clientIdCounter = 0;
let contentHistory = []; // All content sent so far
let uploadCounter = 0;

// --- Precompose state ---
let precomposeLayout = null; // Currently loaded layout
let precomposeActive = false; // Whether precompose is active

function loadPrecomposeLayout() {
  try {
    if (fs.existsSync(PRECOMPOSE_FILE)) {
      precomposeLayout = JSON.parse(fs.readFileSync(PRECOMPOSE_FILE, "utf-8"));
    }
  } catch (e) {
    console.error("Failed to load precompose layout:", e);
  }
}

function savePrecomposeLayout() {
  try {
    fs.writeFileSync(PRECOMPOSE_FILE, JSON.stringify(precomposeLayout, null, 2));
  } catch (e) {
    console.error("Failed to save precompose layout:", e);
  }
}

function getPrecomposeStatus() {
  return {
    type: "precompose-status",
    layout: precomposeLayout,
    active: precomposeActive
  };
}

function pushSlotContent(slot) {
  if (!slot.assignedClientId) return;
  const clientWs = findClientWs(slot.assignedClientId);
  if (!clientWs) return;

  // Set background color
  if (slot.bgColor && slot.bgColor !== "#0a0a0a") {
    const colorMsg = { type: "show-color", color: slot.bgColor, target: slot.assignedClientId, id: Date.now() };
    clientWs.send(JSON.stringify(colorMsg));
  }

  // Send display config
  if (slot.displayConfig) {
    const configMsg = {
      type: "config-display",
      target: slot.assignedClientId,
      position: { x: slot.displayConfig.x, y: slot.displayConfig.y, z: slot.displayConfig.z },
      rotation: slot.displayConfig.rotation
    };
    clientWs.send(JSON.stringify(configMsg));
  }

  // Push each content item
  for (const item of slot.content || []) {
    const resolved = { ...item, target: slot.assignedClientId };
    handlePilotMessage(resolved);
  }
}

function findClientWs(clientId) {
  for (const [ws, info] of clients) {
    if (info.id === clientId) return ws;
  }
  return null;
}

// Load precompose layout on startup
loadPrecomposeLayout();

// --- Serve static files ---
function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

// --- MIME types for static files ---
const mimeTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "video/ogg",
  ".mov": "video/quicktime",
  ".wasm": "application/wasm",
  ".tflite": "application/octet-stream",
  ".json": "application/json"
};

// --- Client HTTP Server (port 3000) ---
const clientServer = http.createServer((req, res) => {
  // Handle media upload (images and videos)
  if (req.method === "POST" && req.url === "/upload") {
    let body = "";
    req.on("data", chunk => {
      body += chunk.toString();
      // Limit upload size to 500MB for videos
      if (body.length > 500 * 1024 * 1024) {
        res.writeHead(413);
        res.end(JSON.stringify({ error: "File too large (max 500MB)" }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const mediaData = data.image || data.video;

        if (!mediaData) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "No media data provided" }));
          return;
        }

        // Detect media type from data URL
        const isVideo = mediaData.startsWith("data:video/");
        const base64Data = mediaData.replace(/^data:(image|video)\/[\w+]+;base64,/, "");

        let ext;
        if (isVideo) {
          ext = mediaData.match(/^data:video\/([\w+]+);/)?.[1] || "mp4";
          // Normalize some extensions
          if (ext === "quicktime") ext = "mov";
        } else {
          ext = mediaData.match(/^data:image\/(\w+);/)?.[1] || "png";
        }

        uploadCounter++;
        const prefix = isVideo ? "video" : "image";
        const filename = `${prefix}-${Date.now()}-${uploadCounter}.${ext}`;
        const filepath = path.join(UPLOADS_DIR, filename);

        fs.writeFile(filepath, base64Data, "base64", (err) => {
          if (err) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: "Failed to save file" }));
            return;
          }

          const url = `/uploads/${filename}`;
          console.log(`${isVideo ? "🎬" : "📸"} ${isVideo ? "Video" : "Image"} uploaded: ${filename}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ url, type: isVideo ? "video" : "image" }));
        });
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid request" }));
      }
    });
    return;
  }

  // --- Scenes REST API ---
  if (req.method === "GET" && req.url === "/api/scenes") {
    let scenes = [];
    try {
      if (fs.existsSync(SCENES_FILE)) {
        scenes = JSON.parse(fs.readFileSync(SCENES_FILE, "utf-8"));
      }
    } catch (e) {
      console.error("Failed to read scenes:", e);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(scenes));
    return;
  }

  if (req.method === "PUT" && req.url === "/api/scenes") {
    let body = "";
    req.on("data", chunk => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const scenes = JSON.parse(body);
        fs.writeFileSync(SCENES_FILE, JSON.stringify(scenes, null, 2));
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/scenes/capture") {
    // Snapshot current contentHistory into a new scene, mapping client IDs to slot indices
    const clientList = Array.from(clients.values());
    let bgColor = "#0a0a0a";
    const items = [];
    for (const entry of contentHistory) {
      const item = { ...entry };
      // Map client ID to slot index
      if (item.target !== "all") {
        const slotIndex = clientList.findIndex(c => c.id === item.target);
        item.target = slotIndex >= 0 ? slotIndex : 0;
      }
      // Remove server-generated id field
      delete item.id;
      // Remap type from show-* back to send-* for scene items
      if (item.type === "show-color") {
        // Extract background color into scene-level field instead of item
        bgColor = item.color;
        continue;
      }
      if (item.type === "show-text") item.type = "send-text";
      else if (item.type === "show-image") item.type = "send-image";
      else if (item.type === "show-tiled-image") item.type = "send-tiled-image";
      else if (item.type === "show-video") item.type = "send-video";
      else if (item.type === "show-eyeball") item.type = "send-eyeball";
      items.push(item);
    }

    const scene = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: `Szene ${new Date().toLocaleTimeString("de-DE")}`,
      items,
      bgColor,
      durationMs: 5000,
      transition: "fade"
    };

    // Append to existing scenes
    let scenes = [];
    try {
      if (fs.existsSync(SCENES_FILE)) {
        scenes = JSON.parse(fs.readFileSync(SCENES_FILE, "utf-8"));
      }
    } catch (e) {}
    scenes.push(scene);
    fs.writeFileSync(SCENES_FILE, JSON.stringify(scenes, null, 2));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(scene));
    return;
  }

  // --- Export scenes as zip bundle ---
  if (req.method === "GET" && req.url === "/api/scenes/export") {
    try {
      const zip = new AdmZip();

      // Read scenes
      let scenes = [];
      if (fs.existsSync(SCENES_FILE)) {
        const raw = fs.readFileSync(SCENES_FILE, "utf-8");
        scenes = JSON.parse(raw);
        zip.addFile("scenes.json", Buffer.from(raw, "utf-8"));
      } else {
        zip.addFile("scenes.json", Buffer.from("[]", "utf-8"));
      }

      // Collect referenced upload files from scene items
      const uploadFiles = new Set();
      for (const scene of scenes) {
        for (const item of scene.items || []) {
          if (item.url && item.url.startsWith("/uploads/")) {
            uploadFiles.add(item.url);
          }
        }
      }

      // Add each referenced file to zip
      for (const uploadUrl of uploadFiles) {
        const filePath = path.join(__dirname, uploadUrl);
        if (fs.existsSync(filePath)) {
          zip.addLocalFile(filePath, "uploads");
        }
      }

      const zipBuffer = zip.toBuffer();
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="tessella-scenes.zip"',
        "Content-Length": zipBuffer.length
      });
      res.end(zipBuffer);
    } catch (e) {
      console.error("Export failed:", e);
      res.writeHead(500);
      res.end(JSON.stringify({ error: "Export failed" }));
    }
    return;
  }

  // --- Import scenes from zip bundle ---
  if (req.method === "POST" && req.url === "/api/scenes/import") {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      try {
        const buffer = Buffer.concat(chunks);
        const zip = new AdmZip(buffer);

        // Extract scenes.json
        const scenesEntry = zip.getEntry("scenes.json");
        if (!scenesEntry) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "No scenes.json found in zip" }));
          return;
        }
        const importedScenes = JSON.parse(scenesEntry.getData().toString("utf-8"));

        // Extract media files to uploads/
        const entries = zip.getEntries();
        let mediaCount = 0;
        for (const entry of entries) {
          if (entry.entryName.startsWith("uploads/") && !entry.isDirectory) {
            const filename = path.basename(entry.entryName);
            const destPath = path.join(UPLOADS_DIR, filename);
            fs.writeFileSync(destPath, entry.getData());
            mediaCount++;
          }
        }

        // Write scenes file
        fs.writeFileSync(SCENES_FILE, JSON.stringify(importedScenes, null, 2));

        console.log(`📦 Imported ${importedScenes.length} scenes, ${mediaCount} media files`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, scenes: importedScenes.length, media: mediaCount }));
      } catch (e) {
        console.error("Import failed:", e);
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid zip file" }));
      }
    });
    return;
  }

  // --- Precompose REST API ---
  if (req.method === "GET" && req.url === "/api/precompose") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ layout: precomposeLayout, active: precomposeActive }));
    return;
  }

  if (req.method === "PUT" && req.url === "/api/precompose") {
    let body = "";
    req.on("data", chunk => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        precomposeLayout = data.layout;
        precomposeActive = !!data.active;
        savePrecomposeLayout();
        broadcastToPilots(getPrecomposeStatus());
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // Serve static files
  if (req.url === "/" || req.url === "/client") {
    serveFile(res, path.join(__dirname, "client.html"), "text/html");
  } else if (req.url === "/pilot") {
    // Serve Vue app
    serveFile(res, path.join(__dirname, "dist/pilot/index.html"), "text/html");
  } else if (req.url.startsWith("/pilot/") || req.url.startsWith("/assets/")) {
    // Serve Vue app assets
    const assetPath = req.url.startsWith("/pilot/")
      ? req.url.replace("/pilot/", "/")
      : req.url;
    const filePath = path.join(__dirname, "dist/pilot", assetPath);
    const ext = path.extname(req.url).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";
    serveFile(res, filePath, contentType);
  } else if (req.url.startsWith("/fonts/")) {
    const fontPath = path.join(__dirname, req.url);
    const ext = path.extname(req.url).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";
    serveFile(res, fontPath, contentType);
  } else if (req.url.startsWith("/lib/")) {
    const libPath = path.join(__dirname, req.url);
    const ext = path.extname(req.url).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";
    serveFile(res, libPath, contentType);
  } else if (req.url.startsWith("/uploads/")) {
    const filePath = path.join(__dirname, req.url);
    const ext = path.extname(req.url).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";
    serveFile(res, filePath, contentType);
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

// --- WebSocket Server ---
const wss = new WebSocketServer({ server: clientServer });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const role = url.searchParams.get("role") || "client";

  if (role === "pilot") {
    console.log("🎛️  Pilot connected");

    ws.isPilot = true;

    // Send current client list to pilot
    ws.send(JSON.stringify({
      type: "client-list",
      clients: Array.from(clients.values())
    }));

    // Send precompose status to pilot
    ws.send(JSON.stringify(getPrecomposeStatus()));

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data);
        handlePilotMessage(msg);
      } catch (e) {
        console.error("Invalid pilot message:", e);
      }
    });

    ws.on("close", () => {
      console.log("🎛️  Pilot disconnected");
    });
  } else {
    // Client
    clientIdCounter++;
    const clientInfo = {
      id: clientIdCounter,
      name: `Laptop ${clientIdCounter}`
    };
    clients.set(ws, clientInfo);

    console.log(`💻 Client ${clientInfo.name} connected (${clients.size} total)`);

    // Send client its identity
    ws.send(JSON.stringify({
      type: "identity",
      ...clientInfo,
      totalClients: clients.size
    }));

    // Send content history to new client
    const relevantHistory = contentHistory.filter(
      c => c.target === "all" || c.target === clientInfo.id
    );
    if (relevantHistory.length > 0) {
      ws.send(JSON.stringify({
        type: "content-history",
        items: relevantHistory
      }));
    }

    // Auto-assign to precompose slot if active
    if (precomposeActive && precomposeLayout && precomposeLayout.assignmentMode === "auto") {
      const slot = (precomposeLayout.slots || []).find(s => !s.assignedClientId);
      if (slot) {
        slot.assignedClientId = clientInfo.id;
        savePrecomposeLayout();
        console.log(`🔗 Auto-assigned ${clientInfo.name} to slot "${slot.name}"`);
        // Push slot content after a short delay for client to be ready
        setTimeout(() => pushSlotContent(slot), 500);
        broadcastToPilots(getPrecomposeStatus());
      }
    }

    // Notify pilot about new client
    broadcastToPilots({
      type: "client-list",
      clients: Array.from(clients.values())
    });

    ws.on("close", () => {
      // Unassign from precompose slot
      if (precomposeLayout) {
        const slot = (precomposeLayout.slots || []).find(s => s.assignedClientId === clientInfo.id);
        if (slot) {
          slot.assignedClientId = null;
          savePrecomposeLayout();
          console.log(`🔗 Unassigned slot "${slot.name}" (client disconnected)`);
          broadcastToPilots(getPrecomposeStatus());
        }
      }

      clients.delete(ws);
      console.log(`💻 Client disconnected (${clients.size} remaining)`);
      broadcastToPilots({
        type: "client-list",
        clients: Array.from(clients.values())
      });
    });

    ws.on("message", (data) => {
      // Clients can send heartbeats or status
      try {
        const msg = JSON.parse(data);
        if (msg.type === "set-name") {
          clientInfo.name = msg.name;
          clients.set(ws, clientInfo);
          broadcastToPilots({
            type: "client-list",
            clients: Array.from(clients.values())
          });
        }
      } catch (e) {}
    });
  }
});

function handlePilotMessage(msg) {
  // Remove eyeball from content history when new content replaces it
  const contentTypes = ["send-text", "send-image", "send-tiled-image", "send-video", "send-color", "cascade-text", "cascade-words", "clear"];
  if (contentTypes.includes(msg.type)) {
    contentHistory = contentHistory.filter(c => c.type !== "show-eyeball");
  }

  switch (msg.type) {
    case "send-text": {
      const content = {
        type: "show-text",
        text: msg.text,
        style: msg.style || "fade",
        target: msg.target || "all",
        id: Date.now(),
        fontSize: msg.fontSize || "2rem",
        color: msg.color || "#ffffff",
        position: msg.position || "center"
      };
      contentHistory.push(content);
      broadcastToClients(content);
      break;
    }

    case "send-image": {
      const content = {
        type: "show-image",
        url: msg.url,
        style: msg.style || "fade",
        target: msg.target || "all",
        id: Date.now(),
        fit: msg.fit || "contain",
        position: msg.position || "center"
      };
      contentHistory.push(content);
      broadcastToClients(content);
      break;
    }

    case "send-tiled-image": {
      // Distribute image tiles across clients
      const cols = msg.cols || 2;
      const rows = msg.rows || 1;
      const totalTiles = cols * rows;
      const clientList = Array.from(clients.entries());

      clientList.forEach(([ws, info], index) => {
        if (index >= totalTiles) {
          // More clients than tiles - clear extra clients
          ws.send(JSON.stringify({ type: "clear", target: info.id, style: "fade" }));
          return;
        }

        // Calculate tile position (left-to-right, top-to-bottom)
        const col = index % cols;
        const row = Math.floor(index / cols);

        const content = {
          type: "show-tiled-image",
          url: msg.url,
          style: msg.style || "fade",
          target: info.id,
          id: Date.now() + index,
          preserveAspect: msg.preserveAspect !== false,
          tile: {
            col: col,
            row: row,
            cols: cols,
            rows: rows
          }
        };
        contentHistory.push(content);
        ws.send(JSON.stringify(content));
      });

      console.log(`🖼️  Tiled image sent: ${cols}x${rows} grid to ${Math.min(clientList.length, totalTiles)} clients`);
      break;
    }

    case "send-color": {
      const content = {
        type: "show-color",
        color: msg.color,
        target: msg.target || "all",
        id: Date.now()
      };
      contentHistory.push(content);
      broadcastToClients(content);
      break;
    }

    case "cascade-text": {
      // Send text to clients one by one with delay
      const clientList = Array.from(clients.entries());
      const delay = msg.delay || 500;

      clientList.forEach(([ws, info], index) => {
        setTimeout(() => {
          const content = {
            type: "show-text",
            text: msg.text,
            style: msg.style || "typewriter",
            target: info.id,
            id: Date.now() + index,
            fontSize: msg.fontSize || "2rem",
            color: msg.color || "#ffffff",
            position: msg.position || "center"
          };
          contentHistory.push(content);
          ws.send(JSON.stringify(content));
        }, index * delay);
      });
      break;
    }

    case "cascade-words": {
      // Split text into words and distribute across clients
      const words = msg.text.split(/\s+/);
      const clientList = Array.from(clients.entries());
      const delay = msg.delay || 300;
      let wordIndex = 0;

      clientList.forEach(([ws, info], clientIdx) => {
        // Each client gets some words
        const wordsPerClient = Math.ceil(words.length / clientList.length);
        const clientWords = words.slice(
          clientIdx * wordsPerClient,
          (clientIdx + 1) * wordsPerClient
        ).join(" ");

        setTimeout(() => {
          const content = {
            type: "show-text",
            text: clientWords,
            style: "typewriter",
            target: info.id,
            id: Date.now() + clientIdx,
            fontSize: msg.fontSize || "3rem",
            color: msg.color || "#ffffff",
            position: "center"
          };
          contentHistory.push(content);
          ws.send(JSON.stringify(content));
        }, clientIdx * delay);
      });
      break;
    }

    case "clear": {
      const content = {
        type: "clear",
        target: msg.target || "all",
        style: msg.style || "fade"
      };
      if (msg.target === "all") {
        contentHistory = [];
      } else {
        contentHistory = contentHistory.filter(c => c.target !== msg.target);
      }
      broadcastToClients(content);
      break;
    }

    case "effect": {
      const content = {
        type: "effect",
        effect: msg.effect, // "pulse", "glitch", "wave", "flash"
        target: msg.target || "all",
        duration: msg.duration || 2000
      };
      broadcastToClients(content);
      break;
    }

    case "send-video": {
      const content = {
        type: "show-video",
        url: msg.url,
        style: msg.style || "fade",
        target: msg.target || "all",
        id: Date.now(),
        fit: msg.fit || "contain",
        loop: msg.loop !== false,
        muted: msg.muted !== false,
        autoplay: msg.autoplay !== false,
        position: msg.position || "center"
      };
      contentHistory.push(content);
      broadcastToClients(content);
      console.log(`🎬 Video sent to ${msg.target || "all"}: ${msg.url}`);
      break;
    }

    case "video-control": {
      const content = {
        type: "video-control",
        action: msg.action, // "play", "pause", "stop", "mute", "unmute", "seek", "sync"
        target: msg.target || "all",
        time: msg.time,
        playing: msg.playing
      };
      broadcastToClients(content);
      break;
    }

    case "send-eyeball":
    case "show-eyeball": {
      const content = {
        type: "show-eyeball",
        target: msg.target || "all",
        irisColor: msg.irisColor,
        bgColor: msg.bgColor,
        id: Date.now()
      };
      contentHistory.push(content);
      broadcastToClients(content);
      console.log(`👁️  Eyeball activated on ${msg.target || "all"}`);
      break;
    }

    case "hide-eyeball": {
      const content = {
        type: "hide-eyeball",
        target: msg.target || "all"
      };
      // Remove eyeball entries from content history
      contentHistory = contentHistory.filter(c => c.type !== "show-eyeball");
      broadcastToClients(content);
      console.log(`👁️  Eyeball hidden on ${msg.target || "all"}`);
      break;
    }

    case "eyeball-gaze": {
      // Broadcast face position to all clients for gaze calculation
      const content = {
        type: "eyeball-gaze",
        target: msg.target || "all",
        x: msg.x,
        y: msg.y,
        z: msg.z
      };
      broadcastToClients(content);
      break;
    }

    case "config-display": {
      // Configure a specific display's position in the room
      const content = {
        type: "config-display",
        target: msg.target,
        position: msg.position,
        rotation: msg.rotation
      };
      broadcastToClients(content);
      console.log(`📍 Display ${msg.target} configured: pos(${msg.position?.x}, ${msg.position?.y}, ${msg.position?.z}) rot(${msg.rotation}°)`);
      break;
    }

    case "precompose-assign": {
      // Manually assign a client to a slot
      if (precomposeLayout) {
        const slot = (precomposeLayout.slots || []).find(s => s.id === msg.slotId);
        if (slot) {
          slot.assignedClientId = msg.clientId;
          savePrecomposeLayout();
          if (msg.clientId) {
            pushSlotContent(slot);
          }
          broadcastToPilots(getPrecomposeStatus());
        }
      }
      break;
    }

    case "precompose-unassign": {
      if (precomposeLayout) {
        const slot = (precomposeLayout.slots || []).find(s => s.id === msg.slotId);
        if (slot) {
          // Clear the client display before unassigning
          if (slot.assignedClientId) {
            handlePilotMessage({ type: "clear", target: slot.assignedClientId, style: "fade" });
          }
          slot.assignedClientId = null;
          savePrecomposeLayout();
          broadcastToPilots(getPrecomposeStatus());
        }
      }
      break;
    }

    case "precompose-push": {
      // Push a single slot's content to its assigned client
      if (precomposeLayout) {
        const slot = (precomposeLayout.slots || []).find(s => s.id === msg.slotId);
        if (slot && slot.assignedClientId) {
          // Clear first, then push
          handlePilotMessage({ type: "clear", target: slot.assignedClientId, style: "fade" });
          setTimeout(() => pushSlotContent(slot), 300);
        }
      }
      break;
    }

    case "precompose-push-all": {
      // Push all slots' content
      if (precomposeLayout) {
        for (const slot of precomposeLayout.slots || []) {
          if (slot.assignedClientId) {
            handlePilotMessage({ type: "clear", target: slot.assignedClientId, style: "fade" });
          }
        }
        setTimeout(() => {
          for (const slot of precomposeLayout.slots || []) {
            if (slot.assignedClientId) {
              pushSlotContent(slot);
            }
          }
        }, 300);
      }
      break;
    }

    case "precompose-activate": {
      precomposeActive = true;
      if (precomposeLayout && precomposeLayout.assignmentMode === "auto") {
        // Auto-assign currently connected clients to unassigned slots
        const clientList = Array.from(clients.values());
        const assignedIds = new Set((precomposeLayout.slots || []).filter(s => s.assignedClientId).map(s => s.assignedClientId));
        const unassignedClients = clientList.filter(c => !assignedIds.has(c.id));
        let ci = 0;
        for (const slot of precomposeLayout.slots || []) {
          if (!slot.assignedClientId && ci < unassignedClients.length) {
            slot.assignedClientId = unassignedClients[ci].id;
            ci++;
          }
        }
        savePrecomposeLayout();
        // Push content to all assigned slots
        setTimeout(() => {
          for (const slot of precomposeLayout.slots || []) {
            if (slot.assignedClientId) {
              pushSlotContent(slot);
            }
          }
        }, 300);
      }
      broadcastToPilots(getPrecomposeStatus());
      console.log("🔗 Precompose layout activated");
      break;
    }

    case "precompose-deactivate": {
      precomposeActive = false;
      // Clear assignments
      if (precomposeLayout) {
        for (const slot of precomposeLayout.slots || []) {
          if (slot.assignedClientId) {
            handlePilotMessage({ type: "clear", target: slot.assignedClientId, style: "fade" });
          }
          slot.assignedClientId = null;
        }
        savePrecomposeLayout();
      }
      broadcastToPilots(getPrecomposeStatus());
      console.log("🔗 Precompose layout deactivated");
      break;
    }

    case "play-scene": {
      // Play a scene: clear all displays, then replay each scene item
      const sceneItems = msg.items || [];
      const transition = msg.transition || "fade";
      const sceneBgColor = msg.bgColor || "#0a0a0a";
      const clientList = Array.from(clients.values());

      // Clear all displays first
      handlePilotMessage({ type: "clear", target: "all", style: transition });

      // Set background color immediately (before content delay) so it
      // doesn't get overwritten by the clear timer on the client
      handlePilotMessage({ type: "send-color", color: sceneBgColor, target: "all" });

      // Play each item after a short delay for the clear animation
      setTimeout(() => {
        sceneItems.forEach(item => {
          // Skip send-color items — background is handled above via bgColor
          if (item.type === "send-color") return;
          // Resolve slot index to current client ID
          const resolved = { ...item };
          if (resolved.target !== "all" && typeof resolved.target === "number") {
            const client = clientList[resolved.target];
            resolved.target = client ? client.id : "all";
          }
          handlePilotMessage(resolved);
        });
        console.log(`🎬 Scene played: ${sceneItems.length} items`);
      }, 300);
      break;
    }
  }
}

function broadcastToClients(content) {
  for (const [ws, info] of clients) {
    if (content.target === "all" || content.target === info.id) {
      ws.send(JSON.stringify(content));
    }
  }
}

function broadcastToPilots(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((ws) => {
    if (ws.isPilot && ws.readyState === 1) {
      ws.send(data);
    }
  });
}

clientServer.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║             🖥️  TESSELLA SERVER 🖥️               ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║  Client URL:  http://<YOUR-IP>:${PORT}/          ║
║  Pilot URL:   http://<YOUR-IP>:${PORT}/pilot     ║
║                                                  ║
║  Open /pilot on your control computer            ║
║  Open / on all display screens                   ║
║                                                  ║
╚══════════════════════════════════════════════════╝
  `);
});
