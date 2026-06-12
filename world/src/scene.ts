/**
 * Layer 5 — the living World. Renders the Engine's event stream as
 * structures in space. Every visual here is driven by a real event or real
 * snapshot state; nothing is invented. (The event→animation dictionary lives
 * in definitions/schema/events.v1.json.)
 */
import * as THREE from 'three';
import type { NsEvent, ObjectiveState, Snapshot, EnvName } from '../../engine/src/contract';
import { bridge, Selection } from './bridge';

const C = {
  bg: 0x03070c, path: 0xe8f4ff, codeRay: 0x1494e8, llm: 0xff2742, skill: 0x8be32a,
  transparency: 0x16a6e0, security: 0xf2f8ff, evolver: 0x1db954, report: 0xb03030,
  pulse: 0x9fe8ff, amber: 0xd8a93c, memory: 0x9d7bff,
  pending: 0x274258, ready: 0x1fb3e8, running: 0xff2742, completed: 0xe8f4ff,
  failed: 0xb03030, blocked: 0xd8a93c,
};

const ANCHORS: Record<EnvName, THREE.Vector3> = {
  main: new THREE.Vector3(0, 0, 0),
  testing: new THREE.Vector3(360, 10, -120),
  onetime: new THREE.Vector3(-330, -20, 140),
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

interface CircuitView {
  id: string;
  env: EnvName;
  group: THREE.Group;
  anchor: THREE.Vector3;
  nodeByStep: Map<string, THREE.Mesh>;
  edges: { line: THREE.Line; from: string; to: string; a: THREE.Vector3; b: THREE.Vector3 }[];
  frame: THREE.Mesh | null;
  orbiter: THREE.Mesh | null;
  orbitPhase: number;
  seed: THREE.Mesh | null;
  gateNodes: Map<string, THREE.Mesh>;
  dissolveAt: number | null;
  securityPulse: number;
}

interface Transient { obj: THREE.Object3D; bornAt: number; ttlMs: number; update?: (k: number) => void }

export class WorldScene {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private raf = 0;
  private clock = new THREE.Clock();
  private circuits = new Map<string, CircuitView>();
  private memoryCrystals = new Map<string, THREE.Mesh>();
  private connectorGates = new Map<string, THREE.Mesh>();
  private evolvers = new Map<string, THREE.Mesh>();
  private evolverClones: THREE.Mesh[] = [];
  private transients: Transient[] = [];
  private pulses: { mesh: THREE.Mesh; a: THREE.Vector3; b: THREE.Vector3; t: number; speed: number }[] = [];
  private pickables: THREE.Object3D[] = [];
  private selectedMesh: THREE.Object3D | null = null;
  private selRing!: THREE.Mesh;
  private evolverBusy = false;

  private geo = {
    step: new THREE.OctahedronGeometry(3.4, 0),
    seed: new THREE.SphereGeometry(2.6, 16, 16),
    skill: new THREE.BoxGeometry(5.6, 1.8, 3.0),
    frame: new THREE.BoxGeometry(7, 7, 7),
    orbiter: new THREE.SphereGeometry(4.0, 12, 12),
    gate: new THREE.OctahedronGeometry(4.2, 0),
    memory: new THREE.DodecahedronGeometry(2.2, 0),
    pulse: new THREE.SphereGeometry(1.0, 8, 8),
    connector: new THREE.BoxGeometry(10, 4, 10),
  };

  private statusMat: Record<string, THREE.MeshBasicMaterial> = {
    pending: new THREE.MeshBasicMaterial({ color: C.pending }),
    ready: new THREE.MeshBasicMaterial({ color: C.ready }),
    running: new THREE.MeshBasicMaterial({ color: C.running }),
    completed: new THREE.MeshBasicMaterial({ color: C.completed }),
    failed: new THREE.MeshBasicMaterial({ color: C.failed }),
    blocked: new THREE.MeshBasicMaterial({ color: C.blocked }),
  };
  private mat = {
    skill: new THREE.MeshStandardMaterial({ color: C.skill, emissive: C.skill, emissiveIntensity: 0.4, roughness: 0.5 }),
    path: new THREE.LineBasicMaterial({ color: C.path, transparent: true, opacity: 0.55 }),
    codeRay: new THREE.LineBasicMaterial({ color: C.codeRay, transparent: true, opacity: 0.65 }),
    frame: new THREE.MeshBasicMaterial({ color: C.transparency, transparent: true, opacity: 0.10 }),
    frameEdge: new THREE.LineBasicMaterial({ color: C.transparency, transparent: true, opacity: 0.9 }),
    orbiter: new THREE.MeshBasicMaterial({ color: C.security, wireframe: true, transparent: true, opacity: 0.5 }),
    gate: new THREE.MeshBasicMaterial({ color: C.amber }),
    memory: new THREE.MeshBasicMaterial({ color: C.memory, transparent: true, opacity: 0.85 }),
    pulse: new THREE.MeshBasicMaterial({ color: C.pulse }),
    report: new THREE.LineBasicMaterial({ color: C.report, transparent: true, opacity: 0.5 }),
    evolverFill: new THREE.MeshStandardMaterial({ color: C.evolver, emissive: C.evolver, emissiveIntensity: 0.2, transparent: true, opacity: 0.16, roughness: 0.4 }),
    evolverEdge: new THREE.LineBasicMaterial({ color: C.evolver, transparent: true, opacity: 0.95 }),
    connectorUp: new THREE.MeshBasicMaterial({ color: 0x27c46a, transparent: true, opacity: 0.85 }),
    connectorDown: new THREE.MeshBasicMaterial({ color: 0xff3b52, transparent: true, opacity: 0.85 }),
    globe: new THREE.MeshBasicMaterial({ color: 0x10324a, wireframe: true, transparent: true, opacity: 0.10 }),
  };

  private ctrl = {
    target: ANCHORS.main.clone(),
    sph: new THREE.Spherical(330, Math.PI / 2.5, Math.PI / 4),
    dragging: false, lastX: 0, lastY: 0, moved: 0, pinch: 0,
    flyFrom: null as THREE.Vector3 | null, flyTo: null as THREE.Vector3 | null,
    flyT: 1, rFrom: 330, rTo: 330,
  };

  private container!: HTMLElement;
  private unsubScene: (() => void) | null = null;
  private listeners: [EventTarget, string, any, any?][] = [];

  // ------------------------------------------------------------------ setup
  init(container: HTMLElement): void {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(C.bg);
    this.scene.fog = new THREE.FogExp2(C.bg, 0.0015);

    this.camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 5000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.PointLight(0x66ccff, 0.9, 0, 2);
    key.position.set(120, 220, 160);
    this.scene.add(key);

    this.addStars();
    this.addTerritories();
    this.addGlobe();
    this.addEvolver('main', ANCHORS.main.clone().add(new THREE.Vector3(-110, -65, 70)), 20);
    this.addEvolver('testing', ANCHORS.testing.clone().add(new THREE.Vector3(-30, -50, 30)), 15);

    this.selRing = new THREE.Mesh(
      new THREE.TorusGeometry(6.5, 0.35, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    );
    this.selRing.visible = false;
    this.scene.add(this.selRing);

    this.bindInput();
    this.applyCamera();

    this.unsubScene = bridge.onSceneEvent((e) => this.onEvent(e));
    if (bridge.state.snapshot) this.rebuild(bridge.state.snapshot);

    this.animate();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.unsubScene?.();
    for (const [t, n, f, o] of this.listeners) t.removeEventListener(n, f, o);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------------------------------------------------------------- statics
  private addStars(): void {
    const N = 1700;
    const pos = new Float32Array(N * 3);
    const rng = mulberry(20260612);
    for (let i = 0; i < N; i++) {
      const r = 950 + rng() * 1500, th = rng() * Math.PI * 2, ph = Math.acos(2 * rng() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph);
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x4a6a88, size: 1.6, transparent: true, opacity: 0.8 })));
  }

  private addTerritories(): void {
    const ring = (center: THREE.Vector3, radius: number, color: number, op: number) => {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(radius - 1.2, radius, 96),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.copy(center).add(new THREE.Vector3(0, -70, 0));
      this.scene.add(mesh);
    };
    ring(ANCHORS.main, 210, 0x1e6e9e, 0.22);
    ring(ANCHORS.testing, 140, 0x1db954, 0.2);
    ring(ANCHORS.onetime, 100, 0xc8a23a, 0.2);
  }

  /** The globe is the boundary of the system; connectors sit on its shell. */
  private addGlobe(): void {
    const globe = new THREE.Mesh(new THREE.SphereGeometry(640, 36, 24), this.mat.globe);
    globe.position.set(10, -10, 10);
    this.scene.add(globe);
  }

  private addEvolver(key: string, pos: THREE.Vector3, size: number): void {
    const g = new THREE.IcosahedronGeometry(size, 0);
    const fill = new THREE.Mesh(g, this.mat.evolverFill);
    fill.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), this.mat.evolverEdge));
    fill.position.copy(pos);
    fill.userData.sel = { kind: 'evolver' } satisfies Selection;
    this.scene.add(fill);
    this.pickables.push(fill);
    this.evolvers.set(key, fill);
  }

  // ----------------------------------------------------- snapshot → rebuild
  rebuild(snap: Snapshot): void {
    for (const cv of this.circuits.values()) this.scene.remove(cv.group);
    this.circuits.clear();
    for (const m of this.memoryCrystals.values()) this.scene.remove(m);
    this.memoryCrystals.clear();
    for (const m of this.connectorGates.values()) this.scene.remove(m);
    this.connectorGates.clear();
    this.pickables = this.pickables.filter(p => (p.userData.sel as Selection)?.kind === 'evolver');

    for (const obj of snap.objectives) {
      if (obj.status === 'cancelled') continue;
      const aged = obj.endedAt && Date.now() - obj.endedAt > 24 * 3600_000;
      if (aged && obj.status !== 'completed') continue;
      this.buildCircuit(obj);
    }
    snap.memory.forEach((m, i) => this.addMemoryCrystal(m.id, m.relevance, i));
    snap.connectors.forEach((c, i) => this.addConnectorGate(c.name, c.status === 'up', i, snap.connectors.length));
  }

  private circuitAnchor(obj: ObjectiveState): THREE.Vector3 {
    const h = hash(obj.id);
    const angle = (h % 628) / 100;
    const radius = 55 + (h % 90);
    const y = ((h >> 8) % 70) - 35;
    return ANCHORS[obj.env].clone().add(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
  }

  private buildCircuit(obj: ObjectiveState): void {
    const anchor = this.circuitAnchor(obj);
    const group = new THREE.Group();
    this.scene.add(group);
    const cv: CircuitView = {
      id: obj.id, env: obj.env, group, anchor, nodeByStep: new Map(), edges: [],
      frame: null, orbiter: null, orbitPhase: Math.random() * Math.PI * 2,
      seed: null, gateNodes: new Map(), dissolveAt: null, securityPulse: 0,
    };
    this.circuits.set(obj.id, cv);

    if (!obj.plan) {
      const seed = new THREE.Mesh(this.geo.seed, this.statusMat.ready);
      seed.position.copy(anchor);
      seed.userData.sel = { kind: 'circuit', objectiveId: obj.id } satisfies Selection;
      group.add(seed);
      this.pickables.push(seed);
      cv.seed = seed;
      return;
    }
    this.growPlan(cv, obj);
  }

  /** plan.compiled — the task graph IS the circuit. */
  private growPlan(cv: CircuitView, obj: ObjectiveState): void {
    if (cv.seed) { cv.group.remove(cv.seed); this.unpick(cv.seed); cv.seed = null; }
    const plan = obj.plan!;
    const rng = mulberry(hash(obj.id));

    // layered DAG layout: depth = longest path from a root
    const depth = new Map<string, number>();
    const calc = (id: string): number => {
      if (depth.has(id)) return depth.get(id)!;
      const step = plan.steps.find(s => s.id === id)!;
      const d = step.depends_on.length === 0 ? 0 : Math.max(...step.depends_on.map(calc)) + 1;
      depth.set(id, d);
      return d;
    };
    plan.steps.forEach(s => calc(s.id));
    const lanes = new Map<number, number>();

    const positions = new Map<string, THREE.Vector3>();
    for (const step of plan.steps) {
      const d = depth.get(step.id)!;
      const lane = lanes.get(d) ?? 0;
      lanes.set(d, lane + 1);
      const pos = cv.anchor.clone().add(new THREE.Vector3(
        d * 30 + (rng() - 0.5) * 6,
        lane * 22 - 8 + (rng() - 0.5) * 8,
        (rng() - 0.5) * 26,
      ));
      positions.set(step.id, pos);

      const st = obj.steps[step.id];
      const mesh = new THREE.Mesh(this.geo.step, this.statusMat[st?.status ?? 'pending']);
      mesh.position.copy(pos);
      mesh.userData.sel = { kind: 'step', objectiveId: obj.id, stepId: step.id } satisfies Selection;
      mesh.userData.baseY = pos.y;
      mesh.userData.phase = rng() * Math.PI * 2;
      cv.group.add(mesh);
      cv.nodeByStep.set(step.id, mesh);
      this.pickables.push(mesh);

      // green skill slabs under the node
      step.skills.slice(0, 2).forEach((_, i) => {
        const slab = new THREE.Mesh(this.geo.skill, this.mat.skill);
        slab.position.copy(pos).add(new THREE.Vector3((rng() - 0.5) * 4, -6 - i * 3, (rng() - 0.5) * 4));
        slab.rotation.y = rng() * Math.PI;
        cv.group.add(slab);
      });
      // blue scaffold rays — the deterministic code around the worker
      const rays = 2 + Math.floor(rng() * 2);
      for (let r = 0; r < rays; r++) {
        const end = pos.clone().add(new THREE.Vector3((rng() - 0.5) * 44, (rng() - 0.5) * 36, (rng() - 0.5) * 44));
        const g = new THREE.BufferGeometry().setFromPoints([pos, end]);
        cv.group.add(new THREE.Line(g, this.mat.codeRay));
      }
    }

    for (const step of plan.steps) {
      for (const dep of step.depends_on) {
        const a = positions.get(dep)!, b = positions.get(step.id)!;
        const g = new THREE.BufferGeometry().setFromPoints([a, b]);
        const line = new THREE.Line(g, this.mat.path);
        cv.group.add(line);
        cv.edges.push({ line, from: dep, to: step.id, a, b });
      }
    }

    // transparency frame + security orbiter at the centroid
    const centroid = [...positions.values()].reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / positions.size);
    const frame = new THREE.Mesh(this.geo.frame, this.mat.frame);
    frame.add(new THREE.LineSegments(new THREE.EdgesGeometry(this.geo.frame), this.mat.frameEdge));
    frame.position.copy(centroid).add(new THREE.Vector3(0, 26, 0));
    frame.userData.sel = { kind: 'circuit', objectiveId: obj.id } satisfies Selection;
    cv.group.add(frame);
    this.pickables.push(frame);
    cv.frame = frame;

    const orbiter = new THREE.Mesh(this.geo.orbiter, this.mat.orbiter.clone());
    cv.group.add(orbiter);
    cv.orbiter = orbiter;
    (cv as any).centroid = centroid;
  }

  private addMemoryCrystal(id: string, relevance: number, index: number): void {
    if (this.memoryCrystals.has(id)) return;
    const mesh = new THREE.Mesh(this.geo.memory, this.mat.memory.clone());
    const angle = index * 0.62, r = 240 + (index % 5) * 14;
    mesh.position.copy(ANCHORS.main).add(new THREE.Vector3(Math.cos(angle) * r, -54 + (index % 7) * 5, Math.sin(angle) * r));
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.25 + relevance * 0.65;
    mesh.userData.sel = { kind: 'memory', memoryId: id } satisfies Selection;
    this.scene.add(mesh);
    this.pickables.push(mesh);
    this.memoryCrystals.set(id, mesh);
  }

  private addConnectorGate(name: string, up: boolean, i: number, total: number): void {
    const mesh = new THREE.Mesh(this.geo.connector, up ? this.mat.connectorUp : this.mat.connectorDown);
    const phi = Math.PI / 2 - 0.35, theta = (i / Math.max(total, 1)) * Math.PI * 0.5 + 0.4;
    const r = 640;
    mesh.position.set(10 + r * Math.sin(phi) * Math.cos(theta), -10 + r * Math.cos(phi), 10 + r * Math.sin(phi) * Math.sin(theta));
    mesh.lookAt(new THREE.Vector3(10, -10, 10));
    mesh.userData.sel = { kind: 'connector', name } satisfies Selection;
    this.scene.add(mesh);
    this.pickables.push(mesh);
    this.connectorGates.set(name, mesh);
  }

  // ------------------------------------------------------------ live events
  private onEvent(e: NsEvent): void {
    if (e.type === 'engine.snapshot') { this.rebuild((e.data as any).snapshot); return; }
    const cv = e.objectiveId ? this.circuits.get(e.objectiveId) : undefined;
    const obj = e.objectiveId ? bridge.state.objectives.find(o => o.id === e.objectiveId) : undefined;

    switch (e.type) {
      case 'objective.created':
        if (obj && !this.circuits.has(obj.id)) this.buildCircuit(obj);
        break;
      case 'plan.compiled':
        if (cv && obj?.plan) this.growPlan(cv, obj);
        break;
      case 'step.ready': this.setStepStatus(cv, e.stepId, 'ready'); break;
      case 'step.started': this.setStepStatus(cv, e.stepId, 'running'); break;
      case 'worker.booted':
        if (cv && e.stepId) this.spawnPulseToward(cv, e.stepId);
        break;
      case 'model.called':
      case 'step.progress':
        if (cv && e.stepId) this.spawnPulseToward(cv, e.stepId);
        break;
      case 'validation.passed':
        this.flashEdges(cv, e.stepId, 0x27c46a);
        break;
      case 'validation.failed':
        this.flashEdges(cv, e.stepId, 0xff3b52);
        if (cv) this.reportThread(cv);
        break;
      case 'worker.rebooted':
        if (cv && e.stepId) this.blinkNode(cv, e.stepId);
        break;
      case 'step.completed': this.setStepStatus(cv, e.stepId, 'completed'); break;
      case 'step.failed': this.setStepStatus(cv, e.stepId, 'failed'); break;
      case 'security.check': if (cv) cv.securityPulse = 1; break;
      case 'security.gate.waiting': if (cv) this.addGateNode(cv, String(e.data.gateId)); break;
      case 'security.gate.approved':
      case 'security.gate.denied':
        for (const c of this.circuits.values()) {
          const g = c.gateNodes.get(String(e.data.gateId));
          if (g) { c.group.remove(g); this.unpick(g); c.gateNodes.delete(String(e.data.gateId)); }
        }
        break;
      case 'objective.completed':
        if (cv) {
          this.brighten(cv);
          if (cv.env === 'onetime') cv.dissolveAt = Date.now() + 9000;
        }
        break;
      case 'report.filed': if (cv) this.reportThread(cv); break;
      case 'memory.written':
        this.addMemoryCrystal(String(e.data.memoryId), 1, this.memoryCrystals.size);
        break;
      case 'memory.decayed': {
        const m = this.memoryCrystals.get(String(e.data.memoryId));
        if (m) { this.scene.remove(m); this.unpick(m); this.memoryCrystals.delete(String(e.data.memoryId)); }
        break;
      }
      case 'evolver.cycle.started': this.evolverBusy = true; break;
      case 'evolver.mutated': this.spawnEvolverClones(Number(e.data.candidates ?? 2)); break;
      case 'evolver.promoted': this.promotionConduit(); break;
      case 'evolver.cycle.completed': this.evolverBusy = false; this.clearEvolverClones(); break;
      case 'connector.down': {
        const g = this.connectorGates.get(String(e.data.name));
        if (g) g.material = this.mat.connectorDown;
        break;
      }
    }
  }

  private setStepStatus(cv: CircuitView | undefined, stepId: string | undefined, status: string): void {
    if (!cv || !stepId) return;
    const mesh = cv.nodeByStep.get(stepId);
    if (mesh) mesh.material = this.statusMat[status] ?? this.statusMat.pending;
  }

  private spawnPulseToward(cv: CircuitView, stepId: string): void {
    const edge = cv.edges.find(ed => ed.to === stepId) ?? cv.edges[0];
    if (!edge) return;
    if (this.pulses.length > 60) return;
    const mesh = new THREE.Mesh(this.geo.pulse, this.mat.pulse);
    this.scene.add(mesh);
    this.pulses.push({ mesh, a: edge.a, b: edge.b, t: 0, speed: 0.02 + Math.random() * 0.02 });
  }

  private flashEdges(cv: CircuitView | undefined, stepId: string | undefined, color: number): void {
    if (!cv || !stepId) return;
    for (const edge of cv.edges.filter(ed => ed.to === stepId)) {
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 });
      const orig = edge.line.material;
      edge.line.material = mat;
      this.transients.push({
        obj: edge.line, bornAt: Date.now(), ttlMs: 1100,
        update: (k) => { mat.opacity = 1 - k; if (k >= 1) edge.line.material = orig; },
      });
    }
  }

  private blinkNode(cv: CircuitView, stepId: string): void {
    const mesh = cv.nodeByStep.get(stepId);
    if (!mesh) return;
    const born = Date.now();
    this.transients.push({
      obj: mesh, bornAt: born, ttlMs: 1400,
      update: (k) => { mesh.visible = k > 0.99 ? true : Math.sin(k * 28) > -0.2; },
    });
  }

  private addGateNode(cv: CircuitView, gateId: string): void {
    const centroid: THREE.Vector3 = (cv as any).centroid ?? cv.anchor;
    const mesh = new THREE.Mesh(this.geo.gate, this.mat.gate.clone());
    mesh.position.copy(centroid).add(new THREE.Vector3(0, 44, 0));
    mesh.userData.sel = { kind: 'gate', gateId } satisfies Selection;
    mesh.userData.pulseGate = true;
    cv.group.add(mesh);
    this.pickables.push(mesh);
    cv.gateNodes.set(gateId, mesh);
  }

  /** Red thread: transparency → the evolver block. Failure becomes fuel. */
  private reportThread(cv: CircuitView): void {
    const from: THREE.Vector3 = ((cv as any).centroid ?? cv.anchor).clone();
    const to = this.evolvers.get('main')!.position.clone();
    const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, -30, 0));
    const pts = new THREE.QuadraticBezierCurve3(from, mid, to).getPoints(30);
    const mat = this.mat.report.clone();
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    this.scene.add(line);
    this.transients.push({
      obj: line, bornAt: Date.now(), ttlMs: 4200,
      update: (k) => { mat.opacity = 0.55 * (1 - k); if (k >= 1) this.scene.remove(line); },
    });
  }

  private spawnEvolverClones(n: number): void {
    this.clearEvolverClones();
    const host = this.evolvers.get('testing')!;
    for (let i = 0; i < Math.min(n, 5); i++) {
      const clone = new THREE.Mesh(new THREE.IcosahedronGeometry(4.5, 0), this.mat.evolverFill);
      clone.add(new THREE.LineSegments(new THREE.EdgesGeometry(clone.geometry as THREE.IcosahedronGeometry), this.mat.evolverEdge));
      clone.userData.orbit = { host, phase: (i / n) * Math.PI * 2, r: 30 + i * 4 };
      this.scene.add(clone);
      this.evolverClones.push(clone);
    }
  }

  private clearEvolverClones(): void {
    for (const c of this.evolverClones) this.scene.remove(c);
    this.evolverClones = [];
  }

  /** Green conduit pulse: a proven structure ships from Testing to Main. */
  private promotionConduit(): void {
    const from = this.evolvers.get('testing')!.position.clone();
    const to = this.evolvers.get('main')!.position.clone();
    const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 70, 0));
    const pts = new THREE.QuadraticBezierCurve3(from, mid, to).getPoints(50);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: C.evolver, transparent: true, opacity: 0.8 }),
    );
    this.scene.add(line);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(2.4, 10, 10), new THREE.MeshBasicMaterial({ color: 0x55ff88 }));
    this.scene.add(ball);
    this.transients.push({
      obj: line, bornAt: Date.now(), ttlMs: 5000,
      update: (k) => {
        ball.position.copy(pts[Math.min(pts.length - 1, Math.floor(k * pts.length))]);
        (line.material as THREE.LineBasicMaterial).opacity = 0.8 * (1 - k);
        if (k >= 1) { this.scene.remove(line); this.scene.remove(ball); }
      },
    });
  }

  private brighten(cv: CircuitView): void {
    for (const mesh of cv.nodeByStep.values()) {
      const born = Date.now();
      this.transients.push({
        obj: mesh, bornAt: born, ttlMs: 1600,
        update: (k) => mesh.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.5),
      });
    }
  }

  private unpick(o: THREE.Object3D): void {
    this.pickables = this.pickables.filter(p => p !== o);
  }

  // ------------------------------------------------------------------ input
  flyToEnv(env: EnvName): void {
    this.ctrl.flyFrom = this.ctrl.target.clone();
    this.ctrl.flyTo = ANCHORS[env].clone();
    this.ctrl.flyT = 0;
    this.ctrl.rFrom = this.ctrl.sph.radius;
    this.ctrl.rTo = env === 'main' ? 330 : 240;
  }

  focusObjective(id: string): void {
    const cv = this.circuits.get(id);
    if (!cv) return;
    this.ctrl.flyFrom = this.ctrl.target.clone();
    this.ctrl.flyTo = ((cv as any).centroid ?? cv.anchor).clone();
    this.ctrl.flyT = 0;
    this.ctrl.rFrom = this.ctrl.sph.radius;
    this.ctrl.rTo = 140;
  }

  private applyCamera(): void {
    const offset = new THREE.Vector3().setFromSpherical(this.ctrl.sph);
    this.camera.position.copy(this.ctrl.target).add(offset);
    this.camera.lookAt(this.ctrl.target);
  }

  private on<K extends keyof HTMLElementEventMap>(t: EventTarget, n: string, f: any, o?: any): void {
    t.addEventListener(n, f, o);
    this.listeners.push([t, n, f, o]);
  }

  private bindInput(): void {
    const el = this.renderer.domElement;
    const c = this.ctrl;
    this.on(el, 'mousedown', (e: MouseEvent) => { c.dragging = true; c.moved = 0; c.lastX = e.clientX; c.lastY = e.clientY; });
    this.on(window, 'mousemove', (e: MouseEvent) => {
      if (!c.dragging) return;
      const dx = e.clientX - c.lastX, dy = e.clientY - c.lastY;
      c.moved += Math.abs(dx) + Math.abs(dy);
      c.lastX = e.clientX; c.lastY = e.clientY;
      c.sph.theta -= dx * 0.005;
      c.sph.phi = Math.max(0.15, Math.min(Math.PI - 0.15, c.sph.phi - dy * 0.005));
      this.applyCamera();
    });
    this.on(window, 'mouseup', (e: MouseEvent) => {
      const wasDrag = c.moved > 6;
      c.dragging = false;
      if (wasDrag) return;
      this.pick(e.clientX, e.clientY);
    });
    this.on(el, 'wheel', (e: WheelEvent) => {
      e.preventDefault();
      c.sph.radius = Math.max(40, Math.min(1600, c.sph.radius * (1 + e.deltaY * 0.001)));
      this.applyCamera();
    }, { passive: false });
    this.on(window, 'resize', () => {
      this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    });
    // touch
    this.on(el, 'touchstart', (e: TouchEvent) => {
      if (e.touches.length === 1) { c.dragging = true; c.moved = 0; c.lastX = e.touches[0].clientX; c.lastY = e.touches[0].clientY; }
      else if (e.touches.length === 2) c.pinch = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }, { passive: true });
    this.on(el, 'touchmove', (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && c.dragging) {
        const dx = e.touches[0].clientX - c.lastX, dy = e.touches[0].clientY - c.lastY;
        c.moved += Math.abs(dx) + Math.abs(dy);
        c.lastX = e.touches[0].clientX; c.lastY = e.touches[0].clientY;
        c.sph.theta -= dx * 0.006;
        c.sph.phi = Math.max(0.15, Math.min(Math.PI - 0.15, c.sph.phi - dy * 0.006));
        this.applyCamera();
      } else if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (c.pinch > 0) { c.sph.radius = Math.max(40, Math.min(1600, c.sph.radius * (c.pinch / d))); this.applyCamera(); }
        c.pinch = d;
      }
    }, { passive: false });
    this.on(el, 'touchend', (e: TouchEvent) => {
      if (c.moved <= 6 && e.changedTouches.length === 1 && c.dragging) {
        this.pick(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      }
      c.dragging = false; c.pinch = 0;
    });
  }

  private pick(x: number, y: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    const hits = ray.intersectObjects(this.pickables, false);
    if (hits.length) {
      this.selectedMesh = hits[0].object;
      bridge.select(hits[0].object.userData.sel as Selection);
    } else {
      this.selectedMesh = null;
      bridge.select(null);
    }
  }

  // -------------------------------------------------------------- animation
  private animate = (): void => {
    this.raf = requestAnimationFrame(this.animate);
    const t = this.clock.getElapsedTime();
    const c = this.ctrl;

    if (c.flyT < 1 && c.flyFrom && c.flyTo) {
      c.flyT = Math.min(1, c.flyT + 0.025);
      const k = 1 - Math.pow(1 - c.flyT, 3);
      c.target.copy(c.flyFrom).lerp(c.flyTo, k);
      c.sph.radius = c.rFrom + (c.rTo - c.rFrom) * k;
      this.applyCamera();
    }

    const frozen = bridge.state.frozen;
    const now = Date.now();

    for (const cv of this.circuits.values()) {
      const paused = frozen || bridge.state.objectives.find(o => o.id === cv.id)?.status === 'paused';
      if (!paused) {
        for (const mesh of cv.nodeByStep.values()) {
          mesh.position.y = mesh.userData.baseY + Math.sin(t * 0.7 + mesh.userData.phase) * 0.7;
          if (mesh.material === this.statusMat.running) {
            mesh.scale.setScalar(1 + Math.sin(t * 6) * 0.18);
          } else if (mesh.scale.x !== 1 && !this.transients.some(tr => tr.obj === mesh)) {
            mesh.scale.setScalar(1);
          }
        }
        if (cv.frame) cv.frame.rotation.y += 0.003;
        if (cv.orbiter) {
          cv.orbitPhase += 0.012;
          const centroid: THREE.Vector3 = (cv as any).centroid ?? cv.anchor;
          cv.orbiter.position.copy(centroid).add(new THREE.Vector3(Math.cos(cv.orbitPhase) * 30, Math.sin(cv.orbitPhase * 0.7) * 10, Math.sin(cv.orbitPhase) * 30));
          cv.orbiter.rotation.y += 0.02;
          const m = cv.orbiter.material as THREE.MeshBasicMaterial;
          cv.securityPulse = Math.max(0, cv.securityPulse - 0.02);
          m.opacity = 0.35 + cv.securityPulse * 0.6;
        }
        if (cv.seed) cv.seed.scale.setScalar(1 + Math.sin(t * 3.2) * 0.25);
        for (const g of cv.gateNodes.values()) {
          g.rotation.y += 0.04;
          (g.material as THREE.MeshBasicMaterial).color.setHSL(0.11, 0.75, 0.45 + Math.sin(t * 5) * 0.18);
        }
      }
      if (cv.dissolveAt && now > cv.dissolveAt) {
        const k = Math.min(1, (now - cv.dissolveAt) / 4000);
        cv.group.traverse(o => {
          const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
          if (mat && 'opacity' in mat) { mat.transparent = true; (mat as any).opacity = Math.max(0.02, 1 - k); }
        });
        if (k >= 1) {
          this.scene.remove(cv.group);
          cv.nodeByStep.forEach(m => this.unpick(m));
          if (cv.frame) this.unpick(cv.frame);
          this.circuits.delete(cv.id);
        }
      }
    }

    for (const [key, ev] of this.evolvers) {
      const speed = this.evolverBusy ? 0.02 : 0.0024;
      ev.rotation.y += speed;
      ev.rotation.x += speed * 0.4;
      ev.scale.setScalar(1 + Math.sin(t * (this.evolverBusy ? 2.2 : 0.5) + (key === 'main' ? 0 : 1.7)) * 0.04);
    }
    for (const clone of this.evolverClones) {
      const o = clone.userData.orbit;
      o.phase += 0.03;
      clone.position.copy(o.host.position).add(new THREE.Vector3(Math.cos(o.phase) * o.r, Math.sin(o.phase * 1.3) * 8, Math.sin(o.phase) * o.r));
      clone.rotation.y += 0.05;
    }

    this.pulses = this.pulses.filter(p => {
      p.t += p.speed;
      if (p.t >= 1) { this.scene.remove(p.mesh); return false; }
      p.mesh.position.lerpVectors(p.a, p.b, p.t);
      return true;
    });

    this.transients = this.transients.filter(tr => {
      const k = Math.min(1, (now - tr.bornAt) / tr.ttlMs);
      tr.update?.(k);
      return k < 1;
    });

    // selection ring follows the selected object
    if (this.selectedMesh && bridge.state.selected) {
      this.selRing.visible = true;
      this.selRing.position.copy((this.selectedMesh as THREE.Mesh).getWorldPosition(new THREE.Vector3()));
      this.selRing.lookAt(this.camera.position);
      this.selRing.rotation.z += t * 0.0001;
    } else {
      this.selRing.visible = false;
    }

    this.renderer.render(this.scene, this.camera);
  };
}

function mulberry(a: number) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const worldScene = new WorldScene();
