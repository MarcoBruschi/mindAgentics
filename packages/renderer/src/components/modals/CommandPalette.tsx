import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import {
  isCommandPaletteOpenAtom,
  isAccountsModalOpenAtom,
  isWorkspaceSettingsModalOpenAtom,
  isCreateFloorModalOpenAtom,
  isFloorLandingModalOpenAtom,
} from '@/atoms/ui';
import { isRoutinesModalOpenAtom } from '@/atoms/routines';
import { canvasOffsetAtom } from '@/atoms/canvas';
import { nodesAtom, bandsAtom } from '@/atoms/workspace';
import { agentPresetsAtom } from '@/atoms/presets';
import {
  Search,
  Terminal,
  FileText,
  BookOpen,
  Globe,
  Plus,
  Clock,
  Key,
  Settings,
  GitMerge,
  Maximize,
} from 'lucide-react';

interface PaletteAction {
  id: string;
  title: string;
  category: string;
  icon: React.ReactNode;
  perform: () => void;
}

export const CommandPalette: React.FC = () => {
  const [isOpen, setIsOpen] = useAtom(isCommandPaletteOpenAtom);
  const [, setIsSettingsOpen] = useAtom(isWorkspaceSettingsModalOpenAtom);
  const [, setIsCreateFloorOpen] = useAtom(isCreateFloorModalOpenAtom);
  const [, setIsFloorLandingOpen] = useAtom(isFloorLandingModalOpenAtom);
  const [, setIsRoutinesOpen] = useAtom(isRoutinesModalOpenAtom);
  const [, setIsAccountsOpen] = useAtom(isAccountsModalOpenAtom);

  const [offset, setOffset] = useAtom(canvasOffsetAtom);
  const [, setNodes] = useAtom(nodesAtom);
  const [presets] = useAtom(agentPresetsAtom);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setIsOpen]);

  if (!isOpen) return null;

  const actions: PaletteAction[] = [
    {
      id: 'add-antigravity',
      title: 'New Terminal: Antigravity Agent',
      category: 'Canvas Nodes',
      icon: <Terminal className="w-4 h-4 text-blue-400" />,
      perform: () => {
        setNodes((prev) => [
          ...prev,
          {
            id: `node-term-${Date.now()}`,
            kind: 'terminal',
            x: -offset.x + 300,
            y: -offset.y + 200,
            width: 680,
            height: 440,
            zIndex: 30,
            content: {
              terminalId: `term-${Date.now()}`,
              presetId: presets[2]?.id,
              title: 'Antigravity Session',
              agentRole: 'Lead Architect',
              status: 'idle',
              hasAttention: false,
            },
          },
        ]);
      },
    },
    {
      id: 'add-claude',
      title: 'New Terminal: Claude Code',
      category: 'Canvas Nodes',
      icon: <Terminal className="w-4 h-4 text-orange-400" />,
      perform: () => {
        setNodes((prev) => [
          ...prev,
          {
            id: `node-term-${Date.now()}`,
            kind: 'terminal',
            x: -offset.x + 300,
            y: -offset.y + 200,
            width: 680,
            height: 440,
            zIndex: 30,
            content: {
              terminalId: `term-${Date.now()}`,
              presetId: presets[0]?.id,
              title: 'Claude Code Session',
              agentRole: 'Engineer',
              status: 'idle',
              hasAttention: false,
            },
          },
        ]);
      },
    },
    {
      id: 'add-note',
      title: 'New Sticky Note',
      category: 'Canvas Nodes',
      icon: <FileText className="w-4 h-4 text-yellow-400" />,
      perform: () => {
        setNodes((prev) => [
          ...prev,
          {
            id: `node-note-${Date.now()}`,
            kind: 'note',
            x: -offset.x + 350,
            y: -offset.y + 220,
            width: 340,
            height: 280,
            zIndex: 30,
            content: {
              noteId: `note-${Date.now()}`,
              title: 'New Note',
              body: '# Note Title\n\n- Tasks and specifications',
              isNamePinned: false,
              color: 'yellow',
              stackId: null,
            },
          },
        ]);
      },
    },
    {
      id: 'add-fichario',
      title: 'New Binder (Fichário)',
      category: 'Canvas Nodes',
      icon: <BookOpen className="w-4 h-4 text-purple-400" />,
      perform: () => {
        setNodes((prev) => [
          ...prev,
          {
            id: `node-stack-${Date.now()}`,
            kind: 'noteStack',
            x: -offset.x + 380,
            y: -offset.y + 240,
            width: 380,
            height: 340,
            zIndex: 30,
            content: {
              stackId: `stack-${Date.now()}`,
              title: 'Fichário',
              noteIds: ['p1'],
              activePageIndex: 0,
              pages: [
                { id: 'p1', title: 'Doc 1', body: '## Notes page 1', color: 'blue' },
              ],
            },
          },
        ]);
      },
    },
    {
      id: 'add-portal',
      title: 'New Browser Portal',
      category: 'Canvas Nodes',
      icon: <Globe className="w-4 h-4 text-emerald-400" />,
      perform: () => {
        setNodes((prev) => [
          ...prev,
          {
            id: `node-portal-${Date.now()}`,
            kind: 'portal',
            x: -offset.x + 320,
            y: -offset.y + 200,
            width: 720,
            height: 500,
            zIndex: 30,
            content: {
              portalKind: 'browser',
              url: 'https://example.com',
              viewport: { width: 1280, height: 800 },
              actionTags: [],
            },
          },
        ]);
      },
    },
    {
      id: 'create-floor',
      title: 'Create Isolated Floor (Git Worktree)',
      category: 'Floors',
      icon: <Plus className="w-4 h-4 text-blue-400" />,
      perform: () => setIsCreateFloorOpen(true),
    },
    {
      id: 'land-floor',
      title: 'Land Current Floor (Merge into Ground)',
      category: 'Floors',
      icon: <GitMerge className="w-4 h-4 text-emerald-400" />,
      perform: () => setIsFloorLandingOpen(true),
    },
    {
      id: 'routines',
      title: 'Open Routines Manager',
      category: 'Settings & Automation',
      icon: <Clock className="w-4 h-4 text-purple-400" />,
      perform: () => setIsRoutinesOpen(true),
    },
    {
      id: 'accounts',
      title: 'Configure Accounts & API Keys',
      category: 'Settings & Automation',
      icon: <Key className="w-4 h-4 text-amber-400" />,
      perform: () => setIsAccountsOpen(true),
    },
    {
      id: 'settings',
      title: 'Workspace Settings',
      category: 'Settings & Automation',
      icon: <Settings className="w-4 h-4 text-zinc-400" />,
      perform: () => setIsSettingsOpen(true),
    },
    {
      id: 'reset-zoom',
      title: 'Reset Canvas View (100% Zoom, Origin 0,0)',
      category: 'Canvas Navigation',
      icon: <Maximize className="w-4 h-4 text-zinc-400" />,
      perform: () => setOffset({ x: 0, y: 0, zoom: 1.0 }),
    },
  ];

  const filtered = actions.filter((action) =>
    action.title.toLowerCase().includes(query.toLowerCase()) ||
    action.category.toLowerCase().includes(query.toLowerCase())
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].perform();
        setIsOpen(false);
      }
    }
  };

  return (
    <div
      onClick={() => setIsOpen(false)}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center pt-24 p-4 select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-[#16181f] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Search Input */}
        <div className="flex items-center px-4 py-3 bg-[#1d1f27] border-b border-white/5">
          <Search className="w-4 h-4 text-zinc-400 mr-2.5 shrink-0" />
          <input
            type="text"
            value={query}
            autoFocus
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search action..."
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
          />
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-black/40 rounded border border-white/10 text-zinc-400">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-xs text-zinc-500">
              No actions found matching "{query}"
            </div>
          ) : (
            filtered.map((action, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={action.id}
                  onClick={() => {
                    action.perform();
                    setIsOpen(false);
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-blue-600/20 text-white border border-blue-500/40'
                      : 'text-zinc-300 hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {action.icon}
                    <span className="font-medium">{action.title}</span>
                  </div>
                  <span className="text-[10px] text-zinc-500">{action.category}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
