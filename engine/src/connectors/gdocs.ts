/**
 * Google Docs gate (Q6). Five guarantees, exactly as the blueprint specifies:
 *   1. OAuth tokens live encrypted in the vault — never in prompts or events.
 *   2. Reads mirror the document into the objective's workspace (auditable).
 *   3. Writes are Tier B and snapshot the document to the blob store FIRST —
 *      every write has a pre-image, so every write is reversible.
 *   4. In the Testing territory all calls hit the local mirror only; the
 *      real document is never touched by a trial.
 *   5. Setup is loopback OAuth (no secrets typed into prompts): the user
 *      supplies their own Google "Desktop app" OAuth client in Settings.
 */
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Connector, ConnectorHealth, ToolCall, ToolResult, Tier } from './types.js';

const DOCS_API = 'https://docs.googleapis.com/v1/documents';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/documents';

interface Tokens { access_token: string; refresh_token?: string; expires_at: number }

export interface GdocsDeps {
  getClientId(): string | undefined;
  getClientSecret(): string | undefined;
  getTokens(): Tokens | undefined;
  setTokens(t: Tokens): void;
  putBlob(content: string): string;
}

export class GdocsConnector implements Connector {
  name = 'gdocs';
  baseTier: Tier = 'B';
  private authServer: http.Server | null = null;

  constructor(private deps: GdocsDeps) {}

  get enabled(): boolean {
    return Boolean(this.deps.getClientId() && this.deps.getTokens());
  }

  configured(): boolean {
    return Boolean(this.deps.getClientId() && this.deps.getClientSecret());
  }

  async health(): Promise<ConnectorHealth> {
    if (!this.configured()) return { ok: false, detail: 'no OAuth client configured (Settings → Google Docs)' };
    if (!this.deps.getTokens()) return { ok: false, detail: 'not connected — run the OAuth flow' };
    return { ok: true, detail: 'connected' };
  }

  tierFor(call: ToolCall): Tier | 'blocked' {
    if (typeof call.args.documentId !== 'string' || !/^[\w-]{10,80}$/.test(call.args.documentId)) return 'blocked';
    if (call.tool === 'read') return 'A';
    if (call.tool === 'append') return 'B';   // autonomous but loudly visible
    return 'blocked';
  }

