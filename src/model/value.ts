export type SimWireState = 'known' | 'z' | 'e';

const MASK_CACHE: Record<number, number> = {};
export function maskFor(bits: number): number {
  const b = Math.max(1, Math.min(32, Math.round(bits)));
  if (MASK_CACHE[b] === undefined) {
    MASK_CACHE[b] =
      b >= 32 ? 0xffffffff : b === 1 ? 1 : ((1 << b) >>> 0) - 1;
    MASK_CACHE[b] >>>= 0;
  }
  return MASK_CACHE[b];
}

/**
 * Per-bit four-value state of a bus. Each bit is one of:
 * - known 0/1: `known` has a 1 at the bit and `error` has a 0;
 * - Z: `known` has a 0 and `error` has a 0;
 * - E: `known` has a 0 and `error` has a 1.
 * `value` only carries data where the bit is known.
 */
export interface BitValue {
  value: number;
  known: number;
  error: number;
}

/** A single component output contributing to a net, strong unless `weak`. */
export interface BitDriver {
  value: number;
  error: boolean;
  weak: boolean;
}

export function knownValue(value: number, width: number): BitValue {
  const mask = maskFor(width);
  return { value: (value & mask) >>> 0, known: mask, error: 0 };
}

export function floatingValue(width: number): BitValue {
  return { value: 0, known: 0, error: 0 };
}

export function errorValue(width: number): BitValue {
  return { value: 0, known: 0, error: maskFor(width) };
}

/**
 * Merge the drivers of one net bit by bit, mirroring the net-level rules in
 * the simulator: agreeing drivers are compatible, a disagreement marks only
 * the disagreeing bits as E, and weak drivers fill a bit only when no strong
 * driver resolves it. The whole `width` is always considered.
 */
export function resolveBitDrivers(drivers: readonly BitDriver[], width: number): BitValue {
  const mask = maskFor(width);
  let value = 0;
  let known = 0;
  let error = 0;

  const strongs: BitDriver[] = [];
  const weaks: BitDriver[] = [];
  for (const d of drivers) (d.weak ? weaks : strongs).push(d);

  if (strongs.length) {
    let strongValue = 0;
    let strongKnown = 0;
    let strongError = 0;
    let first = true;
    for (const d of strongs) {
      if (d.error) {
        strongError = mask;
        continue;
      }
      const v = d.value >>> 0;
      if (first) {
        strongValue = v;
        strongKnown = mask;
        first = false;
      } else {
        const diff = (strongValue ^ v) & mask;
        error |= diff;
        strongValue &= ~diff;
        strongKnown &= ~diff;
      }
    }
    error |= strongError;
    value = strongValue;
    known = strongKnown;
  }

  if (weaks.length) {
    const open = ~known & ~error & mask;
    if (open) {
      let weakValue = 0;
      let weakKnown = 0;
      let weakError = 0;
      let first = true;
      for (const d of weaks) {
        if (d.error) {
          weakError = mask;
          continue;
        }
        const v = d.value >>> 0;
        if (first) {
          weakValue = v;
          weakKnown = mask;
          first = false;
        } else {
          const diff = (weakValue ^ v) & mask;
          weakError |= diff;
          weakValue &= ~diff;
          weakKnown &= ~diff;
        }
      }
      const good = weakKnown & open & ~weakError;
      error |= weakError & open;
      known |= good;
      value |= weakValue & good;
    }
  }

  // E bits are stored as known=0, so keep the masks disjoint and the data
  // bits canonical (only known bits carry a value).
  const knownOut = (known & ~error) >>> 0;
  return { value: (value & knownOut) >>> 0, known: knownOut, error: error >>> 0 };
}

/** Summarize a bus as the old UI state: any E, else any Z, else known. */
export function stateOfBits(bits: BitValue, width: number): SimWireState {
  const mask = maskFor(width);
  if ((bits.error & mask) !== 0) return 'e';
  // `&` yields a signed int32, so compare unsigned: at 32 bits a full mask
  // would otherwise look like -1 !== 0xffffffff and report Z.
  if ((bits.known & mask) >>> 0 !== mask) return 'z';
  return 'known';
}
