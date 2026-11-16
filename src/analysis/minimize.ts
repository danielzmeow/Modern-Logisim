import type { TruthTable } from './truthTable';

export interface MinimizedExpression {
  /** Valid identifier used when generating a circuit. */
  name: string;
  /** Display name from the original output label. */
  label: string;
  /** Comma-separated input names used by the expression. */
  variables: string[];
  /** Sum-of-products expression using !, &, | and parentheses only when needed. */
  expression: string;
}

export interface MinimizeResult {
  expressions: MinimizedExpression[];
  skipped: string[];
  tooManyVariables: boolean;
}

interface Implicant {
  bits: string;
  mask: string;
  covers: number[];
  key: string;
}

const keyOf = (bits: string, mask: string) => `${bits}/${mask}`;

function safeIdentifier(base: string, fallback: string, used: Set<string>): string {
  const cleaned = base.replace(/[^A-Za-z0-9_]/g, '_');
  let name = /[A-Za-z0-9]/.test(cleaned) ? cleaned : fallback;
  if (!/^[A-Za-z_]/.test(name)) name = `_${name}`;
  let candidate = name;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${name}_${suffix++}`;
  used.add(candidate);
  return candidate;
}

function combine(a: Implicant, b: Implicant): Implicant | null {
  if (a.mask !== b.mask) return null;
  let diff = -1;
  for (let i = 0; i < a.mask.length; i++) {
    if (a.mask[i] === '1' && a.bits[i] !== b.bits[i]) {
      if (diff >= 0) return null;
      diff = i;
    }
  }
  if (diff < 0) return null;
  const bits = a.bits.slice(0, diff) + '-' + a.bits.slice(diff + 1);
  const mask = a.mask.slice(0, diff) + '0' + a.mask.slice(diff + 1);
  return {
    bits,
    mask,
    covers: Array.from(new Set([...a.covers, ...b.covers])).sort((x, y) => x - y),
    key: keyOf(bits, mask),
  };
}

function primeImplicants(minterms: number[], variables: number): Implicant[] {
  if (!minterms.length) return [];
  if (variables === 0) {
    return [{ bits: '', mask: '', covers: [0], key: '/ ' }];
  }
  let current = new Map<string, Implicant>();
  for (const term of minterms) {
    const bits = term.toString(2).padStart(variables, '0');
    const imp = { bits, mask: '1'.repeat(variables), covers: [term], key: keyOf(bits, '1'.repeat(variables)) };
    current.set(imp.key, imp);
  }
  const primes = new Map<string, Implicant>();
  while (current.size) {
    const next = new Map<string, Implicant>();
    const used = new Set<string>();
    const list = [...current.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const combined = combine(list[i], list[j]);
        if (!combined) continue;
        used.add(list[i].key);
        used.add(list[j].key);
        next.set(combined.key, combined);
      }
    }
    for (const imp of current.values()) if (!used.has(imp.key)) primes.set(imp.key, imp);
    current = next;
  }
  return [...primes.values()];
}

function termText(imp: Implicant, names: string[]): string {
  const literals: string[] = [];
  for (let i = 0; i < imp.mask.length; i++) {
    if (imp.mask[i] !== '1') continue;
    const name = names[i] ?? `x${i}`;
    literals.push(imp.bits[i] === '1' ? name : `!${name}`);
  }
  return literals.length ? literals.join(' & ') : '1';
}

function cover(minterms: number[], primes: Implicant[]): Implicant[] {
  if (!primes.length) return [];
  const byMinterm = new Map<number, Implicant[]>();
  for (const prime of primes) {
    for (const term of prime.covers) {
      const list = byMinterm.get(term) ?? [];
      list.push(prime);
      byMinterm.set(term, list);
    }
  }
  const chosen = new Map<string, Implicant>();
  const covered = new Set<number>();
  for (const term of minterms) {
    const list = byMinterm.get(term) ?? [];
    if (list.length === 1) {
      chosen.set(list[0].key, list[0]);
      for (const coveredTerm of list[0].covers) covered.add(coveredTerm);
    }
  }
  while (covered.size < minterms.length) {
    let best: Implicant | null = null;
    let bestCount = 0;
    for (const prime of primes) {
      if (chosen.has(prime.key)) continue;
      const count = prime.covers.filter((term) => !covered.has(term)).length;
      if (count > bestCount) {
        best = prime;
        bestCount = count;
      }
    }
    if (!best) break;
    chosen.set(best.key, best);
    for (const term of best.covers) covered.add(term);
  }
  return [...chosen.values()].sort((a, b) => {
    if (a.covers.length !== b.covers.length) return b.covers.length - a.covers.length;
    return a.key.localeCompare(b.key);
  });
}

/**
 * Quine–McCluskey minimization followed by a greedy prime-implicant cover.
 * The result is intentionally a plain SOP expression that can be fed straight
 * back into the equation-to-circuit generator.
 */
export function minimizeTruthTable(table: TruthTable, maxVariables = 10): MinimizeResult {
  const names: string[] = [];
  const used = new Set<string>();
  for (let inputIndex = 0; inputIndex < table.inputs.length; inputIndex++) {
    const input = table.inputs[inputIndex];
    for (let bit = input.bits - 1; bit >= 0; bit--) {
      const base = input.bits === 1 ? input.label : `${input.label}${bit}`;
      names.push(safeIdentifier(base, `I${inputIndex}_${bit}`, used));
    }
  }
  const variables = names.length;
  if (variables > maxVariables) {
    return { expressions: [], skipped: table.outputs.map((o) => o.label), tooManyVariables: true };
  }

  const expressions: MinimizedExpression[] = [];
  const skipped: string[] = [];
  for (let outputIndex = 0; outputIndex < table.outputs.length; outputIndex++) {
    const output = table.outputs[outputIndex];
    for (let bit = 0; bit < output.bits; bit++) {
      const minterms: number[] = [];
      const dontCares: number[] = [];
      let sawUnknown = false;
      for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
        const cell = table.rows[rowIndex].outputs[outputIndex];
        if (cell?.dontCare) {
          dontCares.push(rowIndex);
          continue;
        }
        const value = cell?.value ?? 0;
        const state = cell?.state;
        if (state !== 'known') {
          sawUnknown = true;
          continue;
        }
        if ((value >>> bit) & 1) minterms.push(rowIndex);
      }
      const label = output.bits === 1 ? output.label : `${output.label}${bit}`;
      const name = safeIdentifier(label, `O${outputIndex}_${bit}`, used);
      if (sawUnknown) {
        skipped.push(label);
        continue;
      }
      if (variables > 0 && minterms.length + dontCares.length === 2 ** variables) {
        expressions.push({ name, label, variables: names, expression: '1' });
        continue;
      }
      const primes = primeImplicants([...minterms, ...dontCares], variables);
      const selected = cover(minterms, primes);
      const expression = selected.length
        ? selected.map((imp) => termText(imp, names)).join(' | ')
        : '0';
      expressions.push({ name, label, variables: names, expression });
    }
  }
  return { expressions, skipped, tooManyVariables: false };
}
