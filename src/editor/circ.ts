import type { CompKind, ComponentInstance, Doc, Facing, Point } from '../model/types';
import { createComp, uid } from '../model/specs';
import { contentBounds, portsOf } from '../model/geometry';
import { computeSubLayout } from '../model/hierarchy';
import { emptyDoc } from '../model/types';
import { itemCount, tr, type Lang } from '../i18n';

function num(v: string | null | undefined, fallback: number): number {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseBool(v: string | null | undefined, fallback = false): boolean {
  if (v == null) return fallback;
  return v === 'true' || v === '1';
}

function parseLoc(v: string | null | undefined): Point {
  if (!v) return { x: 0, y: 0 };
  const m = v.match(/\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?/);
  if (!m) return { x: 0, y: 0 };
  return { x: Math.round(Number(m[1])), y: Math.round(Number(m[2])) };
}

function parseFacing(v: string | null | undefined): Facing {
  return v === 'west' || v === 'north' || v === 'south' || v === 'east' ? v : 'east';
}

function attr(el: Element, name: string): string | null {
  for (const child of Array.from(el.children)) {
    if (child.tagName === 'a' && child.getAttribute('name') === name) {
      const val = child.getAttribute('val');
      if (val !== null) return val;
      const text = child.textContent;
      return text === null ? null : text.replace(/^\s+|\s+$/g, '');
    }
  }
  return null;
}

export interface LogisimMemoryImage {
  addrBits: number;
  dataBits: number;
  memory: number[];
}

/** Parse Logisim's ROM `contents` attribute (v2.0 raw hex words). */
export function parseRomContents(
  text: string,
  fallbackAddrBits = 4,
  fallbackDataBits = 8,
): LogisimMemoryImage | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lines = trimmed.split(/\r?\n/);
  let addrBits = fallbackAddrBits;
  let dataBits = fallbackDataBits;
  let bodyStart = 0;
  const header = lines[0]?.match(/^addr\/data:\s*(\d+)\s+(\d+)/i);
  if (header) {
    addrBits = Math.max(1, Math.min(20, Number(header[1])));
    dataBits = Math.max(1, Math.min(32, Number(header[2])));
    bodyStart = 1;
  }
  const body = lines
    .slice(bodyStart)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .join(' ');
  if (!body) return { addrBits, dataBits, memory: [] };
  const size = Math.min(1 << addrBits, 1 << 20);
  const memory = new Array<number>(size).fill(0);
  let cursor = 0;
  const mask = (2 ** Math.min(32, dataBits) - 1) >>> 0;
  for (const token of body.split(/\s+/)) {
    const match = token.match(/^(\d+)\*([0-9a-fx]+)$/i);
    const count = match ? Math.max(1, Number(match[1])) : 1;
    const raw = (match ? match[2] : token).replace(/^0x/i, '');
    const value = parseInt(raw, 16);
    if (!Number.isFinite(value)) continue;
    for (let i = 0; i < count && cursor < size; i++) {
      memory[cursor++] = value & mask;
    }
    if (cursor >= size) break;
  }
  return { addrBits, dataBits, memory };
}

/** Write Logisim's ROM contents value (v2.0 raw, run-length encoded). */
export function formatRomContents(memory: number[], addrBits: number, dataBits: number): string {
  const size = Math.min(1 << Math.max(1, Math.min(20, addrBits)), 1 << 20);
  const values = Array.from({ length: size }, (_, i) => (memory[i] ?? 0) >>> 0);
  let end = values.length - 1;
  while (end >= 0 && values[end] === 0) end--;
  if (end < 0) return '';
  const tokens: string[] = [];
  let i = 0;
  while (i <= end) {
    const value = values[i];
    let j = i + 1;
    while (j <= end && values[j] === value) j++;
    const count = j - i;
    const hex = value.toString(16);
    tokens.push(count > 1 ? `${count}*${hex}` : hex);
    i = j;
  }
  const lines: string[] = [];
  for (let i = 0; i < tokens.length; i += 8) lines.push(tokens.slice(i, i + 8).join(' '));
  return `addr/data: ${addrBits} ${dataBits}\n${lines.join('\n')}\n`;
}

export interface CircImportResult {
  doc: Doc;
  circuits: Record<string, Doc>;
  mainName: string;
  warnings: string[];
  supported: number;
  skipped: number;
}

