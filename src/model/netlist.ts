import type { Doc, Point } from './types';
import { pointKey, samePoint } from './types';
import { pointOnSegment, portsOf } from './geometry';

export interface Net {
  id: number;
  width: number;
  ports: { compId: string; port: string; bits: number }[];
  wires: number[];
}

export interface Netlist {
  nets: Net[];
  portNet: Map<string, number>;
  wireNet: number[];
  pointNet: Map<string, number>;
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

  // A node (wire endpoint or component port) touching the interior of a wire joins that net.
  for (let ni = 0; ni < points.length; ni++) {
    const p = points[ni];
    for (let wi = 0; wi < wires.length; wi++) {
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
  for (let i = 0; i < wires.length; i++) {
    const root = dsu.find(wireIdx[i].a);
    const netId = netForRoot(root);
    wireNet.push(netId);
    nets[netId].wires.push(i);
  }

  const pointNet = new Map<string, number>();
  for (const [key, node] of nodes) pointNet.set(key, netForRoot(dsu.find(node)));

  return { nets, portNet, wireNet, pointNet };
}

