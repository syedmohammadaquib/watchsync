import "dotenv/config";
import cors from "cors";
import express from "express";
import http from "node:http";
import { Server } from "socket.io";
import { createPersistentRoom, endPersistentRoom, initializeDatabase, isActiveRoom } from "./db.js";

const port = Number(process.env.PORT || 4000);
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const rooms = new Map();
const emptyRoomTimers = new Map();
const EMPTY_ROOM_GRACE_MS = 15000;

const app = express();
app.use(cors({ origin: clientOrigin }));
app.get("/health", (_request, response) => response.json({ status: "ok", service: "watchsync-realtime" }));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: clientOrigin, methods: ["GET", "POST"] },
});

function createRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            participants: new Map(),
            rolesBySession: new Map(),
            messages: [],
            hostSessionId: null,
            state: { videoId: null, playState: "paused", currentTime: 0, updatedAt: Date.now() },
        });
    }
    return rooms.get(roomId);
}

function publicRoom(room) {
    const currentTime = room.state.playState === "playing"
        ? room.state.currentTime + (Date.now() - room.state.updatedAt) / 1000
        : room.state.currentTime;
    return { ...room.state, currentTime, participants: [...room.participants.values()], chat: room.messages };
}

function canControlPlayback(participant) {
    return participant?.role === "HOST" || participant?.role === "MODERATOR";
}

function clearEmptyRoomTimer(roomId) {
    clearTimeout(emptyRoomTimers.get(roomId));
    emptyRoomTimers.delete(roomId);
}

function scheduleEmptyRoomCleanup(roomId) {
    if (emptyRoomTimers.has(roomId)) return;
    emptyRoomTimers.set(roomId, setTimeout(() => {
        emptyRoomTimers.delete(roomId);
        const room = rooms.get(roomId);
        if (room && room.participants.size === 0) endRoom(roomId, "ROOM_EMPTY");
    }, EMPTY_ROOM_GRACE_MS));
}

async function endRoom(roomId, reason) {
    const room = rooms.get(roomId);
    if (!room) return;

    clearEmptyRoomTimer(roomId);
    await endPersistentRoom(roomId);
    io.to(roomId).emit("room_ended", { reason });
    rooms.delete(roomId);

    for (const socketId of room.participants.keys()) {
        const participantSocket = io.sockets.sockets.get(socketId);
        participantSocket?.leave(roomId);
        participantSocket?.disconnect(true);
    }
}

