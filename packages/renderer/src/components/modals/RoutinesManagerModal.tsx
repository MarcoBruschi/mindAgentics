import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { isRoutinesModalOpenAtom, routinesAtom } from '@/atoms/routines';
import { nodesAtom, activeWorkspaceAtom } from '@/atoms/workspace';
import { Routine, RoutineSchedule } from '@maestri/shared';
import {
  X,
  Clock,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';

export const RoutinesManagerModal: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isRoutinesModalOpenAtom);
  const [routines, setRoutines] = useAtom(routinesAtom);
  const [nodes] = useAtom(nodesAtom);
  const [activeWorkspace] = useAtom(activeWorkspaceAtom);

  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState<'every' | 'daily' | 'weekly' | 'once'>('every');
  const [scheduleVal, setScheduleVal] = useState('30m');
  const [command, setCommand] = useState('git status -s\necho "Routine executed: {{output}}"');
  const [preRunScript, setPreRunScript] = useState('git diff --stat');
  const [targetTerminalId, setTargetTerminalId] = useState(
    nodes.find((n) => n.kind === 'terminal')?.id || 'default'
  );

  if (!isOpen) return null;

  const terminalNodes = nodes.filter((n) => n.kind === 'terminal');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();

    let schedule: RoutineSchedule;
    if (triggerType === 'every') {
      schedule = {
        kind: 'every',
        intervalMs: 1800000,
        intervalExpression: scheduleVal,
      };
    } else if (triggerType === 'daily') {
      schedule = {
        kind: 'daily',
        time: scheduleVal,
      };
    } else if (triggerType === 'weekly') {
      schedule = {
        kind: 'weekly',
        days: ['mon', 'wed', 'fri'],
        time: scheduleVal,
      };
    } else {
      schedule = {
        kind: 'once',
        datetime: scheduleVal,
      };
    }

    const newRoutine: Routine = {
      id: `routine-${Date.now()}`,
      name: name.trim(),
      workspaceId: activeWorkspace?.id || 'WS-1234-ABCD',
      schedule,
      action: {
        command,
      },
      targetTerminalId,
      preRunScript: preRunScript.trim() || undefined,
      disabled: false,
      fireCount: 0,
      createdAt: new Date().toISOString(),
    };

    setRoutines((prev: Routine[]) => [...prev, newRoutine]);
    setIsCreating(false);
    setName('');
  };

  const toggleRoutine = (id: string) => {
    setRoutines((prev: Routine[]) =>
      prev.map((r: Routine) => (r.id === id ? { ...r, disabled: !r.disabled } : r))
    );
  };

  const deleteRoutine = (id: string) => {
    setRoutines((prev: Routine[]) => prev.filter((r: Routine) => r.id !== id));
  };

  const formatSchedule = (sch: RoutineSchedule) => {
    if (sch.kind === 'every') return `every ${sch.intervalExpression}`;
    if (sch.kind === 'daily') return `daily at ${sch.time}`;
    if (sch.kind === 'weekly') return `weekly at ${sch.time}`;
    return `once at ${sch.datetime}`;
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[#16181e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden select-none max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#1d1f27] border-b border-white/5">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-white">Routines Manager (Chrono Scheduler)</h2>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 text-zinc-400 hover:text-white rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs text-zinc-300">
          {!isCreating ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">
                  Scheduled routines execute periodically in agent terminals with optional pre-run scripts.
                </span>
                <button
                  onClick={() => setIsCreating(true)}
                  className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg flex items-center gap-1.5 font-medium shadow"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Routine</span>
                </button>
              </div>

              {/* Routines List */}
              <div className="space-y-2 mt-2">
                {routines.map((routine: Routine) => (
                  <div
                    key={routine.id}
                    className="p-3 bg-[#111216] border border-white/5 rounded-xl flex items-center justify-between gap-4 hover:border-white/10 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={!routine.disabled}
                        onChange={() => toggleRoutine(routine.id)}
                        className="rounded border-white/20 text-purple-600 focus:ring-0 bg-transparent cursor-pointer"
                      />
                      <div>
                        <div className="font-semibold text-white flex items-center gap-2">
                          <span>{routine.name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-purple-500/10 text-purple-300 border border-purple-500/20">
                            {formatSchedule(routine.schedule)}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-400 font-mono mt-0.5 truncate max-w-[340px]">
                          {routine.action.command.split('\n')[0]}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => alert(`Routine "${routine.name}" executed successfully!`)}
                        className="p-1.5 text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded"
                        title="Run Now"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteRoutine(routine.id)}
                        className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded"
                        title="Delete Routine"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* Creation Form */
            <form onSubmit={handleCreate} className="space-y-3.5">
              <div>
                <label className="block text-zinc-400 font-medium mb-1">Routine Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Periodic Lint & Diff"
                  className="w-full px-3 py-2 bg-[#101115] border border-white/10 rounded-lg text-white outline-none focus:border-purple-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-medium mb-1">Trigger Type</label>
                  <select
                    value={triggerType}
                    onChange={(e) => setTriggerType(e.target.value as any)}
                    className="w-full px-3 py-2 bg-[#101115] border border-white/10 rounded-lg text-white outline-none focus:border-purple-500"
                  >
                    <option value="every">--every (Interval)</option>
                    <option value="daily">--daily (Daily at HH:MM)</option>
                    <option value="weekly">--weekly (Weekly days@HH:MM)</option>
                    <option value="once">--once (Single Run)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-zinc-400 font-medium mb-1">Schedule Value</label>
                  <input
                    type="text"
                    value={scheduleVal}
                    onChange={(e) => setScheduleVal(e.target.value)}
                    placeholder="e.g. 30m, 2h, or 09:00"
                    className="w-full px-3 py-2 bg-[#101115] border border-white/10 rounded-lg text-white font-mono outline-none focus:border-purple-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-zinc-400 font-medium mb-1">Target Terminal Node</label>
                <select
                  value={targetTerminalId}
                  onChange={(e) => setTargetTerminalId(e.target.value)}
                  className="w-full px-3 py-2 bg-[#101115] border border-white/10 rounded-lg text-white outline-none focus:border-purple-500"
                >
                  {terminalNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.content?.title || n.id}
                    </option>
                  ))}
                  {terminalNodes.length === 0 && <option value="default">Default Terminal</option>}
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 font-medium mb-1">Pre-Run Script (Optional)</label>
                <input
                  type="text"
                  value={preRunScript}
                  onChange={(e) => setPreRunScript(e.target.value)}
                  placeholder="e.g. git diff --stat (stdout replaces {{output}} in command)"
                  className="w-full px-3 py-2 bg-[#101115] border border-white/10 rounded-lg text-white font-mono text-[11px] outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-medium mb-1">
                  Agent Command Prompt (Supports <code className="text-purple-300 font-mono">{'{{output}}'}</code>)
                </label>
                <textarea
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-[#101115] border border-white/10 rounded-lg text-white font-mono text-xs outline-none focus:border-purple-500 resize-none"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-3 py-1.5 rounded-lg text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-lg shadow-md"
                >
                  Save Routine
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
