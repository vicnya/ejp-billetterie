const env = process.env;

function bool(v, def) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'oui'].includes(String(v).toLowerCase());
}

module.exports = {
  PORT: Number(env.PORT || 3000),
  DATABASE_URL: env.DATABASE_URL || env.POSTGRES_URL,
  BASE_URL: (env.BASE_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/$/, ''),
  CAPACITY: Number(env.CAPACITY || 100),
  ADMIN_PASSWORD: env.ADMIN_PASSWORD || '',
  SCAN_PIN: env.SCAN_PIN || '',
  SESSION_SECRET: env.SESSION_SECRET || env.ADMIN_PASSWORD || 'change-me',
  // Fin des inscriptions (ISO). Par défaut : le jour J à 13h, heure de Bruxelles.
  CLOSE_AT: env.CLOSE_AT || '2026-11-11T13:00:00+01:00',

  MAIL_PROVIDER: (env.MAIL_PROVIDER || '').toLowerCase(), // "brevo" | "resend" | ""
  BREVO_API_KEY: env.BREVO_API_KEY || '',
  RESEND_API_KEY: env.RESEND_API_KEY || '',
  MAIL_FROM: env.MAIL_FROM || '',
  MAIL_FROM_NAME: env.MAIL_FROM_NAME || 'EJP Charleroi',
  MAIL_REPLY_TO: env.MAIL_REPLY_TO || '',
  ADMIN_NOTIFY_EMAIL: env.ADMIN_NOTIFY_EMAIL || '',
  TRUST_PROXY: bool(env.TRUST_PROXY, true),

  EVENT_NAME: 'Les 7000 Adorateurs Non Souillés',
  EVENT_ORG: 'Église des Jeunes Prodiges Charleroi',
  EVENT_DATE_LONG: 'Mercredi 11 novembre 2026',
  EVENT_DATE_SHORT: '11.11.2026',
  EVENT_TIME: '14H00',
  EVENT_START_ISO: '2026-11-11T14:00:00+01:00',
  EVENT_ADDRESS: '10 rue de Marcinelle, 6000 Charleroi',

  formatNumber(n) {
    return `7000-${String(n).padStart(4, '0')}`;
  },
};
