/**
 * THE EVENT CONTRACT — v1 (FROZEN)
 * =================================
 * Layer 4. Every Engine action is exactly one event; every event has exactly
 * one visual meaning in the World. Additive changes only; never repurpose a
 * type. The human-readable copy of this contract lives in
 * `definitions/schema/events.v1.json` and must be kept in sync.
 */

export const SCHEMA_VERSION = 1;

export type EnvName = 'main' | 'testing' | 'onetime';

export type EventType =
  // engine lifecycle
  | 'engine.boot.started'
  | 'engine.boot.gate'        // one per connector ping: { connector, ok, detail }
  | 'engine.boot.models'      // { providers: [{name, ok, models?}] }
  | 'engine.boot.resumed'     // { objectiveIds }
  | 'engine.ready'
  | 'engine.killed'           // kill switch engaged
  | 'engine.resumed'          // kill switch released
  | 'engine.error'            // { message }
  // objectives & plans
  | 'objective.created'       // { text, env, objectiveId }
  | 'plan.compiling'
  | 'plan.compiled'           // { plan } — the task graph; this IS the circuit
  | 'objective.completed'     // { deliverables, summary, durationMs, modelCalls }
  | 'objective.failed'        // { reason }
  | 'objective.cancelled'
  | 'output.delivered'        // { paths }
  // circuit execution
  | 'circuit.paused'
  | 'circuit.resumed'
  | 'step.ready'              // { stepId }
  | 'step.started'            // { stepId, task }
  | 'worker.booted'           // { workerId, stepId, profile, model, skills }
  | 'model.called'            // { workerId, stepId, provider, model, promptChars }
  | 'model.responded'         // { workerId, stepId, ms, outputChars }
  | 'step.progress'           // { stepId, summary }
  | 'validation.passed'       // { stepId, checks }
  | 'validation.failed'       // { stepId, reasons, attempt }
  | 'worker.rebooted'         // { workerId, stepId, reason } — ring-2 re-grounding
  | 'step.completed'          // { stepId, summary }
  | 'step.failed'             // { stepId, reason }
  // security
  | 'security.check'          // { ring, subject, ok, detail? }
  | 'security.blocked'        // { ring, subject, reason } — no-go / ring-1 denial
  | 'security.gate.waiting'   // { gateId, tier, action, detail } — amber gate
  | 'security.gate.approved'  // { gateId }
  | 'security.gate.denied'    // { gateId }
  | 'governor.alert'          // { kind, detail } — budget/loop/anomaly
  // transparency, memory, evolution
  | 'report.filed'            // { reportId, target, kind, evidence }
  | 'memory.written'          // { memoryId, summary, tags }
  | 'memory.decayed'          // { memoryId }
  | 'memory.promoted'         // { memoryId, target }
  | 'evolver.cycle.started'   // { cycleId, trigger }
  | 'evolver.captured'        // { cycleId, target, reason }
  | 'evolver.decomposed'      // { cycleId, replayCount }
  | 'evolver.mutated'         // { cycleId, candidates }
  | 'evolver.trial'           // { cycleId, candidate, replay, pass }
  | 'evolver.scored'          // { cycleId, scores }
  | 'evolver.promoted'        // { cycleId, target, version }
  | 'evolver.rejected'        // { cycleId, reason }
  | 'evolver.cycle.completed' // { cycleId, outcome }
  // definitions & connectors
  | 'connector.added'         // { name, status }
  | 'connector.down'          // { name, reason }
  | 'skill.updated'           // { name, version, by }
  | 'profile.updated'         // { name }
  | 'settings.updated'        // { keys } — values never broadcast (secrets)
  | 'engine.snapshot'         // { snapshot } — full world state on WS connect
  // v1 additive (the eight systems, completed)
  | 'skill.canary'            // { name, version, baselineFailRate } — promoted, on probation
  | 'skill.rolledback'        // { name, fromVersion, toVersion, reason } — canary regressed
  | 'capability.graduated'    // { capability, from, to, approvals } — autonomy earned (C→B)
  | 'worker.escalated'        // { stepId, from, to } — recovery ladder: stronger model
  | 'critic.flagged'          // { stepId, issues } — adversarial review before retry
  | 'step.decomposed'         // { stepId, into } — failed step split into smaller steps
  | 'circuit.scheduled'       // { circuitId, text, env, everyMinutes, nextRunAt }
  | 'circuit.unscheduled';    // { circuitId }

