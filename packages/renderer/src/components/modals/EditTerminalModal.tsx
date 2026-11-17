import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TerminalNode as TerminalNodeType } from '@mindagentics/shared';
import {
  X,
  Zap,
  Terminal,
  Check,
  RefreshCw,
  Cpu,
  Info,
} from 'lucide-react';
import {
  ClaudeIcon,
  CodexIcon,
  AntigravityIcon,
  OpenCodeIcon,
  ShellIcon,
} from '../icons/AgentBrandIcons';

export interface AgentOption {
  id: string;
  name: string;
  command: string;
  installed: boolean;
}

export interface ModelOption {
  id: string;
  label: string;
}

export const BASE_AGENTS: AgentOption[] = [
  { id: 'antigravity', name: 'Antigravity', command: 'agy', installed: true },
  { id: 'codex', name: 'Codex', command: 'codex --no-daemon', installed: true },
  { id: 'claude', name: 'Claude Code', command: 'claude', installed: true },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', installed: true },
  { id: 'github-copilot', name: 'GitHub Copilot', command: 'copilot', installed: true },
  { id: 'ollama', name: 'Ollama', command: 'ollama', installed: true },
  { id: 'shell', name: 'Shell Padrão', command: '', installed: true },
];

export const AGENT_MODELS: Record<string, ModelOption[]> = {
  antigravity: [
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash High (Padrão)' },
    { id: 'gemini-3.8-pro-high', label: 'Gemini 3.8 Pro High' },
    { id: 'claude-sonnet-5-5-high', label: 'Claude 3.5 Sonnet High' },
    { id: 'claude-opus-5-high', label: 'Claude 3 Opus High' },
  ],
  claude: [
    { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet (Padrão)' },
    { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
    { id: 'claude-3-opus-latest', label: 'Claude 3 Opus' },
  ],
  codex: [
    { id: 'gpt-4o', label: 'GPT-4o (Padrão)' },
    { id: 'o3-mini', label: 'o3-mini' },
    { id: 'o1', label: 'o1' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  ],
  opencode: [
    { id: 'deepseek-chat', label: 'DeepSeek Chat (Padrão)' },
    { id: 'deepseek-coder', label: 'DeepSeek Coder' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
  ],
  ollama: [
    { id: 'llama3.3:latest', label: 'Llama 3.3 (Padrão)' },
    { id: 'qwen2.5-coder:latest', label: 'Qwen 2.5 Coder' },
    { id: 'deepseek-r1:latest', label: 'DeepSeek R1' },
    { id: 'mistral:latest', label: 'Mistral' },
  ],
};

export function normalizePresetId(rawPresetId?: string, rawCommand?: string): string {
  const lower = (rawPresetId || '').toLowerCase().trim();
  if (lower === 'claude code' || lower === 'claude' || lower.includes('claude')) return 'claude';
  if (lower === 'antigravity' || lower === 'agy' || lower.includes('antigravity')) return 'antigravity';
  if (lower === 'codex' || lower.includes('codex') || lower.includes('openai')) return 'codex';
  if (lower === 'opencode' || lower.includes('opencode')) return 'opencode';
  if (lower === 'github copilot' || lower === 'copilot' || lower === 'github-copilot' || lower === 'gh-copilot') return 'github-copilot';
  if (lower === 'ollama' || lower.includes('ollama')) return 'ollama';
  if (lower === 'shell' || lower === 'shell padrão' || lower === 'default') return 'shell';

  // Fallback to command inspection if presetId was empty or unrecognized
  const cmd = (rawCommand || '').toLowerCase().trim();
  if (cmd.startsWith('claude')) return 'claude';
  if (cmd.startsWith('agy')) return 'antigravity';
  if (cmd.startsWith('codex')) return 'codex';
  if (cmd.startsWith('opencode')) return 'opencode';
  if (cmd.startsWith('copilot')) return 'github-copilot';
  if (cmd.startsWith('ollama')) return 'ollama';

  return 'shell';
}

export function sanitizeExtraArgs(rawArgs: string): string {
  if (!rawArgs) return '';
  let cleaned = rawArgs;
  const autoFlags = [
    /--dangerously-skip-permissions/gi,
    /--mode\s+auto/gi,
    /--dangerously-bypass-approvals-and-sandbox/gi,
    /--auto\b/gi,
  ];
  for (const flag of autoFlags) {
    cleaned = cleaned.replace(flag, '');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

export function extractModelAndArgs(presetId: string, rawCmd: string): { modelId: string; extraArgs: string } {
  let cmd = (rawCmd || '').trim();
  let modelId = '';

  // Clean base prefixes
  const basePrefixes = [
    'codex --no-daemon',
    'codex',
    'agy',
    'claude',
    'opencode',
    'copilot',
    'ollama run',
    'ollama',
  ];
  for (const prefix of basePrefixes) {
    if (cmd.startsWith(prefix)) {
      cmd = cmd.slice(prefix.length).trim();
      break;
    }
  }

  if (presetId === 'antigravity' || presetId === 'claude') {
    const match = cmd.match(/--model\s+([^\s]+)/i);
    if (match) {
      modelId = match[1];
      cmd = cmd.replace(match[0], '').trim();
    }
  } else if (presetId === 'codex' || presetId === 'opencode') {
    const match = cmd.match(/(?:-m|--model)\s+([^\s]+)/i);
    if (match) {
      modelId = match[1];
      cmd = cmd.replace(match[0], '').trim();
    }
  } else if (presetId === 'ollama') {
    const match = rawCmd.match(/ollama\s+(?:run\s+)?([^\s]+)/i);
    if (match && match[1] && match[1] !== 'run') {
      modelId = match[1];
      cmd = cmd.replace(match[1], '').trim();
    }
  }

  // Clean leftover flags from old agents
  cmd = cmd.replace(/--no-daemon\b/gi, '').trim();

  if (!modelId && AGENT_MODELS[presetId]?.length) {
    modelId = AGENT_MODELS[presetId][0].id;
  }

  return { modelId, extraArgs: sanitizeExtraArgs(cmd) };
}

export function composeAgentCommand(presetId: string, modelId: string, extraArgs: string): string {
  let baseCmd = '';
  switch (presetId) {
    case 'antigravity':
      baseCmd = modelId ? `agy --model ${modelId}` : 'agy';
      break;
    case 'claude':
      baseCmd = modelId ? `claude --model ${modelId}` : 'claude';
      break;
    case 'codex':
      baseCmd = modelId ? `codex --no-daemon -m ${modelId}` : 'codex --no-daemon';
      break;
    case 'opencode':
      baseCmd = modelId ? `opencode -m ${modelId}` : 'opencode';
      break;
    case 'ollama':
      baseCmd = modelId ? `ollama run ${modelId}` : 'ollama';
      break;
    case 'github-copilot':
      baseCmd = 'copilot';
      break;
    case 'shell':
    default:
      baseCmd = '';
      break;
  }
  const cleanExtra = sanitizeExtraArgs(extraArgs);
  if (!cleanExtra) return baseCmd;
  return baseCmd ? `${baseCmd} ${cleanExtra}` : cleanExtra;
}

interface EditTerminalModalProps {
  isOpen: boolean;
  onClose: () => void;
  node: TerminalNodeType;
  onUpdate: (updated: TerminalNodeType) => void;
}

export const EditTerminalModal: React.FC<EditTerminalModalProps> = ({
  isOpen,
  onClose,
  node,
  onUpdate,
}) => {
  const isInitiallyOrchestrator = Boolean(node.content.orchestratorMode ?? node.content.maestroMode);
  const [title, setTitle] = useState(node.content.title || 'Terminal');
  const [agentRole, setAgentRole] = useState(node.content.agentRole || '');
  const [instructions, setInstructions] = useState(node.content.instructions || '');
  const [commandArgs, setCommandArgs] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [isAutonomous, setIsAutonomous] = useState(node.content.isAutonomous ?? true);
  const [shouldRestart, setShouldRestart] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState(normalizePresetId(node.content.presetId, node.content.command));
  const [installedAgents, setInstalledAgents] = useState<AgentOption[]>(BASE_AGENTS);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTitle(node.content.title || 'Terminal');
      setAgentRole(node.content.agentRole || '');
      setInstructions(node.content.instructions || '');
      setIsAutonomous(node.content.isAutonomous ?? true);
      const currentPresetId = normalizePresetId(node.content.presetId, node.content.command);
      setSelectedAgentId(currentPresetId);
      setShouldRestart(false);

      const parsed = extractModelAndArgs(currentPresetId, node.content.command || '');
      setSelectedModelId(parsed.modelId);
      setCommandArgs(parsed.extraArgs);

      const detect = async () => {
        try {
          const detectFn =
            window.mindAgentics?.terminal?.detectAgents ||
            window.api?.terminal?.detectAgents ||
            (window.api as any)?.terminal?.detectInstalledAgents;
          if (detectFn) {
            const list = await detectFn();
            if (Array.isArray(list)) {
              const detectedMap = new Map<string, any>();
              for (const a of list) {
                if (a && a.id) detectedMap.set(a.id, a);
              }
              const merged = BASE_AGENTS.map((base) => {
                const found = detectedMap.get(base.id);
                if (found) {
                  return {
                    ...base,
                    command: found.command || base.command,
                    installed: Boolean(found.installed),
                  };
                }
                return base;
              });
              setInstalledAgents(merged);
            }
          }
        } catch {}
      };
      detect();
    }
  }, [isOpen, node]);

  if (!isOpen) return null;

  const handleSelectAgent = (agent: AgentOption) => {
    setSelectedAgentId(agent.id);
    const isAgentChanging = agent.id !== selectedAgentId;
    if (isAgentChanging) {
      setShouldRestart(true);
      const defaultModel = AGENT_MODELS[agent.id]?.[0]?.id || '';
      setSelectedModelId(defaultModel);

      // Clean flags from previous agent
      let cleaned = commandArgs;
      cleaned = cleaned.replace(/--no-daemon\b/gi, '');
      cleaned = cleaned.replace(/--model\s+[^\s]+/gi, '');
      cleaned = cleaned.replace(/-m\s+[^\s]+/gi, '');
      cleaned = cleaned.replace(/^run\s+[^\s]+/gi, '');
      setCommandArgs(sanitizeExtraArgs(cleaned));

      const prevMatchesAgent = BASE_AGENTS.some(
        (b) => b.name === title || b.id === title || title === 'Terminal'
      );
      if (prevMatchesAgent || !title.trim()) {
        setTitle(agent.name);
      }
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const targetCommand = composeAgentCommand(selectedAgentId, selectedModelId, commandArgs);
      const commandChanged = targetCommand !== (node.content.command ?? '');
      const agentChanged = selectedAgentId !== (node.content.presetId || 'shell') || commandChanged;
      const needsRestart = shouldRestart || agentChanged;

      const updatedNode: TerminalNodeType = {
        ...node,
        content: {
          ...node.content,
          title: title.trim() || 'Terminal',
          agentRole: agentRole.trim(),
          instructions: instructions.trim(),
          orchestratorMode: isInitiallyOrchestrator,
          maestroMode: isInitiallyOrchestrator,
          isAutonomous,
          presetId: selectedAgentId,
          command: targetCommand,
        },
      };

      // 1. Reconfigure backend session FIRST
      const terminalApi = window.mindAgentics?.terminal || window.api?.terminal;
      if (terminalApi?.reconfigure) {
        await terminalApi.reconfigure(node.content.terminalId, {
          title: updatedNode.content.title,
          agentRole: updatedNode.content.agentRole,
          instructions: updatedNode.content.instructions,
          orchestratorMode: isInitiallyOrchestrator,
          maestroMode: isInitiallyOrchestrator,
          command: targetCommand,
          presetId: selectedAgentId,
          isAutonomous,
          restart: needsRestart,
        });
      } else if (needsRestart && terminalApi?.restart) {
        await terminalApi.restart(node.content.terminalId);
      }

      // 2. Then update React state
      onUpdate(updatedNode);
      onClose();
    } catch (err) {
      console.error('Failed to reconfigure terminal:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const getAgentIcon = (id: string) => {
    const lower = id.toLowerCase();
    if (lower.includes('claude')) return <ClaudeIcon size={16} className="text-amber-500 shrink-0" />;
    if (lower.includes('codex') || lower.includes('openai')) return <CodexIcon size={16} className="text-emerald-400 shrink-0" />;
    if (lower.includes('antigravity') || lower.includes('agy')) return <AntigravityIcon size={16} className="text-indigo-400 shrink-0" />;
    if (lower.includes('opencode')) return <OpenCodeIcon size={16} className="text-sky-400 shrink-0" />;
    if (lower.includes('ollama')) return <Cpu className="w-4 h-4 text-emerald-400 shrink-0" strokeWidth={1.75} />;
    return <ShellIcon size={16} className="text-zinc-400 shrink-0" />;
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] bg-[#14161A] border border-white/[0.08] rounded-2xl shadow-2xl p-5 text-[#E7E8EA] space-y-4 select-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#23262C]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-white/[0.06] flex items-center justify-center text-[#8B93FF]">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-tight">Editar Terminal</h3>
              <p className="text-[11px] text-[#8A8F98]">Configuração do agente, modelo de IA e papel</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-white hover:bg-white/[0.08] rounded-md transition-colors cursor-pointer"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="space-y-3.5 max-h-[60vh] overflow-y-auto pr-1 text-xs">
          {/* Session Reconfiguration Notice Callout */}
          <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-start gap-2.5 text-blue-200">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed text-zinc-300">
              Alterar o agente reiniciará a sessão do terminal mantendo o histórico de notas e referências.
            </p>
          </div>

          {/* Agent Selection */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-zinc-300">Agente Instalado</label>
            <div className="grid grid-cols-2 gap-2">
              {installedAgents.map((agent) => {
                const isSelected = selectedAgentId === agent.id;
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => handleSelectAgent(agent)}
                    className={`p-2.5 rounded-xl border flex items-center gap-2 transition-all cursor-pointer text-left ${
                      isSelected
                        ? 'bg-[#181B20] border-[#8B93FF] ring-1 ring-[#8B93FF] text-white shadow-sm'
                        : 'bg-[#121418] border-[#23262C] text-zinc-300 hover:border-white/[0.15] hover:bg-[#16181D]'
                    }`}
                  >
                    {getAgentIcon(agent.id)}
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-medium block truncate">{agent.name}</span>
                      <span className="text-[10px] font-mono text-zinc-500 block truncate">
                        {agent.command || 'shell'}
                      </span>
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-[#8B93FF] shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* AI Model Selector (hidden for shell and copilot) */}
          {AGENT_MODELS[selectedAgentId] && AGENT_MODELS[selectedAgentId].length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-zinc-300">Modelo de IA</label>
                <span className="text-[10px] text-zinc-500 font-mono">
                  {selectedAgentId === 'antigravity' || selectedAgentId === 'claude'
                    ? '--model'
                    : selectedAgentId === 'codex' || selectedAgentId === 'opencode'
                    ? '-m'
                    : 'ollama run'}
                </span>
              </div>
              <select
                value={selectedModelId}
                onChange={(e) => {
                  setSelectedModelId(e.target.value);
                  setShouldRestart(true);
                }}
                className="w-full h-8 px-2.5 rounded-lg bg-[#0E0F12] border border-[#23262C] focus:border-[#8B93FF] focus:outline-none text-xs text-white cursor-pointer"
              >
                {AGENT_MODELS[selectedAgentId].map((m) => (
                  <option key={m.id} value={m.id} className="bg-[#14161A] text-white">
                    {m.label} ({m.id})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Optional Command Arguments / Flags */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-zinc-300">Argumentos / Flags extras (opcional)</label>
              <span className="text-[10px] text-zinc-500 font-mono">Flags adicionais do CLI</span>
            </div>
            <input
              type="text"
              value={commandArgs}
              onChange={(e) => setCommandArgs(e.target.value)}
              placeholder="Ex: --verbose, --debug"
              className="w-full h-8 px-2.5 rounded-lg bg-[#0E0F12] border border-[#23262C] focus:border-[#8B93FF] focus:outline-none text-xs text-white font-mono"
            />
          </div>

          {/* Terminal Title */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-zinc-300">Nome do Terminal</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Antigravity Session"
              className="w-full h-8 px-2.5 rounded-lg bg-[#0E0F12] border border-[#23262C] focus:border-[#8B93FF] focus:outline-none text-xs text-white"
            />
          </div>

          {/* Agent Role */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-zinc-300">Papel / Role</label>
            <input
              type="text"
              value={agentRole}
              onChange={(e) => setAgentRole(e.target.value)}
              placeholder="Ex: Lead Architect, Frontend Engineer, Tech Lead"
              className="w-full h-8 px-2.5 rounded-lg bg-[#0E0F12] border border-[#23262C] focus:border-[#8B93FF] focus:outline-none text-xs text-white"
            />
          </div>

          {/* Instructions */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-zinc-300">Instruções Customizadas</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              placeholder="Diretrizes específicas de trabalho para este agente..."
              className="w-full p-2 rounded-lg bg-[#0E0F12] border border-[#23262C] focus:border-[#8B93FF] focus:outline-none text-xs text-white resize-none"
            />
          </div>

          {/* Toggles: Autonomous & Restart Session (Zero Orchestrator card) */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#23262C]">
            {/* Autonomous Toggle */}
            <div
              onClick={() => setIsAutonomous((prev) => !prev)}
              className={`col-span-2 sm:col-span-1 p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-colors ${
                isAutonomous
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                  : 'bg-[#121418] border-[#23262C] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Zap className={`w-3.5 h-3.5 ${isAutonomous ? 'text-emerald-400' : 'text-zinc-500'}`} />
                <span className="text-[11px] font-medium">Autônomo</span>
              </div>
              <div
                className={`w-4 h-4 rounded-full flex items-center justify-center border transition-colors ${
                  isAutonomous ? 'bg-emerald-500 border-emerald-400 text-black' : 'border-zinc-600'
                }`}
              >
                {isAutonomous && <Check className="w-2.5 h-2.5 stroke-[3]" />}
              </div>
            </div>

            {/* Restart Session Toggle */}
            <div
              onClick={() => setShouldRestart((prev) => !prev)}
              className={`col-span-2 sm:col-span-1 p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-colors ${
                shouldRestart
                  ? 'bg-[#8B93FF]/15 border-[#8B93FF]/40 text-[#c2c7ff]'
                  : 'bg-[#121418] border-[#23262C] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <RefreshCw className={`w-3.5 h-3.5 ${shouldRestart ? 'text-[#8B93FF]' : 'text-zinc-500'}`} />
                <span className="text-[11px] font-medium">Reiniciar ao Salvar</span>
              </div>
              <div
                className={`w-4 h-4 rounded-full flex items-center justify-center border transition-colors shrink-0 ${
                  shouldRestart ? 'bg-[#8B93FF] border-[#8B93FF] text-black' : 'border-zinc-600'
                }`}
              >
                {shouldRestart && <Check className="w-2.5 h-2.5 stroke-[3]" />}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="pt-3 border-t border-[#23262C] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl text-xs text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-[#8B93FF] hover:bg-[#7a82f8] text-[#0E0F12] transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-md"
          >
            {isSaving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
