import { describe, expect, it } from 'vitest';
import { hitTest, pointOnSegment, pointOnWire } from './geometry';

const horizontal = { id: 'h', a: { x: 100, y: 120 }, b: { x: 200, y: 120 } };
const vertical = { id: 'v', a: { x: 220, y: 150 }, b: { x: 220, y: 250 } };

describe('pointOnWire', () => {
  it('lands on the interior of a horizontal segment', () => {
    const p = pointOnWire(horizontal, { x: 150, y: 133 });
    expect(p).toEqual({ x: 150, y: 120 });
    expect(pointOnSegment(p, horizontal.a, horizontal.b)).toBe(true);
  });

  it('lands on the interior of a vertical segment', () => {
    const p = pointOnWire(vertical, { x: 231, y: 200 });
    expect(p).toEqual({ x: 220, y: 200 });
    expect(pointOnSegment(p, vertical.a, vertical.b)).toBe(true);
  });

  it('clamps to an endpoint when the press is past the end', () => {
    expect(pointOnWire(horizontal, { x: 420, y: 120 })).toEqual({ x: 200, y: 120 });
    expect(pointOnWire(vertical, { x: 220, y: 10 })).toEqual({ x: 220, y: 150 });
  });

  it('keeps the wire orientation for a segment drawn right-to-left', () => {
    const reversed = { id: 'r', a: { x: 200, y: 120 }, b: { x: 100, y: 120 } };
    expect(pointOnWire(reversed, { x: 40, y: 130 })).toEqual({ x: 100, y: 120 });
  });
});

describe('hitTest', () => {
  it('finds the segment under the pointer', () => {
    const hit = hitTest([], [horizontal, vertical], { x: 150, y: 121 }, 9);
    expect(hit).toEqual({ type: 'wire', wireId: 'h' });
  });

  it('returns null away from every segment', () => {
    expect(hitTest([], [horizontal, vertical], { x: 150, y: 200 }, 9)).toBeNull();
  });
});
