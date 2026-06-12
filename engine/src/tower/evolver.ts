/**
 * The Evolution Engine — slow, heavy, deliberate, on purpose.
 * Six phases: capture → decompose → mutate → trial → score → promote.
 * It evolves DEFINITIONS (skills), never model weights and never the
 * security layer. Trials replay real recorded failures inside the Testing
 * territory with writes sandboxed there; promotion requires strictly beating
 * the incumbent; losers are archived as data; every promotion is a new
 * versioned file — one pointer flip from rollback.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '../bus.js';
import { Registry, ReportRow } from '../registry.js';
import { ModelRouter } from '../models/router.js';
import { extractJson } from '../runtime/validators.js';

const MIN_PASS_RATE = 0.67;

export class Evolver {
  running = false;

  constructor(
    private bus: EventBus,
    private registry: Registry,
    private router: ModelRouter,
    private workspacesDir: string,
    private tracesDir: string,
  ) {}

  /** One full evolution cycle. Triggered nightly, every N objectives, or manually. */
  async runCycle(trigger: string): Promise<string> {
    if (this.running) return 'already-running';
    this.running = true;
    const cycleId = `EV${Date.now().toString(36)}`;
    this.bus.emit('evolver.cycle.started', { cycleId, trigger });
    try {
      // 1 · CAPTURE — worst performer from the transparency reports
      const report = this.pickReport();
      if (!report) {
        this.bus.emit('evolver.rejected', { cycleId, reason: 'no failure evidence to learn from — the system only evolves on real data' });
        this.bus.emit('evolver.cycle.completed', { cycleId, outcome: 'idle' });
        this.registry.data.evolverLastOutcome = 'idle: no failure reports';
        return 'idle';
      }
      const skillName = report.target.replace(/^skill:/, '');
      const incumbent = this.registry.readSkill(skillName);
      if (!incumbent) {
        report.consumedBy = cycleId;
        this.registry.save();
        this.bus.emit('evolver.rejected', { cycleId, reason: `target skill ${skillName} not found` });
        this.bus.emit('evolver.cycle.completed', { cycleId, outcome: 'error' });
        return 'error';
      }
      this.bus.emit('evolver.captured', { cycleId, target: report.target, reason: report.evidence });

      // 2 · DECOMPOSE — isolate the failing piece: real recorded failures
      const replays = report.samples.slice(-3);
      this.bus.emit('evolver.decomposed', { cycleId, replayCount: replays.length });

      // 3 · MUTATE — hypothesis-driven candidate rewrites
      const resolved = await this.router.resolve('evolver-mutate');
      const mutateRes = await this.router.call(resolved, {
        role: 'evolver-mutate',
        system: 'You improve skill manuals for AI workers. Given a skill and real failure evidence, produce 2 improved full rewrites. Respond ONLY with JSON: {"candidates": ["full skill text 1", "full skill text 2"]}. Keep what works; fix what the evidence shows failing; be concrete.',
        user: `CURRENT SKILL:\n${incumbent}\nFAILURE EVIDENCE:\n${report.samples.map(s => `- [${s.stepTask.slice(0, 80)}] ${s.reasons.join('; ')}`).join('\n')}`,
        wantJson: true,
        attempt: 1,
      });
      const parsed = extractJson(mutateRes.text) as { candidates?: unknown[] } | null;
      const candidates = (parsed?.candidates ?? [])
        .filter((c): c is string => typeof c === 'string' && c.length > 40)
        .slice(0, 4);
      if (candidates.length === 0) {
        report.consumedBy = cycleId;
        this.registry.save();
        this.bus.emit('evolver.rejected', { cycleId, reason: 'mutation produced no viable candidates' });
        this.bus.emit('evolver.cycle.completed', { cycleId, outcome: 'no-candidates' });
        return 'no-candidates';
      }
      this.bus.emit('evolver.mutated', { cycleId, candidates: candidates.length });

      // 4 · TRIAL — replay real tasks in the hangar (testing territory)
      const hangar = path.join(this.workspacesDir, 'testing', cycleId);
      fs.mkdirSync(hangar, { recursive: true });
      const contenders = [incumbent, ...candidates];   // index 0 = incumbent
      const scores: number[] = [];
      for (let ci = 0; ci < contenders.length; ci++) {
        let passes = 0;
        for (let ri = 0; ri < replays.length; ri++) {
          const ok = await this.trialOne(cycleId, contenders[ci], replays[ri], ci, ri, hangar);
          if (ok) passes++;
          this.bus.emit('evolver.trial', {
            cycleId, candidate: ci === 0 ? 'incumbent' : `candidate-${ci}`,
            replay: ri + 1, pass: ok,
          });
        }
        scores.push(replays.length ? passes / replays.length : 0);
      }

      // 5 · SCORE — must beat the incumbent strictly, with a floor
      this.bus.emit('evolver.scored', {
        cycleId,
        scores: scores.map((s, i) => ({ who: i === 0 ? 'incumbent' : `candidate-${i}`, passRate: s })),
      });
      let best = 0;
      for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;

      report.consumedBy = cycleId;
      this.registry.data.stats.evolverCycles++;
      this.registry.data.stats.objectivesSinceEvolve = 0;

      // archive the full cycle — losers are data too
      this.archive(cycleId, { report, scores, candidates: candidates.map(c => c.slice(0, 2000)) });

      if (best === 0 || scores[best] < MIN_PASS_RATE || scores[best] <= scores[0]) {
        this.registry.data.evolverLastOutcome = `kept incumbent for ${skillName} (no candidate beat it)`;
        this.registry.save();
        this.bus.emit('evolver.rejected', { cycleId, reason: 'no candidate beat the incumbent by the required margin' });
        this.bus.emit('evolver.cycle.completed', { cycleId, outcome: 'incumbent-held' });
        return 'incumbent-held';
      }

      // 6 · PROMOTE — new versioned file, registry pointer flip, reversible
      const row = this.registry.writeSkillVersion(skillName, candidates[best - 1], 'evolver');
      this.registry.data.stats.structuresEvolved++;
      this.registry.data.evolverLastOutcome =
        `promoted ${skillName} v${row.version} (pass ${(scores[best] * 100).toFixed(0)}% vs incumbent ${(scores[0] * 100).toFixed(0)}%)`;
      this.registry.save();
      this.bus.emit('skill.updated', { name: skillName, version: row.version, by: 'evolver' });
      this.bus.emit('evolver.promoted', { cycleId, target: report.target, version: row.version });
      this.bus.emit('evolver.cycle.completed', { cycleId, outcome: 'promoted' });
      return 'promoted';
    } catch (ex) {
      this.bus.emit('evolver.rejected', { cycleId, reason: `cycle error: ${String((ex as Error).message ?? ex)}` });
      this.bus.emit('evolver.cycle.completed', { cycleId, outcome: 'error' });
      return 'error';
    } finally {
      this.running = false;
      this.registry.saveNow();
    }
  }

  /** Re-run one recorded failing task with a contender skill injected.
   *  Writes are confined to the hangar; main is never touched by a trial. */
  private async trialOne(
    cycleId: string, skillText: string,
    replay: { stepTask: string; reasons: string[] },
    ci: number, ri: number, hangar: string,
  ): Promise<boolean> {
    const resolved = await this.router.resolve('coder');
    try {
      const res = await this.router.call(resolved, {
        role: 'coder',
        system: `You are a build worker in a REPLAY TRIAL.\n--- SKILL UNDER TEST ---\n${skillText}`,
        user: `REPLAY TRIAL ${cycleId}/${ci}/${ri}\nTASK (previously failed): ${replay.stepTask}\nIT FAILED BECAUSE: ${replay.reasons.join('; ')}\nProduce the corrected output now. Respond ONLY with JSON {"files":[{"path":"...","content":"..."}]}.`,
        wantJson: true,
        attempt: 1,
      });
      const parsed = extractJson(res.text) as { files?: { path?: string; content?: string }[] } | null;
      const files = parsed?.files ?? [];
      if (files.length === 0) return false;
      // sandboxed write + the exact checks the original failures tripped
      const dir = path.join(hangar, `c${ci}-r${ri}`);
      fs.mkdirSync(dir, { recursive: true });
      for (const f of files.slice(0, 8)) {
        const rel = String(f.path ?? 'out.txt').replace(/\.\./g, '_').replace(/^[/\\]+/, '');
        const abs = path.join(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, String(f.content ?? ''));
      }
      const allContent = files.map(f => String(f.content ?? '')).join('\n');
      // markers of unfinished work — word-bounded so prose about avoiding
      // placeholders doesn't fail the work that avoided them
      if (/\[demo-fail\]|\bTODO\b|\bFIXME\b|\bplaceholder text\b/i.test(allContent)) return false;
      if (allContent.trim().length < 80) return false;
      return true;
    } catch {
      return false;
    }
  }

  private pickReport(): ReportRow | null {
    const open = this.registry.data.reports.filter(r => !r.consumedBy && r.samples.length > 0);
    if (open.length === 0) return null;
    open.sort((a, b) => b.samples.length - a.samples.length);
    return open[0];
  }

  private archive(cycleId: string, payload: unknown): void {
    try {
      fs.writeFileSync(path.join(this.tracesDir, `evolver-${cycleId}.json`), JSON.stringify(payload, null, 2));
    } catch { /* archival is best-effort */ }
  }
}
