/**
 * Model routing — profiles are definition files, never hard-code.
 * `definitions/profiles/models.json` maps each worker profile to a provider
 * preference chain and an Ollama model hint. As local models improve you flip
 * rows in a file, not rebuild the system.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Provider, ModelRequest, ModelResponse } from './provider.js';
import { DemoProvider } from './demo.js';
import { OllamaProvider } from './ollama.js';
import { AnthropicProvider } from './anthropic.js';

export interface ProfileDef {
  prefer: ('anthropic' | 'ollama' | 'demo')[];
  ollamaHint: string[];       // substrings matched against installed models, in order
  temperature: number;
  maxTokens: number;
}

export interface ResolvedModel {
  provider: Provider;
  providerName: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

const FALLBACK_PROFILE: ProfileDef = {
  prefer: ['anthropic', 'ollama', 'demo'],
  ollamaHint: ['llama3', 'qwen', 'mistral', 'gemma'],
  temperature: 0.3,
  maxTokens: 4096,
};

export class ModelRouter {
  demo = new DemoProvider();
  ollama: OllamaProvider;
  anthropic: AnthropicProvider;
  private profiles: Record<string, ProfileDef> = {};
  private ollamaModels: string[] = [];
  private ollamaUp = false;

  constructor(
    private profilesDir: string,
    getOllamaUrl: () => string,
    getAnthropicKey: () => string | undefined,
    getAnthropicModel: () => string,
  ) {
    this.ollama = new OllamaProvider(getOllamaUrl);
    this.anthropic = new AnthropicProvider(getAnthropicKey, getAnthropicModel);
    this.loadProfiles();
  }

  loadProfiles(): void {
    try {
      const file = path.join(this.profilesDir, 'models.json');
      this.profiles = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { this.profiles = {}; }
  }

  async refreshAvailability(): Promise<{ name: string; ok: boolean; models: string[] }[]> {
    this.ollamaUp = await this.ollama.available();
    this.ollamaModels = this.ollamaUp ? await this.ollama.models() : [];
    const anthOk = await this.anthropic.available();
    return [
      { name: 'anthropic', ok: anthOk, models: anthOk ? await this.anthropic.models() : [] },
      { name: 'ollama', ok: this.ollamaUp, models: this.ollamaModels },
      { name: 'demo', ok: true, models: await this.demo.models() },
    ];
  }

  /** Cheapest capable first within the preference chain that is actually up. */
  async resolve(profileName: string): Promise<ResolvedModel> {
    const prof = this.profiles[profileName] ?? FALLBACK_PROFILE;
    for (const pref of prof.prefer) {
      if (pref === 'anthropic' && await this.anthropic.available()) {
        return {
          provider: this.anthropic, providerName: 'anthropic',
          model: (await this.anthropic.models())[0],
          temperature: prof.temperature, maxTokens: prof.maxTokens,
        };
      }
      if (pref === 'ollama' && this.ollamaUp && this.ollamaModels.length > 0) {
        const hint = prof.ollamaHint.find(h => this.ollamaModels.some(m => m.includes(h)));
        const model = hint
          ? this.ollamaModels.find(m => m.includes(hint))!
          : this.ollamaModels[0];
        return {
          provider: this.ollama, providerName: 'ollama', model,
          temperature: prof.temperature, maxTokens: prof.maxTokens,
        };
      }
      if (pref === 'demo') break;
    }
    return {
      provider: this.demo, providerName: 'demo', model: 'demo-engine-v1',
      temperature: prof.temperature, maxTokens: prof.maxTokens,
    };
  }

  async call(resolved: ResolvedModel, req: Omit<ModelRequest, 'temperature' | 'maxTokens'>): Promise<ModelResponse> {
    return resolved.provider.call(resolved.model, {
      ...req,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
    });
  }

  /** Recovery ladder (Q7): the next-stronger energy source than `current`,
   *  or null if none exists. Strength order: demo < ollama < anthropic. */
  async resolveStronger(profileName: string, currentProvider: string): Promise<ResolvedModel | null> {
    const prof = this.profiles[profileName] ?? FALLBACK_PROFILE;
    if (currentProvider !== 'anthropic' && await this.anthropic.available()) {
      return {
        provider: this.anthropic, providerName: 'anthropic',
        model: (await this.anthropic.models())[0],
        temperature: Math.min(prof.temperature, 0.3),   // escalations run cooler
        maxTokens: prof.maxTokens,
      };
    }
    if (currentProvider === 'demo' && this.ollamaUp && this.ollamaModels.length > 0) {
      const hint = prof.ollamaHint.find(h => this.ollamaModels.some(m => m.includes(h)));
      return {
        provider: this.ollama, providerName: 'ollama',
        model: hint ? this.ollamaModels.find(m => m.includes(hint))! : this.ollamaModels[0],
        temperature: Math.min(prof.temperature, 0.3),
        maxTokens: prof.maxTokens,
      };
    }
    return null;
  }
}
