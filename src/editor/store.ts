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
import { createComp, uid } from '../model/specs';
import { sim } from '../model/sim';

const DOC_KEY = 'logisim-studio.doc.v1';
const PREFS_KEY = 'logisim-studio.prefs.v1';
const WELCOME_KEY = 'logisim-studio.welcomeSeen.v1';

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

export function loadSavedDoc(): Doc | null {
  try {
    const raw = localStorage.getItem(DOC_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.comps) || !Array.isArray(d.wires)) return null;
    return d as Doc;
  } catch {
    return null;
  }
}

export function hasSavedDoc(): boolean {
  try {
    return !!localStorage.getItem(DOC_KEY);
  } catch {
    return false;
  }
}

export function saveDocToStorage(doc: Doc) {
  try {
    localStorage.setItem(DOC_KEY, JSON.stringify(doc));
    localStorage.setItem(DOC_KEY + '.at', String(Date.now()));
  } catch {
    /* ignore */
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
  welcomeClosed: boolean;
  toast: Toast | null;
  lastSaved: number;
  cursorWorld: Point | null;
  simTick: number;
  menu: { x: number; y: number; target: 'comp' | 'wire' | 'canvas' } | null;
  dragMode: null | 'move' | 'wire' | 'marquee' | 'pan';
  coalesceKey: string;
  coalesceAt: number;

  setName: (name: string) => void;
  loadDoc: (doc: Doc, opts?: { welcomeClosed?: boolean }) => void;
  newDoc: () => void;
  mutate: (fn: (draft: Doc) => void, opts?: { history?: boolean; coalesce?: string }) => void;
  commitSnapshot: (before: Doc) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

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
  setWelcomeClosed: (v: boolean) => void;
  setDragMode: (m: EditorState['dragMode']) => void;
  setCursorWorld: (p: Point | null) => void;
  setSimTick: (n: number) => void;
  setMenu: (m: EditorState['menu']) => void;
  toastMsg: (text: string, tone?: ToastTone) => void;
  dismissToast: () => void;
  markSaved: () => void;

  select: (comps: string[], wires: string[], additive?: boolean) => void;
  selectComp: (id: string, additive?: boolean) => void;
  selectWire: (wireId: string, additive?: boolean) => void;
  selectAll: () => void;
  clearSelection: () => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  rotateSelection: (steps: number) => void;
  nudgeSelection: (dx: number, dy: number) => void;

  addComp: (kind: CompKind, at: Point, facing?: ComponentInstance['facing']) => ComponentInstance;
  updateComp: (id: string, attrs: Partial<CompAttrs>, coalesce?: string) => void;
  updateCompGeom: (id: string, patch: { at?: Point; facing?: ComponentInstance['facing'] }) => void;
  addWirePath: (points: Point[]) => string[];
  addWireSegments: (segs: { a: Point; b: Point }[]) => string[];
  moveSelectionBy: (dx: number, dy: number) => void;
}

const prefs = loadPrefs();
const saved = loadSavedDoc();

export const useEditor = create<EditorState>((set, get) => ({
  doc: saved ?? emptyDoc(tr(prefs.lang, 'doc.untitled')),
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
  welcomeClosed:
    welcomeSeen() || (!!saved && (saved.comps.length > 0 || saved.wires.length > 0)),
  toast: null,
  lastSaved: 0,
  cursorWorld: null,
  simTick: 0,
  menu: null,
  dragMode: null,
  coalesceKey: '',
  coalesceAt: 0,

  setName: (name) => set((s) => ({ doc: { ...s.doc, name } })),

  loadDoc: (doc, opts) => {
    const closed = opts?.welcomeClosed ?? true;
    if (closed) setWelcomeSeen(true);
    set((s) => ({
      doc: cloneDoc(doc),
      past: [],
      future: [],
      selComps: [],
      selWires: [],
      welcomeClosed: closed,
      toast: s.toast,
    }));
  },

  newDoc: () => {
    setWelcomeSeen(true);
    set({
      doc: emptyDoc(tr(get().lang, 'doc.untitled')),
      past: [],
      future: [],
      selComps: [],
      selWires: [],
      welcomeClosed: true,
      running: false,
    });
    sim.reset();
  },

  mutate: (fn, opts = {}) => {
    const { doc, past, future, coalesceKey, coalesceAt } = get();
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
    set({
      doc: next,
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
    const { past, doc, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set((s) => ({
      doc: prev,
      past: past.slice(0, -1),
      future: [...future, cloneDoc(doc)],
      selComps: s.selComps.filter((id) => prev.comps.some((c) => c.id === id)),
      selWires: s.selWires.filter((id) => prev.wires.some((w) => w.id === id)),
    }));
  },

  redo: () => {
    const { past, doc, future } = get();
    if (!future.length) return;
    const next = future[future.length - 1];
    set((s) => ({
      doc: next,
      past: [...past, cloneDoc(doc)],
      future: future.slice(0, -1),
      selComps: s.selComps.filter((id) => next.comps.some((c) => c.id === id)),
      selWires: s.selWires.filter((id) => next.wires.some((w) => w.id === id)),
    }));
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  setTool: (tool) =>
    set((s) => ({ tool, pendingKind: tool === 'select' ? s.pendingKind : null })),
  setPendingKind: (kind) => set({ pendingKind: kind, tool: 'select' }),
  setView: (zoom, pan) => set({ zoom, pan }),
  setRunning: (running) => set({ running }),
  toggleRunning: () => set((s) => ({ running: !s.running })),
  setShowGrid: (showGrid) => set({ showGrid }),
  setCanvasTheme: (canvasTheme) => set({ canvasTheme }),
  setLang: (lang) =>
    set((s) => {
      const oldDefault = tr(s.lang, 'doc.untitled');
      const newDefault = tr(lang, 'doc.untitled');
      return {
        lang,
        doc: s.doc.name === oldDefault ? { ...s.doc, name: newDefault } : s.doc,
      };
    }),
  setAppearance: (appearance) => set({ appearance }),
  setSidebar: (sidebar) => set({ sidebar }),
  setInspector: (inspector) => set({ inspector }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
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
  markSaved: () => set({ lastSaved: Date.now() }),

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

  selectWire: (wireId, additive = false) => {
    const { doc } = get();
    const idx = doc.wires.findIndex((w) => w.id === wireId);
    if (idx < 0) return;
    const nl = buildNetlist(doc);
    const net = nl.wireNet[idx];
    const ids = net === undefined ? [wireId] : nl.nets[net].wires.map((i) => doc.wires[i].id);
    set((s) => ({
      selWires: additive ? Array.from(new Set([...s.selWires, ...ids])) : Array.from(new Set(ids)),
      selComps: additive ? s.selComps : [],
    }));
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

  duplicateSelection: () => {
    const { selComps, selWires, doc } = get();
    if (!selComps.length && !selWires.length) return;
    const idMap = new Map<string, string>();
    const comps = doc.comps
      .filter((c) => selComps.includes(c.id))
      .map((c) => {
        const nid = uid('c');
        idMap.set(c.id, nid);
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
        for (const c of d.comps) {
          if (selComps.includes(c.id)) c.at = { x: c.at.x + dx, y: c.at.y + dy };
        }
      },
      { coalesce: 'nudge' },
    );
  },

  addComp: (kind, at, facing = 'east') => {
    const comp = createComp(kind, at, facing, get().lang);
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
        if (patch.at) c.at = { x: Math.round(patch.at.x), y: Math.round(patch.at.y) };
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
