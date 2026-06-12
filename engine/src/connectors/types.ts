/**
 * Layer 1 — Connectors ("gates"). A connector is a standardized, permissioned
 * adapter to anything outside the Engine. Workers never call these directly:
 * the deterministic scaffold (Layer 2) does, and every call passes through
 * ring-1 gatekeeping first.
 */

export type Tier = 'A' | 'B' | 'C' | 'D';

export interface ToolCall {
  connector: string;          // "filesystem" | "web" | ...
  tool: string;               // "write" | "read" | "fetch" | ...
  args: Record<string, unknown>;
  objectiveId: string;
  stepId: string;
  env: 'main' | 'testing' | 'onetime';
  workspace: string;          // absolute path of this objective's sandbox
}

export interface ToolResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface ConnectorHealth { ok: boolean; detail?: string }

export interface Connector {
  name: string;
  /** lowest tier any of its tools can run at — shown in the World */
  baseTier: Tier;
  enabled: boolean;
  health(): Promise<ConnectorHealth>;
  /** Tier required for this specific call (ring-3 input). Return 'blocked' for no-go. */
  tierFor(call: ToolCall): Tier | 'blocked';
  invoke(call: ToolCall): Promise<ToolResult>;
}
