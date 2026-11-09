const config = require('./config');

function ticketUrl(reg) {
  return `${config.BASE_URL}/billet/${reg.token}`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function buildEmail(reg) {
  const url = ticketUrl(reg);
  const number = config.formatNumber(reg.number);
  const subject = `Ton billet – ${config.EVENT_NAME} (${number})`;
  const text = [
    `Bonjour ${reg.first_name},`,
    '',
    `Ton inscription à « ${config.EVENT_NAME} » est confirmée.`,
    `${config.EVENT_DATE_LONG} à 14h – ${config.EVENT_ADDRESS}`,
    'Repas offert à la fin.',
    `Billet n° ${number}`,
    '',
    `Ton billet (avec QR code) est en pièce jointe. Tu peux aussi le retrouver ici : ${url}`,
    'Présente le QR code à l’entrée, sur ton téléphone ou imprimé.',
    '',
    `${config.EVENT_ORG}`,
  ].join('\n');

  const html = `<!doctype html><html><body style="margin:0;background:#140a04;font-family:Arial,Helvetica,sans-serif;color:#f6ead2">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#140a04;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#21110a;border:1px solid #5a3415;border-radius:16px">
        <tr><td style="padding:28px 28px 8px;text-align:center">
          <div style="font-family:Georgia,serif;font-style:italic;font-size:26px;color:#fff4dc">Les 7000</div>
          <div style="font-family:Georgia,serif;font-size:22px;color:#fff4dc;margin-top:2px">Adorateurs non souillés</div>
          <div style="display:inline-block;margin-top:14px;padding:6px 16px;border-radius:20px;background:#e3b45f;color:#2a1406;font-size:12px;letter-spacing:3px;font-weight:bold">INSCRIPTION CONFIRMÉE</div>
        </td></tr>
        <tr><td style="padding:16px 28px 8px;font-size:15px;line-height:1.6;color:#f1dcb4">
          Bonjour ${esc(reg.first_name)},<br>
          Ta place est réservée. Ton billet avec QR code est en pièce jointe de cet e-mail.
        </td></tr>
        <tr><td style="padding:8px 28px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf3e3;border-radius:12px;color:#22120a">
            <tr><td style="padding:16px 18px;font-size:14px;line-height:1.7">
              <b>Billet n°</b> ${esc(number)}<br>
              <b>Date</b> ${esc(config.EVENT_DATE_LONG)} à 14h<br>
              <b>Lieu</b> ${esc(config.EVENT_ADDRESS)}<br>
              <b>Repas</b> offert à la fin
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:20px 28px 8px">
          <a href="${url}" style="display:inline-block;padding:13px 26px;border-radius:26px;background:#e3b45f;color:#2a1406;text-decoration:none;font-weight:bold;font-size:15px">Voir et télécharger mon billet</a>
        </td></tr>
        <tr><td style="padding:12px 28px 28px;font-size:13px;line-height:1.6;color:#c9ad83;text-align:center">
          Présente le QR code à l’entrée, sur ton téléphone ou imprimé.<br>${esc(config.EVENT_ORG)}
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;

  return { subject, text, html };
}

async function sendTicketEmailVia(provider, reg, jpg) {
  const { subject, text, html } = buildEmail(reg);
  const filename = `billet-${config.formatNumber(reg.number)}.jpg`;
  const b64 = Buffer.from(jpg).toString('base64');

  if (provider === 'brevo') {
    const body = {
      sender: { email: config.MAIL_FROM, name: config.MAIL_FROM_NAME },
      to: [{ email: reg.email, name: `${reg.first_name} ${reg.last_name}` }],
      subject,
      htmlContent: html,
      textContent: text,
      attachment: [{ name: filename, content: b64 }],
    };
    if (config.MAIL_REPLY_TO) body.replyTo = { email: config.MAIL_REPLY_TO };
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': config.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return;
  }

  if (provider === 'resend') {
    const body = {
      from: `${config.MAIL_FROM_NAME} <${config.MAIL_FROM}>`,
      to: [reg.email],
      subject,
      html,
      text,
      attachments: [{ filename, content: b64 }],
    };
    if (config.MAIL_REPLY_TO) body.reply_to = config.MAIL_REPLY_TO;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return;
  }

  throw new Error('Envoi e-mail non configuré (MAIL_PROVIDER)');
}

async function sendPlainVia(provider, to, subject, html, text) {
  if (provider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: `${config.MAIL_FROM_NAME} <${config.MAIL_FROM}>`, to: [].concat(to), subject, html, text }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return;
  }
  if (provider === 'brevo') {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': config.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { email: config.MAIL_FROM, name: config.MAIL_FROM_NAME }, to: [].concat(to).map((email) => ({ email })), subject, htmlContent: html, textContent: text }),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return;
  }
  throw new Error('Envoi e-mail non configuré (MAIL_PROVIDER)');
}

// Brevo d'abord ; en cas d'échec, Resend en secours (si sa clé existe)
async function withFallback(run) {
  try {
    return await run(config.MAIL_PROVIDER);
  } catch (e) {
    if (config.MAIL_PROVIDER === 'brevo' && config.RESEND_API_KEY) {
      console.error('[mail] Brevo en échec, secours Resend :', e.message);
      return run('resend');
    }
    throw e;
  }
}
const sendTicketEmail = (reg, jpg) => withFallback((p) => sendTicketEmailVia(p, reg, jpg));
const sendPlain = (to, subject, html, text) => withFallback((p) => sendPlainVia(p, to, subject, html, text));

/** Prévient l'organisateur à chaque nouvelle inscription. */
async function sendAdminNotification(reg, stats, extra = '') {
  if (!config.MAIL_PROVIDER) return;
  const number = config.formatNumber(reg.number);
  const name = `${reg.first_name} ${reg.last_name}`;
  const subject = `Nouvelle inscription ${number} – ${name} (${stats.total}/${stats.capacity})`;
  const rows = [
    ['Billet', number],
    ['Nom', name],
    ['E-mail', reg.email],
    ['Téléphone', reg.phone || '—'],
    ['Inscrits', `${stats.total} / ${stats.capacity} (reste ${Math.max(0, stats.capacity - stats.total)})`],
  ];
  const text = rows.map(([k, v]) => `${k} : ${v}`).join('\n') + `\n\nTableau de bord : ${config.BASE_URL}/admin\nBillet : ${ticketUrl(reg)}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#22120a;max-width:520px">
    <p style="font-size:16px;margin:0 0 12px"><b>Nouvelle inscription</b> – ${esc(config.EVENT_NAME)}</p>
    <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">${rows
      .map(([k, v]) => `<tr><td style="color:#7a5a36;border-bottom:1px solid #eee;width:110px">${esc(k)}</td><td style="border-bottom:1px solid #eee"><b>${esc(v)}</b></td></tr>`)
      .join('')}</table>
    <p style="margin:16px 0 0"><a href="${config.BASE_URL}/admin" style="color:#b97f2c">Ouvrir le tableau de bord</a> · <a href="${ticketUrl(reg)}" style="color:#b97f2c">Voir le billet</a></p>
  </div>`;
  // Plusieurs destinataires possibles : adresses séparées par des virgules
  const recipients = [...new Set(`${config.ADMIN_NOTIFY_EMAIL},${extra}`.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)))];
  if (recipients.length) await sendPlain(recipients, subject, html, text);
}

const ROUNDS = {
  veille: {
    label: 'Rappel J-1 (mardi)',
    subject: (r) => `C'est demain ! ${config.EVENT_NAME} – mercredi 14h`,
    intro: (r) => `Bonjour ${esc(r.first_name)},<br>C'est <b>demain</b> ! On a hâte de t'accueillir pour adorer ensemble.`,
    introText: (r) => `Bonjour ${r.first_name},\nC'est demain ! On a hâte de t'accueillir pour adorer ensemble.`,
  },
  jourj: {
    label: 'Rappel jour J (mercredi)',
    subject: (r) => `C'est aujourd'hui à 14h ! ${config.EVENT_NAME}`,
    intro: (r) => `Bonjour ${esc(r.first_name)},<br>C'est <b>aujourd'hui</b> ! Rendez-vous à 14h, ta place t'attend.`,
    introText: (r) => `Bonjour ${r.first_name},\nC'est aujourd'hui ! Rendez-vous à 14h, ta place t'attend.`,
  },
};

