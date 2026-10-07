import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { cardUrl, publicOriginFrom, qrSvg, qrPngBytes, shareLink, preferredInstallTab } from '../src/lib.js';
import { launchPathForManifest, manifestPathForLocation } from '../src/manifest.js';

const require = createRequire(import.meta.url);
const jsQR = require('jsqr');
const CARD = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'https://cards.example';

function decodePng(bytes) {
  assert.equal(Buffer.from(bytes.slice(0, 8)).toString('hex'), '89504e470d0a1a0a');
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.equal(data[9], 6);
    } else if (type === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  const inflated = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8ClampedArray(width * height * 4);
  const stride = width * 4;
  for (let y = 0; y < height; y += 1) {
    assert.equal(inflated[y * (stride + 1)], 0);
    rgba.set(inflated.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride), y * stride);
  }
  return { width, height, rgba };
}

test('public origin falls back unless the configured URL is a valid http(s) origin', () => {
  const fallback = 'http://localhost:5173';
  assert.equal(publicOriginFrom('', fallback), fallback);
  assert.equal(publicOriginFrom('   ', fallback), fallback);
  assert.equal(publicOriginFrom('pas une adresse', fallback), fallback);
  assert.equal(publicOriginFrom('javascript:alert(1)', fallback), fallback);
  assert.equal(publicOriginFrom('ftp://fichiers.example', fallback), fallback);
  assert.equal(publicOriginFrom('https://user:secret@cards.example', fallback), fallback);
  assert.equal(publicOriginFrom('https://cards.example/chemin/ignore', fallback), 'https://cards.example');
  assert.equal(publicOriginFrom('http://localhost:5173/', fallback), 'http://localhost:5173');
});

test('the public card link depends on the id, not on the contact details', () => {
  const first = cardUrl(CARD, publicOriginFrom('https://cards.example/app', 'http://127.0.0.1'));
  const second = cardUrl(CARD, ORIGIN);
  assert.equal(first, `${ORIGIN}/c/${CARD}`);
  assert.equal(second, first);
  assert.notEqual(cardUrl(OTHER, ORIGIN), first);
  assert.equal(cardUrl('a/b', ORIGIN), `${ORIGIN}/c/a%2Fb`);
});

test('QR exports encode the card URL locally, in black on white, with a quiet zone', async () => {
  const url = cardUrl(CARD, ORIGIN);
  const svg = qrSvg(url, 'QR code vers la carte de Ada Lovelace');
  assert.match(svg, /role="img"/);
  assert.match(svg, /<title id="qr-title">QR code<\/title>/);
  assert.match(svg, /fill="white"/);
  assert.match(svg, /fill="black"/);
  assert.equal(svg.includes('<script'), false);
  assert.equal(svg.includes('<image'), false);
  assert.equal(svg.includes(url), false);
  const viewBox = svg.match(/viewBox="0 0 (\d+) \1"/);
  assert.ok(viewBox);
  const size = Number(viewBox[1]);
  const cells = [...svg.matchAll(/M(\d+),(\d+)l8,0/g)];
  assert.ok(cells.length > 20);
  assert.ok(cells.every((cell) => Number(cell[1]) >= 32 && Number(cell[2]) >= 32));
  assert.ok(cells.every((cell) => Number(cell[1]) <= size - 40 && Number(cell[2]) <= size - 40));

  const png = decodePng(Buffer.from(await qrPngBytes(url)));
  assert.equal(png.width, size);
  assert.equal(png.rgba[0], 255);
  assert.equal(png.rgba[1], 255);
  assert.equal(png.rgba[2], 255);
  const decoded = jsQR(png.rgba, png.width, png.height);
  assert.equal(decoded?.data, url);
  assert.notEqual(decoded.data, ORIGIN);
  assert.notEqual(decoded.data, `${ORIGIN}/`);
  assert.notEqual(decoded.data, `${ORIGIN}/app`);

  const otherPng = decodePng(Buffer.from(await qrPngBytes(cardUrl(OTHER, ORIGIN))));
  const other = jsQR(otherPng.rgba, otherPng.width, otherPng.height);
  assert.equal(other?.data, cardUrl(OTHER, ORIGIN));
});

test('sharing copies the link, and a cancelled share is not an error', async () => {
  let copied = '';
  const nav = {
    share: async () => { throw Object.assign(new Error('annulé'), { name: 'AbortError' }); },
    clipboard: { writeText: async (value) => { copied = value; } },
  };
  assert.equal(await shareLink('https://cards.example/c/a', 'Ada', nav), 'cancelled');
  assert.equal(copied, '');
  nav.share = async () => {};
  assert.equal(await shareLink('https://cards.example/c/a', 'Ada', nav), 'shared');
  assert.equal(copied, '');
  delete nav.share;
  assert.equal(await shareLink('https://cards.example/c/a', 'Ada', nav), 'copied');
  assert.equal(copied, 'https://cards.example/c/a');
  nav.clipboard.writeText = async () => { throw new Error('refusé'); };
  assert.equal(await shareLink('https://cards.example/c/a', 'Ada', nav), 'copy-failed');
});

test('install instructions can prefer a device without hiding the others', () => {
  assert.equal(preferredInstallTab('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'ios');
  assert.equal(preferredInstallTab('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'ios');
  assert.equal(preferredInstallTab('Mozilla/5.0', { platform: 'MacIntel', maxTouchPoints: 5 }), 'ios');
  assert.equal(preferredInstallTab('Mozilla/5.0 (Linux; Android 14)'), 'android');
  assert.equal(preferredInstallTab('Mozilla/5.0 (Windows NT 10.0)'), 'desktop');
});

test('each card manifest launches that card, and the management manifest launches /app/', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.id, './');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  const cardManifest = manifestPathForLocation(`/c/${CARD}`);
  const appManifest = manifestPathForLocation('/app');
  assert.equal(cardManifest, `/c/${CARD}/manifest.webmanifest`);
  assert.equal(manifestPathForLocation(`/c/${CARD}/`), cardManifest);
  assert.equal(appManifest, '/app/manifest.webmanifest');
  assert.equal(manifestPathForLocation('/'), appManifest);
  assert.equal(launchPathForManifest(cardManifest, manifest.start_url), `/c/${CARD}/`);
  assert.equal(launchPathForManifest(appManifest, manifest.start_url), '/app/');
  assert.notEqual(launchPathForManifest(cardManifest, manifest.start_url), '/app');
  assert.notEqual(launchPathForManifest(cardManifest, manifest.start_url), '/app/');

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  function linkedManifest(pathname) {
    let href = '';
    const document = {
      createElement() { return { rel: '', href: '' }; },
      head: { appendChild(node) { href = node.href; } },
    };
    vm.runInNewContext(source, { location: { pathname }, document });
    return href;
  }
  assert.equal(linkedManifest(`/c/${CARD}`), cardManifest);
  assert.equal(linkedManifest('/'), appManifest);
  assert.equal(linkedManifest('/app'), appManifest);
  assert.equal(html.includes('rel="manifest" href="/manifest.webmanifest"'), false);

  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const sources = vercel.rewrites.map((rule) => rule.source);
  assert.ok(sources.includes('/c/:id/manifest.webmanifest'));
  assert.ok(sources.includes('/app/manifest.webmanifest'));
  assert.ok(sources.includes('/c/:id/'));
  assert.ok(sources.includes('/app/'));
  assert.ok(sources.includes('/forgot-password'));
});
