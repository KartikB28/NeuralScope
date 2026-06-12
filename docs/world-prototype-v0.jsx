import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';

// ============================================================
// NEURALSCOPE — living cognitive environment, 3D prototype
// Main / Testing / One-Time territories. Circuits = cognition.
// Red spheres = LLM workers · Green slabs = skills
// Turquoise frames = transparency blocks · White wire spheres = security cycles
// Blue rays = code structure · Red threads = failure reports → Evolver Blocks
// ============================================================

// ---------- seeded rng ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLORS = {
  bg: 0x03070c,
  path: 0xe8f4ff,
  codeRay: 0x1494e8,
  llm: 0xff2742,
  skill: 0x8be32a,
  transparency: 0x16a6e0,
  security: 0xf2f8ff,
  evolver: 0x1db954,
  report: 0xb03030,
  pulse: 0x9fe8ff,
};

const NODE_INFO = {
  llm: {
    label: 'Worker model',
    actions: ['Executing step 4 of 11', 'Decomposing objective', 'Synthesizing partial output', 'Awaiting context handoff', 'Coordinating two sub-workers'],
    detail: 'Small parameter model booted for this circuit. Disposable. The structure around it carries the intelligence.',
  },
  skill: {
    label: 'Skill module',
    actions: ['Injecting research heuristics', 'Loading coding conventions', 'Applying security review patterns', 'Attaching planning scaffold', 'Specializing reasoning style'],
    detail: 'A capability file physically attached to the circuit. Changes how the worker behaves from this node onward.',
  },
  transparency: {
    label: 'Transparency block',
    actions: ['Auditing reasoning trace', 'Reading worker internals', 'Writing improvement report', 'Flagging weak pathway', 'Verifying claim chain'],
    detail: 'Continuously reads every process — including inside model behavior — and files reports to the Evolver Blocks.',
  },
  security: {
    label: 'Security cycle',
    actions: ['Scanning for drift', 'Verifying objective lock', 'Reboot checkpoint armed', 'Checking output integrity', 'Watching for contradiction'],
    detail: 'Orbiting check that regains focus and re-grounds the objective. If the circuit drifts, this is where it gets caught and rebooted.',
  },
  evolver: {
    label: 'Evolver Block',
    actions: ['Decomposing failure report', 'Rebuilding broken pathway', 'Running clone trial 7', 'Approving evolved structure', 'Deploying update to main'],
    detail: 'The architect. Captures failures, breaks them apart, builds alternatives, tests clones in the Testing territory, and deploys approved structures back into the live cluster. This is what makes the system self-evolving.',
  },
};

// ---------- circuit generation ----------
function generateCircuit(rng, origin, scale, env) {
  const nodes = [];
  const links = []; // pairs of node indices along main path
  const steps = 8 + Math.floor(rng() * 8);
  let p = origin.clone();
  let dir = new THREE.Vector3(rng() - 0.5, (rng() - 0.5) * 0.6, rng() - 0.5).normalize();

  const typeFor = (i) => {
    const r = rng();
    if (i % 5 === 2) return 'security';
    if (r < 0.18) return 'llm';
    if (r < 0.45) return 'skill';
    if (r < 0.75) return 'transparency';
    return 'skill';
  };

  for (let i = 0; i < steps; i++) {
    const t = typeFor(i);
    nodes.push({ type: i === 0 ? 'llm' : t, pos: p.clone() });
    if (i > 0) links.push([i - 1, i]);
    // wander
    dir.add(new THREE.Vector3((rng() - 0.5) * 0.9, (rng() - 0.5) * 0.7, (rng() - 0.5) * 0.9)).normalize();
    p = p.clone().addScaledVector(dir, (6 + rng() * 9) * scale);
  }
  // a short branch
  if (steps > 9) {
    const from = 3 + Math.floor(rng() * (steps - 6));
    let bp = nodes[from].pos.clone();
    let bd = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
    const blen = 2 + Math.floor(rng() * 3);
    let prev = from;
    for (let j = 0; j < blen; j++) {
      bp = bp.clone().addScaledVector(bd, (5 + rng() * 7) * scale);
      bd.add(new THREE.Vector3((rng() - 0.5), (rng() - 0.5) * 0.5, (rng() - 0.5))).normalize();
      nodes.push({ type: j === blen - 1 ? 'llm' : 'skill', pos: bp.clone() });
      links.push([prev, nodes.length - 1]);
      prev = nodes.length - 1;
    }
  }
  return { nodes, links, env };
}

