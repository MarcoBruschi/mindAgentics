import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { isCreateGraphModalOpenAtom } from '@/atoms/ui';
import { nodesAtom, activeWorkspaceAtom } from '@/atoms/workspace';
import { canvasOffsetAtom, selectedNodeIdsAtom } from '@/atoms/canvas';
import {
  FolderOpen,
  GitBranch,
  X,
  Loader2,
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

  useEffect(() => {
    const api = (window as any).api || (window as any).mindAgentics;
    if (api?.graphify?.onProgress) {
      const unsub = api.graphify.onProgress((data: { message: string }) => {
        if (data?.message) {
          setStatusMessage(data.message);
        }
      });
      return () => {
        if (typeof unsub === 'function') unsub();
      };
    }
  }, []);

  if (!isOpen) return null;

  const handlePickDirectory = async () => {
    try {
      const api = (window as any).api || (window as any).mindAgentics;
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
      const api = (window as any).api || (window as any).mindAgentics;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-[520px] max-h-[600px] bg-[#14161A] border border-[#23262C] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#E7E8EA]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#23262C] bg-[#121418] shrink-0">
          <div>
            <h2 className="text-base font-semibold text-[#E7E8EA] tracking-tight">Gerar Knowledge Graph</h2>
            <p className="text-[12px] text-[#8A8F98] mt-0.5">Indexação arquitetural determinística via AST</p>
          </div>
          <button
            onClick={() => !loading && setIsOpen(false)}
            disabled={loading}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20] transition-colors disabled:opacity-50"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Segmented Control: Pasta local vs Repositório Git */}
          <div>
            <label className="block text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider mb-2">
              Origem do Projeto
            </label>
            <div className="grid grid-cols-2 p-1 bg-[#0E0F12] rounded-xl border border-[#23262C]">
              <button
                type="button"
                onClick={() => setSourceType('local')}
                className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                  sourceType === 'local'
                    ? 'bg-[#181B20] text-[#E7E8EA] border border-[#23262C] shadow-sm'
                    : 'text-[#8A8F98] hover:text-[#E7E8EA]'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5 text-[#8B93FF]" />
                <span>Pasta local</span>
              </button>
              <button
                type="button"
                onClick={() => setSourceType('git')}
                className={`py-2 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                  sourceType === 'git'
                    ? 'bg-[#181B20] text-[#E7E8EA] border border-[#23262C] shadow-sm'
                    : 'text-[#8A8F98] hover:text-[#E7E8EA]'
                }`}
              >
                <GitBranch className="w-3.5 h-3.5 text-[#8B93FF]" />
                <span>Repositório Git</span>
              </button>
            </div>
          </div>

          {/* Directory Input / Git URL */}
          {sourceType === 'local' ? (
            <div>
              <label className="block text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider mb-1.5">
                Caminho do Projeto
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  placeholder="ex.: C:\Users\mabru\meu-projeto"
                  className="flex-1 h-9 px-3 bg-[#181B20] border border-[#23262C] rounded-xl text-xs font-mono text-[#E7E8EA] placeholder-[#8A8F98]/50 outline-none focus:border-[#8B93FF] transition-colors"
                />
                <button
                  type="button"
                  onClick={handlePickDirectory}
                  className="h-9 px-3.5 bg-[#181B20] hover:bg-[#23262C] border border-[#23262C] rounded-xl text-xs text-[#E7E8EA] flex items-center gap-1.5 transition-colors shrink-0"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-[#8B93FF]" />
                  <span>Procurar...</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider mb-1.5">
                  URL do Repositório Git
                </label>
                <input
                  type="text"
                  value={gitUrl}
                  onChange={(e) => setGitUrl(e.target.value)}
                  placeholder="https://github.com/usuario/repositorio"
                  className="w-full h-9 px-3 bg-[#181B20] border border-[#23262C] rounded-xl text-xs font-mono text-[#E7E8EA] placeholder-[#8A8F98]/50 outline-none focus:border-[#8B93FF] transition-colors"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider mb-1.5">
                  Branch (opcional)
                </label>
                <input
                  type="text"
                  value={gitBranch}
                  onChange={(e) => setGitBranch(e.target.value)}
                  placeholder="main"
                  className="w-full h-9 px-3 bg-[#181B20] border border-[#23262C] rounded-xl text-xs font-mono text-[#E7E8EA] placeholder-[#8A8F98]/50 outline-none focus:border-[#8B93FF] transition-colors"
                />
              </div>
            </div>
          )}

          {/* Simple Options */}
          <div className="space-y-2.5 pt-3 border-t border-[#23262C]">
            <label className="flex items-center gap-2.5 cursor-pointer text-xs text-[#E7E8EA]">
              <input
                type="checkbox"
                checked={autoOpenPortal}
                onChange={(e) => setAutoOpenPortal(e.target.checked)}
                className="w-4 h-4 rounded border-[#23262C] bg-[#181B20] text-[#8B93FF] accent-[#8B93FF] focus:ring-0 focus:ring-offset-0 cursor-pointer"
              />
              <span>Abrir portal no canvas ao concluir</span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer text-xs text-[#E7E8EA]">
              <input
                type="checkbox"
                checked={directed}
                onChange={(e) => setDirected(e.target.checked)}
                className="w-4 h-4 rounded border-[#23262C] bg-[#181B20] text-[#8B93FF] accent-[#8B93FF] focus:ring-0 focus:ring-offset-0 cursor-pointer"
              />
              <span>Preservar direção de imports e chamadas (--directed)</span>
            </label>
          </div>

          {/* Zero Tokens Discrete Card */}
          <div className="p-3.5 rounded-xl bg-[#14161A] border border-[#23262C] flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 shrink-0 text-[#8B93FF] mt-0.5" />
            <div className="space-y-0.5">
              <span className="text-xs font-semibold text-[#8B93FF] block">Zero tokens</span>
              <p className="text-[12px] leading-relaxed text-[#8A8F98]">
                Extração de código determinística via AST local. Agentes consultam a arquitetura sem consumir tokens nem ler arquivos do disco.
              </p>
            </div>
          </div>

          {/* Status Message / Loading */}
          {loading && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-[#181B20] border border-[#8B93FF]/30 text-[#8B93FF] text-xs">
              <Loader2 className="w-4 h-4 animate-spin shrink-0 text-[#8B93FF]" />
              <span className="text-[#E7E8EA]">{statusMessage}</span>
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
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#23262C] bg-[#121418] shrink-0">
          <button
            type="button"
            disabled={loading}
            onClick={() => setIsOpen(false)}
            className="h-9 px-4 rounded-xl text-xs font-medium text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20] transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={handleGenerate}
            className="h-9 px-5 rounded-xl text-xs font-semibold bg-[#8B93FF] hover:bg-[#7a82f8] text-[#0E0F12] flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{loading ? 'Gerando...' : 'Gerar grafo'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
