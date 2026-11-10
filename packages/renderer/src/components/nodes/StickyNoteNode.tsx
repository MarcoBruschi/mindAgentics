import React, { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { NoteNode as NoteNodeType, NoteContent, NoteColor } from '@mindagentics/shared';
import { Pin, Eye, Edit3, X, Palette } from 'lucide-react';

interface StickyNoteNodeProps {
  node: NoteNodeType;
  onUpdate: (updated: NoteNodeType) => void;
  onDelete: (id: string) => void;
}

const colorThemes: Record<
  NoteColor,
  { bg: string; border: string; header: string; text: string; badge: string; dot: string }
> = {
  yellow: {
    bg: 'bg-[#14161A]',
    border: 'border-amber-500/20 hover:border-amber-500/40',
    header: 'bg-[#181B20]',
    text: 'text-[#E7E8EA]',
    badge: 'bg-amber-400',
    dot: 'bg-amber-400',
  },
  blue: {
    bg: 'bg-[#14161A]',
    border: 'border-indigo-500/20 hover:border-indigo-500/40',
    header: 'bg-[#181B20]',
    text: 'text-[#E7E8EA]',
    badge: 'bg-indigo-400',
    dot: 'bg-indigo-400',
  },
  green: {
    bg: 'bg-[#14161A]',
    border: 'border-emerald-500/20 hover:border-emerald-500/40',
    header: 'bg-[#181B20]',
    text: 'text-[#E7E8EA]',
    badge: 'bg-emerald-400',
    dot: 'bg-emerald-400',
  },
  pink: {
    bg: 'bg-[#14161A]',
    border: 'border-pink-500/20 hover:border-pink-500/40',
    header: 'bg-[#181B20]',
    text: 'text-[#E7E8EA]',
    badge: 'bg-pink-400',
    dot: 'bg-pink-400',
  },
  purple: {
    bg: 'bg-[#14161A]',
    border: 'border-purple-500/20 hover:border-purple-500/40',
    header: 'bg-[#181B20]',
    text: 'text-[#E7E8EA]',
    badge: 'bg-purple-400',
    dot: 'bg-purple-400',
  },
  gray: {
    bg: 'bg-[#14161A]',
    border: 'border-white/[0.08] hover:border-white/[0.15]',
    header: 'bg-[#181B20]',
    text: 'text-[#E7E8EA]',
    badge: 'bg-zinc-400',
    dot: 'bg-zinc-400',
  },
};

export const StickyNoteNode: React.FC<StickyNoteNodeProps> = ({
  node,
  onUpdate,
  onDelete,
}) => {
  const nodeRef = useRef(node);
  nodeRef.current = node;

  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [title, setTitle] = useState(node.content.title);
  const [showColorPicker, setShowColorPicker] = useState(false);

  const currentColor = node.content.color || 'yellow';
  const theme = colorThemes[currentColor] || colorThemes.yellow;

  // Initialize CodeMirror 6 Editor
  useEffect(() => {
    if (!editorContainerRef.current || mode !== 'edit') return;

    const startState = EditorState.create({
      doc: node.content.body || node.content.text || '',
      extensions: [
        keymap.of(defaultKeymap),
        markdown(),
        oneDark,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newText = update.state.doc.toString();
            // If title is not pinned, update title from first markdown header
            let updatedTitle = nodeRef.current.content.title;
            if (!nodeRef.current.content.isNamePinned) {
              const firstLine = newText.split('\n')[0]?.trim();
              if (firstLine?.startsWith('#')) {
                updatedTitle = firstLine.replace(/^#+\s*/, '') || updatedTitle;
              }
            }

            onUpdate({
              ...nodeRef.current,
              content: {
                ...nodeRef.current.content,
                body: newText,
                text: newText,
                title: updatedTitle,
              },
            });
          }
        }),
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: editorContainerRef.current,
    });

    editorViewRef.current = view;

    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
  }, [mode]);

  const togglePin = () => {
    onUpdate({
      ...nodeRef.current,
      content: {
        ...nodeRef.current.content,
        isNamePinned: !nodeRef.current.content.isNamePinned,
      },
    });
  };

  const changeColor = (c: NoteColor) => {
    onUpdate({
      ...nodeRef.current,
      content: {
        ...nodeRef.current.content,
        color: c,
      },
    });
    setShowColorPicker(false);
  };

  return (
    <div
      className={`group flex flex-col w-full h-full border ${theme.border} ${theme.bg} rounded-xl overflow-hidden transition-all shadow-xl`}
    >
      {/* Header (Standard 36px / h-9 Height) */}
      <div
        className="node-drag-handle h-9 px-3 bg-[#181B20] border-b border-white/[0.07] flex items-center justify-between cursor-move select-none"
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {/* Note color dot indicator and picker */}
          <div className="relative flex items-center">
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="p-1 text-[#8A8F98] hover:text-[#E7E8EA] rounded-lg hover:bg-white/[0.06] transition-colors flex items-center gap-1.5"
              title="Cor da nota"
            >
              <span className={`w-2.5 h-2.5 rounded-full ${theme.dot}`} />
            </button>

            {showColorPicker && (
              <div className="absolute left-0 top-8 flex items-center gap-1.5 p-1.5 bg-[#181B20] border border-white/[0.08] rounded-xl shadow-2xl z-50">
                {(Object.keys(colorThemes) as NoteColor[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => changeColor(c)}
                    className={`w-4 h-4 rounded-full ${colorThemes[c].badge} transition-transform hover:scale-125 ${
                      currentColor === c ? 'ring-2 ring-white/60' : ''
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          {isEditingTitle ? (
            <input
              type="text"
              value={title}
              autoFocus
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                setIsEditingTitle(false);
                onUpdate({
                  ...nodeRef.current,
                  content: { ...nodeRef.current.content, title, isNamePinned: true },
                });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setIsEditingTitle(false);
                  onUpdate({
                    ...nodeRef.current,
                    content: { ...nodeRef.current.content, title, isNamePinned: true },
                  });
                }
              }}
              className="bg-[#0E0F12] text-[#E7E8EA] text-xs px-2 py-0.5 rounded-lg outline-none border border-indigo-500"
            />
          ) : (
            <span
              onDoubleClick={() => setIsEditingTitle(true)}
              className="text-xs font-semibold text-[#E7E8EA] hover:text-white cursor-text truncate max-w-[170px]"
              title="Clique duas vezes para renomear"
            >
              {node.content.title}
            </span>
          )}

          {/* Pin Button */}
          <button
            onClick={togglePin}
            className={`p-1 rounded-lg transition-colors ${
              node.content.isNamePinned
                ? 'text-amber-400 rotate-45'
                : 'text-[#8A8F98]/50 hover:text-[#8A8F98]'
            }`}
            title={node.content.isNamePinned ? 'Título fixado' : 'Título automático pela 1ª linha'}
          >
            <Pin className="w-3 h-3" />
          </button>
        </div>

        {/* Action Controls (opacity transition on group-hover) */}
        <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
          {/* Mode Switch (Edit / Preview) */}
          <button
            onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}
            className="w-7 h-7 flex items-center justify-center text-[#8A8F98] hover:text-[#E7E8EA] hover:bg-white/[0.06] rounded-lg transition-colors"
            title={mode === 'edit' ? 'Visualizar Markdown' : 'Editar Markdown'}
          >
            {mode === 'edit' ? <Eye className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
          </button>

          {/* Delete Button */}
          <button
            onClick={() => onDelete(node.id)}
            className="w-7 h-7 flex items-center justify-center text-[#8A8F98] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            title="Excluir Nota"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Note Body */}
      <div className="flex-1 w-full h-[calc(100%-36px)] p-3 overflow-auto bg-[#14161A]">
        {mode === 'edit' ? (
          <div ref={editorContainerRef} className="w-full h-full text-xs font-mono text-[#E7E8EA]" />
        ) : (
          <div className="w-full h-full text-xs space-y-2 prose prose-invert max-w-none p-1">
            <div className="whitespace-pre-wrap font-sans leading-relaxed text-[#E7E8EA]">
              {node.content.body || '(Nota vazia)'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