function healDocWires(doc: Doc, lang: Lang): string | null {
  const wires = doc.wires;
  let healed = 0;
  const allPorts: { point: Point }[] = [];
  for (const c of doc.comps) for (const p of portsOf(c)) allPorts.push({ point: p.world });
  const extra: { id: string; a: Point; b: Point }[] = [];
  const isPortPoint = (p: Point) =>
    allPorts.some((q) => Math.abs(q.point.x - p.x) < 0.1 && Math.abs(q.point.y - p.y) < 0.1);
  for (const w of wires) {
    for (const key of ['a', 'b'] as const) {
      const p = w[key];
      if (isPortPoint(p)) continue;
      let best: Point | null = null;
      let bestD = 12;
      for (const q of allPorts) {
        const d = Math.hypot(q.point.x - p.x, q.point.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = q.point;
        }
      }
      if (best && bestD > 0.1) {
        const bx = best.x;
        const by = best.y;
        if (p.x === bx || p.y === by) {
          extra.push({ id: uid('w'), a: { ...p }, b: { x: bx, y: by } });
        } else {
          extra.push({ id: uid('w'), a: { ...p }, b: { x: bx, y: p.y } });
          extra.push({ id: uid('w'), a: { x: bx, y: p.y }, b: { x: bx, y: by } });
        }
        healed++;
      }
    }
  }
  doc.wires = [...wires, ...extra];
  return healed ? tr(lang, 'file.circHealed', { items: itemCount(lang, healed, '处连线端点', 'wire endpoint') }) : null;
}

