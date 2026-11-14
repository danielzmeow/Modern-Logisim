import type { Doc, Point, WireSeg } from './types';
import { pointKey } from './types';
import { collinearOverlap, pointInsideSegment, portsOf } from './geometry';
import { buildNetlist } from './netlist';

/** Clone a wire so callers never share mutable points with the source doc. */
function cloneWire(w: WireSeg): WireSeg {
  return { id: w.id, a: { ...w.a }, b: { ...w.b } };
}

type Seg = { a: Point; b: Point };

function segmentsOf(pts: Point[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a.x === b.x && a.y === b.y) continue;
    out.push({ a, b });
  }
  return out;
}

/** How much each bend position is tried before settling for a worse route. */
const BEND_STEPS = [0.5, 0.25, 0.75, 0.1, 0.9];

/**
 * Orthogonal candidates between two points. A straight run has one candidate;
 * a diagonal run is bridged by a three-segment “Z”, trying a few bend spots so
 * the route can dodge other wires.
 */
function candidatePaths(a: Point, b: Point, horizontalFirst: boolean): Point[][] {
  if (a.x === b.x || a.y === b.y) return [[a, b]];
  const paths: Point[][] = [];
  for (const t of BEND_STEPS) {
    if (horizontalFirst) {
      const x = Math.round(a.x + (b.x - a.x) * t);
      paths.push([a, { x, y: a.y }, { x, y: b.y }, b]);
    } else {
      const y = Math.round(a.y + (b.y - a.y) * t);
      paths.push([a, { x: a.x, y }, { x: b.x, y }, b]);
    }
  }
  return paths;
}

interface Obstacle {
  a: Point;
  b: Point;
  net: number;
}

/**
 * Rebuild the wire list after moving `movedIds` by (dx, dy).
 *
 * Wire ends that sat on a moved component's port follow it, so the component
 * stays connected while it is dragged. Segments that would turn diagonal are
 * bridged with an orthogonal detour, preferring bends that avoid other nets.
 */
export function followMovedWires(
  origin: Doc,
  movedIds: Iterable<string>,
  dx: number,
  dy: number,
): WireSeg[] {
  const moved = new Set(movedIds);
  if (!moved.size || (dx === 0 && dy === 0)) return origin.wires.map(cloneWire);

  const movedPorts = new Set<string>();
  for (const comp of origin.comps) {
    if (!moved.has(comp.id)) continue;
    for (const port of portsOf(comp)) movedPorts.add(pointKey(port.world));
  }
  if (!movedPorts.size) return origin.wires.map(cloneWire);

  const follows = origin.wires.map(
    (w) => movedPorts.has(pointKey(w.a)) || movedPorts.has(pointKey(w.b)),
  );
  const shifted = origin.wires.map((w, i) => {
    if (!follows[i]) return cloneWire(w);
    const a = movedPorts.has(pointKey(w.a)) ? { x: w.a.x + dx, y: w.a.y + dy } : { ...w.a };
    const b = movedPorts.has(pointKey(w.b)) ? { x: w.b.x + dx, y: w.b.y + dy } : { ...w.b };
    return { id: w.id, a, b };
  });

  // Straight moves never need routing: keep them exact and cheap.
  const needsBend = shifted.some((w, i) => follows[i] && w.a.x !== w.b.x && w.a.y !== w.b.y);
  if (!needsBend) {
    return shifted.filter((w) => w.a.x !== w.b.x || w.a.y !== w.b.y);
  }

  const { wireNet, pointNet } = buildNetlist(origin);
  const netOf = (p: Point, fallback: number) => pointNet.get(pointKey(p)) ?? fallback;

  // Geometry that already exists and must not be touched by a different net.
  const fixedSegs: Obstacle[] = [];
  const fixedPoints: { p: Point; net: number }[] = [];
  const seenPoint = new Set<string>();
  const addFixedPoint = (p: Point, net: number) => {
    const key = pointKey(p);
    if (seenPoint.has(key)) return;
    seenPoint.add(key);
    fixedPoints.push({ p, net });
  };
  for (let i = 0; i < origin.wires.length; i++) {
    if (follows[i]) continue;
    const w = origin.wires[i];
    const net = wireNet[i] ?? -1;
    fixedSegs.push({ a: w.a, b: w.b, net });
    addFixedPoint(w.a, net);
    addFixedPoint(w.b, net);
  }
  // Ends that stay put on affected wires are junctions worth avoiding too.
  for (let i = 0; i < origin.wires.length; i++) {
    if (!follows[i]) continue;
    const w = origin.wires[i];
    const net = wireNet[i] ?? -1;
    if (!movedPorts.has(pointKey(w.a))) addFixedPoint(w.a, net);
    if (!movedPorts.has(pointKey(w.b))) addFixedPoint(w.b, net);
  }

  const placed: Obstacle[] = [];
  const placedPoints: { p: Point; net: number }[] = [];

  const scorePath = (pts: Point[], net: number): number => {
    let score = 0;
    for (const { a: p, b: q } of segmentsOf(pts)) {
      for (const s of fixedSegs) {
        if (s.net !== net && collinearOverlap(p, q, s.a, s.b) > 1) score += 40;
      }
      for (const s of placed) {
        if (s.net !== net && collinearOverlap(p, q, s.a, s.b) > 1) score += 40;
      }
      for (const { p: pt, net: n } of fixedPoints) {
        if (n !== net && pointInsideSegment(pt, p, q)) score += 40;
      }
      for (const { p: pt, net: n } of placedPoints) {
        if (n !== net && pointInsideSegment(pt, p, q)) score += 40;
      }
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const key = pointKey(pts[i]);
      for (const { p: pt, net: n } of fixedPoints) {
        if (n !== net && pointKey(pt) === key) score += 40;
      }
      for (const { p: pt, net: n } of placedPoints) {
        if (n !== net && pointKey(pt) === key) score += 40;
      }
    }
    return score;
  };

  const out: WireSeg[] = [];
  for (let i = 0; i < origin.wires.length; i++) {
    const wire = origin.wires[i];
    if (!follows[i]) {
      out.push(cloneWire(wire));
      continue;
    }
    const net = wireNet[i] ?? -1;
    const a = shifted[i].a;
    const b = shifted[i].b;
    if (a.x === b.x && a.y === b.y) continue;

    const horizontalFirst = Math.abs(wire.a.y - wire.b.y) < 0.01;
    let best: Point[] = [a, b];
    let bestScore = Infinity;
    for (const horizontal of horizontalFirst ? [true, false] : [false, true]) {
      for (const pts of candidatePaths(a, b, horizontal)) {
        const score = scorePath(pts, net) + (horizontal === horizontalFirst ? 0 : 4);
        if (score < bestScore) {
          bestScore = score;
          best = pts;
        }
      }
    }

    const segments = segmentsOf(best);
    segments.forEach(({ a: p, b: q }, j) => {
      out.push({
        // Keep the original id on the first piece so selection survives a drag.
        id: j === 0 ? wire.id : `${wire.id}~${j}`,
        a: { ...p },
        b: { ...q },
      });
      placed.push({ a: p, b: q, net });
    });
    for (const p of best) placedPoints.push({ p, net: netOf(p, net) });
  }
  return out;
}
