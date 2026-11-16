import { describe, expect, it } from 'vitest';
import { buildTruthTable, truthTablePla } from './truthTable';
import { halfAdder } from '../editor/templates';

describe('PLA export', () => {
  it('writes headers and half-adder rows', () => {
    const pla = truthTablePla(buildTruthTable(halfAdder()));
    expect(pla).toContain('.i 2');
    expect(pla).toContain('.o 2');
    expect(pla).toContain('.ilb A B');
    expect(pla).toContain('.ob S C');
    expect(pla).toContain('00 00');
    expect(pla).toContain('11 01');
    expect(pla.trimEnd().endsWith('.e')).toBe(true);
  });

  it('sanitizes labels for PLA identifiers', () => {
    const table = buildTruthTable(halfAdder());
    table.inputs[0].label = '输入 A';
    table.outputs[0].label = '结果 S';
    const pla = truthTablePla(table);
    expect(pla).toMatch(/\.ilb [A-Za-z_]\w*/);
    expect(pla).toMatch(/\.ob [A-Za-z_]\w*/);
  });
});
