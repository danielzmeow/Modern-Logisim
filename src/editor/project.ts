import {
  KIND_NAMES,
  type CompAttrs,
  type ComponentInstance,
  type Doc,
  type Facing,
  type Point,
  type SubPinLayout,
  type WireSeg,
} from '../model/types';
import { tr, type Lang } from '../i18n';

/**
 * Project data is the persistence contract between the editor, localStorage and
 * imported JSON files. Everything entering that contract is normalized here so
 * a damaged file can never reach the renderer or simulator unchecked.
 */
export interface ProjectData {
  current: string;
  circuits: Record<string, Doc>;
  order: string[];
}

export interface SanitizedProject {
  project: ProjectData;
  warnings: string[];
  changed: boolean;
}

const MAX_CIRCUITS = 200;
const MAX_COMPS = 20_000;
const MAX_WIRES = 60_000;
const MAX_MEMORY = 1 << 20;
const MAX_TEXT = 20_000;
const MAX_LABEL = 240;
const COORD_LIMIT = 1_000_000;
const CJK_NAMES = KIND_NAMES;
const FACINGS: Facing[] = ['east', 'south', 'west', 'north'];

type Rec = Record<string, unknown>;
const RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const hasKind = (kind: string): boolean => Object.prototype.hasOwnProperty.call(CJK_NAMES, kind);

