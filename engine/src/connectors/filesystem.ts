/**
 * Filesystem gate — scoped hard to the objective's workspace folder.
 * Writes inside the workspace: Tier A. Deletes: Tier C (approval).
 * Anything outside the workspace: blocked. That is the no-go map, in code,
 * and it is not evolvable.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Connector, ConnectorHealth, ToolCall, ToolResult, Tier } from './types.js';

const MAX_FILE_BYTES = 2 * 1024 * 1024;   // 2 MB per file
const MAX_FILES_PER_STEP = 64;

export class FilesystemConnector implements Connector {
  name = 'filesystem';
  baseTier: Tier = 'A';
  enabled = true;
  private writesThisStep = new Map<string, number>();

  async health(): Promise<ConnectorHealth> { return { ok: true }; }

  /** Resolve a model-supplied relative path safely inside the workspace.
   *  Rejects absolute paths, drive letters and any `..` escape. */
  resolveSafe(workspace: string, rel: unknown): string | null {
    if (typeof rel !== 'string' || rel.length === 0 || rel.length > 512) return null;
    if (path.isAbsolute(rel) || /^[a-zA-Z]:[\\/]/.test(rel)) return null;
    const cleaned = rel.replace(/\\/g, '/');
    if (cleaned.split('/').some(part => part === '..' || part === '')) {
      if (cleaned.includes('..')) return null;
    }
    const abs = path.resolve(workspace, cleaned);
    const wsResolved = path.resolve(workspace) + path.sep;
    if (!abs.startsWith(wsResolved) && abs !== path.resolve(workspace)) return null;
    return abs;
  }

  tierFor(call: ToolCall): Tier | 'blocked' {
    const target = this.resolveSafe(call.workspace, call.args.path);
    if (!target) return 'blocked';
    if (call.tool === 'delete') return 'C';
    if (call.tool === 'read' || call.tool === 'list' || call.tool === 'write') return 'A';
    return 'blocked';
  }

  async invoke(call: ToolCall): Promise<ToolResult> {
    const target = this.resolveSafe(call.workspace, call.args.path ?? '.');
    if (!target) return { ok: false, error: 'path escapes workspace (blocked)' };

    try {
      switch (call.tool) {
        case 'write': {
          const content = String(call.args.content ?? '');
          if (Buffer.byteLength(content) > MAX_FILE_BYTES) {
            return { ok: false, error: 'file exceeds 2MB limit' };
          }
          const key = `${call.objectiveId}:${call.stepId}`;
          const n = (this.writesThisStep.get(key) ?? 0) + 1;
          if (n > MAX_FILES_PER_STEP) return { ok: false, error: 'too many files written this step' };
          this.writesThisStep.set(key, n);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, content);
          return { ok: true, value: { path: target, bytes: Buffer.byteLength(content) } };
        }
        case 'read': {
          if (!fs.existsSync(target)) return { ok: false, error: 'file not found' };
          const stat = fs.statSync(target);
          if (stat.size > MAX_FILE_BYTES) return { ok: false, error: 'file too large to read' };
          return { ok: true, value: fs.readFileSync(target, 'utf8') };
        }
        case 'list': {
          if (!fs.existsSync(target)) return { ok: true, value: [] };
          const out: string[] = [];
          const walk = (dir: string, prefix: string) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
              if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
              else out.push(`${prefix}${e.name}`);
            }
          };
          walk(target, '');
          return { ok: true, value: out.slice(0, 500) };
        }
        case 'delete': {
          // reaches here only after a Tier-C gate approval
          if (fs.existsSync(target)) fs.rmSync(target, { recursive: true });
          return { ok: true };
        }
        default:
          return { ok: false, error: `unknown tool: ${call.tool}` };
      }
    } catch (ex) {
      return { ok: false, error: String((ex as Error).message ?? ex) };
    }
  }
}
