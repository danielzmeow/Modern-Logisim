import { describe, expect, it } from 'vitest';
import { exportCirc } from './circ';
import { createComp } from '../model/specs';
import type { Doc } from '../model/types';

function docWith(...kinds: Parameters<typeof createComp>[0][]): Doc {
  return {
    version: 1,
    name: 'RoundTrip',
    comps: kinds.map((kind, i) => createComp(kind, { x: 100 + i * 100, y: 100 })),
    wires: [],
  };
}

describe('.circ export', () => {
  it('writes the newly supported arithmetic components', () => {
    const doc = docWith('negator', 'divider', 'bitAdder');
    const { xml, skipped } = exportCirc(doc);
    expect(skipped).toEqual([]);
    expect(xml).toContain('name="Negator"');
    expect(xml).toContain('name="Divider"');
    expect(xml).toContain('name="Bit Adder"');
    expect(xml).toContain('<lib desc="#Arithmetic" name="3"/>');
  });

  it('writes the newly supported sequential components', () => {
    const doc = docWith('tff', 'jkff', 'sr', 'shift');
    const { xml, skipped } = exportCirc(doc);
    expect(skipped).toEqual([]);
    expect(xml).toContain('name="T Flip-Flop"');
    expect(xml).toContain('name="J-K Flip-Flop"');
    expect(xml).toContain('name="S-R Latch"');
    expect(xml).toContain('name="Shift Register"');
  });

  it('reports skipped split/merge instead of silently dropping them', () => {
    const doc = docWith('split', 'merge');
    const { skipped } = exportCirc(doc);
    expect(new Set(skipped)).toEqual(new Set(['split', 'merge']));
  });
});
