import React from 'react';
import { DrawingStroke } from '@mindagentics/shared';

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

    const type = stroke.brushType || 'pen';
    const baseColor = stroke.color || '#3b82f6';
    const baseWidth = stroke.width || 4;

    if (type === 'highlighter') {
      return (
        <path
          key={stroke.id}
          d={pathStr}
          stroke={baseColor}
          strokeWidth={Math.max(12, baseWidth * 2.6)}
          strokeOpacity={0.4}
          strokeLinecap="square"
          strokeLinejoin="miter"
          fill="none"
          className="pointer-events-none mix-blend-screen"
        />
      );
    }

    if (type === 'dashed') {
      return (
        <path
          key={stroke.id}
          d={pathStr}
          stroke={baseColor}
          strokeWidth={baseWidth}
          strokeDasharray={`${baseWidth * 2} ${baseWidth * 2}`}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          className="pointer-events-none drop-shadow-[0_0_4px_rgba(255,255,255,0.2)]"
        />
      );
    }

    if (type === 'neon') {
      return (
        <g key={stroke.id} className="pointer-events-none">
          {/* Outer glow */}
          <path
            d={pathStr}
            stroke={baseColor}
            strokeWidth={baseWidth * 2.5}
            strokeOpacity={0.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            style={{ filter: `blur(4px)` }}
          />
          {/* Inner core */}
          <path
            d={pathStr}
            stroke="#ffffff"
            strokeWidth={Math.max(1.5, baseWidth * 0.6)}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </g>
      );
    }

    // Default 'pen'
    return (
      <path
        key={stroke.id}
        d={pathStr}
        stroke={baseColor}
        strokeWidth={baseWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        className="pointer-events-none drop-shadow-[0_0_6px_rgba(59,130,246,0.35)]"
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
