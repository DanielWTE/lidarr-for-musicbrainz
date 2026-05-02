import { mkdir, access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const publicDir = resolve(projectRoot, 'public');

const SIZES = [16, 48, 128];
const FORCE = process.argv.includes('--force');

async function exists(p) {
  try {
    await access(p, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

const PRIMARY = '#1e9d8c';
const ACCENT = '#0c4f47';

function svgFor(size) {
  // A teal disc with a stylized "L" + a beam-emit dot — visually distinct from Lidarr's blue logo.
  const r = size / 2;
  const stroke = Math.max(1, Math.round(size * 0.06));
  const fontSize = Math.round(size * 0.68);
  const fx = Math.round(size * 0.34);
  const fy = Math.round(size * 0.74);
  const dotR = Math.max(1, Math.round(size * 0.07));
  const dotCx = Math.round(size * 0.72);
  const dotCy = Math.round(size * 0.32);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${r}" cy="${r}" r="${r - stroke / 2}" fill="${PRIMARY}" stroke="${ACCENT}" stroke-width="${stroke}"/>
    <text x="${fx}" y="${fy}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${fontSize}" fill="#ffffff">L</text>
    <circle cx="${dotCx}" cy="${dotCy}" r="${dotR}" fill="#ffffff"/>
  </svg>`;
}

async function main() {
  await mkdir(publicDir, { recursive: true });

  let sharp;
  try {
    ({ default: sharp } = await import('sharp'));
  } catch (e) {
    console.error('[icons] `sharp` not installed yet — run `npm install` first.');
    console.error('[icons] Skipping icon generation; build will fail until icons exist.');
    process.exitCode = 0; // soft-fail so `npm install` can still succeed
    return;
  }

  for (const size of SIZES) {
    const out = resolve(publicDir, `icon${size}.png`);
    if (!FORCE && (await exists(out))) {
      console.log(`[icons] keep    ${out}`);
      continue;
    }
    const svg = svgFor(size);
    await sharp(Buffer.from(svg)).png().toFile(out);
    console.log(`[icons] write   ${out}`);
  }
}

main().catch((err) => {
  console.error('[icons] failed:', err);
  process.exit(1);
});
