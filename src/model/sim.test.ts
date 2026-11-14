import { describe, expect, it } from 'vitest';
import { Simulator } from './sim';
import { dffDemo, fullAdder, halfAdder, muxDemo } from '../editor/templates';
import { createComp } from './specs';
import type { Doc, Point } from './types';

function setInputs(sim: Simulator, doc: Doc, values: Record<string, number>) {
  for (const c of doc.comps) {
    if (c.kind === 'input' && c.attrs.label && c.attrs.label in values) {
      sim.setPinValue(c.id, values[c.attrs.label]);
    }
  }
  sim.frame(0, false);
}

function out(sim: Simulator, doc: Doc, label: string): number {
  const c = doc.comps.find((x) => x.kind === 'output' && x.attrs.label === label);
  if (!c) throw new Error(`no output ${label}`);
  return sim.valueOfPort(c.id, 'in').value;
}

describe('netlist + simulation', () => {
  it('half adder truth table', () => {
    const doc = halfAdder();
    const sim = new Simulator();
    sim.update(doc);
    const led = doc.comps.find((c) => c.kind === 'led')!;
    for (const [a, b] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]) {
      setInputs(sim, doc, { A: a, B: b });
      expect(out(sim, doc, 'S')).toBe(a ^ b);
      expect(sim.valueOfPort(led.id, 'in').value).toBe(a & b);
    }
  });

  it('full adder truth table', () => {
    const doc = fullAdder();
    const sim = new Simulator();
    sim.update(doc);
    for (const a of [0, 1]) {
      for (const b of [0, 1]) {
        for (const c of [0, 1]) {
          setInputs(sim, doc, { A: a, B: b, Cin: c });
          const sum = a ^ b ^ c;
          const carry = (a & b) | (c & (a ^ b));
          expect(out(sim, doc, 'S'), `sum ${a}${b}${c}`).toBe(sum);
          expect(out(sim, doc, 'Cout'), `carry ${a}${b}${c}`).toBe(carry);
        }
      }
    }
  });

  it('2:1 mux', () => {
    const doc = muxDemo();
    const sim = new Simulator();
    sim.update(doc);
    const led = doc.comps.find((c) => c.kind === 'led')!;
    for (const [a, b, s] of [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ]) {
      setInputs(sim, doc, { A: a, B: b, S: s });
      expect(sim.valueOfPort(led.id, 'in').value, `${a}${b}${s}`).toBe(s ? b : a);
    }
  });

  it('D flip-flop captures on rising edge', () => {
    const doc: Doc = { version: 1, name: 'dff', comps: [], wires: [] };
    const d = createComp('input', { x: 100, y: 200 });
    d.attrs.label = 'D';
    const clk = createComp('input', { x: 100, y: 220 });
    clk.attrs.label = 'CLK';
    const q = createComp('dff', { x: 300, y: 200 });
    const led = createComp('led', { x: 380, y: 200 });
    doc.comps.push(d, clk, q, led);
    let n = 0;
    const w = (a: Point, b: Point) => {
      doc.wires.push({ id: `w${n++}`, a, b });
    };
    w({ x: 100, y: 200 }, { x: 260, y: 200 });
    w({ x: 100, y: 220 }, { x: 260, y: 220 });
    w({ x: 300, y: 200 }, { x: 380, y: 200 });
    const sim = new Simulator();
    sim.update(doc);
    const get = () => sim.valueOfPort(led.id, 'in').value;

    sim.frame(0, false);
    expect(get()).toBe(0);

    sim.setPinValue(d.id, 1);
    sim.setPinValue(clk.id, 1);
    sim.frame(1, false);
    expect(get()).toBe(1);

    sim.setPinValue(d.id, 0);
    sim.frame(2, false);
    expect(get()).toBe(1);

    sim.setPinValue(clk.id, 0);
    sim.frame(3, false);
    sim.setPinValue(d.id, 0);
    sim.setPinValue(clk.id, 1);
    sim.frame(4, false);
    expect(get()).toBe(0);
  });

  it('clock-driven flip flop toggles over time', () => {
    const doc = dffDemo();
    const sim = new Simulator();
    sim.update(doc);
    const led = doc.comps.find((c) => c.kind === 'led')!;
    sim.frame(0, true);
    let last = sim.valueOfPort(led.id, 'in').value;
    let changes = 0;
    for (let t = 100; t < 2000; t += 100) {
      sim.frame(t, true);
      const v = sim.valueOfPort(led.id, 'in').value;
      if (v !== last) changes++;
      last = v;
    }
    expect(changes).toBeGreaterThanOrEqual(2);
  });

  it('splitter and merger move bus bits', () => {
    const doc: Doc = { version: 1, name: 'bus', comps: [], wires: [] };
    const pin = createComp('input', { x: 100, y: 200 });
    pin.attrs.bits = 8;
    pin.attrs.label = 'D';
    const split = createComp('split', { x: 250, y: 200 });
    split.attrs.bits = 8;
    split.attrs.fans = 2;
    const out0 = createComp('output', { x: 400, y: 195 }, 'west');
    out0.attrs.bits = 4;
    out0.attrs.label = 'lo';
    const out1 = createComp('output', { x: 400, y: 205 }, 'west');
    out1.attrs.bits = 4;
    out1.attrs.label = 'hi';
    doc.comps.push(pin, split, out0, out1);
    let n = 0;
    const w = (a: Point, b: Point) => doc.wires.push({ id: `w${n++}`, a, b });
    w({ x: 100, y: 200 }, { x: 228, y: 200 });
    w({ x: 272, y: 195 }, { x: 400, y: 195 });
    w({ x: 272, y: 205 }, { x: 400, y: 205 });
    const sim = new Simulator();
    sim.update(doc);
    sim.setPinValue(pin.id, 0xa5);
    sim.frame(0, false);
    expect(sim.valueOfPort(out0.id, 'in').value).toBe(0x5);
    expect(sim.valueOfPort(out1.id, 'in').value).toBe(0xa);
  });
});

