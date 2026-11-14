import { describe, expect, it } from 'vitest';
import { Simulator } from './sim';
import { createComp } from './specs';
import { computeSubLayout } from './hierarchy';
import { portsOf } from './geometry';
import { cloneDoc, type ComponentInstance, type Doc, type Point } from './types';
import { buildTruthTable } from '../analysis/truthTable';
import { synthesizeEquations } from '../analysis/equations';
import { followMovedWires } from './editing';
import { buildNetlist } from './netlist';

const channels = new WeakMap<Doc, number>();
function wire(doc: Doc, a: Point, b: Point) {
  if (a.x === b.x && a.y === b.y) return;
  if (a.x === b.x || a.y === b.y) {
    doc.wires.push({ id: `w${doc.wires.length}`, a, b });
    return;
  }
  const channel = channels.get(doc) ?? 0;
  channels.set(doc, channel + 1);
  const midX = a.x < b.x ? a.x + 16 + channel * 6 : a.x - 16 - channel * 6;
  doc.wires.push(
    { id: `w${doc.wires.length}`, a, b: { x: midX, y: a.y } },
    { id: `w${doc.wires.length + 1}`, a: { x: midX, y: a.y }, b: { x: midX, y: b.y } },
    { id: `w${doc.wires.length + 2}`, a: { x: midX, y: b.y }, b },
  );
}

function port(comp: ComponentInstance, name: string): Point {
  return portsOf(comp).find((p) => p.name === name)!.world;
}

function wirePoints(doc: Doc, points: Point[]) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.x === b.x && a.y === b.y) continue;
    doc.wires.push({ id: `w${doc.wires.length}`, a, b });
  }
}

describe('tri-state and multiple drivers', () => {
  it('controlled buffer floats when disabled and drives when enabled', () => {
    const doc: Doc = { version: 1, name: 'tri', comps: [], wires: [] };
    const d = createComp('input', { x: 0, y: 0 });
    d.attrs.label = 'D';
    const en = createComp('input', { x: 0, y: 60 });
    en.attrs.label = 'EN';
    const buf = createComp('ctrlBuffer', { x: 120, y: 20 });
    const out = createComp('output', { x: 220, y: 20 }, 'west');
    out.attrs.label = 'Y';
    doc.comps.push(d, en, buf, out);
    wire(doc, port(d, 'out'), port(buf, 'in'));
    wire(doc, port(en, 'out'), port(buf, 'enable'));
    wire(doc, port(buf, 'out'), port(out, 'in'));
    const sim = new Simulator();
    sim.update(doc);
    sim.setPinValue(d.id, 1);
    sim.setPinValue(en.id, 0);
    sim.frame(0, false);
    expect(sim.valueOfPort(out.id, 'in').state).toBe('z');
    sim.setPinValue(en.id, 1);
    sim.frame(1, false);
    expect(sim.valueOfPort(out.id, 'in').value).toBe(1);
  });

  it('reports E on conflicting drivers', () => {
    const doc: Doc = { version: 1, name: 'conflict', comps: [], wires: [] };
    const one = createComp('power', { x: 0, y: 0 });
    const zero = createComp('ground', { x: 0, y: 40 });
    const out = createComp('output', { x: 160, y: 20 }, 'west');
    doc.comps.push(one, zero, out);
    wire(doc, port(one, 'out'), port(out, 'in'));
    wire(doc, port(zero, 'out'), port(out, 'in'));
    const sim = new Simulator();
    sim.update(doc);
    sim.frame(0, false);
    expect(sim.valueOfPort(out.id, 'in').state).toBe('e');
  });

  it('pull resistor resolves a floating net', () => {
    const doc: Doc = { version: 1, name: 'pull', comps: [], wires: [] };
    const pull = createComp('pull', { x: 40, y: 0 });
    pull.attrs.pull = 1;
    const out = createComp('output', { x: 160, y: 0 }, 'west');
    doc.comps.push(pull, out);
    wire(doc, port(pull, 'net'), port(out, 'in'));
    const sim = new Simulator();
    sim.update(doc);
    sim.frame(0, false);
    expect(sim.valueOfPort(out.id, 'in').value).toBe(1);
  });
});

