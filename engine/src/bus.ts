/**
 * Layer 4 — the Event Bus. Every Engine action becomes exactly one event:
 * validated against the frozen contract, appended to the black box
 * (events.jsonl), then fanned out to subscribers (the WebSocket bridge,
 * the transparency analyzer, the governor).
 */
import * as fs from 'node:fs';
import { NsEvent, EventType, EnvName, SCHEMA_VERSION, validateEvent } from './contract.js';

export type Listener = (e: NsEvent) => void;

export interface EmitMeta {
  objectiveId?: string;
  stepId?: string;
  workerId?: string;
  env?: EnvName;
}

export class EventBus {
  private listeners = new Set<Listener>();
  private seq = 0;
  private stream: fs.WriteStream | null = null;
  private recent: NsEvent[] = [];

  constructor(private eventsFile: string, private maxRecent = 500) {}

  open(): void {
    this.stream = fs.createWriteStream(this.eventsFile, { flags: 'a' });
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type: EventType, data: Record<string, unknown> = {}, meta: EmitMeta = {}): NsEvent {
    const e: NsEvent = {
      v: SCHEMA_VERSION,
      id: `E${Date.now().toString(36)}-${(this.seq++).toString(36)}`,
      ts: Date.now(),
      type,
      ...meta,
      data,
    };
    const err = validateEvent(e);
    if (err) {
      // A contract violation is a programming error — make it loud, never silent.
      throw new Error(`event contract violation (${type}): ${err}`);
    }
    // black box first — the record must exist even if a listener throws
    // (snapshots are connection-scoped chatter, not history)
    if (type !== 'engine.snapshot') {
      this.stream?.write(JSON.stringify(e) + '\n');
      this.recent.push(e);
      if (this.recent.length > this.maxRecent) this.recent.shift();
    }
    for (const fn of this.listeners) {
      try { fn(e); } catch (ex) {
        console.error(`[bus] listener failed on ${type}:`, ex);
      }
    }
    return e;
  }

  recentEvents(): NsEvent[] { return [...this.recent]; }
}
