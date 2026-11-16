import type { ComponentInstance, Doc, Point, WireSeg } from '../model/types';
import { uid } from '../model/specs';

export interface ClipboardData {
  version: 1;
  comps: ComponentInstance[];
  wires: WireSeg[];
}

function cloneComp(comp: ComponentInstance): ComponentInstance {
  return structuredClone(comp);
}

function cloneWire(wire: WireSeg): WireSeg {
  return { id: wire.id, a: { ...wire.a }, b: { ...wire.b } };
}

/**
 * Copy the current selection. Coordinates are normalized to the selection's
 * top-left so the same payload can be pasted into any circuit or offset.
 */
export function extractSelection(
  doc: Doc,
  compIds: Iterable<string>,
  wireIds: Iterable<string>,
): ClipboardData | null {
  const selected = new Set(compIds);
  const selectedWires = new Set(wireIds);
  const components = doc.comps.filter((c) => selected.has(c.id));
  if (!components.length && !selectedWires.size) return null;

  const wires = doc.wires.filter((wire) => selectedWires.has(wire.id));

  const points: Point[] = [
    ...components.map((c) => c.at),
    ...wires.flatMap((w) => [w.a, w.b]),
  ];
  if (!points.length) return null;
  const origin = {
    x: Math.min(...points.map((p) => p.x)),
    y: Math.min(...points.map((p) => p.y)),
  };

  return {
    version: 1,
    comps: components.map((comp) => ({
      ...cloneComp(comp),
      at: { x: comp.at.x - origin.x, y: comp.at.y - origin.y },
    })),
    wires: wires.map((wire) => ({
      id: wire.id,
      a: { x: wire.a.x - origin.x, y: wire.a.y - origin.y },
      b: { x: wire.b.x - origin.x, y: wire.b.y - origin.y },
    })),
  };
}

export interface PasteResult {
  comps: ComponentInstance[];
  wires: WireSeg[];
  selComps: string[];
  selWires: string[];
}

/** Materialize clipboard data with fresh ids and a grid-aligned offset. */
export function pasteData(data: ClipboardData, offset = 20): PasteResult | null {
  if (!data.comps.length && !data.wires.length) return null;
  const comps = data.comps.map((comp) => ({
    ...cloneComp(comp),
    id: uid('c'),
    at: { x: comp.at.x + offset, y: comp.at.y + offset },
  }));
  const wires = data.wires.map((wire) => ({
    ...cloneWire(wire),
    id: uid('w'),
    a: { x: wire.a.x + offset, y: wire.a.y + offset },
    b: { x: wire.b.x + offset, y: wire.b.y + offset },
  }));
  return {
    comps,
    wires,
    selComps: comps.map((c) => c.id),
    selWires: wires.map((w) => w.id),
  };
}
