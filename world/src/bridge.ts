/**
 * The World's end of the bridge: one WebSocket up to the Engine.
 * Receives the snapshot, then live events; sends commands; holds the single
 * client-side state store both the panels (React) and the 3D scene read.
 * The World renders reality — it never invents it.
 */
import type {
  NsEvent, NsCommand, CommandType, Snapshot, ObjectiveState, GateRequest,
} from '../../engine/src/contract';

export interface TickerLine { id: string; ts: number; text: string; tone: 'info' | 'good' | 'bad' | 'warn' }
export interface Toast { id: string; title: string; body?: string; tone: 'info' | 'good' | 'bad' | 'warn'; objectiveId?: string }

export interface WorldState {
  connected: boolean;
  frozen: boolean;
  snapshot: Snapshot | null;
  objectives: ObjectiveState[];
  gates: GateRequest[];
  ticker: TickerLine[];
  toasts: Toast[];
  evolverPhase: string | null;     // live phase label while a cycle animates
  selected: Selection | null;
  firstRun: boolean;
}

export type Selection =
  | { kind: 'step'; objectiveId: string; stepId: string }
  | { kind: 'circuit'; objectiveId: string }
  | { kind: 'gate'; gateId: string }
  | { kind: 'evolver' }
  | { kind: 'memory'; memoryId: string }
  | { kind: 'connector'; name: string };

type SceneListener = (e: NsEvent) => void;

const SNAPSHOT_REFRESH_ON = new Set([
  'objective.completed', 'objective.failed', 'objective.cancelled', 'skill.updated',
  'settings.updated', 'evolver.cycle.completed', 'memory.decayed', 'engine.ready',
]);

export class Bridge {
  state: WorldState = {
    connected: false, frozen: false, snapshot: null, objectives: [], gates: [],
    ticker: [], toasts: [], evolverPhase: null, selected: null,
    firstRun: localStorage.getItem('ns.onboarded') !== '1',
  };

  private ws: WebSocket | null = null;
  private subs = new Set<() => void>();
  private sceneSubs = new Set<SceneListener>();
  private reqSeq = 0;
  private pending = new Map<string, (res: any) => void>();
  private refreshTimer: number | null = null;
  private retryMs = 800;