describe('new arithmetic and memory components', () => {
  it('multi-bit adder and carry', () => {
    const doc: Doc = { version: 1, name: 'add', comps: [], wires: [] };
    const a = createComp('input', { x: 0, y: 0 }, 'east', 'en', { bits: 4 });
    const b = createComp('input', { x: 0, y: 40 }, 'east', 'en', { bits: 4 });
    const cin = createComp('input', { x: 0, y: 80 }, 'east', 'en', { bits: 1 });
    const add = createComp('adder', { x: 160, y: 20 }, 'east', 'en', { bits: 4 });
    const sum = createComp('output', { x: 300, y: 12 }, 'west', 'en', { bits: 4 });
    const carry = createComp('output', { x: 300, y: 28 }, 'west', 'en', { bits: 1 });
    doc.comps.push(a, b, cin, add, sum, carry);
    wire(doc, port(a, 'out'), port(add, 'a'));
    wire(doc, port(b, 'out'), port(add, 'b'));
    wire(doc, port(cin, 'out'), port(add, 'cin'));
    wire(doc, port(add, 'out'), port(sum, 'in'));
    wire(doc, port(add, 'carry'), port(carry, 'in'));
    const sim = new Simulator();
    sim.update(doc);
    sim.setPinValue(a.id, 15);
    sim.setPinValue(b.id, 1);
    sim.frame(0, false);
    expect(sim.valueOfPort(sum.id, 'in').value).toBe(0);
    expect(sim.valueOfPort(carry.id, 'in').value).toBe(1);
  });

  it('register captures a multi-bit value on a clock edge', () => {
    const doc: Doc = { version: 1, name: 'reg', comps: [], wires: [] };
    const d = createComp('input', { x: 0, y: 0 }, 'east', 'en', { bits: 4 });
    const clk = createComp('input', { x: 0, y: 60 }, 'east', 'en', { bits: 1 });
    const reg = createComp('register', { x: 140, y: 20 });
    const q = createComp('output', { x: 280, y: 20 }, 'west', 'en', { bits: 4 });
    doc.comps.push(d, clk, reg, q);
    wire(doc, port(d, 'out'), port(reg, 'd'));
    wire(doc, port(clk, 'out'), port(reg, 'clk'));
    wire(doc, port(reg, 'q'), port(q, 'in'));
    const sim = new Simulator();
    sim.update(doc);
    sim.setPinValue(d.id, 0xa);
    sim.setPinValue(clk.id, 0);
    sim.frame(0, false);
    sim.setPinValue(clk.id, 1);
    sim.frame(1, false);
    expect(sim.valueOfPort(q.id, 'in').value).toBe(0xa);
  });

  it('RAM writes on a clock edge and reads back', () => {
    const doc: Doc = { version: 1, name: 'ram', comps: [], wires: [] };
    const addr = createComp('input', { x: 0, y: 0 }, 'east', 'en', { bits: 2 });
    const din = createComp('input', { x: 0, y: 40 }, 'east', 'en', { bits: 4 });
    const we = createComp('input', { x: 0, y: 80 });
    const clk = createComp('input', { x: 0, y: 120 });
    const ram = createComp('ram', { x: 180, y: 20 }, 'east', 'en', { addrBits: 2, dataBits: 4 });
    const out = createComp('output', { x: 330, y: 20 }, 'west', 'en', { bits: 4 });
    doc.comps.push(addr, din, we, clk, ram, out);
    wire(doc, port(addr, 'out'), port(ram, 'addr'));
    wire(doc, port(din, 'out'), port(ram, 'din'));
    wirePoints(doc, [
      port(we, 'out'),
      { x: port(we, 'out').x, y: port(we, 'out').y - 10 },
      { x: port(ram, 'we').x, y: port(we, 'out').y - 10 },
      port(ram, 'we'),
    ]);
    wirePoints(doc, [
      port(clk, 'out'),
      { x: port(clk, 'out').x, y: port(clk, 'out').y - 10 },
      { x: port(ram, 'clk').x, y: port(clk, 'out').y - 10 },
      port(ram, 'clk'),
    ]);
    wire(doc, port(ram, 'dout'), port(out, 'in'));
    const sim = new Simulator();
    sim.update(doc);
    sim.setPinValue(addr.id, 1);
    sim.setPinValue(din.id, 5);
    sim.setPinValue(we.id, 1);
    sim.setPinValue(clk.id, 0);
    sim.frame(0, false);
    sim.setPinValue(clk.id, 1);
    sim.frame(1, false);
    sim.setPinValue(we.id, 0);
    sim.setPinValue(din.id, 0);
    sim.setPinValue(addr.id, 1);
    sim.frame(2, false);
    expect(sim.valueOfPort(out.id, 'in').value).toBe(5);
    sim.setPinValue(addr.id, 0);
    sim.frame(3, false);
    expect(sim.valueOfPort(out.id, 'in').value).toBe(0);
  });

  it('counter increments on rising edges', () => {
    const doc: Doc = { version: 1, name: 'cnt', comps: [], wires: [] };
    const clk = createComp('input', { x: 0, y: 0 });
    const cnt = createComp('counter', { x: 150, y: 0 }, 'east', 'en', { bits: 4, reset: false, enable: false });
    const q = createComp('output', { x: 300, y: -10 }, 'west', 'en', { bits: 4 });
    doc.comps.push(clk, cnt, q);
    wire(doc, port(clk, 'out'), port(cnt, 'clk'));
    wire(doc, port(cnt, 'q'), port(q, 'in'));
    const sim = new Simulator();
    sim.update(doc);
    const pulse = (t: number) => {
      sim.setPinValue(clk.id, 0);
      sim.frame(t, false);
      sim.setPinValue(clk.id, 1);
      sim.frame(t + 1, false);
    };
    pulse(0);
    expect(sim.valueOfPort(q.id, 'in').value).toBe(1);
    pulse(10);
    expect(sim.valueOfPort(q.id, 'in').value).toBe(2);
  });
});

