import { describe, expect, it } from 'vitest';
import { computePngLayout } from './exportLayout';

describe('PNG export layout', () => {
  it('adds padding and scales small circuits at 2x', () => {
    const layout = computePngLayout({ x: 10, y: 20, w: 100, h: 50 }, 40, 2, 8192);
    expect(layout.zoom).toBe(2);
    expect(layout.width).toBe(360);
    expect(layout.height).toBe(260);
    expect(layout.pan).toEqual({ x: 60, y: 40 });
  });

  it('caps very large circuits to the canvas limit', () => {
    const layout = computePngLayout({ x: 0, y: 0, w: 10000, h: 5000 }, 40, 2, 8192);
    expect(layout.width).toBeLessThanOrEqual(8192);
    expect(layout.height).toBeLessThanOrEqual(8192);
    expect(layout.zoom).toBeLessThan(1);
  });
});
