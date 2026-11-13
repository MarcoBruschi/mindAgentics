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
import { isCreateAgentModalOpenAtom, isAgentLimitsModalOpenAtom, isCreateGraphModalOpenAtom, isSidebarOpenAtom, isToolbarCollapsedAtom } from '@/atoms/ui';
import { useAwardXp } from '@/atoms/profile';
import { snapToGrid } from '@/utils/layout';
import {
  MousePointer2,
  Terminal,
  StickyNote,
  Cable,
  FolderOpen,
  Compass,
  Network,
  Type,
  Pencil,
  Eraser,
  Minus,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
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
  const [isSidebarOpen] = useAtom(isSidebarOpenAtom);
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useAtom(isToolbarCollapsedAtom);
  const [installedAgents, setInstalledAgents] = useState<InstalledAgentReport[]>([]);
  const awardXp = useAwardXp();

  // Hover-Reveal (Auto-Hide) state with delay buffer
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 150);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const isExpanded = (!isToolbarCollapsed && (isHovered || mode === 'draw' || mode === 'erase')) || isHovered;

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

  const addFileRef = async () => {
    const api = (window as any).api || (window as any).mindAgentics;
    const pickFn = api?.app?.pickReference || api?.app?.pickDirectory;
    if (!pickFn) return;
    try {
      const res = await pickFn();
      if (!res) return;
      const pickedPath = typeof res === 'string' ? res : res.path;
      const isDir = typeof res === 'object' && 'isDirectory' in res ? res.isDirectory : true;
      if (!pickedPath) return;

      const normalized = pickedPath.replace(/\\/g, '/');
      const parts = normalized.split('/').filter(Boolean);
      const label = parts[parts.length - 1] || pickedPath;
      const id = `node-ref-${Date.now()}`;
      const placed = getViewportCenter(140, 128);

      setNodes((prev) => [
        ...prev,
        {
          id,
          kind: 'fileRef',
          x: placed.x,
          y: placed.y,
          width: 140,
          height: 128,
          zIndex: Math.max(...prev.map((n) => n.zIndex || 1), 10) + 1,
          content: {
            path: pickedPath,
            isDirectory: isDir,
            label,
          },
        } as any,
      ]);
      setSelectedIds([id]);
      setMode('select');
    } catch (err) {
      console.error('Failed to pick reference:', err);
    }
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
    awardXp(20, 'portalsOpened');
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

  const agentCount = installedAgents.length;
  const validQuotas = installedAgents
    .map((a) => a.primaryUsedFraction ?? (a.quotaPercent != null ? a.quotaPercent / 100 : null))
    .filter((f): f is number => f !== null && f !== undefined);
  const avgQuota = validQuotas.length > 0
    ? Math.round((validQuotas.reduce((acc, f) => acc + f, 0) / validQuotas.length) * 100)
    : null;

  return (
    <>
      {/* Top Floating Centered Toolbar: Hitbox-Isolated Capsule with Upper Trigger */}
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`group absolute top-0 -translate-x-1/2 flex flex-col items-center gap-1.5 z-40 select-none pointer-events-none transition-all duration-300 [transition-timing-function:cubic-bezier(0.4,0,0.2,1)] ${
          isExpanded
            ? 'translate-y-2'
            : 'translate-y-0'
        }`}
        style={{
          left: '50%',
        } as React.CSSProperties}
      >
        {/* Indicador Recolhido Unificado: Linha/Cápsula lisa, pura e minimalista (Eixo Central em 28px do topo) */}
        <button
          data-toolbar-trigger="true"
          role="button"
          tabIndex={isExpanded ? -1 : 0}
          aria-expanded={isExpanded}
          aria-label="Expandir Barra de Ferramentas"
          onClick={() => {
            setIsToolbarCollapsed(false);
            setIsHovered(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsToolbarCollapsed(false);
              setIsHovered(true);
            }
          }}
          onMouseEnter={handleMouseEnter}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className={`pointer-events-auto w-44 h-4.5 rounded-full bg-[#14161A]/85 hover:bg-[#181B20]/95 border border-[#23262C] hover:border-[#8B93FF]/40 backdrop-blur-md shadow-sm cursor-pointer transition-all duration-200 [transition-timing-function:cubic-bezier(0.4,0,0.2,1)] outline-none focus-visible:ring-2 focus-visible:ring-[#8B93FF] focus-visible:ring-offset-1 focus-visible:ring-offset-[#0E0F12] ${
            isExpanded
              ? 'opacity-0 -translate-y-2 pointer-events-none scale-95 absolute top-[19px]'
              : 'opacity-100 translate-y-0 relative mt-[19px]'
          }`}
          title="Expandir Ferramentas"
        />

        {/* Barra de Ferramentas Aberta (Capsule com acabamento acetinado escuro) */}
        <div
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className={`flex items-center gap-1 px-2 py-1.5 max-w-[calc(100vw-1rem)] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0 rounded-full bg-[#121418]/90 border border-white/[0.08] backdrop-blur-md shadow-2xl transition-all duration-200 [transition-timing-function:cubic-bezier(0.4,0,0.2,1)] canvas-toolbar ${
            isExpanded
              ? 'pointer-events-auto opacity-100 translate-y-0'
              : 'pointer-events-none opacity-0 -translate-y-8'
          }`}
        >
          {/* 1. Selection Cursor */}
          <button
            onClick={() => setMode('select')}
            className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors cursor-pointer ${
              mode === 'select'
                ? 'bg-white/10 text-white font-medium shadow-sm'
                : 'text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-white/[0.06]'
            }`}
            title="Selecionar (V)"
          >
            <MousePointer2 className="w-[17px] h-[17px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>

          {/* 2. Terminal / Agent */}
          <button
            onClick={() => setIsCreateAgentOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Novo Terminal / Agente"
          >
            <Terminal className="w-[17px] h-[17px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>

          {/* 3. Sticky Note */}
          <button
            onClick={addStickyNote}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Adicionar Nota Adesiva"
          >
            <StickyNote className="w-[17px] h-[17px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>

          {/* 4. Cable / Conectar Componentes */}
          <button
            onClick={() => setMode(mode === 'connect' ? 'select' : 'connect')}
            className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors cursor-pointer ${
              mode === 'connect'
                ? 'bg-white/10 text-white font-medium shadow-sm'
                : 'text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-white/[0.06]'
            }`}
            title="Conectar Nós (C)"
          >
            <Cable className="w-[17px] h-[17px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>

          {/* 5. Referência de Arquivo ou Pasta (FileRef) */}
          <button
            onClick={addFileRef}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Adicionar Referência (Pasta ou Arquivo)"
          >
            <FolderOpen className="w-[17px] h-[17px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>

          {/* 6. Portal Web / Navegador */}
          <button
            onClick={addPortal}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Adicionar Browser Portal"
          >
            <Compass className="w-[17px] h-[17px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>

          {/* 7. Knowledge Graph Tool (Graphify) */}
          <button
            onClick={() => setIsCreateGraphOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Gerar Knowledge Graph (Graphify)"
          >
            <Network className="w-[17px] h-[17px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>

          {/* Vertical Divider Isolating Aa and Caneta */}
          <div className="w-[1px] h-4 bg-white/[0.08] mx-0.5" />

          {/* 8. Tool Aa: Escrever no Workspace */}
          <button
            onClick={addTextBlock}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-white/[0.06] transition-colors cursor-pointer"
            title="Escrever no Workspace (Aa)"
          >
            <Type className="w-[17px] h-[17px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>

          {/* 9. Pencil / Draw Mode */}
          <button
            onClick={() => setMode(mode === 'draw' ? 'select' : 'draw')}
            className={`w-9 h-9 flex items-center justify-center rounded-full transition-colors cursor-pointer ${
              mode === 'draw'
                ? 'bg-white/10 text-white font-medium shadow-sm'
                : 'text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-white/[0.06]'
            }`}
            title="Pintar no Canvas (D)"
          >
            <Pencil className="w-[17px] h-[17px]" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </button>

          {/* Collapse Trigger Button */}
          <div className="w-[1px] h-4 bg-white/[0.08] mx-0.5" />
          <button
            tabIndex={isExpanded ? 0 : -1}
            role="button"
            aria-expanded={true}
            aria-label="Recolher Barra de Ferramentas"
            onClick={() => {
              setIsToolbarCollapsed(true);
              setIsHovered(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setIsToolbarCollapsed(true);
                setIsHovered(false);
              }
            }}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="w-7 h-7 flex items-center justify-center rounded-full text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-white/[0.06] focus-visible:ring-1 focus-visible:ring-[#8B93FF] focus-visible:outline-none transition-colors cursor-pointer"
            title="Recolher Barra de Ferramentas (Enter ou Espaço)"
          >
            <ChevronUp className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        </div>

        {/* Floating Sub-Toolbar when in Draw Mode: Brush Type, Size, and Colors */}
        {mode === 'draw' && (
          <div
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="pointer-events-auto flex items-center gap-2.5 px-3 py-1.5 rounded-full shadow-2xl bg-[#14161A]/95 border border-[#23262C] backdrop-blur-md text-xs select-none whitespace-nowrap shrink-0 animate-in fade-in zoom-in-95 translate-y-2"
          >
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
              <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          </div>
        )}

        {/* Floating Sub-Toolbar when in Erase Mode */}
        {mode === 'erase' && (
          <div
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            className="pointer-events-auto flex items-center gap-2 px-3.5 py-1.5 rounded-full shadow-2xl bg-[#14161A]/95 border border-rose-500/20 backdrop-blur-md text-xs text-[#E7E8EA] animate-in fade-in zoom-in-95 translate-y-2"
          >
            <Eraser className="w-3.5 h-3.5 text-rose-400" strokeWidth={1.75} />
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
      <div className="absolute bottom-3 right-3 sm:bottom-6 sm:right-6 max-w-[calc(100vw-1.5rem)] flex items-center z-40 select-none pointer-events-none">
        <div className="h-9 px-3 rounded-full flex items-center gap-3 bg-[#121418]/90 border border-white/[0.08] backdrop-blur-md shadow-2xl text-xs text-[#E7E8EA] pointer-events-auto">
          {/* Agent Usage Indicator */}
          <button
            data-agent-limits-trigger="true"
            onClick={() => setIsAgentLimitsOpen((prev) => !prev)}
            className="flex items-center gap-2 text-[#E7E8EA] hover:text-white transition-colors cursor-pointer outline-none"
            title="Uso e Limites dos Agentes"
          >
            <div className="w-2 h-2 rounded-full bg-[#5FD3A0] shrink-0" />
            <span className="text-[11px] font-medium tracking-tight">
              {agentCount > 0 ? `${agentCount} agentes` : 'Agentes'} · {avgQuota !== null ? `${avgQuota}%` : 'sem dados'}
            </span>
          </button>

          {/* Thin Vertical Divider */}
          <div className="w-[1px] h-3.5 bg-white/[0.08]" />

          {/* Zoom Controls */}
          <div className="flex items-center gap-1 text-[#8A8F98]">
            <button
              onClick={() => handleZoom(-0.1)}
              className="w-6 h-6 flex items-center justify-center rounded-md hover:text-[#E7E8EA] hover:bg-white/[0.06] transition-colors"
              title="Zoom Out (-)"
            >
              <Minus className="w-3.5 h-3.5" strokeWidth={1.75} />
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
              className="w-6 h-6 flex items-center justify-center rounded-md hover:text-[#E7E8EA] hover:bg-white/[0.06] transition-colors"
              title="Zoom In (+)"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
