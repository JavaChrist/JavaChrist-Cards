export const UPDATE_INTERVAL_MS = 5 * 60 * 1000;
export const UPDATE_MIN_GAP_MS = 15 * 1000;
export const UPDATE_RELOAD_GUARD_MS = 15 * 1000;
export const RELOAD_ATTEMPT_KEY = 'jc-update-reload';
export const DISMISS_KEY = 'jc-update-dismissed';

const VERSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function versionDocument(version) {
  return { version };
}

export function parseVersionPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const version = payload.version;
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) return null;
  return version;
}

export function currentBuildVersion() {
  return typeof __APP_VERSION__ === 'string' && VERSION_PATTERN.test(__APP_VERSION__) ? __APP_VERSION__ : '';
}

export function decideUpdate({ current, remote, dismissed, dev }) {
  if (dev) return { notify: false };
  if (typeof current !== 'string' || !current) return { notify: false };
  if (typeof remote !== 'string' || !remote) return { notify: false };
  if (remote === current || dismissed === remote) return { notify: false };
  return { notify: true };
}

export function shouldScheduleCheck({ visible, pending, lastAt, now, minGap, reason }) {
  if (pending) return false;
  if (reason !== 'start' && !visible) return false;
  if (reason !== 'start' && now - lastAt < minGap) return false;
  return true;
}

export function canApplyUpdate({ dirty, busy }) {
  if (busy) return { ok: false, reason: 'busy' };
  if (dirty) return { ok: false, reason: 'dirty' };
  return { ok: true, reason: '' };
}

export function createActivityGate() {
  let dirty = false;
  let busy = false;
  const listeners = new Set();
  function snapshot() {
    return { dirty, busy };
  }
  return {
    get: snapshot,
    set(next) {
      dirty = !!next?.dirty;
      busy = !!next?.busy;
      for (const listener of listeners) listener(snapshot());
    },
    clear() {
      this.set({ dirty: false, busy: false });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const editorActivity = createActivityGate();

export function readAttempt(storage) {
  try {
    const data = JSON.parse(storage.getItem(RELOAD_ATTEMPT_KEY) || 'null');
    if (!data || typeof data.version !== 'string' || typeof data.at !== 'number') return null;
    return { version: data.version, at: data.at };
  } catch {
    return null;
  }
}

export function shouldReload({ remote, attempt, now, guardMs = UPDATE_RELOAD_GUARD_MS }) {
  if (!remote) return false;
  if (attempt?.version === remote && now - attempt.at < guardMs) return false;
  return true;
}

export function clearSucceededAttempt(storage, current) {
  const attempt = readAttempt(storage);
  if (attempt?.version && attempt.version === current) storage.removeItem(RELOAD_ATTEMPT_KEY);
}

export async function fetchRemoteVersion(fetchImpl, href = '/version.json') {
  try {
    const response = await fetchImpl(href, { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response?.ok) return null;
    return parseVersionPayload(await response.json());
  } catch {
    return null;
  }
}

export function readDismissed(storage) {
  try {
    const value = storage.getItem(DISMISS_KEY);
    return typeof value === 'string' && VERSION_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function createVersionMonitor({ current, dev, fetchVersion, now, visible, onStatus, storage = null, minGapMs = UPDATE_MIN_GAP_MS }) {
  let dismissed = readDismissed(storage);
  let pending = false;
  let lastAt = 0;
  let remote = null;
  let open = false;
  function publish() {
    onStatus({ remote, open, dismissed });
  }
  return {
    async check(reason) {
      if (dev) return;
      const at = now();
      if (!shouldScheduleCheck({ visible: visible(), pending, lastAt, now: at, minGap: minGapMs, reason })) return;
      pending = true;
      try {
        const found = await fetchVersion();
        lastAt = now();
        if (!found || found === current) {
          if (found === current) {
            remote = null;
            open = false;
            publish();
          }
          return;
        }
        remote = found;
        if (decideUpdate({ current, remote: found, dismissed, dev: false }).notify) open = true;
        publish();
      } catch {
        /* Une erreur réseau ne signale pas une mise à jour. */
      } finally {
        pending = false;
      }
    },
    postpone() {
      if (!remote) return;
      dismissed = remote;
      open = false;
      try { storage?.setItem(DISMISS_KEY, remote); } catch { /* le report reste au moins dans cette page */ }
      publish();
    },
    reopen() {
      if (!remote || remote === current || dismissed !== remote) return;
      open = true;
      publish();
    },
  };
}

export async function requestUpdate({ remote, now, storage, reload, serviceWorker, getRegistration }) {
  const attempt = readAttempt(storage);
  if (!shouldReload({ remote, attempt, now })) return 'guard';
  storage.setItem(RELOAD_ATTEMPT_KEY, JSON.stringify({ version: remote, at: now }));
  let registration = null;
  try {
    registration = serviceWorker && getRegistration ? await getRegistration() : null;
  } catch {
    registration = null;
  }
  const waiting = registration?.waiting || null;
  if (waiting && serviceWorker?.addEventListener) {
    let done = false;
    const reloadOnce = () => {
      if (done) return;
      done = true;
      reload();
    };
    serviceWorker.addEventListener('controllerchange', reloadOnce);
    try {
      waiting.postMessage({ type: 'SKIP_WAITING' });
      return 'waiting';
    } catch {
      reloadOnce();
      return 'reload';
    }
  }
  reload();
  return 'reload';
}
