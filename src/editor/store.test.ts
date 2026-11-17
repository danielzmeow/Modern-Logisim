import { describe, expect, it } from 'vitest';
import { projectFromNamedDocs, useEditor } from './store';
import { sim } from '../model/sim';
import { tr } from '../i18n';
import type { Doc } from '../model/types';
import { createComp } from '../model/specs';
import { portsOf } from '../model/geometry';
import { computeSubLayout, flatId } from '../model/hierarchy';
import type { ComponentInstance } from '../model/types';

const doc: Doc = {
  version: 1,
  name: 'WireTest',
  comps: [],
  wires: [
    { id: 'a', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
    { id: 'b', a: { x: 100, y: 0 }, b: { x: 200, y: 0 } },
    { id: 'c', a: { x: 100, y: 0 }, b: { x: 100, y: 80 } },
  ],
};

describe('wire selection', () => {
  it('selects a single segment and deletes only that segment', () => {
    useEditor.getState().loadDoc(doc);
    useEditor.getState().selectWire('a');
    expect(useEditor.getState().selWires).toEqual(['a']);
    useEditor.getState().deleteSelection();
    expect(useEditor.getState().doc.wires.map((w) => w.id)).toEqual(['b', 'c']);
  });

  it('can select and delete the whole net', () => {
    useEditor.getState().loadDoc(doc);
    useEditor.getState().selectWireNet('a');
    expect(new Set(useEditor.getState().selWires)).toEqual(new Set(['a', 'b', 'c']));
    useEditor.getState().deleteSelection();
    expect(useEditor.getState().doc.wires).toHaveLength(0);
  });

  it('splits a segment at an interior point', () => {
    useEditor.getState().loadDoc(doc);
    useEditor.getState().splitWire('a', { x: 50, y: 2 });
    const wires = useEditor.getState().doc.wires;
    expect(wires.some((w) => w.a.x === 0 && w.b.x === 50)).toBe(true);
    expect(wires.some((w) => w.a.x === 50 && w.b.x === 100)).toBe(true);
    expect(wires.some((w) => w.id === 'a')).toBe(false);
  });
});


describe('project import', () => {
  it('maps named circuits to ids and generates subcircuit pin layouts', () => {
    const sub: Doc = { version: 1, name: 'Inverter', comps: [], wires: [] };
    const ain = createComp('input', { x: 0, y: 0 });
    ain.attrs.label = 'A';
    const aout = createComp('output', { x: 100, y: 0 }, 'west');
    aout.attrs.label = 'Y';
    sub.comps.push(ain, aout);
    const root: Doc = { version: 1, name: 'Top', comps: [], wires: [] };
    const inst = createComp('sub', { x: 200, y: 0 });
    inst.attrs.circuit = 'Inverter';
    inst.attrs.circuitName = 'Inverter';
    root.comps.push(inst);
    const project = projectFromNamedDocs({ Top: root, Inverter: sub }, 'Top');
    expect(project.order).toHaveLength(2);
    expect(project.circuits[project.current].name).toBe('Top');
    const imported = project.circuits[project.current].comps[0];
    expect(imported.attrs.circuit).toBeTruthy();
    expect(imported.attrs.circuit).not.toBe('Inverter');
    expect(imported.attrs.circuitName).toBe('Inverter');
    expect(imported.attrs.subPins).toHaveLength(2);
  });
});

describe('wires follow moved components', () => {
  function docWithWire(): { doc: Doc; pin: ReturnType<typeof createComp>; out: ReturnType<typeof createComp> } {
    const doc: Doc = { version: 1, name: 'move', comps: [], wires: [] };
    const pin = createComp('input', { x: 0, y: 0 });
    const out = createComp('output', { x: 100, y: 0 }, 'west');
    doc.comps.push(pin, out);
    doc.wires.push({ id: 'w', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } });
    return { doc, pin, out };
  }

  it('nudges the attached wire along with the component', () => {
    const { doc, pin } = docWithWire();
    useEditor.getState().loadDoc(doc);
    useEditor.getState().selectComp(pin.id);
    useEditor.getState().nudgeSelection(0, 40);

    const wires = useEditor.getState().doc.wires;
    const ends = wires.flatMap((w) => [w.a, w.b]);
    expect(ends.some((p) => p.x === 0 && p.y === 40)).toBe(true);
    expect(ends.some((p) => p.x === 100 && p.y === 0)).toBe(true);
    for (const w of wires) expect(w.a.x === w.b.x || w.a.y === w.b.y).toBe(true);
  });

  it('keeps the wire attached when the inspector moves the component', () => {
    const { doc, pin } = docWithWire();
    useEditor.getState().loadDoc(doc);
    useEditor.getState().updateCompGeom(pin.id, { at: { x: 20, y: 30 } });

    const wires = useEditor.getState().doc.wires;
    const ends = wires.flatMap((w) => [w.a, w.b]);
    expect(ends.some((p) => p.x === 20 && p.y === 30)).toBe(true);
    expect(ends.some((p) => p.x === 100 && p.y === 0)).toBe(true);
  });

  it('leaves the wire alone when only the facing changes', () => {
    const { doc, pin } = docWithWire();
    useEditor.getState().loadDoc(doc);
    useEditor.getState().updateCompGeom(pin.id, { facing: 'west' });
    expect(useEditor.getState().doc.wires).toEqual([
      { id: 'w', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } },
    ]);
  });
});

