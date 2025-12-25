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

/* ----------------------------
   SOLO BOT (no external API)
   ---------------------------- */

const BOT = { id: 0, name: 'BOT-NEON' };
let botActive = false;
let botIdleTimer = null;

function isRealClient(c) {
  return c && typeof c.id === 'number' && c.id > 0; // real users: 1,2,3...
}

function realClientCount() {
  return Array.from(clients.values()).filter(isRealClient).length;
}

function onlineWithBot() {
  // Bot first so it shows prominently in the "Active Nodes" list
  return [{ id: BOT.id, name: BOT.name }, ...getOnlineList()];
}

function botPresence(action) {
  // action: 'join' | 'leave'
  broadcast({
    type: 'presence',
    action,
    user: { id: BOT.id, name: BOT.name },
    online: action === 'leave' ? getOnlineList() : onlineWithBot(),
    ts: nowISO(),
  });
}

function botChat(body) {
  broadcast({
    type: 'chat',
    from: { id: BOT.id, name: BOT.name },
    body,
    ts: nowISO(),
  });
}

function stopBotIfNeeded() {
  if (botIdleTimer) {
    clearInterval(botIdleTimer);
    botIdleTimer = null;
  }
  if (botActive) {
    botActive = false;
    botPresence('leave');
  }
}

function startBotIfNeeded() {
  // Bot activates only when exactly one real user is online
  if (realClientCount() !== 1) return;
  if (botActive) return;

  botActive = true;
  botPresence('join');

  botChat("Signal acquired. You're solo. Type /help for commands, or send any message and I’ll respond.");

  // light idle prompt if user stays quiet
  botIdleTimer = setInterval(() => {
    if (!botActive) return;
    if (realClientCount() !== 1) {
      stopBotIfNeeded();
      return;
    }
    const prompts = [
      "Open a second tab to simulate another user joining.",
      "Try: /idea for a next feature suggestion.",
      "Try: /ping",
      "Want rooms next? (e.g., /join general)",
    ];
    botChat(prompts[Math.floor(Math.random() * prompts.length)]);
  }, 25000);
}

function botReply(text) {
  const t = String(text || '').trim();
  if (!t) return;

  // commands
  if (t === '/help') {
    botChat("Commands: /help, /ping, /about, /idea");
    return;
  }
  if (t === '/ping') {
    botChat("pong");
    return;
  }
  if (t === '/about') {
    botChat("I'm a lightweight in-memory bot (no external API). I activate only when you're the only real user online.");
    return;
  }
  if (t === '/idea') {
    botChat("Next upgrades: rooms + message history (Redis) + typing indicators + basic moderation/rate limiting.");
    return;
  }

  const lower = t.toLowerCase();

  if (lower.includes('deploy') || lower.includes('render')) {
    botChat("Deploy tip: ensure server listens on process.env.PORT and the client uses wss:// on https:// (your UI already does).");
    return;
  }
  if (lower.includes('bug') || lower.includes('error')) {
    botChat("Paste the exact error text + where it occurs and I’ll pinpoint the fix.");
    return;
  }
  if (lower.includes('hello') || lower.includes('hi')) {
    botChat("Hello. Your terminal UI is strong. Want me to help write a recruiter-grade README and resume bullet?");
    return;
  }
  if (t.endsWith('?')) {
    botChat("Good question. Give me one more detail (context or constraint) and I’ll answer precisely.");
    return;
  }

  // default: short reflective response
  const clip = t.length > 140 ? `${t.slice(0, 140)}…` : t;
  botChat(`Acknowledged: "${clip}" — do you want to iterate on UI, add rooms, or add persistence next?`);
}

/* ----------------------------
   WebSocket handling
   ---------------------------- */

wss.on('connection', (ws) => {
  const id = nextId++;
  const client = { id, name: `user-${id}` };
  clients.set(ws, client);

  // Welcome message + current roster
  const online = botActive ? onlineWithBot() : getOnlineList();
  send(ws, { type: 'welcome', you: client, online, ts: nowISO() });

  // Tell others someone joined
  broadcastExcept(ws, {
    type: 'presence',
    action: 'join',
    user: client,
    online: botActive ? onlineWithBot() : getOnlineList(),
    ts: nowISO(),
  });

  // Re-evaluate bot state after join
  stopBotIfNeeded();
  startBotIfNeeded();

  ws.on('message', (raw) => {
    const text = raw.toString();
    const msg = safeJsonParse(text);

    // Only accept JSON messages
    if (!msg || typeof msg !== 'object') return;

    // set_name
    if (msg.type === 'set_name') {
      const desired = String(msg.name || '').trim();
      const clean = desired.slice(0, 24) || `user-${client.id}`;
      client.name = clean;
      clients.set(ws, client);

      send(ws, { type: 'name_set', you: client, online: botActive ? onlineWithBot() : getOnlineList(), ts: nowISO() });
      broadcast({ type: 'presence', action: 'rename', user: client, online: botActive ? onlineWithBot() : getOnlineList(), ts: nowISO() });
      return;
    }

    // chat
    if (msg.type === 'chat') {
      const body = String(msg.body || '').trim();
      if (!body) return;

      broadcast({
        type: 'chat',
        from: { id: client.id, name: client.name },
        body: body.slice(0, 2000),
        ts: nowISO()
      });

      // If bot is active (solo mode), respond
      if (botActive && realClientCount() === 1) {
        botReply(body);
      }
      return;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);

    broadcast({
      type: 'presence',
      action: 'leave',
      user: client,
      online: botActive ? onlineWithBot() : getOnlineList(),
      ts: nowISO(),
    });

    // Re-evaluate bot state after leave
    stopBotIfNeeded();
    startBotIfNeeded();
  });

  ws.on('error', () => {
    // errors are followed by close; keep quiet to avoid noisy logs
  });
});

server.listen(PORT, () => {
  console.log(`WebSocket Terminal Chat listening on port ${PORT}`);
});
