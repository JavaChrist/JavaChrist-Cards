import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { cardUrl, publicOriginFrom } from '../src/lib.js';
import { buildWalletPass } from '../src/wallet.js';
import { walletImages } from './icon-png.js';

export const WALLET_INACTIVE = 'L’ajout à Apple Wallet n’est pas encore activé sur ce site.';
export const WALLET_UNAVAILABLE = 'Cette carte n’est pas disponible.';
export const WALLET_FAILED = 'Le pass n’a pas pu être préparé. Réessayez.';

const certDir = join(dirname(fileURLToPath(import.meta.url)), 'certs');

function decodePem(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('BEGIN')) return raw.replace(/\\n/g, '\n');
  const text = Buffer.from(raw, 'base64').toString('utf8');
  return text.includes('BEGIN') ? text : '';
}

export function readWalletCredentials(env) {
  const passTypeIdentifier = String(env.APPLE_PASS_TYPE_ID || '').trim();
  const teamIdentifier = String(env.APPLE_TEAM_ID || '').trim();
  const signerCert = decodePem(env.APPLE_PASS_CERT_PEM);
  const signerKey = decodePem(env.APPLE_PASS_KEY_PEM);
  if (!/^pass\.[A-Za-z0-9.]+$/.test(passTypeIdentifier)) return null;
  if (!/^[A-Z0-9]{10}$/.test(teamIdentifier)) return null;
  if (!signerCert || !signerKey) return null;
  return {
    passTypeIdentifier,
    teamIdentifier,
    signerCert,
    signerKey,
    signerKeyPassphrase: String(env.APPLE_PASS_KEY_PASSPHRASE || ''),
    wwdrOverride: decodePem(env.APPLE_WWDR_PEM),
  };
}

function wwdrPem(credentials) {
  if (credentials.wwdrOverride) return credentials.wwdrOverride;
  let generation = '4';
  try {
    generation = /OU=G(\d+)/.exec(new X509Certificate(credentials.signerCert).issuer)?.[1] || '4';
  } catch { /* Le certificat de signature sera rejeté plus loin. */ }
  const name = generation === '6' ? 'AppleWWDRCAG6.pem' : 'AppleWWDRCAG4.pem';
  return readFileSync(join(certDir, name), 'utf8');
}

export async function signWalletPass(model, credentials) {
  const { PKPass } = await import('passkit-generator');
  const pass = new PKPass({
    'pass.json': Buffer.from(JSON.stringify(model)),
    ...walletImages(),
  }, {
    wwdr: wwdrPem(credentials),
    signerCert: credentials.signerCert,
    signerKey: credentials.signerKey,
    signerKeyPassphrase: credentials.signerKeyPassphrase,
  });
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
  const credentials = readWalletCredentials(env);
  if (!credentials) return json(503, WALLET_INACTIVE);
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
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.apple.pkpass',
        'Content-Disposition': 'attachment; filename="carte.pkpass"',
        'Cache-Control': 'no-store',
      },
      body,
    };
  } catch {
    return json(500, WALLET_FAILED);
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
