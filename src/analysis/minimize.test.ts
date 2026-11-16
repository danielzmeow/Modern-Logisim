import { describe, expect, it } from 'vitest';
import { minimizeTruthTable } from './minimize';
import { synthesizeEquations } from './equations';
import { buildTruthTable, type TruthTable } from './truthTable';
import { halfAdder } from '../editor/templates';
import { createComp } from '../model/specs';

function tableFor(values: number[], inputBits = 1): TruthTable {
  const input = createComp('input', { x: 0, y: 0 }, 'east', 'en', { bits: inputBits });
  input.attrs.label = 'A';
  const output = createComp('output', { x: 100, y: 0 }, 'west');
  output.attrs.label = 'Y';
  const input2 = createComp('input', { x: 0, y: 40 });
  input2.attrs.label = 'B';
  return {
    inputs:
      inputBits === 1
        ? [
            { comp: input, label: 'A', bits: 1 },
            { comp: input2, label: 'B', bits: 1 },
          ]
        : [{ comp: input, label: 'A', bits: inputBits }],
    outputs: [{ comp: output, label: 'Y', bits: 1, port: 'in' }],
    rows: values.map((value, i) => ({
      inputs: [i],
      outputs: [{ value, state: 'known' as const }],
    })),
    truncated: false,
    sequential: false,
    maxRows: 4096,
  };
}

describe('boolean minimization', () => {
  it('minimizes a two-input AND', () => {
    const result = minimizeTruthTable(tableFor([0, 0, 0, 1]));
    expect(result.tooManyVariables).toBe(false);
    expect(result.expressions).toHaveLength(1);
    expect(result.expressions[0].expression.replace(/\s/g, '')).toMatch(/^[AB]&[AB]$/);
  });

  it('minimizes a two-input OR', () => {
    const result = minimizeTruthTable(tableFor([0, 1, 1, 1]));
    const terms = result.expressions[0].expression.split(' | ').sort();
    expect(terms).toEqual(['A', 'B']);
  });

  it('collapses all-zero and all-one outputs', () => {
    expect(minimizeTruthTable(tableFor([0, 0, 0, 0])).expressions[0].expression).toBe('0');
    expect(minimizeTruthTable(tableFor([1, 1, 1, 1])).expressions[0].expression).toBe('1');
  });

  it('skips outputs whose rows are all unknown', () => {
    const table = tableFor([0, 0, 0, 0]);
    table.rows.forEach((row) => {
      row.outputs[0].state = 'e';
    });
    const result = minimizeTruthTable(table);
    expect(result.expressions).toHaveLength(0);
    expect(result.skipped).toEqual(['Y']);
  });

  it('refuses to expand more than the variable limit', () => {
    const result = minimizeTruthTable(tableFor([0], 11), 10);
    expect(result.tooManyVariables).toBe(true);
    expect(result.expressions).toHaveLength(0);
  });

  it('works on a real truth table from the editor', () => {
    const result = minimizeTruthTable(buildTruthTable(halfAdder()));
    expect(result.expressions.map((entry) => entry.label)).toEqual(['S', 'C']);
    expect(result.expressions.every((entry) => entry.expression !== '0')).toBe(true);
  });

  it('produces names that the equation parser can consume', () => {
    const table = tableFor([0, 0, 0, 1]);
    table.inputs[0].label = '输入 A';
    table.outputs[0].label = '结果 Y';
    const result = minimizeTruthTable(table);
    const entry = result.expressions[0];
    expect(entry.name).toMatch(/^[A-Za-z_]\w*$/);
    for (const variable of entry.variables) expect(variable).toMatch(/^[A-Za-z_]\w*$/);
    const generated = synthesizeEquations(`${entry.name} = ${entry.expression}`, 'en');
    expect(generated.outputs).toEqual([entry.name]);
    expect(generated.doc.comps.length).toBeGreaterThan(0);
  });
});

describe('minimization guardrails', () => {
  it('collapses a full 10-variable truth table without expanding primes', () => {
    const table = tableFor(Array.from({ length: 1024 }, () => 1), 10);
    const result = minimizeTruthTable(table);
    expect(result.expressions[0].expression).toBe('1');
  });
});
