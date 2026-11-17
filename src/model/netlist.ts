import type { Doc, Point } from './types';
import { pointKey, samePoint } from './types';
import { pointOnSegment, portsOf } from './geometry';

export interface Net {
  id: number;
  width: number;
  ports: { compId: string; port: string; bits: number }[];
  wires: number[];
}

export interface NetIssue {
  net: number;
  width: number;
  ports: { compId: string; port: string; bits: number }[];
}

export interface Netlist {
  nets: Net[];
  portNet: Map<string, number>;
  wireNet: number[];
  /** Flattened wire id -> net; instance wires are prefixed by their instance path. */
  wireIdNet: Map<string, number>;
  pointNet: Map<string, number>;
  issues: NetIssue[];
  /** Stub nets created for width-incompatible ports; the simulator pins them to E. */
  forcedError: Set<number>;
}

class DSU {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(a: number): number {
    while (this.parent[a] !== a) {
      this.parent[a] = this.parent[this.parent[a]];
      a = this.parent[a];
    }
    return a;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

export function buildNetlist(doc: Doc): Netlist {
  const nodes = new Map<string, number>();
  const points: Point[] = [];
  const getNode = (p: Point) => {
    const k = pointKey(p);
    let i = nodes.get(k);
    if (i === undefined) {
      i = points.length;
      nodes.set(k, i);
      points.push({ x: Math.round(p.x), y: Math.round(p.y) });
    }
    return i;
  };

  const comps = doc.comps;
  const compPorts = new Map<string, { name: string; point: Point; bits: number }[]>();
  for (const comp of comps) {
    const list: { name: string; point: Point; bits: number }[] = [];
    for (const port of portsOf(comp)) {
      list.push({ name: port.name, point: port.world, bits: port.bits });
    }
    compPorts.set(comp.id, list);
    for (const p of list) getNode(p.point);
  }

  const wires = doc.wires;
  const wireIdx: { a: number; b: number }[] = [];
  for (const w of wires) {
    const a = getNode(w.a);
    const b = getNode(w.b);
    wireIdx.push({ a, b });
  }

  const dsu = new DSU(points.length);

  for (const w of wireIdx) {
    if (w.a !== w.b) dsu.union(w.a, w.b);
  }

  // Bucket wire segments into a coarse grid so a port only tests the few
  // segments that could contain it. The old implementation was O(points × wires)
  // and became the dominant cost while dragging large circuits.
  const CELL = 50;
  const cellKey = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  const buckets = new Map<string, number[]>();
  const addToBucket = (x: number, y: number, wireIndex: number) => {
    const key = cellKey(x, y);
    const list = buckets.get(key);
    if (list) {
      if (list[list.length - 1] !== wireIndex) list.push(wireIndex);
    } else {
      buckets.set(key, [wireIndex]);
    }
  };
  for (let wi = 0; wi < wires.length; wi++) {
    const w = wires[wi];
    if (w.a.x === w.b.x && w.a.y === w.b.y) continue;
    if (Math.abs(w.a.x - w.b.x) < 0.01) {
      const x = w.a.x;
      const y0 = Math.min(w.a.y, w.b.y);
      const y1 = Math.max(w.a.y, w.b.y);
      const c0 = Math.floor(y0 / CELL);
      const c1 = Math.floor(y1 / CELL);
      for (let cy = c0; cy <= c1; cy++) addToBucket(x, cy * CELL, wi);
    } else if (Math.abs(w.a.y - w.b.y) < 0.01) {
      const y = w.a.y;
      const x0 = Math.min(w.a.x, w.b.x);
      const x1 = Math.max(w.a.x, w.b.x);
      const c0 = Math.floor(x0 / CELL);
      const c1 = Math.floor(x1 / CELL);
      for (let cx = c0; cx <= c1; cx++) addToBucket(cx * CELL, y, wi);
    }
    // Diagonal segments never participate in pointOnSegment; their endpoints
    // already joined the DSU above, matching the previous behavior.
  }

  // A node (wire endpoint or component port) touching the interior of a wire joins that net.
  for (let ni = 0; ni < points.length; ni++) {
    const p = points[ni];
    for (const wi of buckets.get(cellKey(p.x, p.y)) ?? []) {
      const w = wires[wi];
      if (samePoint(p, w.a) || samePoint(p, w.b)) continue;
      if (pointOnSegment(p, w.a, w.b, 0.6)) {
        dsu.union(ni, wireIdx[wi].a);
      }
    }
  }

  // Tunnels with the same label are electrically the same net.
  const tunnels = new Map<string, number[]>();
  for (const comp of comps) {
    if (comp.kind !== 'tunnel') continue;
    const label = (comp.attrs.label ?? '').trim();
    if (!label) continue;
    const port = compPorts.get(comp.id)?.[0];
    if (!port) continue;
    const node = getNode(port.point);
    const list = tunnels.get(label) ?? [];
    list.push(node);
    tunnels.set(label, list);
  }
  for (const list of tunnels.values()) {
    for (let i = 1; i < list.length; i++) dsu.union(list[0], list[i]);
  }

  const rootToNet = new Map<number, number>();
  const nets: Net[] = [];
  const netForRoot = (root: number) => {
    let n = rootToNet.get(root);
    if (n === undefined) {
      n = nets.length;
      rootToNet.set(root, n);
      nets.push({ id: n, width: 1, ports: [], wires: [] });
    }
    return n;
  };

  const portNet = new Map<string, number>();
  for (const comp of comps) {
    for (const p of compPorts.get(comp.id) ?? []) {
      const root = dsu.find(getNode(p.point));
      const netId = netForRoot(root);
      portNet.set(`${comp.id}:${p.name}`, netId);
      nets[netId].ports.push({ compId: comp.id, port: p.name, bits: p.bits });
      if (p.bits > 0) nets[netId].width = Math.max(nets[netId].width, p.bits);
    }
  }

  const wireNet: number[] = [];
  const wireIdNet = new Map<string, number>();
  for (let i = 0; i < wires.length; i++) {
    const root = dsu.find(wireIdx[i].a);
    const netId = netForRoot(root);
    wireNet.push(netId);
    wireIdNet.set(wires[i].id, netId);
    nets[netId].wires.push(i);
  }

  const pointNet = new Map<string, number>();
  for (const [key, node] of nodes) pointNet.set(key, netForRoot(dsu.find(node)));

  const issues: NetIssue[] = [];
  for (const net of nets) {
    const widths = new Set(net.ports.filter((p) => p.bits > 0).map((p) => p.bits));
    if (widths.size > 1) {
      issues.push({
        net: net.id,
        width: net.width,
        ports: net.ports.filter((p) => p.bits > 0).map((p) => ({ ...p })),
      });
    }
  }

  // Detach every port whose nonzero width disagrees with the net maximum into
  // its own stub net pinned to E. The port can neither drive nor read the
  // original net, while matching-width ports on it keep communicating.
  // Width-0 (adaptive) ports stay attached.
  const forcedError = new Set<number>();
  for (const issue of issues) {
    const net = nets[issue.net];
    for (const p of issue.ports) {
      if (p.bits === net.width) continue;
      const stub: Net = { id: nets.length, width: p.bits, ports: [{ ...p }], wires: [] };
      nets.push(stub);
      forcedError.add(stub.id);
      net.ports = net.ports.filter((x) => x.compId !== p.compId || x.port !== p.port);
      portNet.set(`${p.compId}:${p.port}`, stub.id);
      const pt = compPorts.get(p.compId)?.find((x) => x.name === p.port)?.point;
      if (pt) pointNet.set(pointKey(pt), stub.id);
    }
  }

  return { nets, portNet, wireNet, wireIdNet, pointNet, issues, forcedError };
}

