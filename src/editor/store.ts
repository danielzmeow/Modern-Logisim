import { create } from 'zustand';
import { detectLang, tr, type Lang } from '../i18n';
import {
  type CompAttrs,
  type CompKind,
  type ComponentInstance,
  type Doc,
  type Point,
  type Tool,
  type CanvasTheme,
  type Appearance,
  type WireSeg,
  cloneDoc,
  emptyDoc,
  rotateFacing,
} from '../model/types';
import { buildNetlist } from '../model/netlist';
import { computeSubLayout, syncSubLayouts } from '../model/hierarchy';
import { createComp, uid } from '../model/specs';
import { followMovedWires } from '../model/editing';
import { sim } from '../model/sim';
import { extractSelection, pasteData, type ClipboardData } from './clipboard';
import { sanitizeProject, type ProjectData } from './project';

export type { ProjectData } from './project';

const DOC_KEY = 'logisim-studio.doc.v1';
const DOC_BACKUP_KEY = 'logisim-studio.doc.v1.backup';
const PREFS_KEY = 'logisim-studio.prefs.v1';
const WELCOME_KEY = 'logisim-studio.welcomeSeen.v1';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const emptyStorage: StorageLike = { getItem: () => null, setItem: () => {} };
function defaultStorage(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* storage unavailable */
  }
  return emptyStorage;
}
let storageNotice: string | null = null;
let storageLoadFailed = false;
export function takeStorageNotice(): string | null {
  const notice = storageNotice;
  storageNotice = null;
  return notice;
}
export function autosaveIsBlocked(): boolean {
  return storageLoadFailed;
}

function welcomeSeen(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    return false;
  }
}

function setWelcomeSeen(v: boolean) {
  try {
    if (v) localStorage.setItem(WELCOME_KEY, '1');
    else localStorage.removeItem(WELCOME_KEY);
  } catch {
    /* ignore */
  }
}

interface Prefs {
  showGrid: boolean;
  canvasTheme: CanvasTheme;
  inspector: boolean;
  sidebar: boolean;
  lang: Lang;
  appearance: Appearance;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        showGrid: p.showGrid !== false,
        canvasTheme: p.canvasTheme === 'graphite' ? 'graphite' : 'paper',
        inspector: p.inspector !== false,
        sidebar: p.sidebar !== false,
        lang: p.lang === 'en' || p.lang === 'zh' ? p.lang : detectLang(),
        appearance:
          p.appearance === 'light' || p.appearance === 'dark' || p.appearance === 'system'
            ? p.appearance
            : 'system',
      };
    }
  } catch {
    /* ignore */
  }
  return {
    showGrid: true,
    canvasTheme: 'paper',
    inspector: true,
    sidebar: true,
    lang: detectLang(),
    appearance: 'system',
  };
}

function projectFromDoc(doc: Doc): ProjectData {
  const id = uid('cir');
  return { current: id, circuits: { [id]: doc }, order: [id] };
}

export function loadSavedProject(
  lang: Lang = detectLang(),
  storage: StorageLike = defaultStorage(),
): ProjectData | null {
  let mainInvalid = false;
  const read = (key: string): ProjectData | null => {
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const result = sanitizeProject(JSON.parse(raw), lang);
      if (!result) return null;
      if (result.warnings.length) {
        storageNotice = tr(lang, 'project.repaired', {
          details: result.warnings.join(' · '),
        });
      }
      return result.project;
    } catch {
      return null;
    }
  };
  try {
    const main = read(DOC_KEY);
    if (main) {
      storageLoadFailed = false;
      return main;
    }
    mainInvalid = !!storage.getItem(DOC_KEY);
    const backup = read(DOC_BACKUP_KEY);
    if (backup) {
      storageLoadFailed = false;
      storageNotice = tr(lang, 'project.backupRestored');
      return backup;
    }
    if (mainInvalid) {
      // Do not let the first autosave overwrite a damaged payload: it may still
      // be recoverable by hand, and there is no backup to replace it with.
      storageLoadFailed = true;
      storageNotice = tr(lang, 'project.invalidStored');
    }
  } catch {
    storageLoadFailed = true;
  }
  return null;
}

export function loadSavedDoc(): Doc | null {
  const p = loadSavedProject();
  return p ? p.circuits[p.current] ?? null : null;
}

