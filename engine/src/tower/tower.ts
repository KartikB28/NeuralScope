/**
 * Layer 3 — the Tower. The one program that sees everything, schedules
 * everything, and is the only authority allowed to start or stop flights.
 * Boot: registry → gates → models → resume → world online.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '../bus.js';
import { Registry, Vault } from '../registry.js';
import { Paths, seedDefinitions } from '../paths.js';
import {
  EnvName, NsCommand, ObjectiveState, Plan, Snapshot, PublicSettings, RecurringCircuit,
} from '../contract.js';
import { SecurityManager } from './security.js';
import { Transparency } from './transparency.js';
import { MemoryStore } from './memory.js';
import { ObjectiveCompiler } from './compiler.js';
import { Scheduler } from './scheduler.js';
import { Evolver } from './evolver.js';
import { WorkerRuntime } from '../runtime/worker.js';
import { ModelRouter } from '../models/router.js';
import { FilesystemConnector } from '../connectors/filesystem.js';
import { WebConnector } from '../connectors/web.js';
import { GdocsConnector } from '../connectors/gdocs.js';

const ENGINE_VERSION = '0.1.0';

export class Tower {
  bus: EventBus;
  registry: Registry;
  vault: Vault;
  security: SecurityManager;
  transparency: Transparency;
  memory: MemoryStore;
  router: ModelRouter;
  compiler: ObjectiveCompiler;
  scheduler: Scheduler;
  evolver: Evolver;
  workers: WorkerRuntime;
  gdocs: GdocsConnector;
  private bootedAt = 0;
  private providerStatus: { name: string; ok: boolean; models: string[] }[] = [];
  private sweepTimer: NodeJS.Timeout | null = null;
  private circuitTimer: NodeJS.Timeout | null = null;
  private objSeq = 0;

  constructor(public paths: Paths) {
    this.bus = new EventBus(paths.eventsFile);
    this.registry = new Registry(paths);
    this.vault = new Vault(paths.vaultFile);
    this.security = new SecurityManager(this.bus, this.registry);
    this.transparency = new Transparency(this.bus, this.registry, paths.traces);
    this.memory = new MemoryStore(paths.memoryFile, this.bus);
    this.router = new ModelRouter(
      paths.profiles,
      () => this.registry.data.settings.ollamaUrl,
      () => this.vault.get('anthropicApiKey'),
      () => this.registry.data.settings.anthropicModel,
    );
    this.compiler = new ObjectiveCompiler(this.router, this.memory);
    // the runtime sees the tower/registry only through ports (Q5)
    this.workers = new WorkerRuntime(
      this.bus,
      {
        readSkill: (name) => this.registry.readSkill(name),
        recordSkillUse: (name, pass) => this.registry.recordSkillUse(name, pass),
        putBlob: (content) => this.registry.blobs.put(content),
      },
      this.security,
      this.transparency,
      this.router,
      {
        onCanaryRollback: (skillName, meta) => {
          const reverted = this.registry.rollbackSkill(skillName);
          if (reverted) {
            this.bus.emit('skill.rolledback', {
              name: skillName,
              fromVersion: reverted.fromVersion,
              toVersion: reverted.toVersion,
              reason: 'canary regressed past its baseline on live traffic',
            }, meta);
          }
        },
      },
    );
    this.scheduler = new Scheduler(this.bus, this.registry, this.workers, this.security, this.transparency, this.memory);
    this.evolver = new Evolver(this.bus, this.registry, this.router, paths.workspaces, paths.traces);
    this.scheduler.onObjectiveSettled = (obj) => this.maybeAutoEvolve(obj);
    this.scheduler.onStepExhausted = async (obj, plan, step) => {
      try { return await this.compiler.redecompose(obj, plan, step); }
      catch { return null; }
    };
    this.gdocs = new GdocsConnector({
      getClientId: () => this.vault.get('gdocsClientId'),
      getClientSecret: () => this.vault.get('gdocsClientSecret'),
      getTokens: () => {
        const raw = this.vault.get('gdocsTokens');
        try { return raw ? JSON.parse(raw) : undefined; } catch { return undefined; }
      },
      setTokens: (t) => this.vault.set('gdocsTokens', JSON.stringify(t)),
      putBlob: (content) => this.registry.blobs.put(content),
    });
    // the engine's global counters live where the events flow
    this.bus.subscribe((e) => {
      if (e.type === 'validation.failed') {
        this.registry.data.stats.validationsFailed++;
        this.registry.save();
      }
    });
  }

  // ---- boot sequence ------------------------------------------------------
  async boot(): Promise<void> {
    this.bus.open();
    this.bootedAt = Date.now();
    this.bus.emit('engine.boot.started', { version: ENGINE_VERSION });

    // 1 · registry already loaded in constructor; seed factory definitions
    const seeded = seedDefinitions(this.paths);
    if (seeded.length) this.registry.syncSkillsFromDisk();
    this.registry.save();

    // 2 · gates: register + ping each connector (a dead gate never blocks boot)
    const fsConn = new FilesystemConnector();
    const webConn = new WebConnector(() => this.registry.data.settings.webAllowlist);
    this.security.registerConnector(fsConn);
    this.security.registerConnector(webConn);
    this.security.registerConnector(this.gdocs);
    for (const conn of this.security.allConnectors()) {
      const health = await conn.health();
      this.bus.emit('engine.boot.gate', { connector: conn.name, ok: health.ok, detail: health.detail ?? '' });
      if (!health.ok) this.bus.emit('connector.down', { name: conn.name, reason: health.detail ?? 'health check failed' });
    }

    // 3 · models: warm what exists, never block on what doesn't
    this.providerStatus = await this.router.refreshAvailability();
    this.bus.emit('engine.boot.models', { providers: this.providerStatus });

    // 4 · resume: reload live circuits from checkpoints — the world never resets
    const resumed: string[] = [];
    for (const obj of Object.values(this.registry.data.objectives)) {
      if (obj.status === 'running' || obj.status === 'compiling') {
        // steps that were mid-flight restart cleanly from their checkpoint
        for (const s of Object.values(obj.steps)) {
          if (s.status === 'running' || s.status === 'ready') s.status = 'pending';
        }
        resumed.push(obj.id);
        if (obj.plan) {
          void this.scheduler.execute(obj, obj.plan);
        } else {
          void this.compileAndRun(obj);
        }
      }
    }
    // stale gates from a previous process cannot be honored — deny loudly
    for (const gate of this.registry.data.gates) {
      if (gate.status === 'waiting') {
        gate.status = 'denied';
        this.bus.emit('security.gate.denied', { gateId: gate.id, stale: true });
      }
    }
    this.bus.emit('engine.boot.resumed', { objectiveIds: resumed });

    // recurring circuits: memory decay sweep + periodic provider re-check
    this.sweepTimer = setInterval(() => {
      this.memory.sweep();
      void this.router.refreshAvailability().then(s => { this.providerStatus = s; });
    }, 6 * 60 * 60 * 1000);
    // ...and the user's scheduled circuits (Q8): the world never sleeps
    const tickMs = process.env.NEURALSCOPE_FAST === '1' ? 1000 : 30_000;
    this.circuitTimer = setInterval(() => this.tickCircuits(), tickMs);

    this.bus.emit('engine.ready', { ms: Date.now() - this.bootedAt });
  }

  async shutdown(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.circuitTimer) clearInterval(this.circuitTimer);
    this.registry.saveNow();
    this.bus.close();
  }

  /** Fire recurring circuits that have come due. A circuit never stacks:
   *  if its previous objective is still running, the run is skipped forward. */
  private tickCircuits(): void {
    if (this.registry.data.frozen) return;
    const now = Date.now();
    for (const c of this.registry.data.circuits) {
      if (!c.enabled || now < c.nextRunAt) continue;
      c.nextRunAt = now + c.everyMinutes * 60_000;
      const prev = c.lastObjectiveId ? this.registry.data.objectives[c.lastObjectiveId] : undefined;
      if (prev && (prev.status === 'running' || prev.status === 'compiling' || prev.status === 'waiting_approval')) {
        continue;   // skip forward, never pile up
      }
      c.runs++;
      void this.createObjective(c.text, c.env).then(obj => {
        c.lastObjectiveId = obj.id;
        this.registry.save();
      });
    }
    this.registry.save();
  }

  // ---- objectives ----------------------------------------------------------
  async createObjective(text: string, env: EnvName): Promise<ObjectiveState> {
    const id = `OBJ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${(++this.objSeq).toString().padStart(3, '0')}-${Date.now().toString(36).slice(-4)}`;
    const workspace = path.join(this.paths.workspaces, env, id);
    fs.mkdirSync(workspace, { recursive: true });
    const obj: ObjectiveState = {
      id, text: text.slice(0, 2000), env, status: 'compiling', createdAt: Date.now(),
      steps: {}, workspace, modelCalls: 0, estCostUSD: 0, deliverables: [],
    };
    this.registry.data.objectives[id] = obj;
    this.registry.save();
    this.bus.emit('objective.created', { text: obj.text, env, objectiveId: id }, { objectiveId: id, env });
    void this.compileAndRun(obj);
    return obj;
  }

  private async compileAndRun(obj: ObjectiveState): Promise<void> {
    const meta = { objectiveId: obj.id, env: obj.env };
    try {
      obj.status = 'compiling';
      this.bus.emit('plan.compiling', {}, meta);
      const ctrl = new AbortController();
      const untrack = this.security.trackAbort(obj.id, ctrl);
      const { plan } = await this.compiler.compile(obj.id, obj.text, obj.env, ctrl.signal);
      untrack();
      obj.plan = plan;
      obj.modelCalls++;
      this.registry.save();
      this.transparency.trace(obj.id, { ts: Date.now(), kind: 'decision', content: { plan } });
      this.bus.emit('plan.compiled', { plan }, meta);
      await this.scheduler.execute(obj, plan);
    } catch (ex) {
      if (this.registry.data.frozen || obj.status === 'paused') {
        // killed mid-compile: keep it resumable, not failed
        obj.status = 'paused';
        this.registry.saveNow();
        return;
      }
      obj.status = 'failed';
      obj.error = `compile failed: ${String((ex as Error).message ?? ex)}`;
      this.registry.saveNow();
      this.bus.emit('objective.failed', { reason: obj.error }, meta);
    }
  }

  private maybeAutoEvolve(obj: ObjectiveState): void {
    const n = this.registry.data.settings.evolverEveryNObjectives;
    if (n > 0 && this.registry.data.stats.objectivesSinceEvolve >= n && !this.evolver.running) {
      void this.evolver.runCycle(`auto: every ${n} objectives`);
    }
  }

  // ---- command router (the World is a remote control, never a brain) -------
  async handleCommand(cmd: NsCommand): Promise<{ ok: boolean; error?: string; result?: unknown }> {
    const d = cmd.data as Record<string, any>;
    if (this.registry.data.frozen && cmd.cmd !== 'system.resume' && cmd.cmd !== 'snapshot.request') {
      return { ok: false, error: 'engine is frozen by the kill switch — resume first' };
    }
    switch (cmd.cmd) {
      case 'objective.create': {
        const text = String(d.text ?? '').trim();
        if (!text) return { ok: false, error: 'objective text is empty' };
        const env: EnvName = d.env === 'testing' || d.env === 'onetime' ? d.env : 'main';
        const obj = await this.createObjective(text, env);
        return { ok: true, result: { objectiveId: obj.id } };
      }
      case 'objective.cancel': {
        const obj = this.registry.data.objectives[String(d.objectiveId)];
        if (!obj) return { ok: false, error: 'unknown objective' };
        if (obj.status === 'completed' || obj.status === 'failed') return { ok: false, error: 'objective already settled' };
        obj.status = 'cancelled';
        this.registry.save();
        this.scheduler.resume(obj);    // unblock any pause-waiters so it can wind down
        return { ok: true };
      }
      case 'circuit.pause': {
        const obj = this.registry.data.objectives[String(d.objectiveId)];
        if (!obj) return { ok: false, error: 'unknown objective' };
        this.scheduler.pause(obj);
        return { ok: true };
      }
      case 'circuit.resume': {
        const obj = this.registry.data.objectives[String(d.objectiveId)];
        if (!obj) return { ok: false, error: 'unknown objective' };
        this.scheduler.resume(obj);
        // after a kill switch or a process restart, no execute-loop owns this
        // circuit anymore — restart one from the checkpoint once idle
        if (obj.plan) void this.scheduler.executeWhenIdle(obj, obj.plan);
        else if (obj.status === 'running' || obj.status === 'paused') void this.compileAndRun(obj);
        return { ok: true };
      }
      case 'gate.approve':
        return { ok: this.security.resolveGate(String(d.gateId), 'approved') };
      case 'gate.deny':
        return { ok: this.security.resolveGate(String(d.gateId), 'denied') };
      case 'skill.edit': {
        const name = String(d.name ?? '').replace(/[^a-z0-9-]/gi, '');
        const content = String(d.content ?? '');
        if (!name || content.length < 10) return { ok: false, error: 'skill name/content invalid' };
        const row = this.registry.writeSkillVersion(name, content, 'user');
        this.bus.emit('skill.updated', { name, version: row.version, by: 'user' });
        return { ok: true, result: { version: row.version } };
      }
      case 'settings.update': {
        const patch = (d.patch ?? {}) as Record<string, unknown>;
        const s = this.registry.data.settings;
        const touched: string[] = [];
        if (typeof patch.ollamaUrl === 'string') { s.ollamaUrl = patch.ollamaUrl; touched.push('ollamaUrl'); }
        if (typeof patch.anthropicModel === 'string') { s.anthropicModel = patch.anthropicModel; touched.push('anthropicModel'); }
        if (typeof patch.concurrency === 'number') { s.concurrency = Math.max(1, Math.min(8, patch.concurrency)); touched.push('concurrency'); }
        if (typeof patch.evolverEveryNObjectives === 'number') { s.evolverEveryNObjectives = Math.max(0, patch.evolverEveryNObjectives); touched.push('evolverEveryNObjectives'); }
        if (Array.isArray(patch.webAllowlist)) { s.webAllowlist = patch.webAllowlist.map(String).slice(0, 50); touched.push('webAllowlist'); }
        if (typeof patch.tierGraduationThreshold === 'number') {
          s.tierGraduationThreshold = Math.max(1, Math.min(500, patch.tierGraduationThreshold));
          touched.push('tierGraduationThreshold');
        }
        if (typeof patch.anthropicApiKey === 'string') {
          // secret → vault only; never registry, never events, never snapshots
          if (patch.anthropicApiKey.trim() === '') this.vault.delete('anthropicApiKey');
          else this.vault.set('anthropicApiKey', patch.anthropicApiKey.trim());
          touched.push('anthropicApiKey');
        }
        if (typeof patch.gdocsClientId === 'string') {
          if (patch.gdocsClientId.trim() === '') this.vault.delete('gdocsClientId');
          else this.vault.set('gdocsClientId', patch.gdocsClientId.trim());
          touched.push('gdocsClientId');
        }
        if (typeof patch.gdocsClientSecret === 'string') {
          if (patch.gdocsClientSecret.trim() === '') this.vault.delete('gdocsClientSecret');
          else this.vault.set('gdocsClientSecret', patch.gdocsClientSecret.trim());
          touched.push('gdocsClientSecret');
        }
        if (patch.gdocsDisconnect === true) {
          this.vault.delete('gdocsTokens');
          touched.push('gdocsTokens');
        }
        this.registry.save();
        this.providerStatus = await this.router.refreshAvailability();
        this.bus.emit('settings.updated', { keys: touched });
        return { ok: true };
      }
      case 'memory.inject': {
        const text = String(d.text ?? '').trim();
        if (!text) return { ok: false, error: 'memory text empty' };
        const tags = Array.isArray(d.tags) ? d.tags.map(String) : text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3).slice(0, 6);
        this.memory.write(text, tags, 'user');
        return { ok: true };
      }
      case 'evolver.run':
        if (this.evolver.running) return { ok: false, error: 'evolution cycle already running' };
        void this.evolver.runCycle('manual');
        return { ok: true };
      case 'circuit.schedule': {
        const text = String(d.text ?? '').trim();
        const everyMinutes = Number(d.everyMinutes);
        const minEvery = process.env.NEURALSCOPE_FAST === '1' ? 0.02 : 5;
        if (!text) return { ok: false, error: 'circuit text is empty' };
        if (!Number.isFinite(everyMinutes) || everyMinutes < minEvery) {
          return { ok: false, error: `interval must be at least ${minEvery} minutes` };
        }
        const circuit: RecurringCircuit = {
          id: `C${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
          text: text.slice(0, 2000),
          env: d.env === 'testing' || d.env === 'onetime' ? d.env : 'main',
          everyMinutes,
          enabled: true,
          nextRunAt: Date.now() + everyMinutes * 60_000,
          runs: 0,
        };
        this.registry.data.circuits.push(circuit);
        this.registry.save();
        this.bus.emit('circuit.scheduled', {
          circuitId: circuit.id, text: circuit.text, env: circuit.env,
          everyMinutes, nextRunAt: circuit.nextRunAt,
        });
        return { ok: true, result: { circuitId: circuit.id } };
      }
      case 'circuit.unschedule': {
        const id = String(d.circuitId ?? '');
        const before = this.registry.data.circuits.length;
        this.registry.data.circuits = this.registry.data.circuits.filter(c => c.id !== id);
        if (this.registry.data.circuits.length === before) return { ok: false, error: 'unknown circuit' };
        this.registry.save();
        this.bus.emit('circuit.unscheduled', { circuitId: id });
        return { ok: true };
      }
      case 'gdocs.connect': {
        try {
          const { authUrl, done } = this.gdocs.beginAuth();
          void done.then(async () => {
            this.bus.emit('connector.added', { name: 'gdocs', status: 'up' });
            this.providerStatus = await this.router.refreshAvailability();
          }).catch((ex) => {
            this.bus.emit('connector.down', { name: 'gdocs', reason: String((ex as Error).message ?? ex) });
          });
          return { ok: true, result: { authUrl } };
        } catch (ex) {
          return { ok: false, error: String((ex as Error).message ?? ex) };
        }
      }
      case 'system.kill':
        this.security.kill();
        // freeze every live circuit NOW — checkpointed as paused, resumable
        for (const obj of Object.values(this.registry.data.objectives)) {
          if (obj.status === 'running') this.scheduler.pause(obj);
          else if (obj.status === 'compiling') { obj.status = 'paused'; this.registry.save(); }
        }
        return { ok: true };
      case 'system.resume':
        this.security.resume();
        return { ok: true };
      case 'snapshot.request':
        return { ok: true, result: this.snapshot() };
      default:
        return { ok: false, error: `unhandled command ${cmd.cmd}` };
    }
  }

  // ---- snapshot: full world state for a connecting client ------------------
  publicSettings(): PublicSettings {
    const s = this.registry.data.settings;
    return {
      ollamaUrl: s.ollamaUrl,
      hasAnthropicKey: this.vault.has('anthropicApiKey'),
      anthropicModel: s.anthropicModel,
      concurrency: s.concurrency,
      evolverEveryNObjectives: s.evolverEveryNObjectives,
      sandboxEnabled: s.sandboxEnabled,
      webAllowlist: s.webAllowlist,
      dataDir: this.paths.home,
      tierGraduationThreshold: s.tierGraduationThreshold,
      hasGdocsCredentials: this.gdocs.configured(),
      gdocsConnected: this.vault.has('gdocsTokens'),
    };
  }

  snapshot(): Snapshot {
    const reg = this.registry.data;
    const objectives = Object.values(reg.objectives)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 60);
    return {
      schemaVersion: 1,
      engine: { version: ENGINE_VERSION, bootedAt: this.bootedAt, frozen: reg.frozen },
      settings: this.publicSettings(),
      connectors: this.security.allConnectors().map(c => ({
        name: c.name, status: c.enabled ? 'up' : 'disabled', tier: c.baseTier,
      })),
      providers: this.providerStatus.map(p => ({ ...p, active: p.ok })),
      objectives,
      gates: reg.gates.filter(g => g.status === 'waiting').slice(-20),
      skills: reg.skills.map(s => ({
        name: s.name, version: s.version, updatedAt: s.updatedAt,
        preview: this.registry.readSkill(s.name).slice(0, 400),
        status: s.status, attempts: s.attempts, failures: s.failures,
      })),
      memory: this.memory.all().slice(-50).map(m => ({
        id: m.id, summary: m.summary, tags: m.tags, relevance: m.relevance, createdAt: m.createdAt,
      })),
      reports: reg.reports.filter(r => !r.consumedBy).slice(-20).map(r => ({
        id: r.id, target: r.target, kind: r.kind, evidence: r.evidence, createdAt: r.createdAt,
      })),
      evolver: {
        cycles: reg.stats.evolverCycles,
        lastOutcome: reg.evolverLastOutcome,
        running: this.evolver.running,
      },
      circuits: reg.circuits,
      capabilities: reg.capabilities,
      stats: {
        objectivesCompleted: reg.stats.objectivesCompleted,
        stepsCompleted: reg.stats.stepsCompleted,
        validationsFailed: reg.stats.validationsFailed,
        structuresEvolved: reg.stats.structuresEvolved,
      },
    };
  }
}
