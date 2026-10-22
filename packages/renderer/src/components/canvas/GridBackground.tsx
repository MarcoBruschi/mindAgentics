import React from 'react';
import { CanvasOffset } from '@/atoms/canvas';

interface GridBackgroundProps {
  offset: CanvasOffset;
}

export const GridBackground: React.FC<GridBackgroundProps> = ({ offset }) => {
  const scaledGrid = 32 * offset.zoom;
  const offsetX = offset.x % scaledGrid;
  const offsetY = offset.y % scaledGrid;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: `radial-gradient(circle, rgba(255, 255, 255, 0.12) 1.2px, transparent 1.2px)`,
        backgroundSize: `${scaledGrid}px ${scaledGrid}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px`,
      }}
    />
  );
};
