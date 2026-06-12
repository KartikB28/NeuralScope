import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { bridge } from './bridge';
import { worldScene } from './scene';
import {
  TopBar, CommandBar, ObjectivesPanel, Inspector, Ticker, Legend, Toasts,
  FrozenOverlay, EvolverBanner, ApprovalsModal, SettingsModal, SkillsModal,
  MemoryModal, TraceModal, OnboardingModal,
} from './ui';

export default function App() {
  const st = useSyncExternalStore(bridge.subscribe, bridge.getState);
  const mountRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<string | null>(null);
  const [traceFor, setTraceFor] = useState<string | null>(null);

  useEffect(() => {
    bridge.connect();
  }, []);

  useEffect(() => {
    if (!mountRef.current) return;
    worldScene.init(mountRef.current);
    return () => worldScene.dispose();
  }, []);

  // global kill-switch hotkey: Ctrl+Shift+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        bridge.send(bridge.state.frozen ? 'system.resume' : 'system.kill');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className="scene-mount" ref={mountRef} />
      <TopBar st={st} onOpen={setModal} />
      <ObjectivesPanel st={st} />
      <Inspector st={st} onTrace={(id) => setTraceFor(id)} />
      <EvolverBanner st={st} />
      <CommandBar st={st} />
      <Ticker st={st} />
      <Legend />
      <Toasts st={st} />
      <FrozenOverlay st={st} />

      {modal === 'approvals' && <ApprovalsModal st={st} onClose={() => setModal(null)} />}
      {modal === 'settings' && <SettingsModal st={st} onClose={() => setModal(null)} />}
      {modal === 'skills' && <SkillsModal st={st} onClose={() => setModal(null)} />}
      {modal === 'memory' && <MemoryModal st={st} onClose={() => setModal(null)} />}
      {traceFor && <TraceModal objectiveId={traceFor} onClose={() => setTraceFor(null)} />}
      {st.firstRun && !modal && <OnboardingModal onClose={() => bridge.completeOnboarding()} />}
    </>
  );
}
