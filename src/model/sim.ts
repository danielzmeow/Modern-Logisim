import type { ComponentInstance, Doc, SimWireState } from './types';
import { buildNetlist, type Netlist } from './netlist';
import { flattenCircuit } from './hierarchy';
import { effectiveBitEnd } from './buses';
import {
  errorValue,
  floatingValue,
  knownValue,
  maskFor,
  resolveBitDrivers,
  stateOfBits,
  type BitDriver,
  type BitValue,
} from './value';

export { maskFor };

/**
 * One component output contributing to a net. Unlike the pure `BitDriver`
 * used by `resolveBitDrivers`, error/known are masks so a single port drive
 * can carry per-bit Z/E.
 */
interface MaskDriver {
  value: number;
  known: number;
  error: number;
  weak: boolean;
}

type Read = (port: string) => number;
type ReadState = (port: string) => SimWireState;
type Drive = (port: string, value: number, opts?: { enabled?: boolean; weak?: boolean; error?: boolean }) => void;
type ReadBits = (port: string) => BitValue;
type DriveBits = (port: string, value: BitValue, opts?: { enabled?: boolean; weak?: boolean }) => void;

interface PortIO {
  read: Read;
  state: ReadState;
  drive: Drive;
  readBits: ReadBits;
  driveBits: DriveBits;
}

/** Canonicalize a BitValue to a width: disjoint masks, data only on known bits. */
function maskBits(bits: BitValue, width: number): BitValue {
  const mask = maskFor(width);
  const error = (bits.error & mask) >>> 0;
  const known = (bits.known & mask & ~error) >>> 0;
  return { value: (bits.value & known) >>> 0, known, error };
}

/**
 * Per-bit four-value gate math in the Logisim order: a known absorbing value
 * (0 for AND, 1 for OR) wins over everything; then E propagates; then Z;
 * otherwise the bit is resolved from the inputs.
 */
function bitAnd(a: BitValue, b: BitValue, width: number): BitValue {
  const mask = maskFor(width);
  const zero = ((a.known & ~a.value) | (b.known & ~b.value)) & mask;
  const error = ((a.error | b.error) & ~zero & mask) >>> 0;
  const known = ((zero | (a.known & b.known)) & mask) >>> 0;
  return { value: (a.value & b.value & known) >>> 0, known, error };
}

function bitOr(a: BitValue, b: BitValue, width: number): BitValue {
  const mask = maskFor(width);
  const one = ((a.known & a.value) | (b.known & b.value)) & mask;
  const error = ((a.error | b.error) & ~one & mask) >>> 0;
  const known = ((one | (a.known & b.known)) & mask) >>> 0;
  return { value: ((a.value | b.value) & known) >>> 0, known, error };
}

function bitXor(a: BitValue, b: BitValue, width: number): BitValue {
  const mask = maskFor(width);
  const error = ((a.error | b.error) & mask) >>> 0;
  const known = ((a.known & b.known) & mask) >>> 0;
  return { value: ((a.value ^ b.value) & known) >>> 0, known, error };
}

function bitNot(a: BitValue, width: number): BitValue {
  const mask = maskFor(width);
  const known = (a.known & mask) >>> 0;
  const error = (a.error & mask) >>> 0;
  return { value: (~a.value & known) >>> 0, known, error };
}

interface EvalContext {
  pinValues: Map<string, number>;
  heldButtons: Set<string>;
  clockValue: (id: string) => number;
  seqQ: (id: string) => number;
  seqBits: (id: string) => number;
  memory: (comp: ComponentInstance) => Uint32Array;
}

function bitsOf(comp: ComponentInstance, fallback = 1): number {
  return Math.max(1, Math.min(32, comp.attrs.bits ?? fallback));
}

function extenderBits(comp: ComponentInstance): { inBits: number; outBits: number } {
  return {
    inBits: Math.max(1, Math.min(32, comp.attrs.inBits ?? 4)),
    outBits: Math.max(1, Math.min(32, comp.attrs.outBits ?? 8)),
  };
}

function memorySize(comp: ComponentInstance): number {
  const addrBits = Math.max(1, Math.min(20, comp.attrs.addrBits ?? 4));
  return Math.min(1 << addrBits, 1 << 20);
}

