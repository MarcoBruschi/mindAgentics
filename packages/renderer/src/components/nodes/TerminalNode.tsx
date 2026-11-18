import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import { WebglAddon } from '@xterm/addon-webgl';
import {
  CanvasNode,
  TerminalNode as TerminalNodeType,
  TerminalStatus,
  sanitizeForPtyLine,
} from '@mindagentics/shared';
import {
  Sparkles,
  Brain,
  ShieldCheck,
  Terminal as TerminalIcon,
  Bell,
  X,
  Link as LinkIcon,
  FileText,
  Folder,
  Globe,
  Layers,
  Cpu,
  Wand2,
  Zap,
  Settings2,
  SlidersHorizontal,
  Lock,
} from 'lucide-react';
import { EditTerminalModal } from '../modals/EditTerminalModal';
import {
  ClaudeIcon,
  CodexIcon,
  AntigravityIcon,
  OpenCodeIcon,
  ShellIcon,
} from '../icons/AgentBrandIcons';
import { useAtom, useAtomValue } from 'jotai';
import { agentPresetsAtom } from '@/atoms/presets';
import { cableTiesAtom, nodesAtom, activeWorkspaceAtom } from '@/atoms/workspace';
import { canvasOffsetAtom } from '@/atoms/canvas';

interface XtermInternalCore {
  _coreBrowserService?: {
    dpr?: number;
    _onDprChange?: { fire?: (dpr: number) => void };
  };
  _renderService?: {
    _renderer?: {
      value?: {
        _observerDisposable?: { dispose?: () => void };
      };
    };
    handleDevicePixelRatioChange?: () => void;
    handleResize?: (cols: number, rows: number) => void;
  };
}

interface XtermWithInternals extends Terminal {
  _core?: XtermInternalCore;
}

interface TerminalNodeProps {
  node: TerminalNodeType;
  onUpdate: (updated: TerminalNodeType) => void;
  onDelete: (id: string) => void;
}

