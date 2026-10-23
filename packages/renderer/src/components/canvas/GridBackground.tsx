import React from 'react';
import { CanvasOffset } from '@/atoms/canvas';

interface GridBackgroundProps {
  offset: CanvasOffset;
}

export const GridBackground: React.FC<GridBackgroundProps> = ({ offset }) => {
  const minorGrid = 20 * offset.zoom;
  const majorGrid = 100 * offset.zoom;

  const offsetXMinor = offset.x % minorGrid;
  const offsetYMinor = offset.y % minorGrid;
  const offsetXMajor = offset.x % majorGrid;
  const offsetYMajor = offset.y % majorGrid;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: `
          linear-gradient(to right, rgba(255, 255, 255, 0.06) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(255, 255, 255, 0.06) 1px, transparent 1px),
          linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
        `,
        backgroundSize: `
          ${majorGrid}px ${majorGrid}px,
          ${majorGrid}px ${majorGrid}px,
          ${minorGrid}px ${minorGrid}px,
          ${minorGrid}px ${minorGrid}px
        `,
        backgroundPosition: `
          ${offsetXMajor}px ${offsetYMajor}px,
          ${offsetXMajor}px ${offsetYMajor}px,
          ${offsetXMinor}px ${offsetYMinor}px,
          ${offsetXMinor}px ${offsetYMinor}px
        `,
      }}
    />
  );
};
