/**
 * Ollama provider — local models over the standard Ollama HTTP API.
 * Detected automatically; pull a model with `ollama pull <name>` and it
 * appears as an available energy source on the next worker boot.
 */
import { Provider, ModelRequest, ModelResponse } from './provider.js';

// VRAM is the real concurrency budget on a local machine: bound parallel
// generations so N workers never thrash one GPU (queue instead of stampede)
const MAX_CONCURRENT = 2;

export class OllamaProvider implements Provider {
  name = 'ollama' as const;
  private inFlight = 0;
  private queue: (() => void)[] = [];

  constructor(private getUrl: () => string) {}

  private async acquire(): Promise<void> {
    if (this.inFlight < MAX_CONCURRENT) { this.inFlight++; return; }
    await new Promise<void>(r => this.queue.push(r));
    this.inFlight++;
  }

  private release(): void {
    this.inFlight--;
    this.queue.shift()?.();
  }

  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${this.getUrl()}/api/tags`, { signal: AbortSignal.timeout(2500) });
      return res.ok;
    } catch { return false; }
  }

  async models(): Promise<string[]> {
    try {
      const res = await fetch(`${this.getUrl()}/api/tags`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) return [];
      const json = await res.json() as { models?: { name: string }[] };
      return (json.models ?? []).map(m => m.name);
    } catch { return []; }
  }

  async call(model: string, req: ModelRequest): Promise<ModelResponse> {
    await this.acquire();
    try {
      return await this.doCall(model, req);
    } finally {
      this.release();
    }
  }

  private async doCall(model: string, req: ModelRequest): Promise<ModelResponse> {
    const t0 = Date.now();
    const body = {
      model,
      stream: false,
      format: req.wantJson ? 'json' : undefined,
      options: { temperature: req.temperature, num_predict: req.maxTokens },
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    };
    const res = await fetch(`${this.getUrl()}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.signal ?? AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json() as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    return {
      text: json.message?.content ?? '',
      ms: Date.now() - t0,
      inputTokens: json.prompt_eval_count,
      outputTokens: json.eval_count,
      costUSD: 0,
    };
  }
}
