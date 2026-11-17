import { describe, expect, it } from 'vitest';
import { Simulator } from './sim';
import { dffDemo, fullAdder, halfAdder, muxDemo } from '../editor/templates';
import { createComp } from './specs';
import { portsOf } from './geometry';
import type { ComponentInstance, Doc, Point } from './types';

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

describe('per-bit four-value states', () => {
  function build(): {
    doc: Doc;
    sim: Simulator;
    wire: (a: Point, b: Point) => void;
    input: (label: string, bits: number, at: Point) => ComponentInstance;
    port: (comp: ComponentInstance, name: string) => Point;
  } {
    const doc: Doc = { version: 1, name: 'bits', comps: [], wires: [] };
    let n = 0;
    const wire = (a: Point, b: Point) => {
      if (a.x === b.x || a.y === b.y) {
        doc.wires.push({ id: `w${n++}`, a, b });
        return;
      }
      const midX = Math.round((a.x + b.x) / 2);
      doc.wires.push(
        { id: `w${n++}`, a, b: { x: midX, y: a.y } },
        { id: `w${n++}`, a: { x: midX, y: a.y }, b: { x: midX, y: b.y } },
        { id: `w${n++}`, a: { x: midX, y: b.y }, b },
      );
    };
    const port = (comp: ComponentInstance, name: string) =>
      portsOf(comp).find((p) => p.name === name)!.world;
    const input = (label: string, bits: number, at: Point) => {
      const pin = createComp('input', at, 'east', 'en', { bits });
      pin.attrs.label = label;
      doc.comps.push(pin);
      return pin;
    };
    const sim = new Simulator();
    return { doc, sim, wire, input, port };
  }

  function floatNet(ctx: ReturnType<typeof build>, bits: number, at: Point) {
    const { doc, wire, port, input } = ctx;
    const d = input('D', bits, { x: at.x - 140, y: at.y - 40 });
    const en = input('EN', 1, { x: at.x - 140, y: at.y + 40 });
    const buf = createComp('ctrlBuffer', at, 'east', 'en', { bits });
    doc.comps.push(buf);
    wire(port(d, 'out'), port(buf, 'in'));
    wire(port(en, 'out'), port(buf, 'enable'));
    return { d, en, buf };
  }

  it('isolates a bus conflict to the disagreeing bit', () => {
    const ctx = build();
    const { doc, sim, wire, port, input } = ctx;
    const a = input('A', 8, { x: 0, y: 0 });
    const b = input('B', 8, { x: 0, y: 60 });
    const out = createComp('output', { x: 220, y: 30 }, 'west', 'en', { bits: 8 });
    doc.comps.push(out);
    wire(port(a, 'out'), port(out, 'in'));
    wire(port(b, 'out'), port(out, 'in'));
    sim.update(doc);
    sim.setPinValue(a.id, 0b11111101);
    sim.setPinValue(b.id, 0b11111111);
    sim.frame(0, false);
    const v = sim.valueOfPort(out.id, 'in');
    expect(v.error).toBe(0b00000010);
    expect(v.known).toBe(0b11111101);
    expect(v.value).toBe(0b11111101);
    expect(v.state).toBe('e');
  });

  it('resolves agreeing drivers bit by bit across a 32-bit bus', () => {
    const ctx = build();
    const { doc, sim, wire, port, input } = ctx;
    const a = input('A', 32, { x: 0, y: 0 });
    const b = input('B', 32, { x: 0, y: 60 });
    const out = createComp('output', { x: 220, y: 30 }, 'west', 'en', { bits: 32 });
    doc.comps.push(out);
    wire(port(a, 'out'), port(out, 'in'));
    wire(port(b, 'out'), port(out, 'in'));
    sim.update(doc);
    sim.setPinValue(a.id, 0);
    sim.setPinValue(b.id, 0x80000000);
    sim.frame(0, false);
    const v = sim.valueOfPort(out.id, 'in');
    expect(v.error).toBe(0x80000000);
    expect(v.known).toBe(0x7fffffff);
    expect(v.value).toBe(0);
    expect(v.state).toBe('e');
  });

  it('lets AND absorb a floating input with a known 0', () => {
    const ctx = build();
    const { doc, sim, wire, port, input } = ctx;
    const zero = input('Z', 2, { x: 0, y: 0 });
    const floater = floatNet(ctx, 2, { x: 160, y: 60 });
    const and = createComp('and', { x: 160, y: 0 }, 'east', 'en', { bits: 2, inputs: 2 });
    const out = createComp('output', { x: 300, y: 0 }, 'west', 'en', { bits: 2 });
    doc.comps.push(and, out);
    wire(port(zero, 'out'), port(and, 'in0'));
    wire(port(floater.buf, 'out'), port(and, 'in1'));
    wire(port(and, 'out'), port(out, 'in'));
    sim.update(doc);
    sim.setPinValue(zero.id, 0);
    sim.setPinValue(floater.d.id, 3);
    sim.setPinValue(floater.en.id, 0);
    sim.frame(0, false);
    const v = sim.valueOfPort(out.id, 'in');
    expect(v.state).toBe('known');
    expect(v.known).toBe(0b11);
    expect(v.value).toBe(0);
  });

  it('lets OR absorb an error input with a known 1', () => {
    const ctx = build();
    const { doc, sim, wire, port, input } = ctx;
    const one = input('O', 2, { x: 0, y: 0 });
    const a = input('A', 2, { x: 0, y: 60 });
    const b = input('B', 2, { x: 0, y: 120 });
    const or = createComp('or', { x: 180, y: 0 }, 'east', 'en', { bits: 2, inputs: 2 });
    const out = createComp('output', { x: 320, y: 0 }, 'west', 'en', { bits: 2 });
    doc.comps.push(or, out);
    wire(port(one, 'out'), port(or, 'in0'));
    wire(port(a, 'out'), port(or, 'in1'));
    wire(port(b, 'out'), port(or, 'in1'));
    wire(port(or, 'out'), port(out, 'in'));
    sim.update(doc);
    sim.setPinValue(one.id, 0b11);
    sim.setPinValue(a.id, 0b00);
    sim.setPinValue(b.id, 0b11);
    sim.frame(0, false);
    const v = sim.valueOfPort(out.id, 'in');
    expect(v.state).toBe('known');
    expect(v.known).toBe(0b11);
    expect(v.value).toBe(0b11);
  });

  it('propagates Z through XOR and keeps known bits intact', () => {
    const ctx = build();
    const { doc, sim, wire, port, input } = ctx;
    const zero = input('Z', 2, { x: 0, y: 0 });
    const floater = floatNet(ctx, 2, { x: 160, y: 60 });
    const xor = createComp('xor', { x: 160, y: 0 }, 'east', 'en', { bits: 2, inputs: 2 });
    const out = createComp('output', { x: 300, y: 0 }, 'west', 'en', { bits: 2 });
    doc.comps.push(xor, out);
    wire(port(zero, 'out'), port(xor, 'in0'));
    wire(port(floater.buf, 'out'), port(xor, 'in1'));
    wire(port(xor, 'out'), port(out, 'in'));
    sim.update(doc);
    sim.setPinValue(zero.id, 0);
    sim.setPinValue(floater.d.id, 3);
    sim.setPinValue(floater.en.id, 0);
    sim.frame(0, false);
    const v = sim.valueOfPort(out.id, 'in');
    expect(v.state).toBe('z');
    expect(v.known).toBe(0);
    expect(v.error).toBe(0);
  });

  it('applies AND absorption per bit alongside a floating bit', () => {
    const ctx = build();
    const { doc, sim, wire, port, input } = ctx;
    // merge builds the 2-bit pattern 0b0Z: f0 = 0, f1 left floating.
    const f0 = input('F0', 1, { x: 0, y: 0 });
    const merge = createComp('merge', { x: 120, y: 0 }, 'east', 'en', { bits: 2, fans: 2 });
    const ones = input('O', 2, { x: 0, y: 80 });
    const and = createComp('and', { x: 260, y: 0 }, 'east', 'en', { bits: 2, inputs: 2 });
    const out = createComp('output', { x: 400, y: 0 }, 'west', 'en', { bits: 2 });
    doc.comps.push(merge, and, out);
    wire(port(f0, 'out'), port(merge, 'f0'));
    wire(port(merge, 'bus'), port(and, 'in0'));
    wire(port(ones, 'out'), port(and, 'in1'));
    wire(port(and, 'out'), port(out, 'in'));
    sim.update(doc);
    sim.setPinValue(f0.id, 0);
    sim.setPinValue(ones.id, 0b11);
    sim.frame(0, false);
    const v = sim.valueOfPort(out.id, 'in');
    expect(v.state).toBe('z');
    expect(v.known).toBe(0b01);
    expect(v.value).toBe(0);
    expect(v.error).toBe(0);
  });

  it('propagates Z per bit through NOT and flips a full 32-bit word', () => {
    const ctx = build();
    const { doc, sim, wire, port, input } = ctx;
    const f0 = input('F0', 1, { x: 0, y: 0 });
    const merge = createComp('merge', { x: 120, y: 0 }, 'east', 'en', { bits: 2, fans: 2 });
    const not = createComp('not', { x: 260, y: 0 }, 'east', 'en', { bits: 2 });
    const out = createComp('output', { x: 380, y: 0 }, 'west', 'en', { bits: 2 });
    doc.comps.push(merge, not, out);
    wire(port(f0, 'out'), port(merge, 'f0'));
    wire(port(merge, 'bus'), port(not, 'in'));
    wire(port(not, 'out'), port(out, 'in'));
    sim.update(doc);
    sim.setPinValue(f0.id, 0);
    sim.frame(0, false);
    let v = sim.valueOfPort(out.id, 'in');
    expect(v.state).toBe('z');
    expect(v.known).toBe(0b01);
    expect(v.value).toBe(0b01);

    // A 32-bit NOT flips every known bit without sign surprises.
    const wide = build();
    const a = wide.input('A', 32, { x: 0, y: 0 });
    const not32 = createComp('not', { x: 160, y: 0 }, 'east', 'en', { bits: 32 });
    const out32 = createComp('output', { x: 300, y: 0 }, 'west', 'en', { bits: 32 });
    wide.doc.comps.push(not32, out32);
    wide.wire(wide.port(a, 'out'), wide.port(not32, 'in'));
    wide.wire(wide.port(not32, 'out'), wide.port(out32, 'in'));
    wide.sim.update(wide.doc);
    wide.sim.setPinValue(a.id, 0xffffffff);
    wide.sim.frame(0, false);
    v = wide.sim.valueOfPort(out32.id, 'in');
    expect(v.state).toBe('known');
    expect(v.known).toBe(0xffffffff);
    expect(v.value).toBe(0);
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


describe('oscillation detection', () => {
  // A clock-gated inverter ring: while the clock is low the AND gate feeds a
  // known 0 into the loop; when the clock rises the loop toggles forever if
  // the ring has odd inversion parity (even parity has a stable fixed point).
  function gatedRing(inversions: number) {
    const doc: Doc = { version: 1, name: `ring${inversions}`, comps: [], wires: [] };
    let n = 0;
    const wire = (a: Point, b: Point): string[] => {
      const ids: string[] = [];
      if (a.x === b.x || a.y === b.y) {
        ids.push(`w${n++}`);
        doc.wires.push({ id: ids[0], a, b });
        return ids;
      }
      const midX = Math.round((a.x + b.x) / 2);
      for (const [p, q] of [
        [a, { x: midX, y: a.y }],
        [{ x: midX, y: a.y }, { x: midX, y: b.y }],
        [{ x: midX, y: b.y }, b],
      ] as [Point, Point][]) {
        ids.push(`w${n++}`);
        doc.wires.push({ id: ids[ids.length - 1], a: p, b: q });
      }
      return ids;
    };
    const port = (comp: ComponentInstance, name: string) =>
      portsOf(comp).find((p) => p.name === name)!.world;
    const clk = createComp('clock', { x: 0, y: 0 });
    clk.attrs.freq = 2;
    const and = createComp('and', { x: 160, y: 0 }, 'east', 'en', { inputs: 2 });
    const nots = Array.from({ length: inversions }, (_, i) =>
      createComp('not', { x: 320 + i * 140, y: 0 }),
    );
    // The feedback returns through same-label tunnels: a direct wire would
    // overlap the forward path and merge the nets into one conflicted net.
    const ta = createComp('tunnel', { x: 320 + inversions * 140, y: 0 });
    ta.attrs.label = 'FB';
    const tb = createComp('tunnel', { x: 60, y: 80 });
    tb.attrs.label = 'FB';
    doc.comps.push(clk, and, ...nots, ta, tb);
    wire(port(clk, 'out'), port(and, 'in0'));
    wire(port(and, 'out'), port(nots[0], 'in'));
    for (let i = 0; i + 1 < inversions; i++) wire(port(nots[i], 'out'), port(nots[i + 1], 'in'));
    wire(port(nots[inversions - 1], 'out'), ta.at);
    wire(tb.at, port(and, 'in1'));
    const sim = new Simulator();
    sim.update(doc);
    return { doc, sim, clk, and, nots, feedback: ta };
  }

  it('flags an odd inverter ring and marks the toggling nets E', () => {
    const { sim, clk, and, nots } = gatedRing(1);
    sim.frame(0, true);
    expect(sim.oscillation).toBeNull();
    sim.frame(250, true); // clock rises: the AND gate opens the ring
    expect(sim.oscillation).not.toBeNull();
    const nets = sim.oscillation!.nets;
    expect(nets.has(sim.netOfPort(and.id, 'out'))).toBe(true);
    expect(nets.has(sim.netOfPort(nots[0].id, 'out'))).toBe(true);
    expect(nets.has(sim.netOfPort(clk.id, 'out'))).toBe(false);
    expect(sim.valueOfPort(and.id, 'out').state).toBe('e');
    expect(sim.valueOfPort(nots[0].id, 'out').state).toBe('e');
  });

  it('lets an even inverter ring settle', () => {
    const { sim } = gatedRing(2);
    sim.frame(0, true);
    sim.frame(250, true);
    sim.frame(500, true);
    expect(sim.oscillation).toBeNull();
  });

  it('freezes clock advancement while oscillating', () => {
    const { sim, clk } = gatedRing(1);
    sim.frame(0, true);
    sim.frame(250, true);
    expect(sim.oscillation).not.toBeNull();
    expect(sim.valueOfPort(clk.id, 'out').value).toBe(1);
    // Wall time passes but the frozen clock neither toggles nor accumulates.
    sim.frame(500, true);
    sim.frame(1000, true);
    sim.frame(5000, true);
    expect(sim.valueOfPort(clk.id, 'out').value).toBe(1);
    expect(sim.oscillation).not.toBeNull();
  });

  it('reset clears the oscillation state and starts a fresh detection cycle', () => {
    const { sim, clk } = gatedRing(1);
    sim.frame(0, true);
    sim.frame(250, true);
    expect(sim.oscillation).not.toBeNull();
    sim.reset();
    expect(sim.oscillation).toBeNull();
    // Reset drives clocks low, so the ring absorbs the error and settles.
    expect(sim.valueOfPort(clk.id, 'out').value).toBe(0);
    // An unchanged ring legitimately oscillates again on the next rising edge.
    sim.frame(500, true);
    expect(sim.valueOfPort(clk.id, 'out').value).toBe(1);
    expect(sim.oscillation).not.toBeNull();
  });

  it('recovers after the loop is broken without replaying stopped ticks', () => {
    const { doc, sim, clk, and, nots, feedback } = gatedRing(1);
    sim.frame(0, true);
    sim.frame(250, true);
    expect(sim.oscillation).not.toBeNull();
    // The UI stops the simulation and the oscillator sits stopped for seconds.
    sim.frame(6000, false);
    // Editing the circuit breaks the loop (rename one tunnel endpoint) and
    // rebuilds the netlist, clearing the stale oscillation state.
    const fixed: Doc = {
      ...doc,
      comps: doc.comps.map((c) =>
        c.id === feedback.id ? { ...c, attrs: { ...c.attrs, label: 'BROKEN' } } : c,
      ),
    };
    sim.update(fixed);
    expect(sim.oscillation).toBeNull();
    // Resume: clocks resync from now instead of bursting the missed ticks.
    sim.frame(6000, true);
    expect(sim.valueOfPort(clk.id, 'out').value).toBe(1);
    sim.frame(6250, true);
    expect(sim.valueOfPort(clk.id, 'out').value).toBe(0);
    expect(sim.oscillation).toBeNull();
    // The broken feedback net floats; the AND resolves it against the low clock.
    expect(sim.valueOfPort(and.id, 'in1').state).toBe('z');
    expect(sim.valueOfPort(and.id, 'out').state).toBe('known');
    expect(sim.valueOfPort(nots[0].id, 'out').value).toBe(1);
  });

  it('treats pressing run after a stop as a recovery path', () => {
    const { sim, clk, nots } = gatedRing(1);
    sim.frame(0, true);
    sim.frame(250, true);
    expect(sim.oscillation).not.toBeNull();
    sim.frame(6000, false);
    // Explicit run re-evaluates; the frozen clock does not replay the gap.
    sim.frame(6000, true);
    expect(sim.valueOfPort(clk.id, 'out').value).toBe(1);
    // Once the clock falls, the AND gate absorbs the error and the ring settles.
    sim.frame(6250, true);
    expect(sim.valueOfPort(clk.id, 'out').value).toBe(0);
    expect(sim.oscillation).toBeNull();
    expect(sim.valueOfPort(nots[0].id, 'out').state).toBe('known');
  });
});