function evalComponent(
  comp: ComponentInstance,
  ports: PortIO,
  ctx: EvalContext,
) {
  const { read, state, drive, readBits, driveBits } = ports;
  const bits = bitsOf(comp);
  const anyBad = (names: string[]) => names.some((name) => state(name) !== 'known');
  const bad = (port: string) => state(port) !== 'known';

  switch (comp.kind) {
    case 'input': {
      // Pins inside an instantiated subcircuit are pass-through terminals: the
      // parent net already drives the wire through the flattened connection.
      if (comp.attrs._interface) break;
      drive('out', (ctx.pinValues.get(comp.id) ?? 0) & maskFor(bits));
      break;
    }
    case 'button': {
      drive('out', ctx.heldButtons.has(comp.id) ? 1 : 0);
      break;
    }
    case 'clock': {
      drive('out', ctx.clockValue(comp.id) & 1);
      break;
    }
    case 'constant': {
      drive('out', Math.round(comp.attrs.value ?? 0) & maskFor(bits));
      break;
    }
    case 'power': {
      drive('out', 1);
      break;
    }
    case 'ground': {
      drive('out', 0);
      break;
    }
    case 'pull': {
      drive('net', (comp.attrs.pull ?? 0) ? 1 : 0, { weak: true });
      break;
    }
    case 'probe':
    case 'sevenseg':
    case 'hexdigit':
    case 'led':
    case 'output':
    case 'tunnel':
    case 'sub':
    case 'text':
      break;
    case 'not': {
      driveBits('out', bitNot(readBits('in'), bits));
      break;
    }
    case 'buffer': {
      driveBits('out', maskBits(readBits('in'), bits));
      break;
    }
    case 'and':
    case 'nand':
    case 'or':
    case 'nor':
    case 'xor':
    case 'xnor': {
      const n = Math.max(2, Math.min(5, comp.attrs.inputs ?? 2));
      let acc = readBits('in0');
      for (let i = 1; i < n; i++) {
        const v = readBits(`in${i}`);
        if (comp.kind === 'and' || comp.kind === 'nand') acc = bitAnd(acc, v, bits);
        else if (comp.kind === 'or' || comp.kind === 'nor') acc = bitOr(acc, v, bits);
        else acc = bitXor(acc, v, bits);
      }
      if (comp.kind === 'nand' || comp.kind === 'nor' || comp.kind === 'xnor') {
        acc = bitNot(acc, bits);
      }
      driveBits('out', acc);
      break;
    }
    case 'odd':
    case 'even': {
      const n = Math.max(2, Math.min(5, comp.attrs.inputs ?? 2));
      if (anyBad(Array.from({ length: n }, (_, i) => `in${i}`))) {
        drive('out', 0, { error: true });
        break;
      }
      let parity = 0;
      for (let i = 0; i < n; i++) {
        let v = read(`in${i}`) & maskFor(bits);
        while (v) {
          parity ^= 1;
          v &= v - 1;
        }
      }
      drive('out', comp.kind === 'odd' ? parity : parity ? 0 : 1);
      break;
    }
    case 'ctrlBuffer':
    case 'ctrlInverter': {
      const en = readBits('enable');
      if (en.error & 1) {
        driveBits('out', errorValue(bits));
        break;
      }
      if (!(en.known & 1)) {
        driveBits('out', floatingValue(bits));
        break;
      }
      if (!(en.value & 1)) break; // high impedance: no driver at all
      const d = maskBits(readBits('in'), bits);
      driveBits('out', comp.kind === 'ctrlInverter' ? bitNot(d, bits) : d);
      break;
    }
    case 'extend': {
      const { inBits, outBits } = extenderBits(comp);
      if (bad('in')) {
        drive('out', 0, { error: true });
        break;
      }
      let v = read('in') & maskFor(inBits);
      if (comp.attrs.sign && (v & (1 << (inBits - 1)))) {
        v |= (~maskFor(inBits)) >>> 0;
      }
      drive('out', v & maskFor(outBits));
      break;
    }
    case 'dff': {
      const q = ctx.seqQ(comp.id) & 1;
      drive('q', q);
      drive('qn', q ? 0 : 1);
      break;
    }
    case 'tff':
    case 'jkff': {
      const q = ctx.seqQ(comp.id) & 1;
      drive('q', q);
      drive('qn', q ? 0 : 1);
      break;
    }
    case 'sr': {
      if (bad('s') || bad('r')) {
        drive('q', 0, { error: true });
        drive('qn', 0, { error: true });
        break;
      }
      const s = read('s') & 1;
      const r = read('r') & 1;
      const q = ctx.seqQ(comp.id) & 1;
      if (s && r) {
        drive('q', 0);
        drive('qn', 0);
      } else if (s) {
        drive('q', 1);
        drive('qn', 0);
      } else if (r) {
        drive('q', 0);
        drive('qn', 1);
      } else {
        drive('q', q);
        drive('qn', q ? 0 : 1);
      }
      break;
    }
    case 'shift': {
      drive('q', ctx.seqQ(comp.id) & maskFor(bits));
      break;
    }
    case 'random': {
      drive('q', ctx.seqQ(comp.id) & maskFor(bits));
      break;
    }
    case 'register': {
      drive('q', ctx.seqQ(comp.id) & maskFor(bits));
      break;
    }
    case 'counter': {
      const q = ctx.seqQ(comp.id) & maskFor(bits);
      drive('q', q);
      const max = maskFor(bits);
      const carry = (comp.attrs.count ?? 'up') === 'down' ? q === 0 : q === max;
      drive('carry', carry ? 1 : 0);
      break;
    }
    case 'ram':
    case 'rom': {
      const addrBits = Math.max(1, Math.min(20, comp.attrs.addrBits ?? 4));
      const dataBits = Math.max(1, Math.min(32, comp.attrs.dataBits ?? 8));
      if (bad('addr')) {
        drive('dout', 0, { error: true });
        break;
      }
      const mem = ctx.memory(comp);
      const addr = (read('addr') >>> 0) % Math.max(1, 1 << addrBits);
      drive('dout', (mem[addr] ?? 0) & maskFor(dataBits));
      break;
    }
    case 'mux': {
      const selBits = Math.max(1, Math.min(4, comp.attrs.fans ?? 1));
      const n = 1 << selBits;
      const sel = maskBits(readBits('sel'), selBits);
      if (sel.error) {
        driveBits('out', errorValue(bits));
        break;
      }
      if (sel.known !== maskFor(selBits)) {
        driveBits('out', floatingValue(bits));
        break;
      }
      const s = sel.value;
      if (s >= n) {
        driveBits('out', errorValue(bits));
        break;
      }
      driveBits('out', maskBits(readBits(`d${s}`), bits));
      break;
    }
    case 'decoder': {
      const selBits = Math.max(1, Math.min(4, comp.attrs.fans ?? 1));
      const n = 1 << selBits;
      let enabled = true;
      if (comp.attrs.enable) {
        if (bad('enable')) {
          for (let i = 0; i < n; i++) drive(`out${i}`, 0, { error: true });
          break;
        }
        enabled = (read('enable') & 1) !== 0;
      }
      if (bad('sel')) {
        for (let i = 0; i < n; i++) drive(`out${i}`, 0, { error: true });
        break;
      }
      const sel = read('sel');
      for (let i = 0; i < n; i++) drive(`out${i}`, enabled && i === sel ? 1 : 0);
      break;
    }
    case 'demux': {
      const selBits = Math.max(1, Math.min(4, comp.attrs.fans ?? 1));
      const n = 1 << selBits;
      const sel = maskBits(readBits('sel'), selBits);
      if (sel.error) {
        for (let i = 0; i < n; i++) driveBits(`out${i}`, errorValue(bits));
        break;
      }
      if (sel.known !== maskFor(selBits)) {
        for (let i = 0; i < n; i++) driveBits(`out${i}`, floatingValue(bits));
        break;
      }
      const s = sel.value;
      const d = maskBits(readBits('in'), bits);
      for (let i = 0; i < n; i++) {
        driveBits(`out${i}`, i === s ? d : knownValue(0, bits));
      }
      break;
    }
    case 'priority': {
      const selBits = Math.max(1, Math.min(4, comp.attrs.fans ?? 2));
      const n = 1 << selBits;
      let index = -1;
      let group = 0;
      let sawError = false;
      for (let i = 0; i < n; i++) {
        const st = state(`in${i}`);
        if (st === 'e') sawError = true;
        if (st === 'known' && (read(`in${i}`) & 1)) {
          group = 1;
          if (i > index) index = i;
        }
      }
      if (sawError && index < 0) drive('out', 0, { error: true });
      else drive('out', index < 0 ? 0 : index);
      drive('group', group);
      break;
    }
    case 'bitSelect': {
      const selBits = Math.max(1, Math.min(5, comp.attrs.fans ?? 2));
      const sel = maskBits(readBits('sel'), selBits);
      if (sel.error) {
        driveBits('out', errorValue(1));
        break;
      }
      if (sel.known !== maskFor(selBits)) {
        driveBits('out', floatingValue(1));
        break;
      }
      const s = sel.value % (1 << selBits);
      if (s >= bits) {
        driveBits('out', knownValue(0, 1));
        break;
      }
      const d = readBits('in');
      driveBits('out', {
        value: (d.value >>> s) & 1,
        known: (d.known >>> s) & 1,
        error: (d.error >>> s) & 1,
      });
      break;
    }
    case 'adder':
    case 'subtractor': {
      if (bad('a') || bad('b') || bad('cin')) {
        drive('out', 0, { error: true });
        drive('carry', 0, { error: true });
        break;
      }
      const a = read('a') & maskFor(bits);
      const b = read('b') & maskFor(bits);
      const cin = read('cin') & 1;
      if (comp.kind === 'adder') {
        const sum = a + b + cin;
        drive('out', sum & maskFor(bits));
        drive('carry', sum > maskFor(bits) ? 1 : 0);
      } else {
        const diff = a - b - cin;
        drive('out', diff & maskFor(bits));
        drive('carry', diff < 0 ? 1 : 0);
      }
      break;
    }
    case 'multiplier': {
      const outBits = Math.min(32, bits * 2);
      if (bad('a') || bad('b')) {
        drive('out', 0, { error: true });
        break;
      }
      const product = BigInt(read('a') & maskFor(bits)) * BigInt(read('b') & maskFor(bits));
      drive('out', Number(product & BigInt(maskFor(outBits))) >>> 0);
      break;
    }
    case 'negator': {
      if (bad('in')) {
        drive('out', 0, { error: true });
        break;
      }
      drive('out', (~read('in') + 1) & maskFor(bits));
      break;
    }
    case 'divider': {
      if (bad('a') || bad('b')) {
        drive('out', 0, { error: true });
        drive('rem', 0, { error: true });
        break;
      }
      const a = read('a') & maskFor(bits);
      const b = read('b') & maskFor(bits);
      if (b === 0) {
        // Logisim exposes division by zero as an error value, not as 0.
        drive('out', 0, { error: true });
        drive('rem', 0, { error: true });
        break;
      }
      drive('out', Math.floor(a / b) & maskFor(bits));
      drive('rem', (a % b) & maskFor(bits));
      break;
    }
    case 'bitAdder': {
      if (bad('in')) {
        drive('out', 0, { error: true });
        break;
      }
      let v = read('in') & maskFor(bits);
      let ones = 0;
      while (v) {
        ones += v & 1;
        v >>>= 1;
      }
      drive('out', ones);
      break;
    }
    case 'bitFinder': {
      if (bad('in')) {
        drive('present', 0, { error: true });
        drive('index', 0, { error: true });
        break;
      }
      const value = read('in') & maskFor(bits);
      const mode = comp.attrs.find ?? 'low1';
      const want = mode.endsWith('1') ? 1 : 0;
      const lowFirst = mode.startsWith('low');
      let found = -1;
      for (let step = 0; step < bits; step++) {
        const bit = lowFirst ? step : bits - 1 - step;
        if (((value >>> bit) & 1) === want) {
          found = bit;
          break;
        }
      }
      drive('present', found >= 0 ? 1 : 0);
      drive('index', found >= 0 ? found : 0);
      break;
    }
    case 'comparator': {
      if (bad('a') || bad('b')) {
        drive('gt', 0, { error: true });
        drive('eq', 0, { error: true });
        drive('lt', 0, { error: true });
        break;
      }
      const a = read('a') & maskFor(bits);
      const b = read('b') & maskFor(bits);
      drive('gt', a > b ? 1 : 0);
      drive('eq', a === b ? 1 : 0);
      drive('lt', a < b ? 1 : 0);
      break;
    }
    case 'shifter': {
      if (bad('in') || bad('sel')) {
        drive('out', 0, { error: true });
        break;
      }
      const selBits = Math.max(1, Math.min(5, Math.ceil(Math.log2(bits)) + 1));
      const amount = read('sel') % (1 << selBits);
      const mask = maskFor(bits);
      const v = read('in') & mask;
      const direction = comp.attrs.shift ?? 'left';
      let out: number;
      if (direction === 'left') out = (v << amount) & mask;
      else if (direction === 'arithmetic') {
        const sign = v & (1 << (bits - 1));
        out = (v >> amount) & mask;
        if (sign) out = (out | ((mask << (bits - amount)) & mask)) & mask;
      } else {
        out = (v >>> amount) & mask;
      }
      drive('out', out);
      break;
    }
    case 'split': {
      const fans = Math.max(2, Math.min(12, comp.attrs.fans ?? 2));
      const bus = readBits('bus');
      const ends = effectiveBitEnd(comp);
      const values = new Array<number>(fans).fill(0);
      const knowns = new Array<number>(fans).fill(0);
      const errors = new Array<number>(fans).fill(0);
      const positions = new Array<number>(fans).fill(0);
      for (let bit = 0; bit < ends.length; bit++) {
        const lane = ends[bit];
        if (!lane) continue;
        const index = lane - 1;
        const position = positions[index]++;
        values[index] |= ((bus.value >>> bit) & 1) << position;
        knowns[index] |= ((bus.known >>> bit) & 1) << position;
        errors[index] |= ((bus.error >>> bit) & 1) << position;
      }
      for (let i = 0; i < fans; i++) {
        driveBits(`f${i}`, { value: values[i], known: knowns[i], error: errors[i] });
      }
      break;
    }
    case 'merge': {
      const fans = Math.max(2, Math.min(12, comp.attrs.fans ?? 2));
      const ends = effectiveBitEnd(comp);
      const lanes = Array.from({ length: fans }, (_, i) => readBits(`f${i}`));
      const positions = new Array<number>(fans).fill(0);
      let value = 0;
      let known = 0;
      let error = 0;
      for (let bit = 0; bit < ends.length; bit++) {
        const lane = ends[bit];
        if (!lane) continue;
        const index = lane - 1;
        const d = lanes[index];
        const position = positions[index]++;
        value |= ((d.value >>> position) & 1) << bit;
        known |= ((d.known >>> position) & 1) << bit;
        error |= ((d.error >>> position) & 1) << bit;
      }
      driveBits('bus', { value: value >>> 0, known: known >>> 0, error: error >>> 0 });
      break;
    }
  }
}

