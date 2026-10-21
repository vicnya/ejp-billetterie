const express = require('express');
const path = require('path');
const crypto = require('crypto');
const config = require('./src/config');
const db = require('./src/db');
const { renderTicket } = require('./src/ticket');
const { sendTicketEmail } = require('./src/mail');

const app = express();
if (config.TRUST_PROXY) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));

// Initialisation de la base une seule fois (compatible serveur classique et Vercel)
let ready = null;
app.use((req, res, next) => {
  if (!ready) ready = db.init().catch((e) => { ready = null; throw e; });
  ready.then(() => next(), next);
});

const PUBLIC = path.join(__dirname, 'public');
const page = (f) => (req, res) => res.sendFile(path.join(PUBLIC, f));

/* ------------------------------------------------------------------ utils */

function clean(s, max = 80) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function regPublic(r) {
  return {
    number: config.formatNumber(r.number),
    first_name: r.first_name,
    last_name: r.last_name,
    token: r.token,
  };
}

function regAdmin(r) {
  return {
    id: r.id,
    number: config.formatNumber(r.number),
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    phone: r.phone,
    source: r.source,
    created_at: r.created_at,
    email_sent_at: r.email_sent_at,
    email_error: r.email_error,
    checked_in_at: r.checked_in_at,
    checked_in_by: r.checked_in_by,
    cancelled_at: r.cancelled_at,
    token: r.token,
  };
}

// Limite simple anti-spam : 8 inscriptions / 15 min par IP
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 8;
}

async function registrationState() {
  const manual = await db.getSetting('registration_open', 'true');
  if (manual !== 'true') return 'closed';
  if (Date.now() > Date.parse(config.CLOSE_AT)) return 'closed';
  const capacity = Number(await db.getSetting('capacity', config.CAPACITY));
  const n = await db.activeCount();
  return n >= capacity ? 'full' : 'open';
}

async function deliverEmail(reg) {
  if (!config.MAIL_PROVIDER) return;
  try {
    await sendTicketEmail(reg, await renderTicket(reg));
    await db.pool.query('UPDATE registrations SET email_sent_at=now(), email_error=NULL WHERE id=$1', [reg.id]);
  } catch (e) {
    console.error('[mail]', reg.id, e.message);
    await db.pool.query('UPDATE registrations SET email_error=$2 WHERE id=$1', [reg.id, e.message.slice(0, 300)]);
  }
}

/* ------------------------------------------------------------------ sessions */

