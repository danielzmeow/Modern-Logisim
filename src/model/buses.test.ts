import { describe, expect, it } from 'vitest';
import { laneBits, laneOffsets } from './buses';
import { Simulator } from './sim';
import { createComp } from './specs';
import { portsOf } from './geometry';
import type { ComponentInstance, Doc, Point } from './types';

function port(comp: ComponentInstance, name: string): Point {
  return portsOf(comp).find((p) => p.name === name)!.world;
}

function wire(doc: Doc, a: Point, b: Point) {
  if (a.x === b.x && a.y === b.y) return;
  if (a.x === b.x || a.y === b.y) {
    doc.wires.push({ id: `w${doc.wires.length}`, a, b });
    return;
  }
  const midX = Math.round((a.x + b.x) / 2);
  doc.wires.push(
    { id: `w${doc.wires.length}`, a, b: { x: midX, y: a.y } },
    { id: `w${doc.wires.length + 1}`, a: { x: midX, y: a.y }, b: { x: midX, y: b.y } },
    { id: `w${doc.wires.length + 2}`, a: { x: midX, y: b.y }, b },
  );
}

describe('bus lanes', () => {
  it('divides uneven buses without dropping bits', () => {
    const split = createComp('split', { x: 0, y: 0 }, 'east', 'en', { bits: 8, fans: 3 });
    expect(laneBits(split)).toEqual([3, 3, 2]);
    expect(laneOffsets(split)).toEqual([
      { bits: 3, offset: 0 },
      { bits: 3, offset: 3 },
      { bits: 2, offset: 6 },
    ]);
  });

  it('accepts a valid custom mapping and ignores an invalid one', () => {
    const custom = createComp('split', { x: 0, y: 0 }, 'east', 'en', {
      bits: 8,
      fans: 3,
      fanBits: [2, 3, 3],
    });
    expect(laneBits(custom)).toEqual([2, 3, 3]);
    const invalid = createComp('split', { x: 0, y: 0 }, 'east', 'en', {
      bits: 8,
      fans: 3,
      fanBits: [2, 2, 2],
    });
    expect(laneBits(invalid)).toEqual([3, 3, 2]);
  });

  it('splits and merges 8 bits through 3+3+2 lanes', () => {
    const doc: Doc = { version: 1, name: 'lanes', comps: [], wires: [] };
    const input = createComp('input', { x: 0, y: 0 }, 'east', 'en', { bits: 8 });
    const split = createComp('split', { x: 120, y: 0 }, 'east', 'en', {
      bits: 8,
      fans: 3,
      fanBits: [3, 3, 2],
    });
    const merge = createComp('merge', { x: 320, y: 0 }, 'east', 'en', {
      bits: 8,
      fans: 3,
      fanBits: [3, 3, 2],
    });
    const out = createComp('output', { x: 460, y: 0 }, 'west', 'en', { bits: 8 });
    doc.comps.push(input, split, merge, out);
    wire(doc, port(input, 'out'), port(split, 'bus'));
    for (let i = 0; i < 3; i++) wire(doc, port(split, `f${i}`), port(merge, `f${i}`));
    wire(doc, port(merge, 'bus'), port(out, 'in'));

    const sim = new Simulator();
    sim.update(doc);
    sim.setPinValue(input.id, 0b10110101);
    sim.frame(0, false);
    expect(sim.valueOfPort(split.id, 'f0').value).toBe(5);
    expect(sim.valueOfPort(split.id, 'f1').value).toBe(6);
    expect(sim.valueOfPort(split.id, 'f2').value).toBe(2);
    expect(sim.valueOfPort(out.id, 'in').value).toBe(0b10110101);
  });
});
