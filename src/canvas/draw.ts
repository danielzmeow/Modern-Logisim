import type { ComponentInstance, Doc, Point, CanvasTheme, Facing } from '../model/types';
import { isGate, KIND_NAMES, KIND_NAMES_EN, pointKey } from '../model/types';
import type { Lang } from '../i18n';
import { geom, rotatedBounds, portsOf, estimateTextWidth, type Hit, type Bounds } from '../model/geometry';
import { maskFor, type Simulator } from '../model/sim';
import { PALETTES, LED_COLORS, UI_FONT, MONO_FONT, type Palette } from './theme';

export interface WiringPreview {
  points: Point[];
  targetPort?: { compId: string; portName: string } | null;
  startPort?: { compId: string; portName: string } | null;
  invalid?: boolean;
}

export interface SceneOptions {
  ctx: CanvasRenderingContext2D;
  doc: Doc;
  sim: Simulator;
  selComps: string[];
  selWires: string[];
  hover: Hit;
  ghost?: ComponentInstance | null;
  wiring?: WiringPreview | null;
  marquee?: Bounds | null;
  theme: CanvasTheme;
  zoom: number;
  pan: Point;
  width: number;
  height: number;
  showGrid: boolean;
  running: boolean;
  now: number;
  lang: Lang;
}

const UI = UI_FONT;
const MONO = MONO_FONT;

function facingAngle(f: Facing): number {
  return f === 'east' ? 0 : f === 'south' ? Math.PI / 2 : f === 'west' ? Math.PI : (Math.PI * 3) / 2;
}

/** Draw text at a component-local point but keep it upright in screen space. */
function uprightText(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  x: number,
  y: number,
  draw: () => void,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-facingAngle(comp.facing));
  draw();
  ctx.restore();
}

export function formatValue(v: number, bits: number): string {
  const b = Math.max(1, Math.min(32, bits));
  if (b === 1) return String(v & 1);
  const digits = Math.ceil(b / 4);
  return ((v >>> 0) & maskFor(b)).toString(16).toUpperCase().padStart(digits, '0');
}

const dotCache = new WeakMap<Doc, Point[]>();

