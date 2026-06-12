/**
 * Layer 2 — the Worker and its scaffold. A worker is a disposable runtime:
 * model + injected skills + scoped tools + output schema + timeout, booted
 * for exactly one step and torn down after. The deterministic loop around the
 * model — build prompt → call → parse → act → VALIDATE → retry/reboot — is
 * where the reliability lives.
 */
import { EventBus } from '../bus.js';
import { Registry } from '../registry.js';
import { SecurityManager } from '../tower/security.js';
import { Transparency } from '../tower/transparency.js';
import { ModelRouter } from '../models/router.js';
import { Plan, PlanStep, ObjectiveState } from '../contract.js';
import { checkCriteria, checkStepOutput, extractJson, CheckResult } from './validators.js';

const MAX_ATTEMPTS = 3;
const STEP_TIMEOUT_MS = 6 * 60_000;

export interface StepRunResult {
  ok: boolean;
  output?: unknown;
  summary: string;
  failure?: string;
}

const ROLE_CHARTERS: Record<string, string> = {
  researcher: 'You are a research worker. Produce factual, useful, specific notes. Respond with ONLY a JSON object: {"notes": ["...", ...]} with at least 4 notes.',
  writer: 'You are a copywriting worker. Turn research notes into clear, warm, persuasive copy. Respond with ONLY a JSON object: {"sections": [{"title": "...", "content": "..."}]} with at least 4 sections; the first section is the hero.',
  coder: 'You are a front-end build worker. Produce complete, valid, self-contained files. Respond with ONLY a JSON object: {"files": [{"path": "relative/path", "content": "full file content"}]}. Never emit placeholders or TODOs; every file must be finished.',
  validator: 'You are a validation worker. Judge strictly against the success criteria and the deterministic check results you are given. Respond with ONLY a JSON object: {"pass": true|false, "checks": [{"name":"...","ok":true|false,"detail":"..."}], "verdict": "..."}.',
};

export class WorkerRuntime {
  constructor(
    private bus: EventBus,
    private registry: Registry,
    private security: SecurityManager,
    private transparency: Transparency,
    private router: ModelRouter,
  ) {}

