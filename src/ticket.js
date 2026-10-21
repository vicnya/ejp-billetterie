const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { Resvg } = require('@resvg/resvg-js');
const sharp = require('sharp');
const config = require('./config');

const ROOT = path.join(__dirname, '..');
const FONT_FILES = fs
  .readdirSync(path.join(ROOT, 'fonts'))
  .filter((f) => f.endsWith('.ttf'))
  .map((f) => path.join(ROOT, 'fonts', f));
const POSTER_B64 = fs.readFileSync(path.join(ROOT, 'assets', 'affiche.jpg')).toString('base64');

const W = 2200;
const H = 720;
const POSTER_W = 1600;

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function qrPayload(token) {
  return `EJP7000:${token}`;
}

function qrRects(text, x, y, size) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  let out = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (qr.modules.get(r, c)) {
        let run = 1;
        while (c + run < n && qr.modules.get(r, c + run)) run++;
        const px = x + (c + quiet) * cell;
        const py = y + (r + quiet) * cell;
        out += `<rect x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${(run * cell + 0.4).toFixed(2)}" height="${(cell + 0.4).toFixed(2)}"/>`;
        c += run;
      } else c++;
    }
  }
  return out;
}

function fitName(name) {
  const len = name.length;
  if (len <= 18) return 34;
  if (len <= 22) return 29;
  if (len <= 27) return 25;
  return 21;
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function buildSvg(reg) {
  const fullName = truncate(`${reg.first_name} ${reg.last_name}`.trim(), 32);
  const nameSize = fitName(fullName);
  const number = config.formatNumber(reg.number);
  const sx = POSTER_W; // stub x
  const cardX = sx + 44;
  const cardW = 600 - 88;
  const qrSize = 250;
  const qrX = sx + 300 - qrSize / 2;
  const qrY = 372;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="ticket"><rect x="0" y="0" width="${W}" height="${H}" rx="28"/></clipPath>
    <linearGradient id="stubBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3a1a07"/>
      <stop offset="0.55" stop-color="#1e0d04"/>
      <stop offset="1" stop-color="#2c1406"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.12" r="0.7">
      <stop offset="0" stop-color="#f3a640" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#f3a640" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#c98d36"/>
      <stop offset="0.5" stop-color="#f6d58e"/>
      <stop offset="1" stop-color="#c98d36"/>
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffaf0"/>
      <stop offset="1" stop-color="#f6ead2"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#ticket)">
    <image x="0" y="0" width="${POSTER_W}" height="${H}" preserveAspectRatio="xMidYMid slice" xlink:href="data:image/jpeg;base64,${POSTER_B64}"/>
    <!-- couvre le bouton "INSCRIS-TOI" de l'affiche -->
    <rect x="546" y="606" width="168" height="52" rx="8" fill="#3b1c08"/>
    <rect x="540" y="609" width="222" height="46" rx="23" fill="url(#gold)"/>
    <text x="651" y="638" text-anchor="middle" font-family="Cinzel" font-weight="600" font-size="15" letter-spacing="1.5" fill="#2a1406">ENTRÉE GRATUITE</text>

    <rect x="${sx}" y="0" width="600" height="${H}" fill="url(#stubBg)"/>
    <rect x="${sx}" y="0" width="600" height="${H}" fill="url(#glow)"/>
    <line x1="${sx + 1}" y1="24" x2="${sx + 1}" y2="${H - 24}" stroke="#f6d58e" stroke-opacity="0.8" stroke-width="3" stroke-dasharray="10 9"/>

    <text x="${sx + 300}" y="70" text-anchor="middle" font-family="Playfair Display" font-style="italic" font-weight="600" font-size="40" fill="#fff4dc">Les 7000</text>
    <text x="${sx + 300}" y="112" text-anchor="middle" font-family="Playfair Display" font-weight="700" font-size="33" fill="#fff4dc">Adorateurs non souillés</text>

    <rect x="${sx + 130}" y="134" width="340" height="44" rx="22" fill="url(#gold)"/>
    <text x="${sx + 300}" y="163" text-anchor="middle" font-family="Cinzel" font-weight="600" font-size="19" letter-spacing="4" fill="#2a1406">TICKET D'ENTRÉE</text>

    <rect x="${cardX}" y="200" width="${cardW}" height="458" rx="22" fill="url(#paper)"/>
    <text x="${cardX + 30}" y="238" font-family="Poppins" font-weight="500" font-size="13" letter-spacing="2" fill="#7a5a36">NOM DU PARTICIPANT</text>
    <text x="${cardX + 30}" y="278" font-family="Playfair Display" font-weight="700" font-size="${nameSize}" fill="#22120a">${esc(fullName)}</text>
    <line x1="${cardX + 30}" y1="298" x2="${cardX + cardW - 30}" y2="298" stroke="#d9c39b" stroke-width="1.5"/>
    <text x="${cardX + 30}" y="326" font-family="Poppins" font-weight="500" font-size="13" letter-spacing="2" fill="#7a5a36">N° DE BILLET</text>
    <text x="${cardX + 30}" y="358" font-family="Poppins" font-weight="700" font-size="26" fill="#22120a">${esc(number)}</text>
    <text x="${cardX + cardW - 30}" y="326" text-anchor="end" font-family="Poppins" font-weight="500" font-size="13" letter-spacing="2" fill="#7a5a36">${esc(config.EVENT_DATE_SHORT)}</text>
    <text x="${cardX + cardW - 30}" y="358" text-anchor="end" font-family="Poppins" font-weight="700" font-size="26" fill="#22120a">${esc(config.EVENT_TIME)}</text>

    <g fill="#1a0d05">${qrRects(qrPayload(reg.token), qrX, qrY, qrSize)}</g>
    <text x="${sx + 300}" y="641" text-anchor="middle" font-family="Poppins" font-weight="500" font-size="13" letter-spacing="2" fill="#7a5a36">PRÉSENTE CE QR CODE À L'ENTRÉE</text>

    <text x="${sx + 300}" y="692" text-anchor="middle" font-family="Poppins" font-size="15" fill="#f1dcb4">${esc(config.EVENT_ADDRESS)}</text>
  </g>
  <!-- encoches -->
  <circle cx="${sx}" cy="-2" r="22" fill="#0b0603"/>
  <circle cx="${sx}" cy="${H + 2}" r="22" fill="#0b0603"/>
</svg>`;
}

async function renderTicket(reg) {
  const svg = buildSvg(reg);
  const resvg = new Resvg(svg, {
    background: '#0b0603',
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Poppins' },
    fitTo: { mode: 'original' },
  });
  const png = resvg.render().asPng();
  return sharp(png).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}

module.exports = { renderTicket, qrPayload };
