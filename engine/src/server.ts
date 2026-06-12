/**
 * The Bridge server — one WebSocket carrying small JSON events up and
 * commands down, plus a static file server for the built World (so the same
 * engine serves the desktop app and any browser on this machine) and two
 * read-only inspector endpoints (traces, deliverable previews).
 */
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { Tower } from './tower/tower.js';
import { NsCommand, SCHEMA_VERSION, validateCommand } from './contract.js';

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.md': 'text/plain',
};

export interface ServerHandle {
  port: number;
  close(): Promise<void>;
}

export async function startServer(tower: Tower, worldDist: string, preferredPort: number): Promise<ServerHandle> {
  const server = http.createServer((req, res) => handleHttp(tower, worldDist, req, res));
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    // snapshot first, then live events — the world draws, then breathes
    ws.send(JSON.stringify({
      v: SCHEMA_VERSION, id: `snap-${Date.now()}`, ts: Date.now(),
      type: 'engine.snapshot', data: { snapshot: tower.snapshot() },
    }));

    ws.on('message', async (buf) => {
      let cmd: NsCommand;
      try { cmd = JSON.parse(String(buf)); }
      catch { ws.send(JSON.stringify({ ack: null, ok: false, error: 'invalid JSON' })); return; }
      const err = validateCommand(cmd);
      if (err) { ws.send(JSON.stringify({ ack: cmd.reqId ?? null, ok: false, error: err })); return; }
      try {
        const result = await tower.handleCommand(cmd);
        ws.send(JSON.stringify({ ack: cmd.reqId ?? null, ...result }));
      } catch (ex) {
        ws.send(JSON.stringify({ ack: cmd.reqId ?? null, ok: false, error: String((ex as Error).message ?? ex) }));
      }
    });
  });

  const unsubscribe = tower.bus.subscribe((e) => {
    const payload = JSON.stringify(e);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  });

  const port = await listen(server, preferredPort);
  return {
    port,
    close: async () => {
      unsubscribe();
      wss.close();
      await new Promise<void>(r => server.close(() => r()));
    },
  };
}

function listen(server: http.Server, preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (p: number, attemptsLeft: number) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0) tryPort(p + 1, attemptsLeft - 1);
        else reject(err);
      });
      server.listen(p, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
    };
    tryPort(preferred, 10);
  });
}

function handleHttp(tower: Tower, worldDist: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, frozen: tower.registry.data.frozen }));
    return;
  }

  // read-only inspector endpoints (local only — server binds 127.0.0.1)
  if (url.pathname.startsWith('/api/trace/')) {
    const objectiveId = url.pathname.slice('/api/trace/'.length).replace(/[^A-Za-z0-9_-]/g, '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(tower.transparency.readTrace(objectiveId)));
    return;
  }

  if (url.pathname.startsWith('/api/skill/')) {
    const name = url.pathname.slice('/api/skill/'.length).replace(/[^a-z0-9-]/gi, '');
    const content = tower.registry.readSkill(name);
    if (!content) { res.writeHead(404); res.end('unknown skill'); return; }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(content);
    return;
  }

  if (url.pathname === '/api/output') {
    const objectiveId = String(url.searchParams.get('obj') ?? '').replace(/[^A-Za-z0-9_-]/g, '');
    const rel = String(url.searchParams.get('path') ?? '');
    const obj = tower.registry.data.objectives[objectiveId];
    if (!obj) { res.writeHead(404); res.end('unknown objective'); return; }
    const abs = path.resolve(obj.workspace, rel);
    if (!abs.startsWith(path.resolve(obj.workspace) + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(abs)] ?? 'text/plain' });
    fs.createReadStream(abs).pipe(res);
    return;
  }

  // static world
  let rel = url.pathname === '/' ? '/index.html' : url.pathname;
  rel = rel.replace(/\.\./g, '');
  const file = path.join(worldDist, rel);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  // SPA fallback
  const index = path.join(worldDist, 'index.html');
  if (fs.existsSync(index)) {
    res.writeHead(200, { 'content-type': 'text/html' });
    fs.createReadStream(index).pipe(res);
    return;
  }
  res.writeHead(404);
  res.end('NeuralScope engine is running. World assets not built — run: npm run build');
}
