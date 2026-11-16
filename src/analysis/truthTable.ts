import type { ComponentInstance, Doc, SimWireState } from '../model/types';
import { flattenCircuit } from '../model/hierarchy';
import { Simulator } from '../model/sim';

export interface TruthInput {
  comp: ComponentInstance;
  label: string;
  bits: number;
}

export interface TruthOutput {
  comp: ComponentInstance;
  label: string;
  bits: number;
  port: string;
}

export interface TruthRow {
  inputs: number[];
  outputs: { value: number; state: SimWireState; dontCare?: boolean }[];
}

export type TruthOverride = '0' | '1' | 'x';
export type TruthOverrides = Record<string, TruthOverride>;

/** Apply local 0/1/X edits to single-bit output cells without touching the circuit. */
export function applyTruthOverrides(table: TruthTable, overrides: TruthOverrides): TruthTable {
  if (!Object.keys(overrides).length) return table;
  return {
    ...table,
    rows: table.rows.map((row, rowIndex) => ({
      ...row,
      outputs: row.outputs.map((cell, outputIndex) => {
        if (table.outputs[outputIndex]?.bits !== 1) return cell;
        const override = overrides[`${rowIndex}:${outputIndex}`];
        if (!override) return cell;
        if (override === 'x') return { value: 0, state: 'known' as const, dontCare: true };
        return { value: override === '1' ? 1 : 0, state: 'known' as const };
      }),
    })),
  };
}

export interface TruthTable {
  inputs: TruthInput[];
  outputs: TruthOutput[];
  rows: TruthRow[];
  truncated: boolean;
  sequential: boolean;
  maxRows: number;
}

export const MAX_TRUTH_ROWS = 4096;

const isSequential = (c: ComponentInstance) =>
  c.kind === 'dff' ||
  c.kind === 'tff' ||
  c.kind === 'jkff' ||
  c.kind === 'sr' ||
  c.kind === 'shift' ||
  c.kind === 'random' ||
  c.kind === 'register' ||
  c.kind === 'counter' ||
  c.kind === 'ram';

export function collectInputs(doc: Doc): TruthInput[] {
  return doc.comps
    .filter((c) => c.kind === 'input')
    .sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x)
    .map((comp, i) => ({
      comp,
      label: comp.attrs.label || `I${i + 1}`,
      bits: Math.max(1, Math.min(16, comp.attrs.bits ?? 1)),
    }));
}

export function collectOutputs(doc: Doc): TruthOutput[] {
  const out: TruthOutput[] = [];
  const sorted = [...doc.comps].sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x);
  for (const comp of sorted) {
    if (comp.kind === 'output' || comp.kind === 'probe') {
      out.push({
        comp,
        label: comp.attrs.label || (comp.kind === 'probe' ? 'Probe' : 'Out'),
        bits: Math.max(1, Math.min(32, comp.attrs.bits ?? 1)),
        port: 'in',
      });
    } else if (comp.kind === 'led') {
      out.push({ comp, label: comp.attrs.label || 'LED', bits: 1, port: 'in' });
    } else if (comp.kind === 'sevenseg') {
      out.push({ comp, label: comp.attrs.label || '7-seg', bits: 4, port: 'in' });
    }
  }
  return out;
}

