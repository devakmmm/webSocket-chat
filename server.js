'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

const app = express();

// Serve the frontend
app.use(express.static(path.join(__dirname, 'public')));

// Health endpoint for platforms like Render
app.get('/health', (_req, res) => res.status(200).send('ok'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/**
 * In-memory state (fine for a portfolio project)
 * - clients: Map<WebSocket, {id, name}>
 */
const clients = new Map();
let nextId = 1;

function nowISO() {
  return new Date().toISOString();
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function broadcastExcept(sender, obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients.keys()) {
    if (ws === sender) continue;
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function getOnlineList() {
  return Array.from(clients.values()).map(c => ({ id: c.id, name: c.name }));
}

wss.on('connection', (ws) => {
  const id = nextId++;
  const client = { id, name: `user-${id}` };
  clients.set(ws, client);

  // Welcome message + current roster
  send(ws, { type: 'welcome', you: client, online: getOnlineList(), ts: nowISO() });

  // Tell others someone joined
  broadcastExcept(ws, { type: 'presence', action: 'join', user: client, online: getOnlineList(), ts: nowISO() });

  ws.on('message', (raw) => {
    const text = raw.toString();
    const msg = safeJsonParse(text);

    // Guard: only accept JSON messages
    if (!msg || typeof msg !== 'object') return;

    // Handle set_name
    if (msg.type === 'set_name') {
      const desired = String(msg.name || '').trim();
      const clean = desired.slice(0, 24) || `user-${client.id}`;
      client.name = clean;

      // Update mapping
      clients.set(ws, client);

      // Acknowledge and broadcast updated roster
      send(ws, { type: 'name_set', you: client, online: getOnlineList(), ts: nowISO() });
      broadcast({ type: 'presence', action: 'rename', user: client, online: getOnlineList(), ts: nowISO() });
      return;
    }

    // Handle chat message
    if (msg.type === 'chat') {
      const body = String(msg.body || '').trim();
      if (!body) return;

      const payload = {
        type: 'chat',
        from: { id: client.id, name: client.name },
        body: body.slice(0, 2000),
        ts: nowISO()
      };
      broadcast(payload);
      return;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcast({ type: 'presence', action: 'leave', user: client, online: getOnlineList(), ts: nowISO() });
  });

  ws.on('error', () => {
    // errors are followed by close; keep quiet to avoid noisy logs
  });
});

server.listen(PORT, () => {
  console.log(`WebSocket Chat listening on port ${PORT}`);
});
