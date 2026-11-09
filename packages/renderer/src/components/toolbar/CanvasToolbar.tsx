import React, { useState, useEffect } from 'react';
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
import { isCreateAgentModalOpenAtom, isAgentLimitsModalOpenAtom, isCreateGraphModalOpenAtom } from '@/atoms/ui';
import { snapToGrid } from '@/utils/layout';
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
  const [nodes, setNodes] = useAtom(nodesAtom);
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);
  const [, setDrawings] = useAtom(drawingsAtom);
  const [drawColor, setDrawColor] = useAtom(activeDrawColorAtom);
  const [brushSize, setBrushSize] = useAtom(activeBrushSizeAtom);
  const [brushType, setBrushType] = useAtom(activeBrushTypeAtom);

  const [, setIsCreateAgentOpen] = useAtom(isCreateAgentModalOpenAtom);
  const [, setIsAgentLimitsOpen] = useAtom(isAgentLimitsModalOpenAtom);
  const [, setIsCreateGraphOpen] = useAtom(isCreateGraphModalOpenAtom);
  const [installedAgents, setInstalledAgents] = useState<InstalledAgentReport[]>([]);

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const getLimits =
          window.mindAgentics?.terminal?.getAgentLimits ||
          (window.mindAgentics?.terminal?.getAgentLimits || window.api?.terminal?.getAgentLimits) ||
          window.api?.terminal?.getAgentLimits;

        if (typeof getLimits === 'function') {
          const agents = await getLimits();
          if (Array.isArray(agents)) {
            setInstalledAgents(agents.filter((a) => a.installed));
            return;
          }
        }

        const detectFn = window.mindAgentics?.terminal?.detectAgents || window.api?.terminal?.detectAgents;
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

  const getViewportCenter = (width: number, height: number) => {
    const screenW = window.innerWidth;
    const screenH = window.innerHeight;
    const centerX = (-offset.x + screenW / 2) / offset.zoom - width / 2;
    const centerY = (-offset.y + screenH / 2) / offset.zoom - height / 2;
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
          color: '#FFFFFF',
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
    { label: 'Branco', value: '#FFFFFF' },
    { label: 'Índigo', value: '#8B93FF' },
    { label: 'Verde', value: '#5FD3A0' },
    { label: 'Amarelo', value: '#FACC15' },
    { label: 'Coral', value: '#F87171' },
    { label: 'Roxo', value: '#C084FC' },
    { label: 'Ciano', value: '#38BDF8' },
  ];

  const brushSizes = [
    { label: 'Fino', size: 2 },
    { label: 'Médio', size: 4 },
    { label: 'Grosso', size: 8 },
  ];

  const brushTypes: { id: 'pen' | 'highlighter' | 'dashed' | 'neon'; label: string }[] = [
    { id: 'pen', label: 'Caneta' },
    { id: 'highlighter', label: 'Marca-texto' },
    { id: 'dashed', label: 'Tracejado' },
    { id: 'neon', label: 'Neon' },
  ];

  const agentCount = installedAgents.length > 0 ? installedAgents.length : 3;
  const avgQuota = installedAgents.length > 0
    ? Math.round(
        installedAgents.reduce((acc, a) => {
          const frac = a.primaryUsedFraction ?? (a.quotaPercent ? a.quotaPercent / 100 : 0.15);
          return acc + frac;
        }, 0) / installedAgents.length * 100
      )
    : 15;

  return (
    <>
      {/* Top Floating Centered Toolbar: Compact Capsule */}
      <div
        className="absolute top-2.5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-40 select-none pointer-events-auto"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-[#14161A]/95 border border-[#23262C] backdrop-blur-md shadow-2xl">
          {/* 1. Selection Cursor */}
          <button
            onClick={() => setMode('select')}
            className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors ${
              mode === 'select'
                ? 'bg-[#8B93FF]/20 text-[#8B93FF]'
                : 'text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20]'
            }`}
            title="Selecionar (V)"
          >
            <MousePointer2 className="w-[18px] h-[18px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>

          {/* 2. Terminal / Agent */}
          <button
            onClick={() => setIsCreateAgentOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20] transition-colors"
            title="Novo Terminal / Agente"
          >
            <SquareTerminal className="w-[18px] h-[18px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>

          {/* 3. Sticky Note */}
          <button
            onClick={addStickyNote}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20] transition-colors"
            title="Adicionar Nota"
          >
            <Scroll className="w-[18px] h-[18px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>

          {/* 4. Link / Conectar Componentes */}
          <button
            onClick={() => setMode(mode === 'connect' ? 'select' : 'connect')}
            className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors ${
              mode === 'connect'
                ? 'bg-[#8B93FF]/20 text-[#8B93FF]'
                : 'text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20]'
            }`}
            title="Conectar Componentes (C)"
          >
            <Paperclip className="w-[18px] h-[18px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>

          {/* 5. Folder / Multi-Page Binder */}
          <button
            onClick={addNoteStack}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20] transition-colors"
            title="Adicionar Fichário (Binder)"
          >
            <Folder className="w-[18px] h-[18px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>

          {/* 6. Globe / Browser Portal */}
          <button
            onClick={addPortal}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20] transition-colors"
            title="Adicionar Browser Portal"
          >
            <Globe className="w-[18px] h-[18px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>

          {/* 7. Knowledge Graph Tool (Graphify) */}
          <button
            onClick={() => setIsCreateGraphOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20] transition-colors"
            title="Gerar Knowledge Graph (Graphify)"
          >
            <Network className="w-[18px] h-[18px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>

          {/* Vertical Divider Isolating Aa and Caneta */}
          <div className="w-[1px] h-4 bg-[#23262C] mx-1" />

          {/* 8. Tool Aa: Escrever no Workspace */}
          <button
            onClick={addTextBlock}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20] transition-colors font-semibold text-sm tracking-tight"
            title="Escrever no Workspace (Aa)"
          >
            <span>Aa</span>
          </button>

          {/* 9. Pencil / Draw Mode */}
          <button
            onClick={() => setMode(mode === 'draw' ? 'select' : 'draw')}
            className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors ${
              mode === 'draw'
                ? 'bg-[#8B93FF]/20 text-[#8B93FF]'
                : 'text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20]'
            }`}
            title="Pintar no Canvas (D)"
          >
            <Pencil className="w-[18px] h-[18px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>
        </div>

        {/* Floating Sub-Toolbar when in Draw Mode: Brush Type, Size, and Colors */}
        {mode === 'draw' && (
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full shadow-2xl bg-[#14161A]/95 border border-[#23262C] backdrop-blur-md text-xs select-none whitespace-nowrap shrink-0 animate-in fade-in zoom-in-95">
            {/* Brush Type Segmented Control */}
            <div className="flex items-center gap-1 p-0.5 bg-[#0E0F12] rounded-full border border-[#23262C] shrink-0">
              {brushTypes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setBrushType(t.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                    brushType === t.id
                      ? 'bg-[#181B20] text-[#8B93FF] shadow-sm'
                      : 'text-[#8A8F98] hover:text-[#E7E8EA]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="w-[1px] h-4 bg-[#23262C]" />

            {/* Brush 3 Sizes Selector */}
            <div className="flex items-center gap-1.5">
              {brushSizes.map((s) => (
                <button
                  key={s.size}
                  onClick={() => setBrushSize(s.size)}
                  className={`flex items-center justify-center w-6 h-6 rounded-full transition-all ${
                    brushSize === s.size
                      ? 'bg-[#181B20] text-[#8B93FF] ring-1 ring-[#8B93FF]'
                      : 'text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20]'
                  }`}
                  title={`Tamanho: ${s.label} (${s.size}px)`}
                >
                  <div
                    className="rounded-full bg-current"
                    style={{ width: `${Math.min(10, s.size + 2)}px`, height: `${Math.min(10, s.size + 2)}px` }}
                  />
                </button>
              ))}
            </div>

            <div className="w-[1px] h-4 bg-[#23262C]" />

            {/* Brush 7 Colors */}
            <div className="flex items-center gap-1.5">
              {brushColors.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setDrawColor(c.value)}
                  style={{ backgroundColor: c.value }}
                  className={`w-3.5 h-3.5 rounded-full transition-transform ${
                    drawColor === c.value
                      ? 'scale-110 ring-2 ring-offset-2 ring-offset-[#14161A] ring-[#8B93FF]'
                      : 'opacity-70 hover:opacity-100'
                  }`}
                  title={c.label}
                />
              ))}
            </div>

            <div className="w-[1px] h-4 bg-[#23262C]" />

            {/* Clear Drawings Button */}
            <button
              onClick={clearDrawings}
              className="p-1 text-[#8A8F98] hover:text-rose-400 rounded-full transition-colors"
              title="Limpar todos os desenhos"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Floating Sub-Toolbar when in Erase Mode */}
        {mode === 'erase' && (
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full shadow-2xl bg-[#14161A]/95 border border-rose-500/20 backdrop-blur-md text-xs text-[#E7E8EA] animate-in fade-in zoom-in-95">
            <Eraser className="w-3.5 h-3.5 text-rose-400" />
            <span className="text-[11px] font-medium text-[#E7E8EA]">Borracha ativa</span>
            <div className="w-[1px] h-3.5 bg-[#23262C] mx-0.5" />
            <button
              onClick={clearDrawings}
              className="text-[11px] text-rose-400 hover:text-rose-300 font-medium hover:underline"
            >
              Apagar tudo
            </button>
          </div>
        )}
      </div>

      {/* Bottom-Right Corner: Unified Floating Capsule (Agent Usage + Zoom Controls) */}
      <div className="absolute bottom-6 right-6 flex items-center z-40 select-none">
        <div className="h-9 px-3 rounded-full flex items-center gap-3 bg-[#14161A]/95 border border-[#23262C] backdrop-blur-md shadow-2xl text-xs text-[#E7E8EA]">
          {/* Agent Usage Indicator */}
          <button
            data-agent-limits-trigger="true"
            onClick={() => setIsAgentLimitsOpen((prev) => !prev)}
            className="flex items-center gap-2 text-[#E7E8EA] hover:text-white transition-colors cursor-pointer outline-none"
            title="Uso e Limites dos Agentes"
          >
            <div className="w-2 h-2 rounded-full bg-[#5FD3A0] shadow-[0_0_6px_rgba(95,211,160,0.6)] shrink-0" />
            <span className="text-[11px] font-medium tracking-tight">
              {agentCount} agentes · {avgQuota}%
            </span>
          </button>

          {/* Thin Vertical Divider */}
          <div className="w-[1px] h-3.5 bg-[#23262C]" />

          {/* Zoom Controls */}
          <div className="flex items-center gap-1 text-[#8A8F98]">
            <button
              onClick={() => handleZoom(-0.1)}
              className="w-6 h-6 flex items-center justify-center rounded-md hover:text-[#E7E8EA] hover:bg-[#181B20] transition-colors"
              title="Zoom Out (-)"
            >
              <Minus className="w-3.5 h-3.5" strokeWidth={1.6} />
            </button>

            <button
              onClick={handleResetZoom}
              className="px-1 text-[11px] font-mono text-[#E7E8EA] hover:text-[#8B93FF] transition-colors min-w-[36px] text-center"
              title="Reset Zoom (100%)"
            >
              {zoomPercent}%
            </button>

            <button
              onClick={() => handleZoom(0.1)}
              className="w-6 h-6 flex items-center justify-center rounded-md hover:text-[#E7E8EA] hover:bg-[#181B20] transition-colors"
              title="Zoom In (+)"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={1.6} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
