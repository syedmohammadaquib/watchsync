# WatchSync realtime server

This Node.js service runs the Socket.IO room layer for WatchSync. Render should use the `server` directory as its root, run `npm install`, and start with `npm start`.

Required environment variables:

- `PORT`
- `CLIENT_ORIGIN`
- `DATABASE_URL` (reserved for the Neon persistence layer)
- `SESSION_SECRET` (reserved for signed sessions)
