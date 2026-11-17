import type { ComponentInstance, Doc } from './types';
import type { Simulator, SimValue } from './sim';
import { flatId } from './hierarchy';
import type { Netlist } from './netlist';

/**
 * A simulation view binds one circuit being edited/viewed to the flattened
 * netlist of the simulation root. `path` is the list of subcircuit instance
 * ids from the root down to the viewed circuit:
 *
 * - `[]`          the view is the simulation root itself (full runtime access)
 * - `['a', 'b']`  the view is the instance `b` inside instance `a`
 * - `null`        detached: the viewed circuit is not part of the simulation
 *                 root, so no runtime values are available (read-only edits)
 */
export interface SimViewContext {
  circuits: Record<string, Doc>;
  rootId: string | null;
  circuitId: string;
  path: string[] | null;
}

/**
 * Value of `compId:port` as seen from `path` in the flattened netlist.
 * Returns null when the view is detached — callers must not fall back to
 * root-document indices, which would alias arbitrary instances.
 */
export function valueOfPortAt(
  sim: Simulator,
  path: string[] | null,
  compId: string,
  port: string,
): SimValue | null {
  if (path === null) return null;
  return sim.valueOfPort(flatId(path, compId), port);
}

/**
 * Value of a wire (by its id in the viewed circuit) as seen from `path`.
 * Returns null when the view is detached or the wire is not in the netlist.
 */
export function valueOfWireAt(
  sim: Simulator,
  path: string[] | null,
  wireId: string,
): SimValue | null {
  if (path === null) return null;
  return sim.valueOfWireId(flatId(path, wireId));
}

/**
 * Resolve the view path against the circuit hierarchy. Returns the validated
 * path when every instance exists and the path really leads to the viewed
 * circuit, and null when the view is detached or dangling.
 */
export function resolveViewPath(ctx: SimViewContext): string[] | null {
  if (ctx.rootId === null || ctx.path === null) return null;
  if (ctx.path.length === 0) return ctx.rootId === ctx.circuitId ? [] : null;
  let cur = ctx.rootId;
  for (const instId of ctx.path) {
    const doc = ctx.circuits[cur];
    const comp = doc?.comps.find((c) => c.id === instId);
    if (!comp || comp.kind !== 'sub' || !comp.attrs.circuit) return null;
    cur = comp.attrs.circuit;
  }
  return cur === ctx.circuitId ? ctx.path : null;
}

export interface SimView {
  /** The view is connected to the simulation root and values are meaningful. */
  readonly attached: boolean;
  /** Runtime Input/Button writes are allowed (only in the root circuit view). */
  readonly canWrite: boolean;
  /** Validated instance path; empty array at the root. */
  readonly path: string[];
  valueOfPortAt(compId: string, port: string): SimValue | null;
  valueOfWireAt(wireId: string): SimValue | null;
  /** True when the wire's net has a width conflict. */
  widthIssueAt(wireId: string): boolean;
  /** Net id of a mapped port, or -1 when detached / unconnected. */
  netOfPortAt(compId: string, port: string): number;
  /** Net id of a mapped wire, or -1 when detached / not in the netlist. */
  netOfWireAt(wireId: string): number;
  /**
   * Pin value as displayed: user-set value in the root view, value driven
   * into the instance otherwise. Null when detached.
   */
  pinValueAt(compId: string): number | null;
  isHeldAt(compId: string): boolean;
  memoryValuesAt(comp: ComponentInstance): number[] | null;
  loadMemoryAt(comp: ComponentInstance, values: number[]): boolean;
}

export function createSimView(sim: Simulator, ctx: SimViewContext): SimView {
  const path = resolveViewPath(ctx);
  const attached = path !== null;
  const canWrite = attached && path.length === 0;
  let issueCache: { nl: Netlist; nets: Set<number> } | null = null;
  const issueNets = () => {
    const nl = sim.netlistOrNull();
    if (!nl) return null;
    if (!issueCache || issueCache.nl !== nl) {
      issueCache = { nl, nets: new Set(nl.issues.map((i) => i.net)) };
    }
    return issueCache.nets;
  };
  const map = (id: string) => (attached ? flatId(path, id) : null);
  return {
    attached,
    canWrite,
    path: path ?? [],
    valueOfPortAt: (compId, port) => {
      const flat = map(compId);
      return flat === null ? null : sim.valueOfPort(flat, port);
    },
    valueOfWireAt: (wireId) => {
      const flat = map(wireId);
      return flat === null ? null : sim.valueOfWireId(flat);
    },
    widthIssueAt: (wireId) => {
      const flat = map(wireId);
      if (flat === null) return false;
      const nl = sim.netlistOrNull();
      const n = nl?.wireIdNet.get(flat);
      return n !== undefined && (issueNets()?.has(n) ?? false);
    },
    netOfPortAt: (compId, port) => {
      const flat = map(compId);
      return flat === null ? -1 : sim.netOfPort(flat, port);
    },
    netOfWireAt: (wireId) => {
      const flat = map(wireId);
      if (flat === null) return -1;
      return sim.netlistOrNull()?.wireIdNet.get(flat) ?? -1;
    },
    pinValueAt: (compId) => {
      const flat = map(compId);
      if (flat === null) return null;
      // In the root view pins carry the user-set value; inside an instance
      // the pin is a pass-through interface, so show the driven net value.
      return canWrite ? sim.pinValue(flat) : sim.valueOfPort(flat, 'out').value;
    },
    isHeldAt: (compId) => {
      const flat = map(compId);
      return flat !== null && sim.isHeld(flat);
    },
    memoryValuesAt: (comp) => {
      const flat = map(comp.id);
      return flat === null ? null : sim.memoryValues({ ...comp, id: flat });
    },
    loadMemoryAt: (comp, values) => {
      const flat = map(comp.id);
      if (flat === null) return false;
      sim.loadMemory({ ...comp, id: flat }, values);
      return true;
    },
  };
}

/**
 * Human-readable breadcrumb of an instance path: one entry per ancestor,
 * each with the circuit it leads to and a display label. Returns null when
 * the path does not resolve.
 */
export function describePath(
  ctx: Pick<SimViewContext, 'circuits' | 'rootId' | 'path'>,
): { circuitId: string; label: string }[] | null {
  if (ctx.rootId === null || ctx.path === null) return null;
  if (!ctx.circuits[ctx.rootId]) return null;
  const out: { circuitId: string; label: string }[] = [];
  let cur = ctx.rootId;
  for (const instId of ctx.path) {
    const doc = ctx.circuits[cur];
    const comp = doc?.comps.find((c) => c.id === instId);
    if (!comp || comp.kind !== 'sub' || !comp.attrs.circuit) return null;
    const target = ctx.circuits[comp.attrs.circuit];
    out.push({
      circuitId: comp.attrs.circuit,
      label: comp.attrs.label || comp.attrs.circuitName || target?.name || instId,
    });
    cur = comp.attrs.circuit;
  }
  return out;
}
