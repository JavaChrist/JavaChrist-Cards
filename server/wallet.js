import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPrivateKey, X509Certificate } from 'node:crypto';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import { cardUrl, publicOriginFrom } from '../src/lib.js';
import { buildWalletPass } from '../src/wallet.js';
import { walletImages } from './icon-png.js';

export const WALLET_INACTIVE = 'L’ajout à Apple Wallet n’est pas encore activé sur ce site.';
export const WALLET_UNAVAILABLE = 'Cette carte n’est pas disponible.';
export const WALLET_FAILED = 'Le pass n’a pas pu être préparé. Réessayez.';

const require = createRequire(import.meta.url);
const forge = require('node-forge');

export const WALLET_CERT_EMPTY = 'Le certificat du pass est absent.';
export const WALLET_CERT_HEADER = 'Le certificat du pass reçu n’a pas d’en-tête PEM.';
export const WALLET_CERT_UNCLOSED = 'L’en-tête PEM du certificat est présent, mais le bloc n’est pas fermé par END.';
export const WALLET_CERT_IS_KEY = 'La variable du certificat contient une clé privée, pas un certificat X.509.';
export const WALLET_NO_CERT = 'Aucun certificat X.509 n’a été trouvé : la variable certificat contient une clé privée, et la variable clé n’en contient pas non plus.';
export const WALLET_CERT_BODY = 'L’en-tête du certificat est présent, mais son corps n’est pas un certificat X.509 valide.';
export const WALLET_KEY_DECRYPT = 'La clé privée n’a pas pu être déchiffrée. Le mot de passe ne correspond pas à cette clé.';
export const WALLET_KEY_UNREADABLE = 'La clé privée est illisible. Collez le PEM, avec BEGIN PRIVATE KEY ou BEGIN ENCRYPTED PRIVATE KEY.';
export const WALLET_KEY_MISMATCH = 'La clé privée ne correspond pas au certificat du pass.';
export const WALLET_PASS_MISMATCH = 'L’identifiant du pass ne correspond pas à celui inscrit dans le certificat.';
export const WALLET_WWDR_MISSING = 'Le certificat intermédiaire Apple est introuvable sur le serveur.';
export const WALLET_WWDR_BAD = 'Le certificat intermédiaire WWDR est illisible.';
export const WALLET_SIGN_FAILED = 'La signature du pass a échoué.';

function unwrap(value) {
  let raw = String(value || '').trim().replace(/^\uFEFF/, '');
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) raw = raw.slice(1, -1).trim();
  return raw.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function asBuffer(raw) {
  const compact = raw.replace(/\s/g, '');
  if (compact.length < 16 || !/^[A-Za-z0-9+/=]+$/.test(compact)) return null;
  const buf = Buffer.from(compact, 'base64');
  return buf.length ? buf : null;
}

function pemCertFromDer(buf) {
  try {
    const pem = new X509Certificate(buf).toString();
    return pem.includes('BEGIN CERTIFICATE') ? pem : '';
  } catch {
    return '';
  }
}

function pemKeyFromDer(buf, passphrase) {
  for (const type of ['pkcs8', 'pkcs1', 'sec1']) {
    try {
      const key = createPrivateKey({ key: buf, format: 'der', type, passphrase: passphrase || undefined });
      return key.export({ type: 'pkcs8', format: 'pem' });
    } catch { /* autre format de clé */ }
  }
  return '';
}

function fromP12(buf, passphrase) {
  try {
    const asn1 = forge.asn1.fromDer(buf.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase || '');
    const keyBag = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]
      || p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
    const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]?.[0];
    return {
      key: keyBag?.key ? forge.pki.privateKeyToPem(keyBag.key) : '',
      cert: certBag?.cert ? forge.pki.certificateToPem(certBag.cert) : '',
    };
  } catch {
    return { key: '', cert: '' };
  }
}

function reflowPem(raw) {
  return raw.replace(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g, (_, label, body) => {
    const b64 = body.replace(/[^A-Za-z0-9+/=]/g, '');
    const lines = b64.match(/.{1,64}/g) || [];
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
  });
}

