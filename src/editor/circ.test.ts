import { describe, expect, it } from 'vitest';
import { exportCirc, formatRomContents, parseRomContents } from './circ';
import { createComp } from '../model/specs';
import type { Doc } from '../model/types';

function docWith(...kinds: Parameters<typeof createComp>[0][]): Doc {
  return {
    version: 1,
    name: 'RoundTrip',
    comps: kinds.map((kind, i) => createComp(kind, { x: 100 + i * 100, y: 100 })),
    wires: [],
  };
}

describe('.circ export', () => {
  it('writes the newly supported arithmetic components', () => {
    const doc = docWith('negator', 'divider', 'bitAdder');
    const { xml, skipped } = exportCirc(doc);
    expect(skipped).toEqual([]);
    expect(xml).toContain('name="Negator"');
    expect(xml).toContain('name="Divider"');
    expect(xml).toContain('name="Bit Adder"');
    expect(xml).toContain('<lib desc="#Arithmetic" name="3"/>');
  });

  it('writes the newly supported sequential components', () => {
    const doc = docWith('tff', 'jkff', 'sr', 'shift');
    const { xml, skipped } = exportCirc(doc);
    expect(skipped).toEqual([]);
    expect(xml).toContain('name="T Flip-Flop"');
    expect(xml).toContain('name="J-K Flip-Flop"');
    expect(xml).toContain('name="S-R Latch"');
    expect(xml).toContain('name="Shift Register"');
  });

  it('exports a merge as a Splitter with a direction hint', () => {
    const merge = createComp('merge', { x: 100, y: 100 }, 'east', 'en', {
      bits: 4,
      fans: 2,
      bitEnd: [1, 1, 2, 2],
    });
    const doc: Doc = { version: 1, name: 'Merge', comps: [merge], wires: [] };
    const { xml, skipped } = exportCirc(doc);
    expect(skipped).toEqual([]);
    expect(xml).toContain('name="Splitter"');
    expect(xml).toContain('<a name="direction" val="merge"/>');
  });

  it('exports a Splitter with its per-bit mapping', () => {
    const split = createComp('split', { x: 100, y: 100 }, 'east', 'en', {
      bits: 4,
      fans: 2,
      bitEnd: [1, 2, 1, 2],
    });
    const doc: Doc = { version: 1, name: 'Splitter', comps: [split], wires: [] };
    const { xml, skipped } = exportCirc(doc);
    expect(skipped).toEqual([]);
    expect(xml).toContain('name="Splitter"');
    expect(xml).toContain('<a name="fanout" val="2"/>');
    expect(xml).toContain('<a name="bit0" val="0"/>');
    expect(xml).toContain('<a name="bit1" val="1"/>');
    expect(xml).toContain('<a name="bit2" val="0"/>');
    expect(xml).toContain('<a name="bit3" val="1"/>');
  });

  it('round-trips a Logisim ROM contents image', () => {
    const contents = formatRomContents([0xaa, 0xbb, 0xbb, 0], 2, 8);
    expect(contents).toContain('addr/data: 2 8');
    expect(contents).toContain('aa 2*bb');
    const parsed = parseRomContents(contents, 2, 8)!;
    expect(parsed.addrBits).toBe(2);
    expect(parsed.dataBits).toBe(8);
    expect(parsed.memory.slice(0, 4)).toEqual([0xaa, 0xbb, 0xbb, 0]);
  });

  it('writes ROM contents as element text and leaves RAM volatile', () => {
    const rom = createComp('rom', { x: 100, y: 100 }, 'east', 'en', {
      addrBits: 2,
      dataBits: 8,
      memory: [1, 2, 3, 4],
    });
    const ram = createComp('ram', { x: 300, y: 100 }, 'east', 'en', {
      addrBits: 2,
      dataBits: 8,
      memory: [9, 9, 9, 9],
    });
    const doc: Doc = { version: 1, name: 'Memory', comps: [rom, ram], wires: [] };
    const xml = exportCirc(doc).xml;
    expect(xml).toContain('<a name="contents">addr/data: 2 8');
    expect(xml).not.toContain('val="addr/data');
    expect(xml.match(/<a name="contents">/g)).toHaveLength(1);
  });
});

describe('.circ arithmetic components', () => {
  it('writes Bit Finder with its mode', () => {
    const finder = createComp('bitFinder', { x: 100, y: 100 }, 'east', 'en', {
      bits: 8,
      find: 'high0',
    });
    const doc: Doc = { version: 1, name: 'Finder', comps: [finder], wires: [] };
    const xml = exportCirc(doc).xml;
    expect(xml).toContain('name="Bit Finder"');
    expect(xml).toContain('<a name="type" val="high0"/>');
  });
});

describe('.circ memory components', () => {
  it('writes Random with its seed and trigger', () => {
    const rng = createComp('random', { x: 100, y: 100 }, 'east', 'en', {
      bits: 8,
      seed: 42,
      trigger: 'falling',
    });
    const doc: Doc = { version: 1, name: 'Random', comps: [rng], wires: [] };
    const xml = exportCirc(doc).xml;
    expect(xml).toContain('name="Random"');
    expect(xml).toContain('<a name="seed" val="42"/>');
    expect(xml).toContain('<a name="trigger" val="falling"/>');
  });
});
