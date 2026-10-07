import { deflateSync } from 'node:zlib';

function concat(parts) {
  const out = Buffer.concat(parts.map((part) => Buffer.from(part)));
  return out;
}

function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type);
  return concat([u32(data.length), typeBytes, data, u32(crc32(concat([typeBytes, data])))]);
}

function paint(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    for (let x = 0; x < width; x += 1) {
      const color = pixel(x, y, width, height);
      const at = row + 1 + x * 4;
      raw[at] = color[0];
      raw[at + 1] = color[1];
      raw[at + 2] = color[2];
      raw[at + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function mark(x, y, width, height) {
  const cx = width * 0.5;
  const cy = height * 0.5;
  const rx = width * 0.22;
  const ry = height * 0.22;
  const inside = ((x - cx) ** 2) / (rx * rx) + ((y - cy) ** 2) / (ry * ry) <= 1;
  return inside ? [255, 148, 31] : [18, 19, 21];
}

export function iconPng(size) {
  return paint(size, size, mark);
}

export function logoPng(width, height) {
  return paint(width, height, (x, y) => {
    const cx = height * 0.55;
    const cy = height * 0.5;
    const radius = height * 0.22;
    const inside = (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
    return inside ? [255, 148, 31] : [18, 19, 21];
  });
}

export function walletImages() {
  return {
    'icon.png': iconPng(29),
    'icon@2x.png': iconPng(58),
    'icon@3x.png': iconPng(87),
    'logo.png': logoPng(160, 50),
    'logo@2x.png': logoPng(320, 100),
    'logo@3x.png': logoPng(480, 150),
  };
}
