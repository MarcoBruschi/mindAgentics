import React, { useState } from 'react';
import {
  NoteStackNode as NoteStackNodeType,
  NoteColor,
  NoteStackPage,
} from '@mindagentics/shared';
import {
  BookOpen,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
  LayoutList,
  Columns,
} from 'lucide-react';

interface NoteStackNodeProps {
  node: NoteStackNodeType;
  onUpdate: (updated: NoteStackNodeType) => void;
  onDelete: (id: string) => void;
}

const tabColors: Record<NoteColor, string> = {
  yellow: 'border-l-yellow-400 text-yellow-300',
  blue: 'border-l-blue-400 text-blue-300',
  green: 'border-l-emerald-400 text-emerald-300',
  pink: 'border-l-pink-400 text-pink-300',
  purple: 'border-l-purple-400 text-purple-300',
  gray: 'border-l-zinc-400 text-zinc-300',
};

export const NoteStackNode: React.FC<NoteStackNodeProps> = ({
  node,
  onUpdate,
  onDelete,
}) => {
  const nodeRef = React.useRef(node);
  nodeRef.current = node;

  const content = node.content;
  const pages: NoteStackPage[] = content.pages || [];
  const activeIndex = Math.min(content.activePageIndex || 0, Math.max(0, pages.length - 1));
  const activePage: NoteStackPage = pages[activeIndex] || {
    id: 'page-default',
    title: 'Page 1',
    body: '',
    color: 'blue',
  };

  const [tabOrientation, setTabOrientation] = useState<'side' | 'top'>(
    content.tabOrientation || 'side'
  );

  const setActivePage = (index: number) => {
    onUpdate({
      ...nodeRef.current,
      content: {
        ...nodeRef.current.content,
        activePageIndex: index,
      },
    });
  };

  const addPage = () => {
    const currentPages = nodeRef.current.content.pages || [];
    const newPageNum = currentPages.length + 1;
    const colors: NoteColor[] = ['blue', 'purple', 'pink', 'green', 'yellow', 'gray'];
    const newPage: NoteStackPage = {
      id: `page-${Date.now()}`,
      title: `Page ${newPageNum}`,
      body: `## Page ${newPageNum}\n\nStart typing content here...`,
      color: colors[currentPages.length % colors.length],
    };

    onUpdate({
      ...nodeRef.current,
      content: {
        ...nodeRef.current.content,
        pages: [...currentPages, newPage],
        activePageIndex: currentPages.length,
      },
    });
  };

  const removeActivePage = () => {
    const currentPages = nodeRef.current.content.pages || [];
    if (currentPages.length <= 1) return;
    const filtered = currentPages.filter((_: NoteStackPage, idx: number) => idx !== activeIndex);
    onUpdate({
      ...nodeRef.current,
      content: {
        ...nodeRef.current.content,
        pages: filtered,
        activePageIndex: Math.max(0, activeIndex - 1),
      },
    });
  };

  const updatePageBody = (text: string) => {
    const currentPages = nodeRef.current.content.pages || [];
    const updatedPages = currentPages.map((p: NoteStackPage, idx: number) =>
      idx === activeIndex ? { ...p, body: text } : p
    );
    onUpdate({
      ...nodeRef.current,
      content: {
        ...nodeRef.current.content,
        pages: updatedPages,
      },
    });
  };

  const updatePageTitle = (title: string) => {
    const updatedPages = pages.map((p: NoteStackPage, idx: number) =>
      idx === activeIndex ? { ...p, title } : p
    );
    onUpdate({
      ...node,
      content: {
        ...content,
        pages: updatedPages,
      },
    });
  };

  return (
    <div className="flex flex-col w-full h-full bg-[#181a20] border border-blue-500/30 rounded-xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="node-drag-handle flex items-center justify-between px-3 py-1.5 bg-[#1f222a] border-b border-white/10 cursor-move">
        <div className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-xs font-semibold text-zinc-200 truncate max-w-[140px]">
            {content.title || 'Fichário'}
          </span>
          <span className="text-[10px] text-zinc-400 bg-white/5 px-1.5 py-0.5 rounded">
            {activeIndex + 1} / {pages.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Flip orientation toggle */}
          <button
            onClick={() => {
              const next = tabOrientation === 'side' ? 'top' : 'side';
              setTabOrientation(next);
              onUpdate({
                ...node,
                content: { ...content, tabOrientation: next },
              });
            }}
            className="p-1 text-zinc-400 hover:text-white rounded"
            title="Toggle Tab Orientation (Side / Top)"
          >
            {tabOrientation === 'side' ? (
              <LayoutList className="w-3.5 h-3.5" />
            ) : (
              <Columns className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Add Page */}
          <button
            onClick={addPage}
            className="p-1 text-zinc-400 hover:text-emerald-400 rounded hover:bg-emerald-500/10"
            title="Add Page to Binder"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          {/* Delete Page */}
          <button
            onClick={removeActivePage}
            disabled={pages.length <= 1}
            className="p-1 text-zinc-400 hover:text-red-400 rounded disabled:opacity-30"
            title="Delete Current Page"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {/* Close Stack */}
          <button
            onClick={() => onDelete(node.id)}
            className="p-1 text-zinc-400 hover:text-red-400 rounded"
            title="Close Stack"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Binder View */}
      <div
        className={`flex-1 flex overflow-hidden ${
          tabOrientation === 'top' ? 'flex-col' : 'flex-row'
        }`}
      >
        {/* Tabs Rail */}
        <div
          className={`${
            tabOrientation === 'top'
              ? 'flex flex-row overflow-x-auto border-b border-white/5 bg-[#14151a]'
              : 'flex flex-col w-28 overflow-y-auto border-r border-white/5 bg-[#14151a]'
          } p-1 gap-1 select-none scrollbar-thin`}
        >
          {pages.map((p, idx) => {
            const isCurrent = idx === activeIndex;
            const colorClass = tabColors[p.color || 'blue'] || tabColors.blue;

            return (
              <button
                key={p.id}
                onClick={() => setActivePage(idx)}
                className={`flex items-center text-left text-xs px-2 py-1.5 rounded transition-all truncate border-l-2 ${
                  isCurrent
                    ? `bg-[#242731] font-semibold text-white ${colorClass}`
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5 border-l-transparent'
                }`}
                title={p.title}
              >
                <span className="truncate">{p.title}</span>
              </button>
            );
          })}
        </div>

        {/* Page Content Viewport */}
        <div className="flex-1 flex flex-col p-3 overflow-hidden bg-[#181a20]">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/5">
            <input
              type="text"
              value={activePage.title}
              onChange={(e) => updatePageTitle(e.target.value)}
              className="bg-transparent font-medium text-xs text-white outline-none hover:border-b border-blue-500/40 w-2/3"
            />
            {/* Quick page flippers */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActivePage(Math.max(0, activeIndex - 1))}
                disabled={activeIndex === 0}
                className="p-1 text-zinc-400 hover:text-white disabled:opacity-20"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setActivePage(Math.min(pages.length - 1, activeIndex + 1))}
                disabled={activeIndex === pages.length - 1}
                className="p-1 text-zinc-400 hover:text-white disabled:opacity-20"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <textarea
            value={activePage.body}
            onChange={(e) => updatePageBody(e.target.value)}
            placeholder="Type page markdown notes..."
            className="flex-1 w-full bg-transparent text-xs text-zinc-300 font-mono resize-none outline-none leading-relaxed"
          />
        </div>
      </div>
    </div>
  );
};
