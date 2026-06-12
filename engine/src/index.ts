/**
 * Engine entrypoint — boots the Tower headless. Used directly
 * (`npm run engine` + open the printed URL in a browser) and by the
 * Electron shell, which imports this same bundle in-process.
 */
import * as path from 'node:path';
import * as url from 'node:url';
import { resolvePaths, ensureDirs } from './paths.js';
import { Tower } from './tower/tower.js';
import { startServer, ServerHandle } from './server.js';

export interface RunningEngine {
  tower: Tower;
  port: number;
  stop(): Promise<void>;
}

export async function startEngine(opts: {
  bundledDefinitions?: string;
  worldDist?: string;
  port?: number;
} = {}): Promise<RunningEngine> {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  // dist layout: dist/engine/index.cjs → repo root two levels up
  const root = path.resolve(here, '..', '..');
  const bundledDefinitions = opts.bundledDefinitions
    ?? process.env.NEURALSCOPE_DEFS
    ?? path.join(root, 'definitions');
  const worldDist = opts.worldDist
    ?? process.env.NEURALSCOPE_WORLD
    ?? path.join(root, 'world', 'dist');

  const paths = resolvePaths(bundledDefinitions);
  ensureDirs(paths);

  const tower = new Tower(paths);
  await tower.boot();

  const preferred = opts.port ?? Number(process.env.NEURALSCOPE_PORT ?? tower.registry.data.settings.port);
  const server: ServerHandle = await startServer(tower, worldDist, preferred);

  return {
    tower,
    port: server.port,
    stop: async () => {
      await server.close();
      await tower.shutdown();
    },
  };
}

// headless invocation: node dist/engine/index.cjs
const invokedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (invokedDirectly || process.env.NEURALSCOPE_HEADLESS === '1') {
  startEngine().then(({ port, tower }) => {
    console.log('');
    console.log('  ███ NeuralScope engine is up');
    console.log(`  ███ World:    http://127.0.0.1:${port}`);
    console.log(`  ███ Bridge:   ws://127.0.0.1:${port}/ws`);
    console.log(`  ███ Data:     ${tower.paths.home}`);
    console.log('');
    const bye = async () => { await tower.shutdown(); process.exit(0); };
    process.on('SIGINT', bye);
    process.on('SIGTERM', bye);
  }).catch((ex) => {
    console.error('engine failed to boot:', ex);
    process.exit(1);
  });
}