export interface NsEvent {
  v: number;            // schema version
  id: string;           // event id, monotonic-ish
  ts: number;           // epoch ms
  type: EventType;
  objectiveId?: string;
  stepId?: string;
  workerId?: string;
  env?: EnvName;
  data: Record<string, unknown>;
}

/** Commands the World may send down the bridge. The World is a remote control, never a brain. */
export type CommandType =
  | 'objective.create'   // { text, env }
  | 'objective.cancel'   // { objectiveId }
  | 'circuit.pause'      // { objectiveId }
  | 'circuit.resume'     // { objectiveId }
  | 'gate.approve'       // { gateId }
  | 'gate.deny'          // { gateId }
  | 'skill.edit'         // { name, content }
  | 'settings.update'    // { patch }
  | 'memory.inject'      // { text, tags }
  | 'evolver.run'        // {}
  | 'system.kill'        // {}
  | 'system.resume'      // {}
  | 'snapshot.request'   // {}
  // v1 additive
  | 'circuit.schedule'   // { text, env, everyMinutes } — recurring circuit
  | 'circuit.unschedule' // { circuitId }
  | 'gdocs.connect';     // {} → { authUrl } — begin loopback OAuth, or error if unconfigured

export interface NsCommand {
  v: number;
  cmd: CommandType;
  reqId?: string;
  data: Record<string, unknown>;
}

const EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  'engine.boot.started', 'engine.boot.gate', 'engine.boot.models', 'engine.boot.resumed',
  'engine.ready', 'engine.killed', 'engine.resumed', 'engine.error',
  'objective.created', 'plan.compiling', 'plan.compiled', 'objective.completed',
  'objective.failed', 'objective.cancelled', 'output.delivered',
  'circuit.paused', 'circuit.resumed', 'step.ready', 'step.started', 'worker.booted',
  'model.called', 'model.responded', 'step.progress', 'validation.passed',
  'validation.failed', 'worker.rebooted', 'step.completed', 'step.failed',
  'security.check', 'security.blocked', 'security.gate.waiting', 'security.gate.approved',
  'security.gate.denied', 'governor.alert',
  'report.filed', 'memory.written', 'memory.decayed', 'memory.promoted',
  'evolver.cycle.started', 'evolver.captured', 'evolver.decomposed', 'evolver.mutated',
  'evolver.trial', 'evolver.scored', 'evolver.promoted', 'evolver.rejected', 'evolver.cycle.completed',
  'connector.added', 'connector.down', 'skill.updated', 'profile.updated', 'settings.updated',
  'engine.snapshot',
  'skill.canary', 'skill.rolledback', 'capability.graduated', 'worker.escalated',
  'critic.flagged', 'step.decomposed', 'circuit.scheduled', 'circuit.unscheduled',
]);

const COMMAND_TYPES: ReadonlySet<string> = new Set<string>([
  'objective.create', 'objective.cancel', 'circuit.pause', 'circuit.resume',
  'gate.approve', 'gate.deny', 'skill.edit', 'settings.update', 'memory.inject',
  'evolver.run', 'system.kill', 'system.resume', 'snapshot.request',
  'circuit.schedule', 'circuit.unschedule', 'gdocs.connect',
]);

export function isValidEventType(t: string): t is EventType { return EVENT_TYPES.has(t); }
export function isValidCommandType(t: string): t is CommandType { return COMMAND_TYPES.has(t); }

/** Validate on emit AND on receive — schema drift must be loud, never silent. */
export function validateEvent(e: NsEvent): string | null {
  if (e.v !== SCHEMA_VERSION) return `schema version mismatch: got ${e.v}, want ${SCHEMA_VERSION}`;
  if (!e.id || !e.ts || !e.type) return 'missing id/ts/type';
  if (!isValidEventType(e.type)) return `unknown event type: ${e.type}`;
  if (typeof e.data !== 'object' || e.data === null) return 'data must be an object';
  return null;
}

