import React from 'react';
import { CanvasOffset } from '@/atoms/canvas';

interface GridBackgroundProps {
  offset: CanvasOffset;
}

export const GridBackground: React.FC<GridBackgroundProps> = ({ offset }) => {
  const dotSpacing = 24 * offset.zoom;
  const offsetX = offset.x % dotSpacing;
  const offsetY = offset.y % dotSpacing;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: 'radial-gradient(circle, #23262C 1.25px, transparent 1.25px)',
        backgroundSize: `${dotSpacing}px ${dotSpacing}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px`,
      }}
    />
  );
};
