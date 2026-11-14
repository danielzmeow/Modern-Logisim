import {
  type ComponentInstance,
  type Point,
  type CompKind,
  type Facing,
  isGate,
  snap,
  snapPoint,
  toWorld,
  worldToLocal,
} from './types';

export interface PortGeom {
  name: string;
  local: Point;
  dir: 'in' | 'out' | 'inout';
  bits: number;
  label?: string;
}

export interface Geom {
  x: number;
  y: number;
  w: number;
  h: number;
  ports: PortGeom[];
}

export function countCJK(s: string): number {
  let n = 0;
  for (const ch of s) if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) n++;
  return n;
}

export function estimateTextWidth(s: string, size = 11): number {
  const cjk = countCJK(s);
  return cjk * size + (s.length - cjk) * size * 0.6;
}

export function pinWidth(bits: number): number {
  const chars = Math.max(1, Math.ceil(bits / 4));
  return chars <= 2 ? 20 : 10 + 10 * chars;
}

export const GATE_MAX_INPUTS = 5;

/** Mirrors Logisim's input pin offsets, so files round-trip nicely. */
function gateInputOffsets(inputs: number, size: number): number[] {
  let skipStart: number;
  let skipDist: number;
  let skipLowerEven = 10;
  if (inputs <= 3) {
    if (size < 40) {
      skipStart = -5;
      skipDist = 10;
      skipLowerEven = 10;
    } else if (size < 60 || inputs <= 2) {
      skipStart = -10;
      skipDist = 20;
      skipLowerEven = 20;
    } else {
      skipStart = -15;
      skipDist = 30;
      skipLowerEven = 30;
    }
  } else if (inputs === 4 && size >= 60) {
    skipStart = -5;
    skipDist = 20;
    skipLowerEven = 0;
  } else {
    skipStart = -5;
    skipDist = 10;
    skipLowerEven = 10;
  }
  const out: number[] = [];
  for (let index = 0; index < inputs; index++) {
    let dy: number;
    if (inputs % 2 === 1) {
      dy = skipStart * (inputs - 1) + skipDist * index;
    } else {
      dy = skipStart * inputs + skipDist * index;
      if (index >= inputs / 2) dy += skipLowerEven;
    }
    out.push(dy);
  }
  return out;
}

export function gateSize(comp: ComponentInstance): number {
  const s = comp.attrs.size ?? 50;
  return s === 30 || s === 50 || s === 70 ? s : 50;
}

export function hasOutputBubble(kind: CompKind): boolean {
  return kind === 'nand' || kind === 'nor' || kind === 'xnor';
}

