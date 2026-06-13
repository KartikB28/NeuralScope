/**
 * Web gate — read-only HTTP GET against an allow-list of domains (settings).
 * Allow-listed GET: Tier A. Any other domain: Tier C (human approval).
 * POST or any mutating verb: not exposed in v1 at all.
 *
 * SSRF posture: the private/loopback block is enforced on EVERY hop, not just
 * the URL the worker proposed. Redirects are followed manually so a public,
 * approved URL cannot 30x its way to 127.0.0.1, a cloud metadata endpoint,
 * or any internal host. (DNS rebinding — a hostname that resolves public at
 * check time and private at fetch time — is a known residual; closing it
 * needs IP pinning and is tracked for a later pass.)
 */
import { Connector, ConnectorHealth, ToolCall, ToolResult, Tier } from './types.js';

const MAX_BODY = 600_000;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

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

  /** Hosts that must never be reachable from worker context — checked on the
   *  initial URL AND on every redirect hop. */
  private isPrivate(host: string): boolean {
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' ||
      host === '::1' || host.endsWith('.local') || host.endsWith('.internal') ||
      /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(host) ||
      /^(fc|fd|fe80)/i.test(host);   // unique-local / link-local IPv6
  }

  tierFor(call: ToolCall): Tier | 'blocked' {
    if (call.tool !== 'fetch') return 'blocked';
    const host = this.hostOf(call.args.url);
    if (!host) return 'blocked';
    if (this.isPrivate(host)) return 'blocked';
    const allowed = this.getAllowlist().some(d => host === d || host.endsWith(`.${d}`));
    return allowed ? 'A' : 'C';
  }

  async invoke(call: ToolCall): Promise<ToolResult> {
    if (call.tool !== 'fetch') return { ok: false, error: `unknown tool: ${call.tool}` };
    let url = String(call.args.url ?? '');
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        // follow redirects by hand so the private-range block applies to every hop
        for (let hop = 0; ; hop++) {
          const host = this.hostOf(url);
          if (!host) return { ok: false, error: 'invalid or non-http(s) URL' };
          if (this.isPrivate(host)) return { ok: false, error: `blocked: redirect/target resolves to a private address (${host})` };
          res = await fetch(url, {
            signal: ctrl.signal,
            redirect: 'manual',
            headers: { 'user-agent': 'NeuralScope/0.1 (+local research agent)' },
          });
          if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
            if (hop >= MAX_REDIRECTS) return { ok: false, error: 'too many redirects' };
            url = new URL(res.headers.get('location')!, url).toString();
            continue;
          }
          break;
        }
      } finally {
        clearTimeout(t);
      }
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