  /** Run one step of one objective, end to end. */
  async runStep(obj: ObjectiveState, plan: Plan, step: PlanStep, signal: AbortSignal): Promise<StepRunResult> {
    const meta = { objectiveId: obj.id, stepId: step.id, env: obj.env };
    const workerId = `W-${obj.id}-${step.id}`;
    const stepState = obj.steps[step.id];

    this.bus.emit('step.started', { stepId: step.id, task: step.task }, meta);

    // assemble: model via profile routing, skills from definition files
    const resolved = await this.router.resolve(step.worker);
    const skillTexts = step.skills
      .map(name => ({ name, text: this.registry.readSkill(name) }))
      .filter(s => s.text.length > 0);
    this.bus.emit('worker.booted', {
      workerId, stepId: step.id, profile: step.worker,
      model: `${resolved.providerName}/${resolved.model}`,
      skills: skillTexts.map(s => s.name),
    }, { ...meta, workerId });

    // dependency handoff: outputs of upstream steps
    const handoff = step.depends_on
      .map(dep => {
        const out = (obj.steps[dep] as any)?.output;
        return out ? `OUTPUT OF ${dep}:\n${JSON.stringify(out).slice(0, 6000)}` : '';
      })
      .filter(Boolean)
      .join('\n\n');

    // optional pre-work: fetch any URLs named in the objective (ring-1/3 gated)
    let fetchedContext = '';
    if (step.connectors.includes('web')) {
      fetchedContext = await this.prefetchUrls(obj, step, signal);
    }

    const deadline = AbortSignal.any([signal, AbortSignal.timeout(STEP_TIMEOUT_MS)]);
    let lastFailure = '';
    let lastRaw = '';
    let rebooted = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (deadline.aborted) return { ok: false, summary: 'aborted', failure: 'aborted (kill switch or timeout)' };

      stepState.attempts = attempt;
      const reground = rebooted
        ? `\n\nREGROUNDING — you drifted. Re-read the ORIGINAL OBJECTIVE and the success criteria above. Discard previous partial reasoning and produce a clean, complete answer.\n`
        : '';
      const feedback = lastFailure
        ? `\n\nPREVIOUS ATTEMPT FAILED VALIDATION:\n${lastFailure}\nFix exactly these problems.`
        : '';

      const system = [
        ROLE_CHARTERS[step.worker] ?? `You are a ${step.worker} worker. Respond with only valid JSON.`,
        ...skillTexts.map(s => `--- SKILL: ${s.name} ---\n${s.text}`),
      ].join('\n\n');

      const user = [
        `ORIGINAL OBJECTIVE: ${obj.text}`,
        `GOAL: ${plan.goal}`,
        `SUCCESS CRITERIA:\n${plan.success_criteria.map(c => `- ${c}`).join('\n')}`,
        `YOUR STEP (${step.id}): ${step.task}`,
        handoff,
        fetchedContext,
        step.worker === 'validator' ? this.deterministicFindings(obj, plan) : '',
        reground,
        feedback,
      ].filter(Boolean).join('\n\n');

      this.transparency.trace(obj.id, { ts: Date.now(), stepId: step.id, kind: 'prompt', content: { attempt, system: system.slice(0, 4000), user: user.slice(0, 8000) } });
      this.bus.emit('model.called', {
        workerId, stepId: step.id, provider: resolved.providerName, model: resolved.model,
        promptChars: system.length + user.length, attempt,
      }, { ...meta, workerId });

      let raw: string;
      try {
        const res = await this.router.call(resolved, {
          role: step.worker, system, user, wantJson: true, attempt, signal: deadline,
        });
        raw = res.text;
        obj.modelCalls++;
        obj.estCostUSD += res.costUSD ?? 0;
        this.bus.emit('model.responded', { workerId, stepId: step.id, ms: res.ms, outputChars: raw.length }, { ...meta, workerId });
        this.transparency.trace(obj.id, { ts: Date.now(), stepId: step.id, kind: 'response', content: { attempt, text: raw.slice(0, 8000) } });
      } catch (ex) {
        if (deadline.aborted) return { ok: false, summary: 'aborted', failure: 'aborted (kill switch or timeout)' };
        lastFailure = `model call failed: ${String((ex as Error).message ?? ex)}`;
        this.transparency.trace(obj.id, { ts: Date.now(), stepId: step.id, kind: 'note', content: lastFailure });
        continue;
      }

      // ring 2: identical output twice in a row is drift, not progress
      if (raw === lastRaw && attempt > 1 && !rebooted) {
        rebooted = true;
        stepState.reboots++;
        this.bus.emit('worker.rebooted', { workerId, stepId: step.id, reason: 'drift: repeated identical output' }, { ...meta, workerId });
        continue;
      }
      lastRaw = raw;

      const parsed = extractJson(raw);
      if (parsed === null) {
        lastFailure = 'output was not parseable JSON in the required schema';
        this.failValidation(obj, step, [lastFailure], attempt, meta);
        if (this.shouldReboot(attempt, rebooted)) { rebooted = true; stepState.reboots++; this.bus.emit('worker.rebooted', { workerId, stepId: step.id, reason: 'parse failures' }, { ...meta, workerId }); }
        continue;
      }

      // act: deterministic code applies the output's effects via gated tools
      const written = await this.applyEffects(obj, step, parsed, deadline);
      if (written.error) {
        lastFailure = written.error;
        this.failValidation(obj, step, [lastFailure], attempt, meta);
        continue;
      }

      // validate: structural checks + (final step) objective-level criteria
      const structural = checkStepOutput(step.worker, parsed, written.paths, obj.workspace);
      let criteria: CheckResult = { pass: true, checks: [] };
      if (step.worker === 'validator' || step.worker === 'coder') {
        criteria = checkCriteria(plan.success_criteria, obj.workspace);
      }
      let verdictOk = true;
      if (step.worker === 'validator') {
        const claimed = (parsed as any)?.pass === true;
        verdictOk = claimed === criteria.pass; // the validator must agree with reality
      }
      const all = [...structural.checks, ...criteria.checks];
      const pass = structural.pass && criteria.pass && verdictOk;
      this.transparency.trace(obj.id, { ts: Date.now(), stepId: step.id, kind: 'validation', content: { attempt, pass, checks: all } });

      if (pass) {
        (stepState as any).output = parsed;
        stepState.outputPreview = JSON.stringify(parsed).slice(0, 240);
        this.bus.emit('validation.passed', { stepId: step.id, checks: all.map(c => c.name) }, meta);
        const summary = this.summarize(step, parsed, written.paths);
        stepState.summary = summary;
        this.bus.emit('step.progress', { stepId: step.id, summary }, meta);
        return { ok: true, output: parsed, summary };
      }

      const reasons = all.filter(c => !c.ok).map(c => c.detail ? `${c.name} — ${c.detail}` : c.name);
      if (!verdictOk) reasons.push('validator verdict disagreed with deterministic checks');
      lastFailure = reasons.join('; ');
      this.failValidation(obj, step, reasons, attempt, meta);
      for (const skillName of step.skills) {
        this.transparency.recordFailure({ skill: skillName, profile: step.worker, stepTask: step.task, reasons });
      }
      if (this.shouldReboot(attempt, rebooted)) {
        rebooted = true;
        stepState.reboots++;
        this.bus.emit('worker.rebooted', { workerId, stepId: step.id, reason: `validation fail streak (${attempt})` }, { ...meta, workerId });
      }
    }