export function importCirc(
  xmlText: string,
  fallbackName?: string,
  lang: Lang = 'zh',
): CircImportResult {
  const importedFallback = fallbackName || tr(lang, 'file.importedFallback');
  const warnings: string[] = [];
  const parser = new DOMParser();
  const dom = parser.parseFromString(xmlText, 'application/xml');
  if (dom.querySelector('parsererror')) {
    throw new Error(tr(lang, 'file.circParse'));
  }
  const mainName = dom.querySelector('project > main')?.getAttribute('name') ?? '';
  const circuitEls = Array.from(dom.querySelectorAll('circuit'));
  if (!circuitEls.length) throw new Error(tr(lang, 'file.circNoCircuit'));
  const circuitNames = new Set(
    circuitEls.map((c) => c.getAttribute('name') ?? '').filter(Boolean),
  );
  const docs: Record<string, Doc> = {};
  const skippedKinds = new Map<string, number>();
  const negateWarnings = new Set<string>();
  let supported = 0;
  let skipped = 0;

  for (const circuitEl of circuitEls) {
    const circuitName = circuitEl.getAttribute('name') || importedFallback;
    const doc = emptyDoc(circuitName === 'main' && fallbackName ? fallbackName : circuitName);

    for (const el of Array.from(circuitEl.children)) {
      if (el.tagName !== 'comp') continue;
      const name = el.getAttribute('name') ?? '';
      const loc = parseLoc(el.getAttribute('loc'));
      const facing = parseFacing(attr(el, 'facing'));
      const label = attr(el, 'label') ?? undefined;
      let comp: ComponentInstance | null = null;

      if (circuitNames.has(name)) {
        comp = createComp('sub', loc, facing);
        comp.attrs.circuit = name;
        comp.attrs.circuitName = name;
        comp.attrs.label = label ?? '';
        comp.attrs.subPins = [];
      } else if (name === 'Pin') {
        const output = parseBool(attr(el, 'output'));
        const bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 1)));
        comp = createComp(output ? 'output' : 'input', loc, facing);
        comp.attrs.bits = bits;
        comp.attrs.label = label ?? '';
      } else if (name === 'Probe') {
        comp = createComp('probe', loc, facing);
        comp.attrs.bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 1)));
        comp.attrs.label = label ?? '';
      } else if (name === 'LED') {
        comp = createComp('led', loc, 'east');
        comp.attrs.label = label ?? '';
      } else if (name === 'Button') {
        comp = createComp('button', loc, facing);
        comp.attrs.label = label ?? '';
      } else if (name === 'Clock') {
        comp = createComp('clock', loc, facing);
        comp.attrs.label = label ?? '';
        const high = num(attr(el, 'highDuration'), 0);
        const low = num(attr(el, 'lowDuration'), 0);
        const freqAttr = num(attr(el, 'frequency'), 0);
        if (freqAttr > 0) comp.attrs.freq = Math.min(20, Math.max(0.5, freqAttr));
        else if (high > 0 || low > 0) {
          const total = Math.max(1, high + low);
          comp.attrs.freq = Math.min(20, Math.max(0.5, Math.round((1000 / total) * 10) / 10));
        }
      } else if (name === 'Constant') {
        const v = attr(el, 'value') ?? '0';
        let value = 0;
        try {
          value = v.startsWith('0x') || v.startsWith('0X') ? parseInt(v.slice(2), 16) : parseInt(v, 10);
        } catch {
          value = 0;
        }
        comp = createComp('constant', loc, facing);
        comp.attrs.bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 8)));
        comp.attrs.value = Number.isFinite(value) ? value >>> 0 : 0;
        comp.attrs.label = label ?? '';
      } else if (name === 'Power' || name === 'Ground') {
        comp = createComp(name === 'Power' ? 'power' : 'ground', loc, facing);
        comp.attrs.label = label ?? '';
      } else if (name === 'Pull Resistor') {
        comp = createComp('pull', loc, facing);
        comp.attrs.label = label ?? '';
        comp.attrs.pull = parseBool(attr(el, 'pull')) ? 1 : 0;
      } else if (name === 'Bit Extender') {
        comp = createComp('extend', loc, facing);
        comp.attrs.label = label ?? '';
        comp.attrs.inBits = Math.max(1, Math.min(32, num(attr(el, 'inWidth') ?? attr(el, 'in_width'), 4)));
        comp.attrs.outBits = Math.max(1, Math.min(32, num(attr(el, 'outWidth') ?? attr(el, 'out_width'), 8)));
        comp.attrs.sign = (attr(el, 'type') ?? '').toLowerCase().includes('sign') || parseBool(attr(el, 'sign'));
      } else if (name === 'Tunnel') {
        comp = createComp('tunnel', loc, facing);
        comp.attrs.label = label ?? 'net';
      } else if (name === 'Text') {
        comp = createComp('text', { x: loc.x, y: loc.y }, 'east');
        comp.attrs.text = attr(el, 'text') ?? '';
      } else if (name === 'D Flip-Flop') {
        comp = createComp('dff', loc, facing);
        const trig = attr(el, 'trigger') ?? 'rising';
        comp.attrs.trigger = trig === 'falling' || trig === 'low' ? 'falling' : 'rising';
        comp.attrs.label = label ?? '';
      } else if (name === 'T Flip-Flop' || name === 'J-K Flip-Flop') {
        comp = createComp(name === 'T Flip-Flop' ? 'tff' : 'jkff', loc, facing);
        const trig = attr(el, 'trigger') ?? 'rising';
        comp.attrs.trigger = trig === 'falling' || trig === 'low' ? 'falling' : 'rising';
        comp.attrs.label = label ?? '';
      } else if (name === 'S-R Latch') {
        comp = createComp('sr', loc, facing);
        comp.attrs.label = label ?? '';
      } else if (name === 'Shift Register') {
        comp = createComp('shift', loc, facing);
        comp.attrs.bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 8)));
        comp.attrs.trigger = (attr(el, 'trigger') ?? 'rising') === 'falling' ? 'falling' : 'rising';
        comp.attrs.enable = attr(el, 'enable') !== 'false';
        comp.attrs.reset = attr(el, 'reset') !== 'false';
        comp.attrs.label = label ?? '';
      } else if (name === 'Register') {
        comp = createComp('register', loc, facing);
        comp.attrs.bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 8)));
        comp.attrs.trigger = (attr(el, 'trigger') ?? 'rising') === 'falling' ? 'falling' : 'rising';
        comp.attrs.enable = attr(el, 'enable') !== 'false';
        comp.attrs.label = label ?? '';
      } else if (name === 'Counter') {
        comp = createComp('counter', loc, facing);
        comp.attrs.bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 8)));
        comp.attrs.trigger = (attr(el, 'trigger') ?? 'rising') === 'falling' ? 'falling' : 'rising';
        comp.attrs.count = (attr(el, 'direction') ?? 'up') === 'down' ? 'down' : 'up';
        comp.attrs.label = label ?? '';
      } else if (name === 'RAM' || name === 'ROM') {
        comp = createComp(name === 'RAM' ? 'ram' : 'rom', loc, facing);
        comp.attrs.addrBits = Math.max(1, Math.min(20, num(attr(el, 'addrBits'), 4)));
        comp.attrs.dataBits = Math.max(1, Math.min(32, num(attr(el, 'dataBits'), 8)));
        comp.attrs.label = label ?? '';
        comp.attrs.memory = [];
        if (name === 'ROM') {
          const contents = attr(el, 'contents');
          const parsed = contents
            ? parseRomContents(contents, comp.attrs.addrBits, comp.attrs.dataBits)
            : null;
          if (parsed) {
            comp.attrs.addrBits = parsed.addrBits;
            comp.attrs.dataBits = parsed.dataBits;
            comp.attrs.memory = parsed.memory;
          }
        }
      } else if (name === 'Multiplexer') {
        const sel = Math.max(1, Math.min(4, num(attr(el, 'select'), 1)));
        comp = createComp('mux', loc, facing);
        comp.attrs.fans = sel;
        comp.attrs.bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 1)));
        comp.attrs.label = label ?? '';
        if (attr(el, 'selloc') === 'tr') warnings.push(tr(lang, 'file.circSelectLoc'));
      } else if (name === 'Decoder') {
        comp = createComp('decoder', loc, facing);
        comp.attrs.fans = Math.max(1, Math.min(4, num(attr(el, 'select'), 1)));
        comp.attrs.enable = parseBool(attr(el, 'enable'));
        comp.attrs.label = label ?? '';
      } else if (name === 'Demultiplexer') {
        comp = createComp('demux', loc, facing);
        comp.attrs.fans = Math.max(1, Math.min(4, num(attr(el, 'select'), 1)));
        comp.attrs.bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 1)));
        comp.attrs.label = label ?? '';
      } else if (name === 'Priority Encoder') {
        comp = createComp('priority', loc, facing);
        comp.attrs.fans = Math.max(1, Math.min(4, num(attr(el, 'select'), 2)));
        comp.attrs.label = label ?? '';
      } else if (name === 'Bit Selector') {
        comp = createComp('bitSelect', loc, facing);
        comp.attrs.fans = Math.max(1, Math.min(5, num(attr(el, 'select'), 2)));
        comp.attrs.bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 8)));
        comp.attrs.label = label ?? '';
      } else if (name === 'Adder' || name === 'Subtractor' || name === 'Multiplier' || name === 'Comparator') {
        const kind = name === 'Adder' ? 'adder' : name === 'Subtractor' ? 'subtractor' : name === 'Multiplier' ? 'multiplier' : 'comparator';
        comp = createComp(kind, loc, facing);
        comp.attrs.bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 8)));
        comp.attrs.label = label ?? '';
      } else if (name === 'Divider' || name === 'Negator' || name === 'Bit Adder') {
        const kind = name === 'Divider' ? 'divider' : name === 'Negator' ? 'negator' : 'bitAdder';
        comp = createComp(kind, loc, facing);
        comp.attrs.bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 8)));
        comp.attrs.label = label ?? '';
      } else if (name === 'Shifter') {
        comp = createComp('shifter', loc, facing);
        comp.attrs.bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 8)));
        const dir = attr(el, 'direction') ?? 'left';
        comp.attrs.shift = dir === 'right' ? (parseBool(attr(el, 'arithmetic')) ? 'arithmetic' : 'right') : 'left';
        comp.attrs.label = label ?? '';
      } else if (name === 'Seven-Segment Display') {
        comp = createComp('sevenseg', loc, facing);
        comp.attrs.label = label ?? '';
      } else if (name === 'Buffer Gate' || name === 'Odd Parity' || name === 'Even Parity') {
        const kind = name === 'Buffer Gate' ? 'buffer' : name === 'Odd Parity' ? 'odd' : 'even';
        comp = createComp(kind, loc, facing);
        comp.attrs.inputs = Math.max(2, Math.min(5, num(attr(el, 'inputs'), 2)));
        comp.attrs.bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 1)));
        comp.attrs.size = [30, 50, 70].includes(num(attr(el, 'size'), 50)) ? num(attr(el, 'size'), 50) : 50;
        comp.attrs.label = label ?? '';
      } else if (name === 'Controlled Buffer' || name === 'Controlled Inverter') {
        comp = createComp(name === 'Controlled Buffer' ? 'ctrlBuffer' : 'ctrlInverter', loc, facing);
        comp.attrs.bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 1)));
        comp.attrs.label = label ?? '';
      } else if (name.endsWith(' Gate')) {
        const gateName = name.replace(' Gate', '').toLowerCase();
        const map: Record<string, CompKind> = {
          not: 'not',
          and: 'and',
          or: 'or',
          nand: 'nand',
          nor: 'nor',
          xor: 'xor',
          xnor: 'xnor',
        };
        const gk = map[gateName];
        if (gk) {
          comp = createComp(gk, loc, facing);
          comp.attrs.inputs = Math.max(2, Math.min(5, num(attr(el, 'inputs'), 2)));
          comp.attrs.bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 1)));
          comp.attrs.size = [30, 50, 70].includes(num(attr(el, 'size'), 50)) ? num(attr(el, 'size'), 50) : 50;
          comp.attrs.label = label ?? '';
          for (let i = 0; i < 8; i++) {
            if (parseBool(attr(el, `negate${i}`))) negateWarnings.add('negate');
          }
        }
      }

      if (comp) {
        doc.comps.push(comp);
        supported++;
      } else {
        skippedKinds.set(name, (skippedKinds.get(name) ?? 0) + 1);
        skipped++;
      }
    }

    for (const el of Array.from(circuitEl.children)) {
      if (el.tagName !== 'wire') continue;
      const a = parseLoc(el.getAttribute('from'));
      const b = parseLoc(el.getAttribute('to'));
      if (a.x === b.x && a.y === b.y) continue;
      doc.wires.push({ id: uid('w'), a, b });
    }
    docs[circuitName] = doc;
  }

  // Attach subcircuit pin layouts, then heal imported wire endpoints.
  for (const doc of Object.values(docs)) {
    for (const comp of doc.comps) {
      if (comp.kind !== 'sub' || !comp.attrs.circuit) continue;
      const target = docs[comp.attrs.circuit];
      if (!target) continue;
      const layout = computeSubLayout(target);
      comp.attrs.subPins = layout.subPins;
      comp.attrs.subW = layout.subW;
      comp.attrs.subH = layout.subH;
    }
  }
  for (const [name, doc] of Object.entries(docs)) {
    const healed = healDocWires(doc, lang);
    if (healed) warnings.push(`${name}: ${healed}`);
  }

  const mainKey = docs[mainName]
    ? mainName
    : docs['main']
      ? 'main'
      : (circuitEls[0].getAttribute('name') || Object.keys(docs)[0]);
  const main = docs[mainKey];
  if (skippedKinds.size) {
    const names = Array.from(skippedKinds.entries())
      .map(([n, k]) => `${n} ×${k}`)
      .join('、');
    warnings.push(tr(lang, 'file.circSkipped', { names }));
  }
  if (negateWarnings.size) warnings.push(tr(lang, 'file.circNegated'));
  if (!main.comps.length && !main.wires.length) warnings.push(tr(lang, 'file.circNoComps'));
  if (Object.keys(docs).length > 1) {
    warnings.push(tr(lang, 'file.circAllCircuits', { n: Object.keys(docs).length }));
  }
  return {
    doc: main,
    circuits: docs,
    mainName: mainKey,
    warnings,
    supported,
    skipped,
  };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attrsXml(pairs: [string, string | number | boolean | null | undefined][]): string {
  const filtered = pairs.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!filtered.length) return '';
  return '\n' + filtered
    .map(([k, v]) => {
      const value = String(v);
      // XML normalizes literal newlines in attribute values, so multi-line
      // attributes (notably ROM contents) must be written as element text.
      return value.includes('\n')
        ? `      <a name="${esc(k)}">${esc(value)}</a>`
        : `      <a name="${esc(k)}" val="${esc(value)}"/>`;
    })
    .join('\n');
}

