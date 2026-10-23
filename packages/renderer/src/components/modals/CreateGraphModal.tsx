import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { isCreateGraphModalOpenAtom } from '@/atoms/ui';
import { nodesAtom, activeWorkspaceAtom } from '@/atoms/workspace';
import { canvasOffsetAtom, selectedNodeIdsAtom } from '@/atoms/canvas';
import {
  Network,
  FolderOpen,
  GitBranch,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';

export const CreateGraphModal: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isCreateGraphModalOpenAtom);
  const [nodes, setNodes] = useAtom(nodesAtom);
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);
  const [offset] = useAtom(canvasOffsetAtom);
  const [, setSelectedIds] = useAtom(selectedNodeIdsAtom);

  const [sourceType, setSourceType] = useState<'local' | 'git'>('local');
  const [localPath, setLocalPath] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [gitBranch, setGitBranch] = useState('main');
  const [directed, setDirected] = useState(true);
  const [autoOpenPortal, setAutoOpenPortal] = useState(true);

  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && activeWorkspace?.workingDirectory && !localPath) {
      setLocalPath(activeWorkspace.workingDirectory);
    }
    if (isOpen) {
      setError(null);
      setLoading(false);
      setStatusMessage('');
    }
  }, [isOpen, activeWorkspace?.workingDirectory]);

  if (!isOpen) return null;

  const handlePickDirectory = async () => {
    try {
      const api = (window as any).api || (window as any).mindAgentics || (window as any).maestri;
      if (api?.app?.pickDirectory) {
        const dir = await api.app.pickDirectory();
        if (dir) {
          setLocalPath(dir);
        }
      }
    } catch {
      // ignore
    }
  };

  const getViewportCenter = (w = 880, h = 560) => {
    const cx = -offset.x / offset.zoom + window.innerWidth / (2 * offset.zoom);
    const cy = -offset.y / offset.zoom + window.innerHeight / (2 * offset.zoom);
    return { x: cx - w / 2, y: cy - h / 2 };
  };

  const handleGenerate = async () => {
    const target = sourceType === 'local' ? localPath.trim() : gitUrl.trim();
    if (!target) {
      setError(sourceType === 'local' ? 'Por favor selecione a pasta do projeto.' : 'Por favor informe a URL do repositório.');
      return;
    }

    setLoading(true);
    setError(null);
    setStatusMessage(
      sourceType === 'git'
        ? 'Clonando repositório e analisando arquitetura...'
        : 'Extraindo AST determinístico e detectando comunidades...'
    );

    try {
      const api = (window as any).api || (window as any).mindAgentics || (window as any).maestri;
      const buildFn = api?.graphify?.buildGraph;

      if (!buildFn) {
        throw new Error('Serviço Graphify não está disponível no processo principal.');
      }

      const res = await buildFn({
        target,
        isGitUrl: sourceType === 'git',
        branch: sourceType === 'git' ? gitBranch : undefined,
        directed,
      });

      if (!res || !res.ok) {
        throw new Error(res?.error || 'Falha ao gerar o grafo com Graphify.');
      }

      // Automatically spawn the Portal Node on the Canvas
      if (autoOpenPortal && res.htmlUrl) {
        const id = `node-portal-${Date.now()}`;
        const placed = getViewportCenter(880, 560);
        const nextZ = Math.max(...nodes.map((n) => n.zIndex || 1), 10) + 1;

        const newPortalNode = {
          id,
          kind: 'portal' as const,
          x: Math.round(placed.x),
          y: Math.round(placed.y),
          width: 880,
          height: 560,
          zIndex: nextZ,
          content: {
            portalKind: 'browser' as const,
            title: `Knowledge Graph: ${res.projectName}`,
            url: res.htmlUrl,
            viewport: { width: 1280, height: 800 },
            actionTags: ['graphify', 'knowledge-graph', res.projectName],
          },
        };

        setNodes((prev) => [...prev, newPortalNode]);
        setSelectedIds([id]);
      }

      setIsOpen(false);
    } catch (err: any) {
      setError(err?.message || 'Erro inesperado ao gerar o grafo.');
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-[500px] bg-[#17181c] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-[#121316]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Network className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Gerar Knowledge Graph</h2>
              <p className="text-[11px] text-zinc-400">Indexação arquitetural via AST (Graphify)</p>
            </div>
          </div>
          <button
            onClick={() => !loading && setIsOpen(false)}
            disabled={loading}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Source Tabs: Pasta Local vs Repositório Git */}
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-2">Origem do Projeto</label>
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#121316] rounded-xl border border-white/5">
              <button
                type="button"
                onClick={() => setSourceType('local')}
                className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                  sourceType === 'local'
                    ? 'bg-[#242630] text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
                <span>Pasta Local</span>
              </button>
              <button
                type="button"
                onClick={() => setSourceType('git')}
                className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                  sourceType === 'git'
                    ? 'bg-[#242630] text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
                <span>Repositório Git</span>
              </button>
            </div>
          </div>

          {/* Source Specific Input */}
          {sourceType === 'local' ? (
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">Caminho da Pasta do Projeto</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  placeholder="ex.: C:\Users\mabru\meu-projeto"
                  className="flex-1 px-3 py-2 bg-[#121316] border border-white/10 rounded-xl text-xs font-mono text-white outline-none focus:border-indigo-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={handlePickDirectory}
                  className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs text-zinc-300 flex items-center gap-1.5 transition-colors shrink-0"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Procurar...</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">URL do Repositório Git</label>
                <input
                  type="text"
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  placeholder="https://github.com/usuario/repositorio"
                  className="w-full px-3 py-2 bg-[#121316] border border-white/10 rounded-xl text-xs font-mono text-white outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Branch (opcional)</label>
                <input
                  type="text"
                  value={gitBranch}
                  onChange={(e) => setGitBranch(e.target.value)}
                  placeholder="main"
                  className="w-full px-3 py-2 bg-[#121316] border border-white/10 rounded-xl text-xs font-mono text-white outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>
          )}

          {/* Options */}
          <div className="space-y-2.5 pt-2 border-t border-white/5">
            <label className="flex items-center gap-2.5 cursor-pointer text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={autoOpenPortal}
                onChange={(e) => setAutoOpenPortal(e.target.checked)}
                className="w-4 h-4 rounded bg-[#121316] border border-white/20 text-indigo-600 focus:ring-0 focus:ring-offset-0"
              />
              <span>Abrir Portal Browser no Canvas automaticamente ao concluir</span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={directed}
                onChange={(e) => setDirected(e.target.checked)}
                className="w-4 h-4 rounded bg-[#121316] border border-white/20 text-indigo-600 focus:ring-0 focus:ring-offset-0"
              />
              <span>Preservar direção das chamadas de funções/imports (--directed)</span>
            </label>
          </div>

          {/* Token Economy Callout */}
          <div className="p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-start gap-2.5 text-indigo-300 text-[11px] leading-relaxed">
            <Sparkles className="w-4 h-4 shrink-0 text-indigo-400 mt-0.5" />
            <div>
              <strong>Custo Zero de Tokens:</strong> A extração de código é determinística (AST local). Ao concluir, todos os agentes do workspace podem consultar a arquitetura sem ler arquivos do disco.
            </div>
          </div>

          {/* Status Message / Loading */}
          {loading && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin shrink-0 text-blue-400" />
              <span>{statusMessage}</span>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-white/10 bg-[#121316]">
          <button
            type="button"
            disabled={loading}
            onClick={() => setIsOpen(false)}
            className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={handleGenerate}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition-all disabled:opacity-50"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{loading ? 'Gerando Grafo...' : 'Gerar Grafo'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
