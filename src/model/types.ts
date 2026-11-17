export type Point = { x: number; y: number };
export type Facing = 'east' | 'south' | 'west' | 'north';

export type CompKind =
  | 'input'
  | 'output'
  | 'led'
  | 'button'
  | 'clock'
  | 'constant'
  | 'not'
  | 'and'
  | 'or'
  | 'nand'
  | 'nor'
  | 'xor'
  | 'xnor'
  | 'buffer'
  | 'odd'
  | 'even'
  | 'ctrlBuffer'
  | 'ctrlInverter'
  | 'split'
  | 'merge'
  | 'probe'
  | 'power'
  | 'ground'
  | 'pull'
  | 'extend'
  | 'dff'
  | 'tff'
  | 'jkff'
  | 'sr'
  | 'shift'
  | 'random'
  | 'register'
  | 'counter'
  | 'ram'
  | 'rom'
  | 'mux'
  | 'decoder'
  | 'demux'
  | 'priority'
  | 'bitSelect'
  | 'adder'
  | 'subtractor'
  | 'multiplier'
  | 'divider'
  | 'negator'
  | 'bitAdder'
  | 'bitFinder'
  | 'comparator'
  | 'shifter'
  | 'sevenseg'
  | 'hexdigit'
  | 'tunnel'
  | 'sub'
  | 'text';

export type GateKind =
  | 'not'
  | 'and'
  | 'or'
  | 'nand'
  | 'nor'
  | 'xor'
  | 'xnor'
  | 'buffer'
  | 'odd'
  | 'even';

export interface SubPinLayout {
  /** Component id of the pin inside the target circuit. */
  id: string;
  label: string;
  kind: 'input' | 'output';
  bits: number;
  /** Port y position in symbol-local coordinates. */
  y: number;
}

export interface CompAttrs {
  label?: string;
  bits?: number;
  inputs?: number;
  freq?: number;
  value?: number;
  fans?: number;
  size?: number;
  trigger?: 'rising' | 'falling';
  text?: string;
  color?: 'emerald' | 'sky' | 'amber' | 'rose' | 'violet';
  /** Bit extender: source / destination width and sign extension. */
  inBits?: number;
  outBits?: number;
  sign?: boolean;
  /** Pull resistor direction. */
  pull?: 0 | 1;
  /** Enable / reset / tri-state attributes. */
  enable?: boolean;
  reset?: boolean;
  /** Split/merge channel widths; omitted means divide evenly. */
  fanBits?: number[];
  /** Per-bus-bit channel mapping (1-based, 0 means unconnected). */
  bitEnd?: number[];
  /** Shifter direction. */
  shift?: 'left' | 'right' | 'arithmetic';
  /** Bit finder mode. */
  find?: 'low1' | 'high1' | 'low0' | 'high0';
  /** Counter direction. */
  count?: 'up' | 'down';
  /** Seven-segment input mode. */
  segMode?: 'separate' | 'bus';
  /** Random generator seed. */
  seed?: number;
  /** RAM / ROM geometry. */
  addrBits?: number;
  dataBits?: number;
  memory?: number[];
  /** Subcircuit target + generated symbol layout. */
  circuit?: string;
  circuitName?: string;
  subPins?: SubPinLayout[];
  subW?: number;
  subH?: number;
  /** Flattened interface pin marker (internal simulation use). */
  _interface?: boolean;
}

export interface ComponentInstance {
  id: string;
  kind: CompKind;
  /** The Logisim-compatible anchor: usually the primary connection port. */
  at: Point;
  facing: Facing;
  attrs: CompAttrs;
}

export interface WireSeg {
  id: string;
  a: Point;
  b: Point;
}

export interface Doc {
  version: 1;
  name: string;
  comps: ComponentInstance[];
  wires: WireSeg[];
}

export type Tool = 'select' | 'wire' | 'pan';
export type CanvasTheme = 'paper' | 'graphite';
export type Appearance = 'system' | 'light' | 'dark';

export interface Selection {
  comps: string[];
  wires: string[];
}

export const GATE_KINDS: GateKind[] = [
  'not',
  'and',
  'or',
  'nand',
  'nor',
  'xor',
  'xnor',
  'buffer',
  'odd',
  'even',
];
export const isGate = (k: CompKind): k is GateKind => GATE_KINDS.includes(k as GateKind);

export const FACING_VEC: Record<Facing, Point> = {
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
  north: { x: 0, y: -1 },
};

export const FACING_STEP: Record<Facing, number> = { east: 0, south: 1, west: 2, north: 3 };
export const STEP_FACING: Facing[] = ['east', 'south', 'west', 'north'];

export function rotateFacing(f: Facing, steps = 1): Facing {
  return STEP_FACING[(FACING_STEP[f] + steps + 8) % 4];
}

/** Rotate a local point clockwise around the origin (screen y is down). */
export function rotateLocal(p: Point, f: Facing): Point {
  switch (f) {
    case 'east':
      return { x: p.x, y: p.y };
    case 'south':
      return { x: -p.y, y: p.x };
    case 'west':
      return { x: -p.x, y: -p.y };
    case 'north':
      return { x: p.y, y: -p.x };
  }
}

