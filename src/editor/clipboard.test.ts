import { describe, expect, it } from 'vitest';
import { extractSelection, pasteData } from './clipboard';
import { createComp } from '../model/specs';
import type { Doc } from '../model/types';

function sampleDoc(): Doc {
  const input = createComp('input', { x: 40, y: 20 });
  const output = createComp('output', { x: 240, y: 20 }, 'west');
  return {
    version: 1,
    name: 'clip',
    comps: [input, output],
    wires: [
      { id: 'wire', a: { x: 40, y: 20 }, b: { x: 240, y: 20 } },
    ],
  };
}

describe('clipboard', () => {
  it('normalizes copied geometry to the selection origin', () => {
    const doc = sampleDoc();
    const payload = extractSelection(doc, [doc.comps[0].id], ['wire'])!;
    expect(payload.comps[0].at).toEqual({ x: 0, y: 0 });
    expect(payload.wires[0].a).toEqual({ x: 0, y: 0 });
    expect(payload.wires[0].b).toEqual({ x: 200, y: 0 });
    expect(doc.comps[0].at).toEqual({ x: 40, y: 20 });
  });

  it('pastes with fresh ids and an offset for repeated pastes', () => {
    const doc = sampleDoc();
    const payload = extractSelection(doc, doc.comps.map((c) => c.id), ['wire'])!;
    const first = pasteData(payload, 20)!;
    const second = pasteData(payload, 40)!;
    expect(first.comps).toHaveLength(2);
    expect(first.wires).toHaveLength(1);
    expect(first.comps[0].id).not.toBe(doc.comps[0].id);
    expect(first.wires[0].id).not.toBe('wire');
    expect(first.comps[0].at).toEqual({ x: 20, y: 20 });
    expect(second.comps[0].id).not.toBe(first.comps[0].id);
    expect(second.comps[0].at).toEqual({ x: 40, y: 40 });
    expect(first.selComps).toEqual(first.comps.map((c) => c.id));
  });

  it('returns null when nothing is selected', () => {
    const doc = sampleDoc();
    expect(extractSelection(doc, [], [])).toBeNull();
    expect(pasteData({ version: 1, comps: [], wires: [] })).toBeNull();
  });
});