export const TerminalNode: React.FC<TerminalNodeProps> = ({
  node,
  onUpdate,
  onDelete,
}) => {
  const nodeRef = useRef(node);
  nodeRef.current = node;

  const terminalRef = useRef<HTMLDivElement | null>(null);
  const xtermInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const presets = useAtomValue(agentPresetsAtom);
  const [cableTies] = useAtom(cableTiesAtom);
  const [allNodes] = useAtom(nodesAtom);
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);
  const { zoom } = useAtomValue(canvasOffsetAtom);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [title, setTitle] = useState(node.content.title);
  const [isMemoryMenuOpen, setIsMemoryMenuOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  useEffect(() => {
    setTitle(node.content.title || '');
  }, [node.content.title]);

  const handleSaveTitle = (newTitle: string) => {
    setIsEditingTitle(false);
    const trimmedTitle = newTitle.trim() || 'Terminal';
    setTitle(trimmedTitle);
    onUpdate({
      ...nodeRef.current,
      content: { ...nodeRef.current.content, title: trimmedTitle },
    });
    const terminalApi = window.mindAgentics?.terminal || window.api?.terminal;
    if (terminalApi?.reconfigure) {
      terminalApi.reconfigure(node.content.terminalId, { title: trimmedTitle, restart: false }).catch(() => {});
    }
  };

  useEffect(() => {
    if (!isMemoryMenuOpen) return;
    const handleClickOutside = () => setIsMemoryMenuOpen(false);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [isMemoryMenuOpen]);

  // Match preset or use content directly
  const preset =
    presets.find(
      (p) =>
        p.id === node.content.presetId ||
        p.agentType === node.content.presetId ||
        p.name.toLowerCase() === (node.content.presetId || '').toLowerCase()
    ) || {
      id: node.content.presetId || 'terminal',
      name: node.content.title || 'Terminal',
      command: node.content.command || '',
    };

  const agentCommand = node.content.command !== undefined ? node.content.command : (preset.command || '');
  const agentName = node.content.title || preset.name;
  const hasAttention = node.content.hasAttention || false;
  const isOrchestrator = Boolean(node.content.orchestratorMode ?? node.content.maestroMode);

  // Find components linked via Cable Ties to this node (memoized for high frame-rate performance)
  const linkedNodes = React.useMemo(() => {
    const termId = node.content.terminalId;
    const nodeId = node.id;
    const ties = (cableTies || []).filter(
      (t) =>
        t.fromNodeId === nodeId ||
        t.toNodeId === nodeId ||
        t.fromNodeId === termId ||
        t.toNodeId === termId
    );
    return ties
      .map((t) => {
        const otherId =
          t.fromNodeId === nodeId || t.fromNodeId === termId ? t.toNodeId : t.fromNodeId;
        return (allNodes || []).find(
          (n) => n.id === otherId || (n.kind === 'terminal' && n.content?.terminalId === otherId)
        );
      })
      .filter((n): n is CanvasNode => Boolean(n));
  }, [cableTies, allNodes, node.id, node.content.terminalId]);

  const getAgentIcon = (presetId?: string, presetName?: string) => {
    const check = `${presetId || ''} ${presetName || ''}`.toLowerCase();
    if (check.includes('claude')) {
      return <ClaudeIcon size={15} className="text-amber-500 shrink-0" />;
    } else if (check.includes('codex') || check.includes('openai')) {
      return <CodexIcon size={15} className="text-emerald-400 shrink-0" />;
    } else if (check.includes('antigravity') || check.includes('agy')) {
      return <AntigravityIcon size={15} className="text-indigo-400 shrink-0" />;
    } else if (check.includes('opencode') || check.includes('code')) {
      return <OpenCodeIcon size={15} className="text-sky-400 shrink-0" />;
    } else if (check.includes('ollama')) {
      return <Cpu className="w-3.5 h-3.5 text-emerald-400 shrink-0" strokeWidth={1.75} />;
    } else {
      return <ShellIcon size={15} className="text-zinc-400 shrink-0" />;
    }
  };

  useEffect(() => {
    if (!terminalRef.current) return;

    let isDisposed = false;

    // Initialize Xterm
    const term = new Terminal({
      theme: {
        background: '#0d0e11',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: 'rgba(56, 139, 253, 0.4)',
        black: '#161b22',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
      },
      fontFamily: node.content.fontFamily || "Cascadia Mono, Consolas, 'Fira Code', monospace",
      fontSize: node.content.fontSize || 12,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 10000,
      convertEol: true,
      rightClickSelectsWord: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Intercept keyboard events in terminal so Escape returns control to canvas
    // and global shortcuts (Ctrl+P, Ctrl+K, Ctrl+0, Ctrl+\) continue working
    term.attachCustomKeyEventHandler((arg: KeyboardEvent) => {
      // Shift+Escape blurs the terminal so focus returns to the canvas
      if (arg.key === 'Escape') {
        if (arg.shiftKey) {
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
          return false;
        }
        // Plain Escape is sent to xterm for Vim, Claude Code cancel, Codex, fzf, etc.
        return true;
      }

      // 1. Zoom shortcuts: Ctrl++/Ctrl=/Ctrl-/Ctrl+NumpadAdd/Subtract/0
      // Suppress from xterm to prevent emitting spurious/corrupt escape sequences (e.g. \x1f) to the shell
      const isZoomKey = (arg.ctrlKey || arg.metaKey) && (
        arg.key === '+' || arg.key === '=' || arg.key === '-' || arg.key === '_' ||
        arg.code === 'NumpadAdd' || arg.code === 'NumpadSubtract' ||
        arg.key === '0' || arg.code === 'Numpad0'
      );
      if (isZoomKey) {
        arg.preventDefault();
        return false;
      }

      // 2. Copy selection on Ctrl+C / Cmd+C when text is selected
      if ((arg.ctrlKey || arg.metaKey) && arg.key.toLowerCase() === 'c') {
        if (term.hasSelection()) {
          const selectedText = term.getSelection();
          if (selectedText) {
            navigator.clipboard.writeText(selectedText).catch(() => {});
          }
          return false;
        }
        // When NO selection, allow Ctrl+C (SIGINT) directly to shell
        return true;
      }

      // 3. Paste on Ctrl+V / Cmd+V
      if ((arg.ctrlKey || arg.metaKey) && arg.key.toLowerCase() === 'v' && !arg.shiftKey) {
        navigator.clipboard.readText().then((clipText) => {
          if (clipText && termBridge) {
            termBridge.write(termId, clipText);
          }
        }).catch(() => {});
        return false;
      }

      // 4. Crucial terminal shortcuts: Ctrl+C (no selection), Ctrl+D (EOF), Ctrl+Z (SIGTSTP), Ctrl+L (clear screen)
      // Must pass through cleanly without interception
      if (arg.ctrlKey || arg.metaKey) {
        const key = arg.key.toLowerCase();
        if (key === 'c' || key === 'd' || key === 'z' || key === 'l') {
          return true;
        }
      }

      // Allow all standard shell readline navigation through to xterm
      return true;
    });

    term.open(terminalRef.current);

    let renderAddon: WebglAddon | CanvasAddon | null = null;
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        try {
          webglAddon.dispose();
        } catch {}
      });
      term.loadAddon(webglAddon);
      renderAddon = webglAddon;
    } catch {
      try {
        const canvasAddon = new CanvasAddon();
        term.loadAddon(canvasAddon);
        renderAddon = canvasAddon;
      } catch {
        // Fallback to DOM renderer
      }
    }

    try {
      const core = (term as XtermWithInternals)._core;
      if (core?._coreBrowserService) {
        Object.defineProperty(core._coreBrowserService, 'dpr', {
          get: () => (window.devicePixelRatio || 1) * Math.max(1, zoomRef.current),
          configurable: true,
        });
      }
      core?._renderService?._renderer?.value?._observerDisposable?.dispose?.();
      core?._renderService?.handleDevicePixelRatioChange?.();
      fitAddon.fit();
    } catch {}

    xtermInstance.current = term;
    fitAddonRef.current = fitAddon;

    const termId = node.content.terminalId;

    let unsubscribeData: (() => void) | undefined;
    let unsubscribeStatus: (() => void) | undefined;

    const termBridge = window.mindAgentics?.terminal || window.api?.terminal;
    if (termBridge) {
      let scrollbackRestored = false;
      const pendingDataQueue: (string | Uint8Array)[] = [];

      unsubscribeData = termBridge.onData((receivedId: string, data: string | Uint8Array) => {
        if (receivedId === termId && data) {
          if (!scrollbackRestored) {
            pendingDataQueue.push(data);
          } else {
            term.write(data);
          }
        }
      });

      unsubscribeStatus = termBridge.onStatus?.((receivedId: string, st: TerminalStatus) => {
        if (receivedId === termId) {
          onUpdate({
            ...nodeRef.current,
            content: {
              ...nodeRef.current.content,
              status: st,
              hasAttention: st === 'attention',
            },
          });
        }
      });

      term.onData((data) => {
        termBridge?.write(termId, data);
      });

      // Restore scrollback first so previous conversations remain visible, then spawn or attach backend PTY session
      const restoreAndSpawn = async () => {
        try {
          if (termBridge.getScrollback) {
            const sb = await termBridge.getScrollback(termId);
            if (!isDisposed && sb && term) {
              term.write(sb);
            }
          }
        } catch (err: unknown) {
          console.warn('[terminal.getScrollback error]', err);
        } finally {
          if (isDisposed) return;
          scrollbackRestored = true;
          if (pendingDataQueue.length > 0) {
            for (const chunk of pendingDataQueue) {
              term.write(chunk);
            }
            pendingDataQueue.length = 0;
          }

          try {
            await termBridge.spawn({
              id: termId,
              terminalId: termId,
              command: agentCommand,
              cols: term.cols || 80,
              rows: term.rows || 24,
              cwd: node.content.workingDirectory || activeWorkspace?.workingDirectory,
              title: agentName,
              agentRole: node.content.agentRole,
              instructions: node.content.instructions,
              isAutonomous: node.content.isAutonomous ?? true,
              presetId: preset.id,
              orchestratorMode: isOrchestrator,
              maestroMode: isOrchestrator,
            });
          } catch (err: unknown) {
            console.warn('[terminal.spawn error]', err);
          }
        }
      };

      restoreAndSpawn();
    } else {
      // Fallback shell
      term.writeln(`\x1b[1;34m=== mindAgentics Agent Terminal ===\x1b[0m`);
      term.writeln(`\x1b[90mSession: ${termId} | Agent: ${agentName}\x1b[0m`);
      term.writeln(`\x1b[32mInteractive fallback shell ready.\x1b[0m\r\n`);
      term.write(`\x1b[1;36m${agentName.toLowerCase().replace(/\\s+/g, '-')}@canvas:~$ \x1b[0m`);

      let currentLine = '';
      term.onData((data) => {
        if (data === '\r') {
          term.writeln('');
          const trimmed = currentLine.trim();
          if (trimmed === 'clear') {
            term.clear();
          } else if (trimmed === 'help') {
            term.writeln('Commands: help, clear, status');
          } else if (trimmed.length > 0) {
            term.writeln(`[executed] ${trimmed}`);
          }
          currentLine = '';
          term.write(`\x1b[1;36m${agentName.toLowerCase().replace(/\\s+/g, '-')}@canvas:~$ \x1b[0m`);
        } else if (data === '\u007F') {
          if (currentLine.length > 0) {
            currentLine = currentLine.slice(0, -1);
            term.write('\b \b');
          }
        } else {
          currentLine += data;
          term.write(data);
        }
      });
    }

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const handleResize = () => {
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }
      resizeTimer = setTimeout(() => {
        if (isDisposed) return;
        try {
          fitAddon.fit();
          const termResize =
            window.mindAgentics?.terminal?.resize ||
            window.api?.terminal?.resize;
          if (termResize) {
            termResize(termId, term.cols, term.rows);
          }
        } catch {}
      }, 70);
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    // Terminals do not steal focus on initial mount so canvas tools and shortcuts remain active

    return () => {
      isDisposed = true;
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }
      resizeObserver.disconnect();
      unsubscribeData?.();
      unsubscribeStatus?.();
      try {
        renderAddon?.dispose();
      } catch {}
      term.dispose();
    };
  }, [node.content.terminalId]);

  // Synchronize XTerm canvas pixel density when canvas zoom changes for crisp vector-sharp typography
  useEffect(() => {
    const term = xtermInstance.current as XtermWithInternals | null;
    const fitAddon = fitAddonRef.current;
    if (!term || !term._core) return;

    const effectiveZoom = zoom > 0 ? zoom : 1;
    const scaledDpr = (window.devicePixelRatio || 1) * effectiveZoom;
    const core = term._core;
    const browserService = core._coreBrowserService;
    const renderService = core._renderService;

    if (browserService) {
      Object.defineProperty(browserService, 'dpr', {
        get: () => (window.devicePixelRatio || 1) * (zoomRef.current > 0 ? zoomRef.current : 1),
        configurable: true,
      });
      browserService._onDprChange?.fire?.(scaledDpr);
    }

    try {
      renderService?._renderer?.value?._observerDisposable?.dispose?.();
      term.clearTextureAtlas?.();
      renderService?.handleDevicePixelRatioChange?.();
      renderService?.handleResize?.(term.cols, term.rows);
      fitAddon?.fit();
    } catch {}
  }, [zoom]);

  const toggleAttention = () => {
    onUpdate({
      ...nodeRef.current,
      content: {
        ...nodeRef.current.content,
        hasAttention: !hasAttention,
        status: !hasAttention ? 'attention' : 'idle',
      },
    });
  };

  const handleInsertReference = (targetNode: CanvasNode) => {
    const term = xtermInstance.current;
    if (!term) return;

    let refCommand = '';
    if (targetNode.kind === 'note') {
      const noteTitle = targetNode.content?.title || 'Note';
      refCommand = `mindagentics note read "${noteTitle}"`;
    } else if (targetNode.kind === 'portal') {
      const url = targetNode.content?.url || '';
      refCommand = `mindagentics portal read "${url}"`;
    } else if (targetNode.kind === 'terminal') {
      const termTitle = targetNode.content?.title || 'Peer Agent';
      refCommand = `mindagentics ask "${termTitle}" "Hello from ${agentName}"`;
    } else if (targetNode.kind === 'fileRef') {
      const p = targetNode.content?.path || '';
      const isDir = Boolean(targetNode.content?.isDirectory);
      refCommand = `[ref] ${isDir ? 'pasta' : 'arquivo'}: ${p}`;
    }

    const termWrite = window.mindAgentics?.terminal?.write || window.api?.terminal?.write;
    if (refCommand && termWrite) {
      termWrite(node.content.terminalId, refCommand + '\r');
    } else if (refCommand) {
      term.write(refCommand + '\r\n');
    }
  };

  const handleMemoryAction = (action: 'summary' | 'clear' | 'resume') => {
    const termWrite =
      window.mindAgentics?.terminal?.write ||
      window.api?.terminal?.write;
    const term = xtermInstance.current;

    let cmd = '';
    if (action === 'summary') {
      cmd = 'mindagentics recall ""';
    } else if (action === 'clear') {
      const isWin = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('windows');
      const slug = (node.content.title || 'agent').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
      cmd = isWin
        ? `if (Test-Path ".mindagentics/memory/${slug}") { Remove-Item -Recurse -Force ".mindagentics/memory/${slug}" }; Write-Host "[mindAgentics] Memória do agente limpa."`
        : `rm -rf ".mindagentics/memory/${slug}" && echo "[mindAgentics] Memória do agente limpa."`;
    } else if (action === 'resume') {
      cmd = 'mindagentics recall "último estado" --limit 5';
    }

    if (cmd && termWrite) {
      termWrite(node.content.terminalId, cmd + '\r');
    } else if (cmd && term) {
      term.write(cmd + '\r\n');
    }
  };

  const getStatusDot = () => {
    const st = node.content.status || 'idle';
    switch (st) {
      case 'working':
        return (
          <span
            className="inline-flex rounded-full h-2 w-2 bg-amber-400 animate-pulse"
            title="Status: Working"
          />
        );
      case 'attention':
        return (
          <span
            className="inline-flex rounded-full h-2 w-2 bg-rose-500 animate-ping"
            title="Status: Needs Attention"
          />
        );
      default:
        return (
          <span
            className="inline-flex rounded-full h-2 w-2 bg-emerald-500/80"
            title="Status: Idle / Ready"
          />
        );
    }
  };

  return (
    <div
      className={`group flex flex-col w-full h-full bg-[#0d0e11] text-zinc-300 rounded-xl overflow-hidden border transition-all ${
        isOrchestrator
          ? 'border-amber-500/35 ring-1 ring-amber-500/25 shadow-[0_4px_24px_rgba(245,158,11,0.08)]'
          : 'border-white/[0.08] shadow-xl'
      }`}
    >
      {/* Node Header (Standard h-10 px-3 Height) */}
      <div
        onPointerDown={() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }}
        className={`node-drag-handle h-10 px-3 border-b flex items-center justify-between cursor-move select-none transition-colors ${
          isOrchestrator
            ? 'bg-[#181614] border-amber-500/25'
            : 'bg-[#14161A] border-white/[0.08]'
        }`}
      >
        {/* Left Side: Status Dot, Agent Brand Icon, Title, Command Badge, Orchestrator Pill */}
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
          {/* Status Dot */}
          <div className="flex items-center shrink-0">{getStatusDot()}</div>

          {/* Agent Brand Icon */}
          <div className="shrink-0 flex items-center">{getAgentIcon(node.content.presetId, agentName)}</div>

          {/* Editable Title */}
          {isEditingTitle ? (
            <input
              type="text"
              value={title}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => handleSaveTitle(title)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSaveTitle(title);
                }
                if (e.key === 'Escape') {
                  setTitle(node.content.title);
                  setIsEditingTitle(false);
                }
              }}
              className="bg-black/60 text-zinc-100 text-xs px-1.5 py-0.5 rounded outline-none border border-blue-500/50 max-w-[140px]"
            />
          ) : (
            <span
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsEditingTitle(true);
              }}
              className="text-xs font-semibold text-zinc-200 hover:text-white cursor-text truncate max-w-[150px]"
              title={`Duplo clique para renomear: ${title}`}
            >
              {title}
            </span>
          )}

          {/* Interactive Agent / Command Badge */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setIsEditModalOpen(true);
            }}
            className="group/badge px-2 py-0.5 text-[10px] font-mono font-medium tracking-wide rounded bg-white/[0.05] hover:bg-white/[0.12] text-[#8A8F98] hover:text-white border border-white/[0.06] hover:border-white/[0.2] transition-all flex items-center gap-1 shrink-0 cursor-pointer select-none"
            title="Clique para editar ou trocar o agente"
          >
            <span>{agentCommand ? agentCommand.split(' ')[0] : 'shell'}</span>
            <SlidersHorizontal className="w-2.5 h-2.5 opacity-50 group-hover/badge:opacity-100 transition-opacity" />
          </button>

          {/* Orchestrator Badge (when active) */}
          {isOrchestrator && (
            <span
              className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1 shrink-0 select-none"
              title="Modo Orquestrador Ativo (Fixo e Permanente)"
            >
              <Wand2 className="w-2.5 h-2.5 text-amber-400" />
              <span>Orquestrador</span>
              <Lock className="w-2.5 h-2.5 text-amber-400/80" />
            </span>
          )}
        </div>

        {/* Right Side: Clean Grouped Actions: Edit, Memory, Close */}
        <div className="relative flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity shrink-0">
          {/* Edit Terminal Button */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setIsEditModalOpen(true);
            }}
            className="p-1.5 text-zinc-300 hover:text-white hover:bg-white/[0.1] rounded-md transition-colors cursor-pointer"
            title="Editar Terminal (Trocar Agente, Papel e Modos)"
          >
            <Settings2 className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>

          {/* Memory Button */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setIsMemoryMenuOpen((prev) => !prev);
            }}
            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
              isMemoryMenuOpen
                ? 'text-purple-400 bg-purple-500/20'
                : 'text-zinc-400 hover:text-purple-300 hover:bg-white/[0.08]'
            }`}
            title="Memória do Agente (Ver resumo, Retomar ou Limpar)"
          >
            <Brain className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>

          {/* Memory Popover Dropdown */}
          {isMemoryMenuOpen && (
            <div
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="absolute right-14 top-full mt-1.5 w-44 py-1 rounded-lg bg-[#14161A] border border-white/[0.1] shadow-2xl z-50 text-xs"
            >
              <div className="px-2.5 py-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider border-b border-white/[0.06]">
                Memória do Agente
              </div>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setIsMemoryMenuOpen(false);
                  handleMemoryAction('summary');
                }}
                className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors"
              >
                <FileText className="w-3.5 h-3.5 text-blue-400" />
                <span>Ver resumo</span>
              </button>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setIsMemoryMenuOpen(false);
                  handleMemoryAction('resume');
                }}
                className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-zinc-300 hover:text-white hover:bg-white/[0.08] transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span>Retomar</span>
              </button>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setIsMemoryMenuOpen(false);
                  handleMemoryAction('clear');
                }}
                className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
              >
                <X className="w-3.5 h-3.5 text-rose-400" />
                <span>Limpar memória</span>
              </button>
            </div>
          )}

          {/* Close Button */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node.id);
            }}
            className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors cursor-pointer"
            title="Fechar Terminal"
          >
            <X className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Linked Components Bar */}
      {linkedNodes.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-[#13151a] border-b border-white/5 overflow-x-auto text-[11px]">
          <span className="flex items-center gap-1 text-zinc-400 font-medium">
            <LinkIcon className="w-3 h-3 text-blue-400" strokeWidth={1.75} />
            <span>Linked:</span>
          </span>
          {linkedNodes.map((lNode) => {
            const lTitle =
              lNode.kind === 'note'
                ? lNode.content?.title || 'Note'
                : lNode.kind === 'portal'
                ? lNode.content?.url || 'Portal'
                : lNode.kind === 'noteStack'
                ? lNode.content?.title || 'Binder'
                : lNode.kind === 'fileRef'
                ? lNode.content?.label || lNode.content?.path || 'Ref'
                : lNode.kind === 'terminal' || lNode.kind === 'band' || lNode.kind === 'group'
                ? lNode.content?.title || 'Agent'
                : 'Agent';

            return (
              <button
                key={lNode.id}
                onClick={() => handleInsertReference(lNode)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 hover:bg-blue-500/20 hover:text-blue-300 text-zinc-300 border border-white/10 transition-colors truncate max-w-[140px]"
                title={`Click to reference in terminal (${lTitle})`}
              >
                {lNode.kind === 'note' && <FileText className="w-2.5 h-2.5 text-yellow-400" strokeWidth={1.75} />}
                {lNode.kind === 'portal' && <Globe className="w-2.5 h-2.5 text-emerald-400" strokeWidth={1.75} />}
                {lNode.kind === 'noteStack' && <Layers className="w-2.5 h-2.5 text-purple-400" strokeWidth={1.75} />}
                {lNode.kind === 'terminal' && <Sparkles className="w-2.5 h-2.5 text-blue-400" strokeWidth={1.75} />}
                {lNode.kind === 'fileRef' && (
                  lNode.content?.isDirectory ? (
                    <Folder className="w-2.5 h-2.5 text-emerald-400" strokeWidth={1.75} />
                  ) : (
                    <FileText className="w-2.5 h-2.5 text-emerald-400" strokeWidth={1.75} />
                  )
                )}
                <span className="truncate">{lTitle}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Terminal Viewport Container */}
      <div
        className="flex-1 w-full p-1.5 overflow-hidden cursor-text select-text"
        onPointerDown={(e) => {
          e.stopPropagation();
          xtermInstance.current?.focus();
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          xtermInstance.current?.focus();
        }}
        onClick={(e) => {
          e.stopPropagation();
          xtermInstance.current?.focus();
        }}
      >
        <div ref={terminalRef} className="w-full h-full select-text" />
      </div>

      {/* Edit Terminal Modal / Popover */}
      <EditTerminalModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        node={node}
        onUpdate={onUpdate}
      />
    </div>
  );
};
