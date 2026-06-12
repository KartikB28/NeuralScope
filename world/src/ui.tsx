/**
 * The World's instrument panels: objectives, inspector, approvals, settings,
 * skills, traces, onboarding. Every control sends a command down the bridge —
 * the World is a remote control, never a brain.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ObjectiveState } from '../../engine/src/contract';
import { bridge, desktop, WorldState } from './bridge';
import { worldScene } from './scene';

// ---------------------------------------------------------------- top bar
export function TopBar({ st, onOpen }: { st: WorldState; onOpen: (m: string) => void }) {
  const [env, setEnv] = useState<'main' | 'testing' | 'onetime'>('main');
  const gateCount = st.gates.length;
  return (
    <div className="topbar">
      <div className="brand">
        <div className="t">NEURALSCOPE</div>
        <div className="s">living cognitive environment · v0.1</div>
      </div>
      <div className={`conn ${st.connected ? 'on' : ''}`} title={st.connected ? 'engine connected' : 'engine offline'} />
      {(['main', 'testing', 'onetime'] as const).map(k => (
        <button key={k} className={`envbtn ${env === k ? `active-${k}` : ''}`}
          onClick={() => { setEnv(k); worldScene.flyToEnv(k); }}>
          {k.toUpperCase()}
        </button>
      ))}
      <div className="spacer" />
      {gateCount > 0 && (
        <button style={{ color: 'var(--amber)', borderColor: '#54421a' }} onClick={() => onOpen('approvals')}>
          APPROVALS<span className="badge">{gateCount}</span>
        </button>
      )}
      <button onClick={() => onOpen('skills')}>SKILLS</button>
      <button onClick={() => onOpen('memory')}>MEMORY</button>
      <button onClick={() => onOpen('settings')}>SETTINGS</button>
      <button className={`killbtn ${st.frozen ? 'frozen' : ''}`}
        onClick={() => bridge.send(st.frozen ? 'system.resume' : 'system.kill')}>
        {st.frozen ? '◼ FROZEN — RESUME' : '◼ KILL'}
      </button>
    </div>
  );
}

// ------------------------------------------------------------- command bar
const EXAMPLES = [
  { label: 'Build a one-page website for a cozy bakery called Amber Crumb', env: 'main' },
  { label: 'Research and write a report on what makes small AI models reliable', env: 'main' },
  { label: '[demo-fail] Build a landing page for a plant shop called Fern & Co — watch a failure get caught, retried, and fed to the Evolver', env: 'main' },
  { label: 'Build a portfolio site for a freelance photographer (one-time job)', env: 'onetime' },
];

export function CommandBar({ st }: { st: WorldState }) {
  const [text, setText] = useState('');
  const [env, setEnv] = useState<'main' | 'testing' | 'onetime'>('main');
  const [showEx, setShowEx] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (t?: string, e?: string) => {
    const objective = (t ?? text).trim();
    if (!objective || busy) return;
    setBusy(true);
    const res = await bridge.send('objective.create', { text: objective, env: e ?? env });
    setBusy(false);
    if (res.ok) { setText(''); setShowEx(false); }
  };

  return (
    <div className="cmdbar">
      {showEx && (
        <div className="examples">
          {EXAMPLES.map((ex, i) => (
            <div key={i} onClick={() => { setText(ex.label); setEnv(ex.env as any); setShowEx(false); }}>
              {ex.label} <span style={{ color: 'var(--faint)' }}>· {ex.env}</span>
            </div>
          ))}
        </div>
      )}
      <div className="box">
        <button onClick={() => setShowEx(s => !s)} title="example objectives">✦</button>
        <input type="text" placeholder="Tell the system what to do — e.g. build a one-page site for my bakery…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') run(); }}
          disabled={st.frozen}
        />
        <select value={env} onChange={e => setEnv(e.target.value as any)} title="environment">
          <option value="main">main</option>
          <option value="testing">testing</option>
          <option value="onetime">one-time</option>
        </select>
        <button className="primary" onClick={() => run()} disabled={busy || st.frozen || !text.trim()}>
          {busy ? '…' : 'RUN ▸'}
        </button>
      </div>
      <div className="hint">objectives become circuits · drag to orbit · scroll to zoom · click anything to inspect</div>
    </div>
  );
}

// -------------------------------------------------------------- objectives
export function ObjectivesPanel({ st }: { st: WorldState }) {
  const [open, setOpen] = useState(true);
  if (!open) {
    return <div className="panel" style={{ top: 64, left: 14 }}>
      <button style={{ border: 'none' }} onClick={() => setOpen(true)}>▸ OBJECTIVES ({st.objectives.length})</button>
    </div>;
  }
  return (
    <div className="panel panel-objectives">
      <h3 style={{ cursor: 'pointer' }} onClick={() => setOpen(false)}>▾ OBJECTIVES · {st.objectives.length}</h3>
      <div className="list">
        {st.objectives.length === 0 && (
          <div style={{ padding: 14, color: 'var(--dim)', fontSize: 11.5, lineHeight: 1.6 }}>
            No objectives yet. Type one below, or press ✦ for examples.<br />The world stays alive 24/7 — everything you start keeps running.
          </div>
        )}
        {st.objectives.map(o => <ObjectiveCard key={o.id} o={o} />)}
      </div>
    </div>
  );
}

function ObjectiveCard({ o }: { o: ObjectiveState }) {
  const steps = Object.values(o.steps);
  const done = steps.filter(s => s.status === 'completed').length;
  const total = o.plan?.steps.length ?? 0;
  const running = steps.find(s => s.status === 'running');
  const live = o.status === 'compiling' ? 'compiling flight plan…'
    : running ? `${running.id}: ${running.summary || 'working…'}`
    : o.status === 'completed' ? `delivered ${o.deliverables.length} files`
    : o.status === 'failed' ? (o.error ?? 'failed') : '';

  const openOutput = () => {
    if (desktop.isDesktop && o.workspace) desktop.openPath!(o.workspace);
    else {
      const target = o.deliverables.includes('index.html') ? 'index.html'
        : o.deliverables.includes('report.md') ? 'report.md' : o.deliverables[0];
      if (target) window.open(`/api/output?obj=${o.id}&path=${encodeURIComponent(target)}`, '_blank');
    }
  };

  return (
    <div className="obj-card">
      <div className="row1">
        <span className={`chip ${o.status}`}>{o.status.replace('_', ' ')}</span>
        <span className="chip env">{o.env}</span>
        <span className="meta" style={{ marginLeft: 'auto' }}>{total ? `${done}/${total}` : ''}</span>
      </div>
      <div className="text">{o.text}</div>
      <div className="live">{live}</div>
      {total > 0 && <div className="progress"><div style={{ width: `${(done / total) * 100}%` }} /></div>}
      <div className="acts">
        <button onClick={() => { worldScene.focusObjective(o.id); bridge.select({ kind: 'circuit', objectiveId: o.id }); }}>view</button>
        {o.status === 'running' && <button onClick={() => bridge.send('circuit.pause', { objectiveId: o.id })}>⏸ pause</button>}
        {o.status === 'paused' && <button className="good" onClick={() => bridge.send('circuit.resume', { objectiveId: o.id })}>▶ resume</button>}
        {(o.status === 'completed') && <button className="good" onClick={openOutput}>open output</button>}
        {(o.status === 'running' || o.status === 'paused' || o.status === 'compiling') &&
          <button className="danger" onClick={() => bridge.send('objective.cancel', { objectiveId: o.id })}>cancel</button>}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- inspector
export function Inspector({ st, onTrace }: { st: WorldState; onTrace: (objectiveId: string) => void }) {
  const sel = st.selected;
  if (!sel) return null;
  const close = () => bridge.select(null);

  let body: React.ReactNode = null;
  if (sel.kind === 'step') {
    const obj = st.objectives.find(o => o.id === sel.objectiveId);
    const plan = obj?.plan?.steps.find(s => s.id === sel.stepId);
    const stp = obj?.steps[sel.stepId] as any;
    if (obj && plan && stp) {
      body = <>
        <div className="insp-detail">{plan.task}</div>
        <div className="kv"><span className="k">status</span><span className="v">{stp.status}</span></div>
        <div className="kv"><span className="k">worker profile</span><span className="v">{plan.worker}</span></div>
        {stp.model && <div className="kv"><span className="k">model</span><span className="v">{stp.model}</span></div>}
        <div className="kv"><span className="k">skills</span><span className="v">{plan.skills.join(', ') || '—'}</span></div>
        <div className="kv"><span className="k">connectors</span><span className="v">{plan.connectors.join(', ') || 'none'}</span></div>
        <div className="kv"><span className="k">attempts</span><span className="v">{stp.attempts}{stp.reboots ? ` · ${stp.reboots} reboot` : ''}</span></div>
        {stp.summary && <div className="kv"><span className="k">latest</span><span className="v">{stp.summary}</span></div>}
        {stp.failures?.length > 0 && <>
          <div className="kv"><span className="k">recent failures</span><span className="v" /></div>
          {stp.failures.slice(-4).map((f: string, i: number) => <div key={i} className="fail-line">✗ {f}</div>)}
        </>}
        <div className="insp-acts">
          <button onClick={() => onTrace(obj.id)}>black box trace</button>
        </div>
      </>;
    }
  } else if (sel.kind === 'circuit') {
    const obj = st.objectives.find(o => o.id === sel.objectiveId);
    if (obj) {
      body = <>
        <div className="insp-detail">{obj.text}</div>
        <div className="kv"><span className="k">status</span><span className="v">{obj.status}</span></div>
        <div className="kv"><span className="k">environment</span><span className="v">{obj.env}</span></div>
        <div className="kv"><span className="k">model calls</span><span className="v">{obj.modelCalls}</span></div>
        <div className="kv"><span className="k">est. cost</span><span className="v">${obj.estCostUSD.toFixed(3)}</span></div>
        {obj.plan && <div className="kv"><span className="k">goal</span><span className="v">{obj.plan.goal}</span></div>}
        {obj.plan && <>
          <div className="kv"><span className="k">success criteria</span><span className="v" /></div>
          {obj.plan.success_criteria.map((c, i) => <div key={i} className="fail-line" style={{ color: 'var(--muted)' }}>· {c}</div>)}
        </>}
        <div className="insp-acts"><button onClick={() => onTrace(obj.id)}>black box trace</button></div>
      </>;
    }
  } else if (sel.kind === 'gate') {
    const gate = st.gates.find(g => g.id === sel.gateId);
    body = gate ? <>
      <div className="insp-detail" style={{ color: 'var(--amber)' }}>
        Tier {gate.tier} approval gate — the engine is paused here until you decide.
      </div>
      <div className="kv"><span className="k">action</span><span className="v">{gate.action}</span></div>
      <div className="kv"><span className="k">detail</span><span className="v">{gate.detail}</span></div>
      <div className="insp-acts">
        <button className="good" onClick={() => { bridge.send('gate.approve', { gateId: gate.id }); close(); }}>APPROVE</button>
        <button className="danger" onClick={() => { bridge.send('gate.deny', { gateId: gate.id }); close(); }}>DENY</button>
      </div>
    </> : <div className="insp-detail">gate resolved.</div>;
  } else if (sel.kind === 'evolver') {
    const ev = st.snapshot?.evolver;
    body = <>
      <div className="insp-detail">
        The architect. Captures failure reports, mutates structures, trials them against recorded reality in Testing, and promotes only proven winners. Slow, heavy, deliberate — that is the safety mechanism.
      </div>
      <div className="kv"><span className="k">cycles run</span><span className="v">{ev?.cycles ?? 0}</span></div>
      <div className="kv"><span className="k">last outcome</span><span className="v">{ev?.lastOutcome ?? '—'}</span></div>
      <div className="kv"><span className="k">open reports</span><span className="v">{st.snapshot?.reports.length ?? 0}</span></div>
      <div className="insp-acts">
        <button className="good" disabled={ev?.running} onClick={() => bridge.send('evolver.run')}>
          {ev?.running ? 'cycle running…' : 'RUN EVOLUTION CYCLE NOW'}
        </button>
      </div>
    </>;
  } else if (sel.kind === 'memory') {
    const m = st.snapshot?.memory.find(x => x.id === sel.memoryId);
    body = m ? <>
      <div className="insp-detail">{m.summary}</div>
      <div className="kv"><span className="k">tags</span><span className="v">{m.tags.join(', ')}</span></div>
      <div className="kv"><span className="k">relevance</span><span className="v">{(m.relevance * 100).toFixed(0)}% (decays when unused)</span></div>
    </> : <div className="insp-detail">memory crystal (already decayed or rotated out).</div>;
  } else if (sel.kind === 'connector') {
    const c = st.snapshot?.connectors.find(x => x.name === sel.name);
    body = <>
      <div className="insp-detail">Gate on the system boundary: every interaction with the outside world passes through a connector, behind ring-1 checks and permission tiers.</div>
      <div className="kv"><span className="k">connector</span><span className="v">{sel.name}</span></div>
      <div className="kv"><span className="k">status</span><span className="v">{c?.status ?? 'unknown'}</span></div>
      <div className="kv"><span className="k">base tier</span><span className="v">{c?.tier ?? '—'}</span></div>
    </>;
  }

  return (
    <div className="panel panel-inspector">
      <h3 style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>INSPECTOR · {sel.kind.toUpperCase()}</span>
        <span style={{ cursor: 'pointer' }} onClick={close}>✕</span>
      </h3>
      <div className="body">{body}</div>
    </div>
  );
}

// ------------------------------------------------------------------ modals
export function ApprovalsModal({ st, onClose }: { st: WorldState; onClose: () => void }) {
  return (
    <Veil onClose={onClose}>
      <h2>AMBER GATES</h2>
      <div className="sub">Tier-C actions wait here for your decision. Nothing irreversible happens without you.</div>
      {st.gates.length === 0 && <div className="note">No approvals waiting.</div>}
      {st.gates.map(g => (
        <div key={g.id} className="gate-row">
          <div className="ga">{g.action}</div>
          <div className="gd">{g.detail}<br /><span style={{ color: 'var(--faint)' }}>{g.objectiveId} · {g.stepId}</span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="good" onClick={() => bridge.send('gate.approve', { gateId: g.id })}>APPROVE</button>
            <button className="danger" onClick={() => bridge.send('gate.deny', { gateId: g.id })}>DENY</button>
          </div>
        </div>
      ))}
      <div className="foot"><button onClick={onClose}>close</button></div>
    </Veil>
  );
}

export function SettingsModal({ st, onClose }: { st: WorldState; onClose: () => void }) {
  const s = st.snapshot?.settings;
  const providers = st.snapshot?.providers ?? [];
  const [key, setKey] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState(s?.ollamaUrl ?? 'http://127.0.0.1:11434');
  const [model, setModel] = useState(s?.anthropicModel ?? 'claude-sonnet-4-6');
  const [conc, setConc] = useState(s?.concurrency ?? 3);
  const [evoN, setEvoN] = useState(s?.evolverEveryNObjectives ?? 5);
  const [allow, setAllow] = useState((s?.webAllowlist ?? []).join('\n'));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const patch: Record<string, unknown> = {
      ollamaUrl, anthropicModel: model, concurrency: Number(conc),
      evolverEveryNObjectives: Number(evoN),
      webAllowlist: allow.split('\n').map(x => x.trim()).filter(Boolean),
    };
    if (key.trim()) patch.anthropicApiKey = key.trim();
    await bridge.send('settings.update', { patch });
    setSaving(false);
    setKey('');
    onClose();
  };

  return (
    <Veil onClose={onClose}>
      <h2>SETTINGS</h2>
      <div className="sub">
        Energy sources: {providers.map(p => `${p.name} ${p.ok ? '●' : '○'}`).join(' · ')}<br />
        Works out of the box on the built-in demo engine. Install Ollama for real local models; add an Anthropic key for frontier planning.
      </div>

      <label>ANTHROPIC API KEY {s?.hasAnthropicKey ? '· configured ✓ (enter a new one to replace, blank to keep)' : ''}</label>
      <input type="password" placeholder="sk-ant-…" value={key} onChange={e => setKey(e.target.value)} />
      <div className="note">Stored encrypted in the local vault ({s?.dataDir}/vault). Never broadcast, never placed in prompts, never leaves this machine except to call the API.</div>

      <label>ANTHROPIC MODEL (planner / critic roles)</label>
      <select value={model} onChange={e => setModel(e.target.value)}>
        <option value="claude-sonnet-4-6">claude-sonnet-4-6 (recommended)</option>
        <option value="claude-opus-4-8">claude-opus-4-8 (strongest)</option>
        <option value="claude-haiku-4-5-20251001">claude-haiku-4-5 (cheapest)</option>
      </select>

      <label>OLLAMA URL · {providers.find(p => p.name === 'ollama')?.ok
        ? `detected ✓ — ${providers.find(p => p.name === 'ollama')?.models.slice(0, 4).join(', ')}`
        : 'not detected — get it at ollama.com, then `ollama pull llama3.2`'}</label>
      <input type="text" value={ollamaUrl} onChange={e => setOllamaUrl(e.target.value)} />

      <label>PARALLEL WORKERS · {conc}</label>
      <input type="range" min={1} max={8} value={conc} onChange={e => setConc(Number(e.target.value))} style={{ width: '100%' }} />

      <label>RUN EVOLUTION EVERY N COMPLETED OBJECTIVES (0 = manual only)</label>
      <input type="text" value={evoN} onChange={e => setEvoN((e.target.value as any) | 0)} />

      <label>WEB ALLOW-LIST (one domain per line — anything else raises an amber gate)</label>
      <textarea style={{ minHeight: 80 }} value={allow} onChange={e => setAllow(e.target.value)} />

      <label>DATA</label>
      <div className="note">
        Everything lives in <b>{s?.dataDir}</b> — skills, memory, the black box, your outputs. {' '}
        {desktop.isDesktop && <button style={{ marginLeft: 6 }} onClick={() => desktop.openPath!(s!.dataDir)}>open folder</button>}
      </div>

      <div className="foot">
        <button onClick={onClose}>cancel</button>
        <button className="primary" onClick={save} disabled={saving}>{saving ? 'saving…' : 'SAVE'}</button>
      </div>
    </Veil>
  );
}

export function SkillsModal({ st, onClose }: { st: WorldState; onClose: () => void }) {
  const skills = st.snapshot?.skills ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const openSkill = (name: string) => {
    const sk = skills.find(s => s.name === name);
    setEditing(name);
    setLoading(true);
    // preview holds the head; pull the full text via snapshot preview or accept head-edit
    setContent(sk?.preview ?? '');
    // full content comes through fresh snapshot previews (400 chars) — for real editing fetch the trace API? Keep simple: ask engine for full file via snapshot is insufficient → use /api file? v1: the preview is the head; warn user.
    fetch(`/api/skill/${name}`).then(r => r.ok ? r.text() : Promise.reject()).then(t => setContent(t)).catch(() => {}).finally(() => setLoading(false));
  };

  const save = async () => {
    if (!editing) return;
    const res = await bridge.send('skill.edit', { name: editing, content });
    if (res.ok) setEditing(null);
  };

  return (
    <Veil onClose={onClose}>
      <h2>SKILLS — the training manuals</h2>
      <div className="sub">
        Markdown files injected into workers at boot. Edit one and every worker booted from now on uses your version (running workers finish on the old one). The Evolver also rewrites these — every change is a new version, always reversible.
      </div>
      {!editing && <>
        {skills.map(s => (
          <div key={s.name} className="skill-row" onClick={() => openSkill(s.name)}>
            <span className="nm">{s.name}</span>
            <span className="vv">v{s.version}</span>
            <span className="by">edit ▸</span>
          </div>
        ))}
        <div className="foot"><button onClick={onClose}>close</button></div>
      </>}
      {editing && <>
        <label>{editing}.md {loading ? '· loading full file…' : ''}</label>
        <textarea value={content} onChange={e => setContent(e.target.value)} />
        <div className="foot">
          <button onClick={() => setEditing(null)}>back</button>
          <button className="primary" onClick={save}>SAVE AS NEW VERSION</button>
        </div>
      </>}
    </Veil>
  );
}

export function MemoryModal({ st, onClose }: { st: WorldState; onClose: () => void }) {
  const [text, setText] = useState('');
  const mem = st.snapshot?.memory ?? [];
  return (
    <Veil onClose={onClose}>
      <h2>MEMORY — the cargo warehouse</h2>
      <div className="sub">Episodic memories steer future planning; unused ones decay and are swept. Inject knowledge you want the system to keep.</div>
      <label>INJECT A MEMORY</label>
      <input type="text" placeholder="e.g. The user prefers serif fonts and warm colors on all sites" value={text} onChange={e => setText(e.target.value)} />
      <div className="foot" style={{ justifyContent: 'flex-start', marginTop: 8 }}>
        <button className="primary" onClick={async () => { if (text.trim()) { await bridge.send('memory.inject', { text }); setText(''); } }}>INJECT</button>
      </div>
      {[...mem].reverse().map(m => (
        <div key={m.id} className="skill-row" style={{ cursor: 'default' }}>
          <span className="nm" style={{ fontSize: 11.5, flex: 1 }}>{m.summary}</span>
          <span className="vv">{(m.relevance * 100).toFixed(0)}%</span>
        </div>
      ))}
      <div className="foot"><button onClick={onClose}>close</button></div>
    </Veil>
  );
}

export function TraceModal({ objectiveId, onClose }: { objectiveId: string; onClose: () => void }) {
  const [entries, setEntries] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/trace/${objectiveId}`).then(r => r.json()).then(setEntries).catch(() => setEntries([]));
  }, [objectiveId]);
  return (
    <Veil onClose={onClose}>
      <h2>BLACK BOX · {objectiveId}</h2>
      <div className="sub">The complete behavioral record: every prompt, response, tool call and validation. This is also the raw material evolution feeds on.</div>
      {entries.length === 0 && <div className="note">no trace entries yet.</div>}
      {entries.slice(-80).map((e, i) => (
        <div key={i} className="trace-entry">
          <div className="tk">{new Date(e.ts).toLocaleTimeString()} · {e.stepId ?? '—'} · {e.kind.toUpperCase()}</div>
          <pre>{typeof e.content === 'string' ? e.content : JSON.stringify(e.content, null, 1).slice(0, 1600)}</pre>
        </div>
      ))}
      <div className="foot"><button onClick={onClose}>close</button></div>
    </Veil>
  );
}

export function OnboardingModal({ onClose }: { onClose: () => void }) {
  return (
    <Veil onClose={onClose}>
      <div className="onboard">
        <h2>WELCOME TO NEURALSCOPE</h2>
        <div className="sub">A self-improving multi-agent work system you watch and shape inside a living 3D world. The Engine does the work; this World shows you everything it does — nothing is invisible.</div>
        <div className="step-line"><div className="n">1</div><div className="b"><b>File an objective.</b> Type what you want in the bar below (or press ✦ for examples) and hit RUN. A circuit grows in 3D: the plan's shape IS the structure you see. It works instantly on the built-in demo engine — no setup, no keys.</div></div>
        <div className="step-line"><div className="n">2</div><div className="b"><b>Watch, inspect, shape.</b> Click any node — workers (red), skills (green), security orbits (white), the Evolver (green giant). Pause circuits, approve amber gates, edit skills live, read the black box. The big red KILL freezes everything instantly.</div></div>
        <div className="step-line"><div className="n">3</div><div className="b"><b>Give it real power.</b> In SETTINGS: point at Ollama for real local models (free, private) and/or add an Anthropic API key for frontier planning. Same pipeline, stronger brains. Failures become reports; the Evolver rewrites skills and proves them in Testing before they ship.</div></div>
        <div className="foot">
          <button className="primary" onClick={onClose}>ENTER THE WORLD ▸</button>
        </div>
      </div>
    </Veil>
  );
}

function Veil({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-veil" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">{children}</div>
    </div>
  );
}

// --------------------------------------------------------------- chrome
export function Ticker({ st }: { st: WorldState }) {
  return (
    <div className="ticker">
      {st.ticker.slice(-5).map(l => <span key={l.id} className={l.tone}>{l.text}</span>)}
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
      <div><span style={{ color: '#ff2742' }}>●</span> worker · <span style={{ color: '#8be32a' }}>▮</span> skill · <span style={{ color: '#16a6e0' }}>▢</span> transparency · <span style={{ color: '#f2f8ff' }}>◌</span> security</div>
      <div><span style={{ color: '#1db954' }}>⬡</span> evolver · <span style={{ color: '#d8a93c' }}>◆</span> amber gate · <span style={{ color: '#9d7bff' }}>✦</span> memory · <span style={{ color: '#b03030' }}>—</span> failure report</div>
    </div>
  );
}

export function Toasts({ st }: { st: WorldState }) {
  return (
    <div className="toasts">
      {st.toasts.map(t => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <div>
            <div className="tt">{t.title}</div>
            {t.body && <div className="tb">{t.body}</div>}
            {t.objectiveId && t.tone === 'good' && (
              <div style={{ marginTop: 6 }}>
                <OpenOutputButton objectiveId={t.objectiveId} />
              </div>
            )}
          </div>
          <button className="x" onClick={() => bridge.dismissToast(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

function OpenOutputButton({ objectiveId }: { objectiveId: string }) {
  const o = bridge.state.objectives.find(x => x.id === objectiveId);
  if (!o) return null;
  const open = () => {
    if (desktop.isDesktop && o.workspace) desktop.openPath!(o.workspace);
    else {
      const target = o.deliverables.includes('index.html') ? 'index.html'
        : o.deliverables.includes('report.md') ? 'report.md' : o.deliverables[0];
      if (target) window.open(`/api/output?obj=${o.id}&path=${encodeURIComponent(target)}`, '_blank');
    }
  };
  return <button className="good" onClick={open}>open the result ▸</button>;
}

export function FrozenOverlay({ st }: { st: WorldState }) {
  if (!st.frozen) return null;
  return (
    <div className="frozen-veil">
      <div className="big">FROZEN</div>
      <div className="small">Kill switch engaged. Every worker stopped, every gate closed, state snapshotted.</div>
      <button className="primary" onClick={() => bridge.send('system.resume')}>RESUME THE ENGINE</button>
    </div>
  );
}

export function EvolverBanner({ st }: { st: WorldState }) {
  if (!st.evolverPhase) return null;
  return <div className="evo-banner">⬡ EVOLVER · {st.evolverPhase}</div>;
}
