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

const tabColors: Record<NoteColor, { dot: string; text: string }> = {
  yellow: { dot: 'bg-amber-400', text: 'text-amber-300' },
  blue: { dot: 'bg-[#8B93FF]', text: 'text-[#8B93FF]' },
  green: { dot: 'bg-[#5FD3A0]', text: 'text-[#5FD3A0]' },
  pink: { dot: 'bg-pink-400', text: 'text-pink-300' },
  purple: { dot: 'bg-purple-400', text: 'text-purple-300' },
  gray: { dot: 'bg-zinc-400', text: 'text-zinc-300' },
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
    <div className="flex flex-col w-full h-full bg-[#14161A] border border-[#23262C] rounded-2xl overflow-hidden shadow-2xl transition-all">
      {/* Header */}
      <div className="node-drag-handle h-9 px-3 bg-[#181B20] border-b border-[#23262C] flex items-center justify-between cursor-move select-none">
        <div className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-[#8B93FF]" />
          <span className="text-xs font-semibold text-[#E7E8EA] truncate max-w-[140px]">
            {content.title || 'Fichário'}
          </span>
          <span className="text-[10px] text-[#8A8F98] bg-[#0E0F12] border border-[#23262C] px-2 py-0.5 rounded-full font-mono">
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
            className="w-7 h-7 flex items-center justify-center text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#23262C] rounded-lg transition-colors"
            title="Alternar orientação das abas"
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
            className="w-7 h-7 flex items-center justify-center text-[#8A8F98] hover:text-[#5FD3A0] hover:bg-[#5FD3A0]/10 rounded-lg transition-colors"
            title="Adicionar página"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          {/* Delete Page */}
          <button
            onClick={removeActivePage}
            disabled={pages.length <= 1}
            className="w-7 h-7 flex items-center justify-center text-[#8A8F98] hover:text-red-400 hover:bg-red-500/10 rounded-lg disabled:opacity-30 transition-colors"
            title="Excluir página atual"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {/* Close Stack */}
          <button
            onClick={() => onDelete(node.id)}
            className="w-7 h-7 flex items-center justify-center text-[#8A8F98] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            title="Excluir fichário"
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
              ? 'flex flex-row overflow-x-auto border-b border-[#23262C] bg-[#0E0F12]'
              : 'flex flex-col w-32 overflow-y-auto border-r border-[#23262C] bg-[#0E0F12]'
          } p-1.5 gap-1 select-none scrollbar-thin`}
        >
          {pages.map((p, idx) => {
            const isCurrent = idx === activeIndex;
            const colorMeta = tabColors[p.color || 'blue'] || tabColors.blue;

            return (
              <button
                key={p.id}
                onClick={() => setActivePage(idx)}
                className={`flex items-center text-left text-xs px-2.5 py-1.5 rounded-lg transition-all truncate ${
                  isCurrent
                    ? 'bg-[#181B20] font-medium text-[#E7E8EA] border border-[#23262C] shadow-sm'
                    : 'text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-[#14161A]/60'
                }`}
                title={p.title}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 mr-2 ${colorMeta.dot}`} />
                <span className="truncate">{p.title}</span>
              </button>
            );
          })}
        </div>

        {/* Page Content Viewport */}
        <div className="flex-1 flex flex-col p-3 overflow-hidden bg-[#14161A]">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#23262C]">
            <input
              type="text"
              value={activePage.title}
              onChange={(e) => updatePageTitle(e.target.value)}
              className="bg-transparent font-medium text-xs text-[#E7E8EA] outline-none focus:text-[#8B93FF] w-2/3 transition-colors"
            />
            {/* Quick page flippers */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActivePage(Math.max(0, activeIndex - 1))}
                disabled={activeIndex === 0}
                className="w-6 h-6 flex items-center justify-center text-[#8A8F98] hover:text-[#E7E8EA] rounded hover:bg-[#23262C] disabled:opacity-20 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setActivePage(Math.min(pages.length - 1, activeIndex + 1))}
                disabled={activeIndex === pages.length - 1}
                className="w-6 h-6 flex items-center justify-center text-[#8A8F98] hover:text-[#E7E8EA] rounded hover:bg-[#23262C] disabled:opacity-20 transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <textarea
            value={activePage.body}
            onChange={(e) => updatePageBody(e.target.value)}
            placeholder="Digite anotações em Markdown..."
            className="flex-1 w-full bg-transparent text-xs text-[#E7E8EA] font-mono resize-none outline-none leading-relaxed placeholder-[#8A8F98]/40"
          />
        </div>
      </div>
    </div>
  );
};
