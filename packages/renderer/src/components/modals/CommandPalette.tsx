import React, { useState, useEffect, useMemo } from 'react';
import { useAtom } from 'jotai';
import {
  isCommandPaletteOpenAtom,
  isAccountsModalOpenAtom,
  isWorkspaceSettingsModalOpenAtom,
  isCreateFloorModalOpenAtom,
  isFloorLandingModalOpenAtom,
  isSidebarCollapsedAtom,
} from '@/atoms/ui';
import { isRoutinesModalOpenAtom } from '@/atoms/routines';
import { canvasOffsetAtom, selectedNodeIdsAtom } from '@/atoms/canvas';
import {
  nodesAtom,
  cableTiesAtom,
  beginUndoGroupAtom,
  endUndoGroupAtom,
  patchFramesAtom,
} from '@/atoms/workspace';
import { agentPresetsAtom } from '@/atoms/presets';
import {
  alignElements,
  tidyNodes,
  noteStackSpill,
  layOutDissolvedBandMembers,
  framePlacedNextTo,
  DEFAULT_NODE_DIMENSIONS,
} from '@/utils/layout';
import {
  Search,
  Terminal,
  FileText,
  BookOpen,
  Globe,
  Plus,
  Clock,
  Key,
  Settings,
  GitMerge,
  Maximize,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Layers,
  FolderOpen,
  Sparkles,
  UnfoldHorizontal,
  FolderMinus,
  Copy,
  Trash2,
  Paperclip,
  Sidebar as SidebarIcon,
} from 'lucide-react';
import { CanvasNode, CableTie } from '@mindagentics/shared';

interface PaletteAction {
  id: string;
  title: string;
  category: string;
  shortcut?: string;
  icon: React.ReactNode;
  perform: () => void;
}