function pemText(value) {
  const raw = unwrap(value);
  if (!raw) return '';
  if (raw.includes('-----BEGIN')) return reflowPem(raw);
  const buf = asBuffer(raw);
  if (!buf) return '';
  const text = buf.toString('utf8');
  if (text.includes('-----BEGIN')) return reflowPem(unwrap(text));
  return pemCertFromDer(buf) || pemKeyFromDer(buf, '') || '';
}

function pemBlocks(pem) {
  const blocks = [];
  const re = /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g;
  for (const match of pem.matchAll(re)) blocks.push({ type: match[1], pem: `${match[0].trim()}\n` });
  return blocks;
}

function certificateBlocks(pem) {
  return pemBlocks(pem).filter((block) => block.type === 'CERTIFICATE' || block.type === 'X509 CERTIFICATE' || block.type === 'TRUSTED CERTIFICATE');
}

function keyBlock(pem) {
  return pemBlocks(pem).find((block) => block.type === 'ENCRYPTED PRIVATE KEY' || block.type === 'PRIVATE KEY' || block.type === 'RSA PRIVATE KEY' || block.type === 'EC PRIVATE KEY') || null;
}

function unlockKey(pem, passphrase) {
  const encrypted = pem.includes('ENCRYPTED');
  try {
    const key = encrypted ? createPrivateKey({ key: pem, passphrase }) : createPrivateKey(pem);
    const exported = key.asymmetricKeyType === 'rsa'
      ? key.export({ type: 'pkcs1', format: 'pem' })
      : key.export({ type: 'pkcs8', format: 'pem' });
    return { pem: exported, key, encrypted };
  } catch {
    return { pem: '', key: null, encrypted };
  }
}

export function normalizePassTypeId(value) {
  let id = unwrap(value).replace(/\s+/g, '');
  id = id.replace(/^passtypeid[:=]/i, '').replace(/^pass-type-id[:=]/i, '');
  if (!id) return '';
  if (!/^pass\./i.test(id)) id = `pass.${id}`;
  return /^pass\.[A-Za-z0-9.-]+$/i.test(id) ? id : '';
}

export function normalizeTeamId(value) {
  let id = unwrap(value).toUpperCase().replace(/^TEAM\s*ID\s*[:=]\s*/, '');
  id = id.replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{10}$/.test(id) ? id : '';
}

function parsedCertificates(pem) {
  return certificateBlocks(pem).map((block) => {
    try { return new X509Certificate(block.pem); } catch { return null; }
  }).filter(Boolean);
}

function certFromValue(value) {
  const raw = unwrap(value);
  if (!raw) return { error: WALLET_CERT_EMPTY };
  const direct = parsedCertificates(raw);
  if (direct.length) return { certificates: direct };
  const text = pemText(value);
  const parsed = parsedCertificates(text);
  if (parsed.length) return { certificates: parsed };
  const buf = asBuffer(raw);
  const der = buf ? pemCertFromDer(buf) : '';
  if (der) {
    try { return { certificates: [new X509Certificate(der)] }; } catch { /* corps DER illisible */ }
  }
  const kinds = pemBlocks(text || raw).map((block) => block.type);
  const visible = `${raw}\n${text}`;
  if (kinds.some((type) => type.includes('PRIVATE KEY'))) return { error: WALLET_CERT_IS_KEY };
  if (visible.includes('-----BEGIN') && !visible.includes('-----END')) return { error: WALLET_CERT_UNCLOSED };
  if (visible.includes('-----BEGIN')) return { error: WALLET_CERT_BODY };
  return { error: WALLET_CERT_HEADER };
}

function passTypeInCertificate(certificate) {
  const subject = String(certificate.subject || '');
  return subject.match(/(?:^|\n)UID=([^\n]+)/)?.[1]?.trim()
    || subject.match(/CN=Pass Type ID:\s*([^\n]+)/)?.[1]?.trim()
    || '';
}

