/**
 * Ports — the interfaces the Runtime (Layer 2) is allowed to depend on.
 * The Tower (Layer 3) implements them and injects instances downward; the
 * runtime never imports tower modules. This is the "no layer skips a layer"
 * rule made structural: scripts/check-layers.mjs enforces it on every build.
 */
import { ToolCall, ToolResult } from '../connectors/types.js';

/** Gated access to the outside world (implemented by tower/security). */
export interface SecurityPort {
  invokeTool(call: ToolCall, allowedConnectors: string[], signal?: AbortSignal): Promise<ToolResult>;
}

/** The black box (implemented by tower/transparency). */
export interface TracePort {
  trace(objectiveId: string, entry: {
    ts: number; stepId?: string;
    kind: 'prompt' | 'response' | 'validation' | 'tool' | 'decision' | 'note';
    content: unknown;
    blobs?: Record<string, string>;     // name → blob hash (full payloads)
  }): void;
  recordFailure(sample: { skill: string; profile: string; stepTask: string; reasons: string[] }): void;
}

/** Definition access + performance bookkeeping (implemented by registry). */
export interface DefinitionsPort {
  readSkill(name: string): string;
  /** Record one validated use of a skill; returns 'rollback' when a canary
   *  version has regressed and must be reverted (the Tower executes it). */
  recordSkillUse(name: string, pass: boolean): 'ok' | 'rollback';
  putBlob(content: string): string;     // → content hash
}
