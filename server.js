const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = 3000;
const UPLOADS_DIR = path.join(__dirname, "uploads");

// --- Ensure uploads directory exists ---
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// --- State ---
let clients = new Map(); // ws -> { id, name }
let clientIdCounter = 0;
let contentHistory = []; // All content sent so far
let uploadCounter = 0;

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
  ".svg": "image/svg+xml"
};

// --- Client HTTP Server (port 3000) ---
const clientServer = http.createServer((req, res) => {
  // Handle image upload
  if (req.method === "POST" && req.url === "/upload") {
    let body = "";
    req.on("data", chunk => {
      body += chunk.toString();
      // Limit upload size to 50MB
      if (body.length > 50 * 1024 * 1024) {
        res.writeHead(413);
        res.end(JSON.stringify({ error: "File too large" }));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const base64Data = data.image.replace(/^data:image\/\w+;base64,/, "");
        const ext = data.image.match(/^data:image\/(\w+);/)?.[1] || "png";

        uploadCounter++;
        const filename = `image-${Date.now()}-${uploadCounter}.${ext}`;
        const filepath = path.join(UPLOADS_DIR, filename);

        fs.writeFile(filepath, base64Data, "base64", (err) => {
          if (err) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: "Failed to save image" }));
            return;
          }

          const imageUrl = `/uploads/${filename}`;
          console.log(`📸 Image uploaded: ${filename}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ url: imageUrl }));
        });
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid request" }));
      }
    });
    return;
  }

  // Serve static files
  if (req.url === "/" || req.url === "/client") {
    serveFile(res, path.join(__dirname, "client.html"), "text/html");
  } else if (req.url === "/master") {
    serveFile(res, path.join(__dirname, "master.html"), "text/html");
  } else if (req.url.startsWith("/fonts/")) {
    const fontPath = path.join(__dirname, req.url);
    const ext = path.extname(req.url).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";
    serveFile(res, fontPath, contentType);
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

  if (role === "master") {
    console.log("🎛️  Master connected");

    ws.isMaster = true;

    // Send current client list to master
    ws.send(JSON.stringify({
      type: "client-list",
      clients: Array.from(clients.values())
    }));

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data);
        handleMasterMessage(msg);
      } catch (e) {
        console.error("Invalid master message:", e);
      }
    });

    ws.on("close", () => {
      console.log("🎛️  Master disconnected");
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

    // Notify master about new client
    broadcastToMasters({
      type: "client-list",
      clients: Array.from(clients.values())
    });

    ws.on("close", () => {
      clients.delete(ws);
      console.log(`💻 Client disconnected (${clients.size} remaining)`);
      broadcastToMasters({
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
          broadcastToMasters({
            type: "client-list",
            clients: Array.from(clients.values())
          });
        }
      } catch (e) {}
    });
  }
});

function handleMasterMessage(msg) {
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
  }
}

function broadcastToClients(content) {
  for (const [ws, info] of clients) {
    if (content.target === "all" || content.target === info.id) {
      ws.send(JSON.stringify(content));
    }
  }
}

function broadcastToMasters(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((ws) => {
    if (ws.isMaster && ws.readyState === 1) {
      ws.send(data);
    }
  });
}

clientServer.listen(PORT, "0.0.0.0", () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║        🖥️  LAPTOP INSTALLATION SERVER 🖥️         ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║  Client URL:  http://<YOUR-IP>:${PORT}/          ║
║  Master URL:  http://<YOUR-IP>:${PORT}/master    ║
║                                                  ║
║  Open /master on your control computer           ║
║  Open / on all 10 laptops                        ║
║                                                  ║
╚══════════════════════════════════════════════════╝
  `);
});