describe('clipboard actions', () => {
  it('copies a selection and pastes it into another circuit', () => {
    const empty: Doc = { version: 1, name: 'Empty', comps: [], wires: [] };
    const source: Doc = {
      version: 1,
      name: 'Source',
      comps: [createComp('input', { x: 0, y: 0 }), createComp('output', { x: 100, y: 0 }, 'west')],
      wires: [{ id: 'w', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }],
    };
    expect(
      useEditor.getState().loadProject({
        current: 'a',
        circuits: { a: source, b: empty },
        order: ['a', 'b'],
      }),
    ).toBe(true);
    useEditor.getState().selectAll();
    expect(useEditor.getState().copySelection()).toBe(true);
    useEditor.getState().switchCircuit('b');
    expect(useEditor.getState().pasteClipboard()).toBe(true);
    const pasted = useEditor.getState().doc;
    expect(pasted.comps).toHaveLength(2);
    expect(pasted.wires).toHaveLength(1);
    expect(pasted.comps.map((c) => c.kind)).toEqual(['input', 'output']);
    expect(pasted.comps[0].id).not.toBe(source.comps[0].id);
  });
});


describe('oscillation alert', () => {
  // Same clock-gated inverter ring as the simulator tests: oscillates as soon
  // as the clock rises (250 ms at the default 2 Hz).
  function loadOscillatingRing() {
    const doc: Doc = { version: 1, name: 'ring', comps: [], wires: [] };
    let n = 0;
    const wire = (a: { x: number; y: number }, b: { x: number; y: number }) => {
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
    const port = (comp: ReturnType<typeof createComp>, name: string) =>
      portsOf(comp).find((p) => p.name === name)!.world;
    const clk = createComp('clock', { x: 0, y: 0 });
    const and = createComp('and', { x: 160, y: 0 }, 'east', 'en', { inputs: 2 });
    const not = createComp('not', { x: 320, y: 0 });
    const ta = createComp('tunnel', { x: 460, y: 0 });
    ta.attrs.label = 'FB';
    const tb = createComp('tunnel', { x: 60, y: 60 });
    tb.attrs.label = 'FB';
    doc.comps.push(clk, and, not, ta, tb);
    wire(port(clk, 'out'), port(and, 'in0'));
    wire(port(and, 'out'), port(not, 'in'));
    wire(port(not, 'out'), ta.at);
    wire(tb.at, port(and, 'in1'));
    useEditor.getState().loadDoc(doc);
    sim.update(useEditor.getState().doc, useEditor.getState().circuits);
    sim.frame(0, false);
    sim.frame(0, true);
    sim.frame(250, true);
  }

  it('stops the simulation and shows one toast per oscillation episode', () => {
    loadOscillatingRing();
    expect(sim.oscillation).not.toBeNull();
    const s = useEditor.getState();
    s.setRunning(true);
    s.reportOscillation(sim.oscillation !== null);
    const st = useEditor.getState();
    expect(st.running).toBe(false);
    const toast = st.toast!;
    expect(toast.tone).toBe('error');
    expect(toast.text).toBe(tr(st.lang, 'sim.oscillation'));
    const id = toast.id;
    // Repeated reports (every RAF) must not re-show the toast.
    s.reportOscillation(true);
    s.reportOscillation(true);
    expect(useEditor.getState().toast!.id).toBe(id);
  });

  it('alerts again after reset begins a fresh detection cycle', () => {
    loadOscillatingRing();
    const s = useEditor.getState();
    s.reportOscillation(true);
    const id = useEditor.getState().toast!.id;
    // Topbar reset: kernel state cleared and the alert re-armed.
    sim.reset();
    expect(sim.oscillation).toBeNull();
    s.reportOscillation(false);
    // The unchanged ring is detected again once the clock rises.
    sim.frame(500, true);
    expect(sim.oscillation).not.toBeNull();
    s.reportOscillation(true);
    expect(useEditor.getState().toast!.id).not.toBe(id);
  });
});

describe('simulation root and instance path', () => {
  const channels = new WeakMap<Doc, number>();
  // Wires must be axis-aligned: the project sanitizer drops diagonal segments.
  function wire(doc: Doc, a: { x: number; y: number }, b: { x: number; y: number }) {
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

  function counterDoc(): { doc: Doc; clk: ComponentInstance; cnt: ComponentInstance } {
    const doc: Doc = { version: 1, name: 'Counter', comps: [], wires: [] };
    const clk = createComp('input', { x: 0, y: 0 });
    clk.attrs.label = 'CLK';
    const cnt = createComp('counter', { x: 120, y: 0 }, 'east', 'en', { bits: 4 });
    doc.comps.push(clk, cnt);
    wire(doc, portsOf(clk).find((p) => p.name === 'out')!.world, portsOf(cnt).find((p) => p.name === 'clk')!.world);
    return { doc, clk, cnt };
  }

  function loadCounterProject() {
    const sub = counterDoc();
    const layout = computeSubLayout(sub.doc);
    const top: Doc = { version: 1, name: 'Top', comps: [], wires: [] };
    const clkA = createComp('input', { x: 0, y: 0 });
    clkA.attrs.label = 'A';
    const s1 = createComp('sub', { x: 140, y: 0 }, 'east', 'en', {
      circuit: 'counter',
      circuitName: 'Counter',
      ...layout,
    });
    top.comps.push(clkA, s1);
    wire(top, portsOf(clkA).find((p) => p.name === 'out')!.world, portsOf(s1).find((p) => p.dir === 'in')!.world);
    const other: Doc = { version: 1, name: 'Other', comps: [], wires: [] };
    const ok = useEditor.getState().loadProject({
      current: 'top',
      circuits: { top, counter: sub.doc, other },
      order: ['top', 'counter', 'other'],
    });
    expect(ok).toBe(true);
    return { sub, clkA, s1 };
  }

  function pulseClkA(clkA: ComponentInstance) {
    sim.setPinValue(clkA.id, 1);
    sim.frame(10, false);
    sim.setPinValue(clkA.id, 0);
    sim.frame(20, false);
    sim.setPinValue(clkA.id, 1);
    sim.frame(30, false);
  }

  it('initializes the root on load and never resets on plain circuit switches', () => {
    const { sub, clkA, s1 } = loadCounterProject();
    let st = useEditor.getState();
    expect(st.simRootId).toBe('top');
    expect(st.simPath).toEqual([]);

    st = useEditor.getState();
    sim.update(st.circuits['top'], st.circuits, 'top');
    pulseClkA(clkA);
    expect(sim.valueOfPort(flatId([s1.id], sub.cnt.id), 'q').value).toBe(1);
    const tickBefore = sim.tick;

    useEditor.getState().switchCircuit('counter');
    st = useEditor.getState();
    expect(st.currentCircuit).toBe('counter');
    expect(st.simRootId).toBe('top');
    expect(st.simPath).toBeNull();
    expect(sim.tick).toBe(tickBefore);

    useEditor.getState().switchCircuit('top');
    st = useEditor.getState();
    expect(st.simPath).toEqual([]);
    // The flattened netlist is rebuilt with the new circuits record, but
    // instance identities are stable so the counter keeps counting.
    sim.update(st.circuits['top'], st.circuits, 'top');
    pulseClkA(clkA);
    expect(sim.valueOfPort(flatId([s1.id], sub.cnt.id), 'q').value).toBe(2);
  });

  it('enters the exact instance path and steps back to the parent', () => {
    const { s1 } = loadCounterProject();
    const st = useEditor.getState();
    st.enterInstance(s1.id);
    let cur = useEditor.getState();
    expect(cur.currentCircuit).toBe('counter');
    expect(cur.simPath).toEqual([s1.id]);
    expect(cur.simRootId).toBe('top');
    cur.exitInstance();
    cur = useEditor.getState();
    expect(cur.currentCircuit).toBe('top');
    expect(cur.simPath).toEqual([]);
    // Unknown ids are ignored.
    cur.enterInstance('nope');
    expect(useEditor.getState().currentCircuit).toBe('top');
  });

  it('detached views expose no runtime writes', () => {
    loadCounterProject();
    const st = useEditor.getState();
    st.switchCircuit('counter');
    const cur = useEditor.getState();
    expect(cur.simPath).toBeNull();
    expect(cur.simRootId).toBe('top');
  });

  it('setSimulationRoot re-anchors the root explicitly and resets', () => {
    const { clkA } = loadCounterProject();
    const st = useEditor.getState();
    sim.update(st.circuits['top'], st.circuits, 'top');
    sim.frame(0, false);
    const tickBefore = sim.tick;
    useEditor.getState().setSimulationRoot('counter');
    const cur = useEditor.getState();
    expect(cur.simRootId).toBe('counter');
    // The current circuit (top) is no longer the root: detached view.
    expect(cur.simPath).toBeNull();
    expect(sim.tick).toBeGreaterThan(tickBefore);
    useEditor.getState().switchCircuit('counter');
    expect(useEditor.getState().simPath).toEqual([]);
    void clkA;
  });

  it('root rename keeps the root identity and the simulation state', () => {
    const { sub, clkA, s1 } = loadCounterProject();
    let st = useEditor.getState();
    sim.update(st.circuits['top'], st.circuits, 'top');
    pulseClkA(clkA);
    expect(sim.valueOfPort(flatId([s1.id], sub.cnt.id), 'q').value).toBe(1);

    useEditor.getState().setName('Mega');
    st = useEditor.getState();
    expect(st.doc.name).toBe('Mega');
    expect(st.simRootId).toBe('top');
    // Re-flatten the renamed root: ids are stable, the counter is not reset.
    sim.update(st.circuits['top'], st.circuits, 'top');
    pulseClkA(clkA);
    expect(sim.valueOfPort(flatId([s1.id], sub.cnt.id), 'q').value).toBe(2);
  });

  it('falls back to the current circuit and resets when the root is deleted', () => {
    const { clkA } = loadCounterProject();
    let st = useEditor.getState();
    sim.update(st.circuits['top'], st.circuits, 'top');
    sim.frame(0, false);
    const tickBefore = sim.tick;
    // Referenced circuits are still refused.
    useEditor.getState().deleteCircuit('counter');
    st = useEditor.getState();
    expect(st.circuits['counter']).toBeTruthy();
    expect(st.simRootId).toBe('top');
    // Deleting the root re-anchors to the fallback circuit and resets.
    useEditor.getState().deleteCircuit('top');
    st = useEditor.getState();
    expect(st.currentCircuit).toBe('counter');
    expect(st.simRootId).toBe('counter');
    expect(st.simPath).toEqual([]);
    expect(sim.tick).toBeGreaterThan(tickBefore);
    void clkA;
  });

  it('loadDoc and newDoc initialize the root to the current circuit', () => {
    useEditor.getState().loadDoc({ version: 1, name: 'Solo', comps: [], wires: [] });
    let st = useEditor.getState();
    expect(st.simRootId).toBe(st.currentCircuit);
    expect(st.simPath).toEqual([]);
    useEditor.getState().newDoc();
    st = useEditor.getState();
    expect(st.simRootId).toBe(st.currentCircuit);
    expect(st.simPath).toEqual([]);
  });
});
