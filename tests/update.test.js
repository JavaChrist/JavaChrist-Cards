import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  RELOAD_ATTEMPT_KEY,
  UPDATE_INTERVAL_MS,
  UPDATE_MIN_GAP_MS,
  canApplyUpdate,
  clearSucceededAttempt,
  createActivityGate,
  createVersionMonitor,
  decideUpdate,
  fetchRemoteVersion,
  parseVersionPayload,
  requestUpdate,
  shouldReload,
  shouldScheduleCheck,
  versionDocument,
} from '../src/update.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem(key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
    setItem(key, value) { data[key] = String(value); },
    removeItem(key) { delete data[key]; },
    keys() { return Object.keys(data); },
  };
}

test('an identical version does not notify', () => {
  assert.equal(decideUpdate({ current: 'build-a', remote: 'build-a', dismissed: null, dev: false }).notify, false);
});

test('a new version opens one offer until it is postponed', async () => {
  const events = [];
  let remote = 'build-a';
  const monitor = createVersionMonitor({
    current: 'build-a',
    dev: false,
    fetchVersion: async () => remote,
    now: () => 10_000,
    visible: () => true,
    onStatus: (status) => events.push(status),
    minGapMs: UPDATE_MIN_GAP_MS,
  });
  remote = 'build-b';
  await monitor.check('start');
  await monitor.check('visible');
  assert.equal(events.length, 1);
  assert.equal(events[0].open, true);
  assert.equal(events[0].remote, 'build-b');
  const storage = memoryStorage();
  const persisted = createVersionMonitor({
    current: 'build-a',
    dev: false,
    fetchVersion: async () => 'build-b',
    now: () => 20_000,
    visible: () => true,
    onStatus: (status) => events.push(status),
    storage,
    minGapMs: UPDATE_MIN_GAP_MS,
  });
  await persisted.check('start');
  persisted.postpone();
  const reloaded = [];
  const afterNavigation = createVersionMonitor({
    current: 'build-a',
    dev: false,
    fetchVersion: async () => 'build-b',
    now: () => 40_000,
    visible: () => true,
    onStatus: (status) => reloaded.push(status),
    storage,
  });
  await afterNavigation.check('start');
  assert.equal(reloaded.at(-1).open, false);
  assert.equal(reloaded.at(-1).remote, 'build-b');
  afterNavigation.reopen();
  assert.equal(reloaded.at(-1).open, true);
  const later = [];
  const nextVersion = createVersionMonitor({
    current: 'build-a',
    dev: false,
    fetchVersion: async () => 'build-c',
    now: () => 60_000,
    visible: () => true,
    onStatus: (status) => later.push(status),
    storage,
  });
  await nextVersion.check('start');
  assert.equal(later.at(-1).open, true);
  assert.equal(later.at(-1).remote, 'build-c');
});

test('development, network failure and invalid payloads are not updates', async () => {
  assert.equal(decideUpdate({ current: 'build-a', remote: 'build-b', dismissed: null, dev: true }).notify, false);
  assert.equal(parseVersionPayload(null), null);
  assert.equal(parseVersionPayload('build-a'), null);
  assert.equal(parseVersionPayload({ version: '' }), null);
  assert.equal(parseVersionPayload({ version: 'build-a', email: 'ada@example.com' }), 'build-a');
  assert.deepEqual(Object.keys(versionDocument('build-a')), ['version']);
  const unavailable = await fetchRemoteVersion(async () => { throw new Error('offline'); }).catch(() => null);
  assert.equal(unavailable, null);
  const invalid = await fetchRemoteVersion(async () => ({ ok: true, json: async () => ({ version: '<script>' }) }));
  assert.equal(invalid, null);
  const missing = await fetchRemoteVersion(async () => ({ ok: false, json: async () => ({ version: 'build-b' }) }));
  assert.equal(missing, null);
  const events = [];
  const monitor = createVersionMonitor({
    current: 'build-a',
    dev: false,
    fetchVersion: async () => { throw new Error('offline'); },
    now: () => 10_000,
    visible: () => true,
    onStatus: (status) => events.push(status),
  });
  await monitor.check('start');
  assert.equal(events.length, 0);
});

