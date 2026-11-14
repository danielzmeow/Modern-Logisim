import type { CompKind, CompAttrs, ComponentInstance, Facing, Point } from './types';
import { isGate } from './types';
import { tr, type Lang } from '../i18n';

export type CategoryId = 'io' | 'gates' | 'wiring' | 'memory' | 'plexer' | 'text';

export interface Spec {
  kind: CompKind;
  name: string;
  nameEn: string;
  category: CategoryId;
  desc: string;
  descEn: string;
  keywords: string[];
}

export const CATEGORIES: { id: CategoryId; name: string; nameEn: string }[] = [
  { id: 'io', name: '输入与输出', nameEn: 'I/O' },
  { id: 'gates', name: '逻辑门', nameEn: 'Gates' },
  { id: 'wiring', name: '连线与总线', nameEn: 'Wiring' },
  { id: 'memory', name: '存储', nameEn: 'Memory' },
  { id: 'plexer', name: '数据选择', nameEn: 'Plexers' },
  { id: 'text', name: '注释', nameEn: 'Annotation' },
];

export const SPECS: Spec[] = [
  {
    kind: 'input',
    name: '输入引脚',
    nameEn: 'Input Pin',
    category: 'io',
    desc: '可点击切换的输入信号',
    descEn: 'A toggleable input signal',
    keywords: ['pin', 'input', 'switch', 'in', '输入', '引脚'],
  },
  {
    kind: 'output',
    name: '输出引脚',
    nameEn: 'Output Pin',
    category: 'io',
    desc: '显示输出信号的值',
    descEn: 'Displays the value of a signal',
    keywords: ['pin', 'output', 'out', 'probe', '输出', '探针'],
  },
  {
    kind: 'button',
    name: '按钮',
    nameEn: 'Button',
    category: 'io',
    desc: '按住时为高电平',
    descEn: 'High while held down',
    keywords: ['button', 'press', '按钮', '按键'],
  },
  {
    kind: 'clock',
    name: '时钟',
    nameEn: 'Clock',
    category: 'io',
    desc: '运行时持续振荡的信号源',
    descEn: 'A square-wave source while running',
    keywords: ['clock', 'oscillator', 'clock', '时钟', '脉冲'],
  },
  {
    kind: 'led',
    name: '指示灯',
    nameEn: 'LED',
    category: 'io',
    desc: '用颜色显示高低电平',
    descEn: 'Shows a signal as light',
    keywords: ['led', 'lamp', 'light', '灯', '指示灯'],
  },
  {
    kind: 'constant',
    name: '常量',
    nameEn: 'Constant',
    category: 'io',
    desc: '固定的多位数常量',
    descEn: 'A fixed multi-bit constant',
    keywords: ['constant', 'const', 'value', '常量', '常数'],
  },
  {
    kind: 'not',
    name: '非门',
    nameEn: 'NOT Gate',
    category: 'gates',
    desc: '输出输入的反相',
    descEn: 'Inverts its input',
    keywords: ['not', 'inverter', '非门', '反相器'],
  },
  {
    kind: 'and',
    name: '与门',
    nameEn: 'AND Gate',
    category: 'gates',
    desc: '全部输入为一时输出一',
    descEn: 'High only when every input is high',
    keywords: ['and', '与门', 'and gate'],
  },
  {
    kind: 'or',
    name: '或门',
    nameEn: 'OR Gate',
    category: 'gates',
    desc: '任一输入为一时输出一',
    descEn: 'High when any input is high',
    keywords: ['or', '或门'],
  },
  {
    kind: 'nand',
    name: '与非门',
    nameEn: 'NAND Gate',
    category: 'gates',
    desc: '与门输出取反',
    descEn: 'Inverted AND',
    keywords: ['nand', '与非门'],
  },
  {
    kind: 'nor',
    name: '或非门',
    nameEn: 'NOR Gate',
    category: 'gates',
    desc: '或门输出取反',
    descEn: 'Inverted OR',
    keywords: ['nor', '或非门'],
  },
  {
    kind: 'xor',
    name: '异或门',
    nameEn: 'XOR Gate',
    category: 'gates',
    desc: '输入不同时输出一',
    descEn: 'High when inputs differ',
    keywords: ['xor', 'exclusive', '异或门'],
  },
  {
    kind: 'xnor',
    name: '同或门',
    nameEn: 'XNOR Gate',
    category: 'gates',
    desc: '输入相同时输出一',
    descEn: 'High when inputs match',
    keywords: ['xnor', '同或门', 'coincidence'],
  },
  {
    kind: 'split',
    name: '分线器',
    nameEn: 'Bus Split',
    category: 'wiring',
    desc: '把多位总线拆成若干束线',
    descEn: 'Splits a bus into narrower lanes',
    keywords: ['split', 'bus', 'splitter', '总线', '分线', '拆分'],
  },
  {
    kind: 'merge',
    name: '合线器',
    nameEn: 'Bus Merge',
    category: 'wiring',
    desc: '把若干束线合并成总线',
    descEn: 'Merges lanes into one bus',
    keywords: ['merge', 'bus', '总线', '合线', '合并'],
  },
  {
    kind: 'tunnel',
    name: '隧道标签',
    nameEn: 'Tunnel',
    category: 'wiring',
    desc: '同名标签在逻辑上相连',
    descEn: 'Connects nets by shared label',
    keywords: ['tunnel', 'label', 'net', '隧道', '标签', '网络'],
  },
  {
    kind: 'dff',
    name: 'D 触发器',
    nameEn: 'D Flip-Flop',
    category: 'memory',
    desc: '在时钟边沿锁存输入',
    descEn: 'Latches D on a clock edge',
    keywords: ['dff', 'flip flop', 'register', '触发器', 'd', '锁存'],
  },
  {
    kind: 'mux',
    name: '多路选择器',
    nameEn: 'Multiplexer',
    category: 'plexer',
    desc: '按选择信号输出其中一路',
    descEn: 'Selects one of several inputs',
    keywords: ['mux', 'multiplexer', '选择', '多路'],
  },
  {
    kind: 'text',
    name: '文字注释',
    nameEn: 'Text',
    category: 'text',
    desc: '在画布上放置说明文字',
    descEn: 'Places a note on the canvas',
    keywords: ['text', 'note', 'label', '文字', '注释', '说明'],
  },
];

