/**
 * Web gate — read-only HTTP GET against an allow-list of domains (settings).
 * Allow-listed GET: Tier A. Any other domain: Tier C (human approval).
 * POST or any mutating verb: not exposed in v1 at all.
 */
import { Connector, ConnectorHealth, ToolCall, ToolResult, Tier } from './types.js';

const MAX_BODY = 600_000;
const TIMEOUT_MS = 15_000;

export class WebConnector implements Connector {
  name = 'web';
  baseTier: Tier = 'A';
  enabled = true;

  constructor(private getAllowlist: () => string[]) {}

  async health(): Promise<ConnectorHealth> {
    return { ok: true, detail: `${this.getAllowlist().length} allow-listed domains` };
  }

  private hostOf(url: unknown): string | null {
    if (typeof url !== 'string') return null;
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      return u.hostname.toLowerCase();
    } catch { return null; }
  }

  tierFor(call: ToolCall): Tier | 'blocked' {
    if (call.tool !== 'fetch') return 'blocked';
    const host = this.hostOf(call.args.url);
    if (!host) return 'blocked';
    // private/loopback ranges are never fetchable from worker context
    if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') ||
        /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host)) return 'blocked';
    const allowed = this.getAllowlist().some(d => host === d || host.endsWith(`.${d}`));
    return allowed ? 'A' : 'C';
  }

  async invoke(call: ToolCall): Promise<ToolResult> {
    if (call.tool !== 'fetch') return { ok: false, error: `unknown tool: ${call.tool}` };
    const url = String(call.args.url ?? '');
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'user-agent': 'NeuralScope/0.1 (+local research agent)' },
      });
      clearTimeout(t);
      const text = (await res.text()).slice(0, MAX_BODY);
      // crude readable-text extraction; workers get content, not live DOM
      const stripped = text
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 40_000);
      return { ok: true, value: { status: res.status, url, text: stripped } };
    } catch (ex) {
      return { ok: false, error: `fetch failed: ${String((ex as Error).message ?? ex)}` };
    }
  }
}
