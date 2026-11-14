import type { ComponentInstance, Doc, SubPinLayout } from './types';
import { estimateTextWidth, portsOf } from './geometry';
import { toWorld } from './types';

export interface SubLayout {
  subPins: SubPinLayout[];
  subW: number;
  subH: number;
}

/**
 * Generate a Logisim-like symbol layout for a circuit: input pins on the left,
 * output pins on the right, preserving the order they appear vertically.
 */
export function computeSubLayout(target: Doc): SubLayout {
  const pins = target.comps
    .filter((c) => c.kind === 'input' || c.kind === 'output')
    .map((c) => ({
      comp: c,
      world: portsOf(c)[0]?.world ?? c.at,
    }))
    .sort((a, b) => a.world.y - b.world.y || a.world.x - b.world.x);
  const inputs = pins.filter((p) => p.comp.kind === 'input');
  const outputs = pins.filter((p) => p.comp.kind === 'output');
  const rows = Math.max(inputs.length, outputs.length, 1);
  const gap = rows <= 4 ? 20 : 14;
  const h = Math.max(50, 20 + Math.max(rows - 1, 0) * gap + 20);
  const labelWidth = Math.max(
    0,
    ...pins.map((p) => estimateTextWidth(p.comp.attrs.label || (p.comp.kind === 'input' ? 'in' : 'out'), 10)),
  );
  const w = Math.max(70, Math.min(220, labelWidth * 2 + 44));
  const make = (
    list: { comp: ComponentInstance; world: { x: number; y: number } }[],
    kind: 'input' | 'output',
  ): SubPinLayout[] =>
    list.map((p, i) => ({
      id: p.comp.id,
      label: p.comp.attrs.label || `${kind === 'input' ? 'I' : 'O'}${i + 1}`,
      kind,
      bits: Math.max(1, Math.min(32, p.comp.attrs.bits ?? 1)),
      y: Math.round(20 + i * gap),
    }));
  return {
    subPins: [...make(inputs, 'input'), ...make(outputs, 'output')],
    subW: w,
    subH: h,
  };
}

/** Apply generated symbol geometry to every subcircuit instance in a circuit. */
export function syncSubLayouts(doc: Doc, circuits: Record<string, Doc>): Doc {
  let changed = false;
  const comps = doc.comps.map((comp) => {
    if (comp.kind !== 'sub' || !comp.attrs.circuit) return comp;
    const target = circuits[comp.attrs.circuit];
    if (!target) return comp;
    const layout = computeSubLayout(target);
    const old = comp.attrs;
    const same =
      old.circuitName === target.name &&
      old.subW === layout.subW &&
      old.subH === layout.subH &&
      old.subPins?.length === layout.subPins.length &&
      old.subPins.every(
        (p, i) =>
          p.id === layout.subPins[i].id &&
          p.label === layout.subPins[i].label &&
          p.kind === layout.subPins[i].kind &&
          p.bits === layout.subPins[i].bits &&
          p.y === layout.subPins[i].y,
      );
    if (same) return comp;
    changed = true;
    return { ...comp, attrs: { ...old, circuitName: target.name, ...layout } };
  });
  return changed ? { ...doc, comps } : doc;
}

export interface FlattenResult {
  doc: Doc;
  errors: string[];
}

/**
 * Flatten a project into one synthetic circuit for the simulator.
 *
 * Every subcircuit instance is copied into an isolated coordinate region and a
 * virtual (possibly diagonal) wire connects each symbol port to the matching
 * pin inside the copied circuit. The netlist builder only needs wire endpoints
 * for connectivity, so the virtual wires never leak into the rendered canvas.
 * Input pins inside an instance are marked as pass-through interfaces so they
 * do not drive the net with a default 0.
 */