export interface SimValue {
  value: number;
  width: number;
  high: boolean;
  state: SimWireState;
  /** Bit mask of the resolved known bits (1 = known); Z and E bits stay 0. */
  known: number;
  /** Bit mask of the error bits (1 = E). */
  error: number;
}

interface SeqState {
  q: number;
  prevClk: number;
  init: boolean;
  bits: number;
}

export class Simulator {
  private doc: Doc | null = null;
  private circuits: Record<string, Doc> | undefined;
  private flat: Doc | null = null;
  private netlist: Netlist | null = null;
  private values = new Uint32Array(0);
  private known = new Uint32Array(0);
  private error = new Uint32Array(0);
  private scratch = new Uint32Array(0);
  private scratchKnown = new Uint32Array(0);
  private scratchError = new Uint32Array(0);
  private drivers: MaskDriver[][] = [];
  private lastChangedNets = new Set<number>();
  private pinValues = new Map<string, number>();
  private heldButtons = new Set<string>();
  private seqState = new Map<string, SeqState>();
  private clockState = new Map<string, { value: number; nextAt: number }>();
  private memories = new Map<string, { sig: string; data: Uint32Array }>();
  private running = false;
  private dirty = true;
  private oscillationState: { nets: Set<number> } | null = null;
  private evalCount = 0;
  private errors: string[] = [];
  private rootId: string | undefined;
  tick = 0;

