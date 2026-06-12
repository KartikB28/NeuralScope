/**
 * Where everything lives on disk. The whole system is files + a registry that
 * points at files. Default home: ~/.neuralscope (override: NEURALSCOPE_HOME).
 *
 *   ~/.neuralscope/
 *   ├─ definitions/      seeded from the app bundle on first boot; user-editable
 *   │   ├─ skills/  structures/  profiles/  connectors/  schema/
 *   ├─ state/
 *   │   ├─ registry.json   memory.json   events.jsonl   traces/
 *   ├─ workspaces/
 *   │   ├─ main/  testing/  onetime/
 *   └─ vault/            secrets, chmod 600, never in git, never in prompts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface Paths {
  home: string;
  definitions: string;
  skills: string;
  structures: string;
  profiles: string;
  connectorDefs: string;
  schema: string;
  state: string;
  registryFile: string;
  memoryFile: string;
  eventsFile: string;
  traces: string;
  workspaces: string;
  vault: string;
  vaultFile: string;
  /** read-only factory defaults shipped with the app */
  bundledDefinitions: string;
}

export function resolvePaths(bundledDefinitions: string): Paths {
  const home = process.env.NEURALSCOPE_HOME || path.join(os.homedir(), '.neuralscope');
  const definitions = path.join(home, 'definitions');
  const state = path.join(home, 'state');
  const p: Paths = {
    home,
    definitions,
    skills: path.join(definitions, 'skills'),
    structures: path.join(definitions, 'structures'),
    profiles: path.join(definitions, 'profiles'),
    connectorDefs: path.join(definitions, 'connectors'),
    schema: path.join(definitions, 'schema'),
    state,
    registryFile: path.join(state, 'registry.json'),
    memoryFile: path.join(state, 'memory.json'),
    eventsFile: path.join(state, 'events.jsonl'),
    traces: path.join(state, 'traces'),
    workspaces: path.join(home, 'workspaces'),
    vault: path.join(home, 'vault'),
    vaultFile: path.join(home, 'vault', 'secrets.json'),
    bundledDefinitions,
  };
  return p;
}

export function ensureDirs(p: Paths): void {
  for (const dir of [
    p.home, p.definitions, p.skills, p.structures, p.profiles, p.connectorDefs,
    p.schema, p.state, p.traces, p.workspaces,
    path.join(p.workspaces, 'main'), path.join(p.workspaces, 'testing'),
    path.join(p.workspaces, 'onetime'), p.vault,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  try { fs.chmodSync(p.vault, 0o700); } catch { /* windows: acl-managed */ }
}

/** Copy bundled factory definitions into the user's data dir without
 *  overwriting anything the user (or the Evolver) has changed. */
export function seedDefinitions(p: Paths): string[] {
  const seeded: string[] = [];
  if (!fs.existsSync(p.bundledDefinitions)) return seeded;
  const walk = (src: string, dst: string) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      if (entry.isDirectory()) walk(s, d);
      else if (!fs.existsSync(d)) { fs.copyFileSync(s, d); seeded.push(d); }
    }
  };
  walk(p.bundledDefinitions, p.definitions);
  return seeded;
}

export function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; }
  catch { return fallback; }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