export interface CircExportResult {
  xml: string;
  skipped: string[];
}

const LIB: Record<CompKind, string> = {
  input: '0', output: '0', probe: '0', power: '0', ground: '0', pull: '0', extend: '0',
  clock: '0', constant: '0', tunnel: '0', split: '0', merge: '0',
  not: '1', and: '1', or: '1', nand: '1', nor: '1', xor: '1', xnor: '1', buffer: '1', odd: '1', even: '1',
  ctrlBuffer: '1', ctrlInverter: '1',
  mux: '2', decoder: '2', demux: '2', priority: '2', bitSelect: '2',
  adder: '3', subtractor: '3', multiplier: '3', divider: '3', negator: '3', bitAdder: '3', comparator: '3', shifter: '3',
  dff: '4', tff: '4', jkff: '4', sr: '4', shift: '4', register: '4', counter: '4', ram: '4', rom: '4',
  led: '5', button: '5', sevenseg: '5',
  text: '6', sub: '-',
};

function compToXml(c: ComponentInstance, circuits: Record<string, Doc>): { xml: string; lib: string } | null {
  const facingAttr = c.facing !== 'east' ? c.facing : null;
  const label = c.attrs.label ?? '';
  const attrs: [string, string | number | boolean | null | undefined][] = [];
  let name = '';
  let lib = LIB[c.kind];

  if (c.kind === 'sub') {
    const target = circuits[c.attrs.circuit ?? ''];
    const targetName = target?.name || c.attrs.circuitName || c.attrs.circuit || 'sub';
    attrs.push(['facing', facingAttr], ['label', label]);
    return {
      lib: '-',
      xml: `    <comp loc="(${Math.round(c.at.x)},${Math.round(c.at.y)})" name="${esc(targetName)}">${attrsXml(attrs)}</comp>`,
    };
  }

  switch (c.kind) {
    case 'input':
    case 'output':
      name = 'Pin';
      attrs.push(['facing', facingAttr], ['output', c.kind === 'output' ? 'true' : 'false']);
      if ((c.attrs.bits ?? 1) > 1) attrs.push(['width', c.attrs.bits ?? 1]);
      attrs.push(['label', label], ['labelloc', 'north']);
      break;
    case 'probe':
      name = 'Probe';
      if ((c.attrs.bits ?? 1) > 1) attrs.push(['width', c.attrs.bits ?? 1]);
      attrs.push(['facing', facingAttr], ['label', label]);
      break;
    case 'power':
      name = 'Power';
      attrs.push(['facing', facingAttr], ['label', label]);
      break;
    case 'ground':
      name = 'Ground';
      attrs.push(['facing', facingAttr], ['label', label]);
      break;
    case 'pull':
      name = 'Pull Resistor';
      attrs.push(['facing', facingAttr], ['pull', (c.attrs.pull ?? 0) === 1 ? 'true' : 'false'], ['label', label]);
      break;
    case 'extend':
      name = 'Bit Extender';
      attrs.push(
        ['facing', facingAttr],
        ['inWidth', c.attrs.inBits ?? 4],
        ['outWidth', c.attrs.outBits ?? 8],
        ['type', c.attrs.sign ? 'sign' : 'zero'],
        ['label', label],
      );
      break;
    case 'led':
      name = 'LED';
      attrs.push(['facing', 'east'], ['label', label], ['labelloc', 'north']);
      break;
    case 'button':
      name = 'Button';
      attrs.push(['facing', facingAttr], ['label', label]);
      break;
    case 'clock':
      name = 'Clock';
      attrs.push(['facing', facingAttr], ['label', label]);
      {
        const half = Math.max(1, Math.round(500 / Math.max(0.2, c.attrs.freq ?? 2)));
        attrs.push(['highDuration', half], ['lowDuration', half]);
      }
      break;
    case 'constant':
      name = 'Constant';
      attrs.push(['facing', facingAttr], ['width', c.attrs.bits ?? 8], [
        'value',
        '0x' + ((c.attrs.value ?? 0) >>> 0).toString(16).toUpperCase().padStart(2, '0'),
      ]);
      attrs.push(['label', label]);
      break;
    case 'tunnel':
      name = 'Tunnel';
      attrs.push(['facing', facingAttr], ['label', c.attrs.label ?? 'net']);
      break;
    case 'text':
      attrs.push(['text', c.attrs.text ?? ''], ['font', 'SansSerif plain 12'], ['halign', 'center'], ['valign', 'base']);
      name = 'Text';
      break;
    case 'dff':
      name = 'D Flip-Flop';
      attrs.push(['facing', facingAttr], ['trigger', c.attrs.trigger ?? 'rising'], ['label', label]);
      break;
    case 'tff':
    case 'jkff':
      name = c.kind === 'tff' ? 'T Flip-Flop' : 'J-K Flip-Flop';
      attrs.push(['facing', facingAttr], ['trigger', c.attrs.trigger ?? 'rising'], ['label', label]);
      break;
    case 'sr':
      name = 'S-R Latch';
      attrs.push(['facing', facingAttr], ['label', label]);
      break;
    case 'shift':
      name = 'Shift Register';
      attrs.push(
        ['facing', facingAttr],
        ['width', c.attrs.bits ?? 8],
        ['trigger', c.attrs.trigger ?? 'rising'],
        ['enable', c.attrs.enable !== false ? 'true' : 'false'],
        ['reset', c.attrs.reset !== false ? 'true' : 'false'],
        ['label', label],
      );
      break;
    case 'register':
      name = 'Register';
      attrs.push(['facing', facingAttr], ['width', c.attrs.bits ?? 8], ['trigger', c.attrs.trigger ?? 'rising']);
      attrs.push(['enable', c.attrs.enable !== false ? 'true' : 'false'], ['label', label]);
      break;
    case 'counter':
      name = 'Counter';
      attrs.push(['facing', facingAttr], ['width', c.attrs.bits ?? 8], ['trigger', c.attrs.trigger ?? 'rising']);
      attrs.push(['direction', c.attrs.count ?? 'up'], ['label', label]);
      break;
    case 'ram':
    case 'rom':
      name = c.kind === 'ram' ? 'RAM' : 'ROM';
      attrs.push(['facing', facingAttr], ['addrBits', c.attrs.addrBits ?? 4], ['dataBits', c.attrs.dataBits ?? 8]);
      attrs.push(['label', label]);
      if (c.kind === 'rom' && c.attrs.memory?.some((value) => value !== 0)) {
        attrs.push([
          'contents',
          formatRomContents(c.attrs.memory, c.attrs.addrBits ?? 4, c.attrs.dataBits ?? 8),
        ]);
      }
      break;
    case 'mux':
      name = 'Multiplexer';
      attrs.push(['facing', facingAttr], ['select', c.attrs.fans ?? 1], ['width', c.attrs.bits ?? 1], ['label', label]);
      break;
    case 'decoder':
      name = 'Decoder';
      attrs.push(['facing', facingAttr], ['select', c.attrs.fans ?? 1], ['enable', c.attrs.enable ? 'true' : 'false'], ['label', label]);
      break;
    case 'demux':
      name = 'Demultiplexer';
      attrs.push(['facing', facingAttr], ['select', c.attrs.fans ?? 1], ['width', c.attrs.bits ?? 1], ['label', label]);
      break;
    case 'priority':
      name = 'Priority Encoder';
      attrs.push(['facing', facingAttr], ['select', c.attrs.fans ?? 2], ['label', label]);
      break;
    case 'bitSelect':
      name = 'Bit Selector';
      attrs.push(['facing', facingAttr], ['select', c.attrs.fans ?? 2], ['width', c.attrs.bits ?? 8], ['label', label]);
      break;
    case 'adder':
    case 'subtractor':
    case 'multiplier':
    case 'divider':
    case 'negator':
    case 'bitAdder':
    case 'comparator':
      name = c.kind === 'adder' ? 'Adder' : c.kind === 'subtractor' ? 'Subtractor' : c.kind === 'multiplier' ? 'Multiplier' : c.kind === 'divider' ? 'Divider' : c.kind === 'negator' ? 'Negator' : c.kind === 'bitAdder' ? 'Bit Adder' : 'Comparator';
      attrs.push(['facing', facingAttr], ['width', c.attrs.bits ?? 8], ['label', label]);
      break;
    case 'shifter':
      name = 'Shifter';
      attrs.push(['facing', facingAttr], ['width', c.attrs.bits ?? 8]);
      attrs.push(['direction', c.attrs.shift === 'left' ? 'left' : 'right']);
      attrs.push(['arithmetic', c.attrs.shift === 'arithmetic' ? 'true' : 'false'], ['label', label]);
      break;
    case 'sevenseg':
      name = 'Seven-Segment Display';
      attrs.push(['facing', facingAttr], ['label', label]);
      break;
    case 'buffer':
      name = 'Buffer Gate';
      attrs.push(['facing', facingAttr], ['width', c.attrs.bits ?? 1], ['label', label]);
      break;
    case 'odd':
    case 'even':
      name = c.kind === 'odd' ? 'Odd Parity' : 'Even Parity';
      attrs.push(['facing', facingAttr], ['inputs', c.attrs.inputs ?? 2], ['width', c.attrs.bits ?? 1], ['label', label]);
      break;
    case 'ctrlBuffer':
    case 'ctrlInverter':
      name = c.kind === 'ctrlBuffer' ? 'Controlled Buffer' : 'Controlled Inverter';
      attrs.push(['facing', facingAttr], ['width', c.attrs.bits ?? 1], ['label', label]);
      break;
    case 'not':
    case 'and':
    case 'or':
    case 'nand':
    case 'nor':
    case 'xor':
    case 'xnor':
      name = c.kind === 'not' ? 'NOT Gate' : `${c.kind.toUpperCase()} Gate`;
      if (c.kind !== 'not') attrs.push(['inputs', c.attrs.inputs ?? 2]);
      if ((c.attrs.bits ?? 1) > 1) attrs.push(['width', c.attrs.bits ?? 1]);
      if (c.kind !== 'not' && (c.attrs.size ?? 50) !== 50) attrs.push(['size', c.attrs.size ?? 50]);
      attrs.push(['facing', facingAttr], ['label', label]);
      break;
    case 'split':
    case 'merge':
      return null;
  }
  return {
    lib,
    xml: `    <comp lib="${lib}" loc="(${Math.round(c.at.x)},${Math.round(c.at.y)})" name="${esc(name)}">${attrsXml(
      attrs,
    )}${attrs.length ? '\n    ' : ''}</comp>`,
  };
}