  update(doc: Doc, circuits?: Record<string, Doc>, rootId?: string) {
    if (doc === this.doc && circuits === this.circuits && rootId === this.rootId && this.netlist) return;
    this.doc = doc;
    this.circuits = circuits;
    this.rootId = rootId;
    const flat = circuits ? flattenCircuit(doc, circuits, rootId) : { doc, errors: [] };
    this.flat = flat.doc;
    this.errors = flat.errors;
    this.netlist = buildNetlist(flat.doc);
    this.values = new Uint32Array(this.netlist.nets.length);
    this.known = new Uint32Array(this.netlist.nets.length);
    this.error = new Uint32Array(this.netlist.nets.length);
    this.scratch = new Uint32Array(this.netlist.nets.length);
    this.scratchKnown = new Uint32Array(this.netlist.nets.length);
    this.scratchError = new Uint32Array(this.netlist.nets.length);
    this.drivers = Array.from({ length: this.netlist.nets.length }, () => []);
    this.dirty = true;
    this.evalCount = 0;
    // Net indices are rebuilt below, so any recorded oscillation is stale.
    this.oscillationState = null;
    const present = new Set(flat.doc.comps.map((c) => c.id));
    for (const id of this.pinValues.keys()) if (!present.has(id)) this.pinValues.delete(id);
    for (const id of this.heldButtons) if (!present.has(id)) this.heldButtons.delete(id);
    for (const id of this.seqState.keys()) if (!present.has(id)) this.seqState.delete(id);
    for (const id of this.clockState.keys()) if (!present.has(id)) this.clockState.delete(id);
    for (const id of this.memories.keys()) if (!present.has(id)) this.memories.delete(id);
  }

  private seqComp(comp: ComponentInstance, bits: number) {
    let st = this.seqState.get(comp.id);
    if (!st) {
      st = { q: 0, prevClk: 0, init: false, bits };
      this.seqState.set(comp.id, st);
    }
    st.bits = bits;
    return st;
  }

  private clock(id: string, now: number) {
    let st = this.clockState.get(id);
    if (!st) {
      st = { value: 0, nextAt: now + 250 };
      this.clockState.set(id, st);
    }
    return st;
  }

  private memory(comp: ComponentInstance): Uint32Array {
    const size = memorySize(comp);
    const source = comp.attrs.memory ?? [];
    let hash = source.length;
    for (let i = 0; i < source.length; i++) hash = (hash * 31 + (source[i] >>> 0)) | 0;
    const sig = `${size}:${comp.attrs.dataBits ?? 8}:${hash}`;
    let mem = this.memories.get(comp.id);
    if (!mem || mem.sig !== sig) {
      const data = new Uint32Array(size);
      for (let i = 0; i < Math.min(size, source.length); i++) data[i] = source[i] >>> 0;
      mem = { sig, data };
      this.memories.set(comp.id, mem);
    }
    return mem.data;
  }

