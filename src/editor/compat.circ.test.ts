// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { exportCirc, importCirc, type CircImportResult } from './circ';
import { Simulator, type SimValue } from '../model/sim';
import { createSimView } from '../model/simView';
import partialBitsXml from './__fixtures__/core-partial-bits.circ?raw';
import widthIsolationXml from './__fixtures__/core-width-isolation.circ?raw';
import oscillationXml from './__fixtures__/core-oscillation.circ?raw';
import hierarchyXml from './__fixtures__/core-hierarchy.circ?raw';

/**
 * Classic 2.7.1-style `.circ` behavior regression: every scenario below is
 * parsed by the real `importCirc` DOM path and driven through a real
 * `Simulator`, never through hand-built documents.
 */

function sig(v: SimValue) {
  return { value: v.value, width: v.width, state: v.state, known: v.known, error: v.error };
}

function byLabel(result: CircImportResult, kind: string, label: string) {
  const comp = result.doc.comps.find((c) => c.kind === kind && c.attrs.label === label);
  if (!comp) throw new Error(`no ${kind} labeled ${label}`);
  return comp;
}

function partialBitsBehavior(result: CircImportResult) {
  const sim = new Simulator();
  sim.update(result.doc, result.circuits, result.mainName);
  sim.frame(0, false);
  const conflict = sig(sim.valueOfPort(byLabel(result, 'probe', 'BUS').id, 'in'));
  const merged = sig(sim.valueOfPort(byLabel(result, 'probe', 'MERGE').id, 'in'));
  return { conflict, merged };
}

function widthIsolationBehavior(result: CircImportResult) {
  const sim = new Simulator();
  sim.update(result.doc, result.circuits, result.mainName);
  sim.frame(0, false);
  const probe = byLabel(result, 'probe', 'OK');
  const led = byLabel(result, 'led', 'BAD');
  const nl = sim.netlistOrNull()!;
  return {
    ok: sig(sim.valueOfPort(probe.id, 'in')),
    bad: sig(sim.valueOfPort(led.id, 'in')),
    issueCount: nl.issues.length,
    isolated: sim.netOfPort(led.id, 'in') !== sim.netOfPort(probe.id, 'in'),
    forced: nl.forcedError.has(sim.netOfPort(led.id, 'in')),
  };
}

function oscillationBehavior(result: CircImportResult) {
  const sim = new Simulator();
  sim.update(result.doc, result.circuits, result.mainName);
  const and = result.doc.comps.find((c) => c.kind === 'and')!;
  const not = result.doc.comps.find((c) => c.kind === 'not')!;
  const clk = result.doc.comps.find((c) => c.kind === 'clock')!;
  sim.frame(0, true);
  const idle = { oscillating: sim.oscillation !== null, out: sig(sim.valueOfPort(and.id, 'out')) };
  sim.frame(250, true);
  const osc = sim.oscillation!;
  const nets = {
    and: osc.nets.has(sim.netOfPort(and.id, 'out')),
    not: osc.nets.has(sim.netOfPort(not.id, 'out')),
    clk: osc.nets.has(sim.netOfPort(clk.id, 'out')),
  };
  const during = sig(sim.valueOfPort(and.id, 'out'));
  sim.reset();
  const cleared = sim.oscillation === null;
  sim.frame(500, true);
  return {
    idle,
    nets,
    during,
    cleared,
    resumed: { oscillating: sim.oscillation !== null, clk: sim.valueOfPort(clk.id, 'out').value },
  };
}