export function geom(comp: ComponentInstance): Geom {
  const k = comp.kind;
  const bits = Math.max(1, Math.min(32, comp.attrs.bits ?? 1));

  if (isGate(k)) {
    const gateBits = Math.max(1, Math.min(32, comp.attrs.bits ?? 1));
    if (k === 'not' || k === 'buffer') {
      return {
        x: -30,
        y: -10,
        w: 30,
        h: 20,
        ports: [
          { name: 'in', local: { x: -30, y: 0 }, dir: 'in', bits: gateBits },
          { name: 'out', local: { x: 0, y: 0 }, dir: 'out', bits: gateBits },
        ],
      };
    }
    const n = Math.max(2, Math.min(GATE_MAX_INPUTS, comp.attrs.inputs ?? 2));
    const size = gateSize(comp);
    const w = size + (hasOutputBubble(k) ? 10 : 0);
    const h = Math.max(10 * n, size);
    const ys = gateInputOffsets(n, size);
    const outputBits = k === 'odd' || k === 'even' ? 1 : gateBits;
    const ports: PortGeom[] = ys.map((y, i) => ({
      name: `in${i}`,
      local: { x: -w, y },
      dir: 'in' as const,
      bits: gateBits,
    }));
    ports.push({ name: 'out', local: { x: 0, y: 0 }, dir: 'out', bits: outputBits });
    return { x: -w, y: -h / 2, w, h, ports };
  }

  switch (k) {
    case 'input':
    case 'output': {
      const w = pinWidth(bits);
      return {
        x: -w,
        y: -10,
        w,
        h: 20,
        ports: [
          {
            name: k === 'input' ? 'out' : 'in',
            local: { x: 0, y: 0 },
            dir: k === 'input' ? 'out' : 'in',
            bits,
          },
        ],
      };
    }
    case 'constant': {
      const w = pinWidth(bits);
      return {
        x: -w,
        y: -10,
        w,
        h: 20,
        ports: [{ name: 'out', local: { x: 0, y: 0 }, dir: 'out', bits }],
      };
    }
    case 'button':
    case 'clock': {
      return {
        x: -20,
        y: -10,
        w: 20,
        h: 20,
        ports: [{ name: 'out', local: { x: 0, y: 0 }, dir: 'out', bits: 1 }],
      };
    }
    case 'led': {
      return {
        x: 0,
        y: -10,
        w: 20,
        h: 20,
        ports: [{ name: 'in', local: { x: 0, y: 0 }, dir: 'in', bits: 1 }],
      };
    }
    case 'probe': {
      const w = pinWidth(bits);
      return {
        x: 0,
        y: -10,
        w,
        h: 20,
        ports: [{ name: 'in', local: { x: 0, y: 0 }, dir: 'in', bits }],
      };
    }
    case 'power':
    case 'ground': {
      return {
        x: 0,
        y: -20,
        w: 20,
        h: 20,
        ports: [{ name: 'out', local: { x: 0, y: 0 }, dir: 'out', bits: 1 }],
      };
    }
    case 'pull': {
      return {
        x: 0,
        y: -12,
        w: 26,
        h: 24,
        ports: [{ name: 'net', local: { x: 0, y: 0 }, dir: 'inout', bits: 1 }],
      };
    }
    case 'extend': {
      const inBits = Math.max(1, Math.min(32, comp.attrs.inBits ?? 4));
      const outBits = Math.max(1, Math.min(32, comp.attrs.outBits ?? 8));
      return {
        x: -30,
        y: -10,
        w: 30,
        h: 20,
        ports: [
          { name: 'in', local: { x: -30, y: 0 }, dir: 'in', bits: inBits },
          { name: 'out', local: { x: 0, y: 0 }, dir: 'out', bits: outBits },
        ],
      };
    }
    case 'ctrlBuffer':
    case 'ctrlInverter': {
      return {
        x: -40,
        y: -22,
        w: 40,
        h: 44,
        ports: [
          { name: 'in', local: { x: -40, y: -6 }, dir: 'in', bits },
          { name: 'enable', local: { x: -40, y: 12 }, dir: 'in', bits: 1, label: 'EN' },
          { name: 'out', local: { x: 0, y: 0 }, dir: 'out', bits },
        ],
      };
    }
    case 'dff': {
      return {
        x: -40,
        y: -10,
        w: 40,
        h: 40,
        ports: [
          { name: 'd', local: { x: -40, y: 0 }, dir: 'in', bits: 1, label: 'D' },
          { name: 'clk', local: { x: -40, y: 20 }, dir: 'in', bits: 1, label: '›' },
          { name: 'q', local: { x: 0, y: 0 }, dir: 'out', bits: 1, label: 'Q' },
          { name: 'qn', local: { x: 0, y: 20 }, dir: 'out', bits: 1, label: 'Q̄' },
        ],
      };
    }
    case 'register': {
      const bits = Math.max(1, Math.min(32, comp.attrs.bits ?? 8));
      const ports: PortGeom[] = [
        { name: 'd', local: { x: -50, y: 0 }, dir: 'in', bits, label: 'D' },
        { name: 'clk', local: { x: -40, y: 30 }, dir: 'in', bits: 1, label: '›' },
        { name: 'q', local: { x: 0, y: 0 }, dir: 'out', bits, label: 'Q' },
      ];
      if (comp.attrs.enable !== false) {
        ports.push({ name: 'enable', local: { x: -15, y: 30 }, dir: 'in', bits: 1, label: 'EN' });
      }
      if (comp.attrs.reset !== false) {
        ports.push({ name: 'reset', local: { x: 10, y: 30 }, dir: 'in', bits: 1, label: 'R' });
      }
      return { x: -50, y: -30, w: 50, h: 60, ports };
    }
    case 'counter': {
      const bits = Math.max(1, Math.min(32, comp.attrs.bits ?? 8));
      const ports: PortGeom[] = [
        { name: 'clk', local: { x: -50, y: -10 }, dir: 'in', bits: 1, label: '›' },
        { name: 'q', local: { x: 0, y: -10 }, dir: 'out', bits, label: 'Q' },
        { name: 'carry', local: { x: 0, y: 10 }, dir: 'out', bits: 1, label: 'C' },
      ];
      if (comp.attrs.reset !== false) {
        ports.push({ name: 'reset', local: { x: -50, y: 10 }, dir: 'in', bits: 1, label: 'R' });
      }
      if (comp.attrs.enable !== false) {
        ports.push({ name: 'enable', local: { x: -30, y: 20 }, dir: 'in', bits: 1, label: 'EN' });
      }
      return { x: -50, y: -20, w: 50, h: 40, ports };
    }
    case 'ram': {
      const addrBits = Math.max(1, Math.min(20, comp.attrs.addrBits ?? 4));
      const dataBits = Math.max(1, Math.min(32, comp.attrs.dataBits ?? 8));
      return {
        x: -70,
        y: -35,
        w: 70,
        h: 70,
        ports: [
          { name: 'addr', local: { x: -70, y: -12 }, dir: 'in', bits: addrBits, label: 'A' },
          { name: 'din', local: { x: -70, y: 12 }, dir: 'in', bits: dataBits, label: 'D' },
          { name: 'we', local: { x: -45, y: 35 }, dir: 'in', bits: 1, label: 'WE' },
          { name: 'clk', local: { x: -15, y: 35 }, dir: 'in', bits: 1, label: '›' },
          { name: 'dout', local: { x: 0, y: 0 }, dir: 'out', bits: dataBits, label: 'Q' },
        ],
      };
    }
    case 'rom': {
      const addrBits = Math.max(1, Math.min(20, comp.attrs.addrBits ?? 4));
      const dataBits = Math.max(1, Math.min(32, comp.attrs.dataBits ?? 8));
      return {
        x: -60,
        y: -20,
        w: 60,
        h: 40,
        ports: [
          { name: 'addr', local: { x: -60, y: 0 }, dir: 'in', bits: addrBits, label: 'A' },
          { name: 'dout', local: { x: 0, y: 0 }, dir: 'out', bits: dataBits, label: 'Q' },
        ],
      };
    }
    case 'mux': {
      const selBits = Math.max(1, Math.min(4, comp.attrs.fans ?? 1));
      const n = 1 << selBits;
      const w = n === 2 ? 30 : 40;
      const h = n === 2 ? 40 : n * 10 + 20;
      const ports: PortGeom[] = [];
      for (let i = 0; i < n; i++) {
        let y: number;
        if (n === 2) y = i === 0 ? -10 : 10;
        else {
          y = -((n / 2) * 10) + i * 10 + (i >= n / 2 ? 10 : 0);
        }
        ports.push({ name: `d${i}`, local: { x: -w, y }, dir: 'in', bits });
      }
      ports.push({ name: 'sel', local: { x: -20, y: h / 2 }, dir: 'in', bits: selBits, label: 'S' });
      ports.push({ name: 'out', local: { x: 0, y: 0 }, dir: 'out', bits });
      return { x: -w, y: -h / 2, w, h, ports };
    }
    case 'decoder': {
      const selBits = Math.max(1, Math.min(4, comp.attrs.fans ?? 1));
      const n = 1 << selBits;
      const h = Math.max(44, n * 10 + 24);
      const ports: PortGeom[] = [];
      for (let i = 0; i < n; i++) {
        ports.push({
          name: `out${i}`,
          local: { x: 0, y: -((n - 1) / 2) * 10 + i * 10 },
          dir: 'out',
          bits: 1,
          label: `${i}`,
        });
      }
      ports.push({ name: 'sel', local: { x: -20, y: h / 2 }, dir: 'in', bits: selBits, label: 'S' });
      if (comp.attrs.enable) {
        ports.push({ name: 'enable', local: { x: -20, y: -h / 2 }, dir: 'in', bits: 1, label: 'EN' });
      }
      return { x: -40, y: -h / 2, w: 40, h, ports };
    }
    case 'demux': {
      const selBits = Math.max(1, Math.min(4, comp.attrs.fans ?? 1));
      const n = 1 << selBits;
      const h = Math.max(44, n * 10 + 24);
      const ports: PortGeom[] = [
        { name: 'in', local: { x: -40, y: -12 }, dir: 'in', bits, label: 'D' },
      ];
      for (let i = 0; i < n; i++) {
        ports.push({
          name: `out${i}`,
          local: { x: 0, y: -((n - 1) / 2) * 10 + i * 10 },
          dir: 'out',
          bits,
          label: `${i}`,
        });
      }
      ports.push({ name: 'sel', local: { x: -20, y: h / 2 }, dir: 'in', bits: selBits, label: 'S' });
      return { x: -40, y: -h / 2, w: 40, h, ports };
    }
    case 'priority': {
      const selBits = Math.max(1, Math.min(4, comp.attrs.fans ?? 2));
      const n = 1 << selBits;
      const h = Math.max(44, n * 10 + 24);
      const ports: PortGeom[] = [];
      for (let i = 0; i < n; i++) {
        ports.push({
          name: `in${i}`,
          local: { x: -40, y: -((n - 1) / 2) * 10 + i * 10 },
          dir: 'in',
          bits: 1,
          label: `${i}`,
        });
      }
      ports.push({ name: 'out', local: { x: 0, y: -8 }, dir: 'out', bits: selBits, label: 'S' });
      ports.push({ name: 'group', local: { x: 0, y: 8 }, dir: 'out', bits: 1, label: 'G' });
      return { x: -40, y: -h / 2, w: 40, h, ports };
    }
    case 'bitSelect': {
      const selBits = Math.max(1, Math.min(5, comp.attrs.fans ?? 2));
      return {
        x: -40,
        y: -26,
        w: 40,
        h: 52,
        ports: [
          { name: 'in', local: { x: -40, y: -10 }, dir: 'in', bits },
          { name: 'sel', local: { x: -20, y: 26 }, dir: 'in', bits: selBits, label: 'S' },
          { name: 'out', local: { x: 0, y: 0 }, dir: 'out', bits: 1 },
        ],
      };
    }
    case 'adder':
    case 'subtractor': {
      return {
        x: -50,
        y: -30,
        w: 50,
        h: 60,
        ports: [
          { name: 'a', local: { x: -50, y: -12 }, dir: 'in', bits, label: 'A' },
          { name: 'b', local: { x: -50, y: 12 }, dir: 'in', bits, label: 'B' },
          { name: 'cin', local: { x: -20, y: 30 }, dir: 'in', bits: 1, label: k === 'adder' ? 'Cin' : 'Bin' },
          { name: 'out', local: { x: 0, y: -8 }, dir: 'out', bits, label: k === 'adder' ? 'S' : 'D' },
          { name: 'carry', local: { x: 0, y: 8 }, dir: 'out', bits: 1, label: k === 'adder' ? 'Cout' : 'Bout' },
        ],
      };
    }
    case 'multiplier': {
      const outBits = Math.min(32, bits * 2);
      return {
        x: -50,
        y: -22,
        w: 50,
        h: 44,
        ports: [
          { name: 'a', local: { x: -50, y: -9 }, dir: 'in', bits, label: 'A' },
          { name: 'b', local: { x: -50, y: 9 }, dir: 'in', bits, label: 'B' },
          { name: 'out', local: { x: 0, y: 0 }, dir: 'out', bits: outBits, label: 'P' },
        ],
      };
    }
    case 'comparator': {
      return {
        x: -50,
        y: -25,
        w: 50,
        h: 50,
        ports: [
          { name: 'a', local: { x: -50, y: -12 }, dir: 'in', bits, label: 'A' },
          { name: 'b', local: { x: -50, y: 12 }, dir: 'in', bits, label: 'B' },
          { name: 'gt', local: { x: 0, y: -10 }, dir: 'out', bits: 1, label: '>' },
          { name: 'eq', local: { x: 0, y: 0 }, dir: 'out', bits: 1, label: '=' },
          { name: 'lt', local: { x: 0, y: 10 }, dir: 'out', bits: 1, label: '<' },
        ],
      };
    }
    case 'shifter': {
      const selBits = Math.max(1, Math.min(5, Math.ceil(Math.log2(bits)) + 1));
      return {
        x: -50,
        y: -26,
        w: 50,
        h: 52,
        ports: [
          { name: 'in', local: { x: -50, y: -10 }, dir: 'in', bits, label: 'D' },
          { name: 'sel', local: { x: -20, y: 26 }, dir: 'in', bits: selBits, label: 'S' },
          { name: 'out', local: { x: 0, y: 0 }, dir: 'out', bits },
        ],
      };
    }
    case 'sevenseg': {
      return {
        x: 0,
        y: -30,
        w: 38,
        h: 60,
        ports: [{ name: 'in', local: { x: 0, y: 0 }, dir: 'in', bits: 4 }],
      };
    }
    case 'split': {
      const fans = Math.max(2, Math.min(12, comp.attrs.fans ?? 2));
      const w = 44;
      const h = Math.max(34, fans * 10 + 14);
      const ports: PortGeom[] = [];
      const fanBits = Math.max(1, Math.floor(bits / fans));
      ports.push({ name: 'bus', local: { x: -w / 2, y: 0 }, dir: 'in', bits, label: `${bits}` });
      for (let i = 0; i < fans; i++) {
        const y = -((fans - 1) / 2) * 10 + i * 10;
        ports.push({ name: `f${i}`, local: { x: w / 2, y }, dir: 'out', bits: fanBits });
      }
      return { x: -w / 2, y: -h / 2, w, h, ports };
    }
    case 'merge': {
      const fans = Math.max(2, Math.min(12, comp.attrs.fans ?? 2));
      const w = 44;
      const h = Math.max(34, fans * 10 + 14);
      const ports: PortGeom[] = [];
      const fanBits = Math.max(1, Math.floor(bits / fans));
      for (let i = 0; i < fans; i++) {
        const y = -((fans - 1) / 2) * 10 + i * 10;
        ports.push({ name: `f${i}`, local: { x: -w / 2, y }, dir: 'in', bits: fanBits });
      }
      ports.push({ name: 'bus', local: { x: w / 2, y: 0 }, dir: 'out', bits, label: `${bits}` });
      return { x: -w / 2, y: -h / 2, w, h, ports };
    }
    case 'tunnel': {
      const label = comp.attrs.label || '?';
      const w = Math.max(24, estimateTextWidth(label, 11) + 16);
      return {
        x: 0,
        y: -10,
        w,
        h: 20,
        ports: [{ name: 'net', local: { x: 0, y: 0 }, dir: 'inout', bits: 0 }],
      };
    }
    case 'sub': {
      const w = Math.max(40, comp.attrs.subW ?? 80);
      const h = Math.max(40, comp.attrs.subH ?? 60);
      const pins = comp.attrs.subPins ?? [];
      return {
        x: 0,
        y: 0,
        w,
        h,
        ports: pins.map((p) => ({
          name: p.id,
          local: { x: p.kind === 'input' ? 0 : w, y: p.y },
          dir: p.kind === 'input' ? 'in' : 'out',
          bits: p.bits,
          label: p.label,
        })),
      };
    }
    case 'text': {
      const text = comp.attrs.text ?? '';
      const lines = text.split('\n');
      const w = Math.max(24, ...lines.map((l) => estimateTextWidth(l, 12))) + 8;
      const h = Math.max(18, lines.length * 16 + 4);
      return {
        x: -w / 2,
        y: -h / 2,
        w,
        h,
        ports: [],
      };
    }
    default:
      return { x: -10, y: -10, w: 20, h: 20, ports: [] };
  }
}