  /** Copy an edited memory array back into the simulator. */
  loadMemory(comp: ComponentInstance, values: number[]) {
    const size = memorySize(comp);
    const data = new Uint32Array(size);
    for (let i = 0; i < Math.min(size, values.length); i++) data[i] = values[i] >>> 0;
    this.memories.set(comp.id, { sig: `${size}:${comp.attrs.dataBits ?? 8}`, data });
    this.dirty = true;
  }

  memoryValues(comp: ComponentInstance): number[] {
    return Array.from(this.memory(comp));
  }

  private evalOnce(useScratch: boolean): boolean {
    const nl = this.netlist;
    if (!nl) return false;
    const prev = this.values;
    const prevKnown = this.known;
    const prevError = this.error;
    const next = useScratch ? this.scratch : this.values;
    const nextKnown = useScratch ? this.scratchKnown : this.known;
    const nextError = useScratch ? this.scratchError : this.error;
    next.fill(0);
    nextKnown.fill(0);
    nextError.fill(0);
    for (const list of this.drivers) list.length = 0;
    const portNet = (compId: string, port: string) => nl.portNet.get(`${compId}:${port}`) ?? -1;

    const readBitsOf = (compId: string): ReadBits => (port: string) => {
      const n = portNet(compId, port);
      if (n < 0) return { value: 0, known: 0, error: 0 };
      return { value: prev[n] >>> 0, known: prevKnown[n] >>> 0, error: prevError[n] >>> 0 };
    };
    const readOf = (compId: string): Read =>
      (port: string) => {
        const n = portNet(compId, port);
        if (n < 0) return 0;
        const mask = maskFor(nl.nets[n].width);
        return (prevKnown[n] & mask) >>> 0 === mask ? prev[n] >>> 0 : 0;
      };
    const stateOf = (compId: string): ReadState =>
      (port: string) => {
        const n = portNet(compId, port);
        if (n < 0) return 'z';
        return stateOfBits(
          { value: prev[n] >>> 0, known: prevKnown[n] >>> 0, error: prevError[n] >>> 0 },
          nl.nets[n].width,
        );
      };
    const pushDriver = (compId: string, port: string, bits: BitValue, weak: boolean, enabled?: boolean) => {
      if (enabled === false) return;
      const n = portNet(compId, port);
      if (n < 0) return;
      const mask = maskFor(nl.nets[n].width);
      const error = (bits.error & mask) >>> 0;
      const known = (bits.known & mask & ~error) >>> 0;
      this.drivers[n].push({
        value: (bits.value & known) >>> 0,
        known,
        error,
        weak,
      });
    };
    const driveBitsOf = (compId: string): DriveBits => (port, bits, opts = {}) =>
      pushDriver(compId, port, bits, !!opts.weak, opts.enabled);
    // Legacy whole-port drive: a uniform error collapses to an all-E mask, so
    // un-migrated components keep their previous whole-port behavior.
    const driveOf = (compId: string): Drive => (port, value, opts = {}) => {
      const n = portNet(compId, port);
      const width = n < 0 ? 1 : nl.nets[n].width;
      pushDriver(
        compId,
        port,
        opts.error ? errorValue(width) : knownValue(value, width),
        !!opts.weak,
        opts.enabled,
      );
    };

    const comps = this.flat?.comps ?? [];
    for (const comp of comps) {
      evalComponent(
        comp,
        {
          read: readOf(comp.id),
          state: stateOf(comp.id),
          drive: driveOf(comp.id),
          readBits: readBitsOf(comp.id),
          driveBits: driveBitsOf(comp.id),
        },
        {
          pinValues: this.pinValues,
          heldButtons: this.heldButtons,
          clockValue: (id) => this.clockState.get(id)?.value ?? 0,
          seqQ: (id) => this.seqState.get(id)?.q ?? 0,
          seqBits: (id) => this.seqState.get(id)?.bits ?? 1,
          memory: (c) => this.memory(c),
        },
      );
    }

    // Resolve each net bit by bit through the shared four-value resolver: a
    // driver asserts a bit only where its known/error masks say so, agreeing
    // strong drivers merge, disagreements mark only the disagreeing bits E,
    // and a weak pull fills bits no strong driver resolves.
    for (let n = 0; n < nl.nets.length; n++) {
      const width = nl.nets[n].width;
      if (nl.forcedError.has(n)) {
        // Stub nets for width-incompatible ports stay pinned to E.
        nextError[n] = maskFor(width);
        continue;
      }
      const list = this.drivers[n];
      if (!list.length) continue; // floating: masks stay 0
      const perBit: BitDriver[] = [];
      let value = 0;
      let known = 0;
      let error = 0;
      for (let b = 0; b < width; b++) {
        perBit.length = 0;
        for (const d of list) {
          if ((d.error >>> b) & 1) perBit.push({ value: 0, error: true, weak: d.weak });
          else if ((d.known >>> b) & 1) perBit.push({ value: (d.value >>> b) & 1, error: false, weak: d.weak });
        }
        const r = resolveBitDrivers(perBit, 1);
        value |= r.value << b;
        known |= r.known << b;
        error |= r.error << b;
      }
      next[n] = value >>> 0;
      nextKnown[n] = known >>> 0;
      nextError[n] = error >>> 0;
    }

    if (useScratch) {
      let changed = false;
      this.lastChangedNets.clear();
      for (let i = 0; i < next.length; i++) {
        if (next[i] !== prev[i] || nextKnown[i] !== prevKnown[i] || nextError[i] !== prevError[i]) {
          changed = true;
          this.lastChangedNets.add(i);
        }
      }
      const tmp = this.values;
      this.values = this.scratch;
      this.scratch = tmp;
      const tmpK = this.known;
      this.known = this.scratchKnown;
      this.scratchKnown = tmpK;
      const tmpE = this.error;
      this.error = this.scratchError;
      this.scratchError = tmpE;
      return changed;
    }
    return true;
  }

