import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { appHomeUrl, contactFileName, normalizeProfile, vcard } from '../src/lib.js';
import { requestOrigin } from './wallet.js';

const PHOTO_EDGE = 480;

export function contactIdFromRequest(req) {
  const queryId = String(req.query?.id || '').replace(/\.vcf$/i, '');
  if (/^[0-9a-f-]{36}$/i.test(queryId)) return queryId;
  const path = String(req.url || '').split('?')[0];
  return path.match(/\/(?:api\/contact|c)\/([0-9a-f-]{36})(?:\.vcf|\/contact\.vcf)?\/?$/i)?.[1] || '';
}

export async function profilePhoto(bytes) {
  if (!bytes?.length) return null;
  try {
    const jpeg = await sharp(bytes, { failOn: 'none' })
      .rotate()
      .resize(PHOTO_EDGE, PHOTO_EDGE, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    if (!jpeg.length || jpeg.length > 200000) return null;
    return { type: 'JPEG', base64: jpeg.toString('base64') };
  } catch {
    return null;
  }
}

function text(status, body) {
  return {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    body,
  };
}

function unwrapCard(loaded) {
  if (loaded && Object.prototype.hasOwnProperty.call(loaded, 'card')) return { card: loaded.card, photo: loaded.photo || null };
  return { card: loaded, photo: null };
}

export async function loadContactCard(env, id) {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('supabase');
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.from('cards').select('id,profile,published,avatar_path').eq('id', id).eq('published', true).maybeSingle();
  if (error) throw error;
  if (!data?.avatar_path) return { card: data, photo: null };
  const file = await supabase.storage.from('card-images').download(data.avatar_path);
  if (file.error || !file.data) return { card: data, photo: null };
  const bytes = Buffer.from(await file.data.arrayBuffer());
  return { card: data, photo: await profilePhoto(bytes) };
}

export async function contactHttpResult({ id, origin, loadCard }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return text(404, 'Cette carte n’est pas disponible.');
  let loaded;
  try {
    loaded = await loadCard(id);
  } catch {
    return text(500, 'Le contact n’a pas pu être préparé.');
  }
  const { card, photo } = unwrapCard(loaded);
  if (!card?.published || card.id !== id) return text(404, 'Cette carte n’est pas disponible.');
  const profile = normalizeProfile(card.profile);
  const filename = contactFileName(profile);
  return {
    status: 200,
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
    body: vcard(profile, appHomeUrl(origin), photo),
  };
}

export async function handleContact(req, res, env) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end();
    return;
  }
  const result = await contactHttpResult({
    id: contactIdFromRequest(req),
    origin: requestOrigin(req.headers || {}, env.VITE_PUBLIC_APP_URL),
    loadCard: (id) => loadContactCard(env, id),
  });
  res.statusCode = result.status;
  for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
  res.end(req.method === 'HEAD' ? undefined : result.body);
}