function sign(role, ttlHours) {
  const exp = Date.now() + ttlHours * 3600 * 1000;
  const payload = `${role}.${exp}`;
  const mac = crypto.createHmac('sha256', config.SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

function verify(token, role) {
  if (!token) return false;
  const [r, exp, mac] = token.split('.');
  if (!r || !exp || !mac) return false;
  const expected = crypto.createHmac('sha256', config.SESSION_SECRET).update(`${r}.${exp}`).digest('base64url');
  const ok = mac.length === expected.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  if (!ok || Number(exp) < Date.now()) return false;
  return r === role || (role === 'scan' && r === 'admin');
}

function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function setCookie(res, name, value, hours) {
  res.setHeader(
    'Set-Cookie',
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${hours * 3600}${
      config.BASE_URL.startsWith('https') ? '; Secure' : ''
    }`
  );
}

const requireRole = (role) => (req, res, next) =>
  verify(getCookie(req, 'ejp_session'), role) ? next() : res.status(401).json({ error: 'auth' });

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const loginFails = new Map();
function tooManyFails(ip) {
  const now = Date.now();
  const arr = (loginFails.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  loginFails.set(ip, arr);
  return arr.length >= 10;
}

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (tooManyFails(ip)) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans 10 minutes.' });
  const { role, secret } = req.body || {};
  let ok = false;
  if (role === 'admin' && config.ADMIN_PASSWORD) ok = safeEqual(secret, config.ADMIN_PASSWORD);
  if (role === 'scan' && config.SCAN_PIN) ok = safeEqual(secret, config.SCAN_PIN) || (config.ADMIN_PASSWORD && safeEqual(secret, config.ADMIN_PASSWORD));
  if (!ok) {
    loginFails.get(ip).push(Date.now());
    return res.status(401).json({ error: role === 'scan' ? 'Code PIN incorrect.' : 'Mot de passe incorrect.' });
  }
  const effective = role === 'scan' && safeEqual(secret, config.ADMIN_PASSWORD) ? 'admin' : role;
  setCookie(res, 'ejp_session', sign(effective, role === 'scan' ? 24 : 12), role === 'scan' ? 24 : 12);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  setCookie(res, 'ejp_session', '', 0);
  res.json({ ok: true });
});

app.get('/api/session/:role', (req, res) => {
  res.json({ ok: verify(getCookie(req, 'ejp_session'), req.params.role) });
});

/* ------------------------------------------------------------------ public */

app.get('/api/status', async (req, res, next) => {
  try {
    res.json({ state: await registrationState() });
  } catch (e) {
    next(e);
  }
});

app.post('/api/register', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.website) return res.json({ status: 'ok', token: null }); // pot de miel
    if (rateLimited(req.ip)) return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans quelques minutes.' });

    const first_name = clean(b.first_name, 50);
    const last_name = clean(b.last_name, 50);
    const email = clean(b.email, 120).toLowerCase();
    const phone = clean(b.phone, 30);
    if (!first_name || !last_name) return res.status(400).json({ error: 'Indique ton prénom et ton nom.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    if (!b.consent) return res.status(400).json({ error: 'Merci d’accepter l’utilisation de tes données pour cet événement.' });

    const state = await registrationState();
    const existing = await db.pool.query(
      'SELECT * FROM registrations WHERE lower(email)=lower($1) AND cancelled_at IS NULL',
      [email]
    );
    const result = existing.rows[0]
      ? { status: 'duplicate', reg: existing.rows[0] }
      : state !== 'open'
      ? { status: state }
      : await db.register({ first_name, last_name, email, phone });
    if (result.status === 'closed') return res.status(409).json({ status: 'closed' });
    if (result.status === 'full') return res.status(409).json({ status: 'full' });

    if (result.status === 'duplicate') {
      const r = result.reg;
      const recent = r.email_sent_at && Date.now() - new Date(r.email_sent_at).getTime() < 3 * 60 * 1000;
      if (!recent) await deliverEmail(r);
      return res.json({ status: 'duplicate', emailEnabled: !!config.MAIL_PROVIDER });
    }

    await deliverEmail(result.reg); // attendu : indispensable en serverless
    res.json({ status: 'ok', token: result.reg.token });
  } catch (e) {
    next(e);
  }
});

async function findByToken(token) {
  const { rows } = await db.pool.query('SELECT * FROM registrations WHERE token=$1', [token]);
  return rows[0];
}

app.get('/api/ticket/:token', async (req, res, next) => {
  try {
    const r = await findByToken(req.params.token);
    if (!r || r.cancelled_at) return res.status(404).json({ error: 'not_found' });
    res.json({ ...regPublic(r), emailEnabled: !!config.MAIL_PROVIDER, email_masked: r.email.replace(/^(.{2}).*(@.*)$/, '$1•••$2') });
  } catch (e) {
    next(e);
  }
});

app.get('/billet/:token.jpg', async (req, res, next) => {
  try {
    const r = await findByToken(req.params.token);
    if (!r || r.cancelled_at) return res.status(404).send('Billet introuvable');
    const img = await renderTicket(r);
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=300');
    if (req.query.dl) res.set('Content-Disposition', `attachment; filename="billet-${config.formatNumber(r.number)}.jpg"`);
    res.send(img);
  } catch (e) {
    next(e);
  }
});

app.get('/billet/:token', page('billet.html'));

/* ------------------------------------------------------------------ scan */

function parseCode(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/EJP7000:([A-Za-z0-9_-]{10,})/) || s.match(/\/billet\/([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{16,}$/.test(s)) return s;
  return null;
}

async function logScan(result, regId, device) {
  await db.pool.query('INSERT INTO scan_log(result, reg_id, device) VALUES ($1,$2,$3)', [result, regId || null, device || null]);
}

async function checkIn(where, params, device) {
  const upd = await db.pool.query(
    `UPDATE registrations SET checked_in_at=now(), checked_in_by=$${params.length + 1}
     WHERE ${where} AND cancelled_at IS NULL AND checked_in_at IS NULL RETURNING *`,
    [...params, device || null]
  );
  if (upd.rows[0]) {
    await logScan('valid', upd.rows[0].id, device);
    return { result: 'valid', reg: regAdmin(upd.rows[0]) };
  }
  const { rows } = await db.pool.query(`SELECT * FROM registrations WHERE ${where}`, params);
  const r = rows[0];
  if (!r) {
    await logScan('unknown', null, device);
    return { result: 'unknown' };
  }
  if (r.cancelled_at) {
    await logScan('cancelled', r.id, device);
    return { result: 'cancelled', reg: regAdmin(r) };
  }
  await logScan('already', r.id, device);
  return { result: 'already', reg: regAdmin(r) };
}

app.post('/api/scan', requireRole('scan'), async (req, res, next) => {
  try {
    const token = parseCode(req.body.code);
    const device = clean(req.body.device, 40);
    if (!token) {
      await logScan('unknown', null, device);
      return res.json({ result: 'unknown' });
    }
    res.json(await checkIn('token=$1', [token], device));
  } catch (e) {
    next(e);
  }
});

app.post('/api/scan/manual', requireRole('scan'), async (req, res, next) => {
  try {
    res.json(await checkIn('id=$1', [Number(req.body.id)], clean(req.body.device, 40)));
  } catch (e) {
    next(e);
  }
});

async function search(q, limit = 30) {
  const s = clean(q, 60);
  if (!s) return [];
  const num = s.replace(/^7000-?/, '');
  const { rows } = await db.pool.query(
    `SELECT * FROM registrations
     WHERE (first_name || ' ' || last_name) ILIKE $1 OR (last_name || ' ' || first_name) ILIKE $1
        OR email ILIKE $1 OR phone ILIKE $1 OR number::text = $2
     ORDER BY last_name, first_name LIMIT ${limit}`,
    [`%${s}%`, num]
  );
  return rows.map(regAdmin);
}

app.get('/api/scan/search', requireRole('scan'), async (req, res, next) => {
  try {
    res.json(await search(req.query.q, 12));
  } catch (e) {
    next(e);
  }
});

app.get('/api/scan/stats', requireRole('scan'), async (req, res, next) => {
  try {
    const { rows } = await db.pool.query(
      `SELECT count(*) FILTER (WHERE cancelled_at IS NULL)::int AS total,
              count(*) FILTER (WHERE cancelled_at IS NULL AND checked_in_at IS NOT NULL)::int AS present
       FROM registrations`
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

/* ------------------------------------------------------------------ admin */

const admin = express.Router();
admin.use(requireRole('admin'));

admin.get('/stats', async (req, res, next) => {
  try {
    const capacity = Number(await db.getSetting('capacity', config.CAPACITY));
    const open = (await db.getSetting('registration_open', 'true')) === 'true';
    const { rows: k } = await db.pool.query(`
      SELECT count(*) FILTER (WHERE cancelled_at IS NULL)::int AS total,
             count(*) FILTER (WHERE cancelled_at IS NOT NULL)::int AS cancelled,
             count(*) FILTER (WHERE cancelled_at IS NULL AND checked_in_at IS NOT NULL)::int AS present,
             count(*) FILTER (WHERE cancelled_at IS NULL AND created_at > now() - interval '24 hours')::int AS last24h,
             count(*) FILTER (WHERE cancelled_at IS NULL AND email_sent_at IS NOT NULL)::int AS emailed,
             count(*) FILTER (WHERE cancelled_at IS NULL AND email_error IS NOT NULL AND email_sent_at IS NULL)::int AS email_failed
      FROM registrations`);
    const { rows: daily } = await db.pool.query(`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'Europe/Brussels'), 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM registrations WHERE cancelled_at IS NULL GROUP BY 1 ORDER BY 1`);
    const { rows: arrivals } = await db.pool.query(`
      SELECT to_char(date_trunc('hour', checked_in_at AT TIME ZONE 'Europe/Brussels') +
             (floor(extract(minute FROM checked_in_at)/15)*15) * interval '1 minute', 'HH24:MI') AS slot, count(*)::int AS n
      FROM registrations WHERE checked_in_at IS NOT NULL AND cancelled_at IS NULL GROUP BY 1 ORDER BY 1`);
    const { rows: scans } = await db.pool.query(
      `SELECT result, count(*)::int AS n FROM scan_log GROUP BY result`
    );
    res.json({
      ...k[0],
      capacity,
      remaining: Math.max(0, capacity - k[0].total),
      open,
      state: await registrationState(),
      close_at: config.CLOSE_AT,
      mail_enabled: !!config.MAIL_PROVIDER,
      daily,
      arrivals,
      scans,
    });
  } catch (e) {
    next(e);
  }
});

admin.get('/registrations', async (req, res, next) => {
  try {
    if (req.query.q) return res.json(await search(req.query.q, 200));
    const { rows } = await db.pool.query('SELECT * FROM registrations ORDER BY number DESC');
    res.json(rows.map(regAdmin));
  } catch (e) {
    next(e);
  }
});

admin.get('/export.csv', async (req, res, next) => {
  try {
    const { rows } = await db.pool.query('SELECT * FROM registrations ORDER BY number');
    const fmt = (d) => (d ? new Date(d).toLocaleString('fr-BE', { timeZone: 'Europe/Brussels' }) : '');
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Numéro', 'Prénom', 'Nom', 'Email', 'Téléphone', 'Inscrit le', 'Source', 'E-mail envoyé', 'Présent', 'Arrivée', 'Annulé'];
    const lines = rows.map((r) =>
      [config.formatNumber(r.number), r.first_name, r.last_name, r.email, r.phone, fmt(r.created_at), r.source,
        r.email_sent_at ? 'oui' : 'non', r.checked_in_at ? 'oui' : 'non', fmt(r.checked_in_at), r.cancelled_at ? 'oui' : 'non']
        .map(q).join(';')
    );
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="inscrits-7000-adorateurs.csv"');
    res.send('﻿' + [head.map(q).join(';'), ...lines].join('\r\n'));
  } catch (e) {
    next(e);
  }
});

admin.post('/registrations', async (req, res, next) => {
  try {
    const b = req.body || {};
    const first_name = clean(b.first_name, 50);
    const last_name = clean(b.last_name, 50);
    const email = clean(b.email, 120).toLowerCase();
    if (!first_name || !last_name || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Prénom, nom et e-mail valides requis.' });
    const result = await db.register({ first_name, last_name, email, phone: clean(b.phone, 30), source: 'admin', force: !!b.force });
    if (result.status === 'full') return res.status(409).json({ error: 'Jauge atteinte. Coche « dépasser la jauge » pour forcer.' });
    if (result.status === 'duplicate') return res.status(409).json({ error: 'Cette adresse e-mail est déjà inscrite.' });
    if (b.send_email !== false) await deliverEmail(result.reg);
    res.json(regAdmin(result.reg));
  } catch (e) {
    next(e);
  }
});

admin.post('/registrations/:id/:action', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const a = req.params.action;
    const sql = {
      cancel: 'UPDATE registrations SET cancelled_at=now() WHERE id=$1',
      restore: 'UPDATE registrations SET cancelled_at=NULL WHERE id=$1',
      checkin: "UPDATE registrations SET checked_in_at=now(), checked_in_by='admin' WHERE id=$1 AND checked_in_at IS NULL",
      uncheck: 'UPDATE registrations SET checked_in_at=NULL, checked_in_by=NULL WHERE id=$1',
    }[a];
    if (a === 'resend') {
      const { rows } = await db.pool.query('SELECT * FROM registrations WHERE id=$1', [id]);
      if (!rows[0]) return res.status(404).json({ error: 'introuvable' });
      if (!config.MAIL_PROVIDER) return res.status(400).json({ error: 'Envoi e-mail non configuré.' });
      await deliverEmail(rows[0]);
      const { rows: r2 } = await db.pool.query('SELECT * FROM registrations WHERE id=$1', [id]);
      if (r2[0].email_error && !r2[0].email_sent_at) return res.status(502).json({ error: r2[0].email_error });
      return res.json(regAdmin(r2[0]));
    }
    if (!sql) return res.status(400).json({ error: 'action inconnue' });
    try {
      await db.pool.query(sql, [id]);
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'Une autre inscription active utilise déjà cet e-mail.' });
      throw e;
    }
    const { rows } = await db.pool.query('SELECT * FROM registrations WHERE id=$1', [id]);
    res.json(regAdmin(rows[0]));
  } catch (e) {
    next(e);
  }
});

// Suppression définitive d'un billet (tests, erreurs)
admin.delete('/registrations/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.pool.query('DELETE FROM scan_log WHERE reg_id=$1', [id]);
    const { rowCount } = await db.pool.query('DELETE FROM registrations WHERE id=$1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Billet introuvable.' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

admin.post('/settings', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.registration_open !== undefined) await db.setSetting('registration_open', b.registration_open ? 'true' : 'false');
    if (b.capacity !== undefined) {
      const c = Math.max(1, Math.min(5000, Number(b.capacity) || config.CAPACITY));
      await db.setSetting('capacity', c);
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.use('/api/admin', admin);

/* ------------------------------------------------------------------ pages */

app.get('/', page('index.html'));
app.get('/scan', page('scan.html'));
app.get('/admin', page('admin.html'));
app.get('/health', (req, res) => res.json({ ok: true }));
app.use(express.static(PUBLIC, { maxAge: '1h', index: false }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur, réessaie dans un instant.' });
});

module.exports = app;

if (require.main === module) {
  app.listen(config.PORT, () => console.log(`Billetterie prête sur :${config.PORT}`));
}
