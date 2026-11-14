import type { ComponentInstance, Doc, Point } from '../model/types';
import { createComp, uid } from '../model/specs';
import { portsOf, rotatedBounds, type Bounds } from '../model/geometry';
import { routeWire } from '../model/geometry';

type Expr =
  | { type: 'var'; name: string }
  | { type: 'const'; value: 0 | 1 }
  | { type: 'not'; arg: Expr }
  | { type: 'op'; op: 'and' | 'or' | 'xor'; args: Expr[] };

interface Equation {
  name: string;
  expr: Expr;
}

export interface ParsedEquations {
  equations: Equation[];
  variables: string[];
}

export class EquationError extends Error {}

type Token = { kind: 'id' | 'num' | 'op' | 'lparen' | 'rparen'; text: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen', text: ch });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', text: ch });
      i++;
      continue;
    }
    if (ch === '0' || ch === '1') {
      // Allow multi-digit 0/1 sequences? Treat each bit as a separate value;
      // typical equations only use single constants.
      tokens.push({ kind: 'num', text: ch });
      i++;
      continue;
    }
    if ('&|^*+.~!¬∧∨⊕'.includes(ch)) {
      let text = ch;
      if ((ch === '&' || ch === '|') && input[i + 1] === ch) {
        text = ch + ch;
        i++;
      }
      tokens.push({ kind: 'op', text });
      i++;
      continue;
    }
    if (ch === "'") {
      tokens.push({ kind: 'op', text: '!' });
      i++;
      continue;
    }
    if (/[A-Za-z_]/i.test(ch)) {
      let text = '';
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i])) {
        text += input[i];
        i++;
      }
      const lower = text.toLowerCase();
      if (lower === 'and') tokens.push({ kind: 'op', text: '&' });
      else if (lower === 'or') tokens.push({ kind: 'op', text: '|' });
      else if (lower === 'xor') tokens.push({ kind: 'op', text: '^' });
      else if (lower === 'not') tokens.push({ kind: 'op', text: '!' });
      else tokens.push({ kind: 'id', text });
      continue;
    }
    throw new EquationError(`Unexpected character “${ch}”`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eatOp(...ops: string[]): Token | null {
    const t = this.peek();
    if (t && t.kind === 'op' && ops.includes(t.text)) {
      this.pos++;
      return t;
    }
    return null;
  }

  parse(): Expr {
    const expr = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new EquationError(`Unexpected token “${this.tokens[this.pos].text}”`);
    }
    return expr;
  }

  private parseOr(): Expr {
    let left = this.parseXor();
    while (this.eatOp('|', '||', '+', '∨')) {
      const right = this.parseXor();
      left = flatten('or', left, right);
    }
    return left;
  }

  private parseXor(): Expr {
    let left = this.parseAnd();
    while (this.eatOp('^', '⊕')) {
      const right = this.parseAnd();
      left = flatten('xor', left, right);
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseUnary();
    while (this.eatOp('&', '&&', '*', '∧')) {
      const right = this.parseUnary();
      left = flatten('and', left, right);
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.eatOp('!', '~', '¬')) {
      return { type: 'not', arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    if (!t) throw new EquationError('Unexpected end of expression');
    if (t.kind === 'id') {
      this.pos++;
      return { type: 'var', name: t.text };
    }
    if (t.kind === 'num') {
      this.pos++;
      return { type: 'const', value: t.text === '1' ? 1 : 0 };
    }
    if (t.kind === 'lparen') {
      this.pos++;
      const expr = this.parseOr();
      const close = this.peek();
      if (!close || close.kind !== 'rparen') throw new EquationError('Missing closing parenthesis');
      this.pos++;
      return expr;
    }
    throw new EquationError(`Unexpected token “${t.text}”`);
  }
}

function flatten(op: 'and' | 'or' | 'xor', a: Expr, b: Expr): Expr {
  const args: Expr[] = [];
  for (const expr of [a, b]) {
    if (expr.type === 'op' && expr.op === op) args.push(...expr.args);
    else args.push(expr);
  }
  return chunk(op, args);
}

function chunk(op: 'and' | 'or' | 'xor', args: Expr[]): Expr {
  if (args.length <= 5) return { type: 'op', op, args };
  return { type: 'op', op, args: [...args.slice(0, 4), chunk(op, args.slice(4))] };
}

function exprKey(expr: Expr): string {
  switch (expr.type) {
    case 'var':
      return `v:${expr.name}`;
    case 'const':
      return `c:${expr.value}`;
    case 'not':
      return `n:${exprKey(expr.arg)}`;
    case 'op': {
      const args = expr.args.map(exprKey);
      // AND/OR/XOR are commutative for this simple DAG builder.
      return `${expr.op}:${args.sort().join('|')}`;
    }
  }
}

export function parseEquations(input: string): ParsedEquations {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.replace(/(#|\/\/).*$/, '').trim())
    .filter(Boolean);
  if (!lines.length) throw new EquationError('No equations');
  const equations: Equation[] = [];
  const variables = new Set<string>();
  const names = new Set<string>();
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!m) throw new EquationError(`Expected “name = expression”: ${line}`);
    const name = m[1];
    if (names.has(name)) throw new EquationError(`Duplicate output “${name}”`);
    names.add(name);
    const expr = new Parser(tokenize(m[2])).parse();
    const walk = (e: Expr) => {
      if (e.type === 'var') variables.add(e.name);
      else if (e.type === 'not') walk(e.arg);
      else if (e.type === 'op') e.args.forEach(walk);
    };
    walk(expr);
    equations.push({ name, expr });
  }
  const sortedVariables = Array.from(variables).sort((a, b) => a.localeCompare(b));
  return { equations, variables: sortedVariables };
}

interface Node {
  key: string;
  expr: Expr;
  depth: number;
  y: number;
  comp?: ComponentInstance;
  children: Node[];
}

export interface SynthResult {
  doc: Doc;
  variables: string[];
  outputs: string[];
}

function pointKey(p: Point) {
  return `${Math.round(p.x)},${Math.round(p.y)}`;
}

let channelSeq = 0;

function addOrthogonalWire(
  doc: Doc,
  a: Point,
  b: Point,
  obstacles: Bounds[],
  startFacing: 'east' | 'west' | 'north' | 'south' = 'east',
  endFacing: 'east' | 'west' | 'north' | 'south' = 'west',
) {
  if (Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01) return;
  // Route with a dedicated vertical channel just before the destination.
  // Sharing a channel would make collinear wires from different nets touch in
  // the netlist (Logisim treats that as a junction), so each wire gets its own.
  let pts: Point[];
  if (Math.abs(a.y - b.y) < 0.01 || Math.abs(a.x - b.x) < 0.01) {
    pts = [a, b];
  } else {
    const channel = 6 + 7 * (channelSeq++ % 9);
    const midX = a.x < b.x ? Math.max(a.x + 10, b.x - 14 - channel) : Math.min(a.x - 10, b.x + 14 + channel);
    pts = [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
  }
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    if (Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01) continue;
    if (Math.abs(p.x - q.x) > 0.01 && Math.abs(p.y - q.y) > 0.01) continue;
    doc.wires.push({
      id: uid('w'),
      a: { x: Math.round(p.x), y: Math.round(p.y) },
      b: { x: Math.round(q.x), y: Math.round(q.y) },
    });
  }
}

/**
 * Build a gate-level circuit from a set of “output = expression” lines.
 * Repeated subexpressions are shared within the generated output.
 */
export function synthesizeEquations(input: string, lang: 'zh' | 'en' = 'zh'): SynthResult {
  const parsed = parseEquations(input);
  const doc: Doc = { version: 1, name: 'Equations', comps: [], wires: [] };
  const nodes = new Map<string, Node>();
  const leaves: Node[] = [];
  const gates: Node[] = [];

  const leaf = (expr: Expr): Node => {
    const key = exprKey(expr);
    const existing = nodes.get(key);
    if (existing) return existing;
    const node: Node = { key, expr, depth: 0, y: 0, children: [] };
    nodes.set(key, node);
    leaves.push(node);
    return node;
  };

  const build = (expr: Expr): Node => {
    if (expr.type === 'var' || expr.type === 'const') return leaf(expr);
    const key = exprKey(expr);
    const existing = nodes.get(key);
    if (existing) return existing;
    const children =
      expr.type === 'not' ? [build(expr.arg)] : expr.args.map((arg) => build(arg));
    const depth = Math.max(...children.map((c) => c.depth)) + 1;
    const node: Node = { key, expr, depth, y: 0, children };
    nodes.set(key, node);
    gates.push(node);
    return node;
  };

  const roots = parsed.equations.map((eq) => ({ name: eq.name, node: build(eq.expr) }));

  // Place input pins and constants on the left, one row each.
  const rowGap = 60;
  const startY = 70;
  let row = 0;
  const inputNodes = leaves.filter((n) => n.expr.type === 'var');
  const constNodes = leaves.filter((n) => n.expr.type === 'const');
  for (const node of inputNodes) {
    const y = startY + row * rowGap;
    const name = (node.expr as { name: string }).name;
    const comp = createComp('input', { x: 30, y }, 'east', lang, { label: name, bits: 1 });
    node.comp = comp;
    node.y = y;
    doc.comps.push(comp);
    row++;
  }
  for (const node of constNodes) {
    const y = startY + row * rowGap;
    const value = (node.expr as { value: 0 | 1 }).value;
    const comp = createComp('constant', { x: 30, y }, 'east', lang, { label: '', bits: 1, value });
    node.comp = comp;
    node.y = y;
    doc.comps.push(comp);
    row++;
  }

  // Gate columns by depth. Start after the input/constant column.
  const gateMargin = 170;
  const depths = Array.from(new Set(gates.map((g) => g.depth))).sort((a, b) => a - b);
  for (const depth of depths) {
    const layer = gates.filter((g) => g.depth === depth);
    // Initial y from child average.
    for (const node of layer) {
      node.y =
        node.children.reduce((acc, child) => acc + child.y, 0) / Math.max(1, node.children.length);
    }
    layer.sort((a, b) => a.y - b.y || a.key.localeCompare(b.key));
    // Separate gates in the same column.
    for (let i = 0; i < layer.length; i++) {
      if (i > 0 && layer[i].y - layer[i - 1].y < 76) layer[i].y = layer[i - 1].y + 76;
    }
    for (const node of layer) {
      const x = 30 + gateMargin + (depth - 1) * gateMargin;
      const expr = node.expr;
      if (expr.type !== 'not' && expr.type !== 'op') continue;
      const kind: 'not' | 'and' | 'or' | 'xor' =
        expr.type === 'not' ? 'not' : expr.op;
      const inputs = expr.type === 'not' ? 0 : expr.args.length;
      const comp = createComp(kind, { x, y: Math.round(node.y) }, 'east', lang, {
        label: '',
        bits: 1,
        ...(expr.type === 'not' ? {} : { inputs, size: 50 }),
      });
      node.comp = comp;
      doc.comps.push(comp);
    }
  }

  // Output pins to the right of the last gate column.
  const maxDepth = Math.max(0, ...gates.map((g) => g.depth));
  const outputX = 30 + gateMargin + maxDepth * gateMargin + 90;
  const outputNodes = [...roots].sort((a, b) => a.node.y - b.node.y);
  let prevOutputY = -Infinity;
  for (const root of outputNodes) {
    let y = Math.round(root.node.y);
    if (y - prevOutputY < 40) y = prevOutputY + 40;
    prevOutputY = y;
    const comp = createComp('output', { x: outputX, y }, 'west', lang, {
      label: root.name,
      bits: 1,
    });
    doc.comps.push(comp);
    (root as { comp?: ComponentInstance }).comp = comp;
  }

  // Wire every gate input to its child output.
  const obstacles = () => doc.comps.map((c) => rotatedBounds(c));
  for (const gate of gates) {
    if (!gate.comp) continue;
    const ports = portsOf(gate.comp);
    const inputs = ports.filter((p) => p.dir === 'in');
    gate.children.forEach((child, i) => {
      if (!child.comp) return;
      const from = portsOf(child.comp).find((p) => p.dir === 'out')?.world ?? child.comp.at;
      const to = inputs[i]?.world ?? { x: gate.comp!.at.x, y: gate.comp!.at.y };
      addOrthogonalWire(doc, from, to, obstacles());
    });
  }
  for (const root of roots) {
    const pin = (root as { comp?: ComponentInstance }).comp;
    if (!root.node.comp || !pin) continue;
    const from = portsOf(root.node.comp).find((p) => p.dir === 'out')?.world ?? root.node.comp.at;
    addOrthogonalWire(doc, from, pin.at, obstacles());
  }

  // Merge exact duplicate zero-length segments, mostly for neatness.
  const seen = new Set<string>();
  doc.wires = doc.wires.filter((w) => {
    const a = pointKey(w.a);
    const b = pointKey(w.b);
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    doc,
    variables: parsed.variables,
    outputs: parsed.equations.map((e) => e.name),
  };
}
