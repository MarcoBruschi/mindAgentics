import React, { useState, useRef, useEffect } from 'react';
import { useAtom } from 'jotai';
import { TextBlockNode as TextBlockNodeType } from '@maestri/shared';
import { selectedNodeIdsAtom } from '@/atoms/canvas';
import {
  Type,
  Trash2,
  Bold,
  Italic,
  GripHorizontal,
  ChevronDown,
} from 'lucide-react';

interface TextBlockNodeProps {
  node: TextBlockNodeType;
  isSelected?: boolean;
  onUpdate: (updated: TextBlockNodeType) => void;
  onDelete: (id: string) => void;
}

const FONT_FAMILIES = [
  { label: 'Sans-serif (Inter)', value: "'Inter', system-ui, sans-serif" },
  { label: 'Monospace (Code)', value: "'Cascadia Mono', 'JetBrains Mono', Consolas, monospace" },
  { label: 'Serif (Editorial)', value: "'Georgia', 'Times New Roman', serif" },
  { label: 'Manuscrita (Caveat)', value: "'Caveat', cursive, sans-serif" },
  { label: 'Display (Impact)', value: "'Impact', 'Arial Black', sans-serif" },
];

const FONT_SIZES = [
  { label: '14px', value: 14 },
  { label: '18px', value: 18 },
  { label: '24px', value: 24 },
  { label: '32px', value: 32 },
  { label: '44px', value: 44 },
  { label: '60px', value: 60 },
];

const FONT_COLORS = [
  { label: 'Branco', value: '#ffffff' },
  { label: 'Cinza', value: '#a1a1aa' },
  { label: 'Azul', value: '#60a5fa' },
  { label: 'Esmeralda', value: '#34d399' },
  { label: 'Amarelo', value: '#facc15' },
  { label: 'Rosa', value: '#fb7185' },
  { label: 'Roxo', value: '#c084fc' },
  { label: 'Laranja', value: '#fb923c' },
];

