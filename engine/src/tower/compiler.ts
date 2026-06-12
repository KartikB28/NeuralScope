/**
 * The Objective Compiler — one call to the strongest available model with one
 * job: turn human intent into a machine-readable flight plan (task graph).
 * The output is sanitized hard: the model proposes, deterministic code
 * disposes. The compiled JSON literally IS the circuit drawn in the World.
 */
import { EnvName, ObjectiveState, Plan, PlanStep } from '../contract.js';
import { ModelRouter } from '../models/router.js';
import { extractJson } from '../runtime/validators.js';
import { MemoryStore } from './memory.js';

const KNOWN_WORKERS = new Set(['researcher', 'writer', 'coder', 'validator']);
const KNOWN_CONNECTORS = new Set(['filesystem', 'web', 'gdocs']);
const SKILL_FOR: Record<string, string[]> = {
  researcher: ['web-research'],
  writer: ['copywriting'],
  coder: ['frontend'],
  validator: ['qa-validation'],
};
const MAX_STEPS = 8;

const PLANNER_SYSTEM = `You are the Objective Compiler of a multi-agent work system.
Turn the user's objective into a flight plan. Respond with ONLY a JSON object:
{
  "goal": "the goal restated precisely",
  "success_criteria": ["verifiable criterion", ...],   // 3-6, each checkable against produced files
  "risk": "low" | "medium" | "high",
  "steps": [
    { "id": "S1", "task": "...", "worker": "researcher|writer|coder|validator",
      "skills": ["skill-name"], "connectors": ["web"|"filesystem"], "depends_on": [] }
  ]
}
Rules: 3-${MAX_STEPS} steps; independent steps may share dependencies to run in parallel;
the FINAL step must be a "validator" checking every success criterion;
"coder" steps write files (give them "filesystem"); research steps that need the
live web get "web". Keep criteria concrete: file names, required elements, counts.`;

export class ObjectiveCompiler {
  constructor(private router: ModelRouter, private memory: MemoryStore) {}

  async compile(objectiveId: string, text: string, env: EnvName, signal?: AbortSignal): Promise<{ plan: Plan; providerName: string }> {
    const recalled = this.memory.recall(text, 3);
    const memoryBlock = recalled.length
      ? `\n\nRELEVANT PAST EXPERIENCE (use it):\n${recalled.map(m => `- ${m.summary}`).join('\n')}`
      : '';

    const resolved = await this.router.resolve('planner');
    const res = await this.router.call(resolved, {
      role: 'planner',
      system: PLANNER_SYSTEM,
      user: `OBJECTIVE: ${text}${memoryBlock}`,
      wantJson: true,
      attempt: 1,
      signal,
    });

    const raw = extractJson(res.text) as Partial<Plan> | null;
    const plan = this.sanitize(objectiveId, text, env, raw);
    return { plan, providerName: resolved.providerName };
  }

  /** Recovery ladder, last rung (Q7): split an exhausted step into 2–3
   *  smaller steps. Mutates the plan in place; returns the new step ids,
   *  or null if no usable decomposition came back. */
  async redecompose(obj: ObjectiveState, plan: Plan, failed: PlanStep, signal?: AbortSignal): Promise<string[] | null> {
    const failures = (obj.steps[failed.id]?.failures ?? []).slice(-5);
    const resolved = await this.router.resolve('planner');
    let rawSteps: Partial<PlanStep>[] = [];
    try {
      const res = await this.router.call(resolved, {
        role: 'planner',
        system: 'A step in a work plan keeps failing. REDECOMPOSE it into 2-3 smaller, more focused steps for the SAME worker type. Respond with ONLY JSON: {"steps":[{"id":"R1","task":"...","worker":"...","skills":[...],"connectors":[...],"depends_on":[]}]}. Make each sub-task narrow enough that it cannot fail the same way.',
        user: `REDECOMPOSE step\nOBJECTIVE: ${obj.text}\nFAILED STEP (${failed.id}): ${failed.task}\nWORKER: ${failed.worker}\nWHY IT KEPT FAILING:\n${failures.map(f => `- ${f}`).join('\n')}`,
        wantJson: true, attempt: 1, signal,
      });
      obj.modelCalls++;
      const parsed = extractJson(res.text) as { steps?: Partial<PlanStep>[] } | null;
      rawSteps = Array.isArray(parsed?.steps) ? parsed!.steps : [];
    } catch { rawSteps = []; }

    let subs = rawSteps
      .filter(s => typeof s?.task === 'string' && s.task.length > 4)
      .slice(0, 3);
    if (subs.length < 2) {
      // deterministic fallback split — narrower halves of the same task
      subs = [
        { task: `(recovery 1/2) ${failed.task} — produce the primary deliverable file only, complete and final` },
        { task: `(recovery 2/2) ${failed.task} — produce the remaining files and wire everything together` },
      ];
    }

    const idMap = new Map<string, string>();
    subs.forEach((s, i) => idMap.set(String(s.id ?? `R${i + 1}`), `${failed.id}r${i + 1}`));
    const newSteps: PlanStep[] = subs.map((s, i) => {
      const deps = (Array.isArray(s.depends_on) ? s.depends_on.map(String) : [])
        .map(d => idMap.get(d))
        .filter((d): d is string => Boolean(d));
      return {
        id: `${failed.id}r${i + 1}`,
        task: String(s.task).slice(0, 500),
        worker: KNOWN_WORKERS.has(String(s.worker)) ? String(s.worker) : failed.worker,
        skills: Array.isArray(s.skills) && s.skills.length ? s.skills.filter(k => typeof k === 'string').slice(0, 3) : failed.skills,
        connectors: Array.isArray(s.connectors)
          ? s.connectors.filter(c => KNOWN_CONNECTORS.has(String(c)))
          : [...failed.connectors],
        depends_on: deps.length ? deps : (i === 0 ? [...failed.depends_on] : [`${failed.id}r${i}`]),
      };
    });
    // structural guarantee: the chain starts where the failed step started
    newSteps[0].depends_on = [...failed.depends_on];

    const at = plan.steps.findIndex(s => s.id === failed.id);
    if (at < 0) return null;
    plan.steps.splice(at, 1, ...newSteps);
    const lastId = newSteps[newSteps.length - 1].id;
    for (const s of plan.steps) {
      s.depends_on = s.depends_on.map(d => (d === failed.id ? lastId : d));
    }
    return newSteps.map(s => s.id);
  }