function junctionDots(doc: Doc): Point[] {
  const hit = dotCache.get(doc);
  if (hit) return hit;
  const counts = new Map<string, { p: Point; n: number; t: boolean }>();
  const add = (p: Point) => {
    const k = pointKey(p);
    const cur = counts.get(k);
    if (cur) cur.n++;
    else counts.set(k, { p: { x: Math.round(p.x), y: Math.round(p.y) }, n: 1, t: false });
  };
  for (const w of doc.wires) {
    add(w.a);
    add(w.b);
  }
  for (const w of doc.wires) {
    for (const info of counts.values()) {
      if (Math.abs(info.p.x - w.a.x) < 0.1 && Math.abs(info.p.y - w.a.y) < 0.1) continue;
      if (Math.abs(info.p.x - w.b.x) < 0.1 && Math.abs(info.p.y - w.b.y) < 0.1) continue;
      const onX = Math.abs(w.a.x - w.b.x) < 0.1;
      const inside = onX
        ? Math.abs(info.p.x - w.a.x) < 0.1 &&
          info.p.y > Math.min(w.a.y, w.b.y) + 0.1 &&
          info.p.y < Math.max(w.a.y, w.b.y) - 0.1
        : Math.abs(info.p.y - w.a.y) < 0.1 &&
          info.p.x > Math.min(w.a.x, w.b.x) + 0.1 &&
          info.p.x < Math.max(w.a.x, w.b.x) - 0.1;
      if (inside) {
        info.t = true;
        break;
      }
    }
  }
  const out: Point[] = [];
  for (const info of counts.values()) {
    if (info.n >= 3 || (info.n >= 1 && info.t)) out.push(info.p);
  }
  dotCache.set(doc, out);
  return out;
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  zoom: number,
  width: number,
  height: number,
  pan: Point,
) {
  const x0 = -pan.x / zoom;
  const y0 = -pan.y / zoom;
  const x1 = (width - pan.x) / zoom;
  const y1 = (height - pan.y) / zoom;
  const r = 1 / zoom;
  if (zoom >= 0.7) {
    ctx.fillStyle = pal.grid;
    const startX = Math.floor(x0 / 10) * 10;
    const startY = Math.floor(y0 / 10) * 10;
    for (let x = startX; x <= x1; x += 10) {
      if (Math.abs(x % 50) < 0.01) continue;
      for (let y = startY; y <= y1; y += 10) {
        if (Math.abs(y % 50) < 0.01) continue;
        ctx.fillRect(x - r * 0.55, y - r * 0.55, r * 1.1, r * 1.1);
      }
    }
  }
  ctx.fillStyle = pal.gridMajor;
  const majorR = r * 1.35;
  const startX = Math.floor(x0 / 50) * 50;
  const startY = Math.floor(y0 / 50) * 50;
  for (let x = startX; x <= x1; x += 50) {
    for (let y = startY; y <= y1; y += 50) {
      ctx.fillRect(x - majorR / 2, y - majorR / 2, majorR, majorR);
    }
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawLabelAbove(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  text: string,
  pal: Palette,
  zoom: number,
  opts: { mono?: boolean; color?: string } = {},
) {
  if (!text) return;
  const b = rotatedBounds(comp);
  ctx.save();
  ctx.font = `500 ${opts.mono ? 10 : 11}px ${opts.mono ? MONO : UI}`;
  ctx.fillStyle = opts.color ?? pal.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const y = b.y - 6 / zoom;
  ctx.fillText(text, b.x + b.w / 2, y);
  ctx.restore();
}

function drawGate(ctx: CanvasRenderingContext2D, comp: ComponentInstance, g: ReturnType<typeof geom>, pal: Palette, bubble: boolean) {
  const size = comp.attrs.size === 30 || comp.attrs.size === 70 ? comp.attrs.size : 50;
  const h = g.h;
  const hh = h / 2;
  const bodyRight = bubble ? -10 : 0;
  const bodyLeft = -size;
  const kind = comp.kind;

  ctx.beginPath();
  if (kind === 'not') {
    ctx.moveTo(-30, -10);
    ctx.lineTo(-10, 0);
    ctx.lineTo(-30, 10);
    ctx.closePath();
  } else if (kind === 'and' || kind === 'nand') {
    const r = hh;
    ctx.moveTo(bodyLeft, -hh);
    ctx.lineTo(bodyRight - r, -hh);
    ctx.arc(bodyRight - r, 0, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(bodyLeft, hh);
    ctx.closePath();
  } else {
    const bw = bodyRight - bodyLeft;
    ctx.moveTo(bodyLeft, -hh);
    ctx.bezierCurveTo(bodyLeft + bw * 0.5, -hh * 0.9, bodyRight - bw * 0.08, -hh * 0.55, bodyRight, 0);
    ctx.bezierCurveTo(bodyRight - bw * 0.08, hh * 0.55, bodyLeft + bw * 0.5, hh * 0.9, bodyLeft, hh);
    ctx.quadraticCurveTo(bodyLeft + bw * 0.2, 0, bodyLeft, -hh);
    ctx.closePath();
  }
  ctx.fillStyle = pal.gateFill;
  ctx.fill();
  ctx.strokeStyle = pal.chipStroke;
  ctx.lineWidth = 1.6;
  ctx.lineJoin = 'round';
  ctx.stroke();

  if (kind === 'not') {
    ctx.beginPath();
    ctx.arc(-5, 0, 5, 0, Math.PI * 2);
    ctx.fillStyle = pal.gateFill;
    ctx.fill();
    ctx.strokeStyle = pal.chipStroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  if (kind === 'xor' || kind === 'xnor') {
    ctx.beginPath();
    const bw = bodyRight - bodyLeft;
    const back = bodyLeft - 5;
    ctx.moveTo(back, -hh);
    ctx.quadraticCurveTo(back + bw * 0.2, 0, back, hh);
    ctx.strokeStyle = pal.chipStroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  if (bubble) {
    ctx.beginPath();
    ctx.arc(bodyRight + 5, 0, 5, 0, Math.PI * 2);
    ctx.fillStyle = pal.gateFill;
    ctx.fill();
    ctx.strokeStyle = pal.chipStroke;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  // Input leads for curved gates.
  if (kind === 'or' || kind === 'nor' || kind === 'xor' || kind === 'xnor') {
    ctx.strokeStyle = pal.chipStroke;
    ctx.lineWidth = 1.6;
    for (const p of g.ports) {
      if (p.dir !== 'in') continue;
      ctx.beginPath();
      ctx.moveTo(p.local.x, p.local.y);
      ctx.lineTo(p.local.x + 14, p.local.y);
      ctx.stroke();
    }
  }
}

function drawPinBody(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  g: ReturnType<typeof geom>,
  pal: Palette,
  value: string,
  isHigh: boolean,
  isButton = false,
  pressed = false,
) {
  roundedRect(ctx, g.x + 0.8, g.y + 0.8, g.w - 1.6, g.h - 1.6, 5);
  ctx.fillStyle = isButton && pressed ? pal.accentSoft : pal.chipFill;
  if (isHigh && (comp.kind === 'input' || comp.kind === 'output')) {
    ctx.fillStyle = pal.accentSoft;
  }
  ctx.fill();
  ctx.strokeStyle = pal.chipStroke;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  if (isButton) {
    const cx = g.x + 10;
    const r = 4.5;
    ctx.beginPath();
    ctx.arc(cx, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = pressed ? pal.accent : pal.chipFill;
    ctx.fill();
    ctx.strokeStyle = pal.chipStroke;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  ctx.save();
  ctx.font = `600 ${value.length > 3 ? 8.5 : 9.5}px ${MONO}`;
  ctx.fillStyle = isHigh ? pal.wireHigh : pal.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = g.x + g.w / 2 + (isButton ? 4 : 0);
  uprightText(ctx, comp, cx, 0.5, () => ctx.fillText(value, 0, 0));
  ctx.restore();
}

function drawComponentInner(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  pal: Palette,
  sim: Simulator,
  ghost: boolean,
) {
  const g = geom(comp);
  const kind = comp.kind;

  if (isGate(kind)) {
    drawGate(ctx, comp, g, pal, kind === 'nand' || kind === 'nor' || kind === 'xnor');
    return;
  }

  switch (kind) {
    case 'input':
    case 'output':
    case 'constant': {
      const bits = kind === 'constant' ? g.ports[0]?.bits ?? 1 : g.ports[0]?.bits ?? 1;
      const netPort = kind === 'input' ? 'out' : 'in';
      const sv = ghost ? { value: 0 } : sim.valueOfPort(comp.id, netPort);
      let text: string;
      if (kind === 'constant') {
        text = formatValue(comp.attrs.value ?? 0, comp.attrs.bits ?? 8);
      } else if (kind === 'input') {
        text = formatValue(ghost ? 0 : sim.pinValue(comp.id), bits);
      } else {
        text = formatValue(sv.value, bits);
      }
      drawPinBody(ctx, comp, g, pal, text, borderIsHigh(comp, sv.value, ghost), false);
      break;
    }
    case 'button': {
      const pressed = !ghost && sim.isHeld(comp.id);
      drawPinBody(ctx, comp, g, pal, pressed ? '1' : '0', pressed, true, pressed);
      break;
    }
    case 'clock': {
      const sv = ghost ? { value: 0 } : sim.valueOfPort(comp.id, 'out');
      roundedRect(ctx, g.x + 0.8, g.y + 0.8, g.w - 1.6, g.h - 1.6, 5);
      ctx.fillStyle = pal.chipFill;
      ctx.fill();
      ctx.strokeStyle = pal.chipStroke;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.save();
      ctx.strokeStyle = sv.value ? pal.wireHigh : pal.muted;
      ctx.lineWidth = 1.4;
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      const cx = g.x + 3;
      const cy = 0;
      ctx.moveTo(cx, cy + 3);
      ctx.lineTo(cx + 3, cy + 3);
      ctx.lineTo(cx + 3, cy - 3);
      ctx.lineTo(cx + 9, cy - 3);
      ctx.lineTo(cx + 9, cy + 3);
      ctx.lineTo(cx + 14, cy + 3);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'led': {
      const sv = ghost ? { value: 0 } : sim.valueOfPort(comp.id, 'in');
      const on = sv.value !== 0;
      const color = LED_COLORS[comp.attrs.color ?? 'emerald'] ?? LED_COLORS.emerald;
      const cx = 10;
      const cy = 0;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(cx - 6.5, 0);
      ctx.strokeStyle = on ? pal.wireHigh : pal.muted;
      ctx.lineWidth = 1.7;
      ctx.stroke();
      if (on) {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(cx, cy, 6.6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, 6.6, 0, Math.PI * 2);
        ctx.fillStyle = pal.ledOff;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 6.6, 0, Math.PI * 2);
      ctx.strokeStyle = on ? color : pal.chipStroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (on) {
        ctx.beginPath();
        ctx.arc(cx - 1.8, cy - 2, 1.7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.fill();
      }
      break;
    }
    case 'dff': {
      roundedRect(ctx, g.x + 0.8, g.y + 0.8, g.w - 1.6, g.h - 1.6, 7);
      ctx.fillStyle = pal.chipFill;
      ctx.fill();
      ctx.strokeStyle = pal.chipStroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const q = ghost ? 0 : sim.valueOfPort(comp.id, 'q').value;
      // clock triangle
      ctx.beginPath();
      ctx.moveTo(-40, 16);
      ctx.lineTo(-35, 20);
      ctx.lineTo(-40, 24);
      ctx.closePath();
      ctx.strokeStyle = pal.muted;
      ctx.lineWidth = 1.1;
      ctx.stroke();

      ctx.save();
      ctx.font = `500 7.5px ${MONO}`;
      ctx.fillStyle = pal.muted;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      uprightText(ctx, comp, -36.5, 0, () => ctx.fillText('D', 0, 0));
      uprightText(ctx, comp, -36.5, 20, () => ctx.fillText('›', 0, 0));
      ctx.textAlign = 'right';
      ctx.fillStyle = q ? pal.wireHigh : pal.muted;
      uprightText(ctx, comp, -3.5, 0, () => ctx.fillText('Q', 0, 0));
      uprightText(ctx, comp, -3.5, 20, () => ctx.fillText('Q̄', 0, 0));
      ctx.restore();
      if (q) {
        ctx.beginPath();
        ctx.arc(-8, -5, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = pal.wireHigh;
        ctx.fill();
      }
      break;
    }
    case 'mux': {
      const selBits = Math.max(1, Math.min(4, comp.attrs.fans ?? 1));
      const n = 1 << selBits;
      const w = n === 2 ? 30 : 40;
      const h = n === 2 ? 40 : n * 10 + 20;
      const inset = Math.min(9, h * 0.18);
      ctx.beginPath();
      ctx.moveTo(-w, -h / 2);
      ctx.lineTo(0, -h / 2 + inset);
      ctx.lineTo(0, h / 2 - inset);
      ctx.lineTo(-w, h / 2);
      ctx.closePath();
      ctx.fillStyle = pal.chipFill;
      ctx.fill();
      ctx.strokeStyle = pal.chipStroke;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.save();
      ctx.font = `500 8px ${MONO}`;
      ctx.fillStyle = pal.faint;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      uprightText(ctx, comp, -w / 2, 0, () => ctx.fillText('MUX', 0, 0));
      ctx.font = `500 7px ${MONO}`;
      ctx.fillStyle = pal.muted;
      uprightText(ctx, comp, -16, h / 2 - 2.5, () => ctx.fillText('S', 0, 0));
      ctx.restore();
      break;
    }
    case 'split':
    case 'merge': {
      const fans = Math.max(2, Math.min(12, comp.attrs.fans ?? 2));
      const w = 44;
      const h = Math.max(34, fans * 10 + 14);
      roundedRect(ctx, -w / 2, -h / 2, w, h, 6);
      ctx.fillStyle = pal.accentSoft;
      ctx.fill();
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // thick bus-side edge
      ctx.beginPath();
      const bx = kind === 'split' ? -w / 2 + 1.5 : w / 2 - 1.5;
      ctx.moveTo(bx, -h / 2 + 5);
      ctx.lineTo(bx, h / 2 - 5);
      ctx.strokeStyle = pal.wireBus;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.save();
      ctx.font = `600 8px ${MONO}`;
      ctx.fillStyle = pal.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      uprightText(ctx, comp, kind === 'split' ? -w / 2 + 8 : w / 2 - 8, 0, () =>
        ctx.fillText(`${comp.attrs.bits ?? 8}`, 0, 0),
      );
      ctx.restore();
      break;
    }
    case 'tunnel': {
      const w = Math.max(24, estimateTextWidth(comp.attrs.label || '?', 11) + 16);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(7, -10);
      ctx.lineTo(w, -10);
      ctx.lineTo(w, 10);
      ctx.lineTo(7, 10);
      ctx.closePath();
      ctx.fillStyle = pal.accentSoft;
      ctx.fill();
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.save();
      ctx.font = `600 10px ${UI}`;
      ctx.fillStyle = pal.accent;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      uprightText(ctx, comp, w / 2 + 3, 0.5, () => ctx.fillText(comp.attrs.label || '?', 0, 0));
      ctx.restore();
      break;
    }
    case 'text':
      break;
  }
}

function borderIsHigh(comp: ComponentInstance, value: number, ghost: boolean): boolean {
  return !ghost && value !== 0 && (comp.kind === 'input' || comp.kind === 'output');
}

function drawCompOuter(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  pal: Palette,
  sim: Simulator,
  ghost = false,
) {
  const angle = facingAngle(comp.facing);
  ctx.save();
  ctx.translate(comp.at.x, comp.at.y);
  ctx.rotate(angle);
  drawComponentInner(ctx, comp, pal, sim, ghost);
  ctx.restore();
}

export function drawScene(opts: SceneOptions) {
  const { ctx, doc, sim, zoom, pan, width, height } = opts;
  const pal2 = PALETTES[opts.theme];

  ctx.save();
  ctx.fillStyle = pal2.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.translate(pan.x, pan.y);
  ctx.scale(zoom, zoom);

  if (opts.showGrid) drawGrid(ctx, pal2, zoom, width, height, pan);

  const vx0 = -pan.x / zoom - 60;
  const vy0 = -pan.y / zoom - 60;
  const vx1 = (width - pan.x) / zoom + 60;
  const vy1 = (height - pan.y) / zoom + 60;
  const inView = (b: Bounds) => b.x + b.w >= vx0 && b.y + b.h >= vy0 && b.x <= vx1 && b.y <= vy1;

  const selComp = new Set(opts.selComps);
  const selWire = new Set(opts.selWires);
  const hoverCompId = opts.hover?.type === 'comp' || opts.hover?.type === 'port' ? opts.hover.comp.id : null;
  const hoverWireId = opts.hover?.type === 'wire' ? opts.hover.wireId : null;

  // --- wires -------------------------------------------------------------
  const wireInfo = doc.wires.map((w, i) => {
    const b: Bounds = {
      x: Math.min(w.a.x, w.b.x),
      y: Math.min(w.a.y, w.b.y),
      w: Math.abs(w.a.x - w.b.x),
      h: Math.abs(w.a.y - w.b.y),
    };
    return { w, i, b, visible: inView(b) };
  });

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Background halo makes crossings legible.
  ctx.strokeStyle = pal2.bg;
  for (const { w, visible } of wireInfo) {
    if (!visible) continue;
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    ctx.moveTo(w.a.x, w.a.y);
    ctx.lineTo(w.b.x, w.b.y);
    ctx.stroke();
  }

  for (const { w, visible } of wireInfo) {
    if (!visible || !selWire.has(w.id)) continue;
    ctx.strokeStyle = pal2.accentLine;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 6.5;
    ctx.beginPath();
    ctx.moveTo(w.a.x, w.a.y);
    ctx.lineTo(w.b.x, w.b.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (hoverWireId && !selWire.has(hoverWireId)) {
    const w = doc.wires.find((x) => x.id === hoverWireId);
    if (w) {
      ctx.strokeStyle = pal2.accentLine;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(w.a.x, w.a.y);
      ctx.lineTo(w.b.x, w.b.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  const animate = opts.running;
  const flow = (opts.now / 55) % 16;
  for (const { w, i, visible } of wireInfo) {
    if (!visible) continue;
    const sv = sim.valueOfWire(i);
    const bus = sv.width > 1;
    const color = bus ? pal2.wireBus : sv.value !== 0 ? pal2.wireHigh : pal2.wireLow;
    ctx.strokeStyle = color;
    ctx.lineWidth = bus ? 2.9 : 2.1;
    ctx.beginPath();
    ctx.moveTo(w.a.x, w.a.y);
    ctx.lineTo(w.b.x, w.b.y);
    ctx.stroke();

    if (bus && zoom >= 0.65) {
      const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      if (len >= 24) {
        const mx = (w.a.x + w.b.x) / 2;
        const my = (w.a.y + w.b.y) / 2;
        const label = `${sv.width}`;
        ctx.save();
        ctx.font = `600 8px ${MONO}`;
        const tw = ctx.measureText(label).width;
        const bw = tw + 7 / zoom;
        const bh = 10 / zoom;
        roundedRect(ctx, mx - bw / 2, my - bh / 2, bw, bh, 3 / zoom);
        ctx.fillStyle = pal2.bg;
        ctx.fill();
        ctx.strokeStyle = pal2.wireBus;
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();
        ctx.fillStyle = pal2.wireBus;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, mx, my + 0.5 / zoom);
        ctx.restore();
      }
    }

    if (animate && sv.value !== 0 && sv.width === 1 && lenIsLong(w)) {
      ctx.save();
      ctx.strokeStyle = opts.theme === 'paper' ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.1;
      ctx.setLineDash([2.5 / zoom, 10 / zoom]);
      ctx.lineDashOffset = -flow / zoom;
      ctx.beginPath();
      ctx.moveTo(w.a.x, w.a.y);
      ctx.lineTo(w.b.x, w.b.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Junction dots.
  ctx.fillStyle = pal2.bg;
  for (const p of junctionDots(doc)) {
    if (p.x < vx0 || p.y < vy0 || p.x > vx1 || p.y > vy1) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = pal2.text;
  ctx.globalAlpha = 0.75;
  for (const p of junctionDots(doc)) {
    if (p.x < vx0 || p.y < vy0 || p.x > vx1 || p.y > vy1) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // --- components -------------------------------------------------------
  const ordered = [...doc.comps].sort((a, b) => {
    const as = selComp.has(a.id) || hoverCompId === a.id ? 1 : 0;
    const bs = selComp.has(b.id) || hoverCompId === b.id ? 1 : 0;
    return as - bs;
  });
  for (const comp of ordered) {
    const b = rotatedBounds(comp);
    if (!inView(b)) continue;
    const isSel = selComp.has(comp.id);
    const isHover = hoverCompId === comp.id;
    drawCompOuter(ctx, comp, pal2, sim, false);

    if (comp.kind === 'text') {
      const lines = (comp.attrs.text ?? '').split('\n');
      ctx.save();
      ctx.font = `400 12.5px ${UI}`;
      ctx.fillStyle = pal2.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const startY = comp.at.y - ((lines.length - 1) * 16) / 2;
      lines.forEach((line, i) => ctx.fillText(line, comp.at.x, startY + i * 16));
      ctx.restore();
    }

    if (comp.kind === 'split' || comp.kind === 'merge') {
      const fans = Math.max(2, Math.min(12, comp.attrs.fans ?? 2));
      const fanBits = Math.max(1, Math.floor((comp.attrs.bits ?? 8) / fans));
      drawLabelAbove(ctx, comp, comp.attrs.label || `${comp.attrs.bits ?? 8} → ${fans}×${fanBits}`, pal2, zoom);
    } else if (comp.kind === 'mux') {
      const n = 1 << Math.max(1, Math.min(4, comp.attrs.fans ?? 1));
      drawLabelAbove(ctx, comp, comp.attrs.label || `${n}:1 MUX`, pal2, zoom);
    } else if (comp.kind === 'clock') {
      const freq = comp.attrs.freq ?? 2;
      drawLabelAbove(ctx, comp, comp.attrs.label ? `${comp.attrs.label}` : 'CLK', pal2, zoom);
      // small frequency readout under the clock
      const rb = rotatedBounds(comp);
      ctx.save();
      ctx.font = `500 7.5px ${MONO}`;
      ctx.fillStyle = pal2.faint;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`${freq} Hz`, rb.x + rb.w / 2, rb.y + rb.h + 3 / zoom);
      ctx.restore();
    } else if (isGate(comp.kind)) {
      drawLabelAbove(
        ctx,
        comp,
        comp.attrs.label || (comp.kind === 'not' ? 'NOT' : comp.kind.toUpperCase()),
        pal2,
        zoom,
        { color: comp.attrs.label ? pal2.muted : pal2.faint },
      );
    } else if (comp.kind === 'dff') {
      drawLabelAbove(ctx, comp, comp.attrs.label || 'DFF', pal2, zoom, {
        color: comp.attrs.label ? pal2.muted : pal2.faint,
      });
    } else {
      drawLabelAbove(ctx, comp, comp.attrs.label ?? '', pal2, zoom);
    }

    // ports
    if (zoom >= 0.55) {
      const showPorts =
        isHover || isSel || opts.selComps.length > 0 || opts.hover?.type === 'port' || zoom >= 1.35;
      for (const p of portsOf(comp)) {
        const hovered =
          opts.hover?.type === 'port' && opts.hover.comp.id === comp.id && opts.hover.port.name === p.name;
        const target =
          opts.wiring?.targetPort?.compId === comp.id && opts.wiring.targetPort.portName === p.name;
        if (!showPorts && !hovered && !target) continue;
        ctx.beginPath();
        ctx.arc(p.world.x, p.world.y, hovered || target ? 4.5 / zoom : 2.2 / zoom, 0, Math.PI * 2);
        if (hovered || target) {
          ctx.fillStyle = pal2.accentSoft;
          ctx.fill();
          ctx.strokeStyle = target ? pal2.wireHigh : pal2.accent;
          ctx.lineWidth = 1.6 / zoom;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.world.x, p.world.y, 1.7 / zoom, 0, Math.PI * 2);
          ctx.fillStyle = target ? pal2.wireHigh : pal2.accent;
          ctx.fill();
        } else {
          ctx.fillStyle = pal2.muted;
          ctx.globalAlpha = 0.55;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }

    if (isSel) {
      const bb = rotatedBounds(comp);
      ctx.save();
      ctx.strokeStyle = pal2.accent;
      ctx.lineWidth = 1.4 / zoom;
      roundedRect(ctx, bb.x - 2.5 / zoom, bb.y - 2.5 / zoom, bb.w + 5 / zoom, bb.h + 5 / zoom, 4 / zoom);
      ctx.stroke();
      if (opts.selComps.length === 1) {
        const hs = 4 / zoom;
        for (const [hx, hy] of [
          [bb.x, bb.y],
          [bb.x + bb.w, bb.y],
          [bb.x, bb.y + bb.h],
          [bb.x + bb.w, bb.y + bb.h],
        ]) {
          ctx.fillStyle = pal2.bg;
          ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
          ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
        }
      }
      ctx.restore();
    } else if (isHover) {
      const bb = rotatedBounds(comp);
      ctx.save();
      ctx.strokeStyle = pal2.accentLine;
      ctx.lineWidth = 1 / zoom;
      roundedRect(ctx, bb.x - 2 / zoom, bb.y - 2 / zoom, bb.w + 4 / zoom, bb.h + 4 / zoom, 4 / zoom);
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- ghost ------------------------------------------------------------
  if (opts.ghost) {
    const comp = opts.ghost;
    ctx.save();
    ctx.globalAlpha = 0.72;
    drawCompOuter(ctx, comp, pal2, sim, true);
    ctx.restore();
    const b = rotatedBounds(comp);
    ctx.save();
    ctx.strokeStyle = pal2.accent;
    ctx.lineWidth = 1.25 / zoom;
    ctx.setLineDash([5 / zoom, 4 / zoom]);
    roundedRect(ctx, b.x - 3, b.y - 3, b.w + 6, b.h + 6, 4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.9;
    ctx.font = `600 10px ${UI}`;
    ctx.fillStyle = pal2.accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(opts.lang === 'zh' ? KIND_NAMES[comp.kind] : KIND_NAMES_EN[comp.kind], b.x + b.w / 2, b.y - 6 / zoom);
    ctx.restore();
  }

  // --- wiring preview ---------------------------------------------------
  if (opts.wiring && opts.wiring.points.length >= 2) {
    const pts = opts.wiring.points;
    ctx.save();
    ctx.strokeStyle = pal2.bg;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.strokeStyle = opts.wiring.invalid ? '#f43f5e' : pal2.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
    const end = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(end.x, end.y, 3.2 / zoom, 0, Math.PI * 2);
    ctx.fillStyle = opts.wiring.invalid ? '#f43f5e' : pal2.accent;
    ctx.fill();
    ctx.restore();
  }

  // --- wire hover probe -------------------------------------------------
  if (opts.hover?.type === 'wire') {
    const idx = doc.wires.findIndex((w) => w.id === hoverWireId);
    if (idx >= 0) {
      const w = doc.wires[idx];
      const sv = sim.valueOfWire(idx);
      const value = sv.width > 1 ? `${formatValue(sv.value, sv.width)} · ${sv.width} bit` : `${sv.value & 1}`;
      const mx = (w.a.x + w.b.x) / 2;
      const my = (w.a.y + w.b.y) / 2;
      ctx.save();
      ctx.font = `600 9px ${MONO}`;
      const tw = ctx.measureText(value).width;
      const bw = tw + 12 / zoom;
      const bh = 16 / zoom;
      const bx = mx + 7 / zoom;
      const by = my - bh - 7 / zoom;
      roundedRect(ctx, bx, by, bw, bh, 5 / zoom);
      ctx.fillStyle = pal2.bg;
      ctx.fill();
      ctx.strokeStyle = pal2.accentLine;
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
      ctx.fillStyle = sv.value ? (sv.width > 1 ? pal2.wireBus : pal2.wireHigh) : pal2.muted;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(value, bx + 6 / zoom, by + bh / 2 + 0.4 / zoom);
      ctx.restore();
    }
  }

  // --- marquee ----------------------------------------------------------
  if (opts.marquee) {
    const m = opts.marquee;
    ctx.save();
    ctx.fillStyle = pal2.marquee;
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.strokeStyle = pal2.accentLine;
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(m.x, m.y, m.w, m.h);
    ctx.restore();
  }

  ctx.restore();
}

function lenIsLong(w: { a: Point; b: Point }): boolean {
  return Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) > 18;
}

// End of scene drawing.
