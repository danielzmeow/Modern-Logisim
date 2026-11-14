import type { ComponentInstance, Doc } from './types';
import { buildNetlist, type Netlist } from './netlist';

const MASK_CACHE: Record<number, number> = {};
export function maskFor(bits: number): number {
  const b = Math.max(1, Math.min(32, Math.round(bits)));
  if (MASK_CACHE[b] === undefined) {
    MASK_CACHE[b] =
      b >= 32 ? 0xffffffff : b === 1 ? 1 : ((1 << b) >>> 0) - 1;
    MASK_CACHE[b] >>>= 0;
  }
  return MASK_CACHE[b];
}

function evalComponent(
  comp: ComponentInstance,
  read: (port: string) => number,
  write: (port: string, value: number) => void,
  pinValues: Map<string, number>,
  heldButtons: Set<string>,
  clockValue: (id: string) => number,
  dffQ: (id: string) => number,
) {
  const bits = Math.max(1, Math.min(32, comp.attrs.bits ?? 1));
  switch (comp.kind) {
    case 'input': {
      write('out', (pinValues.get(comp.id) ?? 0) & maskFor(bits));
      break;
    }
    case 'button': {
      write('out', heldButtons.has(comp.id) ? 1 : 0);
      break;
    }
    case 'clock': {
      write('out', clockValue(comp.id) & 1);
      break;
    }
    case 'constant': {
      write('out', Math.round(comp.attrs.value ?? 0) & maskFor(bits));
      break;
    }
    case 'led':
    case 'output':
    case 'tunnel':
    case 'text':
      break;
    case 'not': {
      const v = read('in');
      write('out', v === 1 ? 0 : 1);
      break;
    }
    case 'and':
    case 'nand':
    case 'or':
    case 'nor':
    case 'xor':
    case 'xnor': {
      const n = Math.max(2, Math.min(5, comp.attrs.inputs ?? 2));
      let acc = comp.kind === 'and' || comp.kind === 'nand' ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const v = read(`in${i}`) & 1;
        if (comp.kind === 'and' || comp.kind === 'nand') acc &= v;
        else if (comp.kind === 'or' || comp.kind === 'nor') acc |= v;
        else acc ^= v;
      }
      if (comp.kind === 'nand' || comp.kind === 'nor' || comp.kind === 'xnor') acc = acc ? 0 : 1;
      write('out', acc);
      break;
    }
    case 'dff': {
      const q = dffQ(comp.id) & 1;
      write('q', q);
      write('qn', q ? 0 : 1);
      break;
    }
    case 'mux': {
      const n = 1 << Math.max(1, Math.min(4, comp.attrs.fans ?? 1));
      const sel = read('sel');
      let v = 0;
      if (sel >= 0 && sel < n) v = read(`d${sel}`);
      write('out', v & maskFor(bits));
      break;
    }
    case 'split': {
      const fans = Math.max(2, Math.min(12, comp.attrs.fans ?? 2));
      const bus = read('bus');
      const fanBits = Math.max(1, Math.floor(bits / fans));
      for (let i = 0; i < fans; i++) {
        write(`f${i}`, (bus >>> (i * fanBits)) & maskFor(fanBits));
      }
      break;
    }
    case 'merge': {
      const fans = Math.max(2, Math.min(12, comp.attrs.fans ?? 2));
      const fanBits = Math.max(1, Math.floor(bits / fans));
      let bus = 0;
      for (let i = 0; i < fans; i++) {
        const v = read(`f${i}`) & maskFor(fanBits);
        bus = (bus | (v << (i * fanBits))) >>> 0;
      }
      write('bus', bus & maskFor(bits));
      break;
    }
  }
}

export interface SimValue {
  value: number;
  width: number;
  high: boolean;
}

export class Simulator {
  private doc: Doc | null = null;
  private netlist: Netlist | null = null;
  private values = new Uint32Array(0);
  private scratch = new Uint32Array(0);
  private pinValues = new Map<string, number>();
  private heldButtons = new Set<string>();
  private dffState = new Map<string, { q: number; prevClk: number; init: boolean }>();
  private clockState = new Map<string, { value: number; nextAt: number }>();
  private running = false;
  private dirty = true;
  private evalCount = 0;
  tick = 0;

  update(doc: Doc) {
    if (doc === this.doc && this.netlist) return;
    this.doc = doc;
    this.netlist = buildNetlist(doc);
    this.values = new Uint32Array(this.netlist.nets.length);
    this.scratch = new Uint32Array(this.netlist.nets.length);
    this.dirty = true;
    this.evalCount = 0;
    const present = new Set(doc.comps.map((c) => c.id));
    for (const id of this.pinValues.keys()) if (!present.has(id)) this.pinValues.delete(id);
    for (const id of this.heldButtons) if (!present.has(id)) this.heldButtons.delete(id);
  }

