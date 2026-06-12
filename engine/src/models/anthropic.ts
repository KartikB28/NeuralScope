/**
 * Anthropic provider — frontier reasoning for the planner/critic roles,
 * used sparingly. The API key lives in the vault and never enters any
 * prompt, event, or snapshot.
 */
import { Provider, ModelRequest, ModelResponse } from './provider.js';

// rough $/MTok for cost *estimates* shown in the UI (not billing truth)
const PRICES: Record<string, { in: number; out: number }> = {
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 15, out: 75 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
};

export class AnthropicProvider implements Provider {
  name = 'anthropic' as const;
  constructor(private getKey: () => string | undefined, private getModel: () => string) {}

  async available(): Promise<boolean> { return Boolean(this.getKey()); }

  async models(): Promise<string[]> {
    return this.getKey() ? [this.getModel()] : [];
  }

  async call(model: string, req: ModelRequest): Promise<ModelResponse> {
    const key = this.getKey();
    if (!key) throw new Error('no anthropic api key configured');
    const t0 = Date.now();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      }),
      signal: req.signal ?? AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json() as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens: number; output_tokens: number };
    };
    const text = (json.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('');
    const usage = json.usage;
    const price = PRICES[model] ?? { in: 3, out: 15 };
    const costUSD = usage
      ? (usage.input_tokens * price.in + usage.output_tokens * price.out) / 1_000_000
      : undefined;
    return { text, ms: Date.now() - t0, inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens, costUSD };
  }
}
