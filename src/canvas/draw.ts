import type { ComponentInstance, Doc, Point, CanvasTheme, Facing } from '../model/types';
import { isGate, KIND_NAMES, KIND_NAMES_EN, pointKey } from '../model/types';
import type { Lang } from '../i18n';
import { geom, rotatedBounds, portsOf, estimateTextWidth, type Hit, type Bounds } from '../model/geometry';
import { laneSummary } from '../model/buses';
import { maskFor } from '../model/sim';
import type { SimValue } from '../model/sim';
import type { SimView } from '../model/simView';
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
  /** Mapped read access to the simulated root netlist for the viewed circuit. */
  view: SimView;
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

/** Neutral placeholder for unavailable runtime values (detached views). */
const NO_READOUT = '—';

/** Numeric readout text; a neutral placeholder when the view has no runtime value. */
function readoutText(sv: SimValue | null, bits: number): string {
  return sv ? formatValue(sv.value, bits) : NO_READOUT;
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
  if (kind === 'not' || kind === 'buffer') {
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
  } else if (kind === 'buffer') {
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(0, 0);
    ctx.strokeStyle = pal.chipStroke;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  if (kind === 'xor' || kind === 'xnor' || kind === 'odd' || kind === 'even') {
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
  if (kind === 'or' || kind === 'nor' || kind === 'xor' || kind === 'xnor' || kind === 'odd' || kind === 'even') {
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

function chipBody(ctx: CanvasRenderingContext2D, g: ReturnType<typeof geom>, pal: Palette) {
  roundedRect(ctx, g.x + 0.8, g.y + 0.8, g.w - 1.6, g.h - 1.6, 6);
  ctx.fillStyle = pal.chipFill;
  ctx.fill();
  ctx.strokeStyle = pal.chipStroke;
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

function chipText(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  x: number,
  y: number,
  text: string,
  color: string,
  size = 8,
  align: CanvasTextAlign = 'center',
) {
  ctx.save();
  ctx.font = `600 ${size}px ${MONO}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  uprightText(ctx, comp, x, y, () => ctx.fillText(text, 0, 0));
  ctx.restore();
}

function drawComponentInner(
  ctx: CanvasRenderingContext2D,
  comp: ComponentInstance,
  pal: Palette,
  view: SimView,
  ghost: boolean,
) {
  const g = geom(comp);
  const kind = comp.kind;
  const vp = (port: string): SimValue | null => view.valueOfPortAt(comp.id, port);

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
      const sv = ghost ? ({ value: 0, state: 'known' as const } as SimValue) : vp(netPort);
      let text: string;
      if (kind === 'constant') {
        text = formatValue(comp.attrs.value ?? 0, comp.attrs.bits ?? 8);
      } else if (kind === 'input') {
        if (ghost) {
          text = formatValue(0, bits);
        } else {
          // Detached views must not fabricate a pin value: show a placeholder.
          const pin = view.pinValueAt(comp.id);
          text = pin === null ? NO_READOUT : formatValue(pin, bits);
        }
      } else if (!sv) {
        text = NO_READOUT;
      } else if (sv.state === 'e') {
        text = 'E';
      } else if (sv.state === 'z') {
        text = 'Z';
      } else {
        text = formatValue(sv.value, bits);
      }
      drawPinBody(ctx, comp, g, pal, text, borderIsHigh(comp, sv?.value ?? 0, ghost), false);
      if (kind === 'output' && sv && sv.state !== 'known') {
        ctx.save();
        ctx.strokeStyle = sv.state === 'e' ? pal.wireError : pal.wireZ;
        ctx.lineWidth = 1.4;
        if (sv.state === 'z') ctx.setLineDash([3, 3]);
        roundedRect(ctx, g.x + 1.1, g.y + 1.1, g.w - 2.2, g.h - 2.2, 5);
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'button': {
      const pressed = !ghost && view.isHeldAt(comp.id);
      drawPinBody(ctx, comp, g, pal, pressed ? '1' : '0', pressed, true, pressed);
      break;
    }
    case 'clock': {
      const sv = ghost ? ({ value: 0 } as SimValue) : vp('out');
      roundedRect(ctx, g.x + 0.8, g.y + 0.8, g.w - 1.6, g.h - 1.6, 5);
      ctx.fillStyle = pal.chipFill;
      ctx.fill();
      ctx.strokeStyle = pal.chipStroke;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.save();
      ctx.strokeStyle = sv && sv.value ? pal.wireHigh : pal.muted;
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
      const sv = ghost ? ({ value: 0, state: 'known' as const } as SimValue) : vp('in');
      const on = !!sv && sv.value !== 0;
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
      ctx.strokeStyle =
        !sv ? pal.chipStroke : sv.state === 'e' ? pal.wireError : sv.state === 'z' ? pal.wireZ : on ? color : pal.chipStroke;
      ctx.lineWidth = 1.5;
      if (sv && sv.state === 'z') ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
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

      const q = ghost ? 0 : (vp('q')?.value ?? 0);
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
    case 'tff': {
      chipBody(ctx, g, pal);
      const q = ghost ? ({ value: 0 } as SimValue) : vp('q');
      chipText(ctx, comp, -38, -10, 'T', pal.muted, 8, 'left');
      chipText(ctx, comp, -38, 8, 'TFF', pal.faint, 6, 'left');
      chipText(ctx, comp, -6, -8, readoutText(q, 1), q?.value ? pal.wireHigh : pal.muted, 8, 'right');
      break;
    }
    case 'jkff': {
      chipBody(ctx, g, pal);
      const q = ghost ? ({ value: 0 } as SimValue) : vp('q');
      chipText(ctx, comp, -40, -10, 'J', pal.muted, 8, 'left');
      chipText(ctx, comp, -40, 10, 'K', pal.muted, 8, 'left');
      chipText(ctx, comp, -6, -12, readoutText(q, 1), q?.value ? pal.wireHigh : pal.muted, 8, 'right');
      break;
    }
    case 'sr': {
      chipBody(ctx, g, pal);
      const q = ghost ? ({ value: 0 } as SimValue) : vp('q');
      chipText(ctx, comp, -40, -8, 'S', pal.muted, 8, 'left');
      chipText(ctx, comp, -40, 12, 'R', pal.muted, 8, 'left');
      chipText(ctx, comp, -6, -8, readoutText(q, 1), q?.value ? pal.wireHigh : pal.muted, 8, 'right');
      break;
    }
    case 'shift': {
      chipBody(ctx, g, pal);
      const q = ghost ? ({ value: 0 } as SimValue) : vp('q');
      chipText(ctx, comp, -40, -14, 'SHIFT', pal.faint, 7, 'left');
      chipText(ctx, comp, -6, 0, readoutText(q, comp.attrs.bits ?? 8), q?.value ? pal.wireHigh : pal.muted, 7, 'right');
      if (comp.attrs.enable !== false) chipText(ctx, comp, -15, 25, 'EN', pal.faint, 5.5, 'center');
      if (comp.attrs.reset !== false) chipText(ctx, comp, 5, 25, 'R', pal.faint, 5.5, 'center');
      break;
    }
    case 'random': {
      chipBody(ctx, g, pal);
      const q = ghost ? ({ value: 0 } as SimValue) : vp('q');
      chipText(ctx, comp, -40, -14, 'RNG', pal.faint, 8, 'left');
      chipText(ctx, comp, -6, 0, readoutText(q, comp.attrs.bits ?? 8), q?.value ? pal.wireHigh : pal.muted, 7, 'right');
      if (comp.attrs.enable !== false) chipText(ctx, comp, -15, 25, 'EN', pal.faint, 5.5, 'center');
      if (comp.attrs.reset !== false) chipText(ctx, comp, 5, 25, 'R', pal.faint, 5.5, 'center');
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
    case 'probe': {
      const sv = ghost ? ({ value: 0, state: 'known' as const } as SimValue) : vp('in');
      const text =
        !sv ? NO_READOUT : sv.state === 'e'
          ? 'E'
          : sv.state === 'z'
            ? 'Z'
            : formatValue(sv.value, comp.attrs.bits ?? 1);
      drawPinBody(ctx, comp, g, pal, text, !!sv && sv.state === 'known' && sv.value !== 0, false);
      if (sv && (sv.state === 'e' || sv.state === 'z')) {
        ctx.save();
        ctx.strokeStyle = sv.state === 'e' ? pal.wireError : pal.wireZ;
        ctx.lineWidth = 1.3;
        if (sv.state === 'z') ctx.setLineDash([3, 3]);
        roundedRect(ctx, g.x + 1.2, g.y + 1.2, g.w - 2.4, g.h - 2.4, 5);
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 'power': {
      ctx.strokeStyle = pal.wireHigh;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -12);
      ctx.moveTo(-6, -12);
      ctx.lineTo(6, -12);
      ctx.stroke();
      chipText(ctx, comp, 9, -17, '+', pal.wireHigh, 8);
      break;
    }
    case 'ground': {
      ctx.strokeStyle = pal.muted;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -10);
      ctx.moveTo(-7, -10);
      ctx.lineTo(7, -10);
      ctx.moveTo(-4.5, -14);
      ctx.lineTo(4.5, -14);
      ctx.moveTo(-2, -18);
      ctx.lineTo(2, -18);
      ctx.stroke();
      break;
    }
    case 'pull': {
      chipBody(ctx, g, pal);
      const up = (comp.attrs.pull ?? 0) === 1;
      ctx.strokeStyle = up ? pal.wireHigh : pal.wireLow;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(18, up ? 5 : -5);
      ctx.lineTo(18, up ? -4 : 4);
      ctx.moveTo(15, up ? -1 : 1);
      ctx.lineTo(18, up ? -4 : 4);
      ctx.lineTo(21, up ? -1 : 1);
      ctx.stroke();
      chipText(ctx, comp, 9, 0, up ? '1' : '0', pal.muted, 8);
      break;
    }
    case 'extend': {
      const inBits = Math.max(1, Math.min(32, comp.attrs.inBits ?? 4));
      const outBits = Math.max(1, Math.min(32, comp.attrs.outBits ?? 8));
      chipBody(ctx, g, pal);
      chipText(ctx, comp, -15, -2, `${inBits}→${outBits}`, pal.muted, 7);
      chipText(ctx, comp, -15, 7, comp.attrs.sign ? 'S' : '0', pal.faint, 6.5);
      break;
    }
    case 'ctrlBuffer':
    case 'ctrlInverter': {
      const en = ghost ? ({ value: 0, state: 'known' as const } as SimValue) : vp('enable');
      const enabled = !!en && en.state === 'known' && en.value !== 0;
      ctx.beginPath();
      ctx.moveTo(-32, -16);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-32, 16);
      ctx.closePath();
      ctx.fillStyle = pal.gateFill;
      ctx.fill();
      ctx.strokeStyle = pal.chipStroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-40, -6);
      ctx.lineTo(-32, -6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-40, 12);
      ctx.lineTo(-24, 12);
      ctx.stroke();
      if (comp.kind === 'ctrlInverter') {
        ctx.beginPath();
        ctx.arc(3, 0, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = pal.gateFill;
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(7.5, 0);
        ctx.lineTo(14, 0);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(-2, 0);
        ctx.lineTo(14, 0);
        ctx.stroke();
      }
      chipText(ctx, comp, -29, 11, 'EN', pal.faint, 6.5, 'center');
      // The Z marker means "simulated and floating"; a detached view shows nothing.
      if (en && !enabled) chipText(ctx, comp, -17, 0, 'Z', pal.wireZ, 7);
      break;
    }
    case 'register': {
      chipBody(ctx, g, pal);
      const q = ghost ? ({ value: 0 } as SimValue) : vp('q');
      chipText(ctx, comp, -34, -14, 'REG', pal.faint, 7, 'left');
      chipText(ctx, comp, -34, 0, 'D', pal.muted, 7, 'left');
      chipText(ctx, comp, -6, -14, comp.attrs.trigger === 'falling' ? '▾' : '▴', pal.muted, 7, 'right');
      chipText(ctx, comp, -6, 0, readoutText(q, comp.attrs.bits ?? 8), q?.value ? pal.wireHigh : pal.muted, 7, 'right');
      if (comp.attrs.enable !== false) chipText(ctx, comp, -15, 25, 'EN', pal.faint, 6, 'center');
      if (comp.attrs.reset !== false) chipText(ctx, comp, 5, 25, 'R', pal.faint, 6, 'center');
      break;
    }
    case 'counter': {
      chipBody(ctx, g, pal);
      const q = ghost ? ({ value: 0 } as SimValue) : vp('q');
      chipText(ctx, comp, -34, -12, 'CNT', pal.faint, 7, 'left');
      chipText(ctx, comp, -6, -12, (comp.attrs.count ?? 'up') === 'down' ? '−' : '+', pal.muted, 7, 'right');
      chipText(ctx, comp, -6, 1, readoutText(q, comp.attrs.bits ?? 8), q?.value ? pal.wireHigh : pal.muted, 7, 'right');
      chipText(ctx, comp, -6, 11, 'C', pal.faint, 6, 'right');
      if (comp.attrs.enable !== false) chipText(ctx, comp, -30, 15, 'EN', pal.faint, 5.5, 'left');
      break;
    }
    case 'ram':
    case 'rom': {
      chipBody(ctx, g, pal);
      const isRam = comp.kind === 'ram';
      chipText(ctx, comp, -35, -22, isRam ? 'RAM' : 'ROM', pal.faint, 8, 'left');
      chipText(ctx, comp, -35, -10, `A${comp.attrs.addrBits ?? 4}`, pal.muted, 7, 'left');
      chipText(ctx, comp, -35, 3, `D${comp.attrs.dataBits ?? 8}`, pal.muted, 7, 'left');
      const sv = ghost ? ({ value: 0 } as SimValue) : vp('dout');
      chipText(ctx, comp, -34, 18, readoutText(sv, comp.attrs.dataBits ?? 8), sv?.value ? pal.wireHigh : pal.muted, 7, 'left');
      if (isRam) {
        chipText(ctx, comp, -38, 28, 'WE', pal.faint, 5.5, 'left');
        chipText(ctx, comp, -8, 28, '▴', pal.faint, 5.5, 'right');
      }
      break;
    }
    case 'decoder':
    case 'demux':
    case 'priority':
    case 'bitSelect': {
      chipBody(ctx, g, pal);
      const title =
        comp.kind === 'decoder' ? 'DEC' : comp.kind === 'demux' ? 'DEMUX' : comp.kind === 'priority' ? 'PRI' : 'BIT';
      chipText(ctx, comp, -20, 0, title, pal.faint, comp.kind === 'demux' ? 6 : 7);
      if (comp.kind === 'bitSelect') {
        chipText(ctx, comp, -20, 10, `S${comp.attrs.fans ?? 2}`, pal.faint, 6);
      }
      if (comp.kind === 'decoder' && comp.attrs.enable) chipText(ctx, comp, -20, -24, 'EN', pal.faint, 6);
      break;
    }
    case 'negator': {
      chipBody(ctx, g, pal);
      const sv = ghost ? ({ value: 0 } as SimValue) : vp('out');
      chipText(ctx, comp, -22, -3, 'NEG', pal.faint, 7, 'center');
      chipText(
        ctx,
        comp,
        -8,
        5,
        readoutText(sv, comp.attrs.bits ?? 8),
        sv?.value ? pal.wireHigh : pal.muted,
        7,
        'right',
      );
      break;
    }
    case 'divider': {
      chipBody(ctx, g, pal);
      const q = ghost ? ({ value: 0 } as SimValue) : vp('out');
      const r = ghost ? ({ value: 0 } as SimValue) : vp('rem');
      chipText(ctx, comp, -40, -20, '÷', pal.faint, 11, 'left');
      chipText(ctx, comp, -40, -8, 'A/B', pal.faint, 6, 'left');
      chipText(ctx, comp, -6, -10, readoutText(q, comp.attrs.bits ?? 8), q?.value ? pal.wireHigh : pal.muted, 7, 'right');
      chipText(ctx, comp, -6, 10, readoutText(r, comp.attrs.bits ?? 8), r?.value ? pal.wireHigh : pal.muted, 7, 'right');
      break;
    }
    case 'bitAdder': {
      chipBody(ctx, g, pal);
      const sv = ghost ? ({ value: 0 } as SimValue) : vp('out');
      const outBits = Math.max(1, Math.ceil(Math.log2((comp.attrs.bits ?? 8) + 1)));
      chipText(ctx, comp, -40, -12, 'Σ1s', pal.faint, 8, 'left');
      chipText(ctx, comp, -6, 10, readoutText(sv, outBits), sv?.value ? pal.wireHigh : pal.muted, 7, 'right');
      break;
    }
    case 'bitFinder': {
      chipBody(ctx, g, pal);
      const index = ghost ? ({ value: 0 } as SimValue) : vp('index');
      const mode = comp.attrs.find ?? 'low1';
      const label = mode === 'low1' ? 'L1' : mode === 'high1' ? 'H1' : mode === 'low0' ? 'L0' : 'H0';
      chipText(ctx, comp, -34, -8, 'FIND', pal.faint, 7, 'left');
      chipText(ctx, comp, -34, 6, label, pal.muted, 8, 'left');
      chipText(ctx, comp, -6, -8, readoutText(index, Math.max(1, Math.ceil(Math.log2(comp.attrs.bits ?? 8)))), index?.value ? pal.wireHigh : pal.muted, 7, 'right');
      break;
    }
    case 'adder':
    case 'subtractor':
    case 'multiplier':
    case 'comparator':
    case 'shifter': {
      chipBody(ctx, g, pal);
      const outPort = comp.kind === 'comparator' ? 'eq' : 'out';
      const sv = ghost ? ({ value: 0 } as SimValue) : vp(outPort);
      const title =
        comp.kind === 'adder' ? '+' : comp.kind === 'subtractor' ? '−' : comp.kind === 'multiplier' ? '×' : comp.kind === 'comparator' ? 'CMP' : '≪';
      chipText(ctx, comp, -30, -14, title, pal.faint, comp.kind === 'comparator' ? 7 : 11, 'left');
      if (comp.kind === 'comparator') {
        chipText(ctx, comp, -5, -10, '>', pal.muted, 6, 'right');
        chipText(ctx, comp, -5, 0, '=', pal.muted, 6, 'right');
        chipText(ctx, comp, -5, 10, '<', pal.muted, 6, 'right');
      } else {
        chipText(ctx, comp, -6, 14, readoutText(sv, comp.kind === 'multiplier' ? Math.max(1, Math.min(32, (comp.attrs.bits ?? 8) * 2)) : comp.attrs.bits ?? 8), sv?.value ? pal.wireHigh : pal.muted, 7, 'right');
      }
      if (comp.kind === 'shifter') chipText(ctx, comp, -30, 12, comp.attrs.shift === 'left' ? '≪' : comp.attrs.shift === 'arithmetic' ? '⩾' : '≫', pal.faint, 6, 'left');
      break;
    }
    case 'sevenseg':
    case 'hexdigit': {
      const segNames = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      const color = LED_COLORS[comp.attrs.color ?? 'rose'] ?? LED_COLORS.rose;
      const active = new Set<string>();
      if (comp.kind === 'hexdigit') {
        const sv = ghost ? ({ value: 0 } as SimValue) : vp('in');
        const segs: Record<string, string[]> = {
          '0': ['a', 'b', 'c', 'd', 'e', 'f'],
          '1': ['b', 'c'],
          '2': ['a', 'b', 'g', 'e', 'd'],
          '3': ['a', 'b', 'g', 'c', 'd'],
          '4': ['f', 'g', 'b', 'c'],
          '5': ['a', 'f', 'g', 'c', 'd'],
          '6': ['a', 'f', 'g', 'e', 'c', 'd'],
          '7': ['a', 'b', 'c'],
          '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
          '9': ['a', 'b', 'c', 'd', 'f', 'g'],
          a: ['a', 'b', 'c', 'e', 'f', 'g'],
          b: ['c', 'd', 'e', 'f', 'g'],
          c: ['a', 'd', 'e', 'f'],
          d: ['b', 'c', 'd', 'e', 'g'],
          e: ['a', 'd', 'e', 'f', 'g'],
          f: ['a', 'e', 'f', 'g'],
        };
        for (const name of (sv && segs[(sv.value & 0xf).toString(16)]) ?? []) active.add(name);
      } else if (comp.attrs.segMode === 'bus') {
        const sv = ghost ? ({ value: 0 } as SimValue) : vp('in');
        segNames.forEach((name, i) => {
          if (sv && (sv.value >>> i) & 1) active.add(name);
        });
      } else {
        for (const name of segNames) {
          const sv = ghost ? ({ value: 0, state: 'known' as const } as SimValue) : vp(name);
          if (sv && sv.state === 'known' && sv.value) active.add(name);
        }
      }
      const isSeparate = comp.kind === 'sevenseg' && comp.attrs.segMode !== 'bus';
      if (isSeparate) {
        segNames.forEach((_, i) => {
          ctx.beginPath();
          ctx.moveTo(0, -24 + i * 8);
          ctx.lineTo(4, -24 + i * 8);
          ctx.strokeStyle = pal.muted;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        });
      } else {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(4, 0);
        ctx.strokeStyle = pal.muted;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      roundedRect(ctx, 4, -30, 34, 60, 6);
      ctx.fillStyle = pal.ledOff;
      ctx.fill();
      ctx.strokeStyle = pal.chipStroke;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      const paths: Record<string, [number, number, number, number]> = {
        a: [8, -24, 28, -24],
        b: [31, -21, 31, -3],
        c: [31, 3, 31, 21],
        d: [8, 24, 28, 24],
        e: [7, 3, 7, 21],
        f: [7, -21, 7, -3],
        g: [8, 0, 28, 0],
      };
      for (const [name, [x1, y1, x2, y2]] of Object.entries(paths)) {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineCap = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = active.has(name) ? color : pal.chipStroke;
        ctx.globalAlpha = active.has(name) ? 1 : 0.18;
        if (active.has(name)) {
          ctx.save();
          ctx.shadowColor = color;
          ctx.shadowBlur = 5;
          ctx.stroke();
          ctx.restore();
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'sub': {
      roundedRect(ctx, g.x + 0.5, g.y + 0.5, g.w - 1, g.h - 1, 7);
      ctx.fillStyle = pal.chipFill;
      ctx.fill();
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = pal.accentSoft;
      ctx.beginPath();
      ctx.rect(g.x + 3, g.y + 3, g.w - 6, 15);
      ctx.fill();
      chipText(ctx, comp, g.w / 2, 10, comp.attrs.circuitName || comp.attrs.circuit || 'SUB', pal.accent, 8);
      for (const p of g.ports) {
        const x = p.dir === 'in' ? p.local.x + 5 : p.local.x - 5;
        chipText(ctx, comp, x, p.local.y, p.label || '', pal.muted, 6.5, p.dir === 'in' ? 'left' : 'right');
      }
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
  view: SimView,
  ghost = false,
) {
  const angle = facingAngle(comp.facing);
  ctx.save();
  ctx.translate(comp.at.x, comp.at.y);
  ctx.rotate(angle);
  drawComponentInner(ctx, comp, pal, view, ghost);
  ctx.restore();
}

export function drawScene(opts: SceneOptions) {
  const { ctx, doc, view, zoom, pan, width, height } = opts;
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
    const sv = view.valueOfWireAt(w.id);
    // Detached views draw plain wires: no fabricated E/Z marks, no bus badges.
    const bus = !!sv && sv.width > 1;
    const widthIssue = !!sv && view.widthIssueAt(w.id);
    const color =
      !sv
        ? pal2.wireLow
        : sv.state === 'e'
          ? pal2.wireError
          : sv.state === 'z'
            ? pal2.wireZ
            : widthIssue
              ? pal2.wireWarn
              : bus
                ? pal2.wireBus
                : sv.value !== 0
                  ? pal2.wireHigh
                  : pal2.wireLow;
    ctx.strokeStyle = color;
    ctx.lineWidth = bus ? 2.9 : 2.1;
    if (sv && sv.state !== 'known') ctx.setLineDash(sv.state === 'z' ? [4, 4] : [2, 3]);
    ctx.beginPath();
    ctx.moveTo(w.a.x, w.a.y);
    ctx.lineTo(w.b.x, w.b.y);
    ctx.stroke();
    ctx.setLineDash([]);    if (sv && (sv.state === 'e' || sv.state === 'z') && zoom >= 0.65) {
      const mx = (w.a.x + w.b.x) / 2;
      const my = (w.a.y + w.b.y) / 2;
      ctx.save();
      ctx.font = `700 8px ${MONO}`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sv.state === 'e' ? 'E' : 'Z', mx, my);
      ctx.restore();
    } else if (widthIssue && zoom >= 0.65) {
      const mx = (w.a.x + w.b.x) / 2;
      const my = (w.a.y + w.b.y) / 2;
      ctx.save();
      ctx.font = `700 8px ${MONO}`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', mx, my);
      ctx.restore();
    }

    if (sv && bus && zoom >= 0.65) {
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

    if (animate && sv && sv.value !== 0 && sv.width === 1 && lenIsLong(w)) {
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
    drawCompOuter(ctx, comp, pal2, view, false);

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
      const bits = comp.attrs.bits ?? 8;
      drawLabelAbove(ctx, comp, comp.attrs.label || `${bits} → ${laneSummary(comp)}`, pal2, zoom);
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
      const alwaysPins = [
        'sub', 'ram', 'rom', 'decoder', 'demux', 'priority', 'bitSelect',
        'register', 'counter', 'adder', 'subtractor', 'multiplier', 'divider', 'negator',
        'bitAdder', 'bitFinder', 'comparator', 'shifter', 'sevenseg', 'hexdigit', 'ctrlBuffer', 'ctrlInverter',
        'tff', 'jkff', 'sr', 'shift', 'random',
      ].includes(comp.kind);
      const showPorts =
        isHover || isSel || alwaysPins || opts.selComps.length > 0 || opts.hover?.type === 'port' || zoom >= 1.35;
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
    drawCompOuter(ctx, comp, pal2, view, true);
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
    const w = doc.wires.find((x) => x.id === hoverWireId);
    const sv = w ? view.valueOfWireAt(w.id) : null;
    if (w && sv) {
      const value =
        sv.state === 'e'
          ? `E · ${sv.width} bit`
          : sv.state === 'z'
            ? `Z · ${sv.width} bit`
            : sv.width > 1
              ? `${formatValue(sv.value, sv.width)} · ${sv.width} bit`
              : `${sv.value & 1}`;
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
