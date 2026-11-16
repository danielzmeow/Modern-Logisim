import type { ComponentInstance } from './types';

/**
 * Logisim splitter mapping is stored per bus bit: `bitEnd[i]` is the 1-based
 * channel that bit i feeds, or 0 when the bit is unconnected. This is more
 * general than channel widths and supports arbitrary reordering.
 */

export function customLaneBits(comp: ComponentInstance): number[] | null {
  const fans = Math.max(2, Math.min(12, Math.round(comp.attrs.fans ?? 2)));
  const total = Math.max(1, Math.min(32, Math.round(comp.attrs.bits ?? 8)));
  const raw = comp.attrs.fanBits;
  if (
    !Array.isArray(raw) ||
    raw.length !== fans ||
    raw.some((n) => !Number.isInteger(n) || n < 1 || n > 32) ||
    raw.reduce((sum, n) => sum + n, 0) !== total
  ) {
    return null;
  }
  return raw.slice();
}

function defaultBitEnd(comp: ComponentInstance): number[] {
  const fans = Math.max(2, Math.min(12, Math.round(comp.attrs.fans ?? 2)));
  const total = Math.max(1, Math.min(32, Math.round(comp.attrs.bits ?? 8)));
  if (fans >= total) return Array.from({ length: total }, (_, i) => Math.min(fans, i + 1));
  const base = Math.floor(total / fans);
  const extra = total - base * fans;
  const out: number[] = [];
  for (let lane = 1; lane <= fans; lane++) {
    const width = base + (lane <= extra ? 1 : 0);
    for (let i = 0; i < width; i++) out.push(lane);
  }
  return out;
}

function fromFanBits(comp: ComponentInstance): number[] | null {
  const lanes = customLaneBits(comp);
  if (!lanes) return null;
  const out: number[] = [];
  lanes.forEach((width, lane) => {
    for (let i = 0; i < width; i++) out.push(lane + 1);
  });
  return out;
}

export function effectiveBitEnd(comp: ComponentInstance): number[] {
  const fans = Math.max(2, Math.min(12, Math.round(comp.attrs.fans ?? 2)));
  const total = Math.max(1, Math.min(32, Math.round(comp.attrs.bits ?? 8)));
  const raw = comp.attrs.bitEnd;
  if (
    Array.isArray(raw) &&
    raw.length === total &&
    raw.every((n) => Number.isInteger(n) && n >= 0 && n <= fans)
  ) {
    return raw.slice();
  }
  return fromFanBits(comp) ?? defaultBitEnd(comp);
}

export function laneBits(comp: ComponentInstance): number[] {
  const fans = Math.max(2, Math.min(12, Math.round(comp.attrs.fans ?? 2)));
  const lanes = new Array<number>(fans).fill(0);
  for (const end of effectiveBitEnd(comp)) {
    if (end > 0) lanes[end - 1] += 1;
  }
  return lanes;
}

/** Contiguous lane offsets, retained for callers that only need lane widths. */
export function laneOffsets(comp: ComponentInstance): { bits: number; offset: number }[] {
  let offset = 0;
  return laneBits(comp).map((bits) => {
    const entry = { bits, offset };
    offset += bits;
    return entry;
  });
}

export function laneSummary(comp: ComponentInstance): string {
  return laneBits(comp).join('+');
}

export function hasCustomBitEnd(comp: ComponentInstance): boolean {
  const total = Math.max(1, Math.min(32, Math.round(comp.attrs.bits ?? 8)));
  const fans = Math.max(2, Math.min(12, Math.round(comp.attrs.fans ?? 2)));
  return (
    Array.isArray(comp.attrs.bitEnd) &&
    comp.attrs.bitEnd.length === total &&
    comp.attrs.bitEnd.every((n) => Number.isInteger(n) && n >= 0 && n <= fans)
  );
}
