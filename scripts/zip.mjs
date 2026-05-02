import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');

if (!existsSync(distDir)) {
  console.error('[zip] dist/ does not exist — run `npm run build` first.');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const zipName = `lidarr-for-musicbrainz-v${pkg.version}.zip`;
const zipPath = resolve(root, zipName);

if (existsSync(zipPath)) {
  rmSync(zipPath);
}

execFileSync('zip', ['-r', zipPath, '.'], { cwd: distDir, stdio: 'inherit' });
console.log(`[zip] ✓ ${zipName}`);
