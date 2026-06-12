/**
 * The Scheduler — dependency resolution with real parallelism, bounded by a
 * global concurrency limit; checkpoints after every step so a restart resumes
 * instead of resets. The embedded governor watches budgets: runaway loops and
 * costs pause the circuit and alert, they never silently burn.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '../bus.js';
import { Registry } from '../registry.js';
import { ObjectiveState, Plan, PlanStep } from '../contract.js';
import { WorkerRuntime } from '../runtime/worker.js';
import { SecurityManager } from './security.js';
import { Transparency } from './transparency.js';
import { MemoryStore } from './memory.js';

const BUDGET_MODEL_CALLS_BASE = 40;
const BUDGET_MINUTES = 30;

export class Scheduler {
  private running = 0;
  private waiters: (() => void)[] = [];
  private pauseWaiters = new Map<string, (() => void)[]>();
  private active = new Set<string>();
  private loopDone = new Map<string, Promise<void>>();
  onObjectiveSettled: (obj: ObjectiveState) => void = () => {};

  /** True while an execute() loop owns this objective. */
  isActive(objectiveId: string): boolean { return this.active.has(objectiveId); }

  /** Restart execution once any previous loop has fully unwound (used by
   *  circuit.resume after a kill switch or a process restart). */
  async executeWhenIdle(obj: ObjectiveState, plan: Plan): Promise<void> {
    const prior = this.loopDone.get(obj.id);
    if (prior) await prior;
    if (!this.active.has(obj.id) && obj.status === 'running') {
      await this.execute(obj, plan);
    }
  }

  constructor(
    private bus: EventBus,
    private registry: Registry,
    private workers: WorkerRuntime,
    private security: SecurityManager,
    private transparency: Transparency,
    private memory: MemoryStore,
  ) {}

  private get concurrency(): number { return Math.max(1, this.registry.data.settings.concurrency); }

  private async acquire(): Promise<void> {
    if (this.running < this.concurrency) { this.running++; return; }
    await new Promise<void>(r => this.waiters.push(r));
    this.running++;
  }

  private release(): void {
    this.running--;
    this.waiters.shift()?.();
  }

  pause(obj: ObjectiveState): void {
    if (obj.status === 'running') {
      obj.status = 'paused';
      this.registry.save();
      this.bus.emit('circuit.paused', {}, { objectiveId: obj.id, env: obj.env });
    }
  }

  resume(obj: ObjectiveState): void {
    if (obj.status === 'paused') {
      obj.status = 'running';
      this.registry.save();
      this.bus.emit('circuit.resumed', {}, { objectiveId: obj.id, env: obj.env });
      for (const w of this.pauseWaiters.get(obj.id) ?? []) w();
      this.pauseWaiters.delete(obj.id);
    }
  }

  private async waitWhilePaused(obj: ObjectiveState, signal: AbortSignal): Promise<void> {
    while (obj.status === 'paused' && !signal.aborted) {
      await new Promise<void>(r => {
        const list = this.pauseWaiters.get(obj.id) ?? [];
        list.push(r);
        this.pauseWaiters.set(obj.id, list);
        signal.addEventListener('abort', () => r(), { once: true });
      });
    }
  }

  /** Execute a compiled plan to completion (or failure/pause/cancel). */
  async execute(obj: ObjectiveState, plan: Plan): Promise<void> {
    if (this.active.has(obj.id)) return;   // one loop per circuit, ever
    this.active.add(obj.id);
    let resolveDone!: () => void;
    this.loopDone.set(obj.id, new Promise<void>(r => { resolveDone = r; }));
    const ctrl = new AbortController();
    const untrack = this.security.trackAbort(obj.id, ctrl);
    const startedAt = Date.now();
    const meta = { objectiveId: obj.id, env: obj.env };

    // initialize step states that aren't already checkpointed
    for (const s of plan.steps) {
      if (!obj.steps[s.id] || obj.steps[s.id].status === 'running' || obj.steps[s.id].status === 'ready') {
        obj.steps[s.id] = {
          id: s.id, status: obj.steps[s.id]?.status === 'completed' ? 'completed' : 'pending',
          attempts: 0, reboots: 0, summary: '', failures: [],
          ...(obj.steps[s.id]?.status === 'completed' ? obj.steps[s.id] : {}),
        };
      }
    }
    obj.status = 'running';
    this.registry.save();

    const inFlight = new Map<string, Promise<void>>();
    const budgetCalls = BUDGET_MODEL_CALLS_BASE + plan.steps.length * 10;

    const runStep = async (step: PlanStep): Promise<void> => {
      await this.acquire();
      try {
        if (ctrl.signal.aborted || this.isSettled(obj)) return;
        await this.waitWhilePaused(obj, ctrl.signal);
        if (ctrl.signal.aborted || this.isSettled(obj)) return;

        const st = obj.steps[step.id];
        st.status = 'running';
        st.startedAt = Date.now();
        this.registry.save();

        const result = await this.workers.runStep(obj, plan, step, ctrl.signal);

        st.endedAt = Date.now();
        if (result.ok) {
          st.status = 'completed';
          st.summary = result.summary;
          this.registry.data.stats.stepsCompleted++;
          this.bus.emit('step.completed', { stepId: step.id, summary: result.summary }, meta);
        } else if (!ctrl.signal.aborted) {
          st.status = 'failed';
          st.summary = result.failure ?? 'failed';
          this.bus.emit('step.failed', { stepId: step.id, reason: st.summary }, meta);
        }
        this.registry.save();   // checkpoint after every step
      } finally {
        this.release();
      }
    };

    try {
      // dependency-driven dispatch loop
      while (!ctrl.signal.aborted && !this.isSettled(obj)) {
        await this.waitWhilePaused(obj, ctrl.signal);
        if ((obj.status as string) === 'cancelled') break;

        // governor: budget rings
        const minutes = (Date.now() - startedAt) / 60_000;
        if (obj.modelCalls > budgetCalls || minutes > BUDGET_MINUTES) {
          this.bus.emit('governor.alert', {
            kind: obj.modelCalls > budgetCalls ? 'model-call-budget' : 'time-budget',
            detail: `objective paused at ${obj.modelCalls} calls / ${minutes.toFixed(1)} min — resume manually to continue`,
          }, meta);
          this.pause(obj);
          continue;
        }

        const states = plan.steps.map(s => obj.steps[s.id]);
        if (states.some(s => s.status === 'failed')) {
          // a failed step fails the objective unless unreachable branches remain
          obj.status = 'failed';
          obj.error = states.find(s => s.status === 'failed')?.summary;
          break;
        }
        if (states.every(s => s.status === 'completed')) {
          obj.status = 'completed';
          break;
        }

        const ready = plan.steps.filter(s =>
          obj.steps[s.id].status === 'pending' &&
          s.depends_on.every(d => obj.steps[d].status === 'completed'));

        for (const step of ready) {
          obj.steps[step.id].status = 'ready';
          this.bus.emit('step.ready', { stepId: step.id }, meta);
          inFlight.set(step.id, runStep(step).finally(() => inFlight.delete(step.id)));
        }

        if (inFlight.size === 0 && ready.length === 0) {
          // nothing runnable and nothing running → deadlock guard
          if (!states.some(s => s.status === 'running' || s.status === 'ready')) {
            obj.status = 'failed';
            obj.error = 'no runnable steps remain (dependency deadlock)';
            break;
          }
        }
        await Promise.race([...inFlight.values(), sleep(120)]);
      }

      if (ctrl.signal.aborted && obj.status === 'running' && this.registry.data.frozen) {
        // kill switch: leave checkpointed as paused; resumable by you alone.
        // The Tower pauses circuits at kill time; this belt only applies if
        // the engine is STILL frozen — a circuit resumed after a thaw must
        // not be re-paused by its old, dying loop.
        obj.status = 'paused';
      }
    } finally {
      untrack();
      await Promise.allSettled([...inFlight.values()]);
      this.active.delete(obj.id);
      this.finishObjective(obj, plan, startedAt);
      resolveDone();
    }
  }

  private isSettled(obj: ObjectiveState): boolean {
    return obj.status === 'completed' || obj.status === 'failed' || obj.status === 'cancelled';
  }

  private finishObjective(obj: ObjectiveState, plan: Plan, startedAt: number): void {
    const meta = { objectiveId: obj.id, env: obj.env };
    if (obj.status === 'completed') {
      obj.endedAt = Date.now();
      obj.deliverables = this.listDeliverables(obj.workspace);
      this.registry.data.stats.objectivesCompleted++;
      this.registry.data.stats.objectivesSinceEvolve++;
      this.bus.emit('output.delivered', { paths: obj.deliverables }, meta);
      this.bus.emit('objective.completed', {
        deliverables: obj.deliverables,
        summary: plan.goal,
        durationMs: Date.now() - startedAt,
        modelCalls: obj.modelCalls,
      }, meta);
      // the trace becomes fuel: episodic memory (skipped for one-time jobs)
      if (obj.env !== 'onetime') {
        const failed = Object.values(obj.steps).some(s => s.failures.length > 0);
        const tags = plan.goal.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3).slice(0, 6);
        this.memory.write(
          `Delivered "${plan.goal}" (${obj.modelCalls} model calls${failed ? ', recovered from validation failures' : ''}).`,
          tags, 'objective', { objectiveId: obj.id });
      }
    } else if (obj.status === 'failed') {
      obj.endedAt = Date.now();
      this.bus.emit('objective.failed', { reason: obj.error ?? 'unknown' }, meta);
    } else if (obj.status === 'cancelled') {
      obj.endedAt = Date.now();
      this.bus.emit('objective.cancelled', {}, meta);
    }
    this.transparency.analyze(obj.id);   // failures → reports → Evolver feed
    this.registry.saveNow();
    this.onObjectiveSettled(obj);
  }

  private listDeliverables(workspace: string): string[] {
    const out: string[] = [];
    const walk = (dir: string, prefix: string) => {
      let entries: fs.Dirent[] = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
        else out.push(`${prefix}${e.name}`);
      }
    };
    walk(workspace, '');
    return out;
  }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
