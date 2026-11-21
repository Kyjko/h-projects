import pg from "pg";

const TABLE = 'public."F_OFS_MESSAGE_QUEUE"';

export function getDatabaseConfiguration(env = process.env) {
  return {
    host: env.T24_DATABASE_HOST || "localhost",
    port: Number(env.T24_DATABASE_PORT) || 5432,
    database: env.T24_DATABASE_NAME || "t24",
    user: env.T24_DATABASE_USER || "t24",
    table: "F_OFS_MESSAGE_QUEUE",
  };
}

export function createOFSQueue({ Pool = pg.Pool, env = process.env } = {}) {
  const config = getDatabaseConfiguration(env);
  const password = env.T24_DATABASE_PASSWORD ?? env.PGPASSWORD ?? "";
  const pool = new Pool({
    ...config,
    max: 4,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10_000,
    ...(password ? { password } : {}),
  });

  return {
    async checkConnection() {
      if (!password) throw new Error("T24_DATABASE_PASSWORD is not configured in the local environment.");
      await pool.query("SELECT 1");
      return { status: "connected", detail: `Connected to ${config.database} on ${config.host}:${config.port}.` };
    },
    async list() {
      const { rows } = await pool.query(`SELECT recid, xmlrecord FROM ${TABLE} ORDER BY recid`);
      return rows;
    },
    async get(recid) {
      const { rows } = await pool.query(`SELECT recid, xmlrecord FROM ${TABLE} WHERE recid = $1`, [recid]);
      return rows[0] || null;
    },
    async add(recid, message) {
      const result = await pool.query(
        `INSERT INTO ${TABLE} (recid, xmlrecord) VALUES ($1, $2::jsonb) RETURNING recid`,
        [recid, JSON.stringify(message)],
      );
      return result.rows[0].recid;
    },
    async clear() {
      const result = await pool.query(`DELETE FROM ${TABLE}`);
      return result.rowCount;
    },
    close() {
      return pool.end();
    },
  };
}
