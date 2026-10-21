const { Pool } = require('pg');
const crypto = require('crypto');
const config = require('./config');

const needsSsl =
  config.DATABASE_URL &&
  !/localhost|127\.0\.0\.1|\.railway\.internal/.test(config.DATABASE_URL) &&
  !/sslmode=disable/.test(config.DATABASE_URL);

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: 10,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registrations (
      id            SERIAL PRIMARY KEY,
      number        INTEGER NOT NULL UNIQUE,
      token         TEXT NOT NULL UNIQUE,
      first_name    TEXT NOT NULL,
      last_name     TEXT NOT NULL,
      email         TEXT NOT NULL,
      phone         TEXT,
      source        TEXT NOT NULL DEFAULT 'web',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      email_sent_at TIMESTAMPTZ,
      email_error   TEXT,
      checked_in_at TIMESTAMPTZ,
      checked_in_by TEXT,
      cancelled_at  TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS registrations_email_active
      ON registrations (lower(email)) WHERE cancelled_at IS NULL;
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scan_log (
      id         SERIAL PRIMARY KEY,
      at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      result     TEXT NOT NULL,
      reg_id     INTEGER,
      device     TEXT
    );
  `);
}

async function getSetting(key, def, client = pool) {
  const { rows } = await client.query('SELECT value FROM settings WHERE key=$1', [key]);
  return rows[0] ? rows[0].value : def;
}

async function setSetting(key, value) {
  await pool.query(
    'INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
    [key, String(value)]
  );
}

async function activeCount(client = pool) {
  const { rows } = await client.query('SELECT count(*)::int AS n FROM registrations WHERE cancelled_at IS NULL');
  return rows[0].n;
}

function newToken() {
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * Crée une inscription de manière atomique.
 * Retourne { status: 'ok', reg } | { status: 'duplicate', reg } | { status: 'full' }
 */
async function register({ first_name, last_name, email, phone, source = 'web', force = false }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7000)');

    const dup = await client.query(
      'SELECT * FROM registrations WHERE lower(email)=lower($1) AND cancelled_at IS NULL',
      [email]
    );
    if (dup.rows[0]) {
      await client.query('ROLLBACK');
      return { status: 'duplicate', reg: dup.rows[0] };
    }

    if (!force) {
      const capacity = Number(await getSetting('capacity', config.CAPACITY, client));
      const n = await activeCount(client);
      if (n >= capacity) {
        await client.query('ROLLBACK');
        return { status: 'full' };
      }
    }

    const { rows: m } = await client.query('SELECT COALESCE(MAX(number),0)+1 AS next FROM registrations');
    const { rows } = await client.query(
      `INSERT INTO registrations(number, token, first_name, last_name, email, phone, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [m[0].next, newToken(), first_name, last_name, email, phone || null, source]
    );
    await client.query('COMMIT');
    return { status: 'ok', reg: rows[0] };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, init, getSetting, setSetting, activeCount, register };