function str(v: unknown, fallback = '', max = MAX_LABEL): string {
  return typeof v === 'string' ? v.slice(0, max) : fallback;
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function finitePoint(v: unknown, fallback: Point): Point {
  if (!isRec(v)) return { ...fallback };
  return {
    x: int(v.x, fallback.x, -COORD_LIMIT, COORD_LIMIT),
    y: int(v.y, fallback.y, -COORD_LIMIT, COORD_LIMIT),
  };
}

function cleanSubPins(v: unknown): SubPinLayout[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.slice(0, 128).flatMap((pin) => {
    if (!isRec(pin) || typeof pin.id !== 'string') return [];
    return [{
      id: str(pin.id, '', MAX_LABEL),
      label: str(pin.label, '', MAX_LABEL),
      kind: pin.kind === 'output' ? 'output' : 'input',
      bits: int(pin.bits, 1, 1, 32),
      y: int(pin.y, 0, -COORD_LIMIT, COORD_LIMIT),
    }];
  });
}

function cleanAttrs(kind: ComponentInstance['kind'], value: unknown): CompAttrs {
  const src: Rec = isRec(value) ? value : {};
  const attrs: CompAttrs = { ...(src as CompAttrs) };

  if ('label' in src) attrs.label = str(src.label, '', MAX_LABEL);
  if ('bits' in src) attrs.bits = int(src.bits, 1, 1, 32);
  if ('inputs' in src) attrs.inputs = int(src.inputs, 2, 2, 5);
  if ('freq' in src) attrs.freq = num(src.freq, 2, 0.2, 40);
  if ('value' in src) attrs.value = int(src.value, 0, 0, 0xffffffff) >>> 0;
  if ('fans' in src) {
    const max = kind === 'split' || kind === 'merge' ? 12 : kind === 'bitSelect' ? 5 : 4;
    const min = kind === 'split' || kind === 'merge' ? 2 : 1;
    attrs.fans = int(src.fans, min, min, max);
  }
  if ('fanBits' in src) {
    attrs.fanBits = Array.isArray(src.fanBits)
      ? src.fanBits.slice(0, 12).map((n) => int(n, 1, 1, 32))
      : undefined;
  }
  if ('bitEnd' in src) {
    attrs.bitEnd = Array.isArray(src.bitEnd)
      ? src.bitEnd.slice(0, 32).map((n) => int(n, 0, 0, 12))
      : undefined;
  }
  if ('size' in src) {
    const n = int(src.size, 50, 30, 70);
    attrs.size = n === 30 || n === 50 || n === 70 ? n : 50;
  }
  if ('trigger' in src) attrs.trigger = src.trigger === 'falling' ? 'falling' : 'rising';
  if ('text' in src) attrs.text = str(src.text, '', MAX_TEXT);
  if ('color' in src) {
    const colors = ['emerald', 'sky', 'amber', 'rose', 'violet'] as const;
    attrs.color = colors.includes(src.color as (typeof colors)[number])
      ? (src.color as (typeof colors)[number])
      : 'emerald';
  }
  if ('inBits' in src) attrs.inBits = int(src.inBits, 4, 1, 32);
  if ('outBits' in src) attrs.outBits = int(src.outBits, 8, 1, 32);
  if ('sign' in src) attrs.sign = bool(src.sign, false);
  if ('pull' in src) attrs.pull = src.pull === 1 || src.pull === '1' || src.pull === true ? 1 : 0;
  if ('enable' in src) attrs.enable = bool(src.enable, true);
  if ('reset' in src) attrs.reset = bool(src.reset, true);
  if ('shift' in src) {
    attrs.shift = src.shift === 'right' || src.shift === 'arithmetic' ? src.shift : 'left';
  }
  if ('count' in src) attrs.count = src.count === 'down' ? 'down' : 'up';
  if ('addrBits' in src) attrs.addrBits = int(src.addrBits, 4, 1, 20);
  if ('dataBits' in src) attrs.dataBits = int(src.dataBits, 8, 1, 32);
  if ('memory' in src) {
    attrs.memory = Array.isArray(src.memory)
      ? src.memory.slice(0, MAX_MEMORY).map((n) => int(n, 0, 0, 0xffffffff) >>> 0)
      : [];
  }
  if ('circuit' in src) attrs.circuit = str(src.circuit, '', MAX_LABEL);
  if ('circuitName' in src) attrs.circuitName = str(src.circuitName, '', MAX_LABEL);
  if ('subPins' in src) attrs.subPins = cleanSubPins(src.subPins) ?? [];
  if ('subW' in src) attrs.subW = int(src.subW, 80, 20, 400);
  if ('subH' in src) attrs.subH = int(src.subH, 60, 20, 400);
  if ('_interface' in src) attrs._interface = bool(src._interface, false);
  return attrs;
}

function cleanDoc(value: unknown, fallbackName: string, lang: Lang): {
  doc: Doc | null;
  changed: boolean;
  skippedComps: number;
  skippedWires: number;
} {
  if (!isRec(value) || !Array.isArray(value.comps) || !Array.isArray(value.wires)) {
    return { doc: null, changed: true, skippedComps: 0, skippedWires: 0 };
  }

  let changed = false;
  const compIds = new Set<string>();
  const comps: ComponentInstance[] = [];
  let skippedComps = 0;

  for (const raw of value.comps.slice(0, MAX_COMPS)) {
    if (!isRec(raw) || typeof raw.kind !== 'string' || !hasKind(raw.kind)) {
      skippedComps++;
      changed = true;
      continue;
    }
    const kind = raw.kind as ComponentInstance['kind'];
    let id = str(raw.id, '', MAX_LABEL);
    if (!id || compIds.has(id)) {
      id = `c${comps.length}_${Math.random().toString(36).slice(2, 6)}`;
      changed = true;
    }
    compIds.add(id);
    const at = finitePoint(raw.at, { x: 0, y: 0 });
    const facing = FACINGS.includes(raw.facing as Facing) ? (raw.facing as Facing) : 'east';
    if (facing !== raw.facing) changed = true;
    comps.push({
      id,
      kind,
      at,
      facing,
      attrs: cleanAttrs(kind, raw.attrs),
    });
  }
  if (value.comps.length > MAX_COMPS) changed = true;

  const wireIds = new Set<string>();
  const wires: WireSeg[] = [];
  let skippedWires = 0;
  for (const raw of value.wires.slice(0, MAX_WIRES)) {
    if (!isRec(raw)) {
      skippedWires++;
      changed = true;
      continue;
    }
    let id = str(raw.id, '', MAX_LABEL);
    if (!id || wireIds.has(id)) {
      id = `w${wires.length}_${Math.random().toString(36).slice(2, 6)}`;
      changed = true;
    }
    const a = finitePoint(raw.a, { x: 0, y: 0 });
    const b = finitePoint(raw.b, { x: 0, y: 0 });
    const zero = a.x === b.x && a.y === b.y;
    const diagonal = a.x !== b.x && a.y !== b.y;
    if (zero || diagonal) {
      skippedWires++;
      changed = true;
      continue;
    }
    wireIds.add(id);
    wires.push({ id, a, b });
  }
  if (value.wires.length > MAX_WIRES) changed = true;

  const name = str(value.name, fallbackName, MAX_LABEL) || fallbackName;
  if (name !== value.name) changed = true;
  return {
    doc: { version: 1, name, comps, wires },
    changed,
    skippedComps,
    skippedWires,
  };
}

function legacyProject(value: unknown, lang: Lang): ProjectData | null {
  let source = value;
  if (isRec(source) && isRec(source.project)) {
    const nested = cleanProjectShape(source.project, lang);
    if (nested) return nested;
    source = isRec(source.doc) ? source.doc : source.project;
  }
  if (isRec(source) && isRec(source.doc)) source = source.doc;
  const doc = isRec(source) && Array.isArray(source.comps) && Array.isArray(source.wires)
    ? source
    : null;
  if (!doc) return null;
  const cleaned = cleanDoc(doc, tr(lang, 'doc.untitled'), lang).doc;
  if (!cleaned) return null;
  return { current: 'main', circuits: { main: cleaned }, order: ['main'] };
}

function cleanProjectShape(value: unknown, lang: Lang): ProjectData | null {
  if (!isRec(value) || !isRec(value.circuits)) return null;
  const circuits: Record<string, Doc> = Object.create(null) as Record<string, Doc>;
  const ids = new Set<string>();
  let skippedComps = 0;
  let skippedWires = 0;

  for (const [rawId, rawDoc] of Object.entries(value.circuits).slice(0, MAX_CIRCUITS)) {
    let id = rawId.slice(0, MAX_LABEL) || `cir${Object.keys(circuits).length}`;
    if (RESERVED_KEYS.has(id)) id = `cir${Object.keys(circuits).length}_${id}`;
    while (ids.has(id)) id = `${id}_`;
    const cleaned = cleanDoc(rawDoc, id, lang);
    if (!cleaned.doc) continue;
    skippedComps += cleaned.skippedComps;
    skippedWires += cleaned.skippedWires;
    ids.add(id);
    circuits[id] = cleaned.doc;
  }
  if (!Object.keys(circuits).length) return null;

  const order: string[] = [];
  if (Array.isArray(value.order)) {
    for (const id of value.order) {
      if (typeof id === 'string' && circuits[id] && !order.includes(id)) order.push(id);
    }
  }
  for (const id of Object.keys(circuits)) if (!order.includes(id)) order.push(id);

  const current =
    typeof value.current === 'string' && circuits[value.current] ? value.current : order[0];
  const project = { current, circuits, order };

  // A missing target is a warning, not a reason to discard the whole project.
  let missingSubs = 0;
  for (const doc of Object.values(circuits)) {
    for (const comp of doc.comps) {
      if (comp.kind === 'sub' && comp.attrs.circuit && !circuits[comp.attrs.circuit]) {
        missingSubs++;
      }
    }
  }
  const warnings: string[] = [];
  if (skippedComps) warnings.push(tr(lang, 'project.skippedComponents', { n: skippedComps }));
  if (skippedWires) warnings.push(tr(lang, 'project.droppedWires', { n: skippedWires }));
  if (missingSubs) warnings.push(tr(lang, 'project.missingSubcircuits', { n: missingSubs }));
  if (Object.keys(value.circuits).length > MAX_CIRCUITS) {
    warnings.push(tr(lang, 'project.truncated'));
  }
  (project as ProjectData & { warnings?: string[] }).warnings = warnings;
  return project;
}

/** Normalize any project/doc JSON shape into a safe editable project. */
export function sanitizeProject(value: unknown, lang: Lang = 'en'): SanitizedProject | null {
  const shaped = cleanProjectShape(value, lang) ?? legacyProject(value, lang);
  if (!shaped) return null;
  const warnings = (shaped as ProjectData & { warnings?: string[] }).warnings ?? [];
  delete (shaped as ProjectData & { warnings?: string[] }).warnings;
  return {
    project: shaped,
    warnings,
    changed: warnings.length > 0,
  };
}