// ---------- main component ----------
export default function NeuralScope() {
  const mountRef = useRef(null);
  const apiRef = useRef({});
  const [selected, setSelected] = useState(null);
  const [environment, setEnvironment] = useState('main');
  const [pausedCircuits, setPausedCircuits] = useState({});
  const [stats, setStats] = useState({ circuits: 0, processes: 0, cycles: 0, evolved: 0, contained: 0 });

  // stats ticker — the world never sleeps
  useEffect(() => {
    const id = setInterval(() => {
      setStats((s) => ({
        ...s,
        cycles: s.cycles + 1 + Math.floor(Math.random() * 3),
        evolved: s.evolved + (Math.random() < 0.18 ? 1 : 0),
        contained: s.contained + (Math.random() < 0.12 ? 1 : 0),
      }));
    }, 1400);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const rng = mulberry32(1337);

    // ----- renderer / scene / camera -----
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.bg);
    scene.fog = new THREE.FogExp2(COLORS.bg, 0.0016);

    const camera = new THREE.PerspectiveCamera(55, mount.clientWidth / mount.clientHeight, 0.1, 4000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const amb = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(amb);
    const key = new THREE.PointLight(0x66ccff, 0.9, 0, 2);
    key.position.set(120, 200, 160);
    scene.add(key);

    // ----- starfield -----
    {
      const starGeo = new THREE.BufferGeometry();
      const N = 1600;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const r = 900 + rng() * 1400;
        const th = rng() * Math.PI * 2;
        const ph = Math.acos(2 * rng() - 1);
        pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
        pos[i * 3 + 1] = r * Math.cos(ph);
        pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      }
      starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x4a6a88, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0.8 }));
      scene.add(stars);
    }

    // ----- territory anchors -----
    const ANCHORS = {
      main: new THREE.Vector3(0, 0, 0),
      testing: new THREE.Vector3(360, 10, -120),
      onetime: new THREE.Vector3(-330, -20, 140),
    };

    // faint territory boundary rings
    const ringFor = (center, radius, color, op) => {
      const g = new THREE.RingGeometry(radius - 1.2, radius, 96);
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.copy(center).add(new THREE.Vector3(0, -70, 0));
      scene.add(mesh);
    };
    ringFor(ANCHORS.main, 200, 0x1e6e9e, 0.22);
    ringFor(ANCHORS.testing, 130, 0x1db954, 0.2);
    ringFor(ANCHORS.onetime, 90, 0xc8a23a, 0.2);

    // ----- shared geometries / materials -----
    const geo = {
      llm: new THREE.SphereGeometry(2.1, 18, 18),
      skill: new THREE.BoxGeometry(6.5, 2.4, 3.4),
      transparency: new THREE.BoxGeometry(5.2, 5.2, 5.2),
      security: new THREE.SphereGeometry(4.4, 14, 14),
      pulse: new THREE.SphereGeometry(1.1, 8, 8),
    };
    const mat = {
      llm: new THREE.MeshBasicMaterial({ color: COLORS.llm }),
      skill: new THREE.MeshStandardMaterial({ color: COLORS.skill, emissive: COLORS.skill, emissiveIntensity: 0.35, roughness: 0.5 }),
      transparencyFill: new THREE.MeshBasicMaterial({ color: COLORS.transparency, transparent: true, opacity: 0.1 }),
      transparencyEdge: new THREE.LineBasicMaterial({ color: COLORS.transparency, transparent: true, opacity: 0.95 }),
      security: new THREE.MeshBasicMaterial({ color: COLORS.security, wireframe: true, transparent: true, opacity: 0.55 }),
      path: new THREE.LineBasicMaterial({ color: COLORS.path, transparent: true, opacity: 0.85 }),
      codeRay: new THREE.LineBasicMaterial({ color: COLORS.codeRay, transparent: true, opacity: 0.8 }),
      report: new THREE.LineBasicMaterial({ color: COLORS.report, transparent: true, opacity: 0.45 }),
      pulse: new THREE.MeshBasicMaterial({ color: COLORS.pulse }),
      evolverEdge: new THREE.LineBasicMaterial({ color: COLORS.evolver, transparent: true, opacity: 0.95 }),
      evolverFill: new THREE.MeshStandardMaterial({ color: COLORS.evolver, emissive: COLORS.evolver, emissiveIntensity: 0.18, transparent: true, opacity: 0.16, roughness: 0.4 }),
    };

    const pickables = [];
    const circuits = [];
    const pulses = [];
    const evolvers = [];
    let nodeCount = 0;

    const transparencyEdgesGeo = new THREE.EdgesGeometry(geo.transparency);

    // ----- build one node mesh -----
    function buildNodeMesh(node, circuitId, idx) {
      let mesh;
      if (node.type === 'llm') {
        mesh = new THREE.Mesh(geo.llm, mat.llm.clone());
      } else if (node.type === 'skill') {
        mesh = new THREE.Mesh(geo.skill, mat.skill.clone());
        mesh.rotation.set(rng() * 0.6 - 0.3, rng() * Math.PI, rng() * 0.5 - 0.25);
      } else if (node.type === 'transparency') {
        mesh = new THREE.Mesh(geo.transparency, mat.transparencyFill.clone());
        const edges = new THREE.LineSegments(transparencyEdgesGeo, mat.transparencyEdge);
        mesh.add(edges);
        mesh.rotation.set(rng() * 0.4, rng() * Math.PI, rng() * 0.4);
      } else {
        mesh = new THREE.Mesh(geo.security, mat.security.clone());
      }
      mesh.position.copy(node.pos);
      const info = NODE_INFO[node.type];
      mesh.userData = {
        kind: node.type,
        circuitId,
        id: `${circuitId}-N${idx}`,
        label: info.label,
        action: info.actions[Math.floor(rng() * info.actions.length)],
        detail: info.detail,
        confidence: Math.round(58 + rng() * 41),
        deps: Math.floor(1 + rng() * 4),
        state: rng() < 0.85 ? 'stable' : 'under review',
        baseY: node.pos.y,
        phase: rng() * Math.PI * 2,
      };
      pickables.push(mesh);
      nodeCount++;
      return mesh;
    }

    // ----- build a circuit into the scene -----
    function addCircuit(origin, scale, env, idTag) {
      const data = generateCircuit(rng, origin, scale, env);
      const group = new THREE.Group();
      const meshes = data.nodes.map((n, i) => buildNodeMesh(n, idTag, i));
      meshes.forEach((m) => group.add(m));

      // main path lines + pulse routes
      const routes = [];
      data.links.forEach(([a, b]) => {
        const pa = data.nodes[a].pos, pb = data.nodes[b].pos;
        const g = new THREE.BufferGeometry().setFromPoints([pa, pb]);
        group.add(new THREE.Line(g, mat.path));
        routes.push([pa.clone(), pb.clone()]);
      });

      // blue code-structure rays from LLM + transparency nodes
      data.nodes.forEach((n) => {
        if (n.type !== 'llm' && !(n.type === 'transparency' && rng() < 0.5)) return;
        const rays = 2 + Math.floor(rng() * 3);
        for (let r = 0; r < rays; r++) {
          const end = n.pos.clone().add(new THREE.Vector3((rng() - 0.5) * 60, (rng() - 0.5) * 50, (rng() - 0.5) * 60));
          const g = new THREE.BufferGeometry().setFromPoints([n.pos, end]);
          group.add(new THREE.Line(g, mat.codeRay));
          // tiny skill chip at some ray ends
          if (rng() < 0.5) {
            const chip = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.6, 2.2), mat.skill);
            chip.position.copy(end);
            chip.rotation.y = rng() * Math.PI;
            group.add(chip);
          }
        }
      });

      scene.add(group);
      const circuit = { id: idTag, group, meshes, routes, env, paused: false };
      circuits.push(circuit);

      // spawn pulses along this circuit
      const pulseN = Math.max(1, Math.floor(routes.length / 4));
      for (let i = 0; i < pulseN; i++) {
        const m = new THREE.Mesh(geo.pulse, mat.pulse);
        scene.add(m);
        pulses.push({ mesh: m, circuit, seg: Math.floor(rng() * routes.length), t: rng(), speed: 0.004 + rng() * 0.008 });
      }
      return circuit;
    }

    // ----- evolver blocks -----
    function addEvolver(pos, size, idTag) {
      const g = new THREE.IcosahedronGeometry(size, 0);
      const fill = new THREE.Mesh(g, mat.evolverFill);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), mat.evolverEdge);
      fill.add(edges);
      fill.position.copy(pos);
      const info = NODE_INFO.evolver;
      fill.userData = {
        kind: 'evolver', circuitId: idTag, id: idTag,
        label: info.label,
        action: info.actions[Math.floor(rng() * info.actions.length)],
        detail: info.detail,
        confidence: Math.round(88 + rng() * 11),
        deps: 6 + Math.floor(rng() * 9),
        state: 'evolving',
        baseY: pos.y, phase: rng() * Math.PI * 2,
      };
      scene.add(fill);
      pickables.push(fill);
      evolvers.push(fill);
      return fill;
    }

    // ----- populate MAIN: a cluster of circuits -----
    const mainCircuits = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const o = ANCHORS.main.clone().add(new THREE.Vector3(Math.cos(a) * (40 + rng() * 70), (rng() - 0.5) * 70, Math.sin(a) * (40 + rng() * 70)));
      mainCircuits.push(addCircuit(o, 1, 'main', `MAIN-C${i + 1}`));
    }
    const mainEvolvers = [
      addEvolver(ANCHORS.main.clone().add(new THREE.Vector3(-90, -60, 60)), 16, 'EVOLVER-A'),
      addEvolver(ANCHORS.main.clone().add(new THREE.Vector3(60, -75, -80)), 22, 'EVOLVER-B'),
      addEvolver(ANCHORS.main.clone().add(new THREE.Vector3(130, -50, 90)), 12, 'EVOLVER-C'),
    ];

    // red report threads: transparency nodes -> nearest evolver (curved)
    function addReportThread(from, to) {
      const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, -28 - rng() * 25, 0));
      const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
      const pts = curve.getPoints(28);
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      scene.add(new THREE.Line(g, mat.report));
      return pts;
    }
    const reportRoutes = [];
    circuits.forEach((c) => {
      c.meshes.forEach((m) => {
        if (m.userData.kind === 'transparency' && rng() < 0.45) {
          let nearest = mainEvolvers[0];
          let d = Infinity;
          mainEvolvers.forEach((e) => { const dd = e.position.distanceTo(m.position); if (dd < d) { d = dd; nearest = e; } });
          reportRoutes.push({ pts: addReportThread(m.position.clone(), nearest.position.clone()), t: rng(), speed: 0.002 + rng() * 0.003 });
        }
      });
    });
    // report pulses (small red)
    const reportPulseMat = new THREE.MeshBasicMaterial({ color: 0xff5544 });
    const reportPulses = reportRoutes.map((r) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.8, 6, 6), reportPulseMat);
      scene.add(m);
      return { ...r, mesh: m };
    });

    // ----- populate TESTING: cloned circuits + evolvers + links to main -----
    for (let i = 0; i < 3; i++) {
      const o = ANCHORS.testing.clone().add(new THREE.Vector3((rng() - 0.5) * 90, (rng() - 0.5) * 50, (rng() - 0.5) * 90));
      addCircuit(o, 0.8, 'testing', `TEST-CLONE-${i + 1}`);
    }
    const testEvolvers = [
      addEvolver(ANCHORS.testing.clone().add(new THREE.Vector3(-40, -45, 30)), 18, 'EVOLVER-T1'),
      addEvolver(ANCHORS.testing.clone().add(new THREE.Vector3(55, -55, -25)), 13, 'EVOLVER-T2'),
    ];
    // green approval conduits: testing evolvers -> main cluster
    testEvolvers.forEach((e) => {
      const target = ANCHORS.main.clone().add(new THREE.Vector3((rng() - 0.5) * 80, (rng() - 0.5) * 40, (rng() - 0.5) * 80));
      const mid = e.position.clone().lerp(target, 0.5).add(new THREE.Vector3(0, 60 + rng() * 40, 0));
      const pts = new THREE.QuadraticBezierCurve3(e.position.clone(), mid, target).getPoints(40);
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: COLORS.evolver, transparent: true, opacity: 0.35 })));
      reportPulses.push({ pts, t: rng(), speed: 0.0015 + rng() * 0.002, mesh: (() => { const m = new THREE.Mesh(new THREE.SphereGeometry(1.1, 6, 6), new THREE.MeshBasicMaterial({ color: 0x55ff88 })); scene.add(m); return m; })() });
    });

    // ----- populate ONE-TIME: a single compact circuit that dissolves & rebuilds -----
    const onetimeCircuit = addCircuit(ANCHORS.onetime.clone(), 0.7, 'onetime', 'ONETIME-J1');

    // ----- custom orbit controls (r128: no OrbitControls) -----
    const ctrl = {
      target: ANCHORS.main.clone(),
      sph: new THREE.Spherical(320, Math.PI / 2.5, Math.PI / 4),
      dragging: false, lastX: 0, lastY: 0, moved: 0,
      pinchDist: 0,
      // fly animation
      flyFrom: null, flyTo: null, flyT: 1,
    };
    function applyCamera() {
      const offset = new THREE.Vector3().setFromSpherical(ctrl.sph);
      camera.position.copy(ctrl.target).add(offset);
      camera.lookAt(ctrl.target);
    }
    applyCamera();

    function flyTo(envKey) {
      ctrl.flyFrom = ctrl.target.clone();
      ctrl.flyTo = ANCHORS[envKey].clone();
      ctrl.flyT = 0;
      ctrl.sphFrom = ctrl.sph.radius;
      ctrl.sphTo = envKey === 'main' ? 320 : 230;
    }
    apiRef.current.flyTo = flyTo;
    apiRef.current.setCircuitPaused = (id, val) => {
      const c = circuits.find((x) => x.id === id);
      if (c) c.paused = val;
    };

    // ----- pointer handlers -----
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function onDown(e) { ctrl.dragging = true; ctrl.moved = 0; ctrl.lastX = e.clientX; ctrl.lastY = e.clientY; }
    function onMove(e) {
      if (!ctrl.dragging) return;
      const dx = e.clientX - ctrl.lastX, dy = e.clientY - ctrl.lastY;
      ctrl.moved += Math.abs(dx) + Math.abs(dy);
      ctrl.lastX = e.clientX; ctrl.lastY = e.clientY;
      ctrl.sph.theta -= dx * 0.005;
      ctrl.sph.phi = Math.max(0.15, Math.min(Math.PI - 0.15, ctrl.sph.phi - dy * 0.005));
      applyCamera();
    }
    function onUp(e) {
      const wasDrag = ctrl.moved > 6;
      ctrl.dragging = false;
      if (wasDrag) return;
      // click → pick
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickables, false);
      if (hits.length) {
        const u = hits[0].object.userData;
        setSelected({ ...u });
      } else {
        setSelected(null);
      }
    }
    function onWheel(e) {
      e.preventDefault();
      ctrl.sph.radius = Math.max(40, Math.min(1200, ctrl.sph.radius * (1 + e.deltaY * 0.001)));
      applyCamera();
    }
    function onTouchStart(e) {
      if (e.touches.length === 1) { ctrl.dragging = true; ctrl.moved = 0; ctrl.lastX = e.touches[0].clientX; ctrl.lastY = e.touches[0].clientY; }
      else if (e.touches.length === 2) {
        ctrl.pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      }
    }
    function onTouchMove(e) {
      e.preventDefault();
      if (e.touches.length === 1 && ctrl.dragging) {
        const dx = e.touches[0].clientX - ctrl.lastX, dy = e.touches[0].clientY - ctrl.lastY;
        ctrl.moved += Math.abs(dx) + Math.abs(dy);
        ctrl.lastX = e.touches[0].clientX; ctrl.lastY = e.touches[0].clientY;
        ctrl.sph.theta -= dx * 0.006;
        ctrl.sph.phi = Math.max(0.15, Math.min(Math.PI - 0.15, ctrl.sph.phi - dy * 0.006));
        applyCamera();
      } else if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (ctrl.pinchDist > 0) {
          ctrl.sph.radius = Math.max(40, Math.min(1200, ctrl.sph.radius * (ctrl.pinchDist / d)));
          applyCamera();
        }
        ctrl.pinchDist = d;
      }
    }
    function onTouchEnd(e) {
      if (ctrl.moved <= 6 && e.changedTouches.length === 1 && ctrl.dragging) {
        const t = e.changedTouches[0];
        onUp({ clientX: t.clientX, clientY: t.clientY });
      }
      ctrl.dragging = false; ctrl.pinchDist = 0;
    }

    const el = renderer.domElement;
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);

    function onResize() {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    }
    window.addEventListener('resize', onResize);

    // ----- animation loop -----
    let raf;
    const clock = new THREE.Clock();
    let onetimePhase = 0;

    function animate() {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      // fly interpolation
      if (ctrl.flyT < 1) {
        ctrl.flyT = Math.min(1, ctrl.flyT + 0.025);
        const k = 1 - Math.pow(1 - ctrl.flyT, 3);
        ctrl.target.copy(ctrl.flyFrom).lerp(ctrl.flyTo, k);
        ctrl.sph.radius = ctrl.sphFrom + (ctrl.sphTo - ctrl.sphFrom) * k;
        applyCamera();
      }

      // slow world breathing: nodes bob, security spheres rotate
      circuits.forEach((c) => {
        if (c.paused) return;
        c.meshes.forEach((m) => {
          m.position.y = m.userData.baseY + Math.sin(t * 0.6 + m.userData.phase) * 0.8;
          if (m.userData.kind === 'security') { m.rotation.y += 0.01; m.rotation.x += 0.004; }
          if (m.userData.kind === 'transparency') m.rotation.y += 0.0015;
        });
      });

      // evolvers: slow, heavy, deliberate
      evolvers.forEach((e, i) => {
        e.rotation.y += 0.0022 + i * 0.0004;
        e.rotation.x += 0.0009;
        const s = 1 + Math.sin(t * 0.5 + i * 1.7) * 0.03;
        e.scale.setScalar(s);
      });

      // pulses along circuit paths
      pulses.forEach((p) => {
        if (p.circuit.paused) return;
        p.t += p.speed;
        if (p.t >= 1) { p.t = 0; p.seg = (p.seg + 1) % p.circuit.routes.length; }
        const [a, b] = p.circuit.routes[p.seg];
        p.mesh.position.lerpVectors(a, b, p.t);
      });

      // report pulses along curves
      reportPulses.forEach((p) => {
        p.t += p.speed;
        if (p.t >= 1) p.t = 0;
        const idx = Math.min(p.pts.length - 1, Math.floor(p.t * (p.pts.length - 1)));
        p.mesh.position.copy(p.pts[idx]);
      });

      // one-time territory: create → deliver → destroy → rebuild
      onetimePhase = (t % 24) / 24;
      const fade = onetimePhase > 0.8 ? 1 - (onetimePhase - 0.8) / 0.2 : Math.min(1, onetimePhase / 0.15);
      onetimeCircuit.group.traverse((o) => {
        if (o.material) { o.material.transparent = true; o.material.opacity = Math.max(0.04, ('opacity' in o.material ? 1 : 1) * fade * (o.material.userData?.baseOp ?? 0.9)); }
      });

      renderer.render(scene, camera);
    }
    animate();

    // initial stats
    setStats((s) => ({ ...s, circuits: circuits.length, processes: nodeCount }));

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  const switchEnv = (env) => {
    setEnvironment(env);
    setSelected(null);
    apiRef.current.flyTo && apiRef.current.flyTo(env);
  };

  const togglePause = () => {
    if (!selected) return;
    const id = selected.circuitId;
    const next = !pausedCircuits[id];
    setPausedCircuits((p) => ({ ...p, [id]: next }));
    apiRef.current.setCircuitPaused && apiRef.current.setCircuitPaused(id, next);
  };

  const envMeta = {
    main: { name: 'MAIN', desc: 'Permanent world · accumulated capability · always evolving', color: '#3ab6f0' },
    testing: { name: 'TESTING', desc: 'Clones compete · structures mutate · only the proven survive', color: '#1db954' },
    onetime: { name: 'ONE-TIME', desc: 'Create · deliver · destroy · nothing remains', color: '#c8a23a' },
  };

  const mono = { fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace" };

  return (
    <div className="relative w-full bg-black overflow-hidden select-none" style={{ height: '100vh', minHeight: 560 }}>
      <div ref={mountRef} className="absolute inset-0" style={{ cursor: 'grab' }} />

      {/* ---- top bar ---- */}
      <div className="absolute top-0 left-0 right-0 flex items-start justify-between p-4 pointer-events-none">
        <div style={mono}>
          <div className="text-white text-lg tracking-widest font-bold">NEURALSCOPE</div>
          <div className="text-xs" style={{ color: '#5a7d96' }}>living cognitive environment · v0 prototype</div>
        </div>
        <div className="flex gap-2 pointer-events-auto" style={mono}>
          {Object.keys(envMeta).map((k) => (
            <button
              key={k}
              onClick={() => switchEnv(k)}
              className="px-3 py-1.5 text-xs tracking-wider border rounded-sm transition-colors"
              style={{
                borderColor: environment === k ? envMeta[k].color : '#27435a',
                color: environment === k ? envMeta[k].color : '#6a8aa0',
                background: environment === k ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.45)',
              }}
            >
              {envMeta[k].name}
            </button>
          ))}
        </div>
      </div>

      {/* ---- environment strip ---- */}
      <div className="absolute top-16 left-4 pointer-events-none" style={mono}>
        <div className="text-xs" style={{ color: envMeta[environment].color }}>
          ◉ {envMeta[environment].name} ENVIRONMENT
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: '#48677e' }}>{envMeta[environment].desc}</div>
      </div>

      {/* ---- live stats ---- */}
      <div className="absolute bottom-4 left-4 pointer-events-none text-[11px] leading-relaxed" style={{ ...mono, color: '#5a7d96' }}>
        <div><span className="text-white">{stats.circuits}</span> circuits live · <span className="text-white">{stats.processes}</span> processes</div>
        <div><span style={{ color: '#9fe8ff' }}>{stats.cycles}</span> execution cycles this session</div>
        <div><span style={{ color: '#55ff88' }}>{stats.evolved}</span> structures evolved · <span style={{ color: '#ff5544' }}>{stats.contained}</span> hallucinations contained</div>
      </div>

      {/* ---- legend ---- */}
      <div className="absolute bottom-4 right-4 pointer-events-none text-[10px] leading-relaxed text-right" style={{ ...mono, color: '#48677e' }}>
        <div><span style={{ color: '#ff2742' }}>●</span> worker model &nbsp; <span style={{ color: '#8be32a' }}>▮</span> skill &nbsp; <span style={{ color: '#16a6e0' }}>▢</span> transparency</div>
        <div><span style={{ color: '#f2f8ff' }}>◌</span> security cycle &nbsp; <span style={{ color: '#1db954' }}>⬡</span> evolver block &nbsp; <span style={{ color: '#b03030' }}>—</span> failure report</div>
        <div className="mt-1" style={{ color: '#33506a' }}>drag to orbit · scroll / pinch to zoom · click anything to inspect</div>
      </div>

      {/* ---- inspector panel ---- */}
      {selected && (
        <div
          className="absolute top-16 right-4 w-72 p-4 rounded-sm border backdrop-blur-sm"
          style={{ ...mono, background: 'rgba(3,9,14,0.85)', borderColor: '#1d3a50' }}
        >
          <div className="flex justify-between items-start">
            <div>
              <div className="text-[10px] tracking-widest" style={{ color: '#4a6a88' }}>{selected.id}</div>
              <div className="text-sm text-white mt-0.5">{selected.label}</div>
            </div>
            <button onClick={() => setSelected(null)} className="text-xs px-1.5" style={{ color: '#4a6a88' }}>✕</button>
          </div>

          <div className="mt-3 text-[11px] leading-relaxed" style={{ color: '#8fb0c6' }}>{selected.detail}</div>

          <div className="mt-3 space-y-1.5 text-[11px]">
            <Row k="current action" v={selected.action} c="#cfeaff" />
            <Row k="state" v={pausedCircuits[selected.circuitId] ? 'paused by you' : selected.state} c={pausedCircuits[selected.circuitId] ? '#c8a23a' : selected.state === 'stable' ? '#55ff88' : '#ffaa44'} />
            <Row k="dependencies" v={`${selected.deps} structures`} c="#cfeaff" />
            <Row k="circuit" v={selected.circuitId} c="#cfeaff" />
          </div>

          {/* confidence */}
          <div className="mt-3">
            <div className="flex justify-between text-[10px]" style={{ color: '#4a6a88' }}>
              <span>confidence</span><span style={{ color: selected.confidence > 80 ? '#55ff88' : selected.confidence > 65 ? '#c8d34a' : '#ff5544' }}>{selected.confidence}%</span>
            </div>
            <div className="h-1 mt-1 rounded-full" style={{ background: '#10202e' }}>
              <div className="h-1 rounded-full" style={{ width: `${selected.confidence}%`, background: selected.confidence > 80 ? '#55ff88' : selected.confidence > 65 ? '#c8d34a' : '#ff5544' }} />
            </div>
          </div>

          {/* reshape controls */}
          {selected.kind !== 'evolver' && (
            <button
              onClick={togglePause}
              className="mt-4 w-full py-1.5 text-[11px] tracking-wider border rounded-sm"
              style={{ borderColor: '#27435a', color: pausedCircuits[selected.circuitId] ? '#55ff88' : '#c8a23a' }}
            >
              {pausedCircuits[selected.circuitId] ? '▶ RESUME CIRCUIT' : '⏸ PAUSE CIRCUIT'}
            </button>
          )}
          {selected.kind === 'evolver' && (
            <div className="mt-4 text-[10px] text-center py-1.5 border rounded-sm" style={{ borderColor: '#1d4a31', color: '#1db954' }}>
              EVOLVERS CANNOT BE PAUSED · THE SYSTEM MUST IMPROVE
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ k, v, c }) {
  const mono = { fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace" };
  return (
    <div className="flex justify-between gap-3" style={mono}>
      <span style={{ color: '#4a6a88' }}>{k}</span>
      <span className="text-right" style={{ color: c }}>{v}</span>
    </div>
  );
}
