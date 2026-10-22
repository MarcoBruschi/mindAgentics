import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import {
  canvasModeAtom,
  canvasOffsetAtom,
  activeDrawColorAtom,
} from '@/atoms/canvas';
import { nodesAtom, bandsAtom, drawingsAtom } from '@/atoms/workspace';
import { agentPresetsAtom } from '@/atoms/presets';
import { isCreateAgentModalOpenAtom, isAgentLimitsModalOpenAtom } from '@/atoms/ui';
import {
  Navigation,
  Terminal,
  Scroll,
  Paperclip,
  Folder,
  Globe,
  Pencil,
  ZoomIn,
  ZoomOut,
  Trash2,
} from 'lucide-react';
import { AgentPreset } from '@maestri/shared';

interface DetectedAgent {
  id: string;
  name: string;
  command: string;
  icon: string;
  installed: boolean;
  path?: string;
}

export const CanvasToolbar: React.FC = () => {
  const [mode, setMode] = useAtom(canvasModeAtom);
  const [offset, setOffset] = useAtom(canvasOffsetAtom);
  const [presets] = useAtom(agentPresetsAtom);
  const [, setNodes] = useAtom(nodesAtom);
  const [, setBands] = useAtom(bandsAtom);
  const [, setDrawings] = useAtom(drawingsAtom);
  const [drawColor, setDrawColor] = useAtom(activeDrawColorAtom);

  const [, setIsCreateAgentOpen] = useAtom(isCreateAgentModalOpenAtom);
  const [, setIsAgentLimitsOpen] = useAtom(isAgentLimitsModalOpenAtom);
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [agentExecutionMode, setAgentExecutionMode] = useState<'normal' | 'autonomous'>('autonomous');
  const [detectedAgents, setDetectedAgents] = useState<DetectedAgent[]>([]);

  useEffect(() => {
    if (window.maestri?.terminal?.detectAgents) {
      window.maestri.terminal
        .detectAgents()
        .then((agents: DetectedAgent[]) => {
          if (Array.isArray(agents) && agents.length > 0) {
            setDetectedAgents(agents);
          }
        })
        .catch(() => {});
    }
  }, []);

  const zoomPercent = Math.round(offset.zoom * 100);

  const handleZoom = (delta: number) => {
    setOffset((prev) => ({
      ...prev,
      zoom: Math.min(3.0, Math.max(0.1, Number((prev.zoom + delta).toFixed(2)))),
    }));
  };

  const handleResetZoom = () => {
    setOffset((prev) => ({
      ...prev,
      zoom: 1.0,
      x: 0,
      y: 0,
    }));
  };

  const addTerminal = (name: string, command: string, presetId = 'custom') => {
    const id = `node-term-${Date.now()}`;
    const centerX = (-offset.x + 280) / offset.zoom;
    const centerY = (-offset.y + 160) / offset.zoom;

    let finalCommand = command;
    const isAutonomous = agentExecutionMode === 'autonomous';

    if (isAutonomous && command) {
      if (command.startsWith('agy')) {
        finalCommand = 'agy --dangerously-skip-permissions --mode auto';
      } else if (command.startsWith('codex')) {
        finalCommand = 'codex --ask-for-approval never';
      } else if (command.startsWith('claude')) {
        finalCommand = 'claude --dangerously-skip-permissions';
      } else {
        finalCommand = `${command} --dangerously-skip-permissions`;
      }
    }

    setNodes((prev) => [
      ...prev,
      {
        id,
        kind: 'terminal',
        x: Math.round(centerX),
        y: Math.round(centerY),
        width: 680,
        height: 440,
        zIndex: 20,
        content: {
          terminalId: `term-${Date.now()}`,
          presetId,
          command: finalCommand,
          title: `${name}`,
          agentRole: 'Assistant',
          isLocked: false,
          status: 'idle',
          hasAttention: false,
          isAutonomous,
        },
      },
    ]);
    setShowPresetMenu(false);
  };

  const addStickyNote = () => {
    const id = `node-note-${Date.now()}`;
    const centerX = -offset.x + 350;
    const centerY = -offset.y + 220;

    setNodes((prev) => [
      ...prev,
      {
        id,
        kind: 'note',
        x: Math.round(centerX),
        y: Math.round(centerY),
        width: 340,
        height: 280,
        zIndex: 21,
        content: {
          noteId: `note-${Date.now()}`,
          title: 'New Note',
          body: '# Notes & Objectives\n\n- Write down requirements or thoughts here\n- Connect to agents using Cable Ties (C)',
          isNamePinned: false,
          color: 'yellow',
          stackId: null,
        },
      },
    ]);
  };

  const addNoteStack = () => {
    const id = `node-stack-${Date.now()}`;
    const centerX = -offset.x + 320;
    const centerY = -offset.y + 200;

    setNodes((prev) => [
      ...prev,
      {
        id,
        kind: 'noteStack',
        x: Math.round(centerX),
        y: Math.round(centerY),
        width: 380,
        height: 340,
        zIndex: 22,
        content: {
          stackId: `stack-${Date.now()}`,
          title: 'Binder (Fichário)',
          noteIds: ['p-1', 'p-2'],
          activePageIndex: 0,
          tabOrientation: 'side',
          pages: [
            {
              id: 'p-1',
              title: 'Overview',
              color: 'blue',
              body: '## Multi-page Binder\nUse side rail tabs to navigate between sub-documents.',
            },
            {
              id: 'p-2',
              title: 'Research',
              color: 'purple',
              body: '## Research Findings\nAgent output and analysis notes.',
            },
          ],
        },
      },
    ]);
  };

  const addPortal = () => {
    const id = `node-portal-${Date.now()}`;
    const centerX = -offset.x + 300;
    const centerY = -offset.y + 180;

    setNodes((prev) => [
      ...prev,
      {
        id,
        kind: 'portal',
        x: Math.round(centerX),
        y: Math.round(centerY),
        width: 720,
        height: 500,
        zIndex: 19,
        content: {
          portalKind: 'browser',
          url: 'https://github.com',
          viewport: { width: 1280, height: 800 },
          actionTags: [],
        },
      },
    ]);
  };

  const addBand = () => {
    const id = `band-${Date.now()}`;
    const centerX = -offset.x + 200;
    const centerY = -offset.y + 150;

    setBands((prev) => [
      ...prev,
      {
        id,
        title: 'New Section Band',
        color: 'rgba(59, 130, 246, 0.12)',
        bounds: {
          x: Math.round(centerX),
          y: Math.round(centerY),
          width: 800,
          height: 500,
        },
        memberNodeIds: [],
      },
    ]);
  };

  const clearDrawings = () => {
    setDrawings([]);
  };

  const brushColors = [
    { label: 'Blue', value: '#3b82f6' },
    { label: 'Emerald', value: '#10b981' },
    { label: 'Yellow', value: '#eab308' },
    { label: 'Rose', value: '#f43f5e' },
    { label: 'Purple', value: '#a855f7' },
    { label: 'White', value: '#f8fafc' },
  ];

  return (
    <>
      {/* Top Floating Toolbar (Matching Reference Image) */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-40 select-none">
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#202126]/90 border border-white/10 rounded-full shadow-2xl backdrop-blur-md">
          {/* 1. Selection / Navigation Arrow */}
          <button
            onClick={() => setMode('select')}
            className={`p-2 rounded-full transition-all ${
              mode === 'select'
                ? 'text-blue-500 fill-blue-500 bg-white/5'
                : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
            title="Selecionar (V)"
          >
            <Navigation className="w-4 h-4 fill-current -rotate-45" />
          </button>

          {/* 2. Terminal / Agent */}
          <button
            onClick={() => setIsCreateAgentOpen(true)}
            className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-white/5 transition-all"
            title="Novo Terminal / Agente"
          >
            <Terminal className="w-4 h-4" />
          </button>

          {/* 3. Scroll / Sticky Note */}
          <button
            onClick={addStickyNote}
            className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-white/5 transition-all"
            title="Adicionar Nota"
          >
            <Scroll className="w-4 h-4" />
          </button>

          {/* 4. Paperclip / Cable Tie Link */}
          <button
            onClick={() => setMode(mode === 'connect' ? 'select' : 'connect')}
            className={`p-2 rounded-full transition-all ${
              mode === 'connect'
                ? 'text-emerald-400 bg-white/5 animate-pulse'
                : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
            title="Conectar Cabo (C)"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          {/* 5. Folder / Multi-Page Binder */}
          <button
            onClick={addNoteStack}
            className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-white/5 transition-all"
            title="Adicionar Fichário (Binder)"
          >
            <Folder className="w-4 h-4" />
          </button>

          {/* 6. Globe / Browser Portal */}
          <button
            onClick={addPortal}
            className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-white/5 transition-all"
            title="Adicionar Browser Portal"
          >
            <Globe className="w-4 h-4" />
          </button>

          {/* 7. Typography / Section Band */}
          <button
            onClick={addBand}
            className="w-8 h-8 rounded-full text-zinc-400 hover:text-white hover:bg-white/5 transition-all flex items-center justify-center"
            title="Adicionar Seção (Band)"
          >
            <span className="font-bold text-[13px] font-sans tracking-tight">Aa</span>
          </button>

          {/* 8. Pencil / Draw Mode */}
          <button
            onClick={() => setMode(mode === 'draw' ? 'select' : 'draw')}
            className={`p-2 rounded-full transition-all ${
              mode === 'draw'
                ? 'text-blue-400 bg-white/5'
                : 'text-zinc-400 hover:text-white hover:bg-white/5'
            }`}
            title="Pintar no Canvas (D)"
          >
            <Pencil className="w-4 h-4" />
          </button>
        </div>

        {/* Color Palette dropdown when in draw mode */}
        {mode === 'draw' && (
          <div className="flex items-center gap-1.5 bg-[#202126]/90 border border-white/10 px-3 py-1.5 rounded-full shadow-lg backdrop-blur-md animate-fade-in">
            {brushColors.map((c) => (
              <button
                key={c.value}
                onClick={() => setDrawColor(c.value)}
                style={{ backgroundColor: c.value }}
                className={`w-3.5 h-3.5 rounded-full transition-transform ${
                  drawColor === c.value ? 'scale-125 ring-2 ring-white shadow-md' : 'opacity-70 hover:opacity-100'
                }`}
                title={c.label}
              />
            ))}
            <div className="w-[1px] h-3.5 bg-white/10 mx-1" />
            <button
              onClick={clearDrawings}
              className="p-1 text-zinc-400 hover:text-red-400 rounded-full transition-colors"
              title="Limpar desenhos"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Bottom-Right Corner: Limits Pill Button (Image 3) + Zoom Controls */}
      <div className="absolute bottom-6 right-6 flex items-center gap-2 z-40 select-none">
        {/* Limits Button matching Image 3 */}
        <button
          data-agent-limits-trigger="true"
          onClick={() => setIsAgentLimitsOpen((prev) => !prev)}
          className="flex items-center gap-2 px-2.5 py-1.5 bg-[#202126]/90 hover:bg-[#28292e] border border-white/10 hover:border-white/20 rounded-full shadow-lg transition-all cursor-pointer"
          title="Uso dos agentes"
        >
          {/* Codex Ring (green concentric circles) */}
          <div className="relative w-5 h-5 flex items-center justify-center">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="#10b981" strokeWidth="2.5" strokeOpacity="0.4" />
              <circle cx="12" cy="12" r="5" stroke="#10b981" strokeWidth="2" strokeOpacity="0.5" />
            </svg>
          </div>

          {/* Antigravity Ring (blue progress arc ~47% and inner dot) */}
          <div className="relative w-5 h-5 flex items-center justify-center">
            <svg className="w-5 h-5 -rotate-90" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="8" stroke="#1e293b" strokeWidth="3" />
              <circle
                cx="12"
                cy="12"
                r="8"
                stroke="#60a5fa"
                strokeWidth="3"
                strokeDasharray={50.26}
                strokeDashoffset={50.26 * (1 - 0.47)}
                strokeLinecap="round"
              />
              <circle cx="12" cy="12" r="3.5" stroke="#1e293b" strokeWidth="1.5" />
            </svg>
          </div>
        </button>

        {/* Zoom Controls */}
        <div className="flex items-center gap-0.5 px-2 py-1 bg-[#202126]/90 border border-white/10 rounded-full shadow-lg backdrop-blur-md">
          <button
            onClick={() => handleZoom(-0.1)}
            className="p-1 text-zinc-400 hover:text-white rounded-full hover:bg-white/10 transition-colors"
            title="Zoom Out (-)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleResetZoom}
            className="px-1.5 py-0.5 text-xs font-mono text-zinc-300 hover:text-white rounded-full hover:bg-white/10 transition-colors"
            title="Reset Zoom (100%)"
          >
            {zoomPercent}%
          </button>

          <button
            onClick={() => handleZoom(0.1)}
            className="p-1 text-zinc-400 hover:text-white rounded-full hover:bg-white/10 transition-colors"
            title="Zoom In (+)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </>
  );
};
