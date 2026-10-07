import qrcode from 'qrcode-generator';
export const emptyProfile = { firstName:'',lastName:'',company:'',slogan:'',role:'',tagline:'',phone:'',email:'',street:'',postal:'',city:'',country:'France',website:'',linkedin:'',github:'',accent:'#ff941f' };
const QR_CELL = 8;
const QR_QUIET_MODULES = 4;

export function safeLink(value) { if (!value) return ''; try { const u=new URL(value); return ['https:','http:'].includes(u.protocol)?u.href:''; } catch { return ''; } }
export function telephone(value) { return String(value||'').replace(/[^+0-9*#(),; -]/g,''); }
export function emailLink(value) { return 'mailto:'+encodeURIComponent(String(value||'').replace(/[\r\n]/g,'')); }

export function publicOriginFrom(configured, fallbackOrigin) {
  const value = String(configured || '').trim();
  if (!value) return fallbackOrigin;
  try {
    const url = new URL(value);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return fallbackOrigin;
    return url.origin;
  } catch {
    return fallbackOrigin;
  }
}

export function cardUrl(id, origin) { return new URL('/c/'+encodeURIComponent(id), origin).href; }
export function appHomeUrl(origin) { return new URL('/', origin || 'https://java-christ-cards.vercel.app').href; }

function makeQr(url) {
  const qr = qrcode(0, 'M');
  qr.addData(String(url), 'Byte');
  qr.make();
  return qr;
}

export function qrSvg(url, label = 'QR code du lien public de la carte') {
  return makeQr(url).createSvgTag({
    cellSize: QR_CELL,
    margin: QR_CELL * QR_QUIET_MODULES,
    scalable: true,
    title: { text: 'QR code', id: 'qr-title' },
    alt: { text: String(label), id: 'qr-desc' },
  });
}

function qrRaster(url) {
  const qr = makeQr(url);
  const count = qr.getModuleCount();
  const margin = QR_CELL * QR_QUIET_MODULES;
  const size = count * QR_CELL + margin * 2;
  const rgba = new Uint8Array(size * size * 4);
  rgba.fill(255);
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!qr.isDark(row, col)) continue;
      for (let y = 0; y < QR_CELL; y += 1) {
        for (let x = 0; x < QR_CELL; x += 1) {
          const pixel = ((margin + row * QR_CELL + y) * size + (margin + col * QR_CELL + x)) * 4;
          rgba[pixel] = 0;
          rgba[pixel + 1] = 0;
          rgba[pixel + 2] = 0;
        }
      }
    }
  }
  return { rgba, size };
}

function concatBytes(parts) {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  return concatBytes([uint32(data.length), typeBytes, data, uint32(crc32(concatBytes([typeBytes, data])))]);
}

async function zlibDeflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function qrPngBytes(url) {
  const { rgba, size } = qrRaster(url);
  const stride = size * 4;
  const raw = new Uint8Array((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = concatBytes([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', await zlibDeflate(raw)),
    pngChunk('IEND', new Uint8Array()),
  ]);
  return png;
}

export async function qrPngBlob(url) {
  return new Blob([await qrPngBytes(url)], { type: 'image/png' });
}

export async function shareLink(url, title, nav = globalThis.navigator) {
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ title, url });
      return 'shared';
    } catch (error) {
      if (error && error.name === 'AbortError') return 'cancelled';
    }
  }
  if (!nav?.clipboard || typeof nav.clipboard.writeText !== 'function') return 'copy-failed';
  try {
    await nav.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'copy-failed';
  }
}

export function preferredInstallTab(userAgent = '', hints = {}) {
  const ua = String(userAgent);
  const platform = String(hints.platform || '');
  const touch = Number(hints.maxTouchPoints || 0);
  if (/iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && touch > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

function esc(s) { return String(s||'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,'); }
function fold(line) {
  const parts = [];
  let part = '';
  for (const c of line) {
    if (new TextEncoder().encode(part + c).length > 75) { parts.push(part); part = ' ' + c; }
    else part += c;
  }
  parts.push(part);
  return parts.join('\r\n');
}
export function contactFileName(profile) {
  const base = [profile?.firstName, profile?.lastName].filter(Boolean).join('-')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9.-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return (base || 'contact') + '.vcf';
}
export function vcard(p, url, photo) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
  lines.push(`N;CHARSET=UTF-8:${esc(p.lastName)};${esc(p.firstName)};;;`);
  lines.push(`FN;CHARSET=UTF-8:${esc(name)}`);
  if (p.company) lines.push(`ORG;CHARSET=UTF-8:${esc(p.company)}`);
  if (p.role) lines.push(`TITLE;CHARSET=UTF-8:${esc(p.role)}`);
  const phone = telephone(p.phone);
  if (phone) lines.push(`TEL;TYPE=CELL:${esc(phone)}`);
  if (p.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(p.email)}`);
  if (p.street || p.postal || p.city) lines.push(`ADR;TYPE=WORK;CHARSET=UTF-8:;;${esc(p.street)};${esc(p.city)};;${esc(p.postal)};${esc(p.country)}`);
  if (p.tagline) lines.push(`NOTE;CHARSET=UTF-8:${esc(p.tagline)}`);
  if (photo?.base64 && /^(JPEG|PNG)$/.test(photo.type)) lines.push(`PHOTO;ENCODING=b;TYPE=${photo.type}:${photo.base64}`);
  for (const link of [p.website, p.linkedin, p.github]) if (safeLink(link)) lines.push('URL:' + esc(safeLink(link)));
  if (url) lines.push('URL:' + esc(url));
  lines.push('END:VCARD');
  return lines.map(fold).join('\r\n') + '\r\n';
}
export function saveFile(data,name,type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function validateProfile(p) { if(!p.firstName.trim()||!p.lastName.trim())return 'Renseignez votre prénom et votre nom.'; for(const key of ['website','linkedin','github']) if(p[key]&&!safeLink(p[key]))return 'Les liens doivent commencer par https:// ou http://.';if(p.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email))return 'Vérifiez l’adresse e-mail de la carte.';return ''; }
export function normalizeProfile(value) { const p={...emptyProfile};for(const key of Object.keys(p))if(typeof value?.[key]==='string')p[key]=value[key].slice(0,1000);if(!/^#[0-9a-f]{6}$/i.test(p.accent))p.accent=emptyProfile.accent;return p; }
