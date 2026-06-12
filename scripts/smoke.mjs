/**
 * End-to-end smoke test — boots the real engine on a temp data dir and drives
 * it over the real WebSocket bridge, exactly like the World does:
 *   1. boot + snapshot
 *   2. objective with a forced first-attempt failure → caught, retried,
 *      validated, delivered (files on disk), memory written, report filed
 *   3. evolution cycle → trials → promotion → skill v2 on disk
 *   4. kill switch mid-flight → frozen; resume → completes
 * Exit 0 = the vertical slice works.
 */
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-smoke-'));
process.env.NEURALSCOPE_HOME = home;
process.env.NEURALSCOPE_FAST = '1';

const { startEngine } = require('../dist/engine/index.cjs');

const events = [];
let ws;
const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1); };
const ok = (msg) => console.log(`✓ ${msg}`);

function send(cmd, data = {}) {
  return new Promise((resolve) => {
    const reqId = `t${Math.random().toString(36).slice(2)}`;
    const onMsg = (raw) => {
      const m = JSON.parse(raw);
      if (m.ack === reqId) { ws.off('message', onMsg); resolve(m); }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ v: 1, cmd, reqId, data }));
  });
}

function waitFor(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const hit = events.find(predicate);
    if (hit) return resolve(hit);
    const timer = setTimeout(() => { ws.off('message', onMsg); reject(new Error(`timeout waiting for ${label}`)); }, timeoutMs);
    const onMsg = (raw) => {
      const e = JSON.parse(raw);
      if (e.type && predicate(e)) { clearTimeout(timer); ws.off('message', onMsg); resolve(e); }
    };
    ws.on('message', onMsg);
  });
}

const engine = await startEngine({ port: 45170 });
ok(`engine booted on :${engine.port} (home: ${home})`);

ws = new WebSocket(`ws://127.0.0.1:${engine.port}/ws`);
// listener must be armed before the handshake completes — the engine fires
// the snapshot the instant the socket opens
ws.on('message', (raw) => { const e = JSON.parse(raw); if (e.type) events.push(e); });
await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });

const snap = await waitFor(e => e.type === 'engine.snapshot', 5000, 'snapshot');
const snapshot = snap.data.snapshot;
if (snapshot.skills.length < 4) fail(`expected seeded skills, got ${snapshot.skills.length}`);
if (!snapshot.providers.find(p => p.name === 'demo' && p.ok)) fail('demo provider missing');
ok(`snapshot: ${snapshot.skills.length} skills seeded, providers up, schema v${snapshot.schemaVersion}`);

// ---- 2 · full objective with a forced failure on the coder's first attempt
const create = await send('objective.create', {
  text: '[demo-fail] Build a one-page website for a cozy bakery called Amber Crumb',
  env: 'main',
});
if (!create.ok) fail(`objective.create rejected: ${create.error}`);
const objId = create.result.objectiveId;
ok(`objective filed: ${objId}`);

await waitFor(e => e.type === 'plan.compiled' && e.objectiveId === objId, 10_000, 'plan.compiled');
ok('flight plan compiled');
const vfail = await waitFor(e => e.type === 'validation.failed' && e.objectiveId === objId, 30_000, 'validation.failed');
ok(`scaffold caught the bad first attempt: ${vfail.data.reasons[0]}`);
await waitFor(e => e.type === 'objective.completed' && e.objectiveId === objId, 60_000, 'objective.completed');
ok('objective completed after retry');

const wsDir = path.join(home, 'workspaces', 'main', objId);
const indexHtml = fs.readFileSync(path.join(wsDir, 'index.html'), 'utf8');
if (!indexHtml.includes('<h1>')) fail('index.html missing <h1>');
if (indexHtml.includes('[demo-fail]')) fail('placeholder survived validation!');
if (!fs.existsSync(path.join(wsDir, 'styles.css'))) fail('styles.css missing');
if (!fs.existsSync(path.join(wsDir, 'artifacts', 'research-notes.md'))) fail('research artifact missing');
ok('real deliverables on disk: index.html + styles.css + artifacts/');

if (!events.find(e => e.type === 'memory.written')) fail('no episodic memory written');
if (!events.find(e => e.type === 'report.filed')) fail('no failure report filed for the evolver');
if (!events.find(e => e.type === 'security.check')) fail('no ring-1 security checks emitted');
ok('memory written · failure report filed · security checks ran');

// ---- 3 · evolution cycle: capture → ... → promote
const evo = await send('evolver.run');
if (!evo.ok) fail(`evolver.run rejected: ${evo.error}`);
const done = await waitFor(e => e.type === 'evolver.cycle.completed', 30_000, 'evolver cycle');
if (done.data.outcome !== 'promoted') fail(`evolver outcome: ${done.data.outcome} (expected promoted)`);
const promoted = events.find(e => e.type === 'evolver.promoted');
const skillUpd = events.find(e => e.type === 'skill.updated' && e.data.by === 'evolver');
if (!promoted || !skillUpd) fail('promotion events missing');
const v2file = path.join(home, 'definitions', 'skills', `${skillUpd.data.name}.v${skillUpd.data.version}.md`);
if (!fs.existsSync(v2file)) fail(`promoted skill file missing: ${v2file}`);
ok(`evolution proven: ${skillUpd.data.name} → v${skillUpd.data.version} after winning replay trials`);

// ---- 4 · kill switch mid-flight, then resume
const c2 = await send('objective.create', { text: 'Build a one-page website for a tiny bookshop called Dog-Ear', env: 'main' });
const obj2 = c2.result.objectiveId;
await waitFor(e => e.type === 'plan.compiled' && e.objectiveId === obj2, 10_000, 'plan 2');
await send('system.kill');
await waitFor(e => e.type === 'engine.killed', 5000, 'engine.killed');
const blocked = await send('objective.create', { text: 'should be rejected', env: 'main' });
if (blocked.ok) fail('frozen engine accepted a command!');
ok('kill switch: engine frozen, commands rejected, workers aborted');
await send('system.resume');
await waitFor(e => e.type === 'engine.resumed', 5000, 'engine.resumed');
await send('circuit.resume', { objectiveId: obj2 });
await waitFor(e => e.type === 'objective.completed' && e.objectiveId === obj2, 60_000, 'objective 2 completes after thaw');
ok('resumed from freeze and completed the interrupted objective');

// ---- events.jsonl is a real black box
const lines = fs.readFileSync(path.join(home, 'state', 'events.jsonl'), 'utf8').trim().split('\n');
if (lines.length < 40) fail(`black box too thin: ${lines.length} events`);
for (const l of lines.slice(0, 5)) JSON.parse(l);
ok(`black box: ${lines.length} validated events on disk`);

await engine.stop();
ws.close();
console.log('\n■ SMOKE TEST PASSED — the vertical slice is alive\n');
process.exit(0);
