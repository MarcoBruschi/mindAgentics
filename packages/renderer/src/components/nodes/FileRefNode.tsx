import React, { useState } from 'react';
import { FileRefNode as FileRefNodeType } from '@mindagentics/shared';
import {
  FolderOpen,
  Trash2,
} from 'lucide-react';

interface FileRefNodeProps {
  node: FileRefNodeType;
  onUpdate: (updated: FileRefNodeType) => void;
  onDelete: (id: string) => void;
}

export const FileRefNode: React.FC<FileRefNodeProps> = ({
  node,
  onUpdate,
  onDelete,
}) => {
  const nodeRef = React.useRef(node);
  nodeRef.current = node;

  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [label, setLabel] = useState(node.content.label || 'Referência');
  const [isSwapping, setIsSwapping] = useState(false);

  const { path: fullPath } = node.content;

  const handleSaveLabel = () => {
    setIsEditingLabel(false);
    if (label.trim() && label !== node.content.label) {
      onUpdate({
        ...nodeRef.current,
        content: {
          ...nodeRef.current.content,
          label: label.trim(),
        },
      });
    }
  };

  const handleSwapReference = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const api = (window as any).api || (window as any).mindAgentics;
    const pickFn = api?.app?.pickReference || api?.app?.pickDirectory;
    if (!pickFn) return;
    setIsSwapping(true);
    try {
      const res = await pickFn();
      if (!res) return;
      const pickedPath = typeof res === 'string' ? res : res.path;
      const isDir = typeof res === 'object' && 'isDirectory' in res ? res.isDirectory : true;
      if (!pickedPath) return;

      const normalized = pickedPath.replace(/\\/g, '/');
      const parts = normalized.split('/').filter(Boolean);
      const newLabel = parts[parts.length - 1] || pickedPath;

      onUpdate({
        ...nodeRef.current,
        content: {
          ...nodeRef.current.content,
          path: pickedPath,
          isDirectory: isDir,
          label: newLabel,
        },
      });
      setLabel(newLabel);
    } catch (err) {
      console.error('Failed to swap reference:', err);
    } finally {
      setIsSwapping(false);
    }
  };

  return (
    <div
      className="node-drag-handle group flex flex-col justify-between w-full h-full p-2.5 bg-[#14161A] text-zinc-200 rounded-xl border border-white/[0.08] hover:border-white/[0.18] shadow-lg transition-colors select-none cursor-move"
      title={fullPath}
    >
      {/* Topo à direita: Trocar Referência e Excluir Referência */}
      <div className="flex items-center justify-end gap-1 shrink-0">
        <button
          onClick={handleSwapReference}
          disabled={isSwapping}
          className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.08] rounded-md transition-colors cursor-pointer"
          title="Trocar Referência"
        >
          <FolderOpen className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node.id);
          }}
          className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/15 rounded-md transition-colors cursor-pointer"
          title="Excluir Referência"
        >
          <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
        </button>
      </div>

      {/* Centro: Ícone unificado de pasta igual ao da barra de ferramentas */}
      <div className="flex-1 flex items-center justify-center min-h-0 pointer-events-none">
        <FolderOpen className="w-14 h-14 text-zinc-200 group-hover:text-white transition-colors" strokeWidth={1.35} />
      </div>

      {/* Base: Nome do arquivo ou pasta */}
      <div className="w-full pt-0.5 px-0.5 shrink-0">
        {isEditingLabel ? (
          <input
            type="text"
            value={label}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={handleSaveLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveLabel();
              if (e.key === 'Escape') {
                setLabel(node.content.label);
                setIsEditingLabel(false);
              }
            }}
            className="bg-black/60 text-zinc-100 text-xs px-1.5 py-0.5 rounded outline-none border border-blue-500/50 w-full"
          />
        ) : (
          <span
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsEditingLabel(true);
            }}
            className="text-xs font-semibold text-zinc-200 hover:text-white cursor-text truncate block"
            title={fullPath ? `${label}\n(${fullPath})` : label}
          >
            {label}
          </span>
        )}
      </div>
    </div>
  );
};
