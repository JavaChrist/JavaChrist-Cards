import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { handleContact } from './server/contact.js';
import { handleWallet, WALLET_FAILED } from './server/wallet.js';
import { versionDocument } from './src/update.js';

const appVersion = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;

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

function walletMiddleware(mode, root) {
  const fileEnv = loadEnv(mode, root, '');
  return function wallet(req, res, next) {
    const path = (req.url || '').split('?')[0];
    if (!/^\/api\/wallet\/[0-9a-f-]{36}\/?$/i.test(path)) return next();
    handleWallet(req, res, { ...fileEnv, ...process.env }).catch(() => {
      if (res.writableEnded) return;
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: WALLET_FAILED }));
    });
  };
}

function contactMiddleware(mode, root) {
  const fileEnv = loadEnv(mode, root, '');
  return function contact(req, res, next) {
    const path = (req.url || '').split('?')[0];
    if (!/^\/c\/[0-9a-f-]{36}\/contact\.vcf$/i.test(path)) return next();
    handleContact(req, res, { ...fileEnv, ...process.env }).catch(() => {
      if (res.writableEnded) return;
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Le contact n’a pas pu être préparé.');
    });
  };
}

function walletApi() {
  return {
    name: 'wallet-api',
    configureServer(server) {
      server.middlewares.use(contactMiddleware(server.config.mode, server.config.root));
      server.middlewares.use(walletMiddleware(server.config.mode, server.config.root));
    },
    configurePreviewServer(server) {
      server.middlewares.use(contactMiddleware(server.config.mode, server.config.root));
      server.middlewares.use(walletMiddleware(server.config.mode, server.config.root));
    },
  };
}

function appVersionFile() {
  return {
    name: 'app-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify(versionDocument(appVersion))}\n`,
      });
    },
  };
}

export default {
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [scopedManifest(), walletApi(), appVersionFile()],
};
