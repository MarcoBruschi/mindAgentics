import React, { useState, useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { isAgentLimitsModalOpenAtom } from '@/atoms/ui';
import {
  RefreshCw,
  Settings,
  ArrowLeft,
  Sparkles,
  Brain,
  Bot,
  Terminal,
  ShieldCheck,
  Cpu,
} from 'lucide-react';

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
    ollama: true,
  };
};

export const AgentLimitsModal: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isAgentLimitsModalOpenAtom);
  const [viewMode, setViewMode] = useState<'usage' | 'settings'>('usage');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [allAgents, setAllAgents] = useState<AgentUsageItem[]>([]);
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

  const loadUsage = async () => {
    setIsRefreshing(true);
    try {
      const getLimitsFn =
        window.mindAgentics?.terminal?.getAgentLimits ||
        (window.mindAgentics?.terminal?.getAgentLimits || window.api?.terminal?.getAgentLimits) ||
        window.api?.terminal?.getAgentLimits;

      let detectedReports: any[] = [];
      if (typeof getLimitsFn === 'function') {
        const res = await getLimitsFn();
        if (Array.isArray(res) && res.length > 0) {
          detectedReports = res;
        }
      }

      if (detectedReports.length === 0 && (window.mindAgentics?.terminal?.detectAgents || window.api?.terminal?.detectAgents)) {
        const detectFn = window.mindAgentics?.terminal?.detectAgents || window.api?.terminal?.detectAgents;
        const detected = await detectFn?.();
        if (Array.isArray(detected)) {
          detectedReports = detected.filter((a) => a.installed && !['powershell', 'cmd', 'bash'].includes(a.id));
        }
      }

      const installedOnly = detectedReports.filter((r) => r.installed);
      const items: AgentUsageItem[] = [];

      for (const rep of installedOnly) {
        const primaryFraction = rep.primaryUsedFraction ?? (rep.quotaPercent != null ? rep.quotaPercent / 100 : 0.15);
        const secondaryFraction = rep.secondaryUsedFraction;
        const percent = rep.quotaPercent ?? Math.round(primaryFraction * 100);
        const secondaryPercent = rep.secondaryPercent ?? (secondaryFraction != null ? Math.round(secondaryFraction * 100) : 0);

        if (rep.id === 'codex') {
          items.push({
            id: 'codex',
            name: rep.name || 'OpenAI Codex',
            subtitle: `${rep.planOrTier || 'ChatGPT Plus'} · ${rep.activeModel || 'gpt-6.1-sol'}`,
            colorHex: '#8B93FF',
            primaryFraction,
            secondaryFraction,
            percent,
            secondaryPercent,
            label: rep.primaryLabel || 'Sessão (5h)',
            secondaryLabel: rep.secondaryLabel || 'Semanal (7d)',
            resetText: rep.primaryResetText || 'Janela de 5h',
            secondaryResetText: rep.secondaryResetText || 'Janela de 7d',
            command: 'codex',
            path: rep.path,
            installed: true,
            windows: rep.windows,
            details: rep.details,
          });
        } else if (rep.id === 'antigravity') {
          items.push({
            id: 'antigravity',
            name: rep.name || 'Antigravity CLI',
            subtitle: `${rep.activeModel || 'Gemini 3.8 Flash'} · ${rep.planOrTier || 'Google AI'}`,
            colorHex: '#8B93FF',
            primaryFraction,
            secondaryFraction,
            percent,
            secondaryPercent,
            label: rep.primaryLabel || 'Sessão (5h)',
            secondaryLabel: rep.secondaryLabel || 'Semanal (7d)',
            resetText: rep.primaryResetText || 'Janela de 5h',
            secondaryResetText: rep.secondaryResetText || 'Renovação semanal',
            command: 'agy',
            path: rep.path,
            installed: true,
            windows: rep.windows,
            details: rep.details,
          });
        } else if (rep.id === 'claude') {
          items.push({
            id: 'claude',
            name: rep.name || 'Claude Code',
            subtitle: `${rep.activeModel || 'Claude 3.7 Sonnet'} · ${rep.planOrTier || 'Anthropic'}`,
            colorHex: '#8B93FF',
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
            details: rep.details,
          });
        } else if (rep.id === 'opencode') {
          items.push({
            id: 'opencode',
            name: rep.name || 'OpenCode CLI',
            subtitle: `${rep.activeModel || 'Multi-Provider'} · ${rep.planOrTier || 'Developer'}`,
            colorHex: '#8B93FF',
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
            details: rep.details,
          });
        } else if (rep.id === 'github-copilot' || rep.id === 'gh-copilot' || rep.id === 'copilot') {
          if (!items.some((i) => i.id === 'github-copilot')) {
            items.push({
              id: 'github-copilot',
              name: rep.name || 'GitHub Copilot',
              subtitle: `${rep.planOrTier || 'Copilot Pro'} · Completions`,
              colorHex: '#8B93FF',
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
              details: rep.details,
            });
          }
        } else if (rep.id === 'ollama') {
          items.push({
            id: 'ollama',
            name: rep.name || 'Ollama',
            subtitle: `${rep.activeModel || 'Modelos Locais'} · 100% Offline`,
            colorHex: '#8B93FF',
            primaryFraction: 0,
            percent: 0,
            label: 'Capacidade Local',
            resetText: 'Ilimitado',
            command: 'ollama',
            path: rep.path,
            installed: true,
            windows: rep.windows,
            details: rep.details,
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

  const getAgentIcon = (id: string) => {
    switch (id) {
      case 'codex':
        return <Brain className="w-3.5 h-3.5 text-[#8B93FF]" />;
      case 'antigravity':
        return <Sparkles className="w-3.5 h-3.5 text-[#8B93FF]" />;
      case 'claude':
        return <Bot className="w-3.5 h-3.5 text-[#8B93FF]" />;
      case 'opencode':
        return <Terminal className="w-3.5 h-3.5 text-[#8B93FF]" />;
      case 'github-copilot':
      case 'gh-copilot':
        return <ShieldCheck className="w-3.5 h-3.5 text-[#8B93FF]" />;
      case 'ollama':
        return <Cpu className="w-3.5 h-3.5 text-[#8B93FF]" />;
      default:
        return <Terminal className="w-3.5 h-3.5 text-[#8B93FF]" />;
    }
  };

  return (
    <div
      ref={popoverRef}
      className="fixed bottom-16 right-6 z-50 w-[380px] max-h-[700px] flex flex-col bg-[#14161A] border border-[#23262C] rounded-2xl shadow-2xl p-4 text-[#E7E8EA] select-none backdrop-blur-md animate-in fade-in duration-150"
    >
      {viewMode === 'usage' ? (
        <>
          {/* Header */}
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#23262C] shrink-0">
            <div>
              <h3 className="text-sm font-semibold text-[#E7E8EA] tracking-tight">
                Uso dos Agentes
              </h3>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={loadUsage}
                disabled={isRefreshing}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20] transition-colors disabled:opacity-50 cursor-pointer"
                title="Atualizar limites"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-[#8B93FF]' : ''}`} />
              </button>
              <button
                onClick={() => setViewMode('settings')}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20] transition-colors cursor-pointer"
                title="Ajustes de visibilidade"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Cards List */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-0.5">
            {allAgents.length === 0 ? (
              <div className="text-center py-8 text-xs text-[#8A8F98]">
                Nenhum agente CLI detectado no computador.
              </div>
            ) : visibleAgents.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <p className="text-xs text-[#8A8F98]">
                  Nenhum agente selecionado para exibição.
                </p>
                <button
                  onClick={() => setViewMode('settings')}
                  className="px-3 py-1.5 text-xs bg-[#181B20] text-[#8B93FF] border border-[#23262C] rounded-xl hover:bg-[#23262C] transition-colors"
                >
                  Abrir Ajustes
                </button>
              </div>
            ) : (
              visibleAgents.map((agent) => {
                return (
                  <div
                    key={agent.id}
                    className="p-3.5 bg-[#181B20] border border-[#23262C] rounded-xl space-y-3 transition-colors"
                  >
                    {/* Top row: Name & Subtitle on left, 22px Percentage on right */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="font-semibold text-xs text-[#E7E8EA] truncate block">
                          {agent.name}
                        </span>
                        <span className="text-[11px] text-[#8A8F98] truncate block mt-0.5">
                          {agent.subtitle}
                        </span>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="text-[22px] font-bold text-[#E7E8EA] tracking-tight leading-none block">
                          {agent.percent}%
                        </span>
                      </div>
                    </div>

                    {/* Linear Progress Bars (4px high) */}
                    <div className="space-y-2 pt-1 border-t border-[#23262C]/60">
                      {/* Bar 1: Primary Usage */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-[#8A8F98]">
                          <span>{agent.label}</span>
                          <span className="text-[10px] font-mono">{agent.resetText}</span>
                        </div>
                        <div className="w-full h-1 bg-[#14161A] rounded-full overflow-hidden border border-[#23262C]">
                          <div
                            className="h-full rounded-full transition-all duration-500 bg-[#8B93FF]"
                            style={{
                              width: `${Math.max(2, Math.min(100, agent.percent))}%`,
                            }}
                          />
                        </div>
                      </div>

                      {/* Bar 2: Secondary / Weekly Quota (Empty 0%) */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-[#8A8F98]">
                          <span>{agent.secondaryLabel || 'Cota Semanal'}</span>
                          <span className="text-[10px] font-mono">0%</span>
                        </div>
                        <div className="w-full h-1 bg-[#14161A] rounded-full overflow-hidden border border-[#23262C]">
                          <div
                            className="h-full rounded-full bg-[#8B93FF]/30 transition-all duration-500"
                            style={{
                              width: '0%',
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="pt-3 mt-2 border-t border-[#23262C] flex items-center justify-between text-xs shrink-0">
            <span className="text-[11px] text-[#8A8F98]">
              {visibleAgents.length} de {allAgents.length || 3} exibidos
            </span>
            <button
              onClick={() => setViewMode('settings')}
              className="text-[11px] font-medium text-[#8B93FF] hover:underline cursor-pointer"
            >
              Ajustes
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Settings Header */}
          <div className="pb-3 mb-2 border-b border-[#23262C] shrink-0 space-y-1">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setViewMode('usage')}
                className="flex items-center gap-1 text-xs text-[#8A8F98] hover:text-[#E7E8EA] transition-colors px-1 py-0.5 rounded-lg hover:bg-[#181B20] cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Voltar</span>
              </button>
              <span className="text-[10px] font-mono text-[#8A8F98]">
                {allAgents.length} detectados
              </span>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-[#E7E8EA]">
                Agentes Instalados
              </h3>
              <p className="text-[11px] text-[#8A8F98]">
                Defina quais agentes exibir no monitor de uso.
              </p>
            </div>
          </div>

          {/* Settings List */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
            {allAgents.map((agent) => {
              const isTurnedOn = visibilityPrefs[agent.id] !== false;

              return (
                <div
                  key={agent.id}
                  className="p-3 bg-[#181B20] border border-[#23262C] rounded-xl flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="w-7 h-7 rounded-lg bg-[#14161A] border border-[#23262C] flex items-center justify-center shrink-0">
                      {getAgentIcon(agent.id)}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium text-xs text-[#E7E8EA] truncate">
                        {agent.name}
                      </span>
                      <span className="text-[10px] text-[#8A8F98] truncate font-mono">
                        {agent.command || 'Instalado'}
                      </span>
                    </div>
                  </div>

                  {/* Switch */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isTurnedOn}
                    aria-label={`Exibir ${agent.name}`}
                    onClick={() => toggleAgentVisibility(agent.id)}
                    className={`w-9 h-5 rounded-full transition-colors relative shrink-0 p-0.5 cursor-pointer ${
                      isTurnedOn ? 'bg-[#8B93FF]' : 'bg-[#23262C]'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-transform ${
                        isTurnedOn ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Settings Footer */}
          <div className="pt-3 mt-2 border-t border-[#23262C] flex items-center justify-between shrink-0">
            <span className="text-[10px] text-[#8A8F98]">
              Preferências salvas
            </span>
            <button
              onClick={() => setViewMode('usage')}
              className="h-8 px-3.5 bg-[#8B93FF] hover:bg-[#7a82f8] text-[#0E0F12] text-xs font-semibold rounded-xl transition-colors cursor-pointer"
            >
              Concluir
            </button>
          </div>
        </>
      )}
    </div>
  );
};
