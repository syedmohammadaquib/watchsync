import pg from "pg";

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
            ADD COLUMN IF NOT EXISTS roles_by_session JSONB NOT NULL DEFAULT '{}'::jsonb
    `);
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