export interface WorldPort extends PortGeom {
  world: Point;
}

export function portsOf(comp: ComponentInstance): WorldPort[] {
  return geom(comp).ports.map((p) => ({ ...p, world: toWorld(comp, p.local) }));
}

export function centerWorld(comp: ComponentInstance): Point {
  const g = geom(comp);
  return toWorld(comp, { x: g.x + g.w / 2, y: g.y + g.h / 2 });
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rotatedBounds(comp: ComponentInstance): Bounds {
  const g = geom(comp);
  const corners = [
    { x: g.x, y: g.y },
    { x: g.x + g.w, y: g.y },
    { x: g.x + g.w, y: g.y + g.h },
    { x: g.x, y: g.y + g.h },
  ].map((p) => toWorld(comp, p));
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function hitComponent(comp: ComponentInstance, p: Point, pad = 2): boolean {
  const local = worldToLocal(comp, p);
  const g = geom(comp);
  return (
    local.x >= g.x - pad &&
    local.x <= g.x + g.w + pad &&
    local.y >= g.y - pad &&
    local.y <= g.y + g.h + pad
  );
}

export function pointOnSegment(p: Point, a: Point, b: Point, eps = 0.5): boolean {
  if (Math.abs(a.x - b.x) < eps) {
    return Math.abs(p.x - a.x) < eps && p.y >= Math.min(a.y, b.y) - eps && p.y <= Math.max(a.y, b.y) + eps;
  }
  if (Math.abs(a.y - b.y) < eps) {
    return Math.abs(p.y - a.y) < eps && p.x >= Math.min(a.x, b.x) - eps && p.x <= Math.max(a.x, b.x) + eps;
  }
  return false;
}

/** A point strictly inside an axis-aligned segment (endpoints excluded). */
export function pointInsideSegment(p: Point, a: Point, b: Point, eps = 0.6): boolean {
  if (Math.abs(a.x - b.x) < eps) {
    if (Math.abs(p.x - a.x) > eps) return false;
    return p.y > Math.min(a.y, b.y) + eps && p.y < Math.max(a.y, b.y) - eps;
  }
  if (Math.abs(a.y - b.y) < eps) {
    if (Math.abs(p.y - a.y) > eps) return false;
    return p.x > Math.min(a.x, b.x) + eps && p.x < Math.max(a.x, b.x) - eps;
  }
  return false;
}

/** Overlap length of two collinear axis-aligned segments (0 when apart). */
export function collinearOverlap(a: Point, b: Point, c: Point, d: Point): number {
  const abV = Math.abs(a.x - b.x) < 0.01;
  const cdV = Math.abs(c.x - d.x) < 0.01;
  if (abV && cdV && Math.abs(a.x - c.x) < 0.01) {
    const lo = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
    const hi = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
    return Math.max(0, hi - lo);
  }
  if (!abV && !cdV && Math.abs(a.y - c.y) < 0.01) {
    const lo = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
    const hi = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
    return Math.max(0, hi - lo);
  }
  return 0;
}

export function wireHit(wire: { a: Point; b: Point }, p: Point, width = 5): boolean {
  const dx = wire.b.x - wire.a.x;
  const dy = wire.b.y - wire.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = ((p.x - wire.a.x) * dx + (p.y - wire.a.y) * dy) / (len * len);
  if (t < -0.02 || t > 1.02) return false;
  const x = wire.a.x + dx * Math.max(0, Math.min(1, t));
  const y = wire.a.y + dy * Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - x, p.y - y) <= width / 2;
}

export type Hit =
  | { type: 'port'; comp: ComponentInstance; port: WorldPort; distance: number }
  | { type: 'comp'; comp: ComponentInstance }
  | { type: 'wire'; wireId: string }
  | null;

export function hitTest(
  comps: ComponentInstance[],
  wires: { id: string; a: Point; b: Point }[],
  world: Point,
  portRadius: number,
  preferPorts = true,
): Hit {
  let bestPort: { comp: ComponentInstance; port: WorldPort; distance: number } | null = null;
  for (const comp of comps) {
    for (const port of portsOf(comp)) {
      const d = Math.hypot(port.world.x - world.x, port.world.y - world.y);
      if (d <= portRadius && (!bestPort || d < bestPort.distance)) {
        bestPort = { comp, port, distance: d };
      }
    }
  }
  if (bestPort && preferPorts) return { type: 'port', ...bestPort };

  for (let i = comps.length - 1; i >= 0; i--) {
    const comp = comps[i];
    if (comp.kind === 'text') {
      if (hitComponent(comp, world)) return { type: 'comp', comp };
    } else if (hitComponent(comp, world)) {
      return { type: 'comp', comp };
    }
  }
  for (let i = wires.length - 1; i >= 0; i--) {
    if (wireHit(wires[i], world)) return { type: 'wire', wireId: wires[i].id };
  }
  if (bestPort) return { type: 'port', ...bestPort };
  return null;
}

const DIR_ORDER: Facing[] = ['east', 'south', 'west', 'north'];

export function directionBetween(a: Point, b: Point): Facing {
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) return b.x >= a.x ? 'east' : 'west';
  return b.y >= a.y ? 'south' : 'north';
}

