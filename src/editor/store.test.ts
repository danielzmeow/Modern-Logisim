import { describe, expect, it } from 'vitest';
import { projectFromNamedDocs, useEditor } from './store';
import type { Doc } from '../model/types';
import { createComp } from '../model/specs';

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
