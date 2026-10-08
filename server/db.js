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
}

export async function createPersistentRoom(roomId) {
    await pool.query(
        `INSERT INTO watch_rooms (room_id, active) VALUES ($1, TRUE)
         ON CONFLICT (room_id) DO UPDATE SET active = TRUE, ended_at = NULL`,
        [roomId],
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
