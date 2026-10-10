import pg from "pg";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to start the realtime server.");
}

export const pool = new Pool({ connectionString: databaseUrl, max: 10 });

export async function initializeDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS watch_rooms (
            room_id VARCHAR(32) PRIMARY KEY,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ended_at TIMESTAMPTZ
        )
    `);
    await pool.query(`
        ALTER TABLE watch_rooms
            ADD COLUMN IF NOT EXISTS host_session_id VARCHAR(128),
            ADD COLUMN IF NOT EXISTS room_state JSONB NOT NULL DEFAULT '{"videoId":null,"playState":"paused","currentTime":0,"updatedAt":0}'::jsonb,
            ADD COLUMN IF NOT EXISTS chat_messages JSONB NOT NULL DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS queue_items JSONB NOT NULL DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS roles_by_session JSONB NOT NULL DEFAULT '{}'::jsonb,
            ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ
    `);
    await pool.query(`
        UPDATE watch_rooms
        SET expires_at = created_at + INTERVAL '24 hours'
        WHERE expires_at IS NULL
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS watchsync_sessions (
            session_id UUID PRIMARY KEY,
            token_hash CHAR(64) NOT NULL UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            revoked_at TIMESTAMPTZ
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS watch_room_members (
            room_id VARCHAR(32) NOT NULL REFERENCES watch_rooms(room_id) ON DELETE CASCADE,
            session_id UUID NOT NULL REFERENCES watchsync_sessions(session_id) ON DELETE CASCADE,
            display_name VARCHAR(32) NOT NULL,
            role VARCHAR(16) NOT NULL CHECK (role IN ('HOST', 'PARTICIPANT', 'MODERATOR')),
            connected BOOLEAN NOT NULL DEFAULT FALSE,
            disconnected_at TIMESTAMPTZ,
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (room_id, session_id)
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS watch_room_members_session_idx
        ON watch_room_members (session_id)
    `);
}

function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
}

export async function createRoomSession({ roomId, displayName, mode, existingToken }) {
    const existingSessionId = existingToken ? await getSessionIdentityByToken(existingToken) : null;
    const token = existingSessionId ? existingToken : randomBytes(32).toString("base64url");
    const sessionId = existingSessionId || randomUUID();
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        if (mode === "create") {
            const result = await client.query(
                `INSERT INTO watch_rooms (room_id, active, host_session_id, expires_at)
                 VALUES ($1, TRUE, $2, NOW() + INTERVAL '24 hours')
                 ON CONFLICT (room_id) DO UPDATE SET active = TRUE, ended_at = NULL,
                    host_session_id = EXCLUDED.host_session_id, expires_at = EXCLUDED.expires_at
                 WHERE watch_rooms.active = FALSE
                 RETURNING room_id`,
                [roomId, sessionId],
            );
            if (result.rowCount === 0) throw new Error("That room code is already active.");
        } else {
            const result = await client.query(
                "SELECT host_session_id FROM watch_rooms WHERE room_id = $1 AND active = TRUE",
                [roomId],
            );
            if (result.rowCount === 0) throw new Error("That watch room does not exist.");
        }
        await client.query(
            `INSERT INTO watchsync_sessions (session_id, token_hash)
             VALUES ($1, $2)
             ON CONFLICT (session_id) DO UPDATE SET last_seen_at = NOW()`,
            [sessionId, hashToken(token)],
        );
        const role = mode === "create" ? "HOST" : "PARTICIPANT";
        await client.query(
            `INSERT INTO watch_room_members
                (room_id, session_id, display_name, role, connected, disconnected_at)
             VALUES ($1, $2, $3, $4, FALSE, NULL)
             ON CONFLICT (room_id, session_id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                connected = FALSE,
                disconnected_at = NULL,
                last_seen_at = NOW()`,
            [roomId, sessionId, displayName, role],
        );
        await client.query("COMMIT");
        return { token, sessionId, role };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function createPersistentRoom(roomId, hostSessionId) {
    const result = await pool.query(
        `INSERT INTO watch_rooms (room_id, active, host_session_id) VALUES ($1, TRUE, $2)
         ON CONFLICT (room_id) DO UPDATE SET active = TRUE, ended_at = NULL, host_session_id = EXCLUDED.host_session_id
         WHERE watch_rooms.active = FALSE OR watch_rooms.host_session_id = EXCLUDED.host_session_id
         RETURNING room_id`,
        [roomId, hostSessionId],
    );
    if (result.rowCount === 0) throw new Error("That room code is already active.");
}

export async function getSessionByToken(token) {
    const result = await pool.query(
        `SELECT session_id
         FROM watchsync_sessions
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hashToken(token)],
    );
    if (result.rowCount === 0) return null;
    await pool.query("UPDATE watchsync_sessions SET last_seen_at = NOW() WHERE session_id = $1", [result.rows[0].session_id]);
    return result.rows[0];
}

export async function getRoomMembership(roomId, sessionId) {
    const result = await pool.query(
        `SELECT room_id, session_id, display_name, role
         FROM watch_room_members
         WHERE room_id = $1 AND session_id = $2`,
        [roomId, sessionId],
    );
    return result.rows[0] || null;
}

export async function getSessionIdentityByToken(token) {
    const result = await pool.query(
        `SELECT session_id FROM watchsync_sessions
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hashToken(token)],
    );
    return result.rows[0]?.session_id || null;
}

export async function markMemberConnected(roomId, sessionId, connected) {
    await pool.query(
        `UPDATE watch_room_members
         SET connected = $3, disconnected_at = CASE WHEN $3 THEN NULL ELSE NOW() END, last_seen_at = NOW()
         WHERE room_id = $1 AND session_id = $2`,
        [roomId, sessionId, connected],
    );
}

export async function updateMemberRole(roomId, sessionId, role) {
    await pool.query(
        "UPDATE watch_room_members SET role = $3, last_seen_at = NOW() WHERE room_id = $1 AND session_id = $2",
        [roomId, sessionId, role],
    );
}

export async function loadPersistentRoom(roomId) {
    const result = await pool.query(
        `SELECT host_session_id, room_state, chat_messages, queue_items, roles_by_session
         FROM watch_rooms WHERE room_id = $1 AND active = TRUE`,
        [roomId],
    );
    return result.rows[0] || null;
}

export async function savePersistentRoom(roomId, room) {
    await pool.query(
        `UPDATE watch_rooms SET host_session_id = $2, room_state = $3::jsonb,
            chat_messages = $4::jsonb, queue_items = $5::jsonb, roles_by_session = $6::jsonb
         WHERE room_id = $1 AND active = TRUE`,
        [roomId, room.hostSessionId, JSON.stringify(room.state), JSON.stringify(room.messages), JSON.stringify(room.queue), JSON.stringify(Object.fromEntries(room.rolesBySession))],
    );
}

export async function isActiveRoom(roomId) {
    const result = await pool.query(
        "SELECT 1 FROM watch_rooms WHERE room_id = $1 AND active = TRUE",
        [roomId],
    );
    return result.rowCount > 0;
}

export async function endPersistentRoom(roomId) {
    await pool.query(
        "DELETE FROM watch_rooms WHERE room_id = $1",
        [roomId],
    );
}

export async function cleanupExpiredRooms() {
    await pool.query(
        `DELETE FROM watch_rooms
         WHERE (active = TRUE AND expires_at IS NOT NULL AND expires_at <= NOW())
            OR (ended_at IS NOT NULL AND ended_at < NOW() - INTERVAL '1 hour')`,
    );
}