/** Snap a free wire point, or merge into a nearby port. */
export function snapWireEnd(
  world: Point,
  comps: ComponentInstance[],
  wires: { id: string; a: Point; b: Point }[],
  portRadius: number,
  ignoreWireId?: string,
): { point: Point; comp?: ComponentInstance; port?: PortGeom; wireId?: string } {
  let best: { point: Point; comp?: ComponentInstance; port?: PortGeom; wireId?: string; d: number } | null =
    null;
  for (const comp of comps) {
    for (const port of geom(comp).ports) {
      const wp = toWorld(comp, port.local);
      const d = Math.hypot(wp.x - world.x, wp.y - world.y);
      if (d <= portRadius && (!best || d < best.d)) {
        best = { point: wp, comp, port, d };
      }
    }
  }
  if (best) return { point: best.point, comp: best.comp, port: best.port, wireId: best.wireId };
  for (const w of wires) {
    if (w.id === ignoreWireId) continue;
    for (const p of [w.a, w.b]) {
      const d = Math.hypot(p.x - world.x, p.y - world.y);
      if (d <= portRadius && (!best || d < best.d)) {
        best = { point: p, wireId: w.id, d };
      }
    }
    // A wire ending on the interior of another wire creates a T-junction.
    const dx = w.b.x - w.a.x;
    const dy = w.b.y - w.a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.01) continue;
    const t = Math.max(0, Math.min(1, ((world.x - w.a.x) * dx + (world.y - w.a.y) * dy) / len2));
    const px = Math.round(w.a.x + dx * t);
    const py = Math.round(w.a.y + dy * t);
    // Only snap to interiors, not endpoints (those were handled above).
    const atEnd = (Math.abs(px - w.a.x) < 0.1 && Math.abs(py - w.a.y) < 0.1) ||
      (Math.abs(px - w.b.x) < 0.1 && Math.abs(py - w.b.y) < 0.1);
    if (atEnd) continue;
    const d = Math.hypot(px - world.x, py - world.y);
    if (d <= portRadius && (!best || d < best.d)) {
      best = { point: { x: px, y: py }, wireId: w.id, d };
    }
  }
  if (best) return { point: best.point, wireId: best.wireId };
  return { point: snapPoint(world) };
}

