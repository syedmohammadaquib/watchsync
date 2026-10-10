import "dotenv/config";
import cors from "cors";
import express from "express";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";
import {
    cleanupExpiredRooms,
    createRoomSession,
    endPersistentRoom,
    getRoomMembership,
    getSessionByToken,
    initializeDatabase,
    isActiveRoom,
    loadPersistentRoom,
    markMemberConnected,
    savePersistentRoom,
    updateMemberRole,
} from "./db.js";

const port = Number(process.env.PORT || 4000);
const clientOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
const isAllowedOrigin = (origin, callback) => {
    callback(null, !origin || clientOrigins.includes(origin));
};
const rooms = new Map();
const roomLoadPromises = new Map();
const hostDisconnectTimers = new Map();
const HOST_GRACE_MS = 45000;
const SESSION_COOKIE = "watchsync_active_session";

const app = express();
app.use(cors({ origin: isAllowedOrigin, credentials: true }));
app.use(express.json({ limit: "16kb" }));
app.get("/health", (_request, response) => response.json({ status: "ok", service: "watchsync-realtime" }));
app.post("/session", async (request, response) => {
    const roomId = typeof request.body?.roomId === "string" ? request.body.roomId.trim().toUpperCase() : "";
    const displayName = typeof request.body?.name === "string" ? request.body.name.trim().slice(0, 32) : "";
    const mode = request.body?.mode === "create" ? "create" : "join";
    if (!/^[A-Z0-9]{4,12}$/.test(roomId) || !displayName) {
        response.status(400).json({ ok: false, message: "A valid room code and display name are required." });
        return;
    }
    try {
        const rawCookie = request.headers.cookie?.split(";")
            .map((entry) => entry.trim())
            .find((entry) => entry.startsWith(`${SESSION_COOKIE}=`));
        const existingToken = rawCookie ? decodeURIComponent(rawCookie.slice(SESSION_COOKIE.length + 1)) : "";
        const session = await createRoomSession({ roomId, displayName, mode, existingToken });
        response.cookie(SESSION_COOKIE, session.token, {
            httpOnly: true,
            sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: 30 * 24 * 60 * 60 * 1000,
            path: "/",
        });
        response.json({ ok: true, roomId });
    } catch (error) {
        const missing = error.message === "That watch room does not exist.";
        response.status(missing ? 404 : 409).json({
            ok: false,
            message: missing ? error.message : "The room could not be prepared. Please try again.",
        });
    }
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: isAllowedOrigin, methods: ["GET", "POST"], credentials: true },
});

io.use(async (socket, next) => {
    try {
        const rawCookie = socket.handshake.headers.cookie?.split(";")
            .map((entry) => entry.trim())
            .find((entry) => entry.startsWith(`${SESSION_COOKIE}=`));
        const token = rawCookie ? decodeURIComponent(rawCookie.slice(SESSION_COOKIE.length + 1)) : "";
        const session = token ? await getSessionByToken(token) : null;
        if (!session) {
            next(new Error("A valid WatchSync session is required."));
            return;
        }
        socket.data.sessionId = session.session_id;
        next();
    } catch (error) {
        console.error("Unable to authenticate Socket.IO handshake", error);
        next(new Error("The realtime session could not be verified."));
    }
});

function createRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            participants: new Map(),
            rolesBySession: new Map(),
            messages: [],
            queue: [],
            hostSessionId: null,
            actionRequests: new Map(),
            state: { videoId: null, playState: "paused", currentTime: 0, updatedAt: Date.now() },
        });
    }
    return rooms.get(roomId);
}

async function loadRoom(roomId) {
    if (roomLoadPromises.has(roomId)) return roomLoadPromises.get(roomId);
    const existing = rooms.get(roomId);
    if (existing) return existing;
    const room = createRoom(roomId);
    const loading = loadPersistentRoom(roomId).then((saved) => {
        if (saved) {
            room.hostSessionId = saved.host_session_id;
            room.state = saved.room_state || room.state;
            room.messages = Array.isArray(saved.chat_messages) ? saved.chat_messages : [];
            room.queue = Array.isArray(saved.queue_items) ? saved.queue_items : [];
            room.rolesBySession = new Map(Object.entries(saved.roles_by_session || {}));
        }
        return room;
    }).finally(() => roomLoadPromises.delete(roomId));
    roomLoadPromises.set(roomId, loading);
    return loading;
}

function persistRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room) return Promise.resolve();
    return savePersistentRoom(roomId, room);
}

function publicRoom(room) {
    const currentTime = room.state.playState === "playing"
        ? room.state.currentTime + (Date.now() - room.state.updatedAt) / 1000
        : room.state.currentTime;
    return { ...room.state, currentTime, participants: [...room.participants.values()], chat: room.messages, queue: room.queue };
}

function canControlPlayback(participant) {
    return participant?.role === "HOST" || participant?.role === "MODERATOR";
}

function canApproveRequests(participant) {
    return canControlPlayback(participant);
}

function emitToRequestReviewers(room, event, payload) {
    for (const [socketId, participant] of room.participants) {
        if (canApproveRequests(participant)) io.to(socketId).emit(event, payload);
    }
}

function clearHostDisconnectTimer(roomId) {
    clearTimeout(hostDisconnectTimers.get(roomId));
    hostDisconnectTimers.delete(roomId);
}

function scheduleHostDisconnectCleanup(roomId) {
    if (hostDisconnectTimers.has(roomId)) return;
    hostDisconnectTimers.set(roomId, setTimeout(() => {
        hostDisconnectTimers.delete(roomId);
        const room = rooms.get(roomId);
        if (room && ![...room.participants.values()].some((participant) => participant.role === "HOST")) {
            endRoom(roomId, "HOST_TIMEOUT");
        }
    }, HOST_GRACE_MS));
}

async function endRoom(roomId, reason) {
    const room = rooms.get(roomId);
    if (!room) return;

    clearHostDisconnectTimer(roomId);
    try {
        await endPersistentRoom(roomId);
    } catch (error) {
        console.error("Unable to close persistent room", error);
        io.to(roomId).emit("room_error", { code: "ROOM_END_FAILED", message: "The room could not be closed. Please try again." });
        return;
    }
    io.to(roomId).emit("room_ended", { reason });
    rooms.delete(roomId);

    for (const socketId of room.participants.keys()) {
        const participantSocket = io.sockets.sockets.get(socketId);
        participantSocket?.leave(roomId);
        participantSocket?.disconnect(true);
    }
}

