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
import * as crypto from 'node:crypto';
import { Paths, readJson, writeJsonAtomic } from './paths.js';
import {
  CapabilityLedgerRow, GateRequest, ObjectiveState, PublicSettings, RecurringCircuit,
} from './contract.js';

export interface SkillRow {
  name: string;            // "frontend"
  version: number;         // active version
  file: string;            // active file relative to definitions/skills
  updatedAt: number;
  updatedBy: 'user' | 'evolver' | 'seed';
  /** canary lifecycle (Q2): a promotion is on probation until it proves
   *  itself on live traffic; a regression triggers automatic rollback. */
  status: 'stable' | 'canary';
  prevFile?: string;       // rollback target while canary
  prevVersion?: number;
  baselineFailRate: number;   // incumbent's fail rate at promotion time
  canaryAttempts: number;
  canaryFailures: number;
  /** lifetime performance (Q4) — drives evolver capture */
  attempts: number;
  failures: number;
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

export interface SettingsRow extends Omit<PublicSettings, 'hasAnthropicKey' | 'dataDir' | 'hasGdocsCredentials' | 'gdocsConnected'> {
  port: number;
}

export interface RegistryData {
  schemaVersion: number;
  settings: SettingsRow;
  skills: SkillRow[];
  gates: GateRequest[];
  reports: ReportRow[];
  objectives: Record<string, ObjectiveState>;  // live + recent checkpoints
  circuits: RecurringCircuit[];                // recurring circuits (Q8)
  capabilities: CapabilityLedgerRow[];         // graduation ledger (Q3)
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
    tierGraduationThreshold: 25,
  },
  skills: [],
  gates: [],
  reports: [],
  objectives: {},
  circuits: [],
  capabilities: [],
  frozen: false,
  stats: {
    objectivesCompleted: 0, stepsCompleted: 0, validationsFailed: 0,
    structuresEvolved: 0, evolverCycles: 0, objectivesSinceEvolve: 0,
  },
};

// canary verdict thresholds: enough live signal, judged against the baseline
const CANARY_MIN_ATTEMPTS = 3;
const CANARY_MAX_PROBATION = 8;

export class Registry {
  data: RegistryData;
  private saveTimer: NodeJS.Timeout | null = null;

  blobs: BlobStore;

