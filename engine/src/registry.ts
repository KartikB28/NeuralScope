/**
 * The Registry — the database that points at files. Skills, profiles,
 * connector manifests and structures live as files in definitions/; the
 * registry records versions, pointers, settings, gates, reports, stats and
 * live objective checkpoints so a restart resumes instead of resets.
 *
 * v1 stores the registry as JSON (atomic writes). The shape is deliberately
 * row-like so a SQLite swap-in later is mechanical, not architectural.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Paths, readJson, writeJsonAtomic } from './paths.js';
import { GateRequest, ObjectiveState, PublicSettings } from './contract.js';

export interface SkillRow {
  name: string;            // "frontend"
  version: number;         // active version
  file: string;            // active file relative to definitions/skills
  updatedAt: number;
  updatedBy: 'user' | 'evolver' | 'seed';
}

export interface ReportRow {
  id: string;
  target: string;          // e.g. "skill:frontend"
  kind: string;            // "validation-failures"
  evidence: string;
  samples: { stepTask: string; reasons: string[] }[];
  createdAt: number;
  consumedBy?: string;     // evolver cycle id
}

export interface MemoryRow {
  id: string;
  summary: string;
  tags: string[];
  relevance: number;       // decays when unused; <0.15 → swept
  createdAt: number;
  lastUsedAt: number;
  source: 'objective' | 'user';
}

export interface SettingsRow extends Omit<PublicSettings, 'hasAnthropicKey' | 'dataDir'> {
  port: number;
}

export interface RegistryData {
  schemaVersion: number;
  settings: SettingsRow;
  skills: SkillRow[];
  gates: GateRequest[];
  reports: ReportRow[];
  objectives: Record<string, ObjectiveState>;  // live + recent checkpoints
  frozen: boolean;                              // kill switch state
  stats: {
    objectivesCompleted: number;
    stepsCompleted: number;
    validationsFailed: number;
    structuresEvolved: number;
    evolverCycles: number;
    objectivesSinceEvolve: number;
  };
  evolverLastOutcome?: string;
}

const DEFAULTS: RegistryData = {
  schemaVersion: 1,
  settings: {
    ollamaUrl: 'http://127.0.0.1:11434',
    anthropicModel: 'claude-sonnet-4-6',
    concurrency: 3,
    evolverEveryNObjectives: 5,
    sandboxEnabled: false,
    webAllowlist: ['example.com', 'en.wikipedia.org', 'raw.githubusercontent.com'],
    port: 43117,
  },
  skills: [],
  gates: [],
  reports: [],
  objectives: {},
  frozen: false,
  stats: {
    objectivesCompleted: 0, stepsCompleted: 0, validationsFailed: 0,
    structuresEvolved: 0, evolverCycles: 0, objectivesSinceEvolve: 0,
  },
};

export class Registry {
  data: RegistryData;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private paths: Paths) {
    this.data = { ...DEFAULTS, ...readJson<Partial<RegistryData>>(paths.registryFile, {}) } as RegistryData;
    this.data.settings = { ...DEFAULTS.settings, ...this.data.settings };
    this.data.stats = { ...DEFAULTS.stats, ...this.data.stats };
    this.syncSkillsFromDisk();
    this.save();
  }

  /** Discover skill files on disk; keep highest version per name as active. */
  syncSkillsFromDisk(): void {
    const found = new Map<string, { version: number; file: string }>();
    if (fs.existsSync(this.paths.skills)) {
      for (const f of fs.readdirSync(this.paths.skills)) {
        if (!f.endsWith('.md')) continue;
        const m = /^(.+?)(?:\.v(\d+))?\.md$/.exec(f);
        if (!m) continue;
        const name = m[1];
        const version = m[2] ? parseInt(m[2], 10) : 1;
        const cur = found.get(name);
        if (!cur || version > cur.version) found.set(name, { version, file: f });
      }
    }
    for (const [name, { version, file }] of found) {
      const row = this.data.skills.find(s => s.name === name);
      if (!row) {
        this.data.skills.push({ name, version, file, updatedAt: Date.now(), updatedBy: 'seed' });
      } else if (version > row.version) {
        row.version = version; row.file = file; row.updatedAt = Date.now();
      }
    }
    this.data.skills = this.data.skills.filter(s => found.has(s.name));
  }

  skillPath(name: string): string | null {
    const row = this.data.skills.find(s => s.name === name);
    return row ? path.join(this.paths.skills, row.file) : null;
  }

  readSkill(name: string): string {
    const p = this.skillPath(name);
    if (!p || !fs.existsSync(p)) return '';
    return fs.readFileSync(p, 'utf8');
  }

  /** Write a new version of a skill file and repoint the registry row. */
  writeSkillVersion(name: string, content: string, by: 'user' | 'evolver'): SkillRow {
    let row = this.data.skills.find(s => s.name === name);
    const version = row ? row.version + 1 : 1;
    const file = version === 1 ? `${name}.md` : `${name}.v${version}.md`;
    fs.writeFileSync(path.join(this.paths.skills, file), content);
    if (!row) {
      row = { name, version, file, updatedAt: Date.now(), updatedBy: by };
      this.data.skills.push(row);
    } else {
      row.version = version; row.file = file; row.updatedAt = Date.now(); row.updatedBy = by;
    }
    this.save();
    return row;
  }

  save(): void {
    // debounce: many writers, one disk write per tick
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      writeJsonAtomic(this.paths.registryFile, this.data);
    }, 25);
  }

  saveNow(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    writeJsonAtomic(this.paths.registryFile, this.data);
  }
}

// ---------------------------------------------------------------------------
// Vault — secrets live here, encrypted at rest, never in prompts, never in git.
// ---------------------------------------------------------------------------
import * as crypto from 'node:crypto';
import * as os from 'node:os';

interface VaultData { [key: string]: string }

/** Obfuscated-at-rest local vault. Honest note: the key is derived from the
 *  machine identity, so this protects against casual file reads and accidental
 *  copies — not against an attacker with full control of this user account.
 *  That is the realistic ceiling for any local-only secret store. */
export class Vault {
  private file: string;
  constructor(vaultFile: string) { this.file = vaultFile; }

  private key(): Buffer {
    const seed = `neuralscope:${os.hostname()}:${os.userInfo().username}`;
    return crypto.createHash('sha256').update(seed).digest();
  }

  private load(): VaultData {
    try {
      const raw = fs.readFileSync(this.file);
      const iv = raw.subarray(0, 16);
      const tag = raw.subarray(16, 32);
      const enc = raw.subarray(32);
      const d = crypto.createDecipheriv('aes-256-gcm', this.key(), iv);
      d.setAuthTag(tag);
      return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8'));
    } catch { return {}; }
  }

  private store(data: VaultData): void {
    const iv = crypto.randomBytes(16);
    const c = crypto.createCipheriv('aes-256-gcm', this.key(), iv);
    const enc = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
    fs.writeFileSync(this.file, Buffer.concat([iv, c.getAuthTag(), enc]));
    try { fs.chmodSync(this.file, 0o600); } catch { /* windows */ }
  }

  get(key: string): string | undefined { return this.load()[key]; }
  set(key: string, value: string): void { const d = this.load(); d[key] = value; this.store(d); }
  delete(key: string): void { const d = this.load(); delete d[key]; this.store(d); }
  has(key: string): boolean { return this.get(key) !== undefined; }
}
