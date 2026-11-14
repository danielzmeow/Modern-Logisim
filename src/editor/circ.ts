import type { CompKind, ComponentInstance, Doc, Facing, Point } from '../model/types';
import { createComp, uid } from '../model/specs';
import { contentBounds, portsOf } from '../model/geometry';
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
      return child.getAttribute('val');
    }
  }
  return null;
}

export interface CircImportResult {
  doc: Doc;
  warnings: string[];
  supported: number;
  skipped: number;
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
  const mainName = dom.querySelector('project > main')?.getAttribute('name');
  const circuits = Array.from(dom.querySelectorAll('circuit'));
  if (!circuits.length) throw new Error(tr(lang, 'file.circNoCircuit'));
  let circuit = circuits.find((c) => c.getAttribute('name') === mainName);
  if (!circuit) {
    circuit = circuits.find((c) => c.getAttribute('name') === 'main') ?? circuits[0];
  }
  if (circuits.length > 1) {
    warnings.push(
      tr(lang, 'file.circSubcircuits', { n: circuits.length, name: circuit.getAttribute('name') ?? '' }),
    );
  }

  const circuitName = circuit.getAttribute('name') || '';
  const doc = emptyDoc(circuitName && circuitName !== 'main' ? circuitName : importedFallback);
  const skippedKinds = new Map<string, number>();
  const negateWarnings = new Set<string>();
  let supported = 0;

  for (const el of Array.from(circuit.children)) {
    if (el.tagName !== 'comp') continue;
    const name = el.getAttribute('name') ?? '';
    const loc = parseLoc(el.getAttribute('loc'));
    const facing = parseFacing(attr(el, 'facing'));
    const label = attr(el, 'label') ?? undefined;
    let kind: CompKind | null = null;
    let comp: ComponentInstance | null = null;

    if (name === 'Pin') {
      const output = parseBool(attr(el, 'output'));
      const bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 1)));
      comp = createComp(output ? 'output' : 'input', loc, facing);
      comp.attrs.bits = bits;
      comp.attrs.label = label ?? '';
      kind = output ? 'output' : 'input';
    } else if (name === 'Probe') {
      comp = createComp('output', loc, facing);
      comp.attrs.bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 1)));
      comp.attrs.label = label ?? '';
      kind = 'output';
    } else if (name === 'LED') {
      comp = createComp('led', loc, 'east');
      comp.attrs.label = label ?? '';
      kind = 'led';
    } else if (name === 'Button') {
      comp = createComp('button', loc, facing);
      comp.attrs.label = label ?? '';
      kind = 'button';
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
      kind = 'clock';
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
      kind = 'constant';
    } else if (name === 'Tunnel') {
      comp = createComp('tunnel', loc, facing);
      comp.attrs.label = label ?? 'net';
      kind = 'tunnel';
    } else if (name === 'Text') {
      comp = createComp('text', { x: loc.x, y: loc.y }, 'east');
      comp.attrs.text = attr(el, 'text') ?? '';
      kind = 'text';
    } else if (name === 'D Flip-Flop') {
      comp = createComp('dff', loc, facing);
      const trig = attr(el, 'trigger') ?? 'rising';
      comp.attrs.trigger = trig === 'falling' || trig === 'low' ? 'falling' : 'rising';
      comp.attrs.label = label ?? '';
      kind = 'dff';
    } else if (name === 'Multiplexer') {
      const sel = Math.max(1, Math.min(4, num(attr(el, 'select'), 1)));
      comp = createComp('mux', loc, facing);
      comp.attrs.fans = sel;
      comp.attrs.bits = Math.max(1, Math.min(32, num(attr(el, 'width'), 1)));
      comp.attrs.label = label ?? '';
      if (attr(el, 'selloc') === 'tr') warnings.push(tr(lang, 'file.circSelectLoc'));
      kind = 'mux';
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
        comp.attrs.size = [30, 50, 70].includes(num(attr(el, 'size'), 50)) ? num(attr(el, 'size'), 50) : 50;
        comp.attrs.label = label ?? '';
        kind = gk;
        for (let i = 0; i < 8; i++) {
          if (parseBool(attr(el, `negate${i}`))) negateWarnings.add('negate');
        }
      }
    }

    if (comp && kind) {
      doc.comps.push(comp);
      supported++;
    } else {
      const key = `${name}`;
      skippedKinds.set(key, (skippedKinds.get(key) ?? 0) + 1);
    }
  }

  // Wires (all lines are orthogonal in Logisim).
  const wires: { id: string; a: Point; b: Point }[] = [];
  for (const el of Array.from(circuit.children)) {
    if (el.tagName !== 'wire') continue;
    const a = parseLoc(el.getAttribute('from'));
    const b = parseLoc(el.getAttribute('to'));
    if (a.x === b.x && a.y === b.y) continue;
    wires.push({ id: uid('w'), a, b });
  }

  // Gentle healing: Logisim geometry can differ by a few pixels from ours.
  let healed = 0;
  const allPorts: { point: Point }[] = [];
  for (const c of doc.comps) for (const p of portsOf(c)) allPorts.push({ point: p.world });
  const extra: { id: string; a: Point; b: Point }[] = [];
  const isPortPoint = (p: Point) => allPorts.some((q) => Math.abs(q.point.x - p.x) < 0.1 && Math.abs(q.point.y - p.y) < 0.1);
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
        // Join with a tiny stub instead of moving the original wire.
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
  if (healed)
    warnings.push(tr(lang, 'file.circHealed', { items: itemCount(lang, healed, '处连线端点', 'wire endpoint') }));
  if (skippedKinds.size) {
    const names = Array.from(skippedKinds.entries())
      .map(([n, k]) => `${n} ×${k}`)
      .join('、');
    warnings.push(tr(lang, 'file.circSkipped', { names }));
  }
  if (negateWarnings.size) warnings.push(tr(lang, 'file.circNegated'));
  if (!doc.comps.length && !doc.wires.length) warnings.push(tr(lang, 'file.circNoComps'));
  return { doc, warnings, supported, skipped: Array.from(skippedKinds.values()).reduce((a, b) => a + b, 0) };
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
  return '\n' + filtered.map(([k, v]) => `      <a name="${esc(k)}" val="${esc(String(v))}"/>`).join('\n');
}

