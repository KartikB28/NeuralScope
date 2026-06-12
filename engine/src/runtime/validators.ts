/**
 * Layer 2 — deterministic validators. Real code, not AI: this is where most
 * of the system's reliability comes from. A step passes only if these pass;
 * a model claiming success is never sufficient on its own.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Check { name: string; ok: boolean; detail?: string }
export interface CheckResult { pass: boolean; checks: Check[] }

function read(workspace: string, rel: string): string | null {
  const p = path.join(workspace, rel);
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function listFiles(workspace: string): string[] {
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

/** Map plain-English success criteria onto concrete checks. Heuristic by
 *  design: criteria are written by the planner, checked by code.
 *  artifacts/ is excluded — those are transparency records ABOUT the work
 *  (notes, validation reports that quote the criteria), not the deliverable. */
export function checkCriteria(criteria: string[], workspace: string): CheckResult {
  const files = listFiles(workspace).filter(f => !f.startsWith('artifacts/'));
  const checks: Check[] = criteria.map(c => {
    const lc = c.toLowerCase();

    let m = /([\w./-]+\.[a-z0-9]+)\s+exists(?:\s+and\s+is\s+linked)?/i.exec(c);
    if (m) {
      const f = m[1];
      const exists = files.includes(f);
      if (!exists) return { name: c, ok: false, detail: `${f} not found` };
      if (lc.includes('linked')) {
        const idx = read(workspace, 'index.html') ?? '';
        const linked = idx.includes(f);
        return { name: c, ok: linked, detail: linked ? undefined : `${f} not referenced from index.html` };
      }
      return { name: c, ok: true };
    }

    if (lc.includes('<h1>')) {
      const idx = read(workspace, 'index.html') ?? read(workspace, 'report.md') ?? '';
      return { name: c, ok: /<h1[\s>]/i.test(idx) || /^#\s/m.test(idx), detail: undefined };
    }

    m = /at least (\d+) sections?/i.exec(c);
    if (m) {
      const want = parseInt(m[1], 10);
      const idx = read(workspace, 'index.html');
      const rep = read(workspace, 'report.md');
      const got = idx
        ? (idx.match(/<(section|header)[\s>]/gi)?.length ?? 0)
        : (rep?.match(/^##\s/gm)?.length ?? 0);
      return { name: c, ok: got >= want, detail: got >= want ? undefined : `found ${got}, need ${want}` };
    }

    if (lc.includes('[demo-fail]')) {
      const dirty = files.some(f => (read(workspace, f) ?? '').includes('[demo-fail]'));
      return { name: c, ok: !dirty, detail: dirty ? 'placeholder text still present' : undefined };
    }

    if (lc.includes('title heading')) {
      const rep = read(workspace, 'report.md') ?? '';
      return { name: c, ok: /^#\s+\S/m.test(rep) };
    }

    if (lc.includes('cites') || lc.includes('notes')) {
      const rep = read(workspace, 'report.md') ?? '';
      return { name: c, ok: rep.length > 300, detail: rep.length > 300 ? undefined : 'report too thin to contain the notes' };
    }

    // unknown criterion → require that *something* was produced
    return { name: c, ok: files.length > 0, detail: files.length > 0 ? 'generic check: workspace non-empty' : 'workspace empty' };
  });
  return { pass: checks.every(c => c.ok), checks };
}

/** Per-profile structural checks on a worker's parsed output. */
export function checkStepOutput(profile: string, parsed: unknown, writtenFiles: string[], workspace: string): CheckResult {
  const checks: Check[] = [];
  const obj = (parsed ?? {}) as Record<string, unknown>;

  if (profile === 'researcher') {
    const notes = Array.isArray(obj.notes) ? obj.notes.filter(n => typeof n === 'string' && n.length > 8) : [];
    checks.push({ name: 'research produced ≥3 usable notes', ok: notes.length >= 3, detail: `got ${notes.length}` });
  } else if (profile === 'writer') {
    const sections = Array.isArray(obj.sections) ? obj.sections : [];
    const wellFormed = sections.every((s: any) => typeof s?.title === 'string' && typeof s?.content === 'string' && s.content.length > 20);
    checks.push({ name: 'copy has ≥3 well-formed sections', ok: sections.length >= 3 && wellFormed, detail: `got ${sections.length}` });
  } else if (profile === 'coder') {
    checks.push({ name: 'at least one file written', ok: writtenFiles.length > 0, detail: `wrote ${writtenFiles.length}` });
    const idx = read(workspace, 'index.html');
    if (idx !== null) {
      checks.push({ name: 'index.html is structurally sound', ok: /<!doctype html>/i.test(idx) && /<\/html>\s*$/i.test(idx.trim()) });
    }
  } else if (profile === 'validator') {
    checks.push({ name: 'validator returned a verdict', ok: typeof obj.pass === 'boolean' });
  }
  return { pass: checks.every(c => c.ok), checks };
}

/** Extract the first balanced JSON object from model text (handles prose and
 *  ```json fences). Parse failures are retried with feedback, never crashed on. */
export function extractJson(text: string): unknown | null {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidates = fence ? [fence[1], text] : [text];
  for (const cand of candidates) {
    const start = cand.indexOf('{');
    if (start < 0) continue;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < cand.length; i++) {
      const ch = cand[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = inStr; continue; }
      if (ch === '"') inStr = !inStr;
      if (inStr) continue;
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(cand.slice(start, i + 1)); } catch { break; }
        }
      }
    }
  }
  return null;
}