io.on("connection", (socket) => {
    socket.on("check_room", async ({ roomId }) => {
        try {
            if (await isActiveRoom(roomId)) {
                socket.emit("room_available");
            } else {
                socket.emit("room_not_found", { code: "ROOM_NOT_FOUND", message: "That watch room does not exist." });
            }
        } catch (error) {
            console.error("Unable to check room", error);
            socket.emit("error", { code: "ROOM_CHECK_FAILED", message: "The room could not be checked." });
        }
    });

    socket.on("create_room", async ({ roomId, sessionId }) => {
        try {
            if (!roomId) {
                socket.emit("error", { code: "INVALID_ROOM", message: "A room code is required." });
                return;
            }
            const room = rooms.get(roomId) || createRoom(roomId);
            clearEmptyRoomTimer(roomId);
            if (room.hostSessionId && room.hostSessionId !== sessionId) {
                socket.emit("error", { code: "FORBIDDEN", message: "This room already has a host." });
                return;
            }
            await createPersistentRoom(roomId);
            room.hostSessionId = sessionId || room.hostSessionId;
            socket.data.createdRoomId = roomId;
            socket.data.hostSessionId = sessionId;
            socket.emit("room_available", { mode: "create" });
        } catch (error) {
            console.error("Unable to create room", error);
            socket.emit("error", { code: "ROOM_CREATE_FAILED", message: "The room could not be created." });
        }
    });

    socket.on("join_room", async ({ roomId, username, mode, sessionId }) => {
        try {
            if (!roomId || !username) {
                socket.emit("error", { code: "INVALID_JOIN", message: "Room details are required." });
                return;
            }
            if (mode === "create" && socket.data.createdRoomId !== roomId) {
                const room = rooms.get(roomId);
                if (!room || room.hostSessionId !== sessionId) {
                    socket.emit("error", { code: "FORBIDDEN", message: "Create the room from the home page first." });
                    return;
                }
            }
            if (!(await isActiveRoom(roomId))) {
                socket.emit("room_not_found", { code: "ROOM_NOT_FOUND", message: "That watch room does not exist." });
                return;
            }
            const room = rooms.get(roomId) || createRoom(roomId);
            const role = mode === "create" && room.hostSessionId === sessionId
                ? "HOST"
                : room.rolesBySession.get(sessionId) || "PARTICIPANT";
            const participant = { userId: socket.id, username: String(username).trim().slice(0, 32), role };
            socket.join(roomId);
            socket.data.roomId = roomId;
            socket.data.hostSessionId = sessionId;
            socket.data.role = role;
            socket.data.sessionId = sessionId;
            clearEmptyRoomTimer(roomId);
            if (sessionId) room.rolesBySession.set(sessionId, role);
            room.participants.set(socket.id, participant);
            socket.emit("sync_state", { ...publicRoom(room), selfRole: role, selfUserId: socket.id });
            io.to(roomId).emit("user_joined", { participants: [...room.participants.values()] });
        } catch (error) {
            console.error("Unable to join room", error);
            socket.emit("error", { code: "ROOM_JOIN_FAILED", message: "The room could not be joined." });
        }
    });

    socket.on("send_message", ({ text } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const participant = room?.participants.get(socket.id);
        const cleanText = typeof text === "string" ? text.trim().slice(0, 500) : "";
        if (!room || !participant || !cleanText) return;

        const chatMessage = {
            id: `${socket.id}-${Date.now()}`,
            name: participant.username,
            text: cleanText,
            sentAt: Date.now(),
        };
        room.messages.push(chatMessage);
        if (room.messages.length > 100) room.messages.shift();
        io.to(roomId).emit("new_message", chatMessage);
    });

    socket.on("set_video", ({ videoId } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const participant = room?.participants.get(socket.id);
        if (!room || !canControlPlayback(participant) || typeof videoId !== "string" || !/^[\w-]{11}$/.test(videoId)) return;
        room.state.videoId = videoId;
        room.state.updatedAt = Date.now();
        io.to(roomId).emit("video_updated", { videoId });
    });

    socket.on("playback_action", ({ action, currentTime } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const participant = room?.participants.get(socket.id);
        const validActions = ["play", "pause", "seek"];
        const nextTime = Number(currentTime);
        if (!room || !canControlPlayback(participant) || !validActions.includes(action) || !Number.isFinite(nextTime) || nextTime < 0) return;
        room.state.playState = action === "seek" ? room.state.playState : action === "play" ? "playing" : "paused";
        room.state.currentTime = nextTime;
        room.state.updatedAt = Date.now();
        socket.broadcast.to(roomId).emit("playback_updated", {
            action,
            currentTime: nextTime,
            updatedAt: room.state.updatedAt,
        });
    });

    socket.on("assign_role", ({ userId, role } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const actor = room?.participants.get(socket.id);
        const target = room?.participants.get(userId);
        if (!room || actor?.role !== "HOST" || !target || target.role === "HOST" || !["PARTICIPANT", "MODERATOR"].includes(role)) return;

        target.role = role;
        const targetSocket = io.sockets.sockets.get(userId);
        if (targetSocket) targetSocket.data.role = role;
        if (targetSocket?.data.sessionId) room.rolesBySession.set(targetSocket.data.sessionId, role);
        io.to(roomId).emit("role_assigned", {
            userId: target.userId,
            username: target.username,
            role: target.role,
            participants: [...room.participants.values()],
        });
    });

    socket.on("remove_participant", ({ userId } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const actor = room?.participants.get(socket.id);
        const target = room?.participants.get(userId);
        if (!room || actor?.role !== "HOST" || !target || target.role === "HOST") return;

        room.participants.delete(userId);
        const targetSocket = io.sockets.sockets.get(userId);
        if (targetSocket?.data.sessionId) room.rolesBySession.delete(targetSocket.data.sessionId);
        targetSocket?.emit("participant_removed", { userId, reason: "REMOVED_BY_HOST" });
        targetSocket?.leave(roomId);
        targetSocket?.disconnect(true);
        io.to(roomId).emit("user_left", { participants: [...room.participants.values()] });
    });

    socket.on("send_reaction", ({ emoji } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const participant = room?.participants.get(socket.id);
        if (!room || !participant || !room.state.videoId || typeof emoji !== "string" || !["❤️", "😂", "👏", "🔥", "😮"].includes(emoji)) return;
        io.to(roomId).emit("room_reaction", { id: `${socket.id}-${Date.now()}`, emoji, name: participant.username });
    });

    socket.on("leave_room", () => {
        const roomId = socket.data.roomId;
        if (!roomId) return;
        const room = rooms.get(roomId);
        const participant = room?.participants.get(socket.id);
        if (participant?.role === "HOST") {
            endRoom(roomId, "HOST_LEFT");
            return;
        }
        room?.participants.delete(socket.id);
        socket.leave(roomId);
        if (room) {
            io.to(roomId).emit("user_left", { participants: [...room.participants.values()] });
            if (room.participants.size === 0) scheduleEmptyRoomCleanup(roomId);
        }
    });

    socket.on("end_room", () => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const participant = room?.participants.get(socket.id);
        if (participant?.role !== "HOST") {
            socket.emit("error", { code: "FORBIDDEN", message: "Only the Host can end the room." });
            return;
        }
        endRoom(roomId, "HOST_ENDED");
    });

    socket.on("disconnect", () => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        if (!room) return;
        const participant = room.participants.get(socket.id);
        if (participant?.role === "HOST") {
            room.participants.delete(socket.id);
            scheduleEmptyRoomCleanup(roomId);
            return;
        }
        room.participants.delete(socket.id);
        io.to(roomId).emit("user_left", { participants: [...room.participants.values()] });
        if (room.participants.size === 0) scheduleEmptyRoomCleanup(roomId);
    });
});

initializeDatabase()
    .then(() => server.listen(port, () => console.log(`WatchSync realtime server listening on port ${port}`)))
    .catch((error) => {
        console.error("Unable to initialize the room database", error);
        process.exitCode = 1;
    });
