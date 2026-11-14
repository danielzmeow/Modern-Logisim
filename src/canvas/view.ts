import type { Point } from '../model/types';

export const viewControls = {
  centerWorld: (): Point => ({ x: 0, y: 0 }),
  fit: () => {},
  zoomIn: () => {},
  zoomOut: () => {},
  reset: () => {},
  invalidate: () => {},
};