export interface RouteOptions {
  startFacing?: Facing;
  endFacing?: Facing;
  flip?: boolean;
  obstacles?: Bounds[];
  /** Existing wire segments; overlapping collinear runs score badly. */
  wires?: { a: Point; b: Point }[];
}

function segmentHitsRect(a: Point, b: Point, r: Bounds, pad = 3): boolean {
  const x0 = r.x + pad;
  const y0 = r.y + pad;
  const x1 = r.x + r.w - pad;
  const y1 = r.y + r.h - pad;
  if (x1 <= x0 || y1 <= y0) return false;
  if (Math.abs(a.x - b.x) < 0.01) {
    const x = a.x;
    if (x <= x0 || x >= x1) return false;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    return hi > y0 && lo < y1;
  }
  if (Math.abs(a.y - b.y) < 0.01) {
    const y = a.y;
    if (y <= y0 || y >= y1) return false;
    const lo = Math.min(a.x, b.x);
    const hi = Math.max(a.x, b.x);
    return hi > x0 && lo < x1;
  }
  return false;
}

function scoreRoute(
  points: Point[],
  startFacing?: Facing,
  endFacing?: Facing,
  obstacles?: Bounds[],
  wires?: { a: Point; b: Point }[],
): number {
  let score = (points.length - 2) * 8;
  for (let i = 1; i < points.length; i++) {
    score += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) * 0.01;
    if (obstacles?.length) {
      for (const r of obstacles) {
        if (segmentHitsRect(points[i - 1], points[i], r)) score += 1200;
      }
    }
    if (wires?.length) {
      for (const w of wires) {
        if (collinearOverlap(points[i - 1], points[i], w.a, w.b) > 1.5) score += 900;
      }
    }
  }
  if (points.length >= 2) {
    const d0 = directionBetween(points[0], points[1]);
    if (startFacing && d0 !== startFacing) score += 400;
    const d1 = directionBetween(points[points.length - 2], points[points.length - 1]);
    const opposite: Record<Facing, Facing> = {
      east: 'west',
      west: 'east',
      north: 'south',
      south: 'north',
    };
    if (endFacing && d1 !== opposite[endFacing]) score += 400;
  }
  return score;
}

