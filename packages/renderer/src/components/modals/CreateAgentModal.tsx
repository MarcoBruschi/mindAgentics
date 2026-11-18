import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { isCreateAgentModalOpenAtom } from '@/atoms/ui';
import { nodesAtom, activeWorkspaceAtom, cableTiesAtom } from '@/atoms/workspace';
import { canvasOffsetAtom } from '@/atoms/canvas';
import { useAwardXp } from '@/atoms/profile';
import { TerminalNode as TerminalNodeType, CableTie } from '@mindagentics/shared';
import {
  FolderOpen,
  X,
  Network,
  Wand2,
  Check,
} from 'lucide-react';
import { AGENT_MODELS, composeAgentCommand } from './EditTerminalModal';

interface PresetItem {
  id: string;
  name: string;
  command: string;
}

export const CreateAgentModal: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isCreateAgentModalOpenAtom);
  const [nodes, setNodes] = useAtom(nodesAtom);
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);
  const [offset] = useAtom(canvasOffsetAtom);
  const awardXp = useAwardXp();

  const [activeTab, setActiveTab] = useState<'detalhes' | 'aparencia' | 'agente'>('detalhes');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('antigravity');
  const [selectedModelId, setSelectedModelId] = useState<string>('gemini-3.8-flash-high');

  // Form State
  const [terminalName, setTerminalName] = useState('Antigravity');
  const [command, setCommand] = useState(composeAgentCommand('antigravity', 'gemini-3.8-flash-high', ''));
  const [executionTarget, setExecutionTarget] = useState('workspace_default');
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [monitorActivity, setMonitorActivity] = useState(true);
  const [isOrchestrator, setIsOrchestrator] = useState(false);
  const [injectKnowledgeGraph, setInjectKnowledgeGraph] = useState(true);
  const [, setCableTies] = useAtom(cableTiesAtom);

  // Appearance State
  const [fontFamily, setFontFamily] = useState("Cascadia Mono, Consolas, monospace");
  const [fontSize, setFontSize] = useState(13);
  const [themeColor, setThemeColor] = useState('#8B93FF');

  // Agent State
  const [agentRole, setAgentRole] = useState('Lead Architect');
  const [isAutonomous, setIsAutonomous] = useState(true);
  const [customInstructions, setCustomInstructions] = useState('');

  // Detected Agents and Limits
  const [installedMap, setInstalledMap] = useState<Record<string, boolean>>({
    antigravity: false,
    codex: false,
    opencode: false,
    'github-copilot': false,
    claude: false,
    ollama: false,
    shell: true,
  });

  useEffect(() => {
    if (isOpen) {
      setSelectedPresetId('antigravity');
      setSelectedModelId('gemini-3.8-flash-high');
      setTerminalName('Antigravity');
      setCommand(composeAgentCommand('antigravity', 'gemini-3.8-flash-high', ''));
      setExecutionTarget('workspace_default');
      setWorkingDirectory(activeWorkspace?.workingDirectory || '');
      setMonitorActivity(true);
      setIsOrchestrator(false);
      setInjectKnowledgeGraph(true);
      setActiveTab('detalhes');
      setFontFamily("Cascadia Mono, Consolas, monospace");
      setFontSize(13);
      setThemeColor('#8B93FF');
      setAgentRole('Lead Architect');
      setIsAutonomous(true);
      setCustomInstructions('');
    }
  }, [isOpen, activeWorkspace?.workingDirectory]);

  useEffect(() => {
    if (activeWorkspace?.workingDirectory && !workingDirectory) {
      setWorkingDirectory(activeWorkspace.workingDirectory);
    }
  }, [activeWorkspace?.workingDirectory]);

  useEffect(() => {
    const fetchLimits = async () => {
      try {
        const detectFn = window.mindAgentics?.terminal?.detectAgents || window.api?.terminal?.detectAgents;
        if (detectFn) {
          const agents = await detectFn();
          if (Array.isArray(agents)) {
            const map: Record<string, boolean> = {};
            for (const a of agents) {
              map[a.id] = !!a.installed;
              if (a.id === 'github-copilot' || a.id === 'copilot' || a.id === 'gh-copilot') {
                map['github-copilot'] = !!a.installed;
              }
            }
            setInstalledMap((prev) => ({ ...prev, ...map }));
          }
        }
      } catch {}
    };

    fetchLimits();
  }, []);

  const presets: PresetItem[] = [
    { id: 'antigravity', name: 'Antigravity', command: 'agy' },
    { id: 'codex', name: 'Codex', command: 'codex --no-daemon' },
    { id: 'claude', name: 'Claude Code', command: 'claude' },
    { id: 'opencode', name: 'OpenCode', command: 'opencode' },
    { id: 'github-copilot', name: 'GitHub Copilot', command: 'copilot' },
    { id: 'ollama', name: 'Ollama', command: 'ollama' },
    { id: 'shell', name: 'Shell', command: '' },
  ];

  const handleSelectPreset = (preset: PresetItem) => {
    setSelectedPresetId(preset.id);
    const defaultModel = AGENT_MODELS[preset.id]?.[0]?.id || '';
    setSelectedModelId(defaultModel);

    const existingCount = nodes.filter(
      (n) => n.kind === 'terminal' && n.content?.title?.toLowerCase().startsWith(preset.name.toLowerCase())
    ).length;
    const assignedName = existingCount === 0 ? preset.name : `${preset.name} ${existingCount + 1}`;

    setTerminalName(assignedName);
    setCommand(composeAgentCommand(preset.id, defaultModel, ''));
  };

  const handleModelChange = (modelId: string) => {
    setSelectedModelId(modelId);
    setCommand(composeAgentCommand(selectedPresetId, modelId, ''));
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

  const handleCreate = async () => {
    const finalName = terminalName.trim() || 'Terminal';
    const finalCmd = command.trim();
    const finalDir = workingDirectory.trim() || activeWorkspace?.workingDirectory || '';

    const viewportCenterX = -offset.x / offset.zoom + 200;
    const viewportCenterY = -offset.y / offset.zoom + 120;
    const staggeredOffset = (nodes.length % 6) * 40;

    let enrichedInstructions = customInstructions || '';
    let graphPortalNodeId: string | null = null;

    if (injectKnowledgeGraph) {
      try {
        const api = (window as any).api || (window as any).mindAgentics;
        if (api?.graphify?.checkGraph) {
          const check = await api.graphify.checkGraph(finalDir);
          if (check?.hasGraph && check.reportContent) {
            const summary = check.reportContent.slice(0, 2500);
            const graphHeader = '## KNOWLEDGE GRAPH DO PROJETO\nVoce esta ancorado ao Knowledge Graph do projeto (' + check.projectName + ').\nDIRETRIZ DE ECONOMIA DE TOKENS: Consulte o grafo antes de ler arquivos.\n- mindagentics graphify query \"<pergunta>\" --budget 1500\n- mindagentics graphify path \"<Origem>\" \"<Destino>\"\n- mindagentics graphify explain \"<No>\"\n\nResumo Arquitetural:\n' + summary + '\n\n';
            enrichedInstructions = graphHeader + enrichedInstructions;
          }
        }
      } catch {}

      const portal = nodes.find(
        (n) => n.kind === 'portal' && (n.content?.title?.includes('Knowledge Graph') || n.content?.url?.includes('graph.html'))
      );
      if (portal) {
        graphPortalNodeId = portal.id;
      }
    }

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
        presetId: selectedPresetId,
        title: finalName,
        agentRole: agentRole || 'Developer',
        isLocked: false,
        command: finalCmd,
        workingDirectory: finalDir,
        orchestratorMode: isOrchestrator,
        maestroMode: isOrchestrator,
        monitorWithOmbro: monitorActivity,
        isAutonomous,
        fontFamily,
        fontSize,
        color: themeColor,
        instructions: enrichedInstructions,
      },
    };

    setNodes((prev) => [...prev, newTerminalNode]);

    if (graphPortalNodeId) {
      const newCable: CableTie = {
        id: `cable-${Date.now()}`,
        fromNodeId: newNodeId,
        toNodeId: graphPortalNodeId,
        style: 'accent',
      };
      setCableTies((prev) => [...prev, newCable]);
    }

    if (window.api?.terminal?.spawn) {
      window.api.terminal.spawn({
        id: newTerminalId,
        terminalId: newTerminalId,
        workspaceId: activeWorkspace?.id || 'workspace-main',
        command: finalCmd,
        cwd: finalDir,
        title: finalName,
        agentRole: agentRole || 'Developer',
        instructions: enrichedInstructions,
        isAutonomous,
        presetId: selectedPresetId,
        orchestratorMode: isOrchestrator,
        maestroMode: isOrchestrator,
      }).catch(() => {});
    }

    awardXp(50, 'recruitsCount');
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-[480px] max-h-[700px] h-full bg-[#14161A] border border-[#23262C] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-[#E7E8EA]">
        {/* Header Bar: Left Title, Right X */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#23262C] bg-[#121418] shrink-0">
          <div>
            <h2 className="text-base font-semibold text-[#E7E8EA] tracking-tight">Novo terminal</h2>
            <p className="text-[12px] text-[#8A8F98] mt-0.5">Configure um agente ou terminal interativo</p>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20] transition-colors"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Section: INÍCIO RÁPIDO */}
          <div>
            <span className="block text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider mb-2">
              Início Rápido
            </span>
            <div className="grid grid-cols-3 gap-2">
              {presets.filter((p) => p.id === 'shell' || installedMap[p.id] === true).map((preset) => {
                const isSelected = selectedPresetId === preset.id;

                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className={`py-2 px-2.5 rounded-xl text-xs transition-all border text-center ${
                      isSelected
                        ? 'bg-indigo-500/15 border-indigo-500 text-indigo-400 font-semibold shadow-sm'
                        : 'bg-[#181B20] border-[#23262C] text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20]/80'
                    }`}
                  >
                    <span className="text-[11px] font-medium leading-tight block">
                      {preset.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Segmented Tabs: Detalhes, Aparência, Agente */}
          <div className="grid grid-cols-3 p-1 bg-[#0E0F12] rounded-xl border border-[#23262C]">
            <button
              type="button"
              onClick={() => setActiveTab('detalhes')}
              className={`py-1.5 rounded-lg text-xs transition-colors ${
                activeTab === 'detalhes'
                  ? 'bg-[#181B20] text-[#E7E8EA] font-medium border border-[#23262C] shadow-sm'
                  : 'text-[#8A8F98] hover:text-[#E7E8EA]'
              }`}
            >
              Detalhes
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('aparencia')}
              className={`py-1.5 rounded-lg text-xs transition-colors ${
                activeTab === 'aparencia'
                  ? 'bg-[#181B20] text-[#E7E8EA] font-medium border border-[#23262C] shadow-sm'
                  : 'text-[#8A8F98] hover:text-[#E7E8EA]'
              }`}
            >
              Aparência
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('agente')}
              className={`py-1.5 rounded-lg text-xs transition-colors ${
                activeTab === 'agente'
                  ? 'bg-[#181B20] text-[#E7E8EA] font-medium border border-[#23262C] shadow-sm'
                  : 'text-[#8A8F98] hover:text-[#E7E8EA]'
              }`}
            >
              Agente
            </button>
          </div>

          {/* TAB 1: DETALHES */}
          {activeTab === 'detalhes' && (
            <div className="space-y-3.5 animate-in fade-in duration-100">
              {/* Nome e Comando lado a lado */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider mb-1.5">
                    Nome
                  </label>
                  <input
                    type="text"
                    value={terminalName}
                    onChange={(e) => setTerminalName(e.target.value)}
                    placeholder="Nome do terminal"
                    className="w-full h-9 px-3 bg-[#181B20] border border-[#23262C] rounded-xl text-xs text-[#E7E8EA] placeholder-[#8A8F98]/40 outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider mb-1.5">
                    Comando
                  </label>
                  <input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="ex.: agy, codex"
                    className="w-full h-9 px-3 bg-[#181B20] border border-[#23262C] rounded-xl text-xs font-mono text-[#E7E8EA] placeholder-[#8A8F98]/40 outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
              </div>

              {/* Modelo de IA (select dropdown) */}
              {AGENT_MODELS[selectedPresetId] && AGENT_MODELS[selectedPresetId].length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider">
                      Modelo de IA
                    </label>
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {selectedPresetId === 'antigravity' || selectedPresetId === 'claude'
                        ? '--model'
                        : selectedPresetId === 'codex' || selectedPresetId === 'opencode'
                        ? '-m'
                        : 'ollama run'}
                    </span>
                  </div>
                  <select
                    value={selectedModelId}
                    onChange={(e) => handleModelChange(e.target.value)}
                    className="w-full h-9 px-3 bg-[#181B20] border border-[#23262C] rounded-xl text-xs text-[#E7E8EA] outline-none focus:border-indigo-500 transition-colors cursor-pointer"
                  >
                    {AGENT_MODELS[selectedPresetId].map((m) => (
                      <option key={m.id} value={m.id} className="bg-[#14161A] text-white">
                        {m.label} ({m.id})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Executa em */}
              <div>
                <label className="block text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider mb-1.5">
                  Ambiente de Execução
                </label>
                <select
                  value={executionTarget}
                  onChange={(e) => setExecutionTarget(e.target.value)}
                  className="w-full h-9 px-3 bg-[#181B20] border border-[#23262C] rounded-xl text-xs text-[#E7E8EA] outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="workspace_default" className="bg-[#14161A] text-[#E7E8EA]">Padrão do espaço de trabalho (Local)</option>
                  <option value="local" className="bg-[#14161A] text-[#E7E8EA]">Local Host</option>
                  <option value="wsl" className="bg-[#14161A] text-[#E7E8EA]">WSL (Linux)</option>
                </select>
              </div>

              {/* Diretório de trabalho em linha inteira com Procurar ao lado */}
              <div>
                <label className="block text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider mb-1.5">
                  Diretório de trabalho
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={workingDirectory}
                    onChange={(e) => setWorkingDirectory(e.target.value)}
                    placeholder="ex.: C:\Projetos\meu-projeto"
                    className="flex-1 h-9 px-3 bg-[#181B20] border border-[#23262C] rounded-xl text-xs font-mono text-[#E7E8EA] placeholder-[#8A8F98]/40 outline-none focus:border-indigo-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={handlePickDirectory}
                    className="h-9 px-3.5 bg-[#181B20] hover:bg-[#23262C] border border-[#23262C] rounded-xl text-xs text-[#E7E8EA] flex items-center gap-1.5 transition-colors shrink-0"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Procurar...</span>
                  </button>
                </div>
              </div>

              {/* Interruptores (Switches) com divisores finos */}
              <div className="space-y-3 pt-2">
                {/* Switch 1: Monitorar atividade */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="text-xs font-medium text-[#E7E8EA]">Monitorar atividade</span>
                    <span className="text-[11px] text-[#8A8F98] leading-tight">
                      Detecta a saída do terminal e avisa quando o processo conclui.
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={monitorActivity}
                    aria-label="Monitorar atividade"
                    onClick={() => setMonitorActivity(!monitorActivity)}
                    className={`w-9 h-5 rounded-full transition-colors relative shrink-0 p-0.5 cursor-pointer ${
                      monitorActivity ? 'bg-indigo-600' : 'bg-[#23262C]'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-transform ${
                        monitorActivity ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="w-full h-[1px] bg-[#23262C]" />

                {/* Switch 2: Orquestrador */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-[#E7E8EA]">Modo Orquestrador</span>
                      <Wand2 className={`w-3 h-3 ${isOrchestrator ? 'text-amber-400' : 'text-zinc-500'}`} />
                      {isOrchestrator && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-medium">
                          Orquestrador
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-[#8A8F98] leading-tight">
                      Promove este terminal a orquestrador coordenador da equipe no canvas.
                    </span>
                    <span className="text-[10px] text-amber-400/80 leading-tight mt-0.5">
                      Após criado como Orquestrador, este modo não poderá ser desativado.
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isOrchestrator}
                    aria-label="Modo Orquestrador"
                    onClick={() => setIsOrchestrator(!isOrchestrator)}
                    className={`w-9 h-5 rounded-full transition-colors relative shrink-0 p-0.5 cursor-pointer ${
                      isOrchestrator ? 'bg-amber-500' : 'bg-[#23262C]'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-transform ${
                        isOrchestrator ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="w-full h-[1px] bg-[#23262C]" />

                {/* Switch 3: Knowledge Graph */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-[#E7E8EA]">Ancorar Knowledge Graph</span>
                      <Network className="w-3 h-3 text-indigo-400" />
                    </div>
                    <span className="text-[11px] text-[#8A8F98] leading-tight">
                      Injeta a arquitetura pré-computada e ativa GraphRAG com economia de tokens.
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={injectKnowledgeGraph}
                    aria-label="Ancorar Knowledge Graph"
                    onClick={() => setInjectKnowledgeGraph(!injectKnowledgeGraph)}
                    className={`w-9 h-5 rounded-full transition-colors relative shrink-0 p-0.5 cursor-pointer ${
                      injectKnowledgeGraph ? 'bg-indigo-600' : 'bg-[#23262C]'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full bg-white transition-transform ${
                        injectKnowledgeGraph ? 'translate-x-4' : 'translate-x-0'
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
                <label className="block text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider mb-1.5">
                  Família da Fonte
                </label>
                <select
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                  className="w-full h-9 px-3 bg-[#181B20] border border-[#23262C] rounded-xl text-xs text-[#E7E8EA] outline-none focus:border-[#8B93FF] cursor-pointer"
                >
                  <option value="Cascadia Mono, Consolas, monospace" className="bg-[#14161A] text-[#E7E8EA]">Cascadia Mono (Padrão)</option>
                  <option value="Consolas, 'Courier New', monospace" className="bg-[#14161A] text-[#E7E8EA]">Consolas</option>
                  <option value="'JetBrains Mono', monospace" className="bg-[#14161A] text-[#E7E8EA]">JetBrains Mono</option>
                  <option value="'Fira Code', monospace" className="bg-[#14161A] text-[#E7E8EA]">Fira Code</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider">
                    Tamanho da Fonte
                  </label>
                  <span className="text-xs font-mono text-[#8B93FF]">{fontSize}px</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="20"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-full accent-[#8B93FF] cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider mb-1.5">
                  Cor de Destaque
                </label>
                <div className="flex items-center gap-2.5">
                  {['#8B93FF', '#5FD3A0', '#FACC15', '#F87171', '#C084FC', '#38BDF8'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setThemeColor(c)}
                      style={{ backgroundColor: c }}
                      className={`w-6 h-6 rounded-full transition-transform ${
                        themeColor === c ? 'scale-110 ring-2 ring-offset-2 ring-offset-[#14161A] ring-[#8B93FF]' : 'opacity-70 hover:opacity-100'
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
                <label className="block text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider mb-1.5">
                  Papel / Função do Agente
                </label>
                <input
                  type="text"
                  value={agentRole}
                  onChange={(e) => setAgentRole(e.target.value)}
                  placeholder="ex.: Lead Architect, Frontend Specialist, Code Reviewer"
                  className="w-full h-9 px-3 bg-[#181B20] border border-[#23262C] rounded-xl text-xs text-[#E7E8EA] outline-none focus:border-[#8B93FF]"
                />
              </div>

              {/* Switch Modo Autônomo */}
              <div className="flex items-start justify-between gap-3 p-3 bg-[#181B20] rounded-xl border border-[#23262C]">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-[#E7E8EA]">Modo Autônomo</span>
                  <span className="text-[11px] text-[#8A8F98] leading-tight">
                    Executa ferramentas e comandos de código sem pausar para confirmação manual.
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isAutonomous}
                  aria-label="Modo Autônomo"
                  onClick={() => setIsAutonomous(!isAutonomous)}
                  className={`w-9 h-5 rounded-full transition-colors relative shrink-0 p-0.5 cursor-pointer ${
                    isAutonomous ? 'bg-[#8B93FF]' : 'bg-[#23262C]'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white transition-transform ${
                      isAutonomous ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#8A8F98] uppercase tracking-wider mb-1.5">
                  Instruções / Contexto Adicional
                </label>
                <textarea
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="Diretrizes específicas para este agente quando for acionado via mindAgentics ask..."
                  rows={3}
                  className="w-full p-3 bg-[#181B20] border border-[#23262C] rounded-xl text-xs text-[#E7E8EA] placeholder-[#8A8F98]/40 outline-none focus:border-[#8B93FF]"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer: Criar terminal (double width) + Cancelar */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-[#23262C] bg-[#121418] shrink-0">
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="flex-1 h-10 rounded-xl text-xs font-medium text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#181B20] transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleCreate}
            style={{ flex: 2 }}
            className="h-10 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <span>Criar terminal</span>
          </button>
        </div>
      </div>
    </div>
  );
};