function hierarchyBehavior(result: CircImportResult) {
  const sim = new Simulator();
  sim.update(result.doc, result.circuits, result.mainName);
  const instA = byLabel(result, 'sub', 'A');
  const instB = byLabel(result, 'sub', 'B');
  const inner = result.circuits['counter4'];
  const counter = inner.comps.find((c) => c.kind === 'counter')!;
  const clkPin = inner.comps.find((c) => c.kind === 'input')!;
  for (let i = 0; i < 5; i++) sim.step(i * 1000);
  const viewA = createSimView(sim, {
    circuits: result.circuits,
    rootId: result.mainName,
    circuitId: 'counter4',
    path: [instA.id],
  });
  const viewB = createSimView(sim, {
    circuits: result.circuits,
    rootId: result.mainName,
    circuitId: 'counter4',
    path: [instB.id],
  });
  const detached = createSimView(sim, {
    circuits: result.circuits,
    rootId: result.mainName,
    circuitId: 'counter4',
    path: ['missing-instance'],
  });
  const out = {
    qa: sim.valueOfPort(byLabel(result, 'output', 'QA').id, 'in').value,
    qb: sim.valueOfPort(byLabel(result, 'output', 'QB').id, 'in').value,
    qA: viewA.valueOfPortAt(counter.id, 'q')!.value,
    qB: viewB.valueOfPortAt(counter.id, 'q')!.value,
    clkA: viewA.pinValueAt(clkPin.id),
    clkB: viewB.pinValueAt(clkPin.id),
    attached: viewA.attached && viewB.attached,
    canWriteInstance: viewA.canWrite,
    canWriteRoot: createSimView(sim, {
      circuits: result.circuits,
      rootId: result.mainName,
      circuitId: result.mainName,
      path: [],
    }).canWrite,
    detachedValues: detached.valueOfPortAt(counter.id, 'q'),
  };
  // Simulate a sidebar switch away and back into instance A: runtime state
  // must survive without any reset.
  createSimView(sim, {
    circuits: result.circuits,
    rootId: result.mainName,
    circuitId: result.mainName,
    path: [],
  });
  const viewAAgain = createSimView(sim, {
    circuits: result.circuits,
    rootId: result.mainName,
    circuitId: 'counter4',
    path: [instA.id],
  });
  return { ...out, qAAgain: viewAAgain.valueOfPortAt(counter.id, 'q')!.value };
}

describe('.circ compatibility fixtures', () => {
  it('resolves partial-bit E on disagreeing drivers and partial-bit Z on an open lane', () => {
    const result = importCirc(partialBitsXml);
    expect(result.skipped).toBe(0);
    expect(partialBitsBehavior(result)).toEqual({
      // 0b0011 vs 0b0110: bits 0 and 2 clash, bits 1 and 3 keep their values.
      conflict: { value: 0b0010, width: 4, state: 'e', known: 0b1010, error: 0b0101 },
      // The disabled controlled buffer leaves lane f0 (bits 0-1) floating.
      merged: { value: 0b1100, width: 4, state: 'z', known: 0b1100, error: 0 },
    });
  });

  it('pins width-incompatible ports to E without disturbing the rest of the net', () => {
    const result = importCirc(widthIsolationXml);
    expect(widthIsolationBehavior(result)).toEqual({
      ok: { value: 0xa, width: 4, state: 'known', known: 0xf, error: 0 },
      bad: { value: 0, width: 1, state: 'e', known: 0, error: 1 },
      issueCount: 1,
      isolated: true,
      forced: true,
    });
  });

  it('detects the clock-gated ring, freezes the clocks, and recovers on reset', () => {
    const result = importCirc(oscillationXml);
    expect(oscillationBehavior(result)).toEqual({
      idle: { oscillating: false, out: { value: 0, width: 1, state: 'known', known: 1, error: 0 } },
      nets: { and: true, not: true, clk: false },
      during: { value: 0, width: 1, state: 'e', known: 0, error: 1 },
      cleared: true,
      resumed: { oscillating: true, clk: 1 },
    });
  });

  it('keeps two instances of the same subcircuit isolated and maps views to exact instances', () => {
    const result = importCirc(hierarchyXml);
    expect(hierarchyBehavior(result)).toEqual({
      qa: 2,
      qb: 0,
      qA: 2,
      qB: 0,
      clkA: 1,
      clkB: 0,
      attached: true,
      canWriteInstance: false,
      canWriteRoot: true,
      detachedValues: null,
      qAAgain: 2,
    });
  });

  it('preserves behavior through export → import round-trips', () => {
    const fixtures: { name: string; xml: string; run: (r: CircImportResult) => unknown }[] = [
      { name: 'core-partial-bits', xml: partialBitsXml, run: partialBitsBehavior },
      { name: 'core-width-isolation', xml: widthIsolationXml, run: widthIsolationBehavior },
      { name: 'core-oscillation', xml: oscillationXml, run: oscillationBehavior },
      { name: 'core-hierarchy', xml: hierarchyXml, run: hierarchyBehavior },
    ];
    for (const f of fixtures) {
      const first = importCirc(f.xml);
      expect(first.skipped, f.name).toBe(0);
      const before = f.run(first);
      const exported = exportCirc(first.doc, first.circuits, first.mainName);
      const second = importCirc(exported.xml);
      expect(second.skipped, f.name).toBe(0);
      expect(second.warnings.length, f.name).toBe(first.warnings.length);
      const after = f.run(second);
      expect(after, `${f.name}: export → import must preserve simulation behavior`).toEqual(before);
    }
  });
});
