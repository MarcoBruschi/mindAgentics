import React, { useState, useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import {
  canvasModeAtom,
  canvasOffsetAtom,
  selectedNodeIdsAtom,
  activeDrawColorAtom,
  activeBrushSizeAtom,
  activeBrushTypeAtom,
} from '@/atoms/canvas';
import { nodesAtom, drawingsAtom, activeWorkspaceAtom } from '@/atoms/workspace';
import { agentPresetsAtom } from '@/atoms/presets';
import { isCreateAgentModalOpenAtom, isAgentLimitsModalOpenAtom } from '@/atoms/ui';
import { framePlacedNextTo, DEFAULT_NODE_DIMENSIONS, snapToGrid } from '@/utils/layout';
import {
  MousePointer2,
  SquareTerminal,
  Scroll,
  Paperclip,
  Folder,
  Globe,
  Network,
  Pencil,
  Eraser,
  Minus,
  Plus,
  Trash2,
} from 'lucide-react';
import { UsageRing } from '../common/UsageRing';

interface InstalledAgentReport {
  id: string;
  name: string;
  command: string;
  icon: string;
  installed: boolean;
  colorHex?: string;
  quotaPercent?: number;
  primaryUsedFraction?: number;
  secondaryUsedFraction?: number;
  primaryResetText?: string;
}

export const CanvasToolbar: React.FC = () => {
  const [mode, setMode] = useAtom(canvasModeAtom);
  const [offset, setOffset] = useAtom(canvasOffsetAtom);
  const [, setSelectedIds] = useAtom(selectedNodeIdsAtom);
  const [presets] = useAtom(agentPresetsAtom);
  const [nodes, setNodes] = useAtom(nodesAtom);
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);
  const [, setDrawings] = useAtom(drawingsAtom);
  const [drawColor, setDrawColor] = useAtom(activeDrawColorAtom);
  const [brushSize, setBrushSize] = useAtom(activeBrushSizeAtom);
  const [brushType, setBrushType] = useAtom(activeBrushTypeAtom);

  const [, setIsCreateAgentOpen] = useAtom(isCreateAgentModalOpenAtom);
  const [, setIsAgentLimitsOpen] = useAtom(isAgentLimitsModalOpenAtom);
  const [installedAgents, setInstalledAgents] = useState<InstalledAgentReport[]>([]);

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const getLimits =
          window.mindAgentics?.terminal?.getAgentLimits ||
          (window.mindAgentics?.terminal?.getAgentLimits || window.api?.terminal?.getAgentLimits || window.maestri?.terminal?.getAgentLimits) ||
          window.api?.terminal?.getAgentLimits;

        if (typeof getLimits === 'function') {
          const agents = await getLimits();
          if (Array.isArray(agents)) {
            setInstalledAgents(agents.filter((a) => a.installed));
            return;
          }
        }

        const detectFn = window.mindAgentics?.terminal?.detectAgents || (window.mindAgentics?.terminal?.detectAgents || window.api?.terminal?.detectAgents || window.maestri?.terminal?.detectAgents);
        if (detectFn) {
          const detected = await detectFn();
          if (Array.isArray(detected)) {
            setInstalledAgents(detected.filter((a) => a.installed && !['powershell', 'cmd', 'bash'].includes(a.id)));
          }
        }
      } catch {
        // ignore
      }
    };

    fetchAgents();
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

  // Helper to place new items directly in front of the user's current view
  const getViewportCenter = (width: number, height: number) => {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const centerX = (-offset.x + screenW / 2) / offset.zoom - width / 2;
    const centerY = (-offset.y + screenH / 2) / offset.zoom - height / 2;
    // Stagger slightly so creating multiple items in a row creates a nice cascaded fan
    const stagger = (nodes.length % 6) * 24;
    return {
      x: snapToGrid(centerX + stagger),
      y: snapToGrid(centerY + stagger),
    };
  };

  const addStickyNote = () => {
    const id = `node-note-${Date.now()}`;
    const placed = getViewportCenter(340, 280);

    setNodes((prev) => [
      ...prev,
      {
        id,
        kind: 'note',
        x: placed.x,
        y: placed.y,
        width: 340,
        height: 280,
        zIndex: Math.max(...prev.map((n) => n.zIndex || 1), 10) + 1,
        content: {
          noteId: `note-${Date.now()}`,
          title: 'Nova Nota',
          body: '# Nova Nota\n\n- Escreva suas anotações aqui...',
          isNamePinned: false,
          color: 'yellow',
          stackId: null,
        },
      },
    ]);
    setMode('select');
  };

  const addNoteStack = () => {
    const id = `node-stack-${Date.now()}`;
    const placed = getViewportCenter(380, 340);

    setNodes((prev) => [
      ...prev,
      {
        id,
        kind: 'noteStack',
        x: placed.x,
        y: placed.y,
        width: 380,
        height: 340,
        zIndex: Math.max(...prev.map((n) => n.zIndex || 1), 10) + 1,
        content: {
          stackId: `stack-${Date.now()}`,
          title: 'Fichário',
          noteIds: ['p-1', 'p-2'],
          activePageIndex: 0,
          tabOrientation: 'side',
          pages: [
            {
              id: 'p-1',
              title: 'Visão Geral',
              color: 'blue',
              body: '## Fichário de Páginas\nUse as abas laterais para navegar.',
            },
            {
              id: 'p-2',
              title: 'Notas',
              color: 'purple',
              body: '## Anotações\nInformações adicionais.',
            },
          ],
        },
      },
    ]);
    setMode('select');
  };

  const addPortal = () => {
    const id = `node-portal-${Date.now()}`;
    const placed = getViewportCenter(720, 500);

    setNodes((prev) => [
      ...prev,
      {
        id,
        kind: 'portal',
        x: placed.x,
        y: placed.y,
        width: 720,
        height: 500,
        zIndex: Math.max(...prev.map((n) => n.zIndex || 1), 10) + 1,
        content: {
          portalKind: 'browser',
          url: 'https://github.com',
          viewport: { width: 1280, height: 800 },
          actionTags: [],
        },
      },
    ]);
    setMode('select');
  };

  const addKnowledgeGraph = () => {
    const id = `node-portal-${Date.now()}`;
    const placed = getViewportCenter(850, 560);
    const targetDir = activeWorkspace?.workingDirectory || '';
    const htmlUrl = targetDir ? `file:///${targetDir.replace(/\\/g, '/')}/graphify-out/graph.html` : 'https://graphify.com';

    setNodes((prev) => [
      ...prev,
      {
        id,
        kind: 'portal',
        x: placed.x,
        y: placed.y,
        width: 850,
        height: 560,
        zIndex: Math.max(...prev.map((n) => n.zIndex || 1), 10) + 1,
        content: {
          portalKind: 'browser',
          title: 'Knowledge Graph (Graphify)',
          url: htmlUrl,
          viewport: { width: 1280, height: 800 },
          actionTags: [],
        },
      },
    ]);
    setMode('select');
  };


  // Tool Aa: add text block to workspace
  const addTextBlock = () => {
    const id = `node-text-${Date.now()}`;
    const placed = getViewportCenter(240, 50);

    setNodes((prev) => [
      ...prev,
      {
        id,
        kind: 'textBlock',
        x: placed.x,
        y: placed.y,
        width: 240,
        height: 50,
        zIndex: Math.max(...prev.map((n) => n.zIndex || 1), 10) + 1,
        content: {
          text: 'Texto',
          fontSize: 24,
          color: '#ffffff',
          fontFamily: "'Inter', system-ui, sans-serif",
          fontWeight: 'normal',
          fontStyle: 'normal',
        },
      },
    ]);
    setSelectedIds([id]);
    setMode('select');
  };

  const clearDrawings = () => {
    setDrawings([]);
  };

  const brushColors = [
    { label: 'Branco', value: '#f8fafc' },
    { label: 'Azul', value: '#3b82f6' },
    { label: 'Esmeralda', value: '#10b981' },
    { label: 'Amarelo', value: '#eab308' },
    { label: 'Rosa', value: '#f43f5e' },
    { label: 'Roxo', value: '#a855f7' },
    { label: 'Laranja', value: '#f97316' },
  ];

  const brushSizes = [
    { label: 'Fino', size: 2 },
    { label: 'Médio', size: 4 },
    { label: 'Grosso', size: 8 },
    { label: 'Marcador', size: 14 },
  ];

  const brushTypes: { id: 'pen' | 'highlighter' | 'dashed' | 'neon'; label: string }[] = [
    { id: 'pen', label: 'Caneta' },
    { id: 'highlighter', label: 'Marca-texto' },
    { id: 'dashed', label: 'Tracejado' },
    { id: 'neon', label: 'Neon' },
  ];

  return (
    <>
      {/* Top Floating Centered Toolbar */}
      <div className="absolute top-2.5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-40 select-none pointer-events-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
          style={{
            backgroundColor: 'rgba(32, 32, 35, 0.85)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
          }}
        >
          {/* 1. Selection Cursor (Hollow, Tilted Left, Light Blue #3B82F6) */}
          <button
            onClick={() => setMode('select')}
            className={`p-2 rounded-full transition-all ${
              mode === 'select'
                ? 'text-[#3B82F6]'
                : 'text-[#E5E5EA] hover:text-white hover:bg-white/5'
            }`}
            title="Selecionar (V)"
          >
            <MousePointer2
              className="w-[19px] h-[19px]"
              strokeWidth={1.75}
              fill="none"
            />
          </button>

          {/* 2. Terminal / Agent (Framed in rounded square) */}
          <button
            onClick={() => setIsCreateAgentOpen(true)}
            className="p-2 rounded-full text-[#E5E5EA] hover:text-white hover:bg-white/5 transition-all"
            title="Novo Terminal / Agente"
          >
            <SquareTerminal className="w-[19px] h-[19px]" strokeWidth={1.75} />
          </button>

          {/* 3. Sticky Note */}
          <button
            onClick={addStickyNote}
            className="p-2 rounded-full text-[#E5E5EA] hover:text-white hover:bg-white/5 transition-all"
            title="Adicionar Nota"
          >
            <Scroll className="w-[19px] h-[19px]" strokeWidth={1.75} />
          </button>

          {/* 4. Link / Conectar Componentes (Paperclip) */}
          <button
            onClick={() => setMode(mode === 'connect' ? 'select' : 'connect')}
            className={`p-2 rounded-full transition-all ${
              mode === 'connect'
                ? 'text-[#3B82F6] bg-blue-500/15 ring-1 ring-blue-500/40'
                : 'text-[#E5E5EA] hover:text-white hover:bg-white/5'
            }`}
            title="Conectar Componentes (C)"
          >
            <Paperclip className="w-[19px] h-[19px]" strokeWidth={1.75} />
          </button>

          {/* 5. Folder / Multi-Page Binder */}
          <button
            onClick={addNoteStack}
            className="p-2 rounded-full text-[#E5E5EA] hover:text-white hover:bg-white/5 transition-all"
            title="Adicionar Fichário (Binder)"
          >
            <Folder className="w-[19px] h-[19px]" strokeWidth={1.75} />
          </button>

          {/* 6. Globe / Browser Portal */}
          <button
            onClick={addPortal}
            className="p-2 rounded-full text-[#E5E5EA] hover:text-white hover:bg-white/5 transition-all"
            title="Adicionar Browser Portal"
          >
            <Globe className="w-[19px] h-[19px]" strokeWidth={1.75} />
          </button>

          {/* 7. Tool Aa: Escrever no Workspace */}
          <button
            onClick={addTextBlock}
            className="w-[35px] h-[35px] rounded-full text-[#E5E5EA] hover:text-white hover:bg-white/5 transition-all flex items-center justify-center font-bold text-[15px] tracking-tight"
            title="Escrever no Workspace (Aa)"
          >
            <span>Aa</span>
          </button>

          {/* 8. Pencil / Draw Mode */}
          <button
            onClick={() => setMode(mode === 'draw' ? 'select' : 'draw')}
            className={`p-2 rounded-full transition-all ${
              mode === 'draw'
                ? 'text-[#3B82F6] bg-blue-500/10 ring-1 ring-blue-500/30'
                : 'text-[#E5E5EA] hover:text-white hover:bg-white/5'
            }`}
            title="Pintar no Canvas (D)"
          >
            <Pencil className="w-[19px] h-[19px]" strokeWidth={1.75} />
          </button>
        </div>

        {/* Floating Sub-Toolbar when in Draw Mode: Brush Type, Size, and Colors */}
        {mode === 'draw' && (
          <div className="flex items-center gap-2 bg-[#202126]/95 border border-white/10 px-3.5 py-1.5 rounded-full shadow-2xl backdrop-blur-md animate-fade-in text-xs">
            {/* Brush Type Selector */}
            <div className="flex items-center gap-1 bg-black/30 p-0.5 rounded-full border border-white/5">
              {brushTypes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setBrushType(t.id)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition-all ${
                    brushType === t.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="w-[1px] h-4 bg-white/10" />

            {/* Brush Size Selector */}
            <div className="flex items-center gap-1.5">
              {brushSizes.map((s) => (
                <button
                  key={s.size}
                  onClick={() => setBrushSize(s.size)}
                  className={`flex items-center justify-center w-5 h-5 rounded-full transition-all ${
                    brushSize === s.size
                      ? 'bg-white/15 text-white ring-1 ring-white/40'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'
                  }`}
                  title={`Tamanho: ${s.label} (${s.size}px)`}
                >
                  <div
                    className="rounded-full bg-current"
                    style={{ width: `${Math.min(12, s.size + 2)}px`, height: `${Math.min(12, s.size + 2)}px` }}
                  />
                </button>
              ))}
            </div>

            <div className="w-[1px] h-4 bg-white/10" />

            {/* Brush Colors */}
            <div className="flex items-center gap-1.5">
              {brushColors.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setDrawColor(c.value)}
                  style={{ backgroundColor: c.value }}
                  className={`w-3.5 h-3.5 rounded-full transition-transform ${
                    drawColor === c.value
                      ? 'scale-125 ring-2 ring-white shadow-md'
                      : 'opacity-70 hover:opacity-100'
                  }`}
                  title={c.label}
                />
              ))}
            </div>

            <div className="w-[1px] h-4 bg-white/10" />

            {/* Clear Drawings Button */}
            <button
              onClick={clearDrawings}
              className="p-1 text-zinc-400 hover:text-red-400 rounded-full transition-colors"
              title="Limpar todos os desenhos"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Floating Sub-Toolbar when in Erase Mode */}
        {mode === 'erase' && (
          <div className="flex items-center gap-2 bg-[#202126]/95 border border-red-500/20 px-3 py-1 rounded-full shadow-2xl backdrop-blur-md animate-fade-in text-xs text-zinc-300">
            <Eraser className="w-3.5 h-3.5 text-red-400" />
            <span className="text-[11px] font-medium text-zinc-300">Borracha ativa</span>
            <span className="text-[10px] text-zinc-500">· Arraste para apagar como lápis</span>
            <div className="w-[1px] h-3.5 bg-white/10 mx-0.5" />
            <button
              onClick={clearDrawings}
              className="text-[11px] text-red-400 hover:text-red-300 font-medium hover:underline"
            >
              Apagar tudo
            </button>
          </div>
        )}
      </div>

      {/* Bottom-Right Corner: Dynamic Limits Pill Button + Zoom Controls */}
      <div className="absolute bottom-6 right-6 flex items-center gap-2 z-40 select-none">
        {/* Indicators Pill (Status / Agent Limits) */}
        <button
          data-agent-limits-trigger="true"
          onClick={() => setIsAgentLimitsOpen((prev) => !prev)}
          className="h-[40px] px-3.5 rounded-full flex items-center gap-2.5 transition-all cursor-pointer hover:brightness-110"
          style={{
            backgroundColor: 'rgba(32, 32, 35, 0.9)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '9999px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
          }}
          title="Uso e Limites dos Agentes"
        >
          {installedAgents.length > 0 ? (
            installedAgents.slice(0, 2).map((agent) => (
              <UsageRing
                key={agent.id}
                primaryFraction={agent.primaryUsedFraction ?? (agent.quotaPercent ? agent.quotaPercent / 100 : 0.05)}
                secondaryFraction={agent.secondaryUsedFraction}
                colorHex={agent.colorHex || (agent.id === 'codex' ? '#10B981' : agent.id === 'antigravity' ? '#3B82F6' : '#A855F7')}
                size={26}
                strokeWidth={2.4}
                showDot={true}
                title={`${agent.name}: ${Math.round((agent.primaryUsedFraction ?? (agent.quotaPercent ? agent.quotaPercent / 100 : 0.05)) * 100)}%`}
              />
            ))
          ) : (
            <div className="relative w-[26px] h-[26px] flex items-center justify-center shrink-0">
              <svg className="w-[26px] h-[26px]" viewBox="0 0 28 28" fill="none">
                <circle cx="14" cy="14" r="11" stroke="#3B82F6" strokeWidth="2.5" strokeOpacity="0.3" />
              </svg>
            </div>
          )}
        </button>

        {/* Zoom Controls */}
        <div
          className="h-[40px] px-4 rounded-full flex items-center gap-3 backdrop-blur-md"
          style={{
            backgroundColor: 'rgba(32, 32, 35, 0.9)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '9999px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
          }}
        >
          <button
            onClick={() => handleZoom(-0.1)}
            className="p-1 text-[#D1D1D6] hover:text-white transition-colors flex items-center justify-center"
            title="Zoom Out (-)"
          >
            <Minus className="w-4 h-4" strokeWidth={2.2} />
          </button>

          <button
            onClick={handleResetZoom}
            className="px-1 text-[13px] font-bold text-white hover:opacity-80 transition-opacity"
            title="Reset Zoom (100%)"
          >
            {zoomPercent}%
          </button>

          <button
            onClick={() => handleZoom(0.1)}
            className="p-1 text-[#D1D1D6] hover:text-white transition-colors flex items-center justify-center"
            title="Zoom In (+)"
          >
            <Plus className="w-4 h-4" strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </>
  );
};
