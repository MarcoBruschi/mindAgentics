import React, { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { NoteNode as NoteNodeType, NoteContent, NoteColor } from '@maestri/shared';
import { Pin, Eye, Edit3, X, Palette } from 'lucide-react';

interface StickyNoteNodeProps {
  node: NoteNodeType;
  onUpdate: (updated: NoteNodeType) => void;
  onDelete: (id: string) => void;
}

const colorThemes: Record<
  NoteColor,
  { bg: string; border: string; header: string; text: string; badge: string }
> = {
  yellow: {
    bg: 'bg-[#2a2616]',
    border: 'border-yellow-500/30',
    header: 'bg-[#35301b]',
    text: 'text-yellow-100',
    badge: 'bg-yellow-400',
  },
  blue: {
    bg: 'bg-[#182333]',
    border: 'border-blue-500/30',
    header: 'bg-[#1d2d42]',
    text: 'text-blue-100',
    badge: 'bg-blue-400',
  },
  green: {
    bg: 'bg-[#15271e]',
    border: 'border-emerald-500/30',
    header: 'bg-[#1b3328]',
    text: 'text-emerald-100',
    badge: 'bg-emerald-400',
  },
  pink: {
    bg: 'bg-[#2b1723]',
    border: 'border-pink-500/30',
    header: 'bg-[#371d2c]',
    text: 'text-pink-100',
    badge: 'bg-pink-400',
  },
  purple: {
    bg: 'bg-[#231830]',
    border: 'border-purple-500/30',
    header: 'bg-[#2e1f3f]',
    text: 'text-purple-100',
    badge: 'bg-purple-400',
  },
  gray: {
    bg: 'bg-[#1a1c20]',
    border: 'border-zinc-500/30',
    header: 'bg-[#22242a]',
    text: 'text-zinc-200',
    badge: 'bg-zinc-400',
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
      className={`flex flex-col w-full h-full border ${theme.border} ${theme.bg} rounded-xl overflow-hidden transition-colors shadow-lg`}
    >
      {/* Header */}
      <div
        className={`node-drag-handle flex items-center justify-between px-3 py-1.5 ${theme.header} border-b ${theme.border} cursor-move`}
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {/* Color picker dropdown trigger */}
          <div className="relative">
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              className="p-1 text-zinc-400 hover:text-zinc-200 rounded"
              title="Change note color"
            >
              <Palette className="w-3.5 h-3.5" />
            </button>

            {showColorPicker && (
              <div className="absolute left-0 top-6 flex items-center gap-1 p-1.5 bg-[#1e2025] border border-white/10 rounded-lg shadow-xl z-50">
                {(Object.keys(colorThemes) as NoteColor[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => changeColor(c)}
                    className={`w-4 h-4 rounded-full ${colorThemes[c].badge} hover:scale-110 transition-transform`}
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
              className="bg-black/50 text-white text-xs px-1.5 py-0.5 rounded outline-none border border-white/20"
            />
          ) : (
            <span
              onDoubleClick={() => setIsEditingTitle(true)}
              className="text-xs font-semibold text-zinc-200 hover:text-white cursor-text truncate max-w-[170px]"
              title="Double click to rename (pins title)"
            >
              {node.content.title}
            </span>
          )}

          {/* Pin Button */}
          <button
            onClick={togglePin}
            className={`p-0.5 rounded transition-colors ${
              node.content.isNamePinned
                ? 'text-yellow-400 rotate-45'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
            title={node.content.isNamePinned ? 'Title Pinned' : 'Auto-Title from First Line'}
          >
            <Pin className="w-3 h-3" />
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1">
          {/* Mode Switch (Edit / Preview) */}
          <button
            onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}
            className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-white/5 rounded transition-colors"
            title={mode === 'edit' ? 'Preview Markdown' : 'Edit Markdown'}
          >
            {mode === 'edit' ? <Eye className="w-3.5 h-3.5" /> : <Edit3 className="w-3.5 h-3.5" />}
          </button>

          {/* Delete Button */}
          <button
            onClick={() => onDelete(node.id)}
            className="p-1 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
            title="Delete Note"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Note Body */}
      <div className="flex-1 w-full h-[calc(100%-34px)] p-2 overflow-auto">
        {mode === 'edit' ? (
          <div ref={editorContainerRef} className="w-full h-full text-xs font-mono" />
        ) : (
          <div className="w-full h-full text-xs space-y-2 prose prose-invert max-w-none p-1">
            <div className="whitespace-pre-wrap font-sans leading-relaxed text-zinc-200">
              {node.content.body || '(Empty note)'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