export function exportCirc(
  doc: Doc,
  circuits?: Record<string, Doc>,
  currentId?: string,
): CircExportResult {
  const skipped = new Set<string>();
  const libUsed = new Set<string>();
  const all: { doc: Doc; id?: string }[] = [{ doc, id: currentId }];
  if (circuits) {
    for (const [id, d] of Object.entries(circuits)) {
      if (id === currentId) continue;
      all.push({ doc: d, id });
    }
  }
  const byName: Record<string, Doc> = {};
  for (const entry of all) byName[entry.doc.name] = entry.doc;
  const byId: Record<string, Doc> = {};
  for (const entry of all) if (entry.id) byId[entry.id] = entry.doc;
  const circuitName = (idOrName: string) => byId[idOrName]?.name ?? idOrName;

  const circuitsXml: string[] = [];
  for (const entry of all) {
    const d = entry.doc;
    const b = contentBounds(d);
    const dx = b && b.x < 100 ? Math.ceil((100 - b.x) / 10) * 10 : 0;
    const dy = b && b.y < 100 ? Math.ceil((100 - b.y) / 10) * 10 : 0;
    const parts: string[] = [];
    for (const c of d.comps) {
      const shifted: ComponentInstance = { ...c, at: { x: c.at.x + dx, y: c.at.y + dy } };
      const subCircuits: Record<string, Doc> = { ...byId };
      for (const [name, target] of Object.entries(byName)) subCircuits[name] = target;
      const result = compToXml(shifted, subCircuits);
      if (!result) {
        skipped.add(c.kind);
        continue;
      }
      if (result.lib !== '-') libUsed.add(result.lib);
      parts.push(result.xml);
    }
    for (const w of d.wires) {
      parts.push(
        `    <wire from="(${Math.round(w.a.x + dx)},${Math.round(w.a.y + dy)})" to="(${Math.round(
          w.b.x + dx,
        )},${Math.round(w.b.y + dy)})"/>`,
      );
    }
    circuitsXml.push(`  <circuit name="${esc(d.name)}">\n${parts.join('\n')}\n  </circuit>`);
  }

  const libs = [
    ['#Wiring', '0'],
    ['#Gates', '1'],
    ['#Plexers', '2'],
    ['#Arithmetic', '3'],
    ['#Memory', '4'],
    ['#I/O', '5'],
    ['#Base', '6'],
  ]
    .filter(([_, id]) => libUsed.has(id) || id === '0')
    .map(([desc, id]) => `  <lib desc="${desc}" name="${id}"/>`)
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<project source="2.7.1" version="1.0">
  ${libs}
  <main name="${esc(doc.name)}"/>
${circuitsXml.join('\n')}
</project>
`;
  return { xml, skipped: Array.from(skipped) };
}

export function downloadText(filename: string, text: string, mime = 'application/octet-stream') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFilename(name: string, ext: string): string {
  const base = (name || 'circuit').replace(/[\\/:*?"<>|]/g, '_').trim();
  return `${base || 'circuit'}${ext}`;
}