export function hasSavedDoc(): boolean {
  try {
    return !!localStorage.getItem(DOC_KEY) || !!localStorage.getItem(DOC_BACKUP_KEY);
  } catch {
    return false;
  }
}
export interface SaveResult {
  ok: boolean;
  savedAt: number;
  error?: string;
}

/**
 * Persist the project atomically enough to survive a failed write: the previous
 * successful payload is kept as a backup before the main key is replaced.
 */
export function saveProjectToStorage(
  project: ProjectData,
  storage: StorageLike = defaultStorage(),
): SaveResult {
  const savedAt = Date.now();
  try {
    const payload = JSON.stringify({ version: 2, ...project });
    const previous = storage.getItem(DOC_KEY);
    if (previous && previous !== payload) {
      try {
        storage.setItem(DOC_BACKUP_KEY, previous);
      } catch {
        // A full disk should not stop us from trying the main write; the main
        // payload is the one that matters to the current session.
      }
    }
    storage.setItem(DOC_KEY, payload);
    try {
      storage.setItem(DOC_KEY + '.at', String(savedAt));
    } catch {
      // The timestamp is diagnostic only; the project payload is what matters.
    }
    return { ok: true, savedAt };
  } catch (err) {
    return {
      ok: false,
      savedAt: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type ToastTone = 'info' | 'success' | 'warn' | 'error';
export interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

interface EditorState {
  doc: Doc;
  circuits: Record<string, Doc>;
  circuitOrder: string[];
  currentCircuit: string;
  past: Doc[];
  future: Doc[];
  selComps: string[];
  selWires: string[];
  tool: Tool;
  pendingKind: CompKind | null;
  zoom: number;
  pan: Point;
  running: boolean;
  showGrid: boolean;
  canvasTheme: CanvasTheme;
  lang: Lang;
  appearance: Appearance;
  sidebar: boolean;
  inspector: boolean;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  truthOpen: boolean;
  truthFocus: string | null;
  equationOpen: boolean;
  welcomeClosed: boolean;
  toast: Toast | null;
  lastSaved: number;
  saveError: string | null;
  savePending: boolean;
  autosaveBlocked: boolean;
  cursorWorld: Point | null;
  simTick: number;
  menu: { x: number; y: number; target: 'comp' | 'wire' | 'canvas'; wireId?: string; world?: Point } | null;
  dragMode: null | 'move' | 'wire' | 'marquee' | 'pan';
  coalesceKey: string;
  coalesceAt: number;

  setName: (name: string) => void;
  loadDoc: (doc: Doc, opts?: { welcomeClosed?: boolean }) => void;
  loadProject: (project: ProjectData) => boolean;
  newDoc: () => void;
  snapshotProject: () => ProjectData;
  mutate: (fn: (draft: Doc) => void, opts?: { history?: boolean; coalesce?: string }) => void;
  commitSnapshot: (before: Doc) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  switchCircuit: (id: string) => void;
  createCircuit: (name?: string, doc?: Doc) => string;
  deleteCircuit: (id: string) => void;
  addSubcircuit: (targetId: string, at: Point, facing?: ComponentInstance['facing']) => ComponentInstance | null;

  setTool: (tool: Tool) => void;
  setPendingKind: (kind: CompKind | null) => void;
  setView: (zoom: number, pan: Point) => void;
  setRunning: (running: boolean) => void;
  toggleRunning: () => void;
  setShowGrid: (v: boolean) => void;
  setCanvasTheme: (t: CanvasTheme) => void;
  setLang: (lang: Lang) => void;
  setAppearance: (appearance: Appearance) => void;
  setSidebar: (v: boolean) => void;
  setInspector: (v: boolean) => void;
  setPaletteOpen: (v: boolean) => void;
  setShortcutsOpen: (v: boolean) => void;
  setTruthOpen: (v: boolean, focus?: string | null) => void;
  setEquationOpen: (v: boolean) => void;
  setWelcomeClosed: (v: boolean) => void;
  setDragMode: (m: EditorState['dragMode']) => void;
  setCursorWorld: (p: Point | null) => void;
  setSimTick: (n: number) => void;
  setMenu: (m: EditorState['menu']) => void;
  toastMsg: (text: string, tone?: ToastTone) => void;
  dismissToast: () => void;
  markSaved: (savedAt?: number) => void;
  markSavePending: () => void;
  markSaveFailed: (error: string) => void;

  select: (comps: string[], wires: string[], additive?: boolean) => void;
  selectComp: (id: string, additive?: boolean) => void;
  selectWire: (wireId: string, additive?: boolean, wholeNet?: boolean) => void;
  selectWireNet: (wireId: string, additive?: boolean) => void;
  selectAll: () => void;
  clearSelection: () => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  copySelection: () => boolean;
  cutSelection: () => boolean;
  pasteClipboard: () => boolean;
  rotateSelection: (steps: number) => void;
  nudgeSelection: (dx: number, dy: number) => void;
  splitWire: (wireId: string, at: Point) => void;

  addComp: (kind: CompKind, at: Point, facing?: ComponentInstance['facing'], attrs?: Partial<CompAttrs>) => ComponentInstance;
  updateComp: (id: string, attrs: Partial<CompAttrs>, coalesce?: string) => void;
  updateCompGeom: (id: string, patch: { at?: Point; facing?: ComponentInstance['facing'] }) => void;
  addWirePath: (points: Point[]) => string[];
  addWireSegments: (segs: { a: Point; b: Point }[]) => string[];
  moveSelectionBy: (dx: number, dy: number) => void;
}

const prefs = loadPrefs();
const savedProject = loadSavedProject(prefs.lang);
const initialDoc = savedProject?.circuits[savedProject.current] ?? emptyDoc(tr(prefs.lang, 'doc.untitled'));
const initialCircuits = savedProject
  ? Object.fromEntries(Object.entries(savedProject.circuits).map(([id, d]) => [id, cloneDoc(d)]))
  : { main: cloneDoc(initialDoc) };
const initialOrder = savedProject
  ? Array.from(new Set([...savedProject.order, ...Object.keys(savedProject.circuits)])).filter(
      (id) => !!savedProject.circuits[id],
    )
  : ['main'];
const initialCurrent = savedProject?.current && initialCircuits[savedProject.current]
  ? savedProject.current
  : initialOrder[0] ?? 'main';

/** Recompute subcircuit symbol layouts after any edit. */
function normalizeProject(circuits: Record<string, Doc>): Record<string, Doc> {
  const out: Record<string, Doc> = { ...circuits };
  for (const id of Object.keys(out)) {
    out[id] = syncSubLayouts(out[id], out);
  }
  return out;
}

const initialNormalized = normalizeProject(initialCircuits);

let clipboard: ClipboardData | null = null;
let pasteSerial = 0;

export function hasClipboardData(): boolean {
  return !!clipboard && (clipboard.comps.length > 0 || clipboard.wires.length > 0);
}

export const useEditor = create<EditorState>((set, get) => ({
  doc: cloneDoc(initialNormalized[initialCurrent] ?? initialDoc),
  circuits: initialNormalized,
  circuitOrder: initialOrder,
  currentCircuit: initialCurrent,
  past: [],
  future: [],
  selComps: [],
  selWires: [],
  tool: 'select',
  pendingKind: null,
  zoom: 1,
  pan: { x: 0, y: 0 },
  running: false,
  showGrid: prefs.showGrid,
  canvasTheme: prefs.canvasTheme,
  lang: prefs.lang,
  appearance: prefs.appearance,
  sidebar: prefs.sidebar,
  inspector: prefs.inspector,
  paletteOpen: false,
  shortcutsOpen: false,
  truthOpen: false,
  truthFocus: null,
  equationOpen: false,
  welcomeClosed:
    welcomeSeen() ||
    (!!savedProject &&
      Object.values(savedProject.circuits).some((d) => d.comps.length > 0 || d.wires.length > 0)),
  toast: null,
  lastSaved: 0,
  saveError: null,
  savePending: false,
  autosaveBlocked: autosaveIsBlocked(),
  cursorWorld: null,
  simTick: 0,
  menu: null,
  dragMode: null,
  coalesceKey: '',
  coalesceAt: 0,

  snapshotProject: () => {
    const s = get();
    // Capture RAM contents written during simulation into the saved snapshot.
    const currentDoc: Doc = {
      ...s.doc,
      comps: s.doc.comps.map((comp) => {
        if (comp.kind !== 'ram' && comp.kind !== 'rom') return comp;
        if (sim.netOfPort(comp.id, 'dout') < 0) return comp;
        return { ...comp, attrs: { ...comp.attrs, memory: sim.memoryValues(comp) } };
      }),
    };
    return {
      current: s.currentCircuit,
      circuits: { ...s.circuits, [s.currentCircuit]: currentDoc },
      order: s.circuitOrder,
    };
  },

  setName: (name) => {
    const s = get();
    const circuits = {
      ...s.circuits,
      [s.currentCircuit]: { ...s.doc, name },
    };
    const normalized = normalizeProject(circuits);
    set({ doc: normalized[s.currentCircuit], circuits: normalized });
  },

  loadDoc: (doc, opts) => {
    const closed = opts?.welcomeClosed ?? true;
    if (closed) setWelcomeSeen(true);
    const project = projectFromDoc(cloneDoc(doc));
    set({
      doc: project.circuits[project.current],
      circuits: project.circuits,
      circuitOrder: project.order,
      currentCircuit: project.current,
      past: [],
      future: [],
      selComps: [],
      selWires: [],
      pendingKind: null,
      welcomeClosed: closed,
      autosaveBlocked: false,
    });
    sim.reset();
  },

  loadProject: (project) => {
    const lang = get().lang;
    const sanitized = sanitizeProject(project, lang);
    if (!sanitized) {
      get().toastMsg(tr(lang, 'file.invalidProject'), 'error');
      return false;
    }
    setWelcomeSeen(true);
    const circuits = sanitized.project.circuits;
    const normalized = normalizeProject(
      Object.fromEntries(Object.entries(circuits).map(([id, doc]) => [id, cloneDoc(doc)])),
    );
    const order = sanitized.project.order;
    const current = circuits[sanitized.project.current] ? sanitized.project.current : order[0];
    set({
      doc: normalized[current],
      circuits: normalized,
      circuitOrder: order,
      currentCircuit: current,
      past: [],
      future: [],
      selComps: [],
      selWires: [],
      pendingKind: null,
      welcomeClosed: true,
      running: false,
      autosaveBlocked: false,
    });
    sim.reset();
    if (sanitized.warnings.length) {
      get().toastMsg(
        tr(lang, 'project.repaired', { details: sanitized.warnings.join(' · ') }),
        'warn',
      );
    }
    return true;
  },

  newDoc: () => {
    setWelcomeSeen(true);
    const project = projectFromDoc(emptyDoc(tr(get().lang, 'doc.untitled')));
    set({
      doc: project.circuits[project.current],
      circuits: project.circuits,
      circuitOrder: project.order,
      currentCircuit: project.current,
      past: [],
      future: [],
      selComps: [],
      selWires: [],
      pendingKind: null,
      welcomeClosed: true,
      running: false,
      autosaveBlocked: false,
    });
    sim.reset();
  },

  mutate: (fn, opts = {}) => {
    const { doc, past, future, coalesceKey, coalesceAt, circuits, currentCircuit } = get();
    const next = cloneDoc(doc);
    fn(next);
    let nextPast = past;
    let nextFuture = future;
    let nextKey = coalesceKey;
    let nextAt = coalesceAt;
    if (opts.history !== false) {
      const key = opts.coalesce;
      const now = Date.now();
      if (key && key === coalesceKey && now - coalesceAt < 900) {
        // Coalesce rapid slider/text edits into one undo step.
      } else {
        nextPast = [...past, cloneDoc(doc)].slice(-120);
        nextFuture = [];
      }
      nextKey = key ?? '';
      nextAt = now;
    }
    const nextCircuits = normalizeProject({ ...circuits, [currentCircuit]: next });
    set({
      doc: nextCircuits[currentCircuit],
      circuits: nextCircuits,
      past: nextPast,
      future: nextFuture,
      coalesceKey: nextKey,
      coalesceAt: nextAt,
    });
  },

  commitSnapshot: (before) => {
    const cur = get().doc;
    if (JSON.stringify(before) === JSON.stringify(cur)) return;
    set((s) => ({
      past: [...s.past, cloneDoc(before)].slice(-120),
      future: [],
      coalesceKey: '',
      coalesceAt: 0,
    }));
  },

  undo: () => {
    const { past, doc, future, circuits, currentCircuit } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    const nextCircuits = normalizeProject({ ...circuits, [currentCircuit]: prev });
    set((s) => ({
      doc: nextCircuits[currentCircuit],
      circuits: nextCircuits,
      past: past.slice(0, -1),
      future: [...future, cloneDoc(doc)],
      selComps: s.selComps.filter((id) => prev.comps.some((c) => c.id === id)),
      selWires: s.selWires.filter((id) => prev.wires.some((w) => w.id === id)),
    }));
  },

  redo: () => {
    const { past, doc, future, circuits, currentCircuit } = get();
    if (!future.length) return;
    const next = future[future.length - 1];
    const nextCircuits = normalizeProject({ ...circuits, [currentCircuit]: next });
    set((s) => ({
      doc: nextCircuits[currentCircuit],
      circuits: nextCircuits,
      past: [...past, cloneDoc(doc)],
      future: future.slice(0, -1),
      selComps: s.selComps.filter((id) => next.comps.some((c) => c.id === id)),
      selWires: s.selWires.filter((id) => next.wires.some((w) => w.id === id)),
    }));
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  switchCircuit: (id) => {
    const s = get();
    if (id === s.currentCircuit || !s.circuits[id]) return;
    const circuits = normalizeProject({ ...s.circuits, [s.currentCircuit]: s.doc });
    const nextDoc = cloneDoc(circuits[id]);
    circuits[id] = nextDoc;
    set({
      doc: nextDoc,
      circuits,
      currentCircuit: id,
      past: [],
      future: [],
      selComps: [],
      selWires: [],
      pendingKind: null,
    });
    sim.reset();
  },

  createCircuit: (name, doc) => {
    const id = uid('cir');
    const blank = doc ?? emptyDoc(name || `${tr(get().lang, 'doc.untitled')} ${get().circuitOrder.length + 1}`);
    const circuits = normalizeProject({ ...get().circuits, [id]: cloneDoc(blank) });
    set((s) => ({
      circuits,
      circuitOrder: [...s.circuitOrder, id],
    }));
    return id;
  },

  deleteCircuit: (id) => {
    const s = get();
    if (s.circuitOrder.length <= 1) {
      s.toastMsg(tr(s.lang, 'circuit.lastOne'), 'warn');
      return;
    }
    const referenced = Object.values(s.circuits).some((d) =>
      d.comps.some((c) => c.kind === 'sub' && c.attrs.circuit === id),
    );
    if (referenced) {
      s.toastMsg(tr(s.lang, 'circuit.referenced'), 'warn');
      return;
    }
    const order = s.circuitOrder.filter((x) => x !== id);
    const circuits = { ...s.circuits };
    delete circuits[id];
    const nextId = s.currentCircuit === id ? order[0] : s.currentCircuit;
    const normalized = normalizeProject(circuits);
    set({
      doc: normalized[nextId],
      circuits: normalized,
      circuitOrder: order,
      currentCircuit: nextId,
      past: [],
      future: [],
      selComps: [],
      selWires: [],
    });
    sim.reset();
  },

  addSubcircuit: (targetId, at, facing = 'east') => {
    const s = get();
    const target = s.circuits[targetId];
    if (!target) return null;
    const hasCycle = (id: string, seen: Set<string>): boolean => {
      if (id === s.currentCircuit) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      const doc = s.circuits[id];
      if (!doc) return false;
      return doc.comps.some(
        (c) => c.kind === 'sub' && !!c.attrs.circuit && hasCycle(c.attrs.circuit, seen),
      );
    };
    if (hasCycle(targetId, new Set())) {
      s.toastMsg(tr(s.lang, 'circuit.recursive'), 'warn');
      return null;
    }
    const layout = computeSubLayout(target);
    const comp = createComp('sub', at, facing, get().lang, {
      circuit: targetId,
      circuitName: target.name,
      ...layout,
    });
    get().mutate((d) => {
      d.comps.push(comp);
    });
    set({ selComps: [comp.id], selWires: [] });
    return comp;
  },

  setTool: (tool) =>
    set((s) => ({ tool, pendingKind: tool === 'select' ? s.pendingKind : null })),
  setPendingKind: (kind) => set({ pendingKind: kind, tool: 'select' }),
  setView: (zoom, pan) => set({ zoom, pan }),
  setRunning: (running) => set({ running }),
  toggleRunning: () => set((s) => ({ running: !s.running })),
  setShowGrid: (showGrid) => set({ showGrid }),
  setCanvasTheme: (canvasTheme) => set({ canvasTheme }),
  setLang: (lang) => {
    const s = get();
    const oldDefaultZh = tr('zh', 'doc.untitled');
    const oldDefaultEn = tr('en', 'doc.untitled');
    const newDefault = tr(lang, 'doc.untitled');
    const docs: Record<string, Doc> = {};
    for (const [id, doc] of Object.entries(s.circuits)) {
      docs[id] = doc.name === oldDefaultZh || doc.name === oldDefaultEn ? { ...doc, name: newDefault } : doc;
    }
    const current = s.doc.name === oldDefaultZh || s.doc.name === oldDefaultEn;
    docs[s.currentCircuit] = current ? { ...s.doc, name: newDefault } : s.doc;
    const normalized = normalizeProject(docs);
    set({ lang, doc: normalized[s.currentCircuit], circuits: normalized });
  },
  setAppearance: (appearance) => set({ appearance }),
  setSidebar: (sidebar) => set({ sidebar }),
  setInspector: (inspector) => set({ inspector }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setTruthOpen: (truthOpen, focus = null) => set({ truthOpen, truthFocus: focus }),
  setEquationOpen: (equationOpen) => set({ equationOpen }),
  setWelcomeClosed: (welcomeClosed) => {
    setWelcomeSeen(welcomeClosed);
    set({ welcomeClosed });
  },
  setDragMode: (dragMode) => set({ dragMode }),
  setCursorWorld: (cursorWorld) => set({ cursorWorld }),
  setSimTick: (simTick) => set({ simTick }),
  setMenu: (menu) => set({ menu }),
  toastMsg: (text, tone = 'info') =>
    set({ toast: { id: Date.now() + Math.random(), text, tone } }),
  dismissToast: () => set({ toast: null }),
  markSaved: (savedAt = Date.now()) => set({ lastSaved: savedAt, saveError: null, savePending: false }),
  markSavePending: () => set({ savePending: true }),
  markSaveFailed: (error) => set({ saveError: error, savePending: false }),

  select: (comps, wires, additive = false) =>
    set((s) => ({
      selComps: additive ? Array.from(new Set([...s.selComps, ...comps])) : comps,
      selWires: additive ? Array.from(new Set([...s.selWires, ...wires])) : wires,
    })),

  selectComp: (id, additive = false) =>
    set((s) => ({
      selComps: additive
        ? s.selComps.includes(id)
          ? s.selComps.filter((x) => x !== id)
          : [...s.selComps, id]
        : [id],
      selWires: additive ? s.selWires : [],
    })),

  selectWire: (wireId, additive = false, wholeNet = false) => {
    const { doc } = get();
    const idx = doc.wires.findIndex((w) => w.id === wireId);
    if (idx < 0) return;
    if (!wholeNet) {
      set((s) => ({
        selWires: additive
          ? s.selWires.includes(wireId)
            ? s.selWires.filter((x) => x !== wireId)
            : [...s.selWires, wireId]
          : [wireId],
        selComps: additive ? s.selComps : [],
      }));
      return;
    }
    const nl = buildNetlist(doc);
    const net = nl.wireNet[idx];
    const ids = net === undefined ? [wireId] : nl.nets[net].wires.map((i) => doc.wires[i].id);
    set((s) => ({
      selWires: additive ? Array.from(new Set([...s.selWires, ...ids])) : Array.from(new Set(ids)),
      selComps: additive ? s.selComps : [],
    }));
  },

  selectWireNet: (wireId, additive = false) => {
    get().selectWire(wireId, additive, true);
  },

  selectAll: () =>
    set((s) => ({
      selComps: s.doc.comps.map((c) => c.id),
      selWires: s.doc.wires.map((w) => w.id),
    })),

  clearSelection: () => set({ selComps: [], selWires: [] }),

  deleteSelection: () => {
    const { selComps, selWires } = get();
    if (!selComps.length && !selWires.length) return;
    get().mutate((d) => {
      d.comps = d.comps.filter((c) => !selComps.includes(c.id));
      d.wires = d.wires.filter((w) => !selWires.includes(w.id));
    });
    set({ selComps: [], selWires: [] });
  },

  splitWire: (wireId, at) => {
    const { doc } = get();
    const wire = doc.wires.find((w) => w.id === wireId);
    if (!wire) return;
    const onVertical = Math.abs(wire.a.x - wire.b.x) < 0.01;
    const interior = onVertical
      ? Math.abs(at.x - wire.a.x) < 5 &&
        at.y > Math.min(wire.a.y, wire.b.y) + 2 &&
        at.y < Math.max(wire.a.y, wire.b.y) - 2
      : Math.abs(at.y - wire.a.y) < 5 &&
        at.x > Math.min(wire.a.x, wire.b.x) + 2 &&
        at.x < Math.max(wire.a.x, wire.b.x) - 2;
    if (!interior) return;
    const p = {
      x: onVertical ? wire.a.x : Math.round(at.x),
      y: onVertical ? Math.round(at.y) : wire.a.y,
    };
    get().mutate((d) => {
      d.wires = d.wires.filter((w) => w.id !== wireId);
      d.wires.push(
        { id: uid('w'), a: { ...wire.a }, b: p },
        { id: uid('w'), a: { ...p }, b: { ...wire.b } },
      );
    });
    set({ selWires: [], selComps: [] });
  },

  duplicateSelection: () => {
    const { selComps, selWires, doc } = get();
    if (!selComps.length && !selWires.length) return;
    const comps = doc.comps
      .filter((c) => selComps.includes(c.id))
      .map((c) => {
        const nid = uid('c');
        return { ...structuredClone(c), id: nid, at: { x: c.at.x + 20, y: c.at.y + 20 } };
      });
    const wires = doc.wires
      .filter((w) => selWires.includes(w.id))
      .map((w) => ({
        ...structuredClone(w),
        id: uid('w'),
        a: { x: w.a.x + 20, y: w.a.y + 20 },
        b: { x: w.b.x + 20, y: w.b.y + 20 },
      }));
    get().mutate((d) => {
      d.comps.push(...comps);
      d.wires.push(...wires);
    });
    set({ selComps: comps.map((c) => c.id), selWires: wires.map((w) => w.id) });
  },

  copySelection: () => {
    const { doc, selComps, selWires } = get();
    const payload = extractSelection(doc, selComps, selWires);
    if (!payload) return false;
    clipboard = payload;
    pasteSerial = 0;
    return true;
  },

  cutSelection: () => {
    const state = get();
    if (!state.copySelection()) return false;
    state.mutate((d) => {
      d.comps = d.comps.filter((c) => !state.selComps.includes(c.id));
      d.wires = d.wires.filter((w) => !state.selWires.includes(w.id));
    });
    set({ selComps: [], selWires: [] });
    return true;
  },

  pasteClipboard: () => {
    if (!clipboard) return false;
    const result = pasteData(clipboard, 20 + pasteSerial * 10);
    if (!result) return false;
    pasteSerial += 1;
    get().mutate((d) => {
      d.comps.push(...result.comps);
      d.wires.push(...result.wires);
    });
    set({ selComps: result.selComps, selWires: result.selWires });
    return true;
  },

  rotateSelection: (steps) => {
    const { selComps } = get();
    if (!selComps.length) return;
    get().mutate((d) => {
      for (const c of d.comps) {
        if (selComps.includes(c.id) && c.kind !== 'text') {
          c.facing = rotateFacing(c.facing, steps);
        }
      }
    });
  },

  nudgeSelection: (dx, dy) => {
    const { selComps } = get();
    if (!selComps.length) return;
    get().mutate(
      (d) => {
        const moved = new Set(selComps);
        d.wires = followMovedWires(d, moved, dx, dy);
        for (const c of d.comps) {
          if (moved.has(c.id)) c.at = { x: c.at.x + dx, y: c.at.y + dy };
        }
      },
      { coalesce: 'nudge' },
    );
  },

  addComp: (kind, at, facing = 'east', attrs = {}) => {
    const comp = createComp(kind, at, facing, get().lang, attrs);
    get().mutate((d) => {
      d.comps.push(comp);
    });
    set({ selComps: [comp.id], selWires: [] });
    return comp;
  },

  updateComp: (id, attrs, coalesce) => {
    get().mutate(
      (d) => {
        const c = d.comps.find((x) => x.id === id);
        if (!c) return;
        c.attrs = { ...c.attrs, ...attrs };
      },
      { coalesce },
    );
  },

  updateCompGeom: (id, patch) => {
    get().mutate(
      (d) => {
        const c = d.comps.find((x) => x.id === id);
        if (!c) return;
        if (patch.at) {
          const at = { x: Math.round(patch.at.x), y: Math.round(patch.at.y) };
          const dx = at.x - c.at.x;
          const dy = at.y - c.at.y;
          if (dx || dy) d.wires = followMovedWires(d, [id], dx, dy);
          c.at = at;
        }
        if (patch.facing) c.facing = patch.facing;
      },
      { coalesce: 'geom' },
    );
  },

  addWirePath: (points) => {
    const ids: string[] = [];
    const segs: { a: Point; b: Point }[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = { x: Math.round(points[i - 1].x), y: Math.round(points[i - 1].y) };
      const b = { x: Math.round(points[i].x), y: Math.round(points[i].y) };
      if (a.x === b.x && a.y === b.y) continue;
      if (a.x !== b.x && a.y !== b.y) continue;
      segs.push({ a, b });
    }
    if (!segs.length) return [];
    get().mutate((d) => {
      for (const s of segs) {
        const w: WireSeg = { id: uid('w'), a: s.a, b: s.b };
        d.wires.push(w);
        ids.push(w.id);
      }
    });
    return ids;
  },

  addWireSegments: (segs) => {
    const ids: string[] = [];
    const valid = segs.filter((s) => {
      const ax = Math.round(s.a.x);
      const ay = Math.round(s.a.y);
      const bx = Math.round(s.b.x);
      const by = Math.round(s.b.y);
      return !(ax === bx && ay === by) && (ax === bx || ay === by);
    });
    if (!valid.length) return [];
    get().mutate((d) => {
      for (const s of valid) {
        const w: WireSeg = {
          id: uid('w'),
          a: { x: Math.round(s.a.x), y: Math.round(s.a.y) },
          b: { x: Math.round(s.b.x), y: Math.round(s.b.y) },
        };
        d.wires.push(w);
        ids.push(w.id);
      }
    });
    return ids;
  },

  moveSelectionBy: (dx, dy) => {
    get().nudgeSelection(dx, dy);
  },
}));

// Persist view preferences.
useEditor.subscribe((s, prev) => {
  if (
    s.showGrid !== prev.showGrid ||
    s.canvasTheme !== prev.canvasTheme ||
    s.inspector !== prev.inspector ||
    s.sidebar !== prev.sidebar ||
    s.lang !== prev.lang ||
    s.appearance !== prev.appearance
  ) {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          showGrid: s.showGrid,
          canvasTheme: s.canvasTheme,
          inspector: s.inspector,
          sidebar: s.sidebar,
          lang: s.lang,
          appearance: s.appearance,
        }),
      );
    } catch {
      /* ignore */
    }
  }
});

/** Build a project from imported named circuits (e.g. Logisim subcircuits). */
export function projectFromNamedDocs(
  named: Record<string, Doc>,
  mainName?: string,
): ProjectData {
  const ids = new Map<string, string>();
  for (const name of Object.keys(named)) ids.set(name, uid('cir'));
  const circuits: Record<string, Doc> = {};
  const order: string[] = [];
  for (const [name, source] of Object.entries(named)) {
    const id = ids.get(name)!;
    const doc = cloneDoc(source);
    for (const comp of doc.comps) {
      if (comp.kind !== 'sub') continue;
      const targetName = comp.attrs.circuit ?? '';
      const targetId = ids.get(targetName);
      if (targetId) {
        comp.attrs.circuit = targetId;
        comp.attrs.circuitName = named[targetName]?.name ?? targetName;
      }
    }
    circuits[id] = doc;
    order.push(id);
  }
  const normalized = normalizeProject(circuits);
  const current = (mainName && ids.get(mainName)) || order[0];
  return { current, circuits: normalized, order };
}
