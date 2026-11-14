import { useEffect, useRef } from 'react';
import { useEditor } from '../editor/store';
import { sim } from '../model/sim';
import { drawScene, type WiringPreview } from './draw';
import { PALETTES } from './theme';
import { useT } from '../ui/useT';
import { viewControls } from './view';
import {
  cloneDoc,
  type ComponentInstance,
  type CompKind,
  type Doc,
  type Facing,
  type Point,
  snap,
  snapPoint,
} from '../model/types';
import {
  centerWorld,
  contentBounds,
  hitTest,
  portOutward,
  routeWire,
  rotatedBounds,
  snapWireEnd,
  type Bounds,
  type Hit,
} from '../model/geometry';
import { computeSubLayout } from '../model/hierarchy';
import { SPEC_BY_KIND, createComp } from '../model/specs';
import { CanvasEmptyHint, CanvasToolbar } from '../ui/CanvasToolbar';

type Interaction =
  | { mode: 'idle' }
  | {
      mode: 'pan';
      startScreen: Point;
      panStart: Point;
    }
  | {
      mode: 'marquee';
      start: Point;
      current: Point;
      startScreen: Point;
      additive: boolean;
    }
  | {
      mode: 'move';
      startWorld: Point;
      startScreen: Point;
      before: Doc;
      origin: Map<string, Point>;
      comp: ComponentInstance;
      additive: boolean;
      moved: boolean;
    }
  | {
      mode: 'wire';
      start: Point;
      startFacing?: Facing;
      startPort?: { compId: string; portName: string };
      startScreen: Point;
      moved: boolean;
      points: Point[];
      targetPort?: { compId: string; portName: string } | null;
      invalid: boolean;
    };

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3.2;

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