/** Build a tidy orthogonal route between two points. */
export function routeWire(a: Point, b: Point, opts: RouteOptions = {}): Point[] {
  const candidates: Point[][] = [];
  const add = (pts: Point[]) => {
    const cleaned: Point[] = [];
    for (const p of pts) {
      if (!cleaned.length || Math.abs(cleaned[cleaned.length - 1].x - p.x) > 0.01 || Math.abs(cleaned[cleaned.length - 1].y - p.y) > 0.01) {
        cleaned.push(p);
      }
    }
    for (let i = 2; i < cleaned.length; i++) {
      const p0 = cleaned[i - 2];
      const p1 = cleaned[i - 1];
      const p2 = cleaned[i];
      if ((p0.x === p1.x && p1.x === p2.x) || (p0.y === p1.y && p1.y === p2.y)) {
        cleaned.splice(i - 1, 1);
        i--;
      }
    }
    if (cleaned.length >= 2) candidates.push(cleaned);
  };

  if (Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01) {
    add([a, b]);
  } else {
    add([a, { x: b.x, y: a.y }, b]);
    add([a, { x: a.x, y: b.y }, b]);
    const mx = snap((a.x + b.x) / 2);
    const my = snap((a.y + b.y) / 2);
    if (Math.abs(mx - a.x) > 5 && Math.abs(mx - b.x) > 5) {
      add([a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]);
    }
    if (Math.abs(my - a.y) > 5 && Math.abs(my - b.y) > 5) {
      add([a, { x: a.x, y: my }, { x: b.x, y: my }, b]);
    }
    add([a, { x: a.x + (b.x > a.x ? 10 : -10), y: a.y }, { x: a.x + (b.x > a.x ? 10 : -10), y: b.y }, b]);
    add([a, { x: a.x, y: a.y + (b.y > a.y ? 10 : -10) }, { x: b.x, y: a.y + (b.y > a.y ? 10 : -10) }, b]);
  }

  if (!candidates.length) return [a, b];
  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    let score = scoreRoute(c, opts.startFacing, opts.endFacing, opts.obstacles, opts.wires);
    if (opts.flip) {
      // Nudge the router toward the alternative first bend when the user asks for it.
      if (c.length === 3) {
        const firstDir = directionBetween(c[0], c[1]);
        if (opts.startFacing && firstDir !== opts.startFacing) score -= 60;
      }
    }
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Make sure ports and wire endpoints land on whole units. */
export function normalizePoint(p: Point): Point {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

export function visibleCenterOfBounds(b: Bounds): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function snappedWorld(p: Point): Point {
  return snapPoint(p);
}

export { DIR_ORDER };

/** The outward direction of a port on its component (world space). */
export function portOutward(comp: ComponentInstance, port: PortGeom): Facing {
  const g = geom(comp);
  let side: Facing = 'east';
  const eps = 0.6;
  if (Math.abs(port.local.x - g.x) < eps) side = 'west';
  else if (Math.abs(port.local.x - (g.x + g.w)) < eps) side = 'east';
  else if (Math.abs(port.local.y - g.y) < eps) side = 'north';
  else if (Math.abs(port.local.y - (g.y + g.h)) < eps) side = 'south';
  else {
    // Interior ports (e.g. a mux select pin) point toward their nearest edge.
    const dl = port.local.x - g.x;
    const dr = g.x + g.w - port.local.x;
    const dt = port.local.y - g.y;
    const db = g.y + g.h - port.local.y;
    const m = Math.min(dl, dr, dt, db);
    if (m === dl) side = 'west';
    else if (m === dr) side = 'east';
    else if (m === dt) side = 'north';
    else side = 'south';
  }
  const step = comp.facing === 'east' ? 0 : comp.facing === 'south' ? 1 : comp.facing === 'west' ? 2 : 3;
  const order: Facing[] = ['east', 'south', 'west', 'north'];
  return order[(order.indexOf(side) + step) % 4];
}

/** World-space endpoints of all component ports, for hit testing and wiring. */
export function allPorts(comps: ComponentInstance[]): { comp: ComponentInstance; port: WorldPort; outward: Facing }[] {
  const out: { comp: ComponentInstance; port: WorldPort; outward: Facing }[] = [];
  for (const comp of comps) {
    for (const p of geom(comp).ports) {
      out.push({ comp, port: { ...p, world: toWorld(comp, p.local) }, outward: portOutward(comp, p) });
    }
  }
  return out;
}

/** Bounding box of everything in the document (used by Fit to screen). */
export function contentBounds(doc: { comps: ComponentInstance[]; wires: { a: Point; b: Point }[] }): Bounds | null {
  if (!doc.comps.length && !doc.wires.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of doc.comps) {
    const b = rotatedBounds(c);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  for (const w of doc.wires) {
    minX = Math.min(minX, w.a.x, w.b.x);
    minY = Math.min(minY, w.a.y, w.b.y);
    maxX = Math.max(maxX, w.a.x, w.b.x);
    maxY = Math.max(maxY, w.a.y, w.b.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
