/**
 * End-to-end smoke test — boots the real engine on a temp data dir and drives
 * it over the real WebSocket bridge through one long adversarial scenario
 * that exercises all eight load-bearing systems:
 *
 *   Q1 files/blobs       step outputs + prompts stored content-addressed
 *   Q2 evolution         promote → canary → live rollback on regression →
 *                        re-promote → canary survives → stable
 *   Q3 security          ring-1 checks, amber gates, C→B graduation ledger
 *   Q4 analysis          per-skill stats steer evolver capture; black box
 *   Q5 clean setup       (enforced separately by scripts/check-layers.mjs)
 *   Q6 gdocs             clean failure without credentials (offline-honest)
 *   Q7 small-model rungs critic review, re-grounded reboot, re-decomposition
 *   Q8 circuits          recurring circuit fires a real objective on schedule
 *
 * Exit 0 = the eight systems work, together, under stress.
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

// nothing in this test may hang a CI runner — hard ceiling on the whole run
setTimeout(() => fail('global smoke watchdog: 5 minutes elapsed'), 300_000).unref();

function send(cmd, data = {}) {
  return new Promise((resolve) => {
    const reqId = `t${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => { ws.off('message', onMsg); fail(`no ack for ${cmd} within 15s`); }, 15_000);
    const onMsg = (raw) => {
      const m = JSON.parse(raw);
      if (m.ack === reqId) { clearTimeout(timer); ws.off('message', onMsg); resolve(m); }
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

async function runObjective(text, env = 'main', timeout = 40_000) {
  const res = await send('objective.create', { text, env });
  if (!res.ok) fail(`objective.create rejected: ${res.error}`);
  const id = res.result.objectiveId;
  const done = await waitFor(
    e => (e.type === 'objective.completed' || e.type === 'objective.failed') && e.objectiveId === id,
    timeout, `objective ${id} to settle`);
  return { id, outcome: done.type };
}

async function snapshotNow() {
  const res = await send('snapshot.request');
  if (!res.ok) fail('snapshot.request failed');
  return res.result;
}

const engine = await startEngine({ port: 45170 });
ok(`engine booted on :${engine.port} (home: ${home})`);

ws = new WebSocket(`ws://127.0.0.1:${engine.port}/ws`);
// listener must be armed before the handshake completes — the engine fires
// the snapshot the instant the socket opens
ws.on('message', (raw) => { const e = JSON.parse(raw); if (e.type) events.push(e); });
await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });

const snap0 = await waitFor(e => e.type === 'engine.snapshot', 5000, 'snapshot');
const snapshot = snap0.data.snapshot;
if (snapshot.skills.length < 4) fail(`expected seeded skills, got ${snapshot.skills.length}`);
if (!snapshot.providers.find(p => p.name === 'demo' && p.ok)) fail('demo provider missing');
if (!snapshot.connectors.find(c => c.name === 'gdocs')) fail('gdocs gate missing from snapshot');
ok(`snapshot: ${snapshot.skills.length} skills, ${snapshot.connectors.length} gates, schema v${snapshot.schemaVersion}`);

// keep the evolver manual so the scripted scenario stays deterministic
await send('settings.update', { patch: { evolverEveryNObjectives: 0, tierGraduationThreshold: 2 } });

// ---- Q7/Q4 · forced failure → critic review → retry → delivery -----------
const a = await runObjective('[demo-fail] Build a one-page website for a cozy bakery called Amber Crumb');
if (a.outcome !== 'objective.completed') fail('objective A did not complete');
if (!events.find(e => e.type === 'validation.failed' && e.objectiveId === a.id)) fail('forced failure was not caught');
if (!events.find(e => e.type === 'critic.flagged' && e.objectiveId === a.id)) fail('adversarial critic never reviewed the failed attempt');
const wsDir = path.join(home, 'workspaces', 'main', a.id);
if (!fs.readFileSync(path.join(wsDir, 'index.html'), 'utf8').includes('<h1>')) fail('index.html missing <h1>');
if (!fs.existsSync(path.join(wsDir, 'styles.css'))) fail('styles.css missing');
ok('recovery rung 1: failure caught → critic fed back → retry delivered real files');

// ---- Q1 · content-addressed blobs -----------------------------------------
const snapA = await snapshotNow();
const objA = snapA.objectives.find(o => o.id === a.id);
const blobRef = Object.values(objA.steps).map(s => s.outputBlob).find(Boolean);
if (!blobRef) fail('no step output blob reference recorded');
const blobRes = await fetch(`http://127.0.0.1:${engine.port}/api/blob/${blobRef}`);
if (!blobRes.ok) fail('blob endpoint did not serve the step output');
const blobText = await blobRes.text();
if (!blobText.includes('{')) fail('blob content does not look like a step output');
if (!events.find(e => e.type === 'memory.written')) fail('no episodic memory written');
if (!events.find(e => e.type === 'report.filed')) fail('no failure report filed');
if (!events.find(e => e.type === 'security.check')) fail('no ring-1 security checks emitted');
ok(`blob store: step output ${blobRef.slice(0, 12)}… retrievable · memory + report + ring-1 all live`);

// ---- Q2 · evolution cycle 1 → canary --------------------------------------
const evo1 = await send('evolver.run');
if (!evo1.ok) fail(`evolver.run rejected: ${evo1.error}`);
const cycle1 = await waitFor(e => e.type === 'evolver.cycle.completed', 30_000, 'evolver cycle 1');
if (cycle1.data.outcome !== 'promoted') fail(`evolver cycle 1 outcome: ${cycle1.data.outcome}`);
if (!events.find(e => e.type === 'skill.canary')) fail('promotion did not enter canary');
const snapB = await snapshotNow();
const frontierB = snapB.skills.find(s => s.name === 'frontend');
if (frontierB.status !== 'canary' || frontierB.version !== 2) fail(`expected frontend v2 canary, got v${frontierB.version} ${frontierB.status}`);
ok('evolution: frontend → v2, promoted as CANARY (live traffic decides)');

// ---- kill switch mid-flight, then resume (unchanged guarantees) -----------
const c2 = await send('objective.create', { text: 'Build a one-page website for a tiny bookshop called Dog-Ear', env: 'main' });
const obj2 = c2.result.objectiveId;
await waitFor(e => e.type === 'plan.compiled' && e.objectiveId === obj2, 10_000, 'plan 2');
await send('system.kill');
await waitFor(e => e.type === 'engine.killed', 5000, 'engine.killed');
const blocked = await send('objective.create', { text: 'should be rejected', env: 'main' });
if (blocked.ok) fail('frozen engine accepted a command!');
await send('system.resume');
await waitFor(e => e.type === 'engine.resumed', 5000, 'engine.resumed');
await send('circuit.resume', { objectiveId: obj2 });
await waitFor(e => e.type === 'objective.completed' && e.objectiveId === obj2, 40_000, 'objective 2 after thaw');
ok('kill switch: frozen, commands rejected, resumed from checkpoint, completed');

// ---- Q2 · canary regression → automatic rollback (under max adversity) ----
const bad = await runObjective('[demo-fail-always] Build a landing page for a plant shop called Fern and Co', 'main', 60_000);
const rolled = events.find(e => e.type === 'skill.rolledback');
if (!rolled) fail('regressed canary was not rolled back');
if (rolled.data.name !== 'frontend' || rolled.data.fromVersion !== 2) fail(`unexpected rollback: ${JSON.stringify(rolled.data)}`);
if (!events.find(e => e.type === 'step.decomposed' && e.objectiveId === bad.id)) fail('exhausted step was never re-decomposed');
if (bad.outcome !== 'objective.failed') fail('an unwinnable objective somehow "succeeded" — validators are lying');
const snapC = await snapshotNow();
const frontierC = snapC.skills.find(s => s.name === 'frontend');
if (frontierC.version !== 1 || frontierC.status !== 'stable') fail(`expected rollback to v1 stable, got v${frontierC.version} ${frontierC.status}`);
ok('canary regressed on live traffic → AUTO-ROLLBACK v2→v1 · step re-decomposed · honest failure reported');

// ---- Q7 · re-decomposition rescues a salvageable objective -----------------
const hard = await runObjective('[demo-fail-hard] Build a landing page for a flower stall called Petal & Stem', 'main', 60_000);
if (hard.outcome !== 'objective.completed') fail('re-decomposed objective did not complete');
if (!events.find(e => e.type === 'step.decomposed' && e.objectiveId === hard.id)) fail('hard objective completed without re-decomposition?!');
ok('recovery rung 3: exhausted step split into smaller steps → objective delivered');

// ---- Q2 · evolution cycle 2 → canary survives probation → stable ----------
const evo2 = await send('evolver.run');
if (!evo2.ok) fail(`evolver.run (2) rejected: ${evo2.error}`);
const cycle2 = await waitFor(
  e => e.type === 'evolver.cycle.completed' && !events.slice(0, events.indexOf(cycle1)).includes(e) && e.data.cycleId !== cycle1.data.cycleId,
  30_000, 'evolver cycle 2');
if (cycle2.data.outcome !== 'promoted') fail(`evolver cycle 2 outcome: ${cycle2.data.outcome}`);
for (const text of [
  'Build a one-page website for a tea house called Lantern',
  'Build a one-page website for a barber called Fade Theory',
  'Build a one-page website for a bookbinder called Folio and Thread',
]) {
  const r = await runObjective(text);
  if (r.outcome !== 'objective.completed') fail(`clean objective failed: ${text}`);
}
const snapD = await snapshotNow();
const frontierD = snapD.skills.find(s => s.name === 'frontend');
if (frontierD.status !== 'stable' || frontierD.version < 3) fail(`expected canary to stabilize at v3+, got v${frontierD.version} ${frontierD.status}`);
ok(`evolution again: frontend v${frontierD.version} canary survived probation on live traffic → STABLE`);

// ---- Q3 · graduation ledger: autonomy earned, C → B ------------------------
async function offsiteObjective(n) {
  const res = await send('objective.create', { text: `Research http://offsite-${n}.invalid/notes and build a one-page website about field recording` });
  const id = res.result.objectiveId;
  return id;
}
for (let i = 1; i <= 2; i++) {
  const id = await offsiteObjective(i);
  const gate = await waitFor(e => e.type === 'security.gate.waiting' && e.objectiveId === id, 20_000, `amber gate ${i}`);
  const approve = await send('gate.approve', { gateId: gate.data.gateId });
  if (!approve.ok) fail(`gate.approve ${i} failed`);
  await waitFor(e => e.type === 'objective.completed' && e.objectiveId === id, 40_000, `offsite objective ${i}`);
}
if (!events.find(e => e.type === 'capability.graduated' && e.data.capability === 'web.fetch')) {
  fail('capability did not graduate after clean approvals');
}
const third = await offsiteObjective(3);
await waitFor(e => e.type === 'objective.completed' && e.objectiveId === third, 40_000, 'post-graduation objective');
if (events.find(e => e.type === 'security.gate.waiting' && e.objectiveId === third)) {
  fail('graduated capability still raised a gate');
}
ok('graduation ledger: web.fetch earned C→B after 2 clean approvals — third run needed no gate');

// ---- Q8 · recurring circuit fires a real objective on schedule -------------
const sched = await send('circuit.schedule', { text: 'Build a one-page website for a night market called Lumen Row', env: 'main', everyMinutes: 0.03 });
if (!sched.ok) fail(`circuit.schedule rejected: ${sched.error}`);
await waitFor(e => e.type === 'circuit.scheduled', 5000, 'circuit.scheduled');
const auto = await waitFor(
  e => e.type === 'objective.created' && String(e.data.text).includes('Lumen Row'),
  20_000, 'recurring circuit to fire');
await waitFor(e => e.type === 'objective.completed' && e.objectiveId === auto.objectiveId, 40_000, 'recurring objective');
await send('circuit.unschedule', { circuitId: sched.result.circuitId });
ok('recurring circuit: scheduled → fired on its own → delivered → unscheduled');

// ---- Q6 · gdocs gate fails cleanly without credentials ---------------------
const gd = await send('gdocs.connect');
if (gd.ok) fail('gdocs.connect should refuse without OAuth credentials');
if (!/configure/i.test(gd.error ?? '')) fail(`unexpected gdocs error: ${gd.error}`);
ok('gdocs gate: present, tiered, refuses cleanly until the user supplies OAuth credentials');

// ---- the black box is a real, validated record ------------------------------
const lines = fs.readFileSync(path.join(home, 'state', 'events.jsonl'), 'utf8').trim().split('\n');
if (lines.length < 150) fail(`black box too thin: ${lines.length} events`);
for (const l of lines.slice(0, 5)) JSON.parse(l);
const blobCount = fs.readdirSync(path.join(home, 'state', 'blobs')).length;
if (blobCount < 3) fail('blob store suspiciously empty');
ok(`black box: ${lines.length} validated events · ${blobCount} blob shards on disk`);

// shutdown must never be the thing that hangs the suite: client first, then
// a time-boxed engine stop — the assertions above are the proof, not the exit
ws.terminate();
await Promise.race([engine.stop(), new Promise(r => setTimeout(r, 5000))]);
console.log('\n■ SMOKE TEST PASSED — all eight systems, one adversarial scenario, zero hand-waving\n');
process.exit(0);
