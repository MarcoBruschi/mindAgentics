import React from 'react';
import { DrawingStroke } from '@maestri/shared';

interface DrawingLayerProps {
  drawings: DrawingStroke[];
  currentStroke?: DrawingStroke | null;
}

export const DrawingLayer: React.FC<DrawingLayerProps> = ({ drawings, currentStroke }) => {
  const renderPath = (stroke: DrawingStroke) => {
    if (!stroke.points || stroke.points.length < 2) return null;
    const pathStr = stroke.points.reduce((acc, pt, idx) => {
      return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
    }, '');

    return (
      <path
        key={stroke.id}
        d={pathStr}
        stroke={stroke.color || '#3b82f6'}
        strokeWidth={stroke.width || 3}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        className="pointer-events-none drop-shadow-[0_0_6px_rgba(59,130,246,0.4)]"
      />
    );
  };

  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none overflow-visible"
      style={{ width: '1px', height: '1px', zIndex: 15 }}
    >
      {(drawings || []).map(renderPath)}
      {currentStroke && renderPath(currentStroke)}
    </svg>
  );
};