export const TextBlockNode: React.FC<TextBlockNodeProps> = ({
  node,
  isSelected: propIsSelected,
  onUpdate,
  onDelete,
}) => {
  const [selectedIds] = useAtom(selectedNodeIdsAtom);
  const isSelected = propIsSelected ?? selectedIds.includes(node.id);

  const [isEditing, setIsEditing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [showFontMenu, setShowFontMenu] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const blurTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const text = node.content?.text ?? 'Texto';
  const fontSize = node.content?.fontSize || 24;
  const color = node.content?.color || '#ffffff';
  const fontFamily = node.content?.fontFamily || "'Inter', system-ui, sans-serif";
  const fontWeight = node.content?.fontWeight || 'normal';
  const fontStyle = node.content?.fontStyle || 'normal';

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  // Synchronize actual size with node width/height for ties and spatial layout
  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const currentWidth = Math.round(rect.width);
      const currentHeight = Math.round(rect.height);
      if (
        currentWidth > 0 &&
        currentHeight > 0 &&
        (Math.abs(node.width - currentWidth) > 8 || Math.abs(node.height - currentHeight) > 8)
      ) {
        onUpdate({
          ...node,
          width: currentWidth,
          height: currentHeight,
        });
      }
    }
  }, [text, fontSize, fontFamily, fontWeight, fontStyle]);

  const updateContent = (patch: Partial<TextBlockNodeType['content']>) => {
    onUpdate({
      ...node,
      content: {
        ...node.content,
        ...patch,
      },
    });
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateContent({ text: e.target.value });
  };

  const toggleBold = () => {
    updateContent({
      fontWeight: fontWeight === 'bold' ? 'normal' : 'bold',
    });
  };

  const toggleItalic = () => {
    updateContent({
      fontStyle: fontStyle === 'italic' ? 'normal' : 'italic',
    });
  };

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = (e: React.MouseEvent) => {
    const nextTarget = e.relatedTarget as Node | null;
    if (
      containerRef.current?.contains(nextTarget) ||
      toolbarRef.current?.contains(nextTarget)
    ) {
      return;
    }

    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
      setShowFontMenu(false);
    }, 200);
  };

  const isBarVisible = isHovered || isEditing || isSelected || showFontMenu;

  return (
    <div
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="relative flex flex-col group p-1 select-none"
      style={{
        writingMode: 'horizontal-tb',
        whiteSpace: 'nowrap',
        minWidth: '180px',
        width: 'max-content',
      }}
    >
      {/* Floating Formatting Toolbar */}
      <div
        ref={toolbarRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        className={`absolute -top-12 left-0 flex items-center gap-1.5 px-2.5 py-1 bg-[#1a1b22]/95 border border-white/10 rounded-full shadow-2xl backdrop-blur-md z-40 transition-opacity duration-150 select-none ${
          isBarVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{
          whiteSpace: 'nowrap',
          writingMode: 'horizontal-tb',
        }}
      >
        {/* Invisible bridge covering gap between toolbar (-top-12) and text block (top-0) */}
        <div className="absolute top-full left-0 right-0 h-5 pointer-events-auto" />

        {/* Drag Handle */}
        <div
          className="node-drag-handle p-1 text-zinc-400 hover:text-white cursor-move rounded"
          title="Arrastar Texto"
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
        >
          <GripHorizontal className="w-3.5 h-3.5" />
        </div>

        <div className="w-[1px] h-3.5 bg-white/10 mx-0.5" />

        {/* Font Family Selector */}
        <div className="relative">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowFontMenu(!showFontMenu);
            }}
            className="flex items-center gap-1 px-2 py-0.5 text-xs text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-md transition-colors"
            title="Tipo de Fonte"
          >
            <Type className="w-3 h-3 text-blue-400" />
            <span className="max-w-[80px] truncate text-[11px]">
              {FONT_FAMILIES.find((f) => f.value === fontFamily)?.label.split(' ')[0] || 'Fonte'}
            </span>
            <ChevronDown className="w-3 h-3 text-zinc-400" />
          </button>

          {showFontMenu && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute top-full left-0 mt-1.5 w-44 bg-[#1e2029] border border-white/10 rounded-xl shadow-2xl py-1 z-50 animate-in fade-in zoom-in-95"
            >
              {FONT_FAMILIES.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    updateContent({ fontFamily: f.value });
                    setShowFontMenu(false);
                    if (isEditing && inputRef.current) {
                      inputRef.current.focus();
                    }
                  }}
                  style={{ fontFamily: f.value }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between ${
                    fontFamily === f.value
                      ? 'bg-blue-600/20 text-blue-300 font-bold'
                      : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span>{f.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="w-[1px] h-3.5 bg-white/10 mx-0.5" />

        {/* Font Size Selector */}
        <div
          className="flex items-center gap-0.5"
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <select
            value={fontSize}
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            onChange={(e) => {
              e.stopPropagation();
              updateContent({ fontSize: Number(e.target.value) });
              if (isEditing && inputRef.current) {
                inputRef.current.focus();
              }
            }}
            className="px-1.5 py-0.5 bg-[#121316] border border-white/10 rounded text-[11px] text-zinc-300 outline-none hover:border-white/20 cursor-pointer"
            title="Tamanho da Fonte"
          >
            {FONT_SIZES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="w-[1px] h-3.5 bg-white/10 mx-0.5" />

        {/* Color Palette Buttons */}
        <div
          className="flex items-center gap-1"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {FONT_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                updateContent({ color: c.value });
                if (isEditing && inputRef.current) {
                  inputRef.current.focus();
                }
              }}
              style={{ backgroundColor: c.value }}
              className={`w-3.5 h-3.5 rounded-full transition-transform ${
                color === c.value ? 'scale-125 ring-2 ring-white shadow-md' : 'opacity-70 hover:opacity-100'
              }`}
              title={c.label}
            />
          ))}
        </div>

        <div className="w-[1px] h-3.5 bg-white/10 mx-0.5" />

        {/* Bold & Italic */}
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleBold();
            if (isEditing && inputRef.current) {
              inputRef.current.focus();
            }
          }}
          className={`p-1 rounded text-xs transition-colors ${
            fontWeight === 'bold' ? 'bg-blue-600 text-white font-bold' : 'text-zinc-400 hover:text-white hover:bg-white/5'
          }`}
          title="Negrito"
        >
          <Bold className="w-3 h-3" />
        </button>

        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleItalic();
            if (isEditing && inputRef.current) {
              inputRef.current.focus();
            }
          }}
          className={`p-1 rounded text-xs transition-colors ${
            fontStyle === 'italic' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'
          }`}
          title="Itálico"
        >
          <Italic className="w-3 h-3" />
        </button>

        <div className="w-[1px] h-3.5 bg-white/10 mx-0.5" />

        {/* Delete */}
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(node.id);
          }}
          className="p-1 text-zinc-400 hover:text-red-400 rounded hover:bg-red-500/10 transition-colors"
          title="Excluir Texto (Delete/Backspace)"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Pure Non-Breaking Text Display or Dynamic Horizontal Auto-Sizing Input */}
      {!isEditing ? (
        <div
          onClick={() => setIsEditing(true)}
          onDoubleClick={() => setIsEditing(true)}
          className="node-drag-handle cursor-text whitespace-nowrap select-none px-2 py-0.5 leading-tight"
          style={{
            fontFamily,
            fontSize: `${fontSize}px`,
            color,
            fontWeight,
            fontStyle,
            whiteSpace: 'nowrap',
            writingMode: 'horizontal-tb',
            minWidth: '180px',
            width: 'max-content',
            display: 'inline-block',
          }}
          title="Clique ou duplo clique para editar"
        >
          {text || <span className="opacity-40 italic">Texto</span>}
        </div>
      ) : (
        <div
          className="relative inline-flex items-center whitespace-nowrap"
          style={{
            minWidth: '180px',
            width: 'max-content',
            writingMode: 'horizontal-tb',
            whiteSpace: 'nowrap',
          }}
        >
          {/* Invisible mirror span ensuring the container expands dynamically with typed content */}
          <span
            aria-hidden="true"
            className="invisible px-2 py-0.5 whitespace-nowrap pointer-events-none select-none leading-tight"
            style={{
              fontFamily,
              fontSize: `${fontSize}px`,
              fontWeight,
              fontStyle,
              whiteSpace: 'nowrap',
              writingMode: 'horizontal-tb',
              minWidth: '180px',
              display: 'inline-block',
            }}
          >
            {text || 'Escreva algo no workspace...'}
          </span>
          {/* Single-line non-wrapping horizontal input positioned over the mirror span */}
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={handleTextChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                setIsEditing(false);
              }
            }}
            onBlur={(e) => {
              const related = e.relatedTarget as Node | null;
              if (
                containerRef.current?.contains(related) ||
                toolbarRef.current?.contains(related)
              ) {
                return;
              }
              if (blurTimeoutRef.current) {
                clearTimeout(blurTimeoutRef.current);
              }
              blurTimeoutRef.current = setTimeout(() => {
                if (document.activeElement === inputRef.current) return;
                setIsEditing(false);
                if (!text.trim()) {
                  onDelete(node.id);
                }
              }, 150);
            }}
            onFocus={() => {
              if (blurTimeoutRef.current) {
                clearTimeout(blurTimeoutRef.current);
                blurTimeoutRef.current = null;
              }
            }}
            placeholder="Escreva algo no workspace..."
            style={{
              fontFamily,
              fontSize: `${fontSize}px`,
              color,
              fontWeight,
              fontStyle,
              whiteSpace: 'nowrap',
              writingMode: 'horizontal-tb',
              minWidth: '180px',
            }}
            className="absolute inset-0 w-full h-full bg-transparent border-none outline-none px-2 py-0.5 whitespace-nowrap transition-colors placeholder:text-zinc-600 focus:placeholder:text-zinc-700 leading-tight"
          />
        </div>
      )}
    </div>
  );
};
