const CARD_PATH = /^\/c\/([0-9a-f-]{36})\/?$/i;

export function manifestPathForLocation(pathname) {
  const card = CARD_PATH.exec(pathname || '');
  if (card) return `/c/${card[1]}/manifest.webmanifest`;
  return '/app/manifest.webmanifest';
}

export function launchPathForManifest(manifestPath, startUrl = './') {
  return new URL(startUrl, new URL(manifestPath, 'https://cards.local')).pathname;
}
