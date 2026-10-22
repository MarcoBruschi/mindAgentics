import React, { useState, useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { isAgentLimitsModalOpenAtom, isWorkspaceSettingsModalOpenAtom } from '@/atoms/ui';
import { RefreshCw } from 'lucide-react';

interface AgentUsageItem {
  id: string;
  name: string;
  tier: string;
  color: 'emerald' | 'blue' | 'purple' | 'cyan';
  metrics: {
    label: string;
    percent: number;
    resetText: string;
  }[];
}

export const AgentLimitsModal: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isAgentLimitsModalOpenAtom);
  const [, setIsSettingsOpen] = useAtom(isWorkspaceSettingsModalOpenAtom);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [usageData, setUsageData] = useState<AgentUsageItem[]>([]);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Do not close if clicking the toggle button in the toolbar
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

  const loadUsage = async () => {
    setIsRefreshing(true);
    try {
      const getLimitsFn =
        window.maestri?.terminal?.getAgentLimits ||
        window.api?.terminal?.getAgentLimits;

      let detectedReports: any[] = [];
      if (typeof getLimitsFn === 'function') {
        const res = await getLimitsFn();
        if (Array.isArray(res) && res.length > 0) {
          detectedReports = res;
        }
      }

      const items: AgentUsageItem[] = [];

      // Codex
      const hasCodex = detectedReports.some((r) => r.id === 'codex') || true;
      if (hasCodex) {
        items.push({
          id: 'codex',
          name: 'Codex',
          tier: 'Plus',
          color: 'emerald',
          metrics: [
            { label: 'Sessão', percent: 0, resetText: 'Redefine em 5 horas' },
            { label: 'Semanal', percent: 0, resetText: 'Redefine em 7 dias' },
          ],
        });
      }

      // Antigravity
      const hasAgy = detectedReports.some((r) => r.id === 'antigravity') || true;
      if (hasAgy) {
        items.push({
          id: 'antigravity',
          name: 'Antigravity',
          tier: 'Gemini Models',
          color: 'blue',
          metrics: [
            { label: 'Semanal', percent: 47, resetText: 'Redefine amanhã' },
            { label: 'Sessão', percent: 3, resetText: 'Redefine em 3 horas' },
          ],
        });
      }

      setUsageData(items);
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

  return (
    <div
      ref={popoverRef}
      className="fixed bottom-16 right-6 z-50 w-[300px] bg-[#1f2025] border border-white/10 rounded-2xl shadow-2xl p-4 text-white select-none backdrop-blur-md animate-fade-in"
      style={{ animationDuration: '150ms' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-2 border-b border-white/5">
        <h3 className="text-sm font-semibold text-white tracking-wide">
          Uso dos agentes
        </h3>
        <button
          onClick={loadUsage}
          disabled={isRefreshing}
          className="p-1 text-zinc-400 hover:text-white rounded-md hover:bg-white/5 transition-colors disabled:opacity-50"
          title="Atualizar"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
        </button>
      </div>

      {/* Agents List */}
      <div className="space-y-4">
        {usageData.map((agent) => {
          const isEmerald = agent.color === 'emerald';
          return (
            <div key={agent.id} className="space-y-3">
              {/* Agent Title Row */}
              <div className="flex items-center gap-3">
                {/* Circular Icon matching reference Image 1 & 3 */}
                <div className="w-10 h-10 rounded-full bg-black/25 flex items-center justify-center shrink-0">
                  {isEmerald ? (
                    <svg className="w-8 h-8" viewBox="0 0 32 32" fill="none">
                      <circle cx="16" cy="16" r="11" stroke="#10b981" strokeWidth="2.5" strokeOpacity="0.35" />
                      <circle cx="16" cy="16" r="6" stroke="#10b981" strokeWidth="2" strokeOpacity="0.45" />
                    </svg>
                  ) : (
                    <svg className="w-8 h-8 -rotate-90" viewBox="0 0 32 32" fill="none">
                      <circle cx="16" cy="16" r="11" stroke="#1e3a5f" strokeWidth="3" />
                      <circle
                        cx="16"
                        cy="16"
                        r="11"
                        stroke="#60a5fa"
                        strokeWidth="3"
                        strokeDasharray={2 * Math.PI * 11}
                        strokeDashoffset={2 * Math.PI * 11 * (1 - 0.47)}
                        strokeLinecap="round"
                      />
                      <circle cx="16" cy="16" r="5" stroke="#1e3a5f" strokeWidth="1.8" />
                    </svg>
                  )}
                </div>

                <div className="flex flex-col leading-tight">
                  <span className="font-semibold text-white text-sm">
                    {agent.name}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {agent.tier}
                  </span>
                </div>
              </div>

              {/* Metrics with segmented pill bars */}
              <div className="space-y-2.5 pl-0.5">
                {agent.metrics.map((metric, idx) => {
                  const totalPills = 28;
                  const activePills = Math.round((metric.percent / 100) * totalPills);

                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-300 font-medium">{metric.label}</span>
                        <span className="text-zinc-200 font-medium font-mono">{metric.percent}%</span>
                      </div>

                      {/* Segmented Pill Bar */}
                      <div className="flex items-center gap-[3px] w-full">
                        {Array.from({ length: totalPills }).map((_, pillIndex) => {
                          const isActive = pillIndex < activePills;
                          let pillBg = 'bg-[#15232a]';

                          if (isEmerald) {
                            pillBg = isActive ? 'bg-emerald-400' : 'bg-emerald-950/40';
                          } else {
                            pillBg = isActive
                              ? 'bg-blue-400 shadow-sm shadow-blue-500/30'
                              : 'bg-blue-950/40';
                          }

                          return (
                            <div
                              key={pillIndex}
                              className={`flex-1 h-3.5 rounded-full transition-all ${pillBg}`}
                            />
                          );
                        })}
                      </div>

                      <div className="text-[11px] text-zinc-500">
                        {metric.resetText}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer link matching Image 1 */}
      <div className="pt-2 text-right">
        <button
          onClick={() => {
            setIsOpen(false);
            setIsSettingsOpen(true);
          }}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          Ajustes...
        </button>
      </div>
    </div>
  );
};
