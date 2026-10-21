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
              <b>Lieu</b> ${esc(config.EVENT_ADDRESS)}
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

async function sendTicketEmail(reg, jpg) {
  const { subject, text, html } = buildEmail(reg);
  const filename = `billet-${config.formatNumber(reg.number)}.jpg`;
  const b64 = Buffer.from(jpg).toString('base64');

  if (config.MAIL_PROVIDER === 'brevo') {
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

  if (config.MAIL_PROVIDER === 'resend') {
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

async function sendPlain(to, subject, html, text) {
  if (config.MAIL_PROVIDER === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: `${config.MAIL_FROM_NAME} <${config.MAIL_FROM}>`, to: [to], subject, html, text }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return;
  }
  if (config.MAIL_PROVIDER === 'brevo') {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': config.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { email: config.MAIL_FROM, name: config.MAIL_FROM_NAME }, to: [{ email: to }], subject, htmlContent: html, textContent: text }),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return;
  }
  throw new Error('Envoi e-mail non configuré (MAIL_PROVIDER)');
}

/** Prévient l'organisateur à chaque nouvelle inscription. */
async function sendAdminNotification(reg, stats) {
  if (!config.ADMIN_NOTIFY_EMAIL || !config.MAIL_PROVIDER) return;
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
  await sendPlain(config.ADMIN_NOTIFY_EMAIL, subject, html, text);
}

module.exports = { sendTicketEmail, sendAdminNotification, ticketUrl };