export const SPEC_BY_KIND = Object.fromEntries(SPECS.map((s) => [s.kind, s])) as Record<CompKind, Spec>;

export function specName(kind: CompKind, lang: Lang): string {
  const spec = SPEC_BY_KIND[kind];
  return lang === 'zh' ? spec.name : spec.nameEn;
}

export function specDesc(kind: CompKind, lang: Lang): string {
  const spec = SPEC_BY_KIND[kind];
  return lang === 'zh' ? spec.desc : spec.descEn;
}

export function categoryName(id: CategoryId, lang: Lang): string {
  const cat = CATEGORIES.find((c) => c.id === id);
  return lang === 'zh' ? cat?.name ?? '' : cat?.nameEn ?? '';
}

export function defaultAttrs(kind: CompKind, lang: Lang = 'en'): CompAttrs {
  if (isGate(kind)) {
    return kind === 'not' ? { label: '' } : { label: '', inputs: 2, size: 50 };
  }
  switch (kind) {
    case 'input':
    case 'output':
      return { label: '', bits: 1 };
    case 'button':
      return { label: '' };
    case 'clock':
      return { label: '', freq: 2 };
    case 'constant':
      return { label: '', bits: 8, value: 0 };
    case 'led':
      return { label: '', color: 'emerald' };
    case 'dff':
      return { label: '', trigger: 'rising' };
    case 'mux':
      return { label: '', fans: 1, bits: 1 };
    case 'split':
    case 'merge':
      return { label: '', bits: 8, fans: 2 };
    case 'tunnel':
      return { label: 'net' };
    case 'text':
      return { text: tr(lang, 'inspector.textDefault') };
    default:
      return {};
  }
}

let seq = 0;
export function uid(prefix = 'c'): string {
  seq += 1;
  return `${prefix}${seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function createComp(
  kind: CompKind,
  at: Point,
  facing: Facing = 'east',
  lang: Lang = 'en',
): ComponentInstance {
  return {
    id: uid('c'),
    kind,
    at: { x: Math.round(at.x), y: Math.round(at.y) },
    facing,
    attrs: defaultAttrs(kind, lang),
  };
}

export function displayName(comp: ComponentInstance, lang: Lang): string {
  const spec = SPEC_BY_KIND[comp.kind];
  const n = 1 << (comp.attrs.fans ?? 1);
  if (comp.kind === 'mux') return lang === 'zh' ? `${comp.attrs.fans ?? 1} 选 ${n}` : `${n}:1 MUX`;
  if (isGate(comp.kind) && comp.kind !== 'not') {
    return lang === 'zh'
      ? `${comp.attrs.inputs ?? 2} 输入${spec.name}`
      : `${comp.attrs.inputs ?? 2}-input ${spec.nameEn}`;
  }
  return lang === 'zh' ? spec?.name ?? comp.kind : spec?.nameEn ?? comp.kind;
}