  private netValue(compId: string, port: string): number {
    const nl = this.netlist;
    if (!nl) return 0;
    const n = nl.portNet.get(`${compId}:${port}`);
    if (n === undefined) return 0;
    const mask = maskFor(nl.nets[n].width);
    return (this.known[n] & mask) >>> 0 === mask ? this.values[n] >>> 0 : 0;
  }

  private netKnown(compId: string, port: string): boolean {
    const nl = this.netlist;
    if (!nl) return false;
    const n = nl.portNet.get(`${compId}:${port}`);
    if (n === undefined) return false;
    const mask = maskFor(nl.nets[n].width);
    // Sequential inputs keep their whole-port requirement: capture only when
    // every bit of the net is known (no Z, no E).
    return (this.known[n] & mask) >>> 0 === mask;
  }

  private compute(): boolean {
    const nl = this.netlist;
    if (!nl) return false;
    let changed = false;
    let settled = false;
    const recentChanged: Set<number>[] = [];
    for (let i = 0; i < 64; i++) {
      const ch = this.evalOnce(true);
      if (ch) {
        changed = true;
        recentChanged.push(new Set(this.lastChangedNets));
      } else {
        settled = true;
        break;
      }
    }
    if (!settled) {
      // Feedback did not settle. The unstable region is every net that kept
      // changing through the final passes (a stable net may have flipped only
      // during the early transient); mark exactly those nets E so the rest of
      // the circuit stays usable.
      const unstable = new Set<number>();
      for (const pass of recentChanged.slice(-8)) for (const n of pass) unstable.add(n);
      for (const n of unstable) {
        this.values[n] = 0;
        this.known[n] = 0;
        this.error[n] = maskFor(nl.nets[n].width);
      }
      this.oscillationState = { nets: unstable };
    } else {
      // A later convergence (after an edit, reset, or resume) clears it.
      this.oscillationState = null;
    }

    // Sequential updates see the stable combinational values.
    let edgeChanged = false;
    const comps = this.flat?.comps ?? [];
    for (const comp of comps) {
      if (comp.kind === 'dff') {
        const st = this.seqComp(comp, 1);
        if (!this.netKnown(comp.id, 'clk') || !this.netKnown(comp.id, 'd')) continue;
        const clk = this.netValue(comp.id, 'clk') & 1;
        const d = this.netValue(comp.id, 'd') & 1;
        if (!st.init) {
          st.prevClk = clk;
          st.init = true;
          continue;
        }
        const rising = st.prevClk === 0 && clk === 1;
        const falling = st.prevClk === 1 && clk === 0;
        const trigger = comp.attrs.trigger === 'falling' ? falling : rising;
        if (trigger && d !== st.q) {
          st.q = d;
          edgeChanged = true;
        }
        st.prevClk = clk;
      } else if (comp.kind === 'tff') {
        const st = this.seqComp(comp, 1);
        if (!this.netKnown(comp.id, 'clk') || !this.netKnown(comp.id, 't')) continue;
        const clk = this.netValue(comp.id, 'clk') & 1;
        if (!st.init) {
          st.prevClk = clk;
          st.init = true;
          continue;
        }
        const rising = st.prevClk === 0 && clk === 1;
        const falling = st.prevClk === 1 && clk === 0;
        const trigger = comp.attrs.trigger === 'falling' ? falling : rising;
        if (trigger && (this.netValue(comp.id, 't') & 1)) {
          st.q = st.q ? 0 : 1;
          edgeChanged = true;
        }
        st.prevClk = clk;
      } else if (comp.kind === 'jkff') {
        const st = this.seqComp(comp, 1);
        if (!this.netKnown(comp.id, 'clk') || !this.netKnown(comp.id, 'j') || !this.netKnown(comp.id, 'k')) continue;
        const clk = this.netValue(comp.id, 'clk') & 1;
        if (!st.init) {
          st.prevClk = clk;
          st.init = true;
          continue;
        }
        const rising = st.prevClk === 0 && clk === 1;
        const falling = st.prevClk === 1 && clk === 0;
        const trigger = comp.attrs.trigger === 'falling' ? falling : rising;
        if (trigger) {
          const j = this.netValue(comp.id, 'j') & 1;
          const k = this.netValue(comp.id, 'k') & 1;
          const next = j && k ? (st.q ? 0 : 1) : j ? 1 : k ? 0 : st.q;
          if (next !== st.q) {
            st.q = next;
            edgeChanged = true;
          }
        }
        st.prevClk = clk;
      } else if (comp.kind === 'shift') {
        const bits = bitsOf(comp, 8);
        const st = this.seqComp(comp, bits);
        const reset = comp.attrs.reset !== false && this.netKnown(comp.id, 'reset') && (this.netValue(comp.id, 'reset') & 1) === 1;
        if (reset && st.q !== 0) {
          st.q = 0;
          edgeChanged = true;
        }
        if (!this.netKnown(comp.id, 'clk')) continue;
        const clk = this.netValue(comp.id, 'clk') & 1;
        if (!st.init) {
          st.prevClk = clk;
          st.init = true;
          continue;
        }
        const rising = st.prevClk === 0 && clk === 1;
        const falling = st.prevClk === 1 && clk === 0;
        const trigger = comp.attrs.trigger === 'falling' ? falling : rising;
        const enabled =
          comp.attrs.enable === false ||
          !this.netKnown(comp.id, 'enable') ||
          (this.netValue(comp.id, 'enable') & 1) === 1;
        if (trigger && enabled && !reset && this.netKnown(comp.id, 'd')) {
          const next = ((st.q << 1) | (this.netValue(comp.id, 'd') & 1)) & maskFor(bits);
          if (next !== st.q) {
            st.q = next;
            edgeChanged = true;
          }
        }
        st.prevClk = clk;
      } else if (comp.kind === 'random') {
        const bits = bitsOf(comp, 8);
        const st = this.seqComp(comp, bits);
        const reset = comp.attrs.reset !== false && this.netKnown(comp.id, 'reset') && (this.netValue(comp.id, 'reset') & 1) === 1;
        if (reset && st.q !== 0) {
          st.q = 0;
          edgeChanged = true;
        }
        if (!this.netKnown(comp.id, 'clk')) continue;
        const clk = this.netValue(comp.id, 'clk') & 1;
        if (!st.init) {
          st.prevClk = clk;
          st.init = true;
          continue;
        }
        const rising = st.prevClk === 0 && clk === 1;
        const falling = st.prevClk === 1 && clk === 0;
        const trigger = comp.attrs.trigger === 'falling' ? falling : rising;
        const enabled =
          comp.attrs.enable === false ||
          !this.netKnown(comp.id, 'enable') ||
          (this.netValue(comp.id, 'enable') & 1) === 1;
        if (trigger && enabled && !reset) {
          let x = (st.q ^ ((comp.attrs.seed ?? 0) || 0x9e3779b9)) >>> 0;
          x = (x ^ (x << 13)) >>> 0;
          x = (x ^ (x >>> 17)) >>> 0;
          x = (x ^ (x << 5)) >>> 0;
          const next = x & maskFor(bits);
          if (next !== st.q) {
            st.q = next;
            edgeChanged = true;
          }
        }
        st.prevClk = clk;
      } else if (comp.kind === 'sr') {
        if (!this.netKnown(comp.id, 's') || !this.netKnown(comp.id, 'r')) continue;
        const st = this.seqComp(comp, 1);
        const s = this.netValue(comp.id, 's') & 1;
        const r = this.netValue(comp.id, 'r') & 1;
        const next = s && r ? 0 : s ? 1 : r ? 0 : st.q;
        if (next !== st.q) {
          st.q = next;
          edgeChanged = true;
        }
      } else if (comp.kind === 'register') {
        const bits = bitsOf(comp, 8);
        const st = this.seqComp(comp, bits);
        const reset = comp.attrs.reset !== false && this.netKnown(comp.id, 'reset') && (this.netValue(comp.id, 'reset') & 1) === 1;
        if (reset && st.q !== 0) {
          st.q = 0;
          edgeChanged = true;
        }
        if (!this.netKnown(comp.id, 'clk')) continue;
        const clk = this.netValue(comp.id, 'clk') & 1;
        if (!st.init) {
          st.prevClk = clk;
          st.init = true;
          continue;
        }
        const rising = st.prevClk === 0 && clk === 1;
        const falling = st.prevClk === 1 && clk === 0;
        const trigger = comp.attrs.trigger === 'falling' ? falling : rising;
        const enabled =
          comp.attrs.enable === false ||
          !this.netKnown(comp.id, 'enable') ||
          (this.netValue(comp.id, 'enable') & 1) === 1;
        if (trigger && enabled && !reset && this.netKnown(comp.id, 'd')) {
          const next = this.netValue(comp.id, 'd') & maskFor(bits);
          if (next !== st.q) {
            st.q = next;
            edgeChanged = true;
          }
        }
        st.prevClk = clk;
      } else if (comp.kind === 'counter') {
        const bits = bitsOf(comp, 8);
        const st = this.seqComp(comp, bits);
        const reset = comp.attrs.reset !== false && this.netKnown(comp.id, 'reset') && (this.netValue(comp.id, 'reset') & 1) === 1;
        if (reset && st.q !== 0) {
          st.q = 0;
          edgeChanged = true;
        }
        if (!this.netKnown(comp.id, 'clk')) continue;
        const clk = this.netValue(comp.id, 'clk') & 1;
        if (!st.init) {
          st.prevClk = clk;
          st.init = true;
          continue;
        }
        const rising = st.prevClk === 0 && clk === 1;
        const falling = st.prevClk === 1 && clk === 0;
        const trigger = comp.attrs.trigger === 'falling' ? falling : rising;
        const enabled =
          comp.attrs.enable === false ||
          !this.netKnown(comp.id, 'enable') ||
          (this.netValue(comp.id, 'enable') & 1) === 1;
        if (trigger && enabled && !reset) {
          const max = maskFor(bits);
          const dir = comp.attrs.count ?? 'up';
          st.q = dir === 'down' ? (st.q - 1) & max : (st.q + 1) & max;
          edgeChanged = true;
        }
        st.prevClk = clk;
      } else if (comp.kind === 'ram') {
        if (!this.netKnown(comp.id, 'clk') || !this.netKnown(comp.id, 'we')) continue;
        const clk = this.netValue(comp.id, 'clk') & 1;
        const st = this.seqState.get(comp.id) ?? { q: 0, prevClk: 0, init: false, bits: 1 };
        this.seqState.set(comp.id, st);
        const rising = st.prevClk === 0 && clk === 1;
        if (st.init && rising && (this.netValue(comp.id, 'we') & 1) && this.netKnown(comp.id, 'addr') && this.netKnown(comp.id, 'din')) {
          const addrBits = Math.max(1, Math.min(20, comp.attrs.addrBits ?? 4));
          const dataBits = Math.max(1, Math.min(32, comp.attrs.dataBits ?? 8));
          const mem = this.memory(comp);
          const addr = (this.netValue(comp.id, 'addr') >>> 0) % Math.max(1, 1 << addrBits);
          mem[addr] = this.netValue(comp.id, 'din') & maskFor(dataBits);
          edgeChanged = true;
        }
        st.prevClk = clk;
        st.init = true;
      }
    }
    if (edgeChanged) {
      for (let i = 0; i < 32; i++) {
        const ch = this.evalOnce(true);
        if (ch) changed = true;
        else break;
      }
    }
    if (changed || edgeChanged) this.tick++;
    this.dirty = false;
    this.evalCount++;
    return changed || edgeChanged;
  }

