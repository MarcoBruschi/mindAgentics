import React from 'react';
import { CableTie, CanvasNode } from '@mindagentics/shared';
import { X } from 'lucide-react';

interface CableTieProps {
  tie: CableTie;
  fromNode?: CanvasNode;
  toNode?: CanvasNode;
  onDelete?: (tieId: string) => void;
}

export const CableTieComponent: React.FC<CableTieProps> = ({ tie, fromNode, toNode, onDelete }) => {
  if (!fromNode || !toNode) return null;

  // Center points of both nodes
  const x1 = fromNode.x + fromNode.width / 2;
  const y1 = fromNode.y + fromNode.height / 2;
  const x2 = toNode.x + toNode.width / 2;
  const y2 = toNode.y + toNode.height / 2;

  // Calculate bezier control points
  const dx = Math.abs(x2 - x1) * 0.5;
  const dy = Math.abs(y2 - y1) * 0.5;
  const cp1x = x1 + (x2 > x1 ? dx : -dx);
  const cp1y = y1;
  const cp2x = x2 - (x2 > x1 ? dx : -dx);
  const cp2y = y2;

  const pathData = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  return (
    <g className="group cursor-pointer">
      {/* Background thicker hit-area for clicking / hovering */}
      <path
        d={pathData}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="pointer-events-auto"
      />
      {/* Visual Bezier Curve - clean line only */}
      <path
        d={pathData}
        fill="none"
        stroke="#60a5fa"
        strokeWidth={2.5}
        strokeDasharray="6 4"
        className="transition-all duration-200 group-hover:stroke-blue-400 group-hover:stroke-[3.5px] drop-shadow-[0_0_8px_rgba(96,165,250,0.6)]"
      />
      {/* Minimal subtle delete button visible only on line hover */}
      {onDelete && (
        <foreignObject
          x={midX - 12}
          y={midY - 12}
          width={24}
          height={24}
          className="overflow-visible pointer-events-auto opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(tie.id);
            }}
            className="w-6 h-6 rounded-full bg-[#181a20]/90 border border-red-500/50 text-red-400 hover:bg-red-500/20 hover:text-red-300 flex items-center justify-center shadow-lg transition-colors"
            title="Desconectar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </foreignObject>
      )}
    </g>
  );
};
