import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import {
  canvasModeAtom,
  canvasOffsetAtom,
  activeDrawColorAtom,
} from '@/atoms/canvas';
import { nodesAtom, bandsAtom, drawingsAtom } from '@/atoms/workspace';
import { agentPresetsAtom } from '@/atoms/presets';
import { isCreateAgentModalOpenAtom } from '@/atoms/ui';
import {
  MousePointer,
  Hand,
  PenTool,
  Link,
  Terminal,
  FileText,
  BookOpen,
  Globe,
  Plus,
  ZoomIn,
  ZoomOut,
  Maximize,
  Group,
  Sparkles,
  Trash2,
  CheckCircle,
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
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-2 bg-[#18191f]/95 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-md z-40 select-none">
      {/* Mode Switches */}
      <div className="flex items-center gap-0.5 bg-black/40 p-1 rounded-xl">
        <button
          onClick={() => setMode('select')}
          className={`p-2 rounded-lg transition-colors ${
            mode === 'select' ? 'bg-blue-600 text-white shadow-md' : 'text-zinc-400 hover:text-white'
          }`}
          title="Select Mode (V) - Drag & Arrange Nodes"
        >
          <MousePointer className="w-4 h-4" />
        </button>

        <button
          onClick={() => setMode('pan')}
          className={`p-2 rounded-lg transition-colors ${
            mode === 'pan' ? 'bg-blue-600 text-white shadow-md' : 'text-zinc-400 hover:text-white'
          }`}
          title="Hand / Pan Canvas (H or Space+Drag)"
        >
          <Hand className="w-4 h-4" />
        </button>

        <button
          onClick={() => setMode('draw')}
          className={`p-2 rounded-lg transition-colors ${
            mode === 'draw' ? 'bg-blue-600 text-white shadow-md' : 'text-zinc-400 hover:text-white'
          }`}
          title="Freehand Brush / Paint (P)"
        >
          <PenTool className="w-4 h-4" />
        </button>

        <button
          onClick={() => setMode('connect')}
          className={`p-2 rounded-lg transition-colors ${
            mode === 'connect'
              ? 'bg-emerald-600 text-white shadow-md animate-pulse'
              : 'text-zinc-400 hover:text-white'
          }`}
          title="Connect Cable Tie (C) - Link agent to note/portal"
        >
          <Link className="w-4 h-4" />
        </button>
      </div>

      {/* Brush color palette when in draw mode */}
      {mode === 'draw' && (
        <>
          <div className="w-[1px] h-6 bg-white/10 my-auto mx-1" />
          <div className="flex items-center gap-1.5 bg-black/40 px-2 py-1 rounded-xl">
            {brushColors.map((c) => (
              <button
                key={c.value}
                onClick={() => setDrawColor(c.value)}
                style={{ backgroundColor: c.value }}
                className={`w-4 h-4 rounded-full transition-transform ${
                  drawColor === c.value ? 'scale-125 ring-2 ring-white shadow-md' : 'opacity-70 hover:opacity-100'
                }`}
                title={c.label}
              />
            ))}
            <button
              onClick={clearDrawings}
              className="ml-1 p-1 text-zinc-400 hover:text-red-400 rounded transition-colors"
              title="Clear all drawings"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      )}

      <div className="w-[1px] h-6 bg-white/10 my-auto mx-1" />

      {/* Creation Tools */}
      <div className="flex items-center gap-1">
        {/* Terminal / Agent Add - Opens Novo Terminal Modal */}
        <button
          onClick={() => setIsCreateAgentOpen(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-500/15 text-blue-300 hover:bg-blue-500/25 border border-blue-500/30 text-xs font-medium transition-colors"
          title="Novo Terminal / Agente"
        >
          <Terminal className="w-3.5 h-3.5 text-blue-400" />
          <span>Agent</span>
          <Plus className="w-3 h-3 ml-0.5 opacity-70" />
        </button>

        {/* Note Add */}
        <button
          onClick={addStickyNote}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-yellow-500/15 text-yellow-300 hover:bg-yellow-500/25 border border-yellow-500/30 text-xs font-medium transition-colors"
          title="Add Sticky Note"
        >
          <FileText className="w-3.5 h-3.5 text-yellow-400" />
          <span>Note</span>
        </button>

        {/* NoteStack (Fichário) Add */}
        <button
          onClick={addNoteStack}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 border border-purple-500/30 text-xs font-medium transition-colors"
          title="Add Multi-Page Binder"
        >
          <BookOpen className="w-3.5 h-3.5 text-purple-400" />
          <span>Binder</span>
        </button>

        {/* Portal Add */}
        <button
          onClick={addPortal}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30 text-xs font-medium transition-colors"
          title="Add Browser Portal"
        >
          <Globe className="w-3.5 h-3.5 text-emerald-400" />
          <span>Portal</span>
        </button>

        {/* Band Add */}
        <button
          onClick={addBand}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-500/15 text-zinc-300 hover:bg-zinc-500/25 border border-zinc-500/30 text-xs font-medium transition-colors"
          title="Add Spatial Band Group"
        >
          <Group className="w-3.5 h-3.5" />
          <span>Band</span>
        </button>
      </div>

      <div className="w-[1px] h-6 bg-white/10 my-auto mx-1" />

      {/* Zoom Controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => handleZoom(-0.1)}
          className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5"
          title="Zoom Out (-)"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={handleResetZoom}
          className="px-2 py-1 text-xs font-mono text-zinc-300 hover:text-white rounded-lg hover:bg-white/5"
          title="Reset Zoom (100%)"
        >
          {zoomPercent}%
        </button>

        <button
          onClick={() => handleZoom(0.1)}
          className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5"
          title="Zoom In (+)"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
