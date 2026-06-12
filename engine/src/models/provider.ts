/**
 * Model providers. A worker is never a model — it's a wrapper around one.
 * Providers expose one uniform call; the router (profiles in
 * definitions/profiles/models.json) decides which provider+model a given
 * worker profile gets, with graceful fallback: anthropic → ollama → demo.
 */

export interface ModelRequest {
  role: string;                       // worker profile: planner | researcher | ...
  system: string;
  user: string;
  wantJson: boolean;
  temperature: number;
  maxTokens: number;
  attempt: number;                    // retries may adjust prompts upstream
  signal?: AbortSignal;
}

export interface ModelResponse {
  text: string;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  costUSD?: number;
}

export interface Provider {
  name: 'demo' | 'ollama' | 'anthropic';
  available(): Promise<boolean>;
  models(): Promise<string[]>;
  call(model: string, req: ModelRequest): Promise<ModelResponse>;
}
