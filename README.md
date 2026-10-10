<div align="center">

<img src="public/logo.png" alt="WatchSync logo" width="96" />

# WatchSync

Watch YouTube together, in sync.

</div>

WatchSync is a real-time watch-party app. Create a room, share its code or link, and watch YouTube videos together with synchronized playback, chat, and participant roles.

> **Live app:** [https://watchsync-blue.vercel.app/](https://watchsync-blue.vercel.app/)

## Screenshots

![WatchSync home page](docs/screenshots/home_page.png)
![WatchSync watch room](docs/screenshots/room_page.png)

## Features

- Create a room or join with a room code/link.
- Synchronize YouTube video changes, play/pause, and seeking.
- Host, Moderator, and Participant roles; the server enforces playback permissions.
- Hosts can promote/demote participants, remove participants, or transfer the host role.
- Participants can request playback or video changes for Host/Moderator approval.
- Room chat, reactions, and a shared video queue.
- Room state, membership, roles, chat, and queue persist in PostgreSQL.

## Tech stack

- **Frontend:** Next.js, React, Tailwind CSS
- **Realtime server:** Node.js, Express, Socket.IO
- **Video:** YouTube IFrame Player API
- **Database:** PostgreSQL
- **Deployment:** Vercel (frontend), Render (realtime server), Neon (PostgreSQL)

## Run locally

Requirements: Node.js, npm, and a PostgreSQL database.

1. Create `.env.local` in the project root and add:

   ```env
   NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
   ```

2. Configure the realtime server in `server/.env`:

   ```env
   DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
   CLIENT_ORIGIN=http://localhost:3000
   PORT=4000
   NODE_ENV=development
   ```

3. In the project root, install and start the frontend:

   ```bash
   npm install
   npm run dev
   ```

4. In another terminal, install and start the realtime server:

   ```bash
   cd server
   npm install
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). The server initializes its PostgreSQL tables on startup.

## Architecture

The Next.js client embeds the YouTube IFrame Player and connects to the separate Socket.IO server. The server authenticates clients using an HttpOnly session cookie, checks room membership and role permissions, persists accepted changes to PostgreSQL, then broadcasts updated playback and room state to the room. Participants’ control requests are sent to the Host/Moderators for approval before being applied.

## Deployment

- Deploy the frontend to Vercel and the `server` folder to Render.
- In Vercel, set `NEXT_PUBLIC_SOCKET_URL` to your Render server URL.
- In Render, set `DATABASE_URL` to your PostgreSQL connection string and `CLIENT_ORIGIN` to your Vercel site URL. Set `NODE_ENV` to `production`.
- Check `https://your-render-server/health` to confirm the server is running. Keep database credentials in Render, not in frontend variables.

The current realtime room coordination uses in-memory state on a single server instance, while room data is persisted in PostgreSQL. Multi-instance realtime scaling would require a shared Socket.IO adapter such as Redis.

## Code walkthrough

- **Socket.IO:** sends user actions to the server and distributes synchronized updates to room members.
- **Server-side roles:** the server authorizes playback, moderation, removal, and host transfer; the UI reflects those permissions.
- **Persistence:** PostgreSQL stores room state and membership. Session tokens are opaque, stored as hashes, and sent in an HttpOnly cookie.
- **Deployment trade-off:** a free Render instance can take time to wake after inactivity.