import React, { useState, useEffect } from 'react';
import { TerminalNode as TerminalNodeType } from '@mindagentics/shared';
import {
  X,
  Wand2,
  Zap,
  Terminal,
  Check,
  Sparkles,
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
  const [title, setTitle] = useState(node.content.title || 'Terminal');
  const [agentRole, setAgentRole] = useState(node.content.agentRole || '');
  const [instructions, setInstructions] = useState(node.content.instructions || '');
  const [isOrchestrator, setIsOrchestrator] = useState(Boolean(node.content.orchestratorMode ?? node.content.maestroMode));
  const [isAutonomous, setIsAutonomous] = useState(node.content.isAutonomous ?? true);
  const [selectedAgentId, setSelectedAgentId] = useState(node.content.presetId || 'shell');
  const [installedAgents, setInstalledAgents] = useState<AgentOption[]>([
    { id: 'shell', name: 'Shell Padrão', command: '', installed: true },
  ]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTitle(node.content.title || 'Terminal');
      setAgentRole(node.content.agentRole || '');
      setInstructions(node.content.instructions || '');
      setIsOrchestrator(Boolean(node.content.orchestratorMode ?? node.content.maestroMode));
      setIsAutonomous(node.content.isAutonomous ?? true);
      setSelectedAgentId(node.content.presetId || 'shell');

      const detect = async () => {
        try {
          const detectFn =
            window.mindAgentics?.terminal?.detectAgents ||
            window.api?.terminal?.detectAgents ||
            (window.api as any)?.terminal?.detectInstalledAgents;
          if (detectFn) {
            const list = await detectFn();
            if (Array.isArray(list)) {
              const installed = list
                .filter((a: any) => a.installed && !['powershell', 'cmd', 'bash'].includes(a.id))
                .map((a: any) => ({
                  id: a.id,
                  name: a.name || a.id,
                  command: a.command || a.id,
                  installed: true,
                }));
              setInstalledAgents([
                ...installed,
                { id: 'shell', name: 'Shell Padrão', command: '', installed: true },
              ]);
            }
          }
        } catch {}
      };
      detect();
    }
  }, [isOpen, node]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const selectedAgent = installedAgents.find((a) => a.id === selectedAgentId);
      const commandChanged = selectedAgent && selectedAgent.command !== node.content.command;
      const agentChanged = selectedAgentId !== node.content.presetId || commandChanged;

      const updatedNode: TerminalNodeType = {
        ...node,
        content: {
          ...node.content,
          title: title.trim() || 'Terminal',
          agentRole: agentRole.trim(),
          instructions: instructions.trim(),
          orchestratorMode: isOrchestrator,
          maestroMode: isOrchestrator,
          isAutonomous,
          presetId: selectedAgentId,
          command: selectedAgent ? selectedAgent.command : node.content.command,
        },
      };

      onUpdate(updatedNode);

      // Reconfigure the backend session immediately
      const terminalApi = window.mindAgentics?.terminal || window.api?.terminal;
      if (terminalApi?.reconfigure) {
        await terminalApi.reconfigure(node.content.terminalId, {
          title: updatedNode.content.title,
          agentRole: updatedNode.content.agentRole,
          instructions: updatedNode.content.instructions,
          orchestratorMode: isOrchestrator,
          maestroMode: isOrchestrator,
          command: selectedAgent?.command,
          presetId: selectedAgentId,
          isAutonomous,
          restart: agentChanged,
        });
      } else if (agentChanged && terminalApi?.restart) {
        await terminalApi.restart(node.content.terminalId);
      }

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
    return <ShellIcon size={16} className="text-zinc-400 shrink-0" />;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
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
              <p className="text-[11px] text-[#8A8F98]">Configuração do agente, papel e comportamento</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-white hover:bg-white/[0.08] rounded-md transition-colors cursor-pointer"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="space-y-3.5 max-h-[60vh] overflow-y-auto pr-1 text-xs">
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
                    onClick={() => setSelectedAgentId(agent.id)}
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

          {/* Toggles: Orchestrator & Autonomous */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#23262C]">
            {/* Orchestrator Toggle */}
            <div
              onClick={() => setIsOrchestrator((prev) => !prev)}
              className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-colors ${
                isOrchestrator
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                  : 'bg-[#121418] border-[#23262C] text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Wand2 className={`w-3.5 h-3.5 ${isOrchestrator ? 'text-amber-400' : 'text-zinc-500'}`} />
                <span className="text-[11px] font-medium">Orquestrador</span>
              </div>
              <div
                className={`w-4 h-4 rounded-full flex items-center justify-center border transition-colors ${
                  isOrchestrator ? 'bg-amber-500 border-amber-400 text-black' : 'border-zinc-600'
                }`}
              >
                {isOrchestrator && <Check className="w-2.5 h-2.5 stroke-[3]" />}
              </div>
            </div>

            {/* Autonomous Toggle */}
            <div
              onClick={() => setIsAutonomous((prev) => !prev)}
              className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-colors ${
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
    </div>
  );
};
