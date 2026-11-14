import type { ComponentInstance, CompKind, Doc, Facing, Point } from '../model/types';
import { createComp } from '../model/specs';
import { uid } from '../model/specs';
import { tr, type Lang } from '../i18n';

function comp(
  kind: CompKind,
  x: number,
  y: number,
  attrs: Partial<ComponentInstance['attrs']> = {},
  facing: Facing = 'east',
): ComponentInstance {
  const c = createComp(kind, { x, y }, facing);
  c.attrs = { ...c.attrs, ...attrs };
  return c;
}

function wire(x1: number, y1: number, x2: number, y2: number) {
  return { id: uid('w'), a: { x: x1, y: y1 }, b: { x: x2, y: y2 } };
}

type W = { id: string; a: Point; b: Point };

function doc(name: string, comps: ComponentInstance[], wires: W[]): Doc {
  return { version: 1, name, comps, wires };
}

export function halfAdder(lang: Lang = 'zh'): Doc {
  const comps = [
    comp('input', 100, 120, { label: 'A' }),
    comp('input', 100, 220, { label: 'B' }),
    comp('xor', 280, 140, { label: 'XOR', size: 30 }),
    comp('and', 280, 240, { label: 'CARRY', size: 30 }),
    comp('output', 460, 140, { label: 'S', bits: 1 }, 'west'),
    comp('led', 360, 240, { label: 'C' }),
  ];
  const wires = [
    wire(100, 120, 200, 120),
    wire(200, 120, 200, 130),
    wire(200, 130, 250, 130),
    wire(200, 120, 200, 230),
    wire(200, 230, 250, 230),
    wire(100, 220, 220, 220),
    wire(220, 220, 220, 150),
    wire(220, 150, 250, 150),
    wire(220, 220, 220, 250),
    wire(220, 250, 250, 250),
    wire(280, 140, 460, 140),
    wire(280, 240, 360, 240),
  ];
  return doc(tr(lang, 'template.half.doc'), comps, wires);
}

export function fullAdder(lang: Lang = 'zh'): Doc {
  const comps = [
    comp('input', 100, 100, { label: 'A' }),
    comp('input', 100, 180, { label: 'B' }),
    comp('input', 100, 260, { label: 'Cin' }),
    comp('xor', 260, 140, { label: '', size: 30 }),
    comp('xor', 380, 170, { label: 'S', size: 30 }),
    comp('and', 260, 260, { label: '', size: 30 }),
    comp('and', 300, 340, { label: '', size: 30 }),
    comp('or', 440, 300, { label: 'Cout', size: 30 }),
    comp('output', 520, 170, { label: 'S', bits: 1 }, 'west'),
    comp('output', 560, 300, { label: 'Cout', bits: 1 }, 'west'),
    comp('text', 300, 50, { text: tr(lang, 'template.full.text') }),
  ];
  const wires = [
    wire(100, 100, 200, 100),
    wire(200, 100, 200, 250),
    wire(200, 250, 230, 250),
    wire(200, 130, 230, 130),
    wire(100, 180, 215, 180),
    wire(215, 180, 215, 150),
    wire(215, 150, 230, 150),
    wire(215, 180, 215, 270),
    wire(215, 270, 230, 270),
    wire(100, 260, 160, 260),
    wire(160, 260, 160, 330),
    wire(160, 330, 270, 330),
    wire(160, 260, 160, 240),
    wire(160, 240, 330, 240),
    wire(330, 240, 330, 180),
    wire(330, 180, 350, 180),
    wire(260, 140, 310, 140),
    wire(310, 140, 310, 350),
    wire(310, 350, 270, 350),
    wire(310, 140, 330, 140),
    wire(330, 140, 330, 160),
    wire(330, 160, 350, 160),
    wire(380, 170, 520, 170),
    wire(260, 260, 260, 300),
    wire(260, 300, 400, 300),
    wire(400, 300, 400, 290),
    wire(400, 290, 410, 290),
    wire(300, 340, 300, 320),
    wire(300, 320, 390, 320),
    wire(390, 320, 390, 310),
    wire(390, 310, 410, 310),
    wire(440, 300, 560, 300),
  ];
  return doc(tr(lang, 'template.full.doc'), comps, wires);
}

export function muxDemo(lang: Lang = 'zh'): Doc {
  const comps = [
    comp('input', 100, 160, { label: 'A' }),
    comp('input', 100, 240, { label: 'B' }),
    comp('input', 100, 340, { label: 'S' }),
    comp('mux', 320, 200, { label: 'MUX', fans: 1, bits: 1 }),
    comp('led', 430, 200, { label: 'Y' }),
    comp('text', 300, 80, { text: tr(lang, 'template.mux.text') }),
  ];
  const wires = [
    wire(100, 160, 270, 160),
    wire(270, 160, 270, 190),
    wire(270, 190, 290, 190),
    wire(100, 240, 280, 240),
    wire(280, 240, 280, 210),
    wire(280, 210, 290, 210),
    wire(100, 340, 300, 340),
    wire(300, 340, 300, 220),
    wire(320, 200, 430, 200),
  ];
  return doc(tr(lang, 'template.mux.doc'), comps, wires);
}

export function dffDemo(lang: Lang = 'zh'): Doc {
  const comps = [
    comp('clock', 130, 300, { label: 'CLK', freq: 2 }),
    comp('dff', 300, 200, { label: 'T' }),
    comp('led', 430, 200, { label: 'Q' }),
    comp('text', 300, 100, { text: tr(lang, 'template.dff.text') }),
  ];
  const wires = [
    wire(130, 300, 200, 300),
    wire(200, 300, 200, 220),
    wire(200, 220, 260, 220),
    wire(300, 200, 430, 200),
    wire(300, 220, 320, 220),
    wire(320, 220, 320, 170),
    wire(320, 170, 240, 170),
    wire(240, 170, 240, 200),
    wire(240, 200, 260, 200),
  ];
  return doc(tr(lang, 'template.dff.doc'), comps, wires);
}

export interface Template {
  id: string;
  name: string;
  nameEn: string;
  note: string;
  noteEn: string;
  make: (lang: Lang) => Doc;
}

export const TEMPLATES: Template[] = [
  {
    id: 'half',
    name: '半加器',
    nameEn: 'Half adder',
    note: 'XOR + AND，从最简单的开始',
    noteEn: 'XOR + AND, the classic first circuit',
    make: halfAdder,
  },
  {
    id: 'full',
    name: '全加器',
    nameEn: 'Full adder',
    note: '进位输入、和与进位输出',
    noteEn: 'Carry in, sum and carry out',
    make: fullAdder,
  },
  {
    id: 'mux',
    name: '2:1 选择器',
    nameEn: '2:1 multiplexer',
    note: '用 S 在 A 与 B 之间选择',
    noteEn: 'Use S to pick A or B',
    make: muxDemo,
  },
  {
    id: 'dff',
    name: 'D 触发器',
    nameEn: 'D flip-flop',
    note: '时钟驱动的翻转电路',
    noteEn: 'A clock-driven toggle',
    make: dffDemo,
  },
];

export function templateName(t: Template, lang: Lang): string {
  return lang === 'zh' ? t.name : t.nameEn;
}

export function templateNote(t: Template, lang: Lang): string {
  return lang === 'zh' ? t.note : t.noteEn;
}