  // ---- loopback OAuth ------------------------------------------------------
  /** Start the flow: returns the URL the human opens; resolves when Google
   *  redirects back to the loopback listener with a code. */
  beginAuth(): { authUrl: string; done: Promise<void> } {
    const clientId = this.deps.getClientId();
    const clientSecret = this.deps.getClientSecret();
    if (!clientId || !clientSecret) throw new Error('configure your Google OAuth client id + secret first (Settings)');
    this.authServer?.close();

    let resolveDone!: () => void, rejectDone!: (e: Error) => void;
    const done = new Promise<void>((res, rej) => { resolveDone = res; rejectDone = rej; });

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const code = url.searchParams.get('code');
      const err = url.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<body style="font-family:system-ui;background:#060b12;color:#d7e6f2;display:grid;place-items:center;height:100vh"><div><h2>NeuralScope</h2><p>' +
        (code ? 'Google Docs connected — you can close this tab.' : `Authorization failed: ${err ?? 'no code'}`) + '</p></div></body>');
      server.close();
      this.authServer = null;
      if (!code) { rejectDone(new Error(err ?? 'no authorization code')); return; }
      try {
        const port = (server.address() as { port: number }).port;
        await this.exchangeCode(code, `http://127.0.0.1:${port}`);
        resolveDone();
      } catch (ex) { rejectDone(ex as Error); }
    });
    server.listen(0, '127.0.0.1');
    this.authServer = server;
    setTimeout(() => { if (this.authServer === server) { server.close(); rejectDone(new Error('OAuth timed out after 10 minutes')); } }, 600_000).unref();

    const port = (server.address() as { port: number }).port;
    const authUrl = `${AUTH_URL}?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: `http://127.0.0.1:${port}`,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
    })}`;
    return { authUrl, done };
  }

  private async exchangeCode(code: string, redirectUri: string): Promise<void> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.deps.getClientId()!,
        client_secret: this.deps.getClientSecret()!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
    const json = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
    this.deps.setTokens({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: Date.now() + (json.expires_in - 60) * 1000,
    });
  }

  private async accessToken(): Promise<string> {
    let t = this.deps.getTokens();
    if (!t) throw new Error('gdocs not connected');
    if (Date.now() >= t.expires_at && t.refresh_token) {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: t.refresh_token,
          client_id: this.deps.getClientId()!,
          client_secret: this.deps.getClientSecret()!,
          grant_type: 'refresh_token',
        }),
      });
      if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
      const json = await res.json() as { access_token: string; expires_in: number };
      t = { ...t, access_token: json.access_token, expires_at: Date.now() + (json.expires_in - 60) * 1000 };
      this.deps.setTokens(t);
    }
    return t.access_token;
  }

  // ---- tools ---------------------------------------------------------------
  async invoke(call: ToolCall): Promise<ToolResult> {
    const documentId = String(call.args.documentId ?? '');
    const mirror = path.join(call.workspace, 'artifacts', 'gdocs', `${documentId}.txt`);

    try {
      // The hangar rule: trials in Testing touch the mirror, never the API.
      if (call.env === 'testing') {
        if (call.tool === 'read') {
          return { ok: true, value: { documentId, text: fs.existsSync(mirror) ? fs.readFileSync(mirror, 'utf8') : '', mocked: true } };
        }
        if (call.tool === 'append') {
          fs.mkdirSync(path.dirname(mirror), { recursive: true });
          fs.appendFileSync(mirror, String(call.args.text ?? ''));
          return { ok: true, value: { documentId, mocked: true } };
        }
        return { ok: false, error: `unknown tool: ${call.tool}` };
      }

      const token = await this.accessToken();

      if (call.tool === 'read') {
        const text = await this.fetchDocText(documentId, token);
        fs.mkdirSync(path.dirname(mirror), { recursive: true });
        fs.writeFileSync(mirror, text);                       // local mirror
        return { ok: true, value: { documentId, text: text.slice(0, 40_000) } };
      }

      if (call.tool === 'append') {
        const text = String(call.args.text ?? '');
        if (!text || text.length > 20_000) return { ok: false, error: 'append text empty or over 20k chars' };
        // reversibility: snapshot the document BEFORE touching it
        const before = await this.fetchDocText(documentId, token);
        const preImage = this.deps.putBlob(before);
        const res = await fetch(`${DOCS_API}/${documentId}:batchUpdate`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ requests: [{ insertText: { endOfSegmentLocation: {}, text } }] }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return { ok: false, error: `docs api ${res.status}: ${(await res.text()).slice(0, 200)}` };
        fs.mkdirSync(path.dirname(mirror), { recursive: true });
        fs.writeFileSync(mirror, before + text);              // mirror tracks reality
        return { ok: true, value: { documentId, preImageBlob: preImage, appendedChars: text.length } };
      }

      return { ok: false, error: `unknown tool: ${call.tool}` };
    } catch (ex) {
      return { ok: false, error: String((ex as Error).message ?? ex) };
    }
  }

  private async fetchDocText(documentId: string, token: string): Promise<string> {
    const res = await fetch(`${DOCS_API}/${documentId}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`docs api ${res.status}`);
    const doc = await res.json() as { body?: { content?: any[] } };
    const out: string[] = [];
    const walk = (elements: any[]) => {
      for (const el of elements ?? []) {
        if (el.paragraph?.elements) {
          for (const pe of el.paragraph.elements) {
            if (pe.textRun?.content) out.push(pe.textRun.content);
          }
        }
        if (el.table?.tableRows) {
          for (const row of el.table.tableRows) {
            for (const cell of row.tableCells ?? []) walk(cell.content ?? []);
          }
        }
      }
    };
    walk(doc.body?.content ?? []);
    return out.join('');
  }
}