  /** Advance one manual simulation tick: every clock source toggles once. */
  step(now = Date.now()): boolean {
    if (!this.netlist) return false;
    for (const comp of this.flat?.comps ?? []) {
      if (comp.kind !== 'clock') continue;
      const st = this.clock(comp.id, now);
      st.value = st.value ? 0 : 1;
      const half = 500 / Math.max(0.2, Math.min(40, comp.attrs.freq ?? 2));
      st.nextAt = now + half;
    }
    this.dirty = true;
    return this.compute();
  }

  /** Advance clocks and re-evaluate. Call every animation frame. */
  frame(now: number, running: boolean): boolean {
    const nl = this.netlist;
    if (!nl) return false;
    if (!running) {
      this.running = false;
    } else {
      if (!this.running) {
        for (const comp of this.flat?.comps ?? []) {
          if (comp.kind !== 'clock') continue;
          const st = this.clock(comp.id, now);
          st.nextAt = now + 500 / Math.max(0.2, comp.attrs.freq ?? 2);
        }
        this.running = true;
        // Re-evaluate on resume so a recovered circuit is not kept frozen by
        // a stale oscillation diagnosis.
        if (this.oscillationState) this.dirty = true;
      }
      // Oscillation freezes clock advancement: no toggles and no catch-up, so
      // resuming later never replays wall-clock ticks accumulated meanwhile.
      if (!this.oscillationState) {
        let clockChanged = false;
        for (const comp of this.flat?.comps ?? []) {
          if (comp.kind !== 'clock') continue;
          const freq = Math.max(0.2, Math.min(40, comp.attrs.freq ?? 2));
          const half = 500 / freq;
          const st = this.clock(comp.id, now);
          if (st.nextAt < now - half * 4) st.nextAt = now + half;
          let toggles = 0;
          while (now >= st.nextAt && toggles < 8) {
            st.value = st.value ? 0 : 1;
            st.nextAt += half;
            toggles++;
            clockChanged = true;
          }
        }
        if (clockChanged) this.dirty = true;
      }
    }
    if (this.dirty) return this.compute();
    return false;
  }