    return { ok: false, summary: `failed after ${MAX_ATTEMPTS} attempts`, failure: lastFailure || 'unknown' };
  }

  private shouldReboot(attempt: number, alreadyRebooted: boolean): boolean {
    return attempt === MAX_ATTEMPTS - 1 && !alreadyRebooted;
  }

  private failValidation(obj: ObjectiveState, step: PlanStep, reasons: string[], attempt: number, meta: Record<string, unknown>): void {
    obj.steps[step.id].failures.push(...reasons);
    this.registry.data.stats.validationsFailed++;
    this.registry.save();
    this.bus.emit('validation.failed', { stepId: step.id, reasons, attempt }, meta as any);
  }

  /** Deterministic effects of a parsed output — the model never touches a
   *  connector; this trusted code does, through the security manager. */
  private async applyEffects(obj: ObjectiveState, step: PlanStep, parsed: unknown, signal: AbortSignal): Promise<{ paths: string[]; error?: string }> {
    const paths: string[] = [];
    const p = parsed as Record<string, unknown>;

    if (step.worker === 'coder' && Array.isArray(p.files)) {
      for (const f of p.files as { path?: unknown; content?: unknown }[]) {
        const res = await this.security.invokeTool({
          connector: 'filesystem', tool: 'write',
          args: { path: f.path, content: String(f.content ?? '') },
          objectiveId: obj.id, stepId: step.id, env: obj.env, workspace: obj.workspace,
        }, step.connectors, signal);
        if (!res.ok) return { paths, error: `file write rejected: ${res.error}` };
        paths.push(String(f.path));
        this.transparency.trace(obj.id, { ts: Date.now(), stepId: step.id, kind: 'tool', content: { tool: 'filesystem.write', path: f.path } });
      }
    }

    // research notes and copy are also artifacts — visible, auditable files
    if (step.worker === 'researcher' && Array.isArray(p.notes)) {
      await this.writeArtifact(obj, step, 'artifacts/research-notes.md',
        `# Research notes\n\n${(p.notes as string[]).map(n => `- ${n}`).join('\n')}\n`);
    }
    if (step.worker === 'writer' && Array.isArray(p.sections)) {
      const md = (p.sections as { title: string; content: string }[])
        .map(s => `## ${s.title}\n\n${s.content}\n`).join('\n');
      await this.writeArtifact(obj, step, 'artifacts/copy.md', `# Copy\n\n${md}`);
    }
    if (step.worker === 'validator') {
      await this.writeArtifact(obj, step, 'artifacts/validation.json', JSON.stringify(parsed, null, 2));
    }
    return { paths };
  }

  private async writeArtifact(obj: ObjectiveState, step: PlanStep, rel: string, content: string): Promise<void> {
    // artifact writes are engine bookkeeping inside the sandbox — same gate,
    // filesystem connector implicitly allowed for transparency artifacts
    await this.security.invokeTool({
      connector: 'filesystem', tool: 'write', args: { path: rel, content },
      objectiveId: obj.id, stepId: step.id, env: obj.env, workspace: obj.workspace,
    }, [...step.connectors, 'filesystem']);
  }

  private deterministicFindings(obj: ObjectiveState, plan: Plan): string {
    const det = checkCriteria(plan.success_criteria, obj.workspace);
    return `DETERMINISTIC CHECKS:\n${JSON.stringify(det)}`;
  }

  private async prefetchUrls(obj: ObjectiveState, step: PlanStep, signal: AbortSignal): Promise<string> {
    const urls = [...obj.text.matchAll(/https?:\/\/[^\s)"'<>]+/g)].map(m => m[0]).slice(0, 3);
    if (urls.length === 0) return '';
    const parts: string[] = [];
    for (const url of urls) {
      const res = await this.security.invokeTool({
        connector: 'web', tool: 'fetch', args: { url },
        objectiveId: obj.id, stepId: step.id, env: obj.env, workspace: obj.workspace,
      }, step.connectors, signal);
      if (res.ok) {
        const v = res.value as { url: string; text: string };
        parts.push(`SOURCE ${v.url}:\n${v.text.slice(0, 5000)}`);
        this.transparency.trace(obj.id, { ts: Date.now(), stepId: step.id, kind: 'tool', content: { tool: 'web.fetch', url } });
      } else {
        parts.push(`SOURCE ${url}: unavailable (${res.error})`);
      }
    }
    return `FETCHED CONTEXT:\n${parts.join('\n\n')}`;
  }

  private summarize(step: PlanStep, parsed: unknown, paths: string[]): string {
    const p = parsed as Record<string, unknown>;
    switch (step.worker) {
      case 'researcher': return `gathered ${(p.notes as unknown[])?.length ?? 0} research notes`;
      case 'writer': return `wrote ${(p.sections as unknown[])?.length ?? 0} copy sections`;
      case 'coder': return `built ${paths.length} file${paths.length === 1 ? '' : 's'}: ${paths.join(', ')}`;
      case 'validator': return (p.verdict as string) ?? 'validated against success criteria';
      default: return 'step completed';
    }
  }
}
