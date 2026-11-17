import { describe, expect, it } from 'vitest';
import { Simulator } from './sim';
import { createComp } from './specs';
import { computeSubLayout, flatId, flattenCircuit } from './hierarchy';
import { portsOf } from './geometry';
import type { ComponentInstance, Doc, Point } from './types';
import {
  createSimView,
  valueOfPortAt,
  valueOfWireAt,
  type SimViewContext,
} from './simView';

const channels = new WeakMap<Doc, number>();
function wire(doc: Doc, a: Point, b: Point) {
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

/** Counter subcircuit: CLK input pin drives a 4-bit counter; Q output pin. */
function counterDoc(): {
  doc: Doc;
  clk: ComponentInstance;
  cnt: ComponentInstance;
  qWireId: string;
} {
  const doc: Doc = { version: 1, name: 'Counter', comps: [], wires: [] };
  const clk = createComp('input', { x: 0, y: 0 });
  clk.attrs.label = 'CLK';
  const cnt = createComp('counter', { x: 120, y: 0 }, 'east', 'en', { bits: 4 });
  const q = createComp('output', { x: 260, y: 0 }, 'west', 'en', { bits: 4 });
  q.attrs.label = 'Q';
  doc.comps.push(clk, cnt, q);
  wire(doc, port(clk, 'out'), port(cnt, 'clk'));
  wire(doc, port(cnt, 'q'), port(q, 'in'));
  const qWireId = doc.wires[doc.wires.length - 1].id;
  return { doc, clk, cnt, qWireId };
}

/** Root with two independent Counter instances, each clocked by its own pin. */
function twoCounterRoot(): {
  doc: Doc;
  sub: ReturnType<typeof counterDoc>;
  clkA: ComponentInstance;
  clkB: ComponentInstance;
  s1: ComponentInstance;
  s2: ComponentInstance;
} {
  const sub = counterDoc();
  const layout = computeSubLayout(sub.doc);
  const doc: Doc = { version: 1, name: 'Top', comps: [], wires: [] };
  const clkA = createComp('input', { x: 0, y: 0 });
  clkA.attrs.label = 'A';
  const clkB = createComp('input', { x: 0, y: 140 });
  clkB.attrs.label = 'B';
  const s1 = createComp('sub', { x: 140, y: 0 }, 'east', 'en', {
    circuit: 'counter',
    circuitName: 'Counter',
    ...layout,
  });
  const s2 = createComp('sub', { x: 140, y: 140 }, 'east', 'en', {
    circuit: 'counter',
    circuitName: 'Counter',
    ...layout,
  });
  doc.comps.push(clkA, clkB, s1, s2);
  wire(doc, port(clkA, 'out'), portsOf(s1).find((p) => p.dir === 'in')!.world);
  wire(doc, port(clkB, 'out'), portsOf(s2).find((p) => p.dir === 'in')!.world);
  return { doc, sub, clkA, clkB, s1, s2 };
}

/** One rising edge then back low; requires a prior settle frame so both
 * instances' edge detectors are initialized while their clocks are low. */
function pulse(sim: Simulator, pin: ComponentInstance) {
  sim.setPinValue(pin.id, 1);
  sim.frame(10, false);
  sim.setPinValue(pin.id, 0);
  sim.frame(20, false);
}

function ctxFor(
  circuits: Record<string, Doc>,
  rootId: string | null,
  circuitId: string,
  path: string[] | null,
): SimViewContext {
  return { circuits, rootId, circuitId, path };
}

describe('flatId', () => {
  it('prefixes ids with the instance path and keeps root ids untouched', () => {
    expect(flatId([], 'a')).toBe('a');
    expect(flatId(['x'], 'a')).toBe('x/a');
    expect(flatId(['x', 'y'], 'a')).toBe('x/y/a');
  });
});

describe('flattenCircuit with a stable root id', () => {
  it('prefixes instance components and wires with instance ids, not the root name', () => {
    const { doc, sub, s1 } = twoCounterRoot();
    const circuits = { top: doc, counter: sub.doc };
    const flat = flattenCircuit(doc, circuits, 'top').doc;
    expect(flat.comps.some((c) => c.id === flatId([s1.id], sub.cnt.id))).toBe(true);
    expect(flat.comps.some((c) => c.id === `${s1.id}/${sub.cnt.id}`)).toBe(true);
    expect(flat.wires.some((w) => w.id === `${s1.id}/${sub.qWireId}`)).toBe(true);
    // Root components and wires keep their original ids.
    for (const c of doc.comps) {
      expect(flat.comps.some((fc) => fc.id === c.id)).toBe(true);
    }
    for (const w of doc.wires) {
      expect(flat.wires.some((fw) => fw.id === w.id)).toBe(true);
    }
    // The flattened doc must not leak the root *name* into instance identities:
    // renaming the root keeps every flattened id stable.
    const renamed = { ...doc, name: 'Zebra' };
    const flat2 = flattenCircuit(renamed, { ...circuits, top: renamed }, 'top').doc;
    expect(flat2.comps.map((c) => c.id)).toEqual(flat.comps.map((c) => c.id));
    expect(flat2.wires.map((w) => w.id)).toEqual(flat.wires.map((w) => w.id));
  });

  it('keeps instance identities stable across independent roots', () => {
    const { doc, sub, s1, s2 } = twoCounterRoot();
    const flat = flattenCircuit(doc, { top: doc, counter: sub.doc }, 'top').doc;
    const ids = flat.comps.map((c) => c.id);
    expect(ids.filter((id) => id.startsWith(`${s1.id}/`)).length).toBeGreaterThan(0);
    expect(ids.some((id) => id.startsWith(`${s2.id}/${s1.id}`))).toBe(false);
  });
});

describe('instance state through the sim view', () => {
  it('reads two same-type Counter instances independently', () => {
    const { doc, sub, clkA, clkB, s1, s2 } = twoCounterRoot();
    const circuits = { top: doc, counter: sub.doc };
    const sim = new Simulator();
    sim.update(doc, circuits, 'top');
    sim.frame(0, false);

    pulse(sim, clkA);
    pulse(sim, clkA);
    pulse(sim, clkB);

    // s1 counted twice, s2 once; each path reads its own exact instance.
    expect(valueOfPortAt(sim, [s1.id], sub.cnt.id, 'q')!.value).toBe(2);
    expect(valueOfPortAt(sim, [s2.id], sub.cnt.id, 'q')!.value).toBe(1);
    // A bare (root-level) lookup cannot alias either instance.
    expect(valueOfPortAt(sim, [], sub.cnt.id, 'q')!.value).not.toBe(2);

    // Pin reads: the root view reports user-set pin values, an instance view
    // reads the value driven into that exact instance.
    sim.setPinValue(clkA.id, 1);
    sim.frame(40, false);
    const rootView = createSimView(sim, ctxFor(circuits, 'top', 'top', []));
    expect(rootView.pinValueAt(clkA.id)).toBe(1);
    const instView = createSimView(sim, ctxFor(circuits, 'top', 'counter', [s1.id]));
    expect(instView.pinValueAt(sub.clk.id)).toBe(1);
    const otherInst = createSimView(sim, ctxFor(circuits, 'top', 'counter', [s2.id]));
    expect(otherInst.pinValueAt(sub.clk.id)).toBe(0);
  });

  it('maps wires of the viewed instance, including nested instances', () => {
    // Inner: A -> NOT -> Y
    const inner: Doc = { version: 1, name: 'Inner', comps: [], wires: [] };
    const aIn = createComp('input', { x: 0, y: 0 });
    aIn.attrs.label = 'A';
    const not = createComp('not', { x: 110, y: 0 });
    const yOut = createComp('output', { x: 220, y: 0 }, 'west');
    yOut.attrs.label = 'Y';
    inner.comps.push(aIn, not, yOut);
    wire(inner, port(aIn, 'out'), port(not, 'in'));
    wire(inner, port(not, 'out'), port(yOut, 'in'));
    const innerWires = inner.wires.map((w) => w.id);

    // Mid: A -> instance of Inner -> Y
    const mid: Doc = { version: 1, name: 'Mid', comps: [], wires: [] };
    const mIn = createComp('input', { x: 0, y: 0 });
    mIn.attrs.label = 'A';
    const innerLayout = computeSubLayout(inner);
    const t = createComp('sub', { x: 120, y: 0 }, 'east', 'en', {
      circuit: 'inner',
      circuitName: 'Inner',
      ...innerLayout,
    });
    const mOut = createComp('output', { x: 300, y: 0 }, 'west');
    mOut.attrs.label = 'Y';
    mid.comps.push(mIn, t, mOut);
    wire(mid, port(mIn, 'out'), portsOf(t).find((p) => p.dir === 'in')!.world);
    wire(mid, portsOf(t).find((p) => p.dir === 'out')!.world, port(mOut, 'in'));
    const midWires = mid.wires.map((w) => w.id);

    // Root: A -> instance of Mid -> Y
    const root: Doc = { version: 1, name: 'Root', comps: [], wires: [] };
    const rIn = createComp('input', { x: 0, y: 0 });
    rIn.attrs.label = 'A';
    const midLayout = computeSubLayout(mid);
    const m = createComp('sub', { x: 120, y: 0 }, 'east', 'en', {
      circuit: 'mid',
      circuitName: 'Mid',
      ...midLayout,
    });
    const rOut = createComp('output', { x: 320, y: 0 }, 'west');
    rOut.attrs.label = 'Y';
    root.comps.push(rIn, m, rOut);
    wire(root, port(rIn, 'out'), portsOf(m).find((p) => p.dir === 'in')!.world);
    wire(root, portsOf(m).find((p) => p.dir === 'out')!.world, port(rOut, 'in'));

    const circuits = { root, mid, inner };
    const sim = new Simulator();
    sim.update(root, circuits, 'root');
    sim.setPinValue(rIn.id, 1);
    sim.frame(1, false);
    sim.frame(2, false);

    // Mid-level wire: driven straight from the root pin.
    const midWire = valueOfWireAt(sim, [m.id], midWires[0])!;
    expect(midWire.value).toBe(1);
    // Nested Inner wire: the NOT input inside [m, t] sees the same 1.
    const nestedIn = valueOfWireAt(sim, [m.id, t.id], innerWires[0])!;
    expect(nestedIn.value).toBe(1);
    const nestedOut = valueOfWireAt(sim, [m.id, t.id], innerWires[1])!;
    expect(nestedOut.value).toBe(0);
    expect(valueOfPortAt(sim, [m.id, t.id], yOut.id, 'in')!.value).toBe(0);
    expect(valueOfPortAt(sim, [], rOut.id, 'in')!.value).toBe(0);
    // A wrong path never falls back to the first instance.
    expect(valueOfWireAt(sim, ['bogus'], innerWires[0])).toBeNull();
  });

  it('maps width-conflict issues for wires inside an instance', () => {
    const bad: Doc = { version: 1, name: 'Bad', comps: [], wires: [] };
    const d = createComp('input', { x: 0, y: 0 }, 'east', 'en', { bits: 4 });
    d.attrs.label = 'D';
    const y = createComp('output', { x: 160, y: 0 }, 'west', 'en', { bits: 1 });
    y.attrs.label = 'Y';
    bad.comps.push(d, y);
    wire(bad, port(d, 'out'), port(y, 'in'));
    const badWireId = bad.wires[bad.wires.length - 1].id;

    const root: Doc = { version: 1, name: 'Root', comps: [], wires: [] };
    const layout = computeSubLayout(bad);
    const b = createComp('sub', { x: 100, y: 0 }, 'east', 'en', {
      circuit: 'bad',
      circuitName: 'Bad',
      ...layout,
    });
    root.comps.push(b);

    const sim = new Simulator();
    sim.update(root, { root, bad }, 'root');
    sim.frame(0, false);

    const view = createSimView(sim, ctxFor({ root, bad }, 'root', 'bad', [b.id]));
    expect(view.attached).toBe(true);
    const sv = view.valueOfWireAt(badWireId)!;
    expect(sv.width).toBe(4);
    expect(view.widthIssueAt(badWireId)).toBe(true);
    // The mismatched 1-bit port is pinned to E in its stub net.
    expect(view.valueOfPortAt(y.id, 'in')!.state).toBe('e');
  });

  it('exposes mapped pin and memory reads', () => {
    const ramDoc: Doc = { version: 1, name: 'Mem', comps: [], wires: [] };
    const ram = createComp('ram', { x: 0, y: 0 }, 'east', 'en', { addrBits: 2, dataBits: 8 });
    ramDoc.comps.push(ram);

    const root: Doc = { version: 1, name: 'Root', comps: [], wires: [] };
    const layout = computeSubLayout(ramDoc);
    const r = createComp('sub', { x: 100, y: 0 }, 'east', 'en', {
      circuit: 'mem',
      circuitName: 'Mem',
      ...layout,
    });
    root.comps.push(r);

    const circuits = { root, mem: ramDoc };
    const sim = new Simulator();
    sim.update(root, circuits, 'root');
    sim.frame(0, false);

    const view = createSimView(sim, ctxFor(circuits, 'root', 'mem', [r.id]));
    expect(view.canWrite).toBe(false);
    const values = view.memoryValuesAt(ram)!;
    expect(values).toHaveLength(4);
    // Mirrors the inspector flow: contents live in attrs and are pushed into
    // the simulator memory keyed by the flattened instance id.
    const withMem: ComponentInstance = { ...ram, attrs: { ...ram.attrs, memory: [0, 0xab, 0, 0] } };
    expect(view.loadMemoryAt(withMem, [0, 0xab, 0, 0])).toBe(true);
    expect(view.memoryValuesAt(withMem)![1]).toBe(0xab);
    const rootView = createSimView(sim, ctxFor(circuits, 'root', 'root', []));
    expect(rootView.canWrite).toBe(true);
  });

  it('returns null for every runtime read when the view is detached', () => {
    const { doc, sub, s1 } = twoCounterRoot();
    const circuits = { top: doc, counter: sub.doc };
    const sim = new Simulator();
    sim.update(doc, circuits, 'top');
    sim.frame(0, false);

    // No path at all.
    const detached = createSimView(sim, ctxFor(circuits, 'top', 'counter', null));
    expect(detached.attached).toBe(false);
    expect(detached.canWrite).toBe(false);
    expect(detached.valueOfPortAt(sub.cnt.id, 'q')).toBeNull();
    expect(detached.valueOfWireAt(sub.qWireId)).toBeNull();
    expect(detached.memoryValuesAt(sub.cnt)).toBeNull();

    // A path that does not resolve to the viewed circuit is detached too.
    const wrong = createSimView(sim, ctxFor(circuits, 'top', 'top', [s1.id]));
    expect(wrong.attached).toBe(false);
    // A dangling instance id is detached as well.
    const dangling = createSimView(sim, ctxFor(circuits, 'top', 'counter', ['nope']));
    expect(dangling.attached).toBe(false);
  });
});