test('checks wait for a free visible window', () => {
  assert.equal(UPDATE_INTERVAL_MS, 300000);
  assert.equal(shouldScheduleCheck({ visible: false, pending: false, lastAt: 0, now: 10, minGap: UPDATE_MIN_GAP_MS, reason: 'visible' }), false);
  assert.equal(shouldScheduleCheck({ visible: true, pending: true, lastAt: 0, now: 10, minGap: UPDATE_MIN_GAP_MS, reason: 'start' }), false);
  assert.equal(shouldScheduleCheck({ visible: true, pending: false, lastAt: 0, now: 10, minGap: UPDATE_MIN_GAP_MS, reason: 'start' }), true);
  assert.equal(shouldScheduleCheck({ visible: true, pending: false, lastAt: 10_000, now: 12_000, minGap: UPDATE_MIN_GAP_MS, reason: 'visible' }), false);
  assert.equal(shouldScheduleCheck({ visible: true, pending: false, lastAt: 0, now: 300_000, minGap: UPDATE_MIN_GAP_MS, reason: 'interval' }), true);
});

test('unsaved edits and an in-progress save block the reload', () => {
  assert.deepEqual(canApplyUpdate({ dirty: false, busy: false }), { ok: true, reason: '' });
  assert.deepEqual(canApplyUpdate({ dirty: true, busy: false }), { ok: false, reason: 'dirty' });
  assert.deepEqual(canApplyUpdate({ dirty: false, busy: true }), { ok: false, reason: 'busy' });
  const gate = createActivityGate();
  const seen = [];
  const stop = gate.subscribe((value) => seen.push(value));
  gate.set({ dirty: true, busy: true });
  assert.deepEqual(gate.get(), { dirty: true, busy: true });
  gate.clear();
  assert.deepEqual(gate.get(), { dirty: false, busy: false });
  stop();
  assert.equal(seen.length, 2);
});

test('update reloads once and keeps the rest of the tab storage', async () => {
  const storage = memoryStorage({ 'sb-session': 'kept' });
  const reloads = [];
  const first = await requestUpdate({
    remote: 'build-b',
    now: 1_000,
    storage,
    reload: () => reloads.push('reload'),
    serviceWorker: null,
    getRegistration: async () => null,
  });
  assert.equal(first, 'reload');
  const second = await requestUpdate({
    remote: 'build-b',
    now: 2_000,
    storage,
    reload: () => reloads.push('reload'),
    serviceWorker: null,
    getRegistration: async () => null,
  });
  assert.equal(second, 'guard');
  assert.deepEqual(reloads, ['reload']);
  assert.equal(storage.getItem('sb-session'), 'kept');
  assert.deepEqual(storage.keys().filter((key) => key !== RELOAD_ATTEMPT_KEY), ['sb-session']);
  assert.equal(shouldReload({ remote: 'build-c', attempt: { version: 'build-b', at: 1_000 }, now: 2_000 }), true);
  clearSucceededAttempt(storage, 'build-b');
  assert.equal(storage.getItem(RELOAD_ATTEMPT_KEY), null);
});

test('a waiting service worker activates once and does not reload before control changes', async () => {
  const listeners = [];
  const serviceWorker = {
    addEventListener(type, fn) { listeners.push({ type, fn }); },
  };
  const messages = [];
  const reloads = [];
  const result = await requestUpdate({
    remote: 'build-b',
    now: 1_000,
    storage: memoryStorage(),
    reload: () => reloads.push('reload'),
    serviceWorker,
    getRegistration: async () => ({ waiting: { postMessage(message) { messages.push(message); } } }),
  });
  assert.equal(result, 'waiting');
  assert.deepEqual(messages, [{ type: 'SKIP_WAITING' }]);
  assert.equal(reloads.length, 0);
  listeners[0].fn();
  listeners[0].fn();
  assert.deepEqual(reloads, ['reload']);
});

test('version.json is not cached and the app does not register a service worker', () => {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const versionHeader = vercel.headers.find((rule) => rule.source === '/version.json');
  assert.equal(versionHeader.headers.some((header) => header.key === 'Cache-Control' && header.value === 'no-store'), true);
  for (const source of ['/', '/index.html', '/app', '/c/:id']) {
    const rule = vercel.headers.find((item) => item.source === source);
    assert.equal(rule.headers.some((header) => header.key === 'Cache-Control' && header.value === 'no-cache'), true);
  }
  const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const update = readFileSync(new URL('../src/update.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(main.includes('serviceWorker.register'), false);
  assert.equal(update.includes('serviceWorker.register'), false);
  assert.equal(html.includes('serviceWorker'), false);
});