function buildReminder(reg, round) {
  const R = ROUNDS[round];
  const url = ticketUrl(reg);
  const number = config.formatNumber(reg.number);
  const subject = R.subject(reg);
  const text = [
    R.introText(reg),
    '',
    `${config.EVENT_DATE_LONG} à 14h`,
    config.EVENT_ADDRESS,
    'Repas offert à la fin.',
    '',
    `Ton billet n° ${number} (QR code à présenter à l'entrée) : ${url}`,
    "Conseil : ouvre ton billet avant d'arriver ou fais une capture d'écran, pour passer vite à l'entrée.",
    '',
    config.EVENT_ORG,
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#140a04;font-family:Arial,Helvetica,sans-serif;color:#f6ead2">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#140a04;padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#21110a;border:1px solid #5a3415;border-radius:16px">
      <tr><td style="padding:28px 28px 8px;text-align:center">
        <div style="font-family:Georgia,serif;font-style:italic;font-size:26px;color:#fff4dc">Les 7000</div>
        <div style="font-family:Georgia,serif;font-size:22px;color:#fff4dc;margin-top:2px">Adorateurs non souillés</div>
        <div style="display:inline-block;margin-top:14px;padding:6px 16px;border-radius:20px;background:#e3b45f;color:#2a1406;font-size:12px;letter-spacing:3px;font-weight:bold">${round === 'veille' ? "C'EST DEMAIN" : "C'EST AUJOURD'HUI"}</div>
      </td></tr>
      <tr><td style="padding:16px 28px 8px;font-size:15px;line-height:1.6;color:#f1dcb4">${R.intro(reg)}</td></tr>
      <tr><td style="padding:8px 28px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbf3e3;border-radius:12px;color:#22120a"><tr><td style="padding:16px 18px;font-size:14px;line-height:1.7">
          <b>Quand</b> ${esc(config.EVENT_DATE_LONG)} à 14h<br>
          <b>Où</b> ${esc(config.EVENT_ADDRESS)}<br>
          <b>Billet n°</b> ${esc(number)}<br>
          <b>Repas</b> offert à la fin
        </td></tr></table>
      </td></tr>
      <tr><td align="center" style="padding:20px 28px 8px">
        <a href="${url}" style="display:inline-block;padding:13px 26px;border-radius:26px;background:#e3b45f;color:#2a1406;text-decoration:none;font-weight:bold;font-size:15px">Ouvrir mon billet (QR code)</a>
      </td></tr>
      <tr><td style="padding:12px 28px 28px;font-size:13px;line-height:1.6;color:#c9ad83;text-align:center">
        Ouvre ton billet avant d'arriver ou fais une capture d'écran : tu passeras plus vite à l'entrée.<br>${esc(config.EVENT_ORG)}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
  return { subject, html, text };
}

/** Envoie un lot de rappels (sans pièce jointe). Retourne [{reg_id, ok, error}]. */
async function sendReminderBatch(regs, round) {
  if (!regs.length) return [];
  const from = `${config.MAIL_FROM_NAME} <${config.MAIL_FROM}>`;
  if (config.MAIL_PROVIDER === 'resend') {
    const payload = regs.map((r) => {
      const m = buildReminder(r, round);
      const o = { from, to: [r.email], subject: m.subject, html: m.html, text: m.text };
      if (config.MAIL_REPLY_TO) o.reply_to = config.MAIL_REPLY_TO;
      return o;
    });
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
      return regs.map((r) => ({ reg_id: r.id, ok: false, error: err }));
    }
    return regs.map((r) => ({ reg_id: r.id, ok: true }));
  }
  // Brevo (ou autre) : envois individuels, 5 en parallèle
  const out = [];
  for (let i = 0; i < regs.length; i += 5) {
    const part = regs.slice(i, i + 5);
    const rs = await Promise.all(part.map(async (r) => {
      try { const m = buildReminder(r, round); await sendPlain(r.email, m.subject, m.html, m.text); return { reg_id: r.id, ok: true }; }
      catch (e) { return { reg_id: r.id, ok: false, error: e.message.slice(0, 300) }; }
    }));
    out.push(...rs);
  }
  return out;
}

module.exports = { sendTicketEmail, sendAdminNotification, ticketUrl, sendReminderBatch, buildReminder, sendPlain, ROUNDS };