export interface CircExportResult {
  xml: string;
  skipped: ('split' | 'merge')[];
}

export function exportCirc(doc: Doc): CircExportResult {
  const skipped = new Set<'split' | 'merge'>();
  const libUsed = new Set<string>();
  const parts: string[] = [];
  const b = contentBounds(doc);
  const dx = b && b.x < 100 ? Math.ceil((100 - b.x) / 10) * 10 : 0;
  const dy = b && b.y < 100 ? Math.ceil((100 - b.y) / 10) * 10 : 0;

  for (const c of doc.comps) {
    let lib = '0';
    let name = '';
    const attrs: [string, string | number | boolean | null | undefined][] = [];
    const facingAttr = c.facing !== 'east' ? c.facing : null;
    const label = c.attrs.label ?? '';
    switch (c.kind) {
      case 'input':
      case 'output':
        lib = '0';
        name = 'Pin';
        attrs.push(['facing', facingAttr], ['output', c.kind === 'output' ? 'true' : 'false']);
        if ((c.attrs.bits ?? 1) > 1) attrs.push(['width', c.attrs.bits ?? 1]);
        attrs.push(['label', label], ['labelloc', 'north']);
        break;
      case 'led':
        lib = '5';
        name = 'LED';
        attrs.push(['facing', 'east'], ['label', label], ['labelloc', 'north']);
        break;
      case 'button':
        lib = '5';
        name = 'Button';
        attrs.push(['facing', facingAttr], ['label', label]);
        break;
      case 'clock':
        lib = '0';
        name = 'Clock';
        attrs.push(['facing', facingAttr], ['label', label]);
        {
          const half = Math.max(1, Math.round(500 / Math.max(0.2, c.attrs.freq ?? 2)));
          attrs.push(['highDuration', half], ['lowDuration', half]);
        }
        break;
      case 'constant':
        lib = '0';
        name = 'Constant';
        attrs.push(['facing', facingAttr], ['width', c.attrs.bits ?? 8], [
          'value',
          '0x' + ((c.attrs.value ?? 0) >>> 0).toString(16).toUpperCase().padStart(2, '0'),
        ]);
        attrs.push(['label', label]);
        break;
      case 'tunnel':
        lib = '0';
        name = 'Tunnel';
        attrs.push(['facing', facingAttr], ['label', c.attrs.label ?? 'net']);
        break;
      case 'text':
        lib = '6';
        name = 'Text';
        attrs.push(['text', c.attrs.text ?? ''], ['font', 'SansSerif plain 12'], ['halign', 'center'], ['valign', 'base']);
        break;
      case 'dff':
        lib = '4';
        name = 'D Flip-Flop';
        attrs.push(['facing', facingAttr], ['trigger', c.attrs.trigger ?? 'rising'], ['label', label]);
        break;
      case 'mux':
        lib = '2';
        name = 'Multiplexer';
        attrs.push(
          ['facing', facingAttr],
          ['select', c.attrs.fans ?? 1],
          ['width', c.attrs.bits ?? 1],
          ['enable', 'false'],
          ['label', label],
        );
        break;
      case 'not':
      case 'and':
      case 'or':
      case 'nand':
      case 'nor':
      case 'xor':
      case 'xnor': {
        lib = '1';
        name = `${c.kind.toUpperCase()} Gate`;
        if (c.kind === 'not') {
          name = 'NOT Gate';
        }
        if (c.kind !== 'not') {
          attrs.push(['inputs', c.attrs.inputs ?? 2]);
          if ((c.attrs.size ?? 50) !== 50) attrs.push(['size', c.attrs.size ?? 50]);
        }
        attrs.push(['facing', facingAttr], ['label', label]);
        break;
      }
      case 'split':
      case 'merge':
        skipped.add(c.kind === 'split' ? 'split' : 'merge');
        continue;
    }
    libUsed.add(lib);
    parts.push(
      `    <comp lib="${lib}" loc="(${Math.round(c.at.x + dx)},${Math.round(c.at.y + dy)})" name="${esc(name)}">${attrsXml(
        attrs,
      )}${attrs.length ? '\n    ' : ''}</comp>`,
    );
  }
  for (const w of doc.wires) {
    parts.push(
      `    <wire from="(${Math.round(w.a.x + dx)},${Math.round(w.a.y + dy)})" to="(${Math.round(
        w.b.x + dx,
      )},${Math.round(w.b.y + dy)})"/>`,
    );
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
  <main name="main"/>
  <circuit name="main">
${parts.join('\n')}
  </circuit>
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