export function readWalletCredentials(env) {
  const source = env || {};
  const present = ['APPLE_PASS_TYPE_ID', 'APPLE_TEAM_ID', 'APPLE_PASS_CERT_PEM', 'APPLE_PASS_KEY_PEM'].some((key) => unwrap(source[key]));
  const passTypeIdentifier = normalizePassTypeId(source.APPLE_PASS_TYPE_ID);
  const teamIdentifier = normalizeTeamId(source.APPLE_TEAM_ID);
  const passphrase = unwrap(source.APPLE_PASS_KEY_PASSPHRASE);
  if (!present) return { error: WALLET_INACTIVE };
  if (!passTypeIdentifier) return { error: 'L’identifiant du pass Apple est absent ou invalide. Il doit ressembler à pass.fr.javachrist.cards.' };
  if (!teamIdentifier) return { error: 'Le Team ID Apple doit contenir exactement 10 lettres ou chiffres.' };
  let certResult = certFromValue(source.APPLE_PASS_CERT_PEM);
  let keyValue = source.APPLE_PASS_KEY_PEM;
  if (certResult.error === WALLET_CERT_IS_KEY) {
    const swapped = certFromValue(source.APPLE_PASS_KEY_PEM);
    if (!swapped.error) {
      certResult = swapped;
      keyValue = source.APPLE_PASS_CERT_PEM;
    } else if (swapped.error === WALLET_CERT_IS_KEY) return { error: 'Les deux variables PEM reçues sont des clés privées. Aucun certificat X.509 n’est présent.' };
    else if (swapped.error === WALLET_CERT_EMPTY) return { error: 'La variable du certificat contient une clé privée, et la variable de clé est vide.' };
    else if (swapped.error === WALLET_CERT_HEADER) return { error: 'La variable du certificat contient une clé privée, et la variable de clé n’a pas d’en-tête PEM.' };
    else if (swapped.error === WALLET_CERT_UNCLOSED) return { error: 'La variable du certificat contient une clé privée, et le PEM de l’autre variable n’est pas fermé.' };
    else if (swapped.error === WALLET_CERT_BODY) return { error: 'La variable du certificat contient une clé privée, et le PEM de l’autre variable n’est pas un certificat X.509.' };
    else return { error: WALLET_NO_CERT };
  }
  if (certResult.error) return certResult;
  const keyPem = pemText(keyValue);
  const keyInfo = keyBlock(keyPem);
  const p12 = !keyInfo ? fromP12(asBuffer(unwrap(source.APPLE_PASS_KEY_PEM)) || Buffer.alloc(0), passphrase) : { key: '', cert: '' };
  const lockedPem = keyInfo?.pem || p12.key;
  if (!lockedPem) return { error: WALLET_KEY_UNREADABLE };
  const unlocked = unlockKey(lockedPem, passphrase);
  if (!unlocked.key) return { error: unlocked.encrypted || keyInfo?.type === 'ENCRYPTED PRIVATE KEY' ? WALLET_KEY_DECRYPT : WALLET_KEY_UNREADABLE };
  const matched = certResult.certificates.find((certificate) => {
    try { return certificate.checkPrivateKey(unlocked.key); } catch { return false; }
  });
  if (!matched) return { error: WALLET_KEY_MISMATCH };
  const certifiedPassType = passTypeInCertificate(matched);
  if (certifiedPassType && certifiedPassType !== passTypeIdentifier) return { error: WALLET_PASS_MISMATCH };
  const wwdrText = pemText(source.APPLE_WWDR_PEM);
  return {
    passTypeIdentifier,
    teamIdentifier,
    signerCert: matched.toString(),
    signerKey: unlocked.pem,
    signerKeyPassphrase: '',
    wwdrOverride: certificateBlocks(wwdrText)[0]?.pem || '',
  };
}

