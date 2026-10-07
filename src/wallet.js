import { normalizeProfile, safeLink } from './lib.js';

function clean(value, max) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function rgb(hex) {
  const n = Number.parseInt(String(hex).slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function field(key, label, value, max) {
  const text = clean(value, max);
  if (!text) return null;
  return { key, label, value: text };
}

export function buildWalletPass(profileInput, { id, url, passTypeIdentifier, teamIdentifier }) {
  const profile = normalizeProfile(profileInput);
  const name = clean([profile.firstName, profile.lastName].filter(Boolean).join(' '), 80) || 'Carte de contact';
  const secondary = [field('role', 'FONCTION', profile.role, 80), field('company', 'ENTREPRISE', profile.company, 80)].filter(Boolean);
  const auxiliary = [field('phone', 'TÉLÉPHONE', profile.phone, 40), field('city', 'VILLE', profile.city, 40)].filter(Boolean);
  const address = [profile.street, [profile.postal, profile.city].filter(Boolean).join(' '), profile.country && profile.country !== 'France' ? profile.country : ''].map((part) => clean(part, 120)).filter(Boolean).join(', ');
  const back = [
    field('back-email', 'E-MAIL', profile.email, 200),
    field('back-phone', 'TÉLÉPHONE', profile.phone, 40),
    field('back-address', 'ADRESSE', address, 300),
    field('back-slogan', 'SIGNATURE', profile.slogan, 160),
    field('back-tagline', 'PRÉSENTATION', profile.tagline, 400),
    field('back-website', 'SITE WEB', safeLink(profile.website), 300),
    field('back-linkedin', 'LINKEDIN', safeLink(profile.linkedin), 300),
    field('back-github', 'GITHUB', safeLink(profile.github), 300),
    field('back-card', 'CARTE', url, 300),
  ].filter(Boolean);
  const generic = { primaryFields: [{ key: 'name', label: 'CONTACT', value: name }] };
  if (secondary.length) generic.secondaryFields = secondary;
  if (auxiliary.length) generic.auxiliaryFields = auxiliary;
  if (back.length) generic.backFields = back;
  return {
    formatVersion: 1,
    passTypeIdentifier,
    teamIdentifier,
    serialNumber: id,
    organizationName: 'JavaChrist',
    description: clean(`Carte de contact de ${name}`, 120),
    logoText: clean(profile.company, 40) || 'JavaChrist',
    foregroundColor: 'rgb(255, 255, 255)',
    backgroundColor: 'rgb(18, 19, 21)',
    labelColor: rgb(profile.accent),
    barcodes: [{ message: url, format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1', altText: name.slice(0, 40) }],
    generic,
  };
}