  // ---- store plumbing (React useSyncExternalStore-compatible) -------------
  subscribe = (fn: () => void): (() => void) => { this.subs.add(fn); return () => this.subs.delete(fn); };
  getState = (): WorldState => this.state;
  private bump(patch: Partial<WorldState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.subs) fn();
  }

  onSceneEvent(fn: SceneListener): () => void { this.sceneSubs.add(fn); return () => this.sceneSubs.delete(fn); }

  select(sel: Selection | null): void { this.bump({ selected: sel }); }
  dismissToast(id: string): void { this.bump({ toasts: this.state.toasts.filter(t => t.id !== id) }); }
  completeOnboarding(): void { localStorage.setItem('ns.onboarded', '1'); this.bump({ firstRun: false }); }

  // ---- connection ----------------------------------------------------------
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => { this.retryMs = 800; this.bump({ connected: true }); };
    ws.onclose = () => {
      this.bump({ connected: false });
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(8000, this.retryMs * 1.6);
    };
    ws.onmessage = (msg) => {
      let parsed: any;
      try { parsed = JSON.parse(msg.data); } catch { return; }
      if (parsed && typeof parsed.ack !== 'undefined') {
        const fn = this.pending.get(parsed.ack);
        if (fn) { this.pending.delete(parsed.ack); fn(parsed); }
        return;
      }
      if (parsed && parsed.type) this.applyEvent(parsed as NsEvent);
    };
  }

  send(cmd: CommandType, data: Record<string, unknown> = {}): Promise<{ ok: boolean; error?: string; result?: any }> {
    return new Promise((resolve) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        resolve({ ok: false, error: 'not connected to the engine' });
        return;
      }
      const reqId = `r${++this.reqSeq}`;
      this.pending.set(reqId, resolve);
      const payload: NsCommand = { v: 1, cmd, reqId, data };
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.delete(reqId)) resolve({ ok: false, error: 'engine did not acknowledge (timeout)' });
      }, 20_000);
    });
  }

  // ---- event application ----------------------------------------------------
  private applyEvent(e: NsEvent): void {
    if (e.type === 'engine.snapshot') {
      const snap = (e.data as any).snapshot as Snapshot;
      this.bump({
        snapshot: snap,
        frozen: snap.engine.frozen,
        objectives: snap.objectives,
        gates: snap.gates,
      });
      for (const fn of this.sceneSubs) fn(e);
      return;
    }

    const objectives = this.applyToObjectives(e);
    let { gates, frozen, evolverPhase } = this.state;

    switch (e.type) {
      case 'security.gate.waiting':
        gates = [...gates, {
          id: String(e.data.gateId), tier: e.data.tier as any, action: String(e.data.action),
          detail: String(e.data.detail ?? ''), objectiveId: e.objectiveId, stepId: e.stepId,
          createdAt: e.ts, status: 'waiting',
        }];
        this.toast({ title: 'Approval needed', body: `${e.data.action} — ${e.data.detail}`, tone: 'warn' });
        break;
      case 'security.gate.approved':
      case 'security.gate.denied':
        gates = gates.filter(g => g.id !== String(e.data.gateId));
        break;
      case 'engine.killed':
        frozen = true;
        this.toast({ title: 'KILL SWITCH ENGAGED', body: 'All workers frozen. All gates closed.', tone: 'bad' });
        break;
      case 'engine.resumed':
        frozen = false;
        this.toast({ title: 'Engine resumed', tone: 'good' });
        break;
      case 'objective.completed':
        this.toast({
          title: 'Objective completed', tone: 'good', objectiveId: e.objectiveId,
          body: `${(e.data.deliverables as string[] ?? []).length} files delivered in ${Math.round(Number(e.data.durationMs ?? 0) / 1000)}s`,
        });
        break;
      case 'objective.failed':
        this.toast({ title: 'Objective failed', body: String(e.data.reason ?? ''), tone: 'bad', objectiveId: e.objectiveId });
        break;
      case 'governor.alert':
        this.toast({ title: `Governor: ${e.data.kind}`, body: String(e.data.detail ?? ''), tone: 'warn' });
        break;
      case 'evolver.cycle.started': evolverPhase = 'cycle starting'; break;
      case 'evolver.captured': evolverPhase = `captured ${e.data.target}`; break;
      case 'evolver.decomposed': evolverPhase = `replaying ${e.data.replayCount} recorded failures`; break;
      case 'evolver.mutated': evolverPhase = `${e.data.candidates} candidates in trial`; break;
      case 'evolver.trial': evolverPhase = `trial: ${e.data.candidate} on replay ${e.data.replay} → ${e.data.pass ? 'pass' : 'fail'}`; break;
      case 'evolver.scored': evolverPhase = 'scoring against the incumbent'; break;
      case 'evolver.promoted':
        evolverPhase = `PROMOTED ${e.data.target} → v${e.data.version}`;
        this.toast({ title: 'Structure evolved', body: `${e.data.target} promoted to v${e.data.version} after winning its trials`, tone: 'good' });
        break;
      case 'evolver.rejected': evolverPhase = String(e.data.reason ?? 'incumbent held'); break;
      case 'evolver.cycle.completed': setTimeout(() => this.bump({ evolverPhase: null }), 6000); break;
    }

    const ticker = this.tickerLine(e);
    this.bump({
      objectives, gates, frozen, evolverPhase,
      ticker: ticker ? [...this.state.ticker.slice(-8), ticker] : this.state.ticker,
    });

    for (const fn of this.sceneSubs) fn(e);

    if (SNAPSHOT_REFRESH_ON.has(e.type)) this.scheduleRefresh();
  }

  private applyToObjectives(e: NsEvent): ObjectiveState[] {
    if (!e.objectiveId) return this.state.objectives;
    let list = this.state.objectives;
    const idx = list.findIndex(o => o.id === e.objectiveId);

    if (e.type === 'objective.created') {
      if (idx >= 0) return list;
      const obj: ObjectiveState = {
        id: e.objectiveId, text: String(e.data.text ?? ''), env: (e.env ?? 'main') as any,
        status: 'compiling', createdAt: e.ts, steps: {}, workspace: '',
        modelCalls: 0, estCostUSD: 0, deliverables: [],
      };
      return [obj, ...list];
    }
    if (idx < 0) return list;
    const obj = { ...list[idx], steps: { ...list[idx].steps } };

    const touchStep = (stepId: string | undefined, fn: (s: any) => void) => {
      if (!stepId) return;
      const cur = obj.steps[stepId] ?? {
        id: stepId, status: 'pending', attempts: 0, reboots: 0, summary: '', failures: [],
      };
      const next = { ...cur };
      fn(next);
      obj.steps[stepId] = next;
    };

    switch (e.type) {
      case 'plan.compiled':
        obj.plan = (e.data as any).plan;
        obj.status = 'running';
        for (const s of obj.plan!.steps) {
          if (!obj.steps[s.id]) obj.steps[s.id] = { id: s.id, status: 'pending', attempts: 0, reboots: 0, summary: '', failures: [] };
        }
        break;
      case 'step.ready': touchStep(e.stepId, s => { s.status = 'ready'; }); break;
      case 'step.started': touchStep(e.stepId, s => { s.status = 'running'; s.startedAt = e.ts; }); break;
      case 'worker.booted': touchStep(e.stepId, s => { s.model = String((e.data as any).model); s.profile = String((e.data as any).profile); }); break;
      case 'step.progress': touchStep(e.stepId, s => { s.summary = String(e.data.summary ?? ''); }); break;
      case 'validation.failed': touchStep(e.stepId, s => {
        s.attempts = Number(e.data.attempt ?? s.attempts);
        s.failures = [...s.failures, ...(e.data.reasons as string[] ?? [])].slice(-8);
      }); break;
      case 'worker.rebooted': touchStep(e.stepId, s => { s.reboots++; }); break;
      case 'step.completed': touchStep(e.stepId, s => { s.status = 'completed'; s.summary = String(e.data.summary ?? s.summary); s.endedAt = e.ts; }); break;
      case 'step.failed': touchStep(e.stepId, s => { s.status = 'failed'; s.summary = String(e.data.reason ?? s.summary); s.endedAt = e.ts; }); break;
      case 'circuit.paused': obj.status = 'paused'; break;
      case 'circuit.resumed': obj.status = 'running'; break;
      case 'objective.completed':
        obj.status = 'completed';
        obj.deliverables = (e.data.deliverables as string[]) ?? [];
        obj.endedAt = e.ts;
        break;
      case 'objective.failed': obj.status = 'failed'; obj.error = String(e.data.reason ?? ''); obj.endedAt = e.ts; break;
      case 'objective.cancelled': obj.status = 'cancelled'; obj.endedAt = e.ts; break;
      case 'model.called': obj.modelCalls++; break;
      default: return list;
    }
    list = [...list];
    list[idx] = obj;
    return list;
  }

  private tickerLine(e: NsEvent): TickerLine | null {
    const mk = (text: string, tone: TickerLine['tone'] = 'info'): TickerLine =>
      ({ id: e.id, ts: e.ts, text, tone });
    const short = (s: unknown, n = 64) => String(s ?? '').slice(0, n);
    switch (e.type) {
      case 'objective.created': return mk(`◉ objective filed: ${short(e.data.text, 56)}`, 'info');
      case 'plan.compiled': return mk(`flight plan compiled — ${(e.data as any).plan.steps.length} steps`, 'info');
      case 'worker.booted': return mk(`worker ${short((e.data as any).profile, 16)} ignited on ${short((e.data as any).model, 36)}`, 'info');
      case 'validation.passed': return mk(`✓ validation passed (${e.stepId})`, 'good');
      case 'validation.failed': return mk(`✗ validation failed (${e.stepId}): ${short((e.data.reasons as string[])?.[0], 48)}`, 'bad');
      case 'worker.rebooted': return mk(`⟳ worker rebooted — re-grounded on the objective`, 'warn');
      case 'step.completed': return mk(`step ${e.stepId} done: ${short(e.data.summary, 50)}`, 'good');
      case 'step.failed': return mk(`step ${e.stepId} FAILED`, 'bad');
      case 'objective.completed': return mk(`■ objective complete — outputs delivered`, 'good');
      case 'security.check': return null;
      case 'security.blocked': return mk(`⛔ blocked: ${short(e.data.subject, 32)} (${short(e.data.reason, 36)})`, 'bad');
      case 'security.gate.waiting': return mk(`⚠ amber gate: ${short(e.data.action, 40)} awaits you`, 'warn');
      case 'report.filed': return mk(`red thread: ${short(e.data.evidence, 56)}`, 'warn');
      case 'memory.written': return mk(`memory crystal: ${short(e.data.summary, 52)}`, 'info');
      case 'skill.updated': return mk(`skill ${e.data.name} → v${e.data.version} (${e.data.by})`, 'good');
      case 'evolver.cycle.started': return mk(`the evolver wakes (${short(e.data.trigger, 30)})`, 'info');
      case 'evolver.promoted': return mk(`★ EVOLVED: ${short(e.data.target, 30)} → v${e.data.version}`, 'good');
      case 'governor.alert': return mk(`governor: ${short(e.data.detail, 56)}`, 'warn');
      default: return null;
    }
  }

  private toast(t: Omit<Toast, 'id'>): void {
    const toast: Toast = { ...t, id: `t${Date.now()}${Math.random().toString(36).slice(2, 5)}` };
    this.bump({ toasts: [...this.state.toasts.slice(-3), toast] });
    setTimeout(() => this.dismissToast(toast.id), t.tone === 'bad' || t.tone === 'warn' ? 12_000 : 7_000);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = window.setTimeout(async () => {
      this.refreshTimer = null;
      const res = await this.send('snapshot.request');
      if (res.ok && res.result) {
        const snap = res.result as Snapshot;
        this.bump({ snapshot: snap, objectives: snap.objectives, gates: snap.gates, frozen: snap.engine.frozen });
      }
    }, 700);
  }
}

export const bridge = new Bridge();

// desktop integration (Electron preload exposes this; browser mode falls back)
export const desktop: { isDesktop: boolean; openPath?: (p: string) => void; openExternal?: (u: string) => void } =
  (window as any).neuralscope ?? { isDesktop: false };
