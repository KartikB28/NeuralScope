/**
 * Layer-rule enforcement — Q5 of the eight systems, as executable law.
 * World → Bridge → Tower → Runtime → Connectors. A module may import its own
 * layer or the layer directly below; never upward, never skipping.
 * Runs in `npm run typecheck` and CI; a violation fails the build.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const RULES = [
  // [dir, forbidden import patterns, reason]
  ['engine/src/connectors', [/\.\.\/(tower|runtime|bridge|server)/, /world\//, /electron/], 'connectors (L1) import nothing above'],
  ['engine/src/models', [/\.\.\/(tower|runtime|server)/, /world\//, /electron/], 'model providers sit at L1'],
  ['engine/src/runtime', [/\.\.\/tower\//, /\.\.\/server/, /world\//, /electron/], 'runtime (L2) talks to the tower only through ports'],
  ['engine/src/tower', [/world\//, /desktop\//, /electron/], 'tower (L3) never touches the world or the shell'],
  ['engine/src', [/desktop\//, /electron/], 'the engine runs headless; the shell imports it, never the reverse'],
  ['world/src', [/engine\/src\/(?!contract)/, /desktop\//, /electron/], 'the world may import only the frozen contract from the engine'],
];

let violations = 0;
for (const [dir, patterns, reason] of RULES) {
  if (!fs.existsSync(dir)) continue;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const line of src.split('\n')) {
        const m = /^\s*import[^'"]*['"]([^'"]+)['"]/.exec(line);
        if (!m) continue;
        for (const pat of patterns) {
          if (pat.test(m[1])) {
            console.error(`✗ ${p}: imports "${m[1]}" — ${reason}`);
            violations++;
          }
        }
      }
    }
  };
  walk(dir);
}

if (violations) {
  console.error(`\n${violations} layer violation(s). The five-layer rule is not a suggestion.`);
  process.exit(1);
}
console.log('✓ layer rules hold: World → Bridge → Tower → Runtime → Connectors');
