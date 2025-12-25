# WebSocket Terminal Chat

A portfolio-ready real-time chat app:
- Node.js + Express serves a static terminal-style frontend
- WebSocket (ws) provides real-time messaging + presence (join/leave/rename)
- In-memory state (no database) for simplicity

## Local run
```bash
npm install
npm start
```
Open: http://localhost:3000  
Tip: open two tabs to test multi-user.

## Deploy (Render)
1. Push this repo to GitHub.
2. Render: New → Web Service → connect repo
3. Build Command: `npm install`
4. Start Command: `npm start`
Render sets `PORT` automatically (server reads it).

## Notes
- No persistence or auth (intended). If you want persistence, add Redis/DB.