  setPinValue(compId: string, value: number) {
    this.pinValues.set(compId, value >>> 0);
    this.dirty = true;
  }

  setButton(compId: string, held: boolean) {
    if (held) this.heldButtons.add(compId);
    else this.heldButtons.delete(compId);
    this.dirty = true;
  }

  togglePin(comp: ComponentInstance) {
    if (comp.kind !== 'input') return;
    const bits = bitsOf(comp);
    if (bits === 1) {
      this.setPinValue(comp.id, (this.pinValues.get(comp.id) ?? 0) ? 0 : 1);
    }
  }

  pinValue(compId: string): number {
    return this.pinValues.get(compId) ?? 0;
  }

  isHeld(compId: string): boolean {
    return this.heldButtons.has(compId);
  }

  reset(compute = true, clearMemory = false) {
    if (clearMemory) this.memories.clear();
    for (const st of this.seqState.values()) {
      st.q = 0;
      st.init = false;
    }
    for (const st of this.clockState.values()) st.value = 0;
    this.heldButtons.clear();
    // Reset begins a fresh detection cycle; the next compute may legitimately
    // flag the same unchanged circuit again.
    this.oscillationState = null;
    this.tick++;
    this.dirty = true;
    if (compute) this.compute();
  }

  ensure(doc: Doc, circuits?: Record<string, Doc>, rootId?: string) {
    this.update(doc, circuits, rootId);
    if (this.dirty) this.compute();
  }

  netlistOrNull() {
    return this.netlist;
  }

  get errorsList(): string[] {
    return this.errors;
  }

  valueOfNet(netId: number): SimValue {
    const nl = this.netlist;
    if (!nl || netId < 0 || netId >= nl.nets.length) {
      return { value: 0, width: 1, high: false, state: 'z', known: 0, error: 0 };
    }
    const width = nl.nets[netId].width;
    const bits = maskBits(
      {
        value: this.values[netId] ?? 0,
        known: this.known[netId] ?? 0,
        error: this.error[netId] ?? 0,
      },
      width,
    );
    return {
      value: bits.value,
      width,
      high: bits.known === maskFor(width) && bits.value !== 0,
      state: stateOfBits(bits, width),
      known: bits.known,
      error: bits.error,
    };
  }

  valueOfWire(wireIndex: number): SimValue {
    const nl = this.netlist;
    if (!nl) return { value: 0, width: 1, high: false, state: 'z', known: 0, error: 0 };
    return this.valueOfNet(nl.wireNet[wireIndex]);
  }

  /** Value of a flattened wire by its (possibly instance-prefixed) id. */
  valueOfWireId(wireId: string): SimValue | null {
    const nl = this.netlist;
    if (!nl) return null;
    const n = nl.wireIdNet.get(wireId);
    if (n === undefined) return null;
    return this.valueOfNet(n);
  }

  valueOfPort(compId: string, port: string): SimValue {
    const nl = this.netlist;
    if (!nl) return { value: 0, width: 1, high: false, state: 'z', known: 0, error: 0 };
    const n = nl.portNet.get(`${compId}:${port}`);
    return this.valueOfNet(n ?? -1);
  }

  stateOfPort(compId: string, port: string): SimWireState {
    return this.valueOfPort(compId, port).state;
  }

  netOfPort(compId: string, port: string): number {
    return this.netlist?.portNet.get(`${compId}:${port}`) ?? -1;
  }

  /** Run a synchronous combinational pass, used by the truth-table engine. */
  evaluateNow(): boolean {
    this.dirty = true;
    return this.compute();
  }

  /** Unstable nets when the latest compute failed to settle, else null. */
  get oscillation(): { nets: ReadonlySet<number> } | null {
    return this.oscillationState;
  }

  get runningState() {
    return this.running;
  }
}

export const sim = new Simulator();
