import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrivateKey, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { createRequire } from 'node:module';
import { cardUrl } from '../src/lib.js';
import { buildWalletPass } from '../src/wallet.js';
import { iconPng } from '../server/icon-png.js';
import { WALLET_CERT_BODY, WALLET_CERT_HEADER, WALLET_CERT_IS_KEY, WALLET_CERT_UNCLOSED, WALLET_INACTIVE, WALLET_KEY_DECRYPT, WALLET_KEY_MISMATCH, WALLET_UNAVAILABLE, normalizePassTypeId, normalizeTeamId, readWalletCredentials, signWalletPass, walletHttpResult } from '../server/wallet.js';

const require = createRequire(import.meta.url);
const forge = require('node-forge');

const CARD = '1944ffb8-5cf5-45b9-94fa-340adf41698f';
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ORIGIN = 'https://java-christ-cards.vercel.app';
const PASSPHRASE = 'phrase-de-test';

function testIdentity() {
  const pair = forge.pki.rsa.generateKeyPair(2048);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = pair.publicKey;
  certificate.serialNumber = '01';
  certificate.validity.notBefore = new Date();
  certificate.validity.notAfter = new Date(Date.now() + 86400000);
  const attrs = [{ name: 'commonName', value: 'JavaChrist Cards test' }, { name: 'organizationName', value: 'JavaChrist' }];
  certificate.setSubject(attrs);
  certificate.setIssuer(attrs);
  certificate.sign(pair.privateKey, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(certificate);
  const encryptedKey = createPrivateKey(forge.pki.privateKeyToPem(pair.privateKey)).export({
    type: 'pkcs8',
    format: 'pem',
    cipher: 'aes-256-cbc',
    passphrase: PASSPHRASE,
  });
  return { certPem, encryptedKey, otherKey: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

function envFrom(identity, certPem = identity.certPem, keyPem = identity.encryptedKey) {
  return {
    APPLE_PASS_TYPE_ID: 'pass.pass.fr.javachrist.cards',
    APPLE_TEAM_ID: 'RLPT43Z689',
    APPLE_PASS_CERT_PEM: certPem,
    APPLE_PASS_KEY_PEM: keyPem,
    APPLE_PASS_KEY_PASSPHRASE: PASSPHRASE,
  };
}

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
  }, { id: CARD, url, passTypeIdentifier: 'pass.fr.javachrist.cards', teamIdentifier: 'AB12CD34EF' });
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

test('wallet identifiers accept Apple’s usual spelling', () => {
  assert.equal(normalizePassTypeId('pass.fr.java-christ.cards'), 'pass.fr.java-christ.cards');
  assert.equal(normalizePassTypeId('pass.pass.fr.javachrist.cards'), 'pass.pass.fr.javachrist.cards');
  assert.equal(normalizeTeamId('rlpt43z689'), 'RLPT43Z689');
  assert.equal(normalizeTeamId('ab12cd34ef'), 'AB12CD34EF');
});

test('a raw encrypted PEM is accepted without base64-decoding the certificate', async () => {
  const identity = testIdentity();
  assert.match(identity.encryptedKey, /BEGIN ENCRYPTED PRIVATE KEY/);
  const body = identity.certPem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const crlf = identity.certPem.replace(/\n/g, '\r\n');
  const literal = identity.certPem.trim().replace(/\n/g, '\\n');
  for (const certPem of [identity.certPem, crlf, literal]) {
    const parsed = readWalletCredentials(envFrom(identity, certPem));
    assert.equal(parsed.error, undefined);
    assert.equal(parsed.signerCert.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), body);
    assert.equal(parsed.signerKey.includes('BEGIN RSA PRIVATE KEY'), true);
    assert.equal(parsed.signerKey.includes('ENCRYPTED'), false);
    assert.equal(parsed.passTypeIdentifier, 'pass.pass.fr.javachrist.cards');
  }
  const signed = await signWalletPass(buildWalletPass({ firstName: 'Ada', lastName: 'Lovelace' }, {
    id: CARD,
    url: cardUrl(CARD, ORIGIN),
    passTypeIdentifier: 'pass.pass.fr.javachrist.cards',
    teamIdentifier: 'RLPT43Z689',
  }), readWalletCredentials(envFrom(identity)));
  assert.equal(signed[0], 0x50);
  assert.equal(signed[1], 0x4b);
  const wrong = readWalletCredentials({ ...envFrom(identity), APPLE_PASS_KEY_PASSPHRASE: 'mauvais-mot-de-passe' });
  assert.equal(wrong.error, WALLET_KEY_DECRYPT);
  const mismatch = readWalletCredentials(envFrom(identity, identity.certPem, identity.otherKey));
  assert.equal(mismatch.error, WALLET_KEY_MISMATCH);
  assert.equal(readWalletCredentials({ ...envFrom(identity), APPLE_PASS_CERT_PEM: 'pas-un-certificat' }).error, WALLET_CERT_HEADER);
  assert.equal(readWalletCredentials({ ...envFrom(identity), APPLE_PASS_CERT_PEM: '-----BEGIN CERTIFICATE-----' }).error, WALLET_CERT_UNCLOSED);
  assert.equal(readWalletCredentials({ ...envFrom(identity), APPLE_PASS_CERT_PEM: identity.encryptedKey, APPLE_PASS_KEY_PEM: 'pas-une-cle' }).error, 'La variable du certificat contient une clé privée, et la variable de clé n’a pas d’en-tête PEM.');
  assert.equal(readWalletCredentials({ ...envFrom(identity), APPLE_PASS_CERT_PEM: identity.encryptedKey, APPLE_PASS_KEY_PEM: identity.otherKey }).error, 'Les deux variables PEM reçues sont des clés privées. Aucun certificat X.509 n’est présent.');
  const certBase64 = Buffer.from(identity.certPem, 'utf8').toString('base64');
  const keyBase64 = Buffer.from(identity.encryptedKey, 'utf8').toString('base64');
  assert.equal(readWalletCredentials({ ...envFrom(identity), APPLE_PASS_CERT_PEM: identity.encryptedKey, APPLE_PASS_KEY_PEM: certBase64 }).error, undefined);
  assert.equal(readWalletCredentials({ ...envFrom(identity), APPLE_PASS_CERT_PEM: identity.encryptedKey, APPLE_PASS_KEY_PEM: keyBase64 }).error, 'Les deux variables PEM reçues sont des clés privées. Aucun certificat X.509 n’est présent.');
  const swapped = readWalletCredentials({ ...envFrom(identity), APPLE_PASS_CERT_PEM: identity.encryptedKey, APPLE_PASS_KEY_PEM: identity.certPem });
  assert.equal(swapped.error, undefined);
  assert.equal(swapped.signerCert.includes('BEGIN CERTIFICATE'), true);
  const brokenCert = identity.certPem.replace(/(-----BEGIN CERTIFICATE-----[\s\S]*?)[A-Za-z0-9+/]{12}/, '$1AAAAAAAAAAAA');
  assert.equal(readWalletCredentials({ ...envFrom(identity), APPLE_PASS_CERT_PEM: brokenCert }).error, WALLET_CERT_BODY);
  assert.equal(new X509Certificate(identity.certPem).subject.includes('JavaChrist'), true);
});

test('wallet signing stays inactive until the Apple certificate is configured', async () => {
  assert.equal(readWalletCredentials({}).error, WALLET_INACTIVE);
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
    env: envFrom(testIdentity()),
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
    env: envFrom(testIdentity()),
    origin: ORIGIN,
    loadCard: async (id) => ({ id, published: true, profile: { firstName: 'Ada', lastName: 'Lovelace', company: 'JavaChrist' } }),
    sign: async (pass) => { model = pass; return Buffer.from('signed'); },
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers['Content-Type'], 'application/vnd.apple.pkpass');
  assert.equal(model.barcodes[0].message, cardUrl(CARD, ORIGIN));
  assert.equal(model.passTypeIdentifier, 'pass.pass.fr.javachrist.cards');
});

test('wallet icons are real PNG files at the sizes Apple expects', () => {
  const png = iconPng(29);
  assert.equal(png[0], 137);
  assert.equal(png.readUInt32BE(16), 29);
  assert.equal(png.readUInt32BE(20), 29);
});