io.on("connection", (socket) => {
    socket.on("join_room", async ({ roomId } = {}) => {
        try {
            const cleanRoomId = typeof roomId === "string" ? roomId.trim().toUpperCase() : "";
            if (!cleanRoomId) {
                socket.emit("room_error", { code: "INVALID_JOIN", message: "Room details are required." });
                return;
            }
            if (!(await isActiveRoom(roomId))) {
                socket.emit("room_not_found", { code: "ROOM_NOT_FOUND", message: "That watch room does not exist." });
                return;
            }
            const room = await loadRoom(roomId);
            const membership = await getRoomMembership(roomId, socket.data.sessionId);
            if (!membership) {
                socket.emit("room_error", { code: "FORBIDDEN", message: "This session is not a member of the room." });
                return;
            }
            const role = membership.role;
            const participant = { userId: socket.id, username: membership.display_name, role };
            for (const [existingSocketId] of room.participants) {
                const existingSocket = io.sockets.sockets.get(existingSocketId);
                if (existingSocketId !== socket.id && existingSocket?.data.sessionId === socket.data.sessionId) {
                    room.participants.delete(existingSocketId);
                    existingSocket.data.roomId = null;
                    existingSocket.leave(roomId);
                    existingSocket.disconnect(true);
                }
            }
            socket.join(roomId);
            socket.data.roomId = roomId;
            clearHostDisconnectTimer(roomId);
            await markMemberConnected(roomId, socket.data.sessionId, true);
            room.participants.set(socket.id, participant);
            await persistRoom(roomId);
            socket.emit("sync_state", { ...publicRoom(room), selfRole: role, selfUserId: socket.id });
            io.to(roomId).emit("user_joined", { participants: [...room.participants.values()] });
        } catch (error) {
            console.error("Unable to join room", error);
            socket.emit("room_error", { code: "ROOM_JOIN_FAILED", message: "The room could not be joined." });
        }
    });

    socket.on("send_message", async ({ text } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const participant = room?.participants.get(socket.id);
        const cleanText = typeof text === "string" ? text.trim().slice(0, 500) : "";
        if (!room || !participant || !cleanText) return;

        const chatMessage = {
            id: `${socket.id}-${Date.now()}`,
            name: participant.username,
            role: participant.role,
            text: cleanText,
            sentAt: Date.now(),
        };
        room.messages.push(chatMessage);
        if (room.messages.length > 100) room.messages.shift();
        try {
            await persistRoom(roomId);
        } catch (error) {
            console.error("Unable to persist chat message", error);
            socket.emit("room_error", { code: "PERSIST_FAILED", message: "The message could not be saved." });
            return;
        }
        io.to(roomId).emit("new_message", chatMessage);
    });

    socket.on("set_video", async ({ videoId } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const participant = room?.participants.get(socket.id);
        if (!room || !canControlPlayback(participant) || typeof videoId !== "string" || !/^[\w-]{11}$/.test(videoId)) return;
        room.state.videoId = videoId;
        room.state.playState = "paused";
        room.state.currentTime = 0;
        room.state.updatedAt = Date.now();
        try {
            await persistRoom(roomId);
        } catch (error) {
            console.error("Unable to persist video change", error);
            socket.emit("room_error", { code: "PERSIST_FAILED", message: "The video change could not be saved." });
            return;
        }
        io.to(roomId).emit("video_updated", { videoId, currentTime: 0, playState: "paused" });
    });

    socket.on("playback_action", async ({ action, currentTime } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const participant = room?.participants.get(socket.id);
        const validActions = ["play", "pause", "seek"];
        const nextTime = Number(currentTime);
        if (!room || !canControlPlayback(participant) || !validActions.includes(action) || !Number.isFinite(nextTime) || nextTime < 0) return;
        room.state.playState = action === "seek" ? room.state.playState : action === "play" ? "playing" : "paused";
        room.state.currentTime = nextTime;
        room.state.updatedAt = Date.now();
        try {
            await persistRoom(roomId);
        } catch (error) {
            console.error("Unable to persist playback action", error);
            socket.emit("room_error", { code: "PERSIST_FAILED", message: "The playback change could not be saved." });
            return;
        }
        socket.broadcast.to(roomId).emit("playback_updated", {
            action,
            currentTime: nextTime,
            updatedAt: room.state.updatedAt,
        });
    });

    socket.on("request_action", ({ action, currentTime, videoId } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const participant = room?.participants.get(socket.id);
        const validActions = ["play", "pause", "seek", "changeVideo"];
        const nextTime = Number(currentTime);
        if (!room || participant?.role !== "PARTICIPANT" || !validActions.includes(action)) return;
        if (["play", "pause", "seek"].includes(action) && (!Number.isFinite(nextTime) || nextTime < 0)) return;
        if (action === "changeVideo" && (typeof videoId !== "string" || !/^[\w-]{11}$/.test(videoId))) return;

        const request = {
            id: randomUUID(),
            action,
            currentTime: nextTime,
            videoId: action === "changeVideo" ? videoId : undefined,
            userId: socket.id,
            username: participant.username,
            createdAt: Date.now(),
        };
        room.actionRequests.set(request.id, request);
        emitToRequestReviewers(room, "action_request", request);
    });

    socket.on("approve_action_request", async ({ requestId, approved } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const approver = room?.participants.get(socket.id);
        const request = room?.actionRequests.get(requestId);
        if (!room || !canApproveRequests(approver) || !request) return;

        room.actionRequests.delete(requestId);
        emitToRequestReviewers(room, "action_request_resolved", { requestId });
        const requester = io.sockets.sockets.get(request.userId);
        requester?.emit("action_request_result", { requestId, approved: Boolean(approved) });
        if (!approved) return;

        try {
            if (request.action === "changeVideo") {
                room.state.videoId = request.videoId;
                room.state.playState = "paused";
                room.state.currentTime = 0;
                room.state.updatedAt = Date.now();
                await persistRoom(roomId);
                io.to(roomId).emit("video_updated", { videoId: request.videoId, currentTime: 0, playState: "paused" });
            } else {
                room.state.playState = request.action === "seek"
                    ? room.state.playState
                    : request.action === "play" ? "playing" : "paused";
                room.state.currentTime = request.currentTime;
                room.state.updatedAt = Date.now();
                await persistRoom(roomId);
                io.to(roomId).emit("playback_updated", {
                    action: request.action,
                    currentTime: request.currentTime,
                    updatedAt: room.state.updatedAt,
                });
            }
        } catch (error) {
            console.error("Unable to apply approved action request", error);
            approver && socket.emit("room_error", { code: "PERSIST_FAILED", message: "The approved request could not be applied." });
        }
    });

    socket.on("assign_role", async ({ userId, role } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const actor = room?.participants.get(socket.id);
        const target = room?.participants.get(userId);
        if (!room || actor?.role !== "HOST" || !target || target.role === "HOST" || !["PARTICIPANT", "MODERATOR"].includes(role)) return;

        target.role = role;
        const targetSocket = io.sockets.sockets.get(userId);
        if (targetSocket) targetSocket.data.role = role;
        if (targetSocket?.data.sessionId) room.rolesBySession.set(targetSocket.data.sessionId, role);
        try {
            await updateMemberRole(roomId, targetSocket.data.sessionId, role);
            await persistRoom(roomId);
        } catch (error) {
            console.error("Unable to persist role change", error);
            socket.emit("room_error", { code: "PERSIST_FAILED", message: "The role change could not be saved." });
            return;
        }
        io.to(roomId).emit("role_assigned", {
            userId: target.userId,
            username: target.username,
            role: target.role,
            participants: [...room.participants.values()],
        });
    });

    socket.on("transfer_host", async ({ userId } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const currentHost = room?.participants.get(socket.id);
        const target = room?.participants.get(userId);
        const targetSocket = io.sockets.sockets.get(userId);
        if (!room || currentHost?.role !== "HOST" || !target || target === currentHost || !targetSocket?.data.sessionId) return;

        currentHost.role = "PARTICIPANT";
        target.role = "HOST";
        room.hostSessionId = targetSocket.data.sessionId;
        room.rolesBySession.set(socket.data.sessionId, "PARTICIPANT");
        room.rolesBySession.set(targetSocket.data.sessionId, "HOST");
        try {
            await updateMemberRole(roomId, socket.data.sessionId, "PARTICIPANT");
            await updateMemberRole(roomId, targetSocket.data.sessionId, "HOST");
            await persistRoom(roomId);
        } catch (error) {
            console.error("Unable to persist host transfer", error);
            socket.emit("room_error", { code: "PERSIST_FAILED", message: "The host transfer could not be saved." });
            return;
        }
        io.to(roomId).emit("role_assigned", {
            userId: socket.id,
            username: currentHost.username,
            role: "PARTICIPANT",
            participants: [...room.participants.values()],
        });
        io.to(roomId).emit("role_assigned", {
            userId: target.userId,
            username: target.username,
            role: "HOST",
            participants: [...room.participants.values()],
        });
    });

    socket.on("remove_participant", async ({ userId } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const actor = room?.participants.get(socket.id);
        const target = room?.participants.get(userId);
        if (!room || actor?.role !== "HOST" || !target || target.role === "HOST") return;

        room.participants.delete(userId);
        const targetSocket = io.sockets.sockets.get(userId);
        if (targetSocket?.data.sessionId) room.rolesBySession.delete(targetSocket.data.sessionId);
        try {
            await markMemberConnected(roomId, targetSocket?.data.sessionId, false);
            await persistRoom(roomId);
        } catch (error) {
            console.error("Unable to persist participant removal", error);
            socket.emit("room_error", { code: "PERSIST_FAILED", message: "The participant could not be removed." });
            return;
        }
        targetSocket?.emit("participant_removed", { userId, reason: "REMOVED_BY_HOST" });
        if (targetSocket) targetSocket.data.roomId = null;
        targetSocket?.leave(roomId);
        targetSocket?.disconnect(true);
        io.to(roomId).emit("user_left", { participants: [...room.participants.values()] });
    });

    socket.on("queue_add", async ({ videoId } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const participant = room?.participants.get(socket.id);
        if (!room || !participant || typeof videoId !== "string" || !/^[\w-]{11}$/.test(videoId)) return;
        room.queue.push({
            id: `${socket.id}-${Date.now()}`,
            videoId,
            title: `YouTube video · ${videoId}`,
            requestedBy: participant.username,
            requestedById: socket.id,
            addedAt: Date.now(),
        });
        try {
            await persistRoom(roomId);
        } catch (error) {
            console.error("Unable to persist queue item", error);
            socket.emit("room_error", { code: "PERSIST_FAILED", message: "The queue item could not be saved." });
            return;
        }
        io.to(roomId).emit("queue_updated", { queue: room.queue });
    });

    socket.on("queue_remove", async ({ itemId } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const participant = room?.participants.get(socket.id);
        const item = room?.queue.find((entry) => entry.id === itemId);
        if (!room || !participant || !item) return;
        if (!canControlPlayback(participant) && item.requestedById !== socket.id) return;
        room.queue = room.queue.filter((entry) => entry.id !== itemId);
        try {
            await persistRoom(roomId);
        } catch (error) {
            console.error("Unable to persist queue removal", error);
            socket.emit("room_error", { code: "PERSIST_FAILED", message: "The queue item could not be removed." });
            return;
        }
        io.to(roomId).emit("queue_updated", { queue: room.queue });
    });

    socket.on("queue_play", async ({ itemId } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const participant = room?.participants.get(socket.id);
        const item = room?.queue.find((entry) => entry.id === itemId);
        if (!room || !canControlPlayback(participant) || !item) return;
        room.state.videoId = item.videoId;
        room.state.playState = "playing";
        room.state.currentTime = 0;
        room.state.updatedAt = Date.now();
        room.queue = room.queue.filter((entry) => entry.id !== itemId);
        try {
            await persistRoom(roomId);
        } catch (error) {
            console.error("Unable to persist queue playback", error);
            socket.emit("room_error", { code: "PERSIST_FAILED", message: "The queued video could not be started." });
            return;
        }
        io.to(roomId).emit("video_updated", { videoId: item.videoId, currentTime: 0, playState: "playing" });
        io.to(roomId).emit("queue_updated", { queue: room.queue });
    });

    socket.on("send_reaction", ({ emoji } = {}) => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const participant = room?.participants.get(socket.id);
        if (!room || !participant || !room.state.videoId || typeof emoji !== "string" || Array.from(emoji).length > 8 || !/\p{Extended_Pictographic}/u.test(emoji)) return;
        io.to(roomId).emit("room_reaction", { id: `${socket.id}-${Date.now()}`, emoji, name: participant.username });
    });

    socket.on("leave_room", () => {
        const roomId = socket.data.roomId;
        if (!roomId) return;
        const room = rooms.get(roomId);
        const participant = room?.participants.get(socket.id);
        if (participant?.role === "HOST") {
            socket.data.roomId = null;
            endRoom(roomId, "HOST_LEFT");
            return;
        }
        room?.participants.delete(socket.id);
        socket.leave(roomId);
        socket.data.roomId = null;
        markMemberConnected(roomId, socket.data.sessionId, false).catch((error) => console.error("Unable to update member state", error));
        if (room) io.to(roomId).emit("user_left", { participants: [...room.participants.values()] });
    });

    socket.on("end_room", () => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        const participant = room?.participants.get(socket.id);
        if (participant?.role !== "HOST") {
            socket.emit("room_error", { code: "FORBIDDEN", message: "Only the Host can end the room." });
            return;
        }
        endRoom(roomId, "HOST_ENDED");
    });

    socket.on("disconnect", () => {
        const roomId = socket.data.roomId;
        const room = roomId && rooms.get(roomId);
        if (!room) return;
        const participant = room.participants.get(socket.id);
        if (!participant) return;
        if (participant?.role === "HOST") {
            room.participants.delete(socket.id);
            io.to(roomId).emit("user_left", { participants: [...room.participants.values()] });
            markMemberConnected(roomId, socket.data.sessionId, false).catch((error) => console.error("Unable to update host state", error));
            scheduleHostDisconnectCleanup(roomId);
            return;
        }
        room.participants.delete(socket.id);
        markMemberConnected(roomId, socket.data.sessionId, false).catch((error) => console.error("Unable to update member state", error));
        io.to(roomId).emit("user_left", { participants: [...room.participants.values()] });
    });
});

initializeDatabase()
    .then(() => {
        const cleanupTimer = setInterval(() => {
            cleanupExpiredRooms().catch((error) => console.error("Unable to clean up expired rooms", error));
        }, 15 * 60 * 1000);
        cleanupTimer.unref();
        return server.listen(port, () => console.log(`WatchSync realtime server listening on port ${port}`));
    })
    .catch((error) => {
        console.error("Unable to initialize the room database", error);
        process.exitCode = 1;
    });
