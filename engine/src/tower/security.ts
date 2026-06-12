/**
 * Security — three rings + four tiers + the kill switch.
 * Ring 1: per-tool gatekeeping (connector allow-list, path scoping, no-go map).
 * Ring 2: per-worker drift watch (implemented in the worker loop: fail streaks
 *         and repeated outputs trigger a re-grounded reboot).
 * Ring 3: per-environment human gates (Tier C/D pause for approval).
 *
 * THIS MODULE IS NOT EVOLVABLE. The Evolver improves the system's work,
 * never its restraints.
 */
import { EventBus } from '../bus.js';
import { Registry } from '../registry.js';
import { GateRequest } from '../contract.js';
import { Connector, ToolCall, ToolResult } from '../connectors/types.js';

export type ToolDecision =
  | { kind: 'allow' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'gate'; gate: GateRequest };

export class SecurityManager {
  private connectors = new Map<string, Connector>();
  private gateWaiters = new Map<string, (v: 'approved' | 'denied') => void>();
  private abortControllers = new Map<string, Set<AbortController>>();

  constructor(private bus: EventBus, private registry: Registry) {}

  registerConnector(c: Connector): void { this.connectors.set(c.name, c); }
  connector(name: string): Connector | undefined { return this.connectors.get(name); }
  allConnectors(): Connector[] { return [...this.connectors.values()]; }

  // ---- kill switch --------------------------------------------------------
  get frozen(): boolean { return this.registry.data.frozen; }

  trackAbort(objectiveId: string, ctrl: AbortController): () => void {
    let set = this.abortControllers.get(objectiveId);
    if (!set) { set = new Set(); this.abortControllers.set(objectiveId, set); }
    set.add(ctrl);
    return () => set!.delete(ctrl);
  }

  /** Freeze every worker, close every gate, snapshot state. Yours alone. */
  kill(): void {
    this.registry.data.frozen = true;
    this.registry.saveNow();
    for (const set of this.abortControllers.values()) {
      for (const ctrl of set) ctrl.abort(new Error('kill switch'));
    }
    // deny all waiting gates — nothing proceeds through a frozen engine
    for (const [gateId, resolve] of this.gateWaiters) {
      const gate = this.registry.data.gates.find(g => g.id === gateId);
      if (gate && gate.status === 'waiting') gate.status = 'denied';
      resolve('denied');
    }
    this.gateWaiters.clear();
    this.bus.emit('engine.killed', { at: Date.now() });
  }

  resume(): void {
    this.registry.data.frozen = false;
    this.registry.saveNow();
    this.bus.emit('engine.resumed', { at: Date.now() });
  }

  // ---- ring 1 + ring 3: every tool call passes through here ---------------
  decide(call: ToolCall, allowedConnectors: string[]): ToolDecision {
    if (this.frozen) return { kind: 'blocked', reason: 'engine frozen by kill switch' };

    const conn = this.connectors.get(call.connector);
    if (!conn || !conn.enabled) {
      this.bus.emit('security.blocked', { ring: 1, subject: call.connector, reason: 'connector unavailable' },
        { objectiveId: call.objectiveId, stepId: call.stepId });
      return { kind: 'blocked', reason: `connector ${call.connector} unavailable` };
    }
    // ring 1: is this connector in the step's flight plan?
    if (!allowedConnectors.includes(call.connector)) {
      this.bus.emit('security.blocked',
        { ring: 1, subject: `${call.connector}.${call.tool}`, reason: 'connector not in step allow-list' },
        { objectiveId: call.objectiveId, stepId: call.stepId });
      return { kind: 'blocked', reason: `step may not use connector ${call.connector}` };
    }
    const tier = conn.tierFor(call);
    if (tier === 'blocked' || tier === 'D') {
      this.bus.emit('security.blocked',
        { ring: 1, subject: `${call.connector}.${call.tool}`, reason: tier === 'D' ? 'tier D is human-only' : 'no-go map' },
        { objectiveId: call.objectiveId, stepId: call.stepId });
      return { kind: 'blocked', reason: 'action on the no-go map' };
    }
    if (tier === 'A') {
      this.bus.emit('security.check',
        { ring: 1, subject: `${call.connector}.${call.tool}`, ok: true },
        { objectiveId: call.objectiveId, stepId: call.stepId });
      return { kind: 'allow' };
    }
    if (tier === 'B') {
      // autonomous but loudly visible
      this.bus.emit('security.check',
        { ring: 1, subject: `${call.connector}.${call.tool}`, ok: true, detail: 'tier B — executed with notification' },
        { objectiveId: call.objectiveId, stepId: call.stepId });
      return { kind: 'allow' };
    }
    // tier C — amber gate, wait for the human
    const gate: GateRequest = {
      id: `G${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
      tier: 'C',
      action: `${call.connector}.${call.tool}`,
      detail: summarizeArgs(call),
      objectiveId: call.objectiveId,
      stepId: call.stepId,
      createdAt: Date.now(),
      status: 'waiting',
    };
    this.registry.data.gates.push(gate);
    this.registry.save();
    this.bus.emit('security.gate.waiting',
      { gateId: gate.id, tier: gate.tier, action: gate.action, detail: gate.detail },
      { objectiveId: call.objectiveId, stepId: call.stepId });
    return { kind: 'gate', gate };
  }

  waitForGate(gateId: string, signal?: AbortSignal): Promise<'approved' | 'denied'> {
    return new Promise(resolve => {
      const existing = this.registry.data.gates.find(g => g.id === gateId);
      if (existing && existing.status !== 'waiting') {
        resolve(existing.status);
        return;
      }
      this.gateWaiters.set(gateId, resolve);
      signal?.addEventListener('abort', () => {
        if (this.gateWaiters.delete(gateId)) resolve('denied');
      }, { once: true });
    });
  }

  resolveGate(gateId: string, decision: 'approved' | 'denied'): boolean {
    const gate = this.registry.data.gates.find(g => g.id === gateId);
    if (!gate || gate.status !== 'waiting') return false;
    gate.status = decision;
    this.registry.save();
    this.bus.emit(decision === 'approved' ? 'security.gate.approved' : 'security.gate.denied',
      { gateId }, { objectiveId: gate.objectiveId, stepId: gate.stepId });
    const waiter = this.gateWaiters.get(gateId);
    if (waiter) { this.gateWaiters.delete(gateId); waiter(decision); }
    return true;
  }

  /** Full gated tool invocation: decide → (maybe wait) → invoke. */
  async invokeTool(call: ToolCall, allowedConnectors: string[], signal?: AbortSignal): Promise<ToolResult> {
    const decision = this.decide(call, allowedConnectors);
    if (decision.kind === 'blocked') return { ok: false, error: decision.reason };
    if (decision.kind === 'gate') {
      const verdict = await this.waitForGate(decision.gate.id, signal);
      if (verdict === 'denied') return { ok: false, error: `denied at tier-C gate (${decision.gate.action})` };
    }
    const conn = this.connectors.get(call.connector)!;
    return conn.invoke(call);
  }
}

function summarizeArgs(call: ToolCall): string {
  const a = call.args;
  if (call.tool === 'fetch') return `GET ${String(a.url ?? '')}`.slice(0, 200);
  if (call.tool === 'delete') return `delete ${String(a.path ?? '')}`.slice(0, 200);
  return JSON.stringify(a).slice(0, 200);
}
