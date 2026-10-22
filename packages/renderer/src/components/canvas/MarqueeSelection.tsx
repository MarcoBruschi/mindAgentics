import React from 'react';
import { MarqueeBox } from '@/atoms/canvas';

interface MarqueeSelectionProps {
  marquee: MarqueeBox | null;
}

export const MarqueeSelection: React.FC<MarqueeSelectionProps> = ({ marquee }) => {
  if (!marquee) return null;

  const left = Math.min(marquee.startX, marquee.currentX);
  const top = Math.min(marquee.startY, marquee.currentY);
  const width = Math.abs(marquee.currentX - marquee.startX);
  const height = Math.abs(marquee.currentY - marquee.startY);

  return (
    <div
      className="absolute border border-blue-500/80 bg-blue-500/15 rounded pointer-events-none z-50 backdrop-blur-[0.5px]"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      }}
    />
  );
};
