import assert from 'node:assert/strict';
import test from 'node:test';
import { cardUrl } from '../src/lib.js';
import { buildWalletPass } from '../src/wallet.js';
import { iconPng } from '../server/icon-png.js';
import { WALLET_INACTIVE, WALLET_UNAVAILABLE, readWalletCredentials, walletHttpResult } from '../server/wallet.js';

const CARD = '1944ffb8-5cf5-45b9-94fa-340adf41698f';
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ORIGIN = 'https://java-christ-cards.vercel.app';
const READY = {
  APPLE_PASS_TYPE_ID: 'pass.fr.javachrist.cards',
  APPLE_TEAM_ID: 'AB12CD34EF',
  APPLE_PASS_CERT_PEM: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
  APPLE_PASS_KEY_PEM: '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----',
};

test('the wallet pass QR is the public URL of that card', () => {
  const url = cardUrl(CARD, ORIGIN);
  const pass = buildWalletPass({
    firstName: 'Christian',
    lastName: 'Grohens',
    company: 'JavaChrist',
    role: 'Dirigeant',
    phone: '06 00\n00',
    email: 'contact@javachrist.fr',
    website: 'javascript:alert(1)',
    accent: '#ff941f',
  }, { id: CARD, url, passTypeIdentifier: READY.APPLE_PASS_TYPE_ID, teamIdentifier: READY.APPLE_TEAM_ID });
  assert.equal(pass.serialNumber, CARD);
  assert.equal(pass.barcodes[0].message, url);
  assert.equal(pass.barcodes[0].message.includes(OTHER), false);
  assert.equal(pass.barcodes[0].message.endsWith('/app'), false);
  assert.equal(pass.generic.primaryFields[0].value, 'Christian Grohens');
  assert.equal(pass.generic.auxiliaryFields[0].value, '06 00 00');
  assert.equal(pass.generic.backFields.some((item) => item.key === 'back-website'), false);
  assert.equal(pass.labelColor, 'rgb(255, 148, 31)');
  assert.equal(pass.backgroundColor, 'rgb(18, 19, 21)');
});

test('wallet signing stays inactive until the Apple certificate is configured', async () => {
  assert.equal(readWalletCredentials({}), null);
  let called = false;
  const result = await walletHttpResult({
    id: CARD,
    env: {},
    origin: ORIGIN,
    loadCard: async () => { called = true; return null; },
    sign: async () => { throw new Error('should not sign'); },
  });
  assert.equal(called, false);
  assert.equal(result.status, 503);
  assert.equal(JSON.parse(result.body).error, WALLET_INACTIVE);
});

test('an unpublished card does not produce a wallet pass', async () => {
  const result = await walletHttpResult({
    id: CARD,
    env: READY,
    origin: ORIGIN,
    loadCard: async () => null,
    sign: async () => Buffer.from('signed'),
  });
  assert.equal(result.status, 404);
  assert.equal(JSON.parse(result.body).error, WALLET_UNAVAILABLE);
});

test('a configured pass is signed for the requested card only', async () => {
  let model;
  const result = await walletHttpResult({
    id: CARD,
    env: READY,
    origin: ORIGIN,
    loadCard: async (id) => ({ id, published: true, profile: { firstName: 'Ada', lastName: 'Lovelace', company: 'JavaChrist' } }),
    sign: async (pass) => { model = pass; return Buffer.from('signed'); },
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers['Content-Type'], 'application/vnd.apple.pkpass');
  assert.equal(model.barcodes[0].message, cardUrl(CARD, ORIGIN));
  assert.equal(model.passTypeIdentifier, READY.APPLE_PASS_TYPE_ID);
});

test('wallet icons are real PNG files at the sizes Apple expects', () => {
  const png = iconPng(29);
  assert.equal(png[0], 137);
  assert.equal(png.readUInt32BE(16), 29);
  assert.equal(png.readUInt32BE(20), 29);
});