describe('subcircuits', () => {
  it('flattens and passes signals through an instance', () => {
    const sub: Doc = { version: 1, name: 'Inverter', comps: [], wires: [] };
    const ain = createComp('input', { x: 0, y: 0 });
    ain.attrs.label = 'A';
    const not = createComp('not', { x: 80, y: 0 });
    const aout = createComp('output', { x: 160, y: 0 }, 'west');
    aout.attrs.label = 'Y';
    sub.comps.push(ain, not, aout);
    wire(sub, port(ain, 'out'), port(not, 'in'));
    wire(sub, port(not, 'out'), port(aout, 'in'));

    const root: Doc = { version: 1, name: 'Top', comps: [], wires: [] };
    const pin = createComp('input', { x: 0, y: 0 });
    pin.attrs.label = 'A';
    const layout = computeSubLayout(sub);
    const inst = createComp('sub', { x: 100, y: 0 }, 'east', 'en', {
      circuit: 'sub-id',
      circuitName: 'Inverter',
      ...layout,
    });
    const out = createComp('output', { x: 280, y: 20 }, 'west');
    out.attrs.label = 'Y';
    root.comps.push(pin, inst, out);
    const inPort = portsOf(inst).find((p) => p.dir === 'in')!;
    const outPort = portsOf(inst).find((p) => p.dir === 'out')!;
    wire(root, port(pin, 'out'), inPort.world);
    wire(root, outPort.world, port(out, 'in'));

    const sim = new Simulator();
    sim.update(root, { 'sub-id': sub });
    sim.setPinValue(pin.id, 1);
    sim.frame(0, false);
    expect(sim.valueOfPort(out.id, 'in').value).toBe(0);
    sim.setPinValue(pin.id, 0);
    sim.frame(1, false);
    expect(sim.valueOfPort(out.id, 'in').value).toBe(1);
  });
});

  it('keeps same-named tunnels isolated per subcircuit instance', () => {
    const sub: Doc = { version: 1, name: 'TunnelSub', comps: [], wires: [] };
    const ain = createComp('input', { x: 0, y: 0 });
    ain.attrs.label = 'A';
    const t1 = createComp('tunnel', { x: 100, y: 0 }, 'east', 'en', { label: 'T' });
    const t2 = createComp('tunnel', { x: 200, y: 0 }, 'east', 'en', { label: 'T' });
    const aout = createComp('output', { x: 300, y: 0 }, 'west');
    aout.attrs.label = 'Y';
    sub.comps.push(ain, t1, t2, aout);
    wirePoints(sub, [port(ain, 'out'), port(t1, 'net')]);
    wirePoints(sub, [port(t2, 'net'), port(aout, 'in')]);

    const root: Doc = { version: 1, name: 'Top', comps: [], wires: [] };
    const a = createComp('input', { x: 0, y: 0 });
    a.attrs.label = 'A';
    const b = createComp('input', { x: 0, y: 160 });
    b.attrs.label = 'B';
    const layout = computeSubLayout(sub);
    const s1 = createComp('sub', { x: 100, y: 0 }, 'east', 'en', { circuit: 'sub', circuitName: 'TunnelSub', ...layout });
    const s2 = createComp('sub', { x: 100, y: 160 }, 'east', 'en', { circuit: 'sub', circuitName: 'TunnelSub', ...layout });
    const y1 = createComp('output', { x: 320, y: 25 }, 'west');
    y1.attrs.label = 'Y1';
    const y2 = createComp('output', { x: 320, y: 185 }, 'west');
    y2.attrs.label = 'Y2';
    root.comps.push(a, b, s1, s2, y1, y2);
    wirePoints(root, [port(a, 'out'), { x: 50, y: 0 }, { x: 50, y: 25 }, portsOf(s1).find((p) => p.dir === 'in')!.world]);
    wirePoints(root, [port(b, 'out'), { x: 60, y: 160 }, { x: 60, y: 185 }, portsOf(s2).find((p) => p.dir === 'in')!.world]);
    wirePoints(root, [portsOf(s1).find((p) => p.dir === 'out')!.world, port(y1, 'in')]);
    wirePoints(root, [portsOf(s2).find((p) => p.dir === 'out')!.world, port(y2, 'in')]);
    const sim = new Simulator();
    sim.update(root, { sub });
    sim.setPinValue(a.id, 1);
    sim.setPinValue(b.id, 0);
    sim.frame(0, false);
    expect(sim.valueOfPort(y1.id, 'in').value).toBe(1);
    expect(sim.valueOfPort(y2.id, 'in').value).toBe(0);
  });