  private dff(id: string) {
    let st = this.dffState.get(id);
    if (!st) {
      st = { q: 0, prevClk: 0, init: false };
      this.dffState.set(id, st);
    }
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

  private evalOnce(useScratch: boolean): boolean {
    const nl = this.netlist;
    if (!nl) return false;
    const prev = this.values;
    const next = useScratch ? this.scratch : this.values;
    next.fill(0);
    const portNet = (compId: string, port: string) => nl.portNet.get(`${compId}:${port}`) ?? -1;
    const read = (compId: string) => (port: string) => {
      const n = portNet(compId, port);
      return n < 0 ? 0 : prev[n] >>> 0;
    };
    const write = (compId: string) => (port: string, val: number) => {
      const n = portNet(compId, port);
      if (n < 0) return;
      const w = nl.nets[n].width;
      next[n] = (next[n] | (val & maskFor(w))) >>> 0;
    };
    const comps = this.doc?.comps ?? [];
    for (const comp of comps) {
      evalComponent(
        comp,
        read(comp.id),
        write(comp.id),
        this.pinValues,
        this.heldButtons,
        (id) => {
          const st = this.clockState.get(id);
          return st?.value ?? 0;
        },
        (id) => {
          const st = this.dffState.get(id);
          return st?.q ?? 0;
        },
      );
    }
    for (const comp of comps) {
      if (comp.kind !== 'dff') continue;
      const st = this.dff(comp.id);
      const qn = portNet(comp.id, 'q');
      const q = qn >= 0 ? next[qn] >>> 0 : 0;
      st.q = q & 1;
    }
    if (useScratch) {
      let changed = false;
      for (let i = 0; i < next.length; i++) {
        if (next[i] !== prev[i]) {
          changed = true;
          break;
        }
      }
      const tmp = this.values;
      this.values = this.scratch;
      this.scratch = tmp;
      return changed;
    }
    return true;
  }

  private compute(): boolean {
    const nl = this.netlist;
    if (!nl) return false;
    let changed = false;
    // Relax combinational logic to a fixed point.
    for (let i = 0; i < 24; i++) {
      const ch = this.evalOnce(true);
      if (ch) changed = true;
      else break;
    }

    // Clocked elements see the stable combinational values and capture on edges.
    let edgeChanged = false;
    const comps = this.doc?.comps ?? [];
    for (const comp of comps) {
      if (comp.kind !== 'dff') continue;
      const clkNet = nl.portNet.get(`${comp.id}:clk`);
      const dNet = nl.portNet.get(`${comp.id}:d`);
      if (clkNet === undefined || dNet === undefined) continue;
      const st = this.dff(comp.id);
      const clk = this.values[clkNet] & 1;
      const d = this.values[dNet] & 1;
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
    }
    if (edgeChanged) {
      for (let i = 0; i < 24; i++) {
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

  /** Advance clocks and re-evaluate. Call every animation frame. */
  frame(now: number, running: boolean): boolean {
    const nl = this.netlist;
    if (!nl) return false;
    if (!running) {
      this.running = false;
    } else {
      if (!this.running) {
        for (const comp of this.doc?.comps ?? []) {
          if (comp.kind !== 'clock') continue;
          const st = this.clock(comp.id, now);
          st.nextAt = now + 500 / Math.max(0.2, comp.attrs.freq ?? 2);
        }
        this.running = true;
      }
      let clockChanged = false;
      for (const comp of this.doc?.comps ?? []) {
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
    const bits = Math.max(1, Math.min(32, comp.attrs.bits ?? 1));
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

  reset() {
    for (const st of this.dffState.values()) {
      st.q = 0;
      st.init = false;
    }
    for (const st of this.clockState.values()) st.value = 0;
    this.heldButtons.clear();
    this.tick++;
    this.dirty = true;
    this.compute();
  }

  ensure(doc: Doc) {
    this.update(doc);
    if (this.dirty) this.compute();
  }

  netlistOrNull() {
    return this.netlist;
  }

  valueOfNet(netId: number): SimValue {
    const nl = this.netlist;
    if (!nl || netId < 0 || netId >= nl.nets.length) return { value: 0, width: 1, high: false };
    return {
      value: this.values[netId] ?? 0,
      width: nl.nets[netId].width,
      high: (this.values[netId] ?? 0) !== 0,
    };
  }

  valueOfWire(wireIndex: number): SimValue {
    const nl = this.netlist;
    if (!nl) return { value: 0, width: 1, high: false };
    return this.valueOfNet(nl.wireNet[wireIndex]);
  }

  valueOfPort(compId: string, port: string): SimValue {
    const nl = this.netlist;
    if (!nl) return { value: 0, width: 1, high: false };
    const n = nl.portNet.get(`${compId}:${port}`);
    return this.valueOfNet(n ?? -1);
  }

  netOfPort(compId: string, port: string): number {
    return this.netlist?.portNet.get(`${compId}:${port}`) ?? -1;
  }

  get runningState() {
    return this.running;
  }
}

export const sim = new Simulator();