export const CommandPalette: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isCommandPaletteOpenAtom);
  const [, setIsSettingsOpen] = useAtom(isWorkspaceSettingsModalOpenAtom);
  const [, setIsCreateFloorOpen] = useAtom(isCreateFloorModalOpenAtom);
  const [, setIsFloorLandingOpen] = useAtom(isFloorLandingModalOpenAtom);
  const [, setIsRoutinesOpen] = useAtom(isRoutinesModalOpenAtom);
  const [, setIsAccountsOpen] = useAtom(isAccountsModalOpenAtom);
  const [, setIsSidebarCollapsed] = useAtom(isSidebarCollapsedAtom);

  const [offset, setOffset] = useAtom(canvasOffsetAtom);
  const [nodes, setNodes] = useAtom(nodesAtom);
  const [cableTies, setCableTies] = useAtom(cableTiesAtom);
  const [selectedIds, setSelectedIds] = useAtom(selectedNodeIdsAtom);
  const [presets] = useAtom(agentPresetsAtom);

  const [, beginUndoGroup] = useAtom(beginUndoGroupAtom);
  const [, endUndoGroup] = useAtom(endUndoGroupAtom);
  const [, patchFrames] = useAtom(patchFramesAtom);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tidyVariant, setTidyVariant] = useState(0);

  // Global Ctrl+P / Cmd+P & Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && (e.key.toLowerCase() === 'p' || e.key.toLowerCase() === 'k') && !e.shiftKey) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setIsOpen]);

  // Reset query and selected index when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const selectedNodes = useMemo(
    () => nodes.filter((n) => selectedIds.includes(n.id)),
    [nodes, selectedIds]
  );

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = [];

    // 1. Contextual Selection Actions (When nodes are selected)
    if (selectedNodes.length >= 2) {
      // Auto-organize (Tidy)
      list.push({
        id: 'ctx-tidy',
        title: `Auto-organizar Nós (Tidy Layout) [Variante ${((tidyVariant % 3) + 1)}]`,
        category: 'Seleção Atual',
        shortcut: 'Ctrl+Shift+T',
        icon: <Sparkles className="w-4 h-4 text-amber-400" />,
        perform: () => {
          beginUndoGroup();
          const tidied = tidyNodes(selectedNodes, 4 / 3, tidyVariant);
          setTidyVariant((prev) => prev + 1);
          patchFrames(
            tidied.map((n) => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }))
          );
          endUndoGroup();
        },
      });

      // Align Edge & Center
      list.push({
        id: 'ctx-align-left',
        title: 'Alinhar Seleção à Esquerda',
        category: 'Seleção Atual',
        icon: <AlignLeft className="w-4 h-4 text-blue-400" />,
        perform: () => {
          beginUndoGroup();
          const aligned = alignElements(selectedNodes, 'left');
          patchFrames(aligned.map((n) => ({ id: n.id, x: n.x, y: n.y })));
          endUndoGroup();
        },
      });

      list.push({
        id: 'ctx-align-center-h',
        title: 'Alinhar Seleção ao Centro Horizontal',
        category: 'Seleção Atual',
        icon: <AlignCenter className="w-4 h-4 text-blue-400" />,
        perform: () => {
          beginUndoGroup();
          const aligned = alignElements(selectedNodes, 'centerHorizontally');
          patchFrames(aligned.map((n) => ({ id: n.id, x: n.x, y: n.y })));
          endUndoGroup();
        },
      });

      list.push({
        id: 'ctx-align-right',
        title: 'Alinhar Seleção à Direita',
        category: 'Seleção Atual',
        icon: <AlignRight className="w-4 h-4 text-blue-400" />,
        perform: () => {
          beginUndoGroup();
          const aligned = alignElements(selectedNodes, 'right');
          patchFrames(aligned.map((n) => ({ id: n.id, x: n.x, y: n.y })));
          endUndoGroup();
        },
      });

      list.push({
        id: 'ctx-align-top',
        title: 'Alinhar Seleção ao Topo',
        category: 'Seleção Atual',
        icon: <AlignJustify className="w-4 h-4 text-blue-400" />,
        perform: () => {
          beginUndoGroup();
          const aligned = alignElements(selectedNodes, 'top');
          patchFrames(aligned.map((n) => ({ id: n.id, x: n.x, y: n.y })));
          endUndoGroup();
        },
      });

      // Distribute actions (if >= 3 nodes)
      if (selectedNodes.length >= 3) {
        list.push({
          id: 'ctx-distribute-h',
          title: 'Distribuir Seleção Horizontalmente',
          category: 'Seleção Atual',
          icon: <UnfoldHorizontal className="w-4 h-4 text-emerald-400" />,
          perform: () => {
            beginUndoGroup();
            const distributed = alignElements(selectedNodes, 'distributeHorizontally');
            patchFrames(distributed.map((n) => ({ id: n.id, x: n.x, y: n.y })));
            endUndoGroup();
          },
        });
      }

      // Connect all selected in a chain
      list.push({
        id: 'ctx-connect-chain',
        title: 'Conectar Nós Selecionados em Cadeia (Cable Ties)',
        category: 'Seleção Atual',
        icon: <Paperclip className="w-4 h-4 text-emerald-400" />,
        perform: () => {
          beginUndoGroup();
          const newTies: CableTie[] = [];
          for (let i = 0; i < selectedNodes.length - 1; i++) {
            newTies.push({
              id: `tie-chain-${Date.now()}-${i}`,
              fromNodeId: selectedNodes[i].id,
              toNodeId: selectedNodes[i + 1].id,
              label: 'Chain',
            });
          }
          setCableTies((prev) => [...prev, ...newTies]);
          endUndoGroup();
        },
      });
    }

    // Single Node Context Actions
    if (selectedNodes.length === 1) {
      const singleNode = selectedNodes[0];

      if (singleNode.kind === 'noteStack') {
        list.push({
          id: 'ctx-spill-stack',
          title: 'Derramar Fichário no Canvas (Spill Note Stack)',
          category: 'Seleção Atual',
          icon: <BookOpen className="w-4 h-4 text-purple-400" />,
          perform: () => {
            beginUndoGroup();
            const { updatedNodes } = noteStackSpill(singleNode, nodes);
            setNodes(updatedNodes);
            endUndoGroup();
          },
        });
      }

      list.push({
        id: 'ctx-duplicate-node',
        title: 'Duplicar Nó Selecionado',
        category: 'Seleção Atual',
        icon: <Copy className="w-4 h-4 text-zinc-300" />,
        perform: () => {
          beginUndoGroup();
          const nextPos = framePlacedNextTo(nodes, singleNode.id);
          const newNode: CanvasNode = {
            ...singleNode,
            id: `node-${Date.now()}`,
            x: nextPos.x,
            y: nextPos.y,
            zIndex: (singleNode.zIndex || 10) + 1,
          };
          setNodes((prev) => [...prev, newNode]);
          setSelectedIds([newNode.id]);
          endUndoGroup();
        },
      });

      list.push({
        id: 'ctx-delete-node',
        title: 'Excluir Nó Selecionado',
        category: 'Seleção Atual',
        shortcut: 'Del',
        icon: <Trash2 className="w-4 h-4 text-red-400" />,
        perform: () => {
          beginUndoGroup();
          setNodes((prev) => prev.filter((n) => n.id !== singleNode.id));
          setCableTies((prev) =>
            prev.filter((t) => t.fromNodeId !== singleNode.id && t.toNodeId !== singleNode.id)
          );
          setSelectedIds([]);
          endUndoGroup();
        },
      });
    }

    // 2. Global Actions
    list.push(
      {
        id: 'add-antigravity',
        title: 'Novo Terminal: Antigravity Agent (Lead Architect)',
        category: 'Canvas Nodes (@terminal)',
        icon: <Terminal className="w-4 h-4 text-blue-400" />,
        perform: () => {
          const nextPos = framePlacedNextTo(nodes, null, {
            x: (-offset.x + 280) / offset.zoom,
            y: (-offset.y + 160) / offset.zoom,
          });
          setNodes((prev) => [
            ...prev,
            {
              id: `node-term-${Date.now()}`,
              kind: 'terminal',
              x: nextPos.x,
              y: nextPos.y,
              width: DEFAULT_NODE_DIMENSIONS.terminal.width,
              height: DEFAULT_NODE_DIMENSIONS.terminal.height,
              zIndex: 30,
              content: {
                terminalId: `term-${Date.now()}`,
                presetId: presets[2]?.id,
                title: 'Antigravity Session',
                agentRole: 'Lead Architect',
                status: 'idle',
                hasAttention: false,
              },
            },
          ]);
        },
      },
      {
        id: 'add-claude',
        title: 'Novo Terminal: Claude Code',
        category: 'Canvas Nodes (@terminal)',
        icon: <Terminal className="w-4 h-4 text-orange-400" />,
        perform: () => {
          const nextPos = framePlacedNextTo(nodes, null, {
            x: (-offset.x + 280) / offset.zoom,
            y: (-offset.y + 160) / offset.zoom,
          });
          setNodes((prev) => [
            ...prev,
            {
              id: `node-term-${Date.now()}`,
              kind: 'terminal',
              x: nextPos.x,
              y: nextPos.y,
              width: DEFAULT_NODE_DIMENSIONS.terminal.width,
              height: DEFAULT_NODE_DIMENSIONS.terminal.height,
              zIndex: 30,
              content: {
                terminalId: `term-${Date.now()}`,
                presetId: presets[0]?.id,
                title: 'Claude Code Session',
                agentRole: 'Engineer',
                status: 'idle',
                hasAttention: false,
              },
            },
          ]);
        },
      },
      {
        id: 'add-note',
        title: 'Nova Sticky Note (Nota Adesiva)',
        category: 'Canvas Nodes (@note)',
        icon: <FileText className="w-4 h-4 text-yellow-400" />,
        perform: () => {
          const nextPos = framePlacedNextTo(nodes, null, {
            x: (-offset.x + 350) / offset.zoom,
            y: (-offset.y + 220) / offset.zoom,
          });
          setNodes((prev) => [
            ...prev,
            {
              id: `node-note-${Date.now()}`,
              kind: 'note',
              x: nextPos.x,
              y: nextPos.y,
              width: DEFAULT_NODE_DIMENSIONS.note.width,
              height: DEFAULT_NODE_DIMENSIONS.note.height,
              zIndex: 30,
              content: {
                noteId: `note-${Date.now()}`,
                title: 'Nova Nota',
                body: '# Objetivo\n\n- Especifique requisitos ou notas de contexto',
                isNamePinned: false,
                color: 'yellow',
                stackId: null,
              },
            },
          ]);
        },
      },
      {
        id: 'add-file-ref',
        title: 'Adicionar Referência (Pasta ou Arquivo)',
        category: 'Canvas Nodes (@ref)',
        icon: <FolderOpen className="w-4 h-4 text-emerald-400" />,
        perform: async () => {
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
            const nextPos = framePlacedNextTo(nodes, null, {
              x: (-offset.x + 320) / offset.zoom,
              y: (-offset.y + 200) / offset.zoom,
            });
            setNodes((prev) => [
              ...prev,
              {
                id: `node-ref-${Date.now()}`,
                kind: 'fileRef',
                x: nextPos.x,
                y: nextPos.y,
                width: DEFAULT_NODE_DIMENSIONS.fileRef.width,
                height: DEFAULT_NODE_DIMENSIONS.fileRef.height,
                zIndex: 30,
                content: {
                  path: pickedPath,
                  isDirectory: isDir,
                  label,
                },
              } as any,
            ]);
          } catch (err) {
            console.error('Failed to pick reference:', err);
          }
        },
      },
      {
        id: 'add-portal',
        title: 'Novo Portal de Navegador (Browser Portal)',
        category: 'Canvas Nodes (@portal)',
        icon: <Globe className="w-4 h-4 text-emerald-400" />,
        perform: () => {
          const nextPos = framePlacedNextTo(nodes, null, {
            x: (-offset.x + 300) / offset.zoom,
            y: (-offset.y + 180) / offset.zoom,
          });
          setNodes((prev) => [
            ...prev,
            {
              id: `node-portal-${Date.now()}`,
              kind: 'portal',
              x: nextPos.x,
              y: nextPos.y,
              width: DEFAULT_NODE_DIMENSIONS.portal.width,
              height: DEFAULT_NODE_DIMENSIONS.portal.height,
              zIndex: 30,
              content: {
                portalKind: 'browser',
                url: 'https://github.com',
                viewport: { width: 1280, height: 800 },
                actionTags: [],
              },
            },
          ]);
        },
      },
      {
        id: 'create-floor',
        title: 'Criar Andar Isolado (Git Worktree Floor)',
        category: 'Floors (@floor)',
        icon: <Plus className="w-4 h-4 text-blue-400" />,
        perform: () => setIsCreateFloorOpen(true),
      },
      {
        id: 'land-floor',
        title: 'Aterrissar Andar (Land / Merge into Ground)',
        category: 'Floors (@floor)',
        icon: <GitMerge className="w-4 h-4 text-emerald-400" />,
        perform: () => setIsFloorLandingOpen(true),
      },
      {
        id: 'routines',
        title: 'Abrir Gerenciador de Rotinas (@routines)',
        category: 'Configurações & Automação',
        icon: <Clock className="w-4 h-4 text-purple-400" />,
        perform: () => setIsRoutinesOpen(true),
      },
      {
        id: 'accounts',
        title: 'Configurar Contas & Chaves API (@accounts)',
        category: 'Configurações & Automação',
        icon: <Key className="w-4 h-4 text-amber-400" />,
        perform: () => setIsAccountsOpen(true),
      },
      {
        id: 'settings',
        title: 'Configurações do Workspace',
        category: 'Configurações & Automação',
        icon: <Settings className="w-4 h-4 text-zinc-400" />,
        perform: () => setIsSettingsOpen(true),
      },
      {
        id: 'toggle-sidebar',
        title: 'Alternar Barra Lateral',
        category: 'Navegação',
        shortcut: 'Ctrl+S',
        icon: <SidebarIcon className="w-4 h-4 text-zinc-400 rounded-sm" />,
        perform: () => setIsSidebarCollapsed((prev: boolean) => !prev),
      },
      {
        id: 'reset-zoom',
        title: 'Redefinir Escala do Canvas (100% Zoom)',
        category: 'Navegação',
        shortcut: 'Ctrl+0',
        icon: <Maximize className="w-4 h-4 text-zinc-400" />,
        perform: () => setOffset((prev) => ({ ...prev, zoom: 1.0 })),
      }
    );

    return list;
  }, [
    selectedNodes,
    nodes,
    tidyVariant,
    offset,
    presets,
    setNodes,
    setCableTies,
    setSelectedIds,
    beginUndoGroup,
    endUndoGroup,
    patchFrames,
    setIsCreateFloorOpen,
    setIsFloorLandingOpen,
    setIsRoutinesOpen,
    setIsAccountsOpen,
    setIsSettingsOpen,
    setIsSidebarCollapsed,
    setOffset,
  ]);

  // Fuzzy filter & Mentions
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;

    // Check for @ mentions (e.g. @note, @portal, @term, @routines)
    if (q.startsWith('@')) {
      const mention = q.slice(1);
      return actions.filter(
        (a) =>
          a.category.toLowerCase().includes(mention) ||
          a.title.toLowerCase().includes(mention)
      );
    }

    return actions.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
    );
  }, [actions, query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].perform();
        setIsOpen(false);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      onClick={() => setIsOpen(false)}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center pt-24 p-4 select-none animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-[#16181f] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Search Input ("Batuta Search") */}
        <div className="flex items-center px-4 py-3 bg-[#1d1f27] border-b border-white/5">
          <Search className="w-4 h-4 text-zinc-400 mr-2.5 shrink-0" />
          <input
            type="text"
            value={query}
            autoFocus
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Digite um comando, @menção (@note, @term, @portal) ou busque ações..."
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
          />
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-black/40 rounded border border-white/10 text-zinc-400">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-xs text-zinc-500">
              Nenhuma ação encontrada para "{query}"
            </div>
          ) : (
            filtered.map((action, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={action.id}
                  onClick={() => {
                    action.perform();
                    setIsOpen(false);
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-blue-600/20 text-white border border-blue-500/40'
                      : 'text-zinc-300 hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {action.icon}
                    <span className="font-medium">{action.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {action.shortcut && (
                      <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-white/5 rounded border border-white/10 text-zinc-400">
                        {action.shortcut}
                      </kbd>
                    )}
                    <span className="text-[10px] text-zinc-500">{action.category}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
