import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {vcard,safeLink,cardUrl,appHomeUrl,contactFileName,emptyProfile,normalizeProfile,qrSvg,validateProfile} from '../src/lib.js';
import {contactHttpResult,contactIdFromRequest,profilePhoto} from '../server/contact.js';
test('public URLs retain the card identity across content changes',()=>{assert.equal(cardUrl('abc','https://cards.example.fr'), 'https://cards.example.fr/c/abc');assert.equal(cardUrl('a/b','https://cards.example.fr'), 'https://cards.example.fr/c/a%2Fb')});
test('links cannot execute scripts',()=>{for(const link of ['javascript:alert(1)','data:text/html,hello','//evil.test','file:///a'])assert.equal(safeLink(link),'');assert.equal(safeLink('https://github.com/JavaChrist'),'https://github.com/JavaChrist')});
test('vCard escapes injected lines and folds unicode by octet length',()=>{const p={...emptyProfile,firstName:'É'.repeat(80),lastName:'Test\r\nTEL:bad',company:'A;B,C\\D'};const v=vcard(p,'https://example.fr/c/id');assert.ok(v.includes('Test\\nTEL:bad'));assert.ok(v.includes('ORG;CHARSET=UTF-8:A\\;B\\,C\\\\D'));
assert.equal(v.includes('TEL;TYPE=CELL:'),false);assert.ok(!v.includes('\r\nTEL:bad'));assert.ok(v.split('\r\n').every(line=>Buffer.byteLength(line)<=75));assert.ok(v.endsWith('END:VCARD\r\n'))});
test('untrusted profile types cannot become React children or CSS',()=>{const p=normalizeProfile({firstName:{bad:'object'},accent:'red; background:url(x)',lastName:'Valid'});assert.equal(p.firstName,'');assert.equal(p.lastName,'Valid');assert.equal(p.accent,'#ff941f')});
test('required identity and malformed URLs are validated',()=>{assert.notEqual(validateProfile(emptyProfile),'');assert.equal(validateProfile({...emptyProfile,firstName:'A',lastName:'B'}),'');assert.notEqual(validateProfile({...emptyProfile,firstName:'A',lastName:'B',github:'javascript:bad'}),'')});
test('QR is a standalone vector image without a remote generator',()=>{const svg=qrSvg('https://cards.example.fr/c/a');assert.match(svg,/<svg/);assert.match(svg,/viewBox=/);assert.ok(!svg.includes('<script'));assert.ok(!svg.includes('<image'))});
test('a contact file keeps the useful fields and skips the empty ones', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const result = await contactHttpResult({
    id,
    origin: 'https://cards.example',
    loadCard: async () => ({ id, published: true, profile: { ...emptyProfile, firstName: 'Ada', lastName: 'Lovelace', role: 'Mathématicienne', phone: '06 00 00 00 00', email: 'ada@example.com', street: '1 rue Ada', postal: '75000', city: 'Paris', website: '', linkedin: 'https://www.linkedin.com/in/ada' } }),
  });
  assert.equal(result.status, 200);
  assert.match(result.headers['Content-Type'], /^text\/vcard/);
  assert.equal(result.headers['Content-Disposition'].includes(contactFileName({ firstName: 'Ada', lastName: 'Lovelace' })), true);
  assert.match(result.body, /FN;CHARSET=UTF-8:Ada Lovelace/);
  assert.match(result.body, /TEL;TYPE=CELL:06 00 00 00 00/);
  assert.equal(appHomeUrl('https://cards.example'), 'https://cards.example/');
  assert.match(result.body, /URL:https:\/\/cards\.example\//);
  assert.equal(result.body.includes('/c/11111111-1111-4111-8111-111111111111'), false);
  assert.equal(result.body.includes('PHOTO'), false);
  assert.equal(result.body.includes('URL:\r\n'), false);
  assert.equal(result.body.split('\r\n').every((line) => Buffer.byteLength(line) <= 75), true);
  assert.equal((await contactHttpResult({ id, origin: 'https://cards.example', loadCard: async () => null })).status, 404);
  assert.equal((await contactHttpResult({ id: 'nope', origin: 'https://cards.example', loadCard: async () => null })).status, 404);
  assert.equal(contactIdFromRequest({ url: `/c/${id}/contact.vcf`, query: {} }), id);
  assert.equal(contactFileName({ firstName: 'Émile', lastName: 'Dupré' }), 'Emile-Dupre.vcf');
});
test('the contact photo is the profile picture and the app link is the site home', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const png = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#ff941f' } }).png().toBuffer();
  const photo = await profilePhoto(png);
  assert.equal(photo.type, 'JPEG');
  const result = await contactHttpResult({
    id,
    origin: 'https://java-christ-cards.vercel.app',
    loadCard: async () => ({ card: { id, published: true, profile: { ...emptyProfile, firstName: 'Ada', lastName: 'Lovelace' } }, photo }),
  });
  assert.match(result.body, /URL:https:\/\/java-christ-cards\.vercel\.app\//);
  assert.equal(result.body.includes('/c/'), false);
  assert.match(result.body, /PHOTO;ENCODING=b;TYPE=JPEG:/);
  assert.equal(result.body.split('\r\n').every((line) => Buffer.byteLength(line) <= 75), true);
});
