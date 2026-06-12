/**
 * Transparency — the black box. Records every prompt, response, validation
 * and decision per objective (full trace files), keeps live summaries for the
 * inspector, and analyzes failures into structured reports that feed the
 * Evolver. Honest scope: we capture complete *behavioral* records — every
 * input, output and check — not a neural network's internal reasoning.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventBus } from '../bus.js';
import { Registry, ReportRow } from '../registry.js';

export interface TraceEntry {
  ts: number;
  stepId?: string;
  kind: 'prompt' | 'response' | 'validation' | 'tool' | 'decision' | 'note';
  content: unknown;
}

interface FailureSample { skill: string; profile: string; stepTask: string; reasons: string[] }

export class Transparency {
  private failures: FailureSample[] = [];

  constructor(private bus: EventBus, private registry: Registry, private tracesDir: string) {}

  trace(objectiveId: string, entry: TraceEntry): void {
    const file = path.join(this.tracesDir, `${objectiveId}.jsonl`);
    try { fs.appendFileSync(file, JSON.stringify(entry) + '\n'); }
    catch (ex) { console.error('[transparency] trace write failed:', ex); }
  }

  readTrace(objectiveId: string, tail = 200): TraceEntry[] {
    const file = path.join(this.tracesDir, `${objectiveId}.jsonl`);
    try {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
      return lines.slice(-tail).map(l => JSON.parse(l));
    } catch { return []; }
  }

  recordFailure(sample: FailureSample): void {
    this.failures.push(sample);
    if (this.failures.length > 400) this.failures.shift();
  }

  /** Called when an objective ends: if a skill keeps failing validation,
   *  file a report — the Evolver's raw material. */
  analyze(objectiveId: string): void {
    const bySkill = new Map<string, FailureSample[]>();
    for (const f of this.failures) {
      const list = bySkill.get(f.skill) ?? [];
      list.push(f);
      bySkill.set(f.skill, list);
    }
    for (const [skill, samples] of bySkill) {
      if (samples.length < 1) continue;
      const open = this.registry.data.reports.find(r => r.target === `skill:${skill}` && !r.consumedBy);
      if (open) {
        open.samples.push(...samples.map(s => ({ stepTask: s.stepTask, reasons: s.reasons })));
        open.samples = open.samples.slice(-20);
        open.evidence = evidenceLine(skill, open.samples.length);
        this.registry.save();
        continue;
      }
      const report: ReportRow = {
        id: `R${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
        target: `skill:${skill}`,
        kind: 'validation-failures',
        evidence: evidenceLine(skill, samples.length),
        samples: samples.map(s => ({ stepTask: s.stepTask, reasons: s.reasons })).slice(-20),
        createdAt: Date.now(),
      };
      this.registry.data.reports.push(report);
      this.registry.save();
      this.bus.emit('report.filed',
        { reportId: report.id, target: report.target, kind: report.kind, evidence: report.evidence },
        { objectiveId });
    }
    // analyzed failures are folded into reports; clear the rolling window
    this.failures = [];
  }
}

function evidenceLine(skill: string, n: number): string {
  return `workers using skill "${skill}" failed validation ${n} time${n === 1 ? '' : 's'} in recent runs`;
}