describe('analysis tools', () => {
  it('builds a truth table for the half adder', () => {
    const doc: Doc = { version: 1, name: 'half', comps: [], wires: [] };
    const a = createComp('input', { x: 0, y: 0 });
    a.attrs.label = 'A';
    const b = createComp('input', { x: 0, y: 60 });
    b.attrs.label = 'B';
    const xor = createComp('xor', { x: 150, y: 0 }, 'east', 'en', { inputs: 2, size: 50, bits: 1 });
    const and = createComp('and', { x: 150, y: 60 }, 'east', 'en', { inputs: 2, size: 50, bits: 1 });
    const s = createComp('output', { x: 280, y: 0 }, 'west');
    s.attrs.label = 'S';
    const c = createComp('output', { x: 280, y: 60 }, 'west');
    c.attrs.label = 'C';
    doc.comps.push(a, b, xor, and, s, c);
    wire(doc, port(a, 'out'), port(xor, 'in0'));
    wire(doc, port(b, 'out'), port(xor, 'in1'));
    wire(doc, port(a, 'out'), port(and, 'in0'));
    wire(doc, port(b, 'out'), port(and, 'in1'));
    wire(doc, port(xor, 'out'), port(s, 'in'));
    wire(doc, port(and, 'out'), port(c, 'in'));
    const table = buildTruthTable(doc);
    expect(table.rows).toHaveLength(4);
    expect(table.rows.map((r) => r.outputs.map((o) => o.value))).toEqual([
      [0, 0],
      [1, 0],
      [1, 0],
      [0, 1],
    ]);
  });

  it('synthesizes a half adder from equations', () => {
    const result = synthesizeEquations('S = A ^ B\nC = A & B');
    const table = buildTruthTable(result.doc);
    const si = table.outputs.findIndex((o) => o.label === 'S');
    const ci = table.outputs.findIndex((o) => o.label === 'C');
    expect(table.rows.map((r) => [r.outputs[si].value, r.outputs[ci].value])).toEqual([
      [0, 0],
      [1, 0],
      [1, 0],
      [0, 1],
    ]);
  });

  it('lays out synthesized circuits compactly without shorting nets', () => {
    const result = synthesizeEquations('Y = A & B\nCout = (A & B) | (Cin & (A ^ B))');
    const xs = result.doc.comps.map((c) => c.at.x);
    const width = Math.max(...xs) - Math.min(...xs);
    // Three gate columns plus the pins: much tighter than the old 170px pitch.
    expect(width).toBeLessThan(520);

    const comps = new Map(result.doc.comps.map((c) => [c.id, c]));
    const nets = buildNetlist(result.doc).nets;
    for (const net of nets) {
      const drivers = net.ports.filter((p) => {
        const comp = comps.get(p.compId)!;
        return portsOf(comp).find((x) => x.name === p.port)?.dir === 'out';
      });
      expect(drivers.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('wire following while moving components', () => {
  function halfAdder(): { doc: Doc; a: ComponentInstance; and: ComponentInstance } {
    const doc: Doc = { version: 1, name: 'half', comps: [], wires: [] };
    const a = createComp('input', { x: 0, y: 0 });
    a.attrs.label = 'A';
    const b = createComp('input', { x: 0, y: 60 });
    b.attrs.label = 'B';
    const and = createComp('and', { x: 150, y: 0 }, 'east', 'en', { inputs: 2, size: 50, bits: 1 });
    const out = createComp('output', { x: 280, y: 0 }, 'west');
    out.attrs.label = 'Y';
    doc.comps.push(a, b, and, out);
    wirePoints(doc, [port(a, 'out'), { x: 100, y: 0 }, port(and, 'in0')]);
    wirePoints(doc, [port(b, 'out'), { x: 100, y: 60 }, { x: 100, y: 20 }, port(and, 'in1')]);
    wirePoints(doc, [port(and, 'out'), port(out, 'in')]);
    return { doc, a, and };
  }

  it('keeps a moved gate wired to its inputs and output', () => {
    const { doc, and } = halfAdder();
    const before = cloneDoc(doc);
    and.at = { x: and.at.x, y: and.at.y + 40 };
    doc.wires = followMovedWires(before, [and.id], 0, 40);

    // All wires stay orthogonal.
    for (const w of doc.wires) {
      expect(w.a.x === w.b.x || w.a.y === w.b.y).toBe(true);
    }
    // The gate's ports are still wire endpoints.
    const ends = new Set(doc.wires.flatMap((w) => [`${w.a.x},${w.a.y}`, `${w.b.x},${w.b.y}`]));
    for (const p of portsOf(and)) expect(ends.has(`${p.world.x},${p.world.y}`)).toBe(true);
  });

  it('leaves unrelated wires untouched', () => {
    const { doc, a } = halfAdder();
    const before = cloneDoc(doc);
    const untouched = before.wires.filter(
      (w) => `${w.a.x},${w.a.y}` !== `${port(a, 'out').x},${port(a, 'out').y}`,
    );
    a.at = { x: a.at.x + 20, y: a.at.y };
    doc.wires = followMovedWires(before, [a.id], 20, 0);
    for (const w of untouched) {
      expect(doc.wires.some((x) => x.id === w.id && x.a.x === w.a.x && x.a.y === w.a.y && x.b.x === w.b.x && x.b.y === w.b.y)).toBe(true);
    }
  });

  it('follows a diagonal move with an orthogonal detour', () => {
    const { doc, and } = halfAdder();
    const before = cloneDoc(doc);
    and.at = { x: and.at.x + 30, y: and.at.y + 30 };
    doc.wires = followMovedWires(before, [and.id], 30, 30);
    for (const w of doc.wires) {
      expect(w.a.x === w.b.x || w.a.y === w.b.y).toBe(true);
    }
    const ends = new Set(doc.wires.flatMap((w) => [`${w.a.x},${w.a.y}`, `${w.b.x},${w.b.y}`]));
    for (const p of portsOf(and)) expect(ends.has(`${p.world.x},${p.world.y}`)).toBe(true);
  });
});