  constructor(private paths: Paths) {
    this.data = { ...DEFAULTS, ...readJson<Partial<RegistryData>>(paths.registryFile, {}) } as RegistryData;
    this.data.settings = { ...DEFAULTS.settings, ...this.data.settings };
    this.data.stats = { ...DEFAULTS.stats, ...this.data.stats };
    this.data.circuits = this.data.circuits ?? [];
    this.data.capabilities = this.data.capabilities ?? [];
    this.blobs = new BlobStore(path.join(paths.state, 'blobs'));
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
        this.data.skills.push({
          name, version, file, updatedAt: Date.now(), updatedBy: 'seed',
          status: 'stable', baselineFailRate: 0, canaryAttempts: 0, canaryFailures: 0,
          attempts: 0, failures: 0,
        });
      } else if (version > row.version) {
        row.version = version; row.file = file; row.updatedAt = Date.now();
      }
    }
    this.data.skills = this.data.skills.filter(s => found.has(s.name));
    // migrate rows written before the canary/stats fields existed
    for (const s of this.data.skills) {
      s.status = s.status ?? 'stable';
      s.baselineFailRate = s.baselineFailRate ?? 0;
      s.canaryAttempts = s.canaryAttempts ?? 0;
      s.canaryFailures = s.canaryFailures ?? 0;
      s.attempts = s.attempts ?? 0;
      s.failures = s.failures ?? 0;
    }
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

  /** Write a new version of a skill file and repoint the registry row.
   *  Evolver promotions enter as CANARY: the previous version is retained as
   *  the rollback target and live performance decides stable vs revert. */
  writeSkillVersion(name: string, content: string, by: 'user' | 'evolver'): SkillRow {
    let row = this.data.skills.find(s => s.name === name);
    // version numbers come from disk history, never from the active pointer —
    // a rollback must not cause a later promotion to overwrite an archived loser
    let maxOnDisk = 0;
    try {
      for (const f of fs.readdirSync(this.paths.skills)) {
        const m = new RegExp(`^${name}(?:\\.v(\\d+))?\\.md$`).exec(f);
        if (m) maxOnDisk = Math.max(maxOnDisk, m[1] ? parseInt(m[1], 10) : 1);
      }
    } catch { /* fresh dir */ }
    const version = Math.max(maxOnDisk, row?.version ?? 0) + 1;
    const file = version === 1 ? `${name}.md` : `${name}.v${version}.md`;
    fs.writeFileSync(path.join(this.paths.skills, file), content);
    if (!row) {
      row = {
        name, version, file, updatedAt: Date.now(), updatedBy: by,
        status: 'stable', baselineFailRate: 0, canaryAttempts: 0, canaryFailures: 0,
        attempts: 0, failures: 0,
      };
      this.data.skills.push(row);
    } else {
      const baseline = row.attempts > 0 ? row.failures / row.attempts : 0;
      if (by === 'evolver') {
        row.status = 'canary';
        row.prevFile = row.file;
        row.prevVersion = row.version;
        row.baselineFailRate = baseline;
        row.canaryAttempts = 0;
        row.canaryFailures = 0;
      } else {
        // a human edit is an order, not an experiment
        row.status = 'stable';
        row.prevFile = undefined;
        row.prevVersion = undefined;
      }
      row.version = version; row.file = file; row.updatedAt = Date.now(); row.updatedBy = by;
    }
    this.save();
    return row;
  }

  /** Record one validated use of a skill (Q4 stats + Q2 canary verdicts).
   *  Returns 'rollback' when a canary has regressed past its baseline. */
  recordSkillUse(name: string, pass: boolean): 'ok' | 'rollback' {
    const row = this.data.skills.find(s => s.name === name);
    if (!row) return 'ok';
    row.attempts++;
    if (!pass) row.failures++;
    if (row.status === 'canary') {
      row.canaryAttempts++;
      if (!pass) row.canaryFailures++;
      const rate = row.canaryFailures / row.canaryAttempts;
      if (row.canaryAttempts >= CANARY_MIN_ATTEMPTS && rate > row.baselineFailRate) {
        this.save();
        return 'rollback';
      }
      if (row.canaryAttempts >= CANARY_MAX_PROBATION ||
          (row.canaryAttempts >= CANARY_MIN_ATTEMPTS && row.canaryFailures === 0)) {
        row.status = 'stable';        // survived probation on live traffic
        row.prevFile = undefined;
        row.prevVersion = undefined;
      }
    }
    this.save();
    return 'ok';
  }

  /** Revert a regressed canary to its retained previous version. */
  rollbackSkill(name: string): { fromVersion: number; toVersion: number } | null {
    const row = this.data.skills.find(s => s.name === name);
    if (!row || row.status !== 'canary' || !row.prevFile || row.prevVersion === undefined) return null;
    const from = row.version;
    row.file = row.prevFile;
    row.version = row.prevVersion;
    row.status = 'stable';
    row.prevFile = undefined;
    row.prevVersion = undefined;
    row.canaryAttempts = 0;
    row.canaryFailures = 0;
    row.updatedAt = Date.now();
    row.updatedBy = 'evolver';
    this.save();
    return { fromVersion: from, toVersion: row.version };
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
// BlobStore — content-addressed storage (Q1). Step outputs, full prompts and
// responses, and pre-write mirrors live here as immutable, deduplicated
// blobs; everything else holds hashes. `state/blobs/ab/abcdef….blob`
// ---------------------------------------------------------------------------
export class BlobStore {
  constructor(private root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  put(content: string): string {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const dir = path.join(this.root, hash.slice(0, 2));
    const file = path.join(dir, `${hash}.blob`);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, content);
      fs.renameSync(tmp, file);
    }
    return hash;
  }

  get(hash: string): string | null {
    if (!/^[a-f0-9]{64}$/.test(hash)) return null;
    try { return fs.readFileSync(path.join(this.root, hash.slice(0, 2), `${hash}.blob`), 'utf8'); }
    catch { return null; }
  }

  has(hash: string): boolean {
    return /^[a-f0-9]{64}$/.test(hash) &&
      fs.existsSync(path.join(this.root, hash.slice(0, 2), `${hash}.blob`));
  }
}

// ---------------------------------------------------------------------------
// Vault — secrets live here, encrypted at rest, never in prompts, never in git.
// ---------------------------------------------------------------------------
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
