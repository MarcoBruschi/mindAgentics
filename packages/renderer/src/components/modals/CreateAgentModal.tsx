import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { isCreateAgentModalOpenAtom } from '@/atoms/ui';
import { nodesAtom, activeWorkspaceAtom } from '@/atoms/workspace';
import { canvasOffsetAtom } from '@/atoms/canvas';
import { TerminalNode as TerminalNodeType } from '@maestri/shared';
import {
  Sparkles,
  Brain,
  ShieldCheck,
  Code2,
  Terminal,
  FolderOpen,
  Info,
  Wand2,
} from 'lucide-react';

interface PresetItem {
  id: string;
  name: string;
  command: string;
  icon: string;
  installed?: boolean;
}

export const CreateAgentModal: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isCreateAgentModalOpenAtom);
  const [nodes, setNodes] = useAtom(nodesAtom);
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);
  const [offset] = useAtom(canvasOffsetAtom);

  const [activeTab, setActiveTab] = useState<'detalhes' | 'aparencia' | 'agente'>('detalhes');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('antigravity');

  // Form State
  const [terminalName, setTerminalName] = useState('Antigravity');
  const [command, setCommand] = useState('agy');
  const [executionTarget, setExecutionTarget] = useState('workspace_default');
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [monitorActivity, setMonitorActivity] = useState(true);
  const [isMaestro, setIsMaestro] = useState(false);

  // Appearance State
  const [fontFamily, setFontFamily] = useState("Cascadia Mono, Consolas, monospace");
  const [fontSize, setFontSize] = useState(13);
  const [themeColor, setThemeColor] = useState('#3b82f6');

  // Agent State
  const [agentRole, setAgentRole] = useState('Lead Architect');
  const [isAutonomous, setIsAutonomous] = useState(true);
  const [customInstructions, setCustomInstructions] = useState('');

  // Detected Agents from system
  const [installedMap, setInstalledMap] = useState<Record<string, boolean>>({
    antigravity: true,
    codex: true,
    opencode: true,
    copilot: true,
    claude: false,
    shell: true,
  });

  useEffect(() => {
    if (activeWorkspace?.workingDirectory && !workingDirectory) {
      setWorkingDirectory(activeWorkspace.workingDirectory);
    }
  }, [activeWorkspace?.workingDirectory]);

  useEffect(() => {
    if (window.maestri?.terminal?.detectAgents) {
      window.maestri.terminal.detectAgents().then((agents: any[]) => {
        if (Array.isArray(agents)) {
          const map: Record<string, boolean> = {};
          for (const a of agents) {
            map[a.id] = !!a.installed;
            if (a.id === 'github-copilot' || a.id === 'gh-copilot') map['copilot'] = !!a.installed;
          }
          setInstalledMap((prev) => ({ ...prev, ...map }));
        }
      }).catch(() => {});
    }
  }, []);

  const presets: PresetItem[] = [
    { id: 'claude', name: 'Claude Code', command: 'claude', icon: 'seal' },
    { id: 'codex', name: 'Codex', command: 'codex --no-daemon', icon: 'brain' },
    { id: 'antigravity', name: 'Antigravity', command: 'agy', icon: 'sparkle' },
    { id: 'opencode', name: 'OpenCode', command: 'opencode', icon: 'rectangle' },
    { id: 'copilot', name: 'GitHub Copilot', command: 'copilot', icon: 'terminal' },
    { id: 'shell', name: 'Shell', command: '', icon: 'shell' },
  ];

  const handleSelectPreset = (preset: PresetItem) => {
    setSelectedPresetId(preset.id);

    // Calculate unique name to avoid duplicates (e.g. Antigravity 1, Antigravity 2)
    const existingCount = nodes.filter(
      (n) => n.kind === 'terminal' && n.content?.title?.toLowerCase().startsWith(preset.name.toLowerCase())
    ).length;
    const assignedName = existingCount === 0 ? preset.name : `${preset.name} ${existingCount + 1}`;

    setTerminalName(assignedName);
    setCommand(preset.command);
  };

  const handlePickDirectory = async () => {
    try {
      if (window.api?.app?.pickDirectory) {
        const picked = await window.api.app.pickDirectory();
        if (picked) setWorkingDirectory(picked);
      }
    } catch {
      // fallback
    }
  };

  const handleCreate = () => {
    const finalName = terminalName.trim() || 'Terminal';
    const finalCmd = command.trim();
    const finalDir = workingDirectory.trim() || activeWorkspace?.workingDirectory || 'C:\\Users\\mabru\\Documents\\maestri';

    // Spawn point centered on current canvas viewport
    const viewportCenterX = -offset.x / offset.zoom + 200;
    const viewportCenterY = -offset.y / offset.zoom + 120;
    const staggeredOffset = (nodes.length % 6) * 40;

    const newTerminalId = `term-${Date.now()}`;
    const newNodeId = `node-${Date.now()}`;

    const newTerminalNode: TerminalNodeType = {
      id: newNodeId,
      kind: 'terminal',
      x: Math.round(viewportCenterX + staggeredOffset),
      y: Math.round(viewportCenterY + staggeredOffset),
      width: 680,
      height: 480,
      zIndex: 10 + nodes.length,
      content: {
        terminalId: newTerminalId,
        title: finalName,
        agentRole: agentRole || 'Developer',
        isLocked: false,
        command: finalCmd,
        workingDirectory: finalDir,
        maestroMode: isMaestro,
        monitorWithOmbro: monitorActivity,
        isAutonomous,
        fontFamily,
        fontSize,
        color: themeColor,
        instructions: customInstructions,
      },
    };

    setNodes((prev) => [...prev, newTerminalNode]);

    // Spawn PTY process if backend is connected
    if (window.api?.terminal?.spawn) {
      window.api.terminal.spawn({
        terminalId: newTerminalId,
        workspaceId: activeWorkspace?.id || 'workspace-main',
        command: finalCmd,
        cwd: finalDir,
      }).catch(() => {});
    }

    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-[480px] bg-[#17181c] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-200">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5 bg-[#1b1c22]">
          <button
            onClick={() => setIsOpen(false)}
            className="text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors"
          >
            Cancelar
          </button>
          <h2 className="text-sm font-bold text-white tracking-wide">Novo terminal</h2>
          <button
            onClick={handleCreate}
            className="text-sm font-semibold text-blue-400 hover:text-blue-300 transition-colors"
          >
            Criar
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 max-h-[80vh]">
          {/* Section: INÍCIO RÁPIDO */}
          <div>
            <span className="block text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2.5">
              INÍCIO RÁPIDO
            </span>
            <div className="grid grid-cols-6 gap-2">
              {presets.map((preset) => {
                const isSelected = selectedPresetId === preset.id;
                const isInstalled = installedMap[preset.id] ?? false;

                return (
                  <button
                    key={preset.id}
                    onClick={() => handleSelectPreset(preset)}
                    className={`flex flex-col items-center justify-center p-2 rounded-xl transition-all border ${
                      isSelected
                        ? 'bg-blue-600/20 border-blue-500/50 text-white shadow-md shadow-blue-500/10'
                        : 'bg-[#1e2026] border-white/5 text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                    }`}
                  >
                    <div className="relative mb-1.5 flex items-center justify-center">
                      {preset.id === 'claude' && <ShieldCheck className="w-5 h-5 text-amber-400" />}
                      {preset.id === 'codex' && <Brain className="w-5 h-5 text-emerald-400" />}
                      {preset.id === 'antigravity' && <Sparkles className="w-5 h-5 text-blue-400" />}
                      {preset.id === 'opencode' && <Code2 className="w-5 h-5 text-cyan-400" />}
                      {preset.id === 'copilot' && <Terminal className="w-5 h-5 text-indigo-400" />}
                      {preset.id === 'shell' && <Terminal className="w-5 h-5 text-zinc-400" />}

                      {/* Small green dot indicator if installed on local machine */}
                      {isInstalled && (
                        <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-[#17181c]" title="Instalado nesta máquina" />
                      )}
                    </div>
                    <span className="text-[10px] font-medium leading-tight text-center truncate w-full">
                      {preset.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Navigation Pill Tabs: Detalhes, Aparência, Agente */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-[#121316] rounded-xl border border-white/5">
            <button
              onClick={() => setActiveTab('detalhes')}
              className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'detalhes'
                  ? 'bg-[#242630] text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Detalhes
            </button>
            <button
              onClick={() => setActiveTab('aparencia')}
              className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'aparencia'
                  ? 'bg-[#242630] text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Aparência
            </button>
            <button
              onClick={() => setActiveTab('agente')}
              className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === 'agente'
                  ? 'bg-[#242630] text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Agente
            </button>
          </div>

          {/* TAB 1: DETALHES */}
          {activeTab === 'detalhes' && (
            <div className="space-y-3.5 animate-in fade-in duration-100">
              {/* Nome do terminal */}
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Nome do terminal</label>
                <input
                  type="text"
                  value={terminalName}
                  onChange={(e) => setTerminalName(e.target.value)}
                  placeholder="Nome do terminal"
                  className="w-full px-3 py-2 bg-[#121316] border border-white/10 rounded-xl text-xs text-white outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              {/* Comando */}
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Comando</label>
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="ex.: claude, codex, ou deixe vazio para shell"
                  className="w-full px-3 py-2 bg-[#121316] border border-white/10 rounded-xl text-xs text-white font-mono outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              {/* Executa em */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-zinc-300">Executa em</label>
                  <select
                    value={executionTarget}
                    onChange={(e) => setExecutionTarget(e.target.value)}
                    className="px-2.5 py-1 bg-[#121316] border border-white/10 rounded-lg text-xs text-zinc-300 outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="workspace_default">Padrão do espaço de trabalho</option>
                    <option value="local">Local</option>
                    <option value="wsl">WSL (Linux)</option>
                  </select>
                </div>
                <span className="text-[11px] text-zinc-500">Local</span>
              </div>

              {/* Diretório de trabalho */}
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Diretório de trabalho</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={workingDirectory}
                    onChange={(e) => setWorkingDirectory(e.target.value)}
                    placeholder="ex.: ~/projeto ou /home/usuario/projeto"
                    className="flex-1 px-3 py-2 bg-[#121316] border border-white/10 rounded-xl text-xs font-mono text-white outline-none focus:border-blue-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={handlePickDirectory}
                    className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs text-zinc-300 flex items-center gap-1.5 transition-colors shrink-0"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
                    <span>Procurar...</span>
                  </button>
                </div>
              </div>

              {/* Switches */}
              <div className="space-y-3 pt-1">
                {/* Switch: Monitorar atividade */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-zinc-200">Monitorar atividade</span>
                    <span className="text-[11px] text-zinc-500 leading-tight">
                      Detecta a saída do terminal e avisa quando o trabalho termina.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMonitorActivity(!monitorActivity)}
                    className={`w-11 h-6 rounded-full transition-colors relative shrink-0 p-0.5 ${
                      monitorActivity ? 'bg-blue-600' : 'bg-zinc-700'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white transition-transform ${
                        monitorActivity ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Switch: Maestro */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-zinc-200">Maestro</span>
                      <Wand2 className="w-3.5 h-3.5 text-blue-400" />
                      <Info className="w-3 h-3 text-zinc-500" />
                    </div>
                    <span className="text-[11px] text-zinc-500 leading-tight">
                      Promove este terminal a maestro, capaz de reger o restante do canvas.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsMaestro(!isMaestro)}
                    className={`w-11 h-6 rounded-full transition-colors relative shrink-0 p-0.5 ${
                      isMaestro ? 'bg-blue-600' : 'bg-zinc-700'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white transition-transform ${
                        isMaestro ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: APARÊNCIA */}
          {activeTab === 'aparencia' && (
            <div className="space-y-3.5 animate-in fade-in duration-100">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Família da Fonte</label>
                <select
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                  className="w-full px-3 py-2 bg-[#121316] border border-white/10 rounded-xl text-xs text-white outline-none focus:border-blue-500"
                >
                  <option value="Cascadia Mono, Consolas, monospace">Cascadia Mono (Padrão)</option>
                  <option value="Consolas, 'Courier New', monospace">Consolas</option>
                  <option value="'JetBrains Mono', monospace">JetBrains Mono</option>
                  <option value="'Fira Code', monospace">Fira Code</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Tamanho da Fonte: {fontSize}px</label>
                <input
                  type="range"
                  min="10"
                  max="20"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Cor de Destaque</label>
                <div className="flex items-center gap-2">
                  {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setThemeColor(c)}
                      style={{ backgroundColor: c }}
                      className={`w-6 h-6 rounded-full transition-transform ${
                        themeColor === c ? 'scale-125 ring-2 ring-white shadow-md' : 'opacity-80 hover:opacity-100'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: AGENTE */}
          {activeTab === 'agente' && (
            <div className="space-y-3.5 animate-in fade-in duration-100">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Papel / Função do Agente</label>
                <input
                  type="text"
                  value={agentRole}
                  onChange={(e) => setAgentRole(e.target.value)}
                  placeholder="ex.: Lead Architect, Frontend Specialist, Code Reviewer"
                  className="w-full px-3 py-2 bg-[#121316] border border-white/10 rounded-xl text-xs text-white outline-none focus:border-blue-500"
                />
              </div>

              {/* Switch Modo Autônomo */}
              <div className="flex items-start justify-between gap-3 p-3 bg-black/30 rounded-xl border border-white/5">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-zinc-200">⚡ Modo Autônomo</span>
                  <span className="text-[11px] text-zinc-400 leading-tight">
                    Executa ferramentas, edição de arquivos e comandos sem pausar para confirmação manual.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAutonomous(!isAutonomous)}
                  className={`w-11 h-6 rounded-full transition-colors relative shrink-0 p-0.5 ${
                    isAutonomous ? 'bg-amber-600' : 'bg-zinc-700'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      isAutonomous ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">Instruções / Contexto Adicional</label>
                <textarea
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="Diretrizes específicas para este agente quando for acionado via maestri ask..."
                  rows={3}
                  className="w-full px-3 py-2 bg-[#121316] border border-white/10 rounded-xl text-xs text-white outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
