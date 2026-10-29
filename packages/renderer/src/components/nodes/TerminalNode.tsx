import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import { WebglAddon } from '@xterm/addon-webgl';
import {
  TerminalNode as TerminalNodeType,
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
  Globe,
  Layers,
  Cpu,
} from 'lucide-react';
import { useAtom, useAtomValue } from 'jotai';
import { agentPresetsAtom } from '@/atoms/presets';
import { cableTiesAtom, nodesAtom, activeWorkspaceAtom } from '@/atoms/workspace';

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

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [title, setTitle] = useState(node.content.title);

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
  const isMaestro = Boolean(node.content.maestroMode);

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
      .filter(Boolean) as any[];
  }, [cableTies, allNodes, node.id, node.content.terminalId]);

  const getAgentIcon = (presetName?: string) => {
    const nameLower = (presetName || '').toLowerCase();
    if (nameLower.includes('claude')) {
      return <ShieldCheck className="w-3.5 h-3.5 text-orange-400" />;
    } else if (nameLower.includes('codex')) {
      return <Brain className="w-3.5 h-3.5 text-purple-400" />;
    } else if (nameLower.includes('antigravity') || nameLower.includes('agy')) {
      return <Sparkles className="w-3.5 h-3.5 text-blue-400" />;
    } else if (nameLower.includes('ollama')) {
      return <Cpu className="w-3.5 h-3.5 text-emerald-400" />;
    } else {
      return <TerminalIcon className="w-3.5 h-3.5 text-emerald-400" />;
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
      fontFamily: "Cascadia Mono, Consolas, 'Fira Code', monospace",
      fontSize: 12,
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

      // Copy selection on Ctrl+C / Cmd+C when text is selected
      if ((arg.ctrlKey || arg.metaKey) && arg.key.toLowerCase() === 'c' && term.hasSelection()) {
        const selectedText = term.getSelection();
        if (selectedText) {
          navigator.clipboard.writeText(selectedText).catch(() => {});
        }
        return false;
      }

      // Paste on Ctrl+V / Cmd+V
      if ((arg.ctrlKey || arg.metaKey) && arg.key.toLowerCase() === 'v' && !arg.shiftKey) {
        navigator.clipboard.readText().then((clipText) => {
          if (clipText && termBridge) {
            termBridge.write(termId, clipText);
          }
        }).catch(() => {});
        return false;
      }

      // Allow Ctrl+P, Ctrl+K, Ctrl+H and all standard shell readline navigation through to xterm
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
      fitAddon.fit();
    } catch {}

    xtermInstance.current = term;
    fitAddonRef.current = fitAddon;

    const termId = node.content.terminalId;

    let unsubscribeData: (() => void) | undefined;
    let unsubscribeStatus: (() => void) | undefined;

    const termBridge = window.mindAgentics?.terminal || (window.mindAgentics?.terminal || window.api?.terminal || window.maestri?.terminal);
    if (termBridge) {
      let scrollbackRestored = false;
      const pendingDataQueue: string[] = [];

      unsubscribeData = termBridge.onData((receivedId: string, data: string) => {
        if (receivedId === termId && data) {
          if (!scrollbackRestored) {
            pendingDataQueue.push(data);
          } else {
            term.write(data);
          }
        }
      });

      unsubscribeStatus = termBridge.onStatus?.((receivedId: string, st: any) => {
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
        } catch (err: any) {
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
              maestroMode: isMaestro,
            });
          } catch (err: any) {
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
            (window.mindAgentics?.terminal || window.api?.terminal || window.maestri?.terminal)?.resize;
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
  }, [node.content.terminalId, agentCommand]);

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

  const toggleMaestro = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextMaestro = !isMaestro;
    onUpdate({
      ...nodeRef.current,
      content: {
        ...nodeRef.current.content,
        maestroMode: nextMaestro,
      },
    });
    const setMaestroFn = window.mindAgentics?.terminal?.setMaestroMode || (window.mindAgentics?.terminal || window.api?.terminal || window.maestri?.terminal)?.setMaestroMode;
    if (setMaestroFn) {
      setMaestroFn(node.content.terminalId, nextMaestro).catch(() => {});
    }
  };

  const handleInsertReference = (targetNode: any) => {
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
    }

    const termWrite = window.mindAgentics?.terminal?.write || (window.mindAgentics?.terminal || window.api?.terminal || window.maestri?.terminal)?.write;
    if (refCommand && termWrite) {
      termWrite(node.content.terminalId, refCommand + '\r');
    } else if (refCommand) {
      term.write(refCommand + '\r\n');
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
      className={`flex flex-col w-full h-full bg-[#0d0e11] text-zinc-300 transition-all ${
        isMaestro ? 'ring-1 ring-amber-500/30' : ''
      }`}
    >
      {/* Node Header */}
      <div
        onPointerDown={() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }}
        className={`node-drag-handle flex items-center justify-between px-3 py-2 border-b cursor-move transition-colors ${
          isMaestro
            ? 'bg-[#16181d] border-amber-500/20'
            : 'bg-[#16181d] border-white/5'
        }`}
      >
        <div className="flex items-center gap-2">
          {getAgentIcon(agentName)}

          {isEditingTitle ? (
            <input
              type="text"
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                setIsEditingTitle(false);
                onUpdate({
                  ...nodeRef.current,
                  content: { ...nodeRef.current.content, title },
                });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setIsEditingTitle(false);
                  onUpdate({
                    ...nodeRef.current,
                    content: { ...nodeRef.current.content, title },
                  });
                }
              }}
              className="bg-black/60 text-zinc-100 text-xs px-1.5 py-0.5 rounded outline-none border border-blue-500/50"
            />
          ) : (
            <span
              onDoubleClick={() => setIsEditingTitle(true)}
              className="text-xs font-medium text-zinc-200 hover:text-white cursor-text truncate max-w-[160px]"
              title="Double click to rename"
            >
              {title}
            </span>
          )}

          {/* Agent Command Badge */}
          <span className="px-1.5 py-0.5 text-[10px] font-semibold tracking-wide rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
            {agentCommand ? agentCommand.split(' ')[0] : 'shell'}
          </span>

          {/* Maestro Toggle Badge (Discreto e Simples) */}
          <button
            type="button"
            onClick={toggleMaestro}
            className={`px-2 py-0.5 text-[10px] font-medium rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
              isMaestro
                ? 'bg-amber-500/10 text-amber-300 border border-amber-500/25 hover:bg-amber-500/15'
                : 'bg-white/[0.04] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.07] border border-white/[0.06]'
            }`}
            title={
              isMaestro
                ? 'Modo Maestro Ativo: Este agente é o Orquestrador da Equipe. Clique para desativar.'
                : 'Ativar Modo Maestro: Promove este agente a Orquestrador da Equipe.'
            }
          >
            <span className="text-[10px] leading-none opacity-80">🎼</span>
            <span>Maestro</span>
            <span
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                isMaestro ? 'bg-amber-400/90' : 'bg-zinc-600'
              }`}
            />
          </button>

          {isMaestro && (
            <span
              className="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-medium tracking-wide bg-purple-500/10 text-purple-300/90 border border-purple-500/20"
              title="Este agente possui o papel de Maestro / Orquestrador Central"
            >
              <span className="opacity-80">👑</span>
              <span>Orquestrador</span>
            </span>
          )}

          {/* Mode Badge (Autonomous vs Normal - Discreto e Simples) */}
          {node.content.isAutonomous ? (
            <span
              className="px-1.5 py-0.5 text-[9px] font-medium tracking-wide rounded-md bg-emerald-500/10 text-emerald-400/90 border border-emerald-500/20 flex items-center gap-1"
              title="Modo Autônomo: auto-aprova ações sem pausar para confirmações"
            >
              <span className="opacity-75">⚡</span>
              <span>Autônomo</span>
            </span>
          ) : (
            <span
              className="px-1.5 py-0.5 text-[9px] font-medium tracking-wide rounded-md bg-white/[0.04] text-zinc-400 border border-white/[0.06]"
              title="Modo Normal: solicita confirmação de ações"
            >
              Normal
            </span>
          )}

          {/* Status Indicator */}
          <div className="ml-1 flex items-center">{getStatusDot()}</div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1">
          {/* Bell Attention Indicator */}
          <button
            onClick={toggleAttention}
            className={`p-1 rounded transition-colors ${
              hasAttention
                ? 'text-amber-400 bg-amber-500/20 animate-bounce'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
            }`}
            title="Toggle Attention Flag"
          >
            <Bell className="w-3.5 h-3.5" />
          </button>

          {/* Close Button */}
          <button
            onClick={() => onDelete(node.id)}
            className="p-1 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
            title="Close Terminal"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Linked Components Bar */}
      {linkedNodes.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-[#13151a] border-b border-white/5 overflow-x-auto text-[11px]">
          <span className="flex items-center gap-1 text-zinc-400 font-medium">
            <LinkIcon className="w-3 h-3 text-blue-400" />
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
                : lNode.content?.title || 'Agent';

            return (
              <button
                key={lNode.id}
                onClick={() => handleInsertReference(lNode)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 hover:bg-blue-500/20 hover:text-blue-300 text-zinc-300 border border-white/10 transition-colors truncate max-w-[140px]"
                title={`Click to reference in terminal (${lTitle})`}
              >
                {lNode.kind === 'note' && <FileText className="w-2.5 h-2.5 text-yellow-400" />}
                {lNode.kind === 'portal' && <Globe className="w-2.5 h-2.5 text-emerald-400" />}
                {lNode.kind === 'noteStack' && <Layers className="w-2.5 h-2.5 text-purple-400" />}
                {lNode.kind === 'terminal' && <Sparkles className="w-2.5 h-2.5 text-blue-400" />}
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
    </div>
  );
};