export function toWorld(comp: ComponentInstance, p: Point): Point {
  const r = rotateLocal(p, comp.facing);
  return { x: comp.at.x + r.x, y: comp.at.y + r.y };
}

export function worldToLocal(comp: ComponentInstance, p: Point): Point {
  const v = { x: p.x - comp.at.x, y: p.y - comp.at.y };
  switch (comp.facing) {
    case 'east':
      return v;
    case 'south':
      return { x: v.y, y: -v.x };
    case 'west':
      return { x: -v.x, y: -v.y };
    case 'north':
      return { x: -v.y, y: v.x };
  }
}

export const GRID = 10;

export function snap(v: number, grid = GRID): number {
  const r = Math.round(v / grid) * grid;
  return r === 0 ? 0 : r;
}

export function snapPoint(p: Point, grid = GRID): Point {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}

export function pointKey(p: Point): string {
  return `${Math.round(p.x)},${Math.round(p.y)}`;
}

export function samePoint(a: Point, b: Point, eps = 0.01): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
}

export function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function emptyDoc(name = 'Untitled Circuit'): Doc {
  return { version: 1, name, comps: [], wires: [] };
}

export type { SimWireState } from './value';

export interface ProjectSnapshot {
  version: 2;
  name: string;
  current: string;
  circuits: Record<string, Doc>;
}

export function cloneDoc(doc: Doc): Doc {
  return structuredClone(doc);
}

export const KIND_NAMES: Record<CompKind, string> = {
  input: '输入引脚',
  output: '输出引脚',
  led: '指示灯',
  button: '按钮',
  clock: '时钟',
  constant: '常量',
  not: '非门',
  and: '与门',
  or: '或门',
  nand: '与非门',
  nor: '或非门',
  xor: '异或门',
  xnor: '同或门',
  buffer: '缓冲器',
  odd: '奇数校验',
  even: '偶数校验',
  ctrlBuffer: '三态缓冲器',
  ctrlInverter: '三态反相器',
  split: '分线器',
  merge: '合线器',
  probe: '探针',
  power: '电源',
  ground: '接地',
  pull: '上拉/下拉电阻',
  extend: '位扩展器',
  dff: 'D 触发器',
  tff: 'T 触发器',
  jkff: 'JK 触发器',
  sr: 'SR 锁存器',
  shift: '移位寄存器',
  random: '随机数发生器',
  register: '寄存器',
  counter: '计数器',
  ram: 'RAM',
  rom: 'ROM',
  mux: '多路选择器',
  decoder: '译码器',
  demux: '解复用器',
  priority: '优先编码器',
  bitSelect: '位选择器',
  adder: '加法器',
  subtractor: '减法器',
  multiplier: '乘法器',
  divider: '除法器',
  negator: '取反器',
  bitAdder: '位加法器',
  bitFinder: '位查找器',
  comparator: '比较器',
  shifter: '移位器',
  sevenseg: '七段数码管',
  hexdigit: '十六进制数码管',
  tunnel: '隧道标签',
  sub: '子电路',
  text: '文字注释',
};

export const KIND_NAMES_EN: Record<CompKind, string> = {
  input: 'Input Pin',
  output: 'Output Pin',
  led: 'LED',
  button: 'Button',
  clock: 'Clock',
  constant: 'Constant',
  not: 'NOT Gate',
  and: 'AND Gate',
  or: 'OR Gate',
  nand: 'NAND Gate',
  nor: 'NOR Gate',
  xor: 'XOR Gate',
  xnor: 'XNOR Gate',
  buffer: 'Buffer',
  odd: 'Odd Parity',
  even: 'Even Parity',
  ctrlBuffer: 'Controlled Buffer',
  ctrlInverter: 'Controlled Inverter',
  split: 'Bus Split',
  merge: 'Bus Merge',
  probe: 'Probe',
  power: 'Power',
  ground: 'Ground',
  pull: 'Pull Resistor',
  extend: 'Bit Extender',
  dff: 'D Flip-Flop',
  tff: 'T Flip-Flop',
  jkff: 'JK Flip-Flop',
  sr: 'S-R Latch',
  shift: 'Shift Register',
  random: 'Random Generator',
  register: 'Register',
  counter: 'Counter',
  ram: 'RAM',
  rom: 'ROM',
  mux: 'Multiplexer',
  decoder: 'Decoder',
  demux: 'Demultiplexer',
  priority: 'Priority Encoder',
  bitSelect: 'Bit Selector',
  adder: 'Adder',
  subtractor: 'Subtractor',
  multiplier: 'Multiplier',
  divider: 'Divider',
  negator: 'Negator',
  bitAdder: 'Bit Adder',
  bitFinder: 'Bit Finder',
  comparator: 'Comparator',
  shifter: 'Shifter',
  sevenseg: 'Seven-Segment Display',
  hexdigit: 'Hex Digit Display',
  tunnel: 'Tunnel',
  sub: 'Subcircuit',
  text: 'Text',
};