export function buildTruthTable(doc: Doc, circuits?: Record<string, Doc>): TruthTable {
  const inputs = collectInputs(doc);
  const outputs = collectOutputs(doc);
  const flat = circuits ? flattenCircuit(doc, circuits).doc : doc;
  const sequential = flat.comps.some(isSequential);

  let combinations = 1;
  let truncated = false;
  for (const input of inputs) {
    combinations *= 2 ** input.bits;
    if (combinations > MAX_TRUTH_ROWS) {
      truncated = true;
      break;
    }
  }
  const rowCount = Math.min(combinations, MAX_TRUTH_ROWS);
  const rows: TruthRow[] = [];
  if (!inputs.length) {
    const sim = new Simulator();
    sim.update(doc, circuits);
    sim.reset(false, true);
    sim.evaluateNow();
    rows.push({
      inputs: [],
      outputs: outputs.map((o) => {
        const v = sim.valueOfPort(o.comp.id, o.port);
        return { value: v.value, state: v.state };
      }),
    });
    return { inputs, outputs, rows, truncated: false, sequential, maxRows: MAX_TRUTH_ROWS };
  }

  const sim = new Simulator();
  sim.update(doc, circuits);
  const strides: number[] = new Array(inputs.length).fill(1);
  for (let i = inputs.length - 1; i >= 0; i--) {
    strides[i] = i === inputs.length - 1 ? 1 : strides[i + 1] * 2 ** inputs[i + 1].bits;
  }
  for (let row = 0; row < rowCount; row++) {
    const values = inputs.map((input, i) => Math.floor(row / strides[i]) % 2 ** input.bits);
    sim.reset(false, true);
    inputs.forEach((input, i) => sim.setPinValue(input.comp.id, values[i]));
    sim.evaluateNow();
    rows.push({
      inputs: values,
      outputs: outputs.map((o) => {
        const v = sim.valueOfPort(o.comp.id, o.port);
        return { value: v.value, state: v.state };
      }),
    });
  }
  return { inputs, outputs, rows, truncated, sequential, maxRows: MAX_TRUTH_ROWS };
}

export function truthTableCsv(table: TruthTable): string {
  const header = [
    ...table.inputs.map((i) => i.label),
    ...table.outputs.map((o) => o.label),
  ];
  const lines = [header.join(',')];
  for (const row of table.rows) {
    const cells = [
      ...row.inputs.map((v, i) => formatCell(v, table.inputs[i].bits)),
      ...row.outputs.map((o, i) =>
        o.dontCare
          ? 'X'
          : o.state === 'e'
            ? 'E'
            : o.state === 'z'
              ? 'Z'
              : formatCell(o.value, table.outputs[i].bits),
      ),
    ];
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}

function plaIdentifier(base: string, fallback: string, used: Set<string>): string {
  const cleaned = base.replace(/[^A-Za-z0-9_]/g, '_');
  let name = /[A-Za-z0-9]/.test(cleaned) ? cleaned : fallback;
  if (!/^[A-Za-z_]/.test(name)) name = `_${name}`;
  let candidate = name;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${name}_${suffix++}`;
  used.add(candidate);
  return candidate;
}

/** Export a truth table in the common Berkeley PLA format. */
export function truthTablePla(table: TruthTable): string {
  const used = new Set<string>();
  const inputNames: string[] = [];
  table.inputs.forEach((input, inputIndex) => {
    for (let bit = input.bits - 1; bit >= 0; bit--) {
      const base = input.bits === 1 ? input.label : `${input.label}${bit}`;
      inputNames.push(plaIdentifier(base, `I${inputIndex}_${bit}`, used));
    }
  });
  const outputNames: string[] = [];
  table.outputs.forEach((output, outputIndex) => {
    for (let bit = output.bits - 1; bit >= 0; bit--) {
      const base = output.bits === 1 ? output.label : `${output.label}${bit}`;
      outputNames.push(plaIdentifier(base, `O${outputIndex}_${bit}`, used));
    }
  });
  const lines = [
    `.i ${inputNames.length}`,
    `.o ${outputNames.length}`,
    `.ilb ${inputNames.join(' ')}`,
    `.ob ${outputNames.join(' ')}`,
  ];
  for (const row of table.rows) {
    const inputBits: string[] = [];
    table.inputs.forEach((input, inputIndex) => {
      const value = row.inputs[inputIndex] ?? 0;
      for (let bit = input.bits - 1; bit >= 0; bit--) inputBits.push(String((value >>> bit) & 1));
    });
    const outputBits: string[] = [];
    table.outputs.forEach((output, outputIndex) => {
      const cell = row.outputs[outputIndex];
      for (let bit = output.bits - 1; bit >= 0; bit--) {
        outputBits.push(
          cell?.dontCare
            ? '-'
            : cell?.state === 'known'
              ? String((cell.value >>> bit) & 1)
              : '-',
        );
      }
    });
    lines.push(`${inputBits.join('')} ${outputBits.join('')}`);
  }
  lines.push('.e');
  return lines.join('\n');
}

export function formatCell(value: number, bits: number): string {
  if (bits === 1) return String(value & 1);
  const digits = Math.ceil(bits / 4);
  return (value >>> 0).toString(16).toUpperCase().padStart(digits, '0');
}
