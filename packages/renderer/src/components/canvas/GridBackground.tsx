import React from 'react';
import { CanvasOffset } from '@/atoms/canvas';

interface GridBackgroundProps {
  offset: CanvasOffset;
}

export const GridBackground: React.FC<GridBackgroundProps> = React.memo(({ offset }) => {
  const safeZoom = Number.isFinite(offset?.zoom) ? Math.min(3.0, Math.max(0.1, offset.zoom)) : 1.0;
  const safeX = Number.isFinite(offset?.x) ? offset.x : 0;
  const safeY = Number.isFinite(offset?.y) ? offset.y : 0;

  // Dot spacing scales with clamped zoom: 24 * offset.zoom bounded strictly between 2.4px and 72px (never 0, negative, NaN or Infinity)
  const dotSpacing = Math.max(2.4, Math.min(72, Number.isFinite(offset?.zoom) ? 24 * offset.zoom : 24 * safeZoom));
  const offsetX = ((safeX % dotSpacing) + dotSpacing) % dotSpacing;
  const offsetY = ((safeY % dotSpacing) + dotSpacing) % dotSpacing;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: 'radial-gradient(circle, #23262C 1.25px, transparent 1.25px)',
        backgroundSize: `${dotSpacing.toFixed(2)}px ${dotSpacing.toFixed(2)}px`,
        backgroundPosition: `${offsetX.toFixed(2)}px ${offsetY.toFixed(2)}px`,
      }}
    />
  );
});

GridBackground.displayName = 'GridBackground';
