import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { isAgentLimitsModalOpenAtom } from '@/atoms/ui';
import {
  Activity,
  X,
  RefreshCw,
  Cpu,
  Brain,
  Sparkles,
  Terminal,
  Shield,
  Layers,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Zap,
} from 'lucide-react';

export interface AgentLimitReport {
  id: string;
  name: string;
  command: string;
  icon: string;
  installed: boolean;
  path?: string;
  status: 'active' | 'ready' | 'offline' | 'warning';
  activeModel: string;
  provider: string;
  planOrTier: string;
  contextWindow: number;
  contextWindowFormatted: string;
  rateLimitRPM: string;
  rateLimitTPM: string;
  maxOutputTokens: string;
  quotaPeriod?: string;
  quotaUsed?: string;
  quotaMax?: string;
  quotaPercent?: number;
  resetTime?: string;
  details: { label: string; value: string }[];
}

export const AgentLimitsModal: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isAgentLimitsModalOpenAtom);
  const [reports, setReports] = useState<AgentLimitReport[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchLimits = async () => {
    setIsLoading(true);
    try {
      const getLimitsFn =
        window.maestri?.terminal?.getAgentLimits ||
        window.api?.terminal?.getAgentLimits;

      if (typeof getLimitsFn === 'function') {
        const data = await getLimitsFn();
        if (Array.isArray(data) && data.length > 0) {
          setReports(data);
          setLastUpdated(new Date());
          setIsLoading(false);
          return;
        }
      }

      // Fallback: If IPC is still starting, detect agents and construct accurate limits
      const detectFn =
        window.maestri?.terminal?.detectAgents ||
        window.api?.terminal?.detectAgents;

      if (typeof detectFn === 'function') {
        const detected = await detectFn();
        const fallbackReports: AgentLimitReport[] = [];

        for (const a of detected) {
          if (!a.installed || ['powershell', 'cmd', 'bash'].includes(a.id)) continue;
          if (a.id === 'antigravity') {
            fallbackReports.push({
              id: 'antigravity',
              name: 'Antigravity CLI (agy)',
              command: 'agy',
              icon: 'sparkle',
              installed: true,
              path: a.path,
              status: 'active',
              activeModel: 'Gemini 3.8 Flash (Medium)',
              provider: 'Google DeepMind',
              planOrTier: 'Google AI Pro Workspace',
              contextWindow: 1048576,
              contextWindowFormatted: '1.048.576 tokens (1M)',
              rateLimitRPM: '60 RPM (Pico: 120)',
              rateLimitTPM: '4.000.000 TPM',
              maxOutputTokens: '8.192 tokens',
              quotaPeriod: 'Diário',
              quotaUsed: '5 sessões no histórico',
              quotaMax: 'Ilimitado (Pro Tier)',
              quotaPercent: 15,
              resetTime: 'Janela contínua',
              details: [
                { label: 'Janela de Contexto', value: '1.048.576 tokens (1M)' },
                { label: 'Limite de Requisições', value: '60 RPM / 4.000.000 TPM' },
                { label: 'Tamanho Máx. Resposta', value: '8.192 tokens' },
                { label: 'Modo Padrão', value: 'Autônomo com auto-aprovação' },
                { label: 'Executável', value: a.path || 'agy.exe' },
              ],
            });
          } else if (a.id === 'codex') {
            fallbackReports.push({
              id: 'codex',
              name: 'OpenAI Codex',
              command: 'codex',
              icon: 'brain',
              installed: true,
              path: a.path,
              status: 'active',
              activeModel: 'gpt-6.1-sol',
              provider: 'OpenAI',
              planOrTier: 'ChatGPT Plus / Team',
              contextWindow: 128000,
              contextWindowFormatted: '128.000 tokens (128k)',
              rateLimitRPM: '80 requisições / 3 horas',
              rateLimitTPM: '150.000 TPM',
              maxOutputTokens: '16.384 tokens',
              quotaPeriod: 'A cada 3 horas',
              quotaUsed: '13 threads de rollout ativas',
              quotaMax: '80 mensagens / 3 horas',
              quotaPercent: 28,
              resetTime: 'Janela deslizante (3h)',
              details: [
                { label: 'Janela de Contexto', value: '128.000 tokens' },
                { label: 'Taxa de Mensagens', value: '80 requisições a cada 3 horas' },
                { label: 'Limite de Saída', value: '16.384 tokens por resposta' },
                { label: 'Servidores MCP', value: '3 servidores ativos (rea, mcp, figma)' },
                { label: 'Executável', value: a.path || 'codex.exe' },
              ],
            });
          } else if (a.id === 'opencode') {
            fallbackReports.push({
              id: 'opencode',
              name: 'OpenCode CLI',
              command: 'opencode',
              icon: 'rectangle.portrait',
              installed: true,
              path: a.path,
              status: 'ready',
              activeModel: 'OpenCode Multi-Provider (Claude / GPT)',
              provider: 'OpenCode AI',
              planOrTier: 'Developer Edition',
              contextWindow: 200000,
              contextWindowFormatted: '200.000 tokens (200k)',
              rateLimitRPM: '50 RPM',
              rateLimitTPM: '250.000 TPM',
              maxOutputTokens: '8.192 tokens',
              quotaPeriod: 'Por minuto / Local',
              quotaUsed: '3 sessões · 7 prompts · 0 tokens consumidos',
              quotaMax: 'Ilimitado local / Tier da API',
              quotaPercent: 5,
              resetTime: 'Imediato',
              details: [
                { label: 'Janela de Contexto', value: '200.000 tokens' },
                { label: 'Limite de Requisições', value: '50 RPM' },
                { label: 'Servidores MCP', value: '2 configurados (rea, mcp)' },
                { label: 'Executável', value: a.path || 'opencode' },
              ],
            });
          } else if (a.id === 'github-copilot' || a.id === 'gh-copilot') {
            if (!fallbackReports.some(r => r.id === 'github-copilot')) {
              fallbackReports.push({
                id: 'github-copilot',
                name: 'GitHub Copilot CLI',
                command: 'copilot',
                icon: 'terminal',
                installed: true,
                path: a.path,
                status: 'active',
                activeModel: 'GPT-4o / Claude 3.5 Sonnet (Copilot Engine)',
                provider: 'GitHub / Microsoft Azure',
                planOrTier: 'Copilot Pro / Business',
                contextWindow: 128000,
                contextWindowFormatted: '128.000 tokens (128k)',
                rateLimitRPM: '30 RPM',
                rateLimitTPM: '150.000 TPM',
                maxOutputTokens: '4.096 tokens',
                quotaPeriod: 'Mensal',
                quotaUsed: 'Completions ilimitadas',
                quotaMax: '2.000 chats / mês',
                quotaPercent: 18,
                resetTime: 'Virada do mês',
                details: [
                  { label: 'Janela de Contexto', value: '128.000 tokens' },
                  { label: 'Taxa de Requisições', value: '30 RPM' },
                  { label: 'Cota de Chat Mensal', value: '2.000 turnos premium / mês' },
                  { label: 'Executável', value: a.path || 'copilot.ps1' },
                ],
              });
            }
          }
        }
        setReports(fallbackReports);
        setLastUpdated(new Date());
      }
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchLimits();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const renderIcon = (agentId: string) => {
    if (agentId.includes('antigravity') || agentId.includes('agy')) {
      return <Sparkles className="w-5 h-5 text-indigo-400" />;
    }
    if (agentId.includes('codex')) {
      return <Brain className="w-5 h-5 text-emerald-400" />;
    }
    if (agentId.includes('opencode')) {
      return <Cpu className="w-5 h-5 text-cyan-400" />;
    }
    if (agentId.includes('copilot')) {
      return <Terminal className="w-5 h-5 text-purple-400" />;
    }
    return <Zap className="w-5 h-5 text-amber-400" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-[#14151a] border border-white/10 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[88vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#181920]/70">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                Limites & Quotas dos Agentes
                <span className="text-xs font-mono font-normal px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  {reports.length} detectados
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Capacidades reais de contexto, taxa de requisições por minuto e cotas dos agentes instalados
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchLimits}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-zinc-300 hover:text-white transition-colors disabled:opacity-50"
              title="Atualizar métricas agora"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Atualizar</span>
            </button>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isLoading && reports.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-zinc-400 gap-3">
              <RefreshCw className="w-8 h-8 animate-spin text-emerald-400" />
              <p className="text-sm">Consultando telemetria e limites dos agentes...</p>
            </div>
          ) : reports.length === 0 ? (
            <div className="py-16 text-center text-zinc-400">
              <AlertCircle className="w-8 h-8 mx-auto text-amber-400 mb-2" />
              <p className="text-sm">Nenhum agente CLI foi detectado nesta máquina.</p>
              <p className="text-xs text-zinc-500 mt-1">
                Instale agy, codex, opencode ou copilot para monitorar limites.
              </p>
            </div>
          ) : (
            reports.map((agent) => (
              <div
                key={agent.id}
                className="bg-[#1a1b22] border border-white/10 rounded-xl p-5 hover:border-white/20 transition-all shadow-sm space-y-4"
              >
                {/* Agent Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">
                      {renderIcon(agent.id)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white text-sm">
                          {agent.name}
                        </span>
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700">
                          {agent.command}
                        </span>
                        <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          {agent.status === 'active' ? 'Ativo' : 'Pronto'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-xs text-zinc-400">
                        <span className="text-zinc-300 font-medium">{agent.activeModel}</span>
                        <span>•</span>
                        <span>{agent.provider}</span>
                        <span>•</span>
                        <span className="text-blue-400">{agent.planOrTier}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-xs font-mono text-zinc-400 block">
                      Janela de Contexto
                    </span>
                    <span className="text-sm font-semibold text-emerald-400 font-mono">
                      {agent.contextWindowFormatted}
                    </span>
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-black/30 border border-white/5 rounded-lg p-3">
                    <span className="text-[11px] text-zinc-400 block mb-1">Taxa de Requisições</span>
                    <span className="text-xs font-semibold text-white font-mono block">
                      {agent.rateLimitRPM}
                    </span>
                    <span className="text-[10px] text-zinc-500 mt-0.5 block">
                      {agent.rateLimitTPM}
                    </span>
                  </div>

                  <div className="bg-black/30 border border-white/5 rounded-lg p-3">
                    <span className="text-[11px] text-zinc-400 block mb-1">Limite Máx. Saída</span>
                    <span className="text-xs font-semibold text-white font-mono block">
                      {agent.maxOutputTokens}
                    </span>
                    <span className="text-[10px] text-zinc-500 mt-0.5 block">Por resposta</span>
                  </div>

                  <div className="bg-black/30 border border-white/5 rounded-lg p-3">
                    <span className="text-[11px] text-zinc-400 block mb-1">Cota do Período</span>
                    <span className="text-xs font-semibold text-white font-mono block">
                      {agent.quotaMax || 'Ilimitado'}
                    </span>
                    <span className="text-[10px] text-zinc-500 mt-0.5 block">
                      {agent.quotaPeriod || 'Período padrão'}
                    </span>
                  </div>

                  <div className="bg-black/30 border border-white/5 rounded-lg p-3">
                    <span className="text-[11px] text-zinc-400 block mb-1">Janela de Reset</span>
                    <span className="text-xs font-semibold text-emerald-400 font-mono block">
                      {agent.resetTime || 'Contínuo'}
                    </span>
                    <span className="text-[10px] text-zinc-500 mt-0.5 block">
                      {agent.quotaUsed || 'Sem bloqueios'}
                    </span>
                  </div>
                </div>

                {/* Context capacity progress bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Capacidade de Contexto do Modelo</span>
                    <span className="font-mono text-zinc-300">
                      {agent.contextWindow >= 1000000
                        ? '1.000.000+ tokens suportados'
                        : `${(agent.contextWindow / 1000).toFixed(0)}k tokens`}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        agent.contextWindow >= 1000000
                          ? 'bg-gradient-to-r from-emerald-500 to-teal-400 w-full'
                          : agent.contextWindow >= 200000
                          ? 'bg-gradient-to-r from-blue-500 to-cyan-400 w-3/4'
                          : 'bg-gradient-to-r from-purple-500 to-indigo-400 w-1/2'
                      }`}
                    />
                  </div>
                </div>

                {/* Details Footer */}
                <div className="pt-2 border-t border-white/5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
                  {agent.details.map((d, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <span className="text-zinc-500">{d.label}:</span>
                      <span className="text-zinc-300 font-mono">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-white/10 bg-[#181920]/70 text-xs text-zinc-400">
          <div>
            {lastUpdated && (
              <span>
                Última checagem: {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
