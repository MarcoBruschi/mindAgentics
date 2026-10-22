import { atom } from 'jotai';

export interface CanvasOffset {
  x: number;
  y: number;
  zoom: number;
}

export type CanvasMode = 'select' | 'pan' | 'draw' | 'connect';

export interface MarqueeBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export const canvasOffsetAtom = atom<CanvasOffset>({
  x: 0,
  y: 0,
  zoom: 1.0,
});

export const canvasModeAtom = atom<CanvasMode>('select');

export const selectedNodeIdsAtom = atom<string[]>([]);

export const hoveredNodeIdAtom = atom<string | null>(null);

export const connectingFromNodeIdAtom = atom<string | null>(null);

export const marqueeBoxAtom = atom<MarqueeBox | null>(null);

export const isSpacePressedAtom = atom<boolean>(false);

export const isDrawingAtom = atom<boolean>(false);

export const activeDrawColorAtom = atom<string>('#3b82f6');
export const activeDrawWidthAtom = atom<number>(3);