describe('wire connections', () => {
  it('joins a wire endpoint to the interior of another wire', async () => {
    const { buildNetlist } = await import('./netlist');
    const doc: Doc = {
      version: 1,
      name: 't',
      comps: [],
      wires: [
        { id: 'a', a: { x: -50, y: 0 }, b: { x: 50, y: 0 } },
        { id: 'b', a: { x: 0, y: 0 }, b: { x: 0, y: 50 } },
      ],
    };
    const nl = buildNetlist(doc);
    expect(nl.wireNet[0]).toBe(nl.wireNet[1]);
  });

  it('snaps a free wire end to a wire interior', async () => {
    const { snapWireEnd } = await import('./geometry');
    const res = snapWireEnd({ x: 2, y: 31 }, [], [{ id: 'w', a: { x: 0, y: 0 }, b: { x: 0, y: 100 } }], 10);
    expect(res.point).toEqual({ x: 0, y: 31 });
    expect(res.wireId).toBe('w');
  });
});

describe('tunnels', () => {
  it('merges same-label endpoints', () => {
    const doc: Doc = { version: 1, name: 'tunnel', comps: [], wires: [] };
    const pin = createComp('input', { x: 0, y: 100 });
    const t1 = createComp('tunnel', { x: 100, y: 100 });
    t1.attrs.label = 'NET';
    const t2 = createComp('tunnel', { x: 300, y: 100 });
    t2.attrs.label = 'NET';
    const out = createComp('output', { x: 400, y: 100 }, 'west');
    doc.comps.push(pin, t1, t2, out);
    doc.wires.push(
      { id: 'w1', a: { x: 0, y: 100 }, b: { x: 100, y: 100 } },
      { id: 'w2', a: { x: 300, y: 100 }, b: { x: 400, y: 100 } },
    );
    const sim = new Simulator();
    sim.update(doc);
    sim.setPinValue(pin.id, 1);
    sim.frame(0, false);
    expect(sim.valueOfPort(out.id, 'in').value).toBe(1);
  });
});
