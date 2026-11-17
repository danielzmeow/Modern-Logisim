import { describe, expect, it } from 'vitest';
import { effectiveBitEnd, laneBits, laneOffsets } from './buses';
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

describe('floating splitter lanes', () => {
  it('reads an unconnected split fan as Z instead of 0', () => {
    const doc: Doc = { version: 1, name: 'float-fan', comps: [], wires: [] };
    const input = createComp('input', { x: 0, y: 0 }, 'east', 'en', { bits: 2 });
    // fans=3 over 2 bits gives lanes [1, 1, 0]: fan 2 carries no bus bits.
    const split = createComp('split', { x: 120, y: 0 }, 'east', 'en', { bits: 2, fans: 3 });
    const out = createComp('output', { x: 260, y: 20 }, 'west', 'en', { bits: 1 });
    doc.comps.push(input, split, out);
    wire(doc, port(input, 'out'), port(split, 'bus'));
    wire(doc, port(split, 'f2'), port(out, 'in'));

    const sim = new Simulator();
    sim.update(doc);
    sim.setPinValue(input.id, 0b10);
    sim.frame(0, false);
    const v = sim.valueOfPort(out.id, 'in');
    expect(v.state).toBe('z');
    expect(v.known).toBe(0);
  });

  it('propagates floating bus bits into fan lanes per bit', () => {
    const doc: Doc = { version: 1, name: 'float-bus', comps: [], wires: [] };
    const d = createComp('input', { x: 0, y: 0 }, 'east', 'en', { bits: 4 });
    const en = createComp('input', { x: 0, y: 60 });
    const buf = createComp('ctrlBuffer', { x: 140, y: 0 }, 'east', 'en', { bits: 4 });
    const split = createComp('split', { x: 280, y: 0 }, 'east', 'en', { bits: 4, fans: 2 });
    const lo = createComp('output', { x: 420, y: -5 }, 'west', 'en', { bits: 2 });
    const hi = createComp('output', { x: 420, y: 5 }, 'west', 'en', { bits: 2 });
    doc.comps.push(d, en, buf, split, lo, hi);
    wire(doc, port(d, 'out'), port(buf, 'in'));
    wire(doc, port(en, 'out'), port(buf, 'enable'));
    wire(doc, port(buf, 'out'), port(split, 'bus'));
    wire(doc, port(split, 'f0'), port(lo, 'in'));
    wire(doc, port(split, 'f1'), port(hi, 'in'));

    const sim = new Simulator();
    sim.update(doc);
    sim.setPinValue(d.id, 0b0110);
    sim.setPinValue(en.id, 0);
    sim.frame(0, false);
    expect(sim.valueOfPort(lo.id, 'in').state).toBe('z');
    expect(sim.valueOfPort(hi.id, 'in').state).toBe('z');

    sim.setPinValue(en.id, 1);
    sim.frame(1, false);
    expect(sim.valueOfPort(lo.id, 'in').value).toBe(0b10);
    expect(sim.valueOfPort(hi.id, 'in').value).toBe(0b01);
  });

  it('merges a floating fan lane into the bus as Z without poisoning known bits', () => {
    const doc: Doc = { version: 1, name: 'float-merge', comps: [], wires: [] };
    const lo = createComp('input', { x: 0, y: -5 }, 'east', 'en', { bits: 4 });
    // f1 (bits 4-7) is left floating.
    const merge = createComp('merge', { x: 140, y: 0 }, 'east', 'en', { bits: 8, fans: 2 });
    const out = createComp('output', { x: 300, y: 0 }, 'west', 'en', { bits: 8 });
    doc.comps.push(lo, merge, out);
    wire(doc, port(lo, 'out'), port(merge, 'f0'));
    wire(doc, port(merge, 'bus'), port(out, 'in'));

    const sim = new Simulator();
    sim.update(doc);
    sim.setPinValue(lo.id, 0xa);
    sim.frame(0, false);
    const v = sim.valueOfPort(out.id, 'in');
    expect(v.state).toBe('z');
    expect(v.known).toBe(0x0f);
    expect(v.error).toBe(0);
    expect(v.value).toBe(0xa);
  });

  it('keeps a zero-width merge fan from erroring the whole bus', () => {
    const doc: Doc = { version: 1, name: 'zero-lane', comps: [], wires: [] };
    const f0 = createComp('input', { x: 0, y: -5 }, 'east', 'en', { bits: 1 });
    const f1 = createComp('input', { x: 0, y: 5 }, 'east', 'en', { bits: 1 });
    // fans=3 over 2 bits gives lanes [1, 1, 0]: fan 2 carries no bus bits.
    const merge = createComp('merge', { x: 140, y: 0 }, 'east', 'en', { bits: 2, fans: 3 });
    const out = createComp('output', { x: 300, y: 0 }, 'west', 'en', { bits: 2 });
    doc.comps.push(f0, f1, merge, out);
    wire(doc, port(f0, 'out'), port(merge, 'f0'));
    wire(doc, port(f1, 'out'), port(merge, 'f1'));
    wire(doc, port(merge, 'bus'), port(out, 'in'));

    const sim = new Simulator();
    sim.update(doc);
    sim.setPinValue(f0.id, 1);
    sim.setPinValue(f1.id, 0);
    sim.frame(0, false);
    const v = sim.valueOfPort(out.id, 'in');
    expect(v.state).toBe('known');
    expect(v.value).toBe(0b01);
  });
});

describe('arbitrary bit mapping', () => {
  it('maps interleaved bus bits to channels', () => {
    const split = createComp('split', { x: 0, y: 0 }, 'east', 'en', {
      bits: 4,
      fans: 2,
      bitEnd: [1, 2, 1, 2],
    });
    expect(laneBits(split)).toEqual([2, 2]);
    expect(effectiveBitEnd(split)).toEqual([1, 2, 1, 2]);
  });

  it('splits and merges interleaved bits without losing order', () => {
    const doc: Doc = { version: 1, name: 'interleaved', comps: [], wires: [] };
    const input = createComp('input', { x: 0, y: 0 }, 'east', 'en', { bits: 4 });
    const split = createComp('split', { x: 120, y: 0 }, 'east', 'en', {
      bits: 4,
      fans: 2,
      bitEnd: [1, 2, 1, 2],
    });
    const merge = createComp('merge', { x: 320, y: 0 }, 'east', 'en', {
      bits: 4,
      fans: 2,
      bitEnd: [1, 2, 1, 2],
    });
    const out = createComp('output', { x: 460, y: 0 }, 'west', 'en', { bits: 4 });
    doc.comps.push(input, split, merge, out);
    wire(doc, port(input, 'out'), port(split, 'bus'));
    for (let i = 0; i < 2; i++) wire(doc, port(split, `f${i}`), port(merge, `f${i}`));
    wire(doc, port(merge, 'bus'), port(out, 'in'));

    const sim = new Simulator();
    sim.update(doc);
    sim.setPinValue(input.id, 0b1010);
    sim.frame(0, false);
    expect(sim.valueOfPort(split.id, 'f0').value).toBe(0b00);
    expect(sim.valueOfPort(split.id, 'f1').value).toBe(0b11);
    expect(sim.valueOfPort(out.id, 'in').value).toBe(0b1010);
  });
});
