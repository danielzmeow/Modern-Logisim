import { describe, expect, it } from 'vitest';
import {
  errorValue,
  floatingValue,
  knownValue,
  maskFor,
  resolveBitDrivers,
  stateOfBits,
} from './value';

describe('maskFor', () => {
  it('covers 1..32 bits and stays unsigned at bit 31', () => {
    expect(maskFor(1)).toBe(1);
    expect(maskFor(4)).toBe(0b1111);
    expect(maskFor(31)).toBe(0x7fffffff);
    expect(maskFor(32)).toBe(0xffffffff);
    expect(maskFor(32) >>> 31).toBe(1);
  });
});

describe('four-value constructors', () => {
  it('knownValue masks the data to the width', () => {
    expect(knownValue(0b101101, 4)).toEqual({ value: 0b1101, known: 0b1111, error: 0 });
    expect(knownValue(0xffffffff, 32)).toEqual({
      value: 0xffffffff,
      known: 0xffffffff,
      error: 0,
    });
  });

  it('floatingValue is all Z', () => {
    expect(floatingValue(8)).toEqual({ value: 0, known: 0, error: 0 });
    expect(stateOfBits(floatingValue(8), 8)).toBe('z');
  });

  it('errorValue is all E', () => {
    expect(errorValue(8)).toEqual({ value: 0, known: 0, error: 0xff });
    expect(stateOfBits(errorValue(8), 8)).toBe('e');
  });
});

describe('resolveBitDrivers', () => {
  it('resolves an empty driver list to all Z', () => {
    expect(resolveBitDrivers([], 4)).toEqual({ value: 0, known: 0, error: 0 });
  });

  it('treats identical strong drivers as compatible', () => {
    const r = resolveBitDrivers(
      [
        { value: 0b1010, error: false, weak: false },
        { value: 0b1010, error: false, weak: false },
      ],
      4,
    );
    expect(r).toEqual({ value: 0b1010, known: 0b1111, error: 0 });
  });

  it('marks only the disagreeing bit when strong drivers conflict on a single bit', () => {
    const r = resolveBitDrivers(
      [
        { value: 0b0101, error: false, weak: false },
        { value: 0b0111, error: false, weak: false },
      ],
      4,
    );
    expect(r).toEqual({ value: 0b0101, known: 0b1101, error: 0b0010 });
    expect(stateOfBits(r, 4)).toBe('e');
  });

  it('lets strong drivers override weak drivers per bit', () => {
    const r = resolveBitDrivers(
      [
        { value: 0b01, error: false, weak: false },
        { value: 0b10, error: false, weak: true },
      ],
      2,
    );
    expect(r).toEqual({ value: 0b01, known: 0b11, error: 0 });
  });

  it('ignores weak drivers wherever strong drivers resolve the bit', () => {
    const r = resolveBitDrivers(
      [
        { value: 0b11, error: false, weak: false },
        { value: 0b00, error: false, weak: true },
        { value: 0b01, error: false, weak: true },
      ],
      2,
    );
    expect(r).toEqual({ value: 0b11, known: 0b11, error: 0 });
  });

  it('applies weak drivers only when no strong driver exists', () => {
    const single = resolveBitDrivers([{ value: 0b01, error: false, weak: true }], 2);
    expect(single).toEqual({ value: 0b01, known: 0b11, error: 0 });
    const conflict = resolveBitDrivers(
      [
        { value: 0, error: false, weak: true },
        { value: 1, error: false, weak: true },
      ],
      1,
    );
    expect(conflict).toEqual({ value: 0, known: 0, error: 1 });
  });

  it('keeps strong and weak conflicts independent per bit', () => {
    // Strong drivers disagree only at bit 1 and resolve every other bit, so
    // the conflicting weak drivers must not leak E anywhere else.
    const mixed = resolveBitDrivers(
      [
        { value: 0b0101, error: false, weak: false },
        { value: 0b0111, error: false, weak: false },
        { value: 0b1000, error: false, weak: true },
        { value: 0b1010, error: false, weak: true },
      ],
      4,
    );
    expect(mixed).toEqual({ value: 0b0101, known: 0b1101, error: 0b0010 });
    // Without strong drivers the weak conflict is still local to its bit;
    // the E bit carries no data.
    const weak = resolveBitDrivers(
      [
        { value: 0b1010, error: false, weak: true },
        { value: 0b1000, error: false, weak: true },
      ],
      4,
    );
    expect(weak).toEqual({ value: 0b1000, known: 0b1101, error: 0b0010 });
  });

  it('propagates strong error drivers over every bit', () => {
    const r = resolveBitDrivers(
      [
        { value: 0, error: true, weak: false },
        { value: 0b11, error: false, weak: false },
      ],
      2,
    );
    expect(r).toEqual({ value: 0, known: 0, error: 0b11 });
  });

  it('handles unsigned 32-bit values including bit 31', () => {
    const r = resolveBitDrivers([{ value: 0x80000000, error: false, weak: false }], 32);
    expect(r).toEqual({ value: 0x80000000, known: 0xffffffff, error: 0 });
    const conflict = resolveBitDrivers(
      [
        { value: 0x80000000, error: false, weak: false },
        { value: 0, error: false, weak: false },
      ],
      32,
    );
    expect(conflict.error).toBe(0x80000000);
    expect(conflict.known).toBe(0x7fffffff);
    expect(stateOfBits(conflict, 32)).toBe('e');
  });
});

describe('stateOfBits summary', () => {
  it('derives any-E, then any-Z, then known', () => {
    expect(stateOfBits({ value: 0b10, known: 0b11, error: 0 }, 2)).toBe('known');
    expect(stateOfBits({ value: 0b10, known: 0b10, error: 0 }, 2)).toBe('z');
    expect(stateOfBits({ value: 0, known: 0, error: 0 }, 2)).toBe('z');
    expect(stateOfBits({ value: 0, known: 0b10, error: 0b01 }, 2)).toBe('e');
  });

  it('recognizes a fully known 32-bit word as known, not z', () => {
    expect(stateOfBits({ value: 0xffffffff, known: 0xffffffff, error: 0 }, 32)).toBe('known');
    expect(stateOfBits({ value: 0, known: 0x7fffffff, error: 0x80000000 }, 32)).toBe('e');
  });
});
