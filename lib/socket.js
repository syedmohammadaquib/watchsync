import { io } from "socket.io-client";

export function createWatchSyncSocket() {
    return io(process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000", {
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        withCredentials: true,
    });
}
