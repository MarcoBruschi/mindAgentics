import React, { useState, useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { isAgentLimitsModalOpenAtom } from '@/atoms/ui';
import {
  RefreshCw,
  Sparkles,
  Brain,
  Cpu,
  Terminal,
  ShieldCheck,
  ArrowLeft,
  Settings,
  Bot,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { UsageRing } from '../common/UsageRing';

export interface AgentUsageWindow {
  id: string;
  title: string;
  usedFraction: number;
  resetsAt: string | number | null;
  durationMinutes?: number;
  formattedReset?: string;
}

export interface AgentUsageItem {
  id: string;
  name: string;
  subtitle: string;
  colorHex: string;
  primaryFraction: number; // 0.0 to 1.0
  secondaryFraction?: number | null; // 0.0 to 1.0
  percent: number;
  secondaryPercent?: number;
  label: string;
  secondaryLabel?: string;
  resetText: string;
  secondaryResetText?: string;
  command?: string;
  path?: string;
  installed?: boolean;
  windows?: AgentUsageWindow[];
  details?: Array<{ label: string; value: string }>;
}

const STORAGE_KEY = 'mindagentics:agent-visibility-preferences';

const getInitialPreferences = (): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {}
  return {
    antigravity: true,
    codex: true,
    claude: true,
    opencode: true,
    'github-copilot': true,
    ollama: true
  };
};

export const AgentLimitsModal: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isAgentLimitsModalOpenAtom);
  const [viewMode, setViewMode] = useState<'usage' | 'settings'>('usage');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [allAgents, setAllAgents] = useState<AgentUsageItem[]>([]);
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const [visibilityPrefs, setVisibilityPrefs] = useState<Record<string, boolean>>(() => getInitialPreferences());
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    if (!isOpen) {
      setViewMode('usage');
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-agent-limits-trigger="true"]')) return;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, setIsOpen]);

  const toggleAgentVisibility = (agentId: string) => {
    setVisibilityPrefs((prev) => {
      const current = prev[agentId] !== false;
      const next = { ...prev, [agentId]: !current };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const toggleDetails = (agentId: string) => {
    setExpandedDetails((prev) => ({ ...prev, [agentId]: !prev[agentId] }));
  };

  const loadUsage = async () => {
    setIsRefreshing(true);
    try {
      const getLimitsFn =
        window.mindAgentics?.terminal?.getAgentLimits ||
        window.maestri?.terminal?.getAgentLimits ||
        window.api?.terminal?.getAgentLimits;

      let detectedReports: any[] = [];
      if (typeof getLimitsFn === 'function') {
        const res = await getLimitsFn();
        if (Array.isArray(res) && res.length > 0) {
          detectedReports = res;
        }
      }

      if (detectedReports.length === 0 && (window.mindAgentics?.terminal?.detectAgents || window.maestri?.terminal?.detectAgents)) {
        const detectFn = window.mindAgentics?.terminal?.detectAgents || window.maestri?.terminal?.detectAgents;
        const detected = await detectFn?.();
        if (Array.isArray(detected)) {
          detectedReports = detected.filter((a) => a.installed && !['powershell', 'cmd', 'bash'].includes(a.id));
        }
      }

      const installedOnly = detectedReports.filter((r) => r.installed);
      const items: AgentUsageItem[] = [];

      for (const rep of installedOnly) {
        const primaryFraction = rep.primaryUsedFraction ?? (rep.quotaPercent != null ? rep.quotaPercent / 100 : 0.05);
        const secondaryFraction = rep.secondaryUsedFraction;
        const percent = rep.quotaPercent ?? Math.round(primaryFraction * 100);
        const secondaryPercent = rep.secondaryPercent ?? (secondaryFraction != null ? Math.round(secondaryFraction * 100) : undefined);

        if (rep.id === 'codex') {
          items.push({
            id: 'codex',
            name: rep.name || 'OpenAI Codex (codex)',
            subtitle: `${rep.planOrTier || 'ChatGPT Plus'} · ${rep.activeModel || 'gpt-6.1-sol'}`,
            colorHex: rep.colorHex || '#10B981',
            primaryFraction,
            secondaryFraction,
            percent,
            secondaryPercent,
            label: rep.primaryLabel || 'Sessão (5h)',
            secondaryLabel: rep.secondaryLabel || 'Semanal (7d)',
            resetText: rep.primaryResetText || 'Janela de 5h',
            secondaryResetText: rep.secondaryResetText || 'Janela semanal de 7d',
            command: 'codex',
            path: rep.path,
            installed: true,
            windows: rep.windows,
            details: rep.details
          });
        } else if (rep.id === 'antigravity') {
          items.push({
            id: 'antigravity',
            name: rep.name || 'Antigravity CLI (agy)',
            subtitle: `${rep.activeModel || 'Gemini 3.8 Flash (Medium)'} · ${rep.planOrTier || 'Google AI Workspace'}`,
            colorHex: rep.colorHex || '#3B82F6',
            primaryFraction,
            secondaryFraction,
            percent,
            secondaryPercent,
            label: rep.primaryLabel || 'Sessão (5h)',
            secondaryLabel: rep.secondaryLabel || 'Semanal (7d)',
            resetText: rep.primaryResetText || 'Janela contínua (5h)',
            secondaryResetText: rep.secondaryResetText || 'Renovação semanal',
            command: 'agy',
            path: rep.path,
            installed: true,
            windows: rep.windows,
            details: rep.details
          });
        } else if (rep.id === 'claude') {
          items.push({
            id: 'claude',
            name: rep.name || 'Claude Code (claude)',
            subtitle: `${rep.activeModel || 'Claude 3.7 Sonnet'} · ${rep.planOrTier || 'Anthropic'}`,
            colorHex: rep.colorHex || '#A855F7',
            primaryFraction,
            secondaryFraction,
            percent,
            secondaryPercent,
            label: rep.primaryLabel || 'Taxa por Minuto',
            secondaryLabel: rep.secondaryLabel,
            resetText: rep.primaryResetText || 'Janela contínua de 1 min',
            secondaryResetText: rep.secondaryResetText,
            command: 'claude',
            path: rep.path,
            installed: true,
            windows: rep.windows,
            details: rep.details
          });
        } else if (rep.id === 'opencode') {
          items.push({
            id: 'opencode',
            name: rep.name || 'OpenCode CLI (opencode)',
            subtitle: `${rep.activeModel || 'Multi-Provider'} · ${rep.planOrTier || 'Developer'}`,
            colorHex: rep.colorHex || '#06B6D4',
            primaryFraction,
            secondaryFraction,
            percent,
            secondaryPercent,
            label: rep.primaryLabel || 'Taxa por Minuto',
            secondaryLabel: rep.secondaryLabel,
            resetText: rep.primaryResetText || 'Janela contínua de 1 min',
            secondaryResetText: rep.secondaryResetText,
            command: 'opencode',
            path: rep.path,
            installed: true,
            windows: rep.windows,
            details: rep.details
          });
        } else if (rep.id === 'github-copilot' || rep.id === 'gh-copilot' || rep.id === 'copilot') {
          if (!items.some((i) => i.id === 'github-copilot')) {
            items.push({
              id: 'github-copilot',
              name: rep.name || 'GitHub Copilot (copilot)',
              subtitle: `${rep.planOrTier || 'Copilot Pro'} · Completions ilimitadas`,
              colorHex: rep.colorHex || '#6366F1',
              primaryFraction,
              secondaryFraction,
              percent,
              secondaryPercent,
              label: rep.primaryLabel || 'Cota Mensal',
              secondaryLabel: rep.secondaryLabel,
              resetText: rep.primaryResetText || 'Virada do mês',
              secondaryResetText: rep.secondaryResetText,
              command: 'copilot',
              path: rep.path,
              installed: true,
              windows: rep.windows,
              details: rep.details
            });
          }
        } else if (rep.id === 'ollama') {
          items.push({
            id: 'ollama',
            name: rep.name || 'Ollama (ollama)',
            subtitle: `${rep.activeModel || 'Modelos Locais'} · 100% Offline`,
            colorHex: rep.colorHex || '#F59E0B',
            primaryFraction: 0,
            percent: 0,
            label: 'Capacidade Local',
            resetText: 'Ilimitado · Sem limites de taxa de nuvem',
            command: 'ollama',
            path: rep.path,
            installed: true,
            windows: rep.windows,
            details: rep.details
          });
        }
      }

      setAllAgents(items);
    } catch {
      // fallback
    } finally {
      setTimeout(() => setIsRefreshing(false), 300);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadUsage();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const visibleAgents = allAgents.filter((agent) => visibilityPrefs[agent.id] !== false);

  const getAgentIcon = (id: string, colorHex: string) => {
    switch (id) {
      case 'codex':
        return <Brain className="w-3.5 h-3.5 text-emerald-400" />;
      case 'antigravity':
        return <Sparkles className="w-3.5 h-3.5 text-blue-400" />;
      case 'claude':
        return <Bot className="w-3.5 h-3.5 text-purple-400" />;
      case 'opencode':
        return <Terminal className="w-3.5 h-3.5 text-cyan-400" />;
      case 'github-copilot':
      case 'gh-copilot':
        return <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />;
      case 'ollama':
        return <Cpu className="w-3.5 h-3.5 text-amber-400" />;
      default:
        return <Terminal className="w-3.5 h-3.5 text-zinc-300" />;
    }
  };

  return (
    <div
      ref={popoverRef}
      className={`fixed bottom-16 right-6 z-50 ${
        viewMode === 'settings' ? 'w-[360px]' : 'w-[350px]'
      } max-h-[85vh] flex flex-col bg-[#191a20]/95 border border-white/10 rounded-2xl shadow-2xl p-3.5 text-white select-none backdrop-blur-md animate-fade-in transition-all duration-200`}
      style={{ animationDuration: '150ms' }}
    >
      {viewMode === 'usage' ? (
        <>
          {/* Main Header */}
          <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-white/5 shrink-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-semibold text-zinc-200 tracking-wide">
                Uso e Limites dos Agentes
              </h3>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewMode('settings')}
                className="p-1 text-zinc-400 hover:text-white rounded-md hover:bg-white/5 transition-colors cursor-pointer"
                title="Ajustes de visibilidade dos agentes"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={loadUsage}
                disabled={isRefreshing}
                className="p-1 text-zinc-400 hover:text-white rounded-md hover:bg-white/5 transition-colors disabled:opacity-50 cursor-pointer"
                title="Atualizar limites em tempo real"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
              </button>
            </div>
          </div>

          {/* Agents List - Concentric Activity Rings + Real Usage Probes */}
          <div className="flex-1 overflow-y-auto space-y-2.5 pr-0.5 scrollbar-thin">
            {allAgents.length === 0 ? (
              <div className="text-center py-6 text-xs text-zinc-500">
                Nenhum agente CLI detectado na máquina.
              </div>
            ) : visibleAgents.length === 0 ? (
              <div className="text-center py-6 space-y-2">
                <p className="text-xs text-zinc-400">
                  Nenhum agente ativado para exibição.
                </p>
                <button
                  onClick={() => setViewMode('settings')}
                  className="px-3 py-1 text-xs bg-blue-600/30 text-blue-300 border border-blue-500/30 rounded-lg hover:bg-blue-600/40 transition-colors"
                >
                  Abrir Ajustes
                </button>
              </div>
            ) : (
              visibleAgents.map((agent) => {
                const isExpanded = !!expandedDetails[agent.id];

                return (
                  <div
                    key={agent.id}
                    className="p-3 bg-[#14151b] hover:bg-[#161820] border border-white/5 rounded-xl space-y-2.5 transition-colors"
                  >
                    {/* Header: Concentric Activity Ring + Agent Info */}
                    <div className="flex items-center gap-3">
                      {/* Interactive Apple-style Activity Ring */}
                      <UsageRing
                        primaryFraction={agent.primaryFraction}
                        secondaryFraction={agent.secondaryFraction}
                        colorHex={agent.colorHex}
                        size={40}
                        strokeWidth={3.4}
                        showDot={true}
                        title={`${agent.name}: ${agent.percent}% (Sessão) ${agent.secondaryPercent != null ? `· ${agent.secondaryPercent}% (Semanal)` : ''}`}
                      />

                      <div className="flex flex-col min-w-0 flex-1 leading-tight">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold text-xs text-white truncate">
                            {agent.name}
                          </span>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-mono font-medium"
                            style={{
                              backgroundColor: `${agent.colorHex}18`,
                              color: agent.colorHex,
                              border: `1px solid ${agent.colorHex}30`
                            }}
                          >
                            {agent.percent}%
                          </span>
                        </div>
                        <span className="text-[10px] text-zinc-400 truncate mt-0.5">
                          {agent.subtitle}
                        </span>
                      </div>
                    </div>

                    {/* Concentric / Dual Windows Breakdown */}
                    <div className="space-y-1.5 pt-1 border-t border-white/5">
                      {/* Window 1 (Short-term / Primary) */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-zinc-400 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: agent.colorHex }} />
                            {agent.label}
                          </span>
                          <span className="text-zinc-300 font-mono">{agent.percent}%</span>
                        </div>
                        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${Math.max(3, agent.percent)}%`,
                              backgroundColor: agent.colorHex
                            }}
                          />
                        </div>
                        <div className="text-[9.5px] text-zinc-500 font-mono truncate">
                          {agent.resetText}
                        </div>
                      </div>

                      {/* Window 2 (Long-term / Secondary if available) */}
                      {agent.secondaryFraction !== undefined && agent.secondaryFraction !== null && (
                        <div className="space-y-1 pt-1 border-t border-white/5">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-zinc-400 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full opacity-60" style={{ backgroundColor: agent.colorHex }} />
                              {agent.secondaryLabel || 'Cota Semanal'}
                            </span>
                            <span className="text-zinc-300 font-mono">{agent.secondaryPercent}%</span>
                          </div>
                          <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500 opacity-80"
                              style={{
                                width: `${Math.max(3, agent.secondaryPercent || 0)}%`,
                                backgroundColor: agent.colorHex
                              }}
                            />
                          </div>
                          <div className="text-[9.5px] text-zinc-500 font-mono truncate">
                            {agent.secondaryResetText || 'Renovação semanal'}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Expandable Technical Details */}
                    {agent.details && agent.details.length > 0 && (
                      <div className="pt-1">
                        <button
                          onClick={() => toggleDetails(agent.id)}
                          className="flex items-center justify-between w-full text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors py-0.5 cursor-pointer"
                        >
                          <span>Detalhes do Provedor</span>
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>

                        {isExpanded && (
                          <div className="mt-1.5 p-2 bg-black/30 rounded-lg space-y-1 text-[9.5px] font-mono border border-white/5">
                            {agent.details.map((d, idx) => (
                              <div key={idx} className="flex items-center justify-between gap-2">
                                <span className="text-zinc-500 truncate">{d.label}:</span>
                                <span className="text-zinc-300 truncate font-medium text-right">{d.value}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="pt-2 mt-1 border-t border-white/5 flex items-center justify-between text-xs shrink-0">
            <span className="text-[10px] text-zinc-500">
              {visibleAgents.length} exibido(s) de {allAgents.length}
            </span>
            <button
              onClick={() => setViewMode('settings')}
              className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors font-medium cursor-pointer"
            >
              Ajustes...
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Settings Header */}
          <div className="pb-2.5 mb-2 border-b border-white/5 shrink-0 space-y-1">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setViewMode('usage')}
                className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white transition-colors px-1 py-0.5 rounded hover:bg-white/5 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Voltar</span>
              </button>
              <span className="text-[10px] font-mono text-zinc-500">
                {allAgents.length} encontrados
              </span>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-zinc-100">
                Agentes Encontrados no Computador
              </h3>
              <p className="text-[10px] text-zinc-400">
                Defina quais agentes instalados mostrar no monitor de uso.
              </p>
            </div>
          </div>

          {/* Settings List of Agents with ON/OFF switch buttons */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-0.5 scrollbar-thin">
            {allAgents.length === 0 ? (
              <div className="text-center py-6 text-xs text-zinc-500">
                Nenhum agente CLI detectado no computador.
              </div>
            ) : (
              allAgents.map((agent) => {
                const isTurnedOn = visibilityPrefs[agent.id] !== false;

                return (
                  <div
                    key={agent.id}
                    className="p-2.5 bg-[#14151b] border border-white/5 rounded-xl flex items-center justify-between gap-3 transition-colors hover:border-white/10"
                  >
                    {/* Agent Info */}
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                        {getAgentIcon(agent.id, agent.colorHex)}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="font-medium text-xs text-zinc-200 truncate">
                          {agent.name}
                        </span>
                        <span className="text-[10px] text-zinc-400 truncate font-mono">
                          {agent.path ? (agent.path.length > 28 ? `...${agent.path.slice(-25)}` : agent.path) : (agent.command || 'Instalado')}
                        </span>
                      </div>
                    </div>

                    {/* Prominent ON/OFF Toggle Switch Button */}
                    <button
                      onClick={() => toggleAgentVisibility(agent.id)}
                      className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all shrink-0 cursor-pointer ${
                        isTurnedOn
                          ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-400 hover:bg-emerald-500/25'
                          : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300'
                      }`}
                      title={isTurnedOn ? 'Mostrar no uso dos agentes (Clique para desligar)' : 'Não mostrar no uso dos agentes (Clique para ligar)'}
                    >
                      {/* Pill indicator */}
                      <span
                        className={`w-7 h-4 flex items-center rounded-full p-0.5 transition-colors ${
                          isTurnedOn ? 'bg-emerald-500' : 'bg-zinc-600'
                        }`}
                      >
                        <span
                          className={`w-3 h-3 rounded-full bg-white transition-transform ${
                            isTurnedOn ? 'translate-x-3' : 'translate-x-0'
                          }`}
                        />
                      </span>

                      <div className="flex flex-col items-start text-left leading-tight">
                        <span className="text-[11px] font-semibold">
                          {isTurnedOn ? 'Ligado' : 'Desligado'}
                        </span>
                        <span className="text-[8.5px] opacity-80 whitespace-nowrap">
                          {isTurnedOn ? 'Mostrar no uso' : 'Não mostrar'}
                        </span>
                      </div>
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Settings Footer */}
          <div className="pt-2.5 mt-2 border-t border-white/5 flex items-center justify-between shrink-0">
            <span className="text-[10px] text-zinc-500">
              Preferências salvas automaticamente
            </span>
            <button
              onClick={() => setViewMode('usage')}
              className="px-3 py-1 bg-white/10 hover:bg-white/15 text-zinc-200 text-xs font-medium rounded-lg transition-colors cursor-pointer"
            >
              Concluir
            </button>
          </div>
        </>
      )}
    </div>
  );
};
