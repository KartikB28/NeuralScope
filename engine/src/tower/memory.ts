/**
 * Memory — the cargo warehouse. Tier 1 (working) lives inside each objective
 * and dies with it. Tier 2 (episodic, here) keeps compressed summaries whose
 * relevance decays when unused; a sweep deletes the faded. Tier 3 (structural)
 * is the Evolver's job — knowledge graduating from "remembered" to "is".
 */
import { EventBus } from '../bus.js';
import { MemoryRow } from '../registry.js';
import { readJson, writeJsonAtomic } from '../paths.js';

const DECAY_PER_SWEEP = 0.96;
const IDLE_PENALTY_DAYS = 7;
const SWEEP_FLOOR = 0.12;

export class MemoryStore {
  private rows: MemoryRow[] = [];

  constructor(private file: string, private bus: EventBus) {
    this.rows = readJson<MemoryRow[]>(file, []);
  }

  private persist(): void { writeJsonAtomic(this.file, this.rows); }

  all(): MemoryRow[] { return [...this.rows]; }

  write(summary: string, tags: string[], source: 'objective' | 'user', meta: { objectiveId?: string } = {}): MemoryRow {
    const row: MemoryRow = {
      id: `M${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
      summary: summary.slice(0, 500),
      tags: tags.map(t => t.toLowerCase()).filter(Boolean).slice(0, 8),
      relevance: 1,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      source,
    };
    this.rows.push(row);
    if (this.rows.length > 500) this.rows.shift();
    this.persist();
    this.bus.emit('memory.written', { memoryId: row.id, summary: row.summary, tags: row.tags }, meta);
    return row;
  }

  /** Keyword-overlap recall (v1; a vector store drops in here later). */
  recall(text: string, limit: number): MemoryRow[] {
    const words = new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3));
    const scored = this.rows
      .map(r => {
        const overlap = r.tags.filter(t => words.has(t)).length
          + r.summary.toLowerCase().split(/[^a-z0-9]+/).filter(w => words.has(w)).length * 0.2;
        return { r, score: overlap * r.relevance };
      })
      .filter(x => x.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const now = Date.now();
    for (const { r } of scored) {
      r.lastUsedAt = now;
      r.relevance = Math.min(1, r.relevance + 0.08);   // use strengthens
    }
    if (scored.length) this.persist();
    return scored.map(x => x.r);
  }

  /** Unused memories literally fade; the faded are swept. */
  sweep(): number {
    const now = Date.now();
    let removed = 0;
    for (const r of this.rows) {
      r.relevance *= DECAY_PER_SWEEP;
      const idleDays = (now - r.lastUsedAt) / 86_400_000;
      if (idleDays > IDLE_PENALTY_DAYS) r.relevance *= 0.9;
    }
    this.rows = this.rows.filter(r => {
      if (r.relevance >= SWEEP_FLOOR) return true;
      removed++;
      this.bus.emit('memory.decayed', { memoryId: r.id });
      return false;
    });
    if (removed) this.persist();
    return removed;
  }
}