export default function Canvas() {
  const { t } = useT();
  const canvasTheme = useEditor((s) => s.canvasTheme);
  const empty = useEditor(
    (s) =>
      s.welcomeClosed && !s.pendingKind && s.doc.comps.length === 0 && s.doc.wires.length === 0,
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const dirtyRef = useRef(true);
  const hoverRef = useRef<Hit>(null);
  const ghostRef = useRef<ComponentInstance | null>(null);
  const wiringRef = useRef<WiringPreview | null>(null);
  const marqueeRef = useRef<Bounds | null>(null);
  const interactionRef = useRef<Interaction>({ mode: 'idle' });
  const spaceRef = useRef(false);
  const placeFacingRef = useRef<Facing>('east');
  const gestureRef = useRef<{ zoom: number; pan: Point; sx: number; sy: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let disposed = false;

    const state = () => useEditor.getState();
    const invalidate = () => {
      dirtyRef.current = true;
    };

    const toWorld = (clientX: number, clientY: number): Point => {
      const st = state();
      const r = canvas.getBoundingClientRect();
      return { x: (clientX - r.left - st.pan.x) / st.zoom, y: (clientY - r.top - st.pan.y) / st.zoom };
    };

    const toScreen = (clientX: number, clientY: number): Point => {
      const r = canvas.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };

    const setView = (zoom: number, pan: Point) => {
      state().setView(zoom, pan);
      invalidate();
    };

    const viewCenter = () => ({ x: sizeRef.current.w / 2, y: sizeRef.current.h / 2 });

    const resetView = () => {
      const c = viewCenter();
      setView(1.25, { x: c.x, y: c.y });
    };

    const fitView = () => {
      const { w, h } = sizeRef.current;
      if (!w || !h) return;
      const b = contentBounds(state().doc);
      if (!b) {
        resetView();
        return;
      }
      const pad = Math.min(120, Math.max(48, Math.min(w, h) * 0.12));
      const z = clampZoom(Math.min((w - pad * 2) / Math.max(b.w, 40), (h - pad * 2) / Math.max(b.h, 40), 2));
      const pan = {
        x: w / 2 - (b.x + b.w / 2) * z,
        y: h / 2 - (b.y + b.h / 2) * z,
      };
      state().setView(z, pan);
      invalidate();
    };

    const zoomAt = (factor: number, sx: number, sy: number) => {
      const st = state();
      const z = clampZoom(st.zoom * factor);
      if (Math.abs(z - st.zoom) < 1e-4) return;
      const wx = (sx - st.pan.x) / st.zoom;
      const wy = (sy - st.pan.y) / st.zoom;
      setView(z, { x: sx - wx * z, y: sy - wy * z });
    };

    viewControls.centerWorld = () => {
      const st = state();
      const c = viewCenter();
      return { x: (c.x - st.pan.x) / st.zoom, y: (c.y - st.pan.y) / st.zoom };
    };
    viewControls.fit = fitView;
    viewControls.zoomIn = () => {
      const c = viewCenter();
      zoomAt(1.25, c.x, c.y);
    };
    viewControls.zoomOut = () => {
      const c = viewCenter();
      zoomAt(1 / 1.25, c.x, c.y);
    };
    viewControls.reset = resetView;
    viewControls.invalidate = invalidate;

    const setCursor = () => {
      const st = state();
      const inter = interactionRef.current;
      let cursor = 'default';
      if (inter.mode === 'pan') cursor = 'grabbing';
      else if (inter.mode === 'wire') cursor = 'crosshair';
      else if (inter.mode === 'move') cursor = 'grabbing';
      else if (spaceRef.current || st.tool === 'pan') cursor = 'grab';
      else if (st.pendingKind) cursor = 'crosshair';
      else if (st.tool === 'wire') cursor = 'crosshair';
      else if (hoverRef.current?.type === 'port') cursor = 'crosshair';
      else if (hoverRef.current?.type === 'comp') {
        cursor = hoverRef.current.comp.kind === 'input' || hoverRef.current.comp.kind === 'button' ? 'pointer' : 'move';
      } else if (hoverRef.current?.type === 'wire') cursor = 'pointer';
      canvas.style.cursor = cursor;
    };

    const pointOnWire = (w: { a: Point; b: Point }, p: Point): Point => {
      if (Math.abs(w.a.x - w.b.x) < 0.01) {
        return { x: w.a.x, y: Math.max(Math.min(w.a.y, w.b.y), Math.min(Math.max(w.a.y, w.b.y), Math.round(p.y))) };
      }
      return { x: Math.max(Math.min(w.a.x, w.b.x), Math.min(Math.max(w.a.x, w.b.x), Math.round(p.x))), y: w.a.y };
    };

    const beginWire = (hit: Hit, world: Point, screen: Point) => {
      let start: Point;
      let startFacing: Facing | undefined;
      let startPort: { compId: string; portName: string } | undefined;
      if (hit?.type === 'port') {
        start = hit.port.world;
        startFacing = portOutward(hit.comp, hit.port);
        startPort = { compId: hit.comp.id, portName: hit.port.name };
      } else if (hit?.type === 'wire') {
        const w = state().doc.wires.find((x) => x.id === hit.wireId);
        start = w ? pointOnWire(w, world) : snapPoint(world);
      } else {
        start = snapPoint(world);
      }
      state().clearSelection();
      interactionRef.current = {
        mode: 'wire',
        start,
        startFacing,
        startPort,
        startScreen: screen,
        moved: false,
        points: [start, start],
        targetPort: null,
        invalid: false,
      };
      wiringRef.current = { points: [start, start], targetPort: null, startPort };
      invalidate();
      setCursor();
    };

    const placeAt = (kind: CompKind, world: Point, facing: Facing) => {
      const temp = createComp(kind, { x: 0, y: 0 }, facing, state().lang);
      const c = centerWorld(temp);
      const anchor = snapPoint({ x: world.x - c.x, y: world.y - c.y });
      state().addComp(kind, anchor, facing);
      ghostRef.current = null;
      invalidate();
    };

    const updateGhost = (world: Point) => {
      const st = state();
      if (!st.pendingKind) {
        ghostRef.current = null;
        return;
      }
      const temp = createComp(st.pendingKind, { x: 0, y: 0 }, placeFacingRef.current, st.lang);
      const c = centerWorld(temp);
      const anchor = snapPoint({ x: world.x - c.x, y: world.y - c.y });
      ghostRef.current = { ...temp, at: anchor };
    };

    const updateHover = (world: Point) => {
      const st = state();
      if (st.pendingKind) {
        hoverRef.current = null;
        updateGhost(world);
        setCursor();
        invalidate();
        return;
      }
      ghostRef.current = null;
      const portRadius = 9 / st.zoom;
      const hit = hitTest(st.doc.comps, st.doc.wires, world, portRadius);
      hoverRef.current = hit;
      setCursor();
      invalidate();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 2) return;
      const st = state();
      const world = toWorld(e.clientX, e.clientY);
      const screen = toScreen(e.clientX, e.clientY);
      canvas.setPointerCapture?.(e.pointerId);
      if (e.button === 1 || (e.button === 0 && (spaceRef.current || st.tool === 'pan'))) {
        e.preventDefault();
        interactionRef.current = {
          mode: 'pan',
          startScreen: screen,
          panStart: { ...st.pan },
        };
        st.setDragMode('pan');
        setCursor();
        return;
      }
      if (e.button !== 0) return;
      e.preventDefault();
      canvas.focus?.();

      if (st.pendingKind) {
        placeAt(st.pendingKind, world, placeFacingRef.current);
        return;
      }

      const portRadius = 9 / st.zoom;
      const hit = hitTest(st.doc.comps, st.doc.wires, world, portRadius);

      if (st.tool === 'wire') {
        beginWire(hit, world, screen);
        return;
      }
      if (hit?.type === 'port') {
        beginWire(hit, world, screen);
        return;
      }
      if (hit?.type === 'comp') {
        const additive = e.shiftKey || e.metaKey;
        const comp = hit.comp;
        if (additive) {
          if (st.selComps.includes(comp.id)) {
            st.select(
              st.selComps.filter((id) => id !== comp.id),
              st.selWires,
            );
            invalidate();
            return;
          }
          st.selectComp(comp.id, true);
        } else if (!st.selComps.includes(comp.id)) {
          st.selectComp(comp.id);
        }
        const now = state();
        const origin = new Map<string, Point>();
        for (const c of now.doc.comps) {
          if (now.selComps.includes(c.id)) origin.set(c.id, { ...c.at });
        }
        interactionRef.current = {
          mode: 'move',
          startWorld: world,
          startScreen: screen,
          before: cloneDoc(now.doc),
          origin,
          comp: now.doc.comps.find((c) => c.id === comp.id) ?? comp,
          additive,
          moved: false,
        };
        if (comp.kind === 'button' && !additive) sim.setButton(comp.id, true);
        st.setDragMode('move');
        invalidate();
        setCursor();
        return;
      }
      if (hit?.type === 'wire') {
        if (e.altKey) st.selectWireNet(hit.wireId, e.shiftKey || e.metaKey);
        else st.selectWire(hit.wireId, e.shiftKey || e.metaKey);
        st.setMenu(null);
        invalidate();
        return;
      }

      if (!e.shiftKey && !e.metaKey) st.clearSelection();
      interactionRef.current = {
        mode: 'marquee',
        start: world,
        current: world,
        startScreen: screen,
        additive: e.shiftKey || e.metaKey,
      };
      marqueeRef.current = { x: world.x, y: world.y, w: 0, h: 0 };
      st.setDragMode('marquee');
      invalidate();
      setCursor();
    };

    const onPointerMove = (e: PointerEvent) => {
      const st = state();
      const inter = interactionRef.current;
      const world = toWorld(e.clientX, e.clientY);
      const screen = toScreen(e.clientX, e.clientY);

      if (inter.mode === 'pan') {
        const dx = screen.x - inter.startScreen.x;
        const dy = screen.y - inter.startScreen.y;
        setView(st.zoom, { x: inter.panStart.x + dx, y: inter.panStart.y + dy });
        st.setCursorWorld({ x: Math.round(world.x), y: Math.round(world.y) });
        return;
      }
      st.setCursorWorld({ x: Math.round(world.x), y: Math.round(world.y) });

      if (inter.mode === 'move') {
        const dist = Math.hypot(screen.x - inter.startScreen.x, screen.y - inter.startScreen.y);
        if (dist > 3) inter.moved = true;
        if (inter.moved) {
          const grid = e.shiftKey ? 1 : 10;
          const dx = snap(world.x - inter.startWorld.x, grid);
          const dy = snap(world.y - inter.startWorld.y, grid);
          st.mutate(
            (d) => {
              for (const c of d.comps) {
                const o = inter.origin.get(c.id);
                if (o) c.at = { x: o.x + dx, y: o.y + dy };
              }
            },
            { history: false },
          );
          invalidate();
        }
        return;
      }

      if (inter.mode === 'marquee') {
        inter.current = world;
        const m: Bounds = {
          x: Math.min(inter.start.x, world.x),
          y: Math.min(inter.start.y, world.y),
          w: Math.abs(world.x - inter.start.x),
          h: Math.abs(world.y - inter.start.y),
        };
        marqueeRef.current = m;
        invalidate();
        return;
      }

      if (inter.mode === 'wire') {
        if (Math.hypot(screen.x - inter.startScreen.x, screen.y - inter.startScreen.y) > 3) {
          inter.moved = true;
        }
        const portRadius = 10 / st.zoom;
        const target = snapWireEnd(world, st.doc.comps, st.doc.wires, portRadius);
        const end = target.point;
        const endFacing = target.port && target.comp ? portOutward(target.comp, target.port) : undefined;
        const sameAsStart = Math.abs(end.x - inter.start.x) < 0.1 && Math.abs(end.y - inter.start.y) < 0.1;
        const obstacles = st.doc.comps
          .filter((c) => c.kind !== 'text' && c.kind !== 'tunnel')
          .map((c) => rotatedBounds(c));
        const pts = sameAsStart
          ? [inter.start, end]
          : routeWire(inter.start, end, {
              startFacing: inter.startFacing,
              endFacing,
              flip: e.shiftKey,
              obstacles,
            });
        inter.points = pts;
        inter.targetPort = target.port && target.comp ? { compId: target.comp.id, portName: target.port.name } : null;
        inter.invalid = sameAsStart;
        wiringRef.current = {
          points: pts,
          targetPort: inter.targetPort,
          startPort: inter.startPort,
          invalid: sameAsStart,
        };
        invalidate();
        return;
      }

      updateHover(world);
    };

    const finishMoveClick = (inter: Extract<Interaction, { mode: 'move' }>, moved: boolean) => {
      const st = state();
      const comp = st.doc.comps.find((c) => c.id === inter.comp.id);
      if (moved) {
        st.commitSnapshot(inter.before);
      } else if (comp) {
        if (comp.kind === 'input') {
          sim.togglePin(comp);
          invalidate();
        }
      }
      if (comp?.kind === 'button') sim.setButton(comp.id, false);
      if (comp?.kind === 'input' && (comp.attrs.bits ?? 1) > 1) {
        // Value editing for multi-bit pins lives in the inspector.
      }
      st.setDragMode(null);
      interactionRef.current = { mode: 'idle' };
      invalidate();
      setCursor();
    };

    const onPointerUp = (e: PointerEvent) => {
      const st = state();
      const inter = interactionRef.current;
      const world = toWorld(e.clientX, e.clientY);

      if (inter.mode === 'pan') {
        interactionRef.current = { mode: 'idle' };
        st.setDragMode(null);
        setCursor();
        return;
      }
      if (inter.mode === 'move') {
        finishMoveClick(inter, inter.moved);
        return;
      }
      if (inter.mode === 'wire') {
        const pts = inter.points;
        const len = pts.reduce(
          (acc, p, i) => (i === 0 ? 0 : acc + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y)),
          0,
        );
        if (!inter.moved && inter.startPort) {
          const comp = st.doc.comps.find((c) => c.id === inter.startPort!.compId);
          if (comp && st.tool === 'select') {
            if (comp.kind === 'input' && (comp.attrs.bits ?? 1) === 1) sim.togglePin(comp);
            st.selectComp(comp.id);
            invalidate();
          }
        } else if (len > 0.5 && !inter.invalid) {
          st.addWirePath(pts);
        }
        wiringRef.current = null;
        interactionRef.current = { mode: 'idle' };
        st.setDragMode(null);
        invalidate();
        setCursor();
        return;
      }
      if (inter.mode === 'marquee') {
        const m = marqueeRef.current ?? { x: 0, y: 0, w: 0, h: 0 };
        if (m.w > 0.5 || m.h > 0.5) {
          const x0 = m.x;
          const y0 = m.y;
          const x1 = m.x + m.w;
          const y1 = m.y + m.h;
          const selectedComps: string[] = [];
          for (const c of st.doc.comps) {
            const b = rotatedBounds(c);
            if (b.x <= x1 && b.x + b.w >= x0 && b.y <= y1 && b.y + b.h >= y0) selectedComps.push(c.id);
          }
          const selectedWires: string[] = [];
          for (const w of st.doc.wires) {
            const bx0 = Math.min(w.a.x, w.b.x);
            const bx1 = Math.max(w.a.x, w.b.x);
            const by0 = Math.min(w.a.y, w.b.y);
            const by1 = Math.max(w.a.y, w.b.y);
            if (bx0 <= x1 && bx1 >= x0 && by0 <= y1 && by1 >= y0) selectedWires.push(w.id);
          }
          st.select(selectedComps, selectedWires, inter.additive);
        }
        marqueeRef.current = null;
        interactionRef.current = { mode: 'idle' };
        st.setDragMode(null);
        invalidate();
        setCursor();
        return;
      }
      // unreachable, but keep the cursor fresh
      updateHover(world);
    };

    const onPointerCancel = () => {
      const st = state();
      const inter = interactionRef.current;
      if (inter.mode === 'move') {
        st.commitSnapshot(inter.before);
        if (inter.comp.kind === 'button') sim.setButton(inter.comp.id, false);
      }
      wiringRef.current = null;
      marqueeRef.current = null;
      interactionRef.current = { mode: 'idle' };
      st.setDragMode(null);
      invalidate();
      setCursor();
    };

    const onWheel = (e: WheelEvent) => {
      const st = state();
      const screen = toScreen(e.clientX, e.clientY);
      const scale = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(Math.exp(-e.deltaY * scale * 0.0035), screen.x, screen.y);
      } else {
        e.preventDefault();
        setView(st.zoom, {
          x: st.pan.x - e.deltaX * scale,
          y: st.pan.y - e.deltaY * scale,
        });
      }
    };

    const onGestureStart = (e: Event) => {
      const ge = e as unknown as { clientX: number; clientY: number; preventDefault: () => void };
      const st = state();
      const screen = toScreen(ge.clientX, ge.clientY);
      gestureRef.current = { zoom: st.zoom, pan: { ...st.pan }, sx: screen.x, sy: screen.y };
      ge.preventDefault();
    };
    const onGestureChange = (e: Event) => {
      const ge = e as unknown as { scale: number; clientX: number; clientY: number; preventDefault: () => void };
      const g = gestureRef.current;
      if (!g) return;
      ge.preventDefault();
      const z = clampZoom(g.zoom * ge.scale);
      const wx = (g.sx - g.pan.x) / g.zoom;
      const wy = (g.sy - g.pan.y) / g.zoom;
      setView(z, { x: g.sx - wx * z, y: g.sy - wy * z });
    };
    const onGestureEnd = () => {
      gestureRef.current = null;
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const st = state();
      const world = toWorld(e.clientX, e.clientY);
      const hit = hitTest(st.doc.comps, st.doc.wires, world, 9 / st.zoom);
      if (hit?.type === 'port') {
        if (!st.selComps.includes(hit.comp.id)) st.selectComp(hit.comp.id);
        st.setMenu({ x: e.clientX, y: e.clientY, target: 'comp', world });
      } else if (hit?.type === 'comp') {
        if (!st.selComps.includes(hit.comp.id)) st.selectComp(hit.comp.id);
        st.setMenu({ x: e.clientX, y: e.clientY, target: 'comp', world });
      } else if (hit?.type === 'wire') {
        st.selectWire(hit.wireId);
        st.setMenu({ x: e.clientX, y: e.clientY, target: 'wire', wireId: hit.wireId, world });
      } else {
        st.clearSelection();
        st.setMenu({ x: e.clientX, y: e.clientY, target: 'canvas', world });
      }
      invalidate();
    };
    const onPointerLeave = () => state().setCursorWorld(null);
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('text/plain')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    };
    const onDrop = (e: DragEvent) => {
      const text = e.dataTransfer?.getData('text/plain') ?? '';
      const world = toWorld(e.clientX, e.clientY);
      if (text.startsWith('sub:')) {
        e.preventDefault();
        const targetId = text.slice(4);
        const target = state().circuits[targetId];
        if (target) {
          const layout = computeSubLayout(target);
          const anchor = snapPoint({ x: world.x - layout.subW / 2, y: world.y - layout.subH / 2 });
          state().addSubcircuit(targetId, anchor, placeFacingRef.current);
          invalidate();
        }
        e.stopPropagation();
        return;
      }
      const kind = text as CompKind;
      if (!kind || !SPEC_BY_KIND[kind]) return;
      e.preventDefault();
      placeAt(kind, world, placeFacingRef.current);
      e.stopPropagation();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        if (e.key === 'Escape') t.blur();
        return;
      }
      const st = state();
      if (st.paletteOpen || st.shortcutsOpen || st.menu) return;
      if (!st.welcomeClosed && st.doc.comps.length === 0 && st.doc.wires.length === 0) return;

      if (e.code === 'Space') {
        if (!spaceRef.current) {
          spaceRef.current = true;
          setCursor();
        }
        e.preventDefault();
        return;
      }
      const meta = e.metaKey || e.ctrlKey;
      if (meta) {
        const k = e.key.toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) st.redo();
          else st.undo();
          invalidate();
        } else if (k === 'd') {
          e.preventDefault();
          st.duplicateSelection();
          invalidate();
        } else if (k === 'a') {
          e.preventDefault();
          st.selectAll();
          invalidate();
        } else if (k === '=' || k === '+') {
          e.preventDefault();
          viewControls.zoomIn();
        } else if (k === '-') {
          e.preventDefault();
          viewControls.zoomOut();
        } else if (k === '0') {
          e.preventDefault();
          viewControls.fit();
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        const inter = interactionRef.current;
        if (inter.mode === 'wire') {
          interactionRef.current = { mode: 'idle' };
          wiringRef.current = null;
          invalidate();
        } else if (st.pendingKind) {
          st.setPendingKind(null);
          ghostRef.current = null;
          setCursor();
          invalidate();
        } else if (st.tool !== 'select') {
          st.setTool('select');
          setCursor();
        } else if (st.selComps.length || st.selWires.length) {
          st.clearSelection();
          invalidate();
        }
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (st.selComps.length || st.selWires.length) {
          e.preventDefault();
          st.deleteSelection();
          invalidate();
        }
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (st.pendingKind) {
          placeFacingRef.current =
            e.shiftKey
              ? placeFacingRef.current === 'east'
                ? 'north'
                : placeFacingRef.current === 'north'
                  ? 'west'
                  : placeFacingRef.current === 'west'
                    ? 'south'
                    : 'east'
              : placeFacingRef.current === 'east'
                ? 'south'
                : placeFacingRef.current === 'south'
                  ? 'west'
                  : placeFacingRef.current === 'west'
                    ? 'north'
                    : 'east';
          const w = toWorld(lastPointer.x, lastPointer.y);
          updateGhost(w);
          invalidate();
        } else if (st.selComps.length) {
          st.rotateSelection(e.shiftKey ? -1 : 1);
          invalidate();
        }
        return;
      }
      if (['v', 'V', 'h', 'H', 'w', 'W', 'g', 'G'].includes(e.key)) {
        const k = e.key.toLowerCase();
        if (k === 'v') {
          st.setTool('select');
          st.setPendingKind(null);
        } else if (k === 'h') {
          st.setTool('pan');
        } else if (k === 'w') {
          st.setTool('wire');
        } else if (k === 'g') {
          st.setShowGrid(!st.showGrid);
        }
        setCursor();
        invalidate();
        return;
      }
      if (e.key === 'Enter') {
        if (st.selComps.length) {
          for (const id of st.selComps) {
            const c = st.doc.comps.find((x) => x.id === id);
            if (c?.kind === 'input' && (c.attrs.bits ?? 1) === 1) sim.togglePin(c);
          }
          invalidate();
        }
        return;
      }
      if (e.key.startsWith('Arrow')) {
        if (!st.selComps.length && !st.selWires.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 1 : 10;
        if (st.selComps.length) {
          if (e.key === 'ArrowLeft') st.nudgeSelection(-step, 0);
          if (e.key === 'ArrowRight') st.nudgeSelection(step, 0);
          if (e.key === 'ArrowUp') st.nudgeSelection(0, -step);
          if (e.key === 'ArrowDown') st.nudgeSelection(0, step);
        }
        invalidate();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setCursor();
      }
    };

    const lastPointer = { x: -1, y: -1 };
    const onGlobalMove = (e: PointerEvent) => {
      lastPointer.x = e.clientX;
      lastPointer.y = e.clientY;
    };

    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (!w || !h) return;
      const old = sizeRef.current;
      const st = state();
      if (old.w && old.h && (old.w !== w || old.h !== h)) {
        st.setView(st.zoom, {
          x: st.pan.x + (w - old.w) / 2,
          y: st.pan.y + (h - old.h) / 2,
        });
      }
      sizeRef.current = { w, h };
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (!old.w) {
        const b = contentBounds(st.doc);
        if (b) fitView();
        else resetView();
      }
      invalidate();
    });
    ro.observe(wrap);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('gesturestart', onGestureStart as EventListener);
    canvas.addEventListener('gesturechange', onGestureChange as EventListener);
    canvas.addEventListener('gestureend', onGestureEnd);
    canvas.addEventListener('contextmenu', onContextMenu);
    canvas.addEventListener('dragover', onDragOver);
    canvas.addEventListener('drop', onDrop);
    window.addEventListener('pointermove', onGlobalMove, { passive: true });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const unsubscribe = useEditor.subscribe((s, prev) => {
      if (
        s.doc !== prev.doc ||
        s.selComps !== prev.selComps ||
        s.selWires !== prev.selWires ||
        s.zoom !== prev.zoom ||
        s.pan !== prev.pan ||
        s.showGrid !== prev.showGrid ||
        s.canvasTheme !== prev.canvasTheme ||
        s.pendingKind !== prev.pendingKind ||
        s.running !== prev.running ||
        s.tool !== prev.tool
      ) {
        invalidate();
      }
    });

    const draw = (now: number) => {
      const { w, h } = sizeRef.current;
      if (!w || !h) return;
      const st = state();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      sim.update(st.doc, st.circuits);
      sim.frame(now, st.running);
      drawScene({
        ctx,
        doc: st.doc,
        sim,
        selComps: st.selComps,
        selWires: st.selWires,
        hover: hoverRef.current,
        ghost: ghostRef.current,
        wiring: wiringRef.current,
        marquee: marqueeRef.current,
        theme: st.canvasTheme,
        zoom: st.zoom,
        pan: st.pan,
        width: w,
        height: h,
        showGrid: st.showGrid,
        running: st.running,
        now,
        lang: st.lang,
      });
    };

    let lastDraw = 0;
    let lastTick = -1;
    const frame = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      const st = state();
      const animating = st.running;
      if (!dirtyRef.current && !animating) return;
      // Stay around 60fps even on 120Hz displays.
      if (animating && now - lastDraw < 12) return;
      lastDraw = now;
      draw(now);
      if (sim.tick !== lastTick) {
        lastTick = sim.tick;
        state().setSimTick(sim.tick);
      }
      dirtyRef.current = false;
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      unsubscribe();
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('gesturestart', onGestureStart as EventListener);
      canvas.removeEventListener('gesturechange', onGestureChange as EventListener);
      canvas.removeEventListener('gestureend', onGestureEnd);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('dragover', onDragOver);
      canvas.removeEventListener('drop', onDrop);
      window.removeEventListener('pointermove', onGlobalMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden"
      style={{ background: PALETTES[canvasTheme].bg }}
    >
      <canvas
        ref={canvasRef}
        tabIndex={-1}
        role="application"
        aria-label={t('aria.canvas')}
        className="block h-full w-full outline-none"
        onPointerDown={(e) => {
          // Ensure keyboard shortcuts work without focusing a text field.
          (e.currentTarget as HTMLCanvasElement).focus();
        }}
      />
      <CanvasEmptyHint empty={empty} />
      <CanvasToolbar />
    </div>
  );
}