function wwdrPem(credentials) {
  if (credentials.wwdrOverride) {
    try { return new X509Certificate(credentials.wwdrOverride).toString(); } catch { const error = new Error('wwdr'); error.code = 'WWDR_BAD'; throw error; }
  }
  let generation = '4';
  try {
    generation = /OU=G(\d+)/.exec(new X509Certificate(credentials.signerCert).issuer)?.[1] || '4';
  } catch { /* L’émetteur sert seulement à choisir G4 ou G6. */ }
  const name = generation === '6' ? 'AppleWWDRCAG6.pem' : 'AppleWWDRCAG4.pem';
  const locations = [new URL(`./certs/${name}`, import.meta.url), join(process.cwd(), 'server', 'certs', name)];
  let missing = false;
  for (const location of locations) {
    try { return new X509Certificate(readFileSync(location)).toString(); } catch (error) { missing = missing || error?.code === 'ENOENT'; }
  }
  const wrapped = new Error('wwdr');
  wrapped.code = missing ? 'WWDR_MISSING' : 'WWDR_BAD';
  throw wrapped;
}

export async function signWalletPass(model, credentials) {
  const { PKPass } = await import('passkit-generator');
  const certificates = {
    wwdr: wwdrPem(credentials),
    signerCert: credentials.signerCert,
    signerKey: credentials.signerKey,
  };
  if (credentials.signerKeyPassphrase) certificates.signerKeyPassphrase = credentials.signerKeyPassphrase;
  const pass = new PKPass({
    'pass.json': Buffer.from(JSON.stringify(model)),
    ...walletImages(),
  }, certificates);
  return pass.getAsBuffer();
}

export async function loadPublishedCard(env, id) {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('supabase');
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.from('cards').select('id,profile,published').eq('id', id).eq('published', true).maybeSingle();
  if (error) throw error;
  return data;
}

function json(status, error) {
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ error }),
  };
}

export function requestOrigin(headers = {}, configured) {
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  const proto = String(headers['x-forwarded-proto'] || 'https').split(',')[0].trim() === 'http' ? 'http' : 'https';
  const fallback = host ? `${proto}://${host}` : 'http://localhost';
  return publicOriginFrom(configured, publicOriginFrom(fallback, 'http://localhost'));
}

export function walletIdFromRequest(req) {
  const queryId = req.query?.id;
  if (typeof queryId === 'string' && /^[0-9a-f-]{36}$/i.test(queryId)) return queryId;
  const path = String(req.url || '').split('?')[0];
  return path.match(/\/api\/wallet\/([0-9a-f-]{36})\/?$/i)?.[1] || '';
}

export async function walletHttpResult({ id, env, origin, loadCard, sign }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return json(404, WALLET_UNAVAILABLE);
  const parsed = readWalletCredentials(env);
  if (parsed.error) return json(503, parsed.error);
  const credentials = parsed;
  let card;
  try {
    card = await loadCard(id);
  } catch {
    return json(500, WALLET_FAILED);
  }
  if (!card?.published || card.id !== id) return json(404, WALLET_UNAVAILABLE);
  try {
    const model = buildWalletPass(card.profile, {
      id: card.id,
      url: cardUrl(card.id, origin),
      passTypeIdentifier: credentials.passTypeIdentifier,
      teamIdentifier: credentials.teamIdentifier,
    });
    const body = await sign(model, credentials);
    if (!body?.length) return json(500, WALLET_FAILED);
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': 'attachment; filename="carte.pkpass"',
        'Cache-Control': 'no-store',
      },
      body,
    };
  } catch (error) {
    if (error?.code === 'WWDR_MISSING' || error?.code === 'ENOENT') return json(500, WALLET_WWDR_MISSING);
    if (error?.code === 'WWDR_BAD') return json(500, WALLET_WWDR_BAD);
    return json(500, WALLET_SIGN_FAILED);
  }
}

export async function handleWallet(req, res, env) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: WALLET_FAILED }));
    return;
  }
  const result = await walletHttpResult({
    id: walletIdFromRequest(req),
    env,
    origin: requestOrigin(req.headers, env.VITE_PUBLIC_APP_URL),
    loadCard: (id) => loadPublishedCard(env, id),
    sign: signWalletPass,
  });
  res.statusCode = result.status;
  for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
  res.end(result.body);
}
