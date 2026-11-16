import type { Bounds } from '../model/geometry';
import type { Point } from '../model/types';

export interface PngLayout {
  zoom: number;
  width: number;
  height: number;
  pan: Point;
}

/**
 * Fit a circuit's content bounds into an offscreen image. The scale is capped
 * so very large schematics do not exceed common browser canvas limits.
 */
export function computePngLayout(
  bounds: Bounds,
  padding = 40,
  preferredScale = 2,
  maxDimension = 8192,
): PngLayout {
  const worldWidth = Math.max(1, bounds.w + padding * 2);
  const worldHeight = Math.max(1, bounds.h + padding * 2);
  const zoom = Math.max(
    0.1,
    Math.min(preferredScale, maxDimension / worldWidth, maxDimension / worldHeight),
  );
  return {
    zoom,
    width: Math.max(1, Math.ceil(worldWidth * zoom)),
    height: Math.max(1, Math.ceil(worldHeight * zoom)),
    pan: {
      x: (padding - bounds.x) * zoom,
      y: (padding - bounds.y) * zoom,
    },
  };
}
