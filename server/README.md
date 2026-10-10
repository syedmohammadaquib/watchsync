# WatchSync realtime server

This Node.js service runs the Socket.IO room layer for WatchSync. Render should use the `server` directory as its root, run `npm install`, and start with `npm start`.

Server environment variables:

- `DATABASE_URL` (required; used by the realtime server to persist watch rooms)
- `CLIENT_ORIGIN` (the Vercel frontend origin allowed by CORS; defaults to `http://localhost:3000` locally;
  multiple origins can be comma-separated)
- `PORT` (provided by Render in production; defaults to `4000` locally)
- `NODE_ENV=production` (required in production so the `watchsync_active_session` cookie is Secure and
  cross-site compatible)

The frontend first calls `POST /session` with a room code and display name. The server creates or restores
the room membership and sets one HttpOnly, opaque `watchsync_active_session` cookie. Only a SHA-256 hash
of that token is stored in PostgreSQL. Socket.IO accepts the connection only after validating that cookie,
then resolves the requested room membership server-side; client payloads cannot select a role or display name.

Room state is persisted before realtime events are broadcast. A host disconnect starts a 45-second recovery
window. Reconnecting with the same cookie restores the host membership; if the host does not return, the
room is ended. A room is not ended merely because guests leave, and a periodic cleanup removes stale rooms.

The deployed server exposes `GET /health` for Render health checks. Its public Render URL is used by the
frontend as `NEXT_PUBLIC_SOCKET_URL`; set it in Vercel and redeploy the frontend after changing it. This is a
public frontend setting. Keep database credentials and other secrets out of `NEXT_PUBLIC_*` variables.

Deployment values:

```env
# Render
PORT=4000
CLIENT_ORIGIN=https://your-frontend.vercel.app

# Vercel
NEXT_PUBLIC_SOCKET_URL=https://your-service.onrender.com
```

Render may override `PORT` with its assigned port; leave the fallback at `4000` for local development.
Both Express HTTP requests and Socket.IO connections use the same CORS allowlist from `CLIENT_ORIGIN`.
