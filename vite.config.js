import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const manifestBody = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'public/manifest.webmanifest'));

function serveScopedManifest(req, res, next) {
  const path = (req.url || '').split('?')[0];
  if (!/^\/(?:app|c\/[0-9a-f-]{36})\/manifest\.webmanifest$/i.test(path)) return next();
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.end(manifestBody);
}

function scopedManifest() {
  return {
    name: 'scoped-manifest',
    configureServer(server) { server.middlewares.use(serveScopedManifest); },
    configurePreviewServer(server) { server.middlewares.use(serveScopedManifest); },
  };
}

export default { plugins: [scopedManifest()] };
