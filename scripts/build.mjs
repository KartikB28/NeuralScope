/**
 * Build everything: engine bundle (Node CJS), desktop shell (Electron CJS),
 * world assets (Vite). One command, three artifacts, zero magic.
 */
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';

const banner = `const import_meta_url = require('node:url').pathToFileURL(__filename).href;`;

console.log('▸ engine → dist/engine/index.cjs');
await build({
  entryPoints: ['engine/src/index.ts'],
  outfile: 'dist/engine/index.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  banner: { js: banner },
  define: { 'import.meta.url': 'import_meta_url' },
});

console.log('▸ desktop → dist/desktop/{main,preload}.cjs');
await build({
  entryPoints: { main: 'desktop/main.ts', preload: 'desktop/preload.ts' },
  outdir: 'dist/desktop',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
});

console.log('▸ world → world/dist (vite)');
execSync('npx vite build world', { stdio: 'inherit' });

if (!fs.existsSync('build/icon.png')) {
  console.log('▸ icon → build/icon.png');
  execSync('node scripts/make-icon.mjs', { stdio: 'inherit' });
}

console.log('✔ build complete');