export function validateCommand(c: NsCommand): string | null {
  if (c.v !== SCHEMA_VERSION) return `schema version mismatch: got ${c.v}, want ${SCHEMA_VERSION}`;
  if (!c.cmd || !isValidCommandType(c.cmd)) return `unknown command: ${String(c.cmd)}`;
  if (typeof c.data !== 'object' || c.data === null) return 'data must be an object';
  return null;
}

// ---------------------------------------------------------------------------
// Shared domain shapes (the task graph IS the circuit drawn in the World)
// ---------------------------------------------------------------------------

export type StepStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'blocked';
export type ObjectiveStatus =
  | 'compiling' | 'running' | 'paused' | 'waiting_approval'
  | 'completed' | 'failed' | 'cancelled';

export interface PlanStep {
  id: string;                  // "S1"
  task: string;
  worker: string;              // profile name: researcher | writer | coder | validator
  skills: string[];            // skill file names
  connectors: string[];        // allowed connectors for ring-1 gatekeeping
  depends_on: string[];
}

export interface Plan {
  objective_id: string;
  goal: string;
  success_criteria: string[];
  risk: 'low' | 'medium' | 'high';
  environment: EnvName;
  steps: PlanStep[];
}

export interface StepState {
  id: string;
  status: StepStatus;
  attempts: number;
  reboots: number;
  summary: string;
  failures: string[];
  startedAt?: number;
  endedAt?: number;
  outputPreview?: string;
  outputBlob?: string;        // content hash of the full step output (Q1)
  escalatedTo?: string;       // provider/model after a recovery-ladder escalation
}

export interface ObjectiveState {
  id: string;
  text: string;
  env: EnvName;
  status: ObjectiveStatus;
  createdAt: number;
  endedAt?: number;
  plan?: Plan;
  steps: Record<string, StepState>;
  workspace: string;
  modelCalls: number;
  estCostUSD: number;
  deliverables: string[];
  error?: string;
  /** recovery ladder, last rung: a failed step may be re-decomposed once */
  redecomposed?: boolean;
}

export interface GateRequest {
  id: string;
  tier: 'B' | 'C' | 'D';
  action: string;
  detail: string;
  objectiveId?: string;
  stepId?: string;
  createdAt: number;
  status: 'waiting' | 'approved' | 'denied';
}

export interface RecurringCircuit {
  id: string;
  text: string;
  env: EnvName;
  everyMinutes: number;
  enabled: boolean;
  nextRunAt: number;
  lastObjectiveId?: string;
  runs: number;
}

export interface CapabilityLedgerRow {
  capability: string;          // e.g. "web.fetch:offsite"
  tier: 'B' | 'C';             // current effective tier
  consecutiveApprovals: number;
  denials: number;
  graduatedAt?: number;
}

/** Full state pushed to a World client on connect. */
export interface Snapshot {
  schemaVersion: number;
  engine: { version: string; bootedAt: number; frozen: boolean };
  settings: PublicSettings;
  connectors: { name: string; status: 'up' | 'down' | 'disabled'; tier: string; detail?: string }[];
  providers: { name: string; ok: boolean; models: string[]; active: boolean }[];
  objectives: ObjectiveState[];
  gates: GateRequest[];
  skills: {
    name: string; version: number; updatedAt: number; preview: string;
    status: 'stable' | 'canary'; attempts: number; failures: number;
  }[];
  memory: { id: string; summary: string; tags: string[]; relevance: number; createdAt: number }[];
  reports: { id: string; target: string; kind: string; evidence: string; createdAt: number }[];
  evolver: { cycles: number; lastOutcome?: string; running: boolean };
  circuits: RecurringCircuit[];
  capabilities: CapabilityLedgerRow[];
  stats: { objectivesCompleted: number; stepsCompleted: number; validationsFailed: number; structuresEvolved: number };
}

export interface PublicSettings {
  ollamaUrl: string;
  hasAnthropicKey: boolean;     // the key itself NEVER leaves the engine
  anthropicModel: string;
  concurrency: number;
  evolverEveryNObjectives: number;
  sandboxEnabled: boolean;
  webAllowlist: string[];
  dataDir: string;
  tierGraduationThreshold: number;   // consecutive clean approvals before C→B
  hasGdocsCredentials: boolean;      // OAuth client configured (vault-only)
  gdocsConnected: boolean;           // tokens present
}
