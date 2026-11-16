import type { ComponentInstance } from './types';

/**
 * Channel widths for a split/merge component. A custom `fanBits` array wins
 * when it is well formed; otherwise the bus is divided as evenly as possible,
 * giving the remainder to the leading channels (8 → 3+3+2 instead of 2+2+2).
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

export function laneBits(comp: ComponentInstance): number[] {
  const custom = customLaneBits(comp);
  if (custom) return custom;
  const fans = Math.max(2, Math.min(12, Math.round(comp.attrs.fans ?? 2)));
  const total = Math.max(1, Math.min(32, Math.round(comp.attrs.bits ?? 8)));
  if (fans > total) return Array.from({ length: fans }, () => 1);
  const base = Math.floor(total / fans);
  const extra = total - base * fans;
  return Array.from({ length: fans }, (_, i) => base + (i < extra ? 1 : 0));
}

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