export function flattenCircuit(root: Doc, circuits: Record<string, Doc>): FlattenResult {
  const errors: string[] = [];
  const comps: ComponentInstance[] = [];
  const wires: Doc['wires'] = [];
  let instanceSeq = 0;
  let wireSeq = 0;

  const nextOffset = () => {
    const i = instanceSeq++;
    return { x: 2_000_000 + (i % 40) * 120_000, y: 2_000_000 + Math.floor(i / 40) * 120_000 };
  };

  const addVirtualWire = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    wires.push({
      id: `v${wireSeq++}`,
      a: { x: Math.round(a.x), y: Math.round(a.y) },
      b: { x: Math.round(b.x), y: Math.round(b.y) },
    });
  };

  const instantiate = (
    target: Doc,
    offset: { x: number; y: number },
    path: string,
    stack: string[],
    depth: number,
  ) => {
    if (depth > 24) {
      errors.push('Subcircuit nesting is too deep');
      return;
    }
    const prefix = `${path}/`;
    const map = new Map<string, ComponentInstance>();
    const copies: ComponentInstance[] = target.comps.map((comp) => {
      const id = `${prefix}${comp.id}`;
      const copy: ComponentInstance = {
        ...comp,
        id,
        at: { x: comp.at.x + offset.x, y: comp.at.y + offset.y },
        attrs: {
          ...comp.attrs,
          ...(comp.kind === 'input' ? { _interface: true } : {}),
          // Tunnels are scoped to a circuit instance in Logisim. Without the
          // path prefix, same-named tunnels in two instances would merge.
          ...(comp.kind === 'tunnel'
            ? { label: `${path}::${comp.attrs.label ?? 'net'}` }
            : {}),
        },
      };
      map.set(comp.id, copy);
      return copy;
    });
    comps.push(...copies);
    for (const w of target.wires) {
      wires.push({
        id: `${prefix}w${wireSeq++}`,
        a: { x: w.a.x + offset.x, y: w.a.y + offset.y },
        b: { x: w.b.x + offset.x, y: w.b.y + offset.y },
      });
    }

    // Nested instances.
    for (let i = 0; i < target.comps.length; i++) {
      const original = target.comps[i];
      if (original.kind !== 'sub' || !original.attrs.circuit) continue;
      const nestedTarget = circuits[original.attrs.circuit];
      const copy = copies[i];
      if (!nestedTarget) {
        errors.push(`Missing subcircuit: ${original.attrs.circuit}`);
        continue;
      }
      if (stack.includes(original.attrs.circuit)) {
        errors.push(`Recursive subcircuit: ${original.attrs.circuit}`);
        continue;
      }
      const innerOffset = nextOffset();
      const before = comps.length;
      instantiate(
        nestedTarget,
        innerOffset,
        `${prefix}${original.id}`,
        [...stack, original.attrs.circuit],
        depth + 1,
      );
      const pins = copy.attrs.subPins ?? [];
      for (const pin of pins) {
        const inner = comps.slice(before).find((c) => c.id === `${prefix}${original.id}/${pin.id}`);
        if (!inner) continue;
        const innerPort = portsOf(inner).find((p) => (pin.kind === 'input' ? p.name === 'out' : p.name === 'in'));
        if (!innerPort) continue;
        const outerLocal = { x: pin.kind === 'input' ? 0 : (copy.attrs.subW ?? 80), y: pin.y };
        addVirtualWire(toWorld(copy, outerLocal), innerPort.world);
      }
    }
  };

  comps.push(...root.comps);
  wires.push(...root.wires);

  const rootId = Object.keys(circuits).find((id) => circuits[id] === root);
  const rootStack = [rootId ?? root.name];
  for (let i = 0; i < root.comps.length; i++) {
    const original = root.comps[i];
    if (original.kind !== 'sub' || !original.attrs.circuit) continue;
    const target = circuits[original.attrs.circuit];
    if (!target) {
      errors.push(`Missing subcircuit: ${original.attrs.circuit}`);
      continue;
    }
    if (rootStack.includes(original.attrs.circuit)) {
      errors.push(`Recursive subcircuit: ${original.attrs.circuit}`);
      continue;
    }
    const before = comps.length;
    const offset = nextOffset();
    instantiate(target, offset, `${root.name}/${original.id}`, [...rootStack, original.attrs.circuit], 1);
    const fallbackLayout = computeSubLayout(target);
    const pins = original.attrs.subPins?.length ? original.attrs.subPins : fallbackLayout.subPins;
    const subW = original.attrs.subPins?.length ? original.attrs.subW ?? fallbackLayout.subW : fallbackLayout.subW;
    for (const pin of pins) {
      const inner = comps
        .slice(before)
        .find((c) => c.id === `${root.name}/${original.id}/${pin.id}`);
      if (!inner) continue;
      const innerPort = portsOf(inner).find((p) => (pin.kind === 'input' ? p.name === 'out' : p.name === 'in'));
      if (!innerPort) continue;
      const outerLocal = { x: pin.kind === 'input' ? 0 : subW, y: pin.y };
      addVirtualWire(toWorld(original, outerLocal), innerPort.world);
    }
  }

  return {
    doc: {
      version: 1,
      name: `${root.name} (flattened)`,
      comps,
      wires,
    },
    errors,
  };
}