  /** Never trust a plan as-emitted. Coerce it into a valid, safe graph. */
  private sanitize(objectiveId: string, text: string, env: EnvName, raw: Partial<Plan> | null): Plan {
    const fallback = this.fallbackPlan(text);
    const goal = typeof raw?.goal === 'string' && raw.goal.length > 3 ? raw.goal : fallback.goal;
    const criteria = Array.isArray(raw?.success_criteria) && raw!.success_criteria.length > 0
      ? raw!.success_criteria.filter(c => typeof c === 'string').slice(0, 6)
      : fallback.success_criteria;
    const risk = raw?.risk === 'high' || raw?.risk === 'medium' ? raw.risk : 'low';

    let steps: PlanStep[] = Array.isArray(raw?.steps) ? (raw!.steps as PlanStep[]) : [];
    steps = steps
      .filter(s => s && typeof s.task === 'string' && KNOWN_WORKERS.has(String(s.worker)))
      .slice(0, MAX_STEPS)
      .map((s, i) => ({
        id: /^S\d+$/.test(String(s.id)) ? String(s.id) : `S${i + 1}`,
        task: s.task.slice(0, 500),
        worker: String(s.worker),
        skills: Array.isArray(s.skills) && s.skills.length
          ? s.skills.filter(k => typeof k === 'string').slice(0, 3)
          : SKILL_FOR[String(s.worker)] ?? [],
        connectors: Array.isArray(s.connectors)
          ? s.connectors.filter(c => KNOWN_CONNECTORS.has(String(c)))
          : [],
        depends_on: Array.isArray(s.depends_on) ? s.depends_on.map(String) : [],
      }));

    // structural guarantees: unique ids, valid deps, no cycles, validator last
    const ids = new Set<string>();
    steps = steps.filter(s => !ids.has(s.id) && (ids.add(s.id), true));
    const idSet = new Set(steps.map(s => s.id));
    for (const s of steps) s.depends_on = s.depends_on.filter(d => idSet.has(d) && d !== s.id);
    if (this.hasCycle(steps)) steps = this.linearize(steps);
    if (steps.length < 2) steps = fallback.steps;
    if (steps[steps.length - 1].worker !== 'validator') {
      const vid = `S${steps.length + 1}`;
      steps.push({
        id: vid, task: 'Validate the deliverable against every success criterion',
        worker: 'validator', skills: ['qa-validation'], connectors: ['filesystem'],
        depends_on: [steps[steps.length - 1].id],
      });
    }
    // coder steps always get filesystem; validators get filesystem read access
    for (const s of steps) {
      if ((s.worker === 'coder' || s.worker === 'validator') && !s.connectors.includes('filesystem')) {
        s.connectors.push('filesystem');
      }
    }
    return { objective_id: objectiveId, goal, success_criteria: criteria, risk, environment: env, steps };
  }

  private hasCycle(steps: PlanStep[]): boolean {
    const seen = new Set<string>(), stack = new Set<string>();
    const byId = new Map(steps.map(s => [s.id, s]));
    const visit = (id: string): boolean => {
      if (stack.has(id)) return true;
      if (seen.has(id)) return false;
      seen.add(id); stack.add(id);
      for (const d of byId.get(id)?.depends_on ?? []) if (visit(d)) return true;
      stack.delete(id);
      return false;
    };
    return steps.some(s => visit(s.id));
  }

  private linearize(steps: PlanStep[]): PlanStep[] {
    return steps.map((s, i) => ({ ...s, depends_on: i === 0 ? [] : [steps[i - 1].id] }));
  }

  private fallbackPlan(text: string): Pick<Plan, 'goal' | 'success_criteria' | 'steps'> {
    return {
      goal: text.slice(0, 200),
      success_criteria: ['a deliverable file exists in the workspace', 'content addresses the objective', 'no placeholder text remains'],
      steps: [
        { id: 'S1', task: `Research: gather key facts and angles for "${text.slice(0, 140)}"`, worker: 'researcher', skills: ['web-research'], connectors: ['web'], depends_on: [] },
        { id: 'S2', task: 'Write structured content from the research notes', worker: 'writer', skills: ['copywriting'], connectors: [], depends_on: ['S1'] },
        { id: 'S3', task: 'Assemble the deliverable files from the written content', worker: 'coder', skills: ['frontend'], connectors: ['filesystem'], depends_on: ['S2'] },
        { id: 'S4', task: 'Validate the deliverable against every success criterion', worker: 'validator', skills: ['qa-validation'], connectors: ['filesystem'], depends_on: ['S3'] },
      ],
    };
  }
}
