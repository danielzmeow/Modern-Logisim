import type { CompKind, CompAttrs, ComponentInstance, Facing, Point } from './types';
import { isGate } from './types';
import { tr, type Lang } from '../i18n';

export type CategoryId = 'io' | 'gates' | 'wiring' | 'arithmetic' | 'memory' | 'plexer' | 'text';

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
  { id: 'arithmetic', name: '算术运算', nameEn: 'Arithmetic' },
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
    kind: 'buffer',
    name: '缓冲器',
    nameEn: 'Buffer',
    category: 'gates',
    desc: '原样输出，可设为三态',
    descEn: 'Passes a signal through',
    keywords: ['buffer', 'driver', '缓冲', '驱动'],
  },
  {
    kind: 'odd',
    name: '奇数校验',
    nameEn: 'Odd Parity',
    category: 'gates',
    desc: '输入中 1 的个数为奇数时输出一',
    descEn: 'High when an odd number of inputs are high',
    keywords: ['odd', 'parity', '奇校验', '校验'],
  },
  {
    kind: 'even',
    name: '偶数校验',
    nameEn: 'Even Parity',
    category: 'gates',
    desc: '输入中 1 的个数为偶数时输出一',
    descEn: 'High when an even number of inputs are high',
    keywords: ['even', 'parity', '偶校验', '校验'],
  },
  {
    kind: 'ctrlBuffer',
    name: '三态缓冲器',
    nameEn: 'Controlled Buffer',
    category: 'gates',
    desc: '使能时输出数据，否则输出高阻',
    descEn: 'Drives data when enabled, otherwise floats',
    keywords: ['tristate', 'controlled', 'buffer', '三态', '缓冲', '使能'],
  },
  {
    kind: 'ctrlInverter',
    name: '三态反相器',
    nameEn: 'Controlled Inverter',
    category: 'gates',
    desc: '使能时输出反相数据，否则输出高阻',
    descEn: 'Drives inverted data when enabled, otherwise floats',
    keywords: ['tristate', 'controlled', 'inverter', '三态', '反相', '使能'],
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
    kind: 'probe',
    name: '探针',
    nameEn: 'Probe',
    category: 'wiring',
    desc: '在不增加输出的情况下观察信号值',
    descEn: 'Observes a net value without an output pin',
    keywords: ['probe', 'observe', '探针', '观察'],
  },
  {
    kind: 'power',
    name: '电源',
    nameEn: 'Power',
    category: 'wiring',
    desc: '恒为高电平',
    descEn: 'Always drives a high level',
    keywords: ['power', 'vcc', 'one', '电源', '高电平'],
  },
  {
    kind: 'ground',
    name: '接地',
    nameEn: 'Ground',
    category: 'wiring',
    desc: '恒为低电平',
    descEn: 'Always drives a low level',
    keywords: ['ground', 'gnd', 'zero', '接地', '低电平'],
  },
  {
    kind: 'pull',
    name: '上拉/下拉电阻',
    nameEn: 'Pull Resistor',
    category: 'wiring',
    desc: '网络悬空时拉向指定电平',
    descEn: 'Pulls a floating net to the chosen level',
    keywords: ['pull', 'resistor', 'up', 'down', '上拉', '下拉', '电阻'],
  },
  {
    kind: 'extend',
    name: '位扩展器',
    nameEn: 'Bit Extender',
    category: 'wiring',
    desc: '零扩展或有符号扩展总线位宽',
    descEn: 'Zero- or sign-extends a bus',
    keywords: ['extend', 'bits', 'sign', '位扩展', '扩展', '符号'],
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
    kind: 'adder',
    name: '加法器',
    nameEn: 'Adder',
    category: 'arithmetic',
    desc: '计算 A + B，可选进位输入输出',
    descEn: 'Computes A + B with carry in and out',
    keywords: ['adder', 'add', 'sum', '加法', '求和'],
  },
  {
    kind: 'subtractor',
    name: '减法器',
    nameEn: 'Subtractor',
    category: 'arithmetic',
    desc: '计算 A − B，可选借位输入输出',
    descEn: 'Computes A − B with borrow in and out',
    keywords: ['subtract', 'minus', '减法', '差'],
  },
  {
    kind: 'multiplier',
    name: '乘法器',
    nameEn: 'Multiplier',
    category: 'arithmetic',
    desc: '计算 A × B，输出为双倍位宽',
    descEn: 'Computes A × B with a double-width product',
    keywords: ['multiply', 'product', '乘法', '乘'],
  },
  {
    kind: 'divider',
    name: '除法器',
    nameEn: 'Divider',
    category: 'arithmetic',
    desc: '计算无符号 A ÷ B，输出商和余数',
    descEn: 'Computes unsigned A ÷ B with quotient and remainder',
    keywords: ['divide', 'divider', 'quotient', 'remainder', '除法', '商', '余数'],
  },
  {
    kind: 'negator',
    name: '取反器',
    nameEn: 'Negator',
    category: 'arithmetic',
    desc: '计算二进制补码的相反数',
    descEn: 'Computes the two’s-complement negation',
    keywords: ['negate', 'negator', 'two complement', '取反', '相反数', '补码'],
  },
  {
    kind: 'bitAdder',
    name: '位加法器',
    nameEn: 'Bit Adder',
    category: 'arithmetic',
    desc: '统计输入中 1 的个数',
    descEn: 'Counts the number of high input bits',
    keywords: ['bit adder', 'popcount', 'ones', '位加法', '计数', '置位'],
  },
  {
    kind: 'bitFinder',
    name: '位查找器',
    nameEn: 'Bit Finder',
    category: 'arithmetic',
    desc: '查找最低/最高位为 0 或 1 的位置',
    descEn: 'Finds the lowest or highest 0/1 bit',
    keywords: ['bit finder', 'find', 'index', '位查找', '最低位', '最高位'],
  },
  {
    kind: 'comparator',
    name: '比较器',
    nameEn: 'Comparator',
    category: 'arithmetic',
    desc: '比较 A 与 B，输出 >、=、<',
    descEn: 'Compares A and B, outputs >, =, <',
    keywords: ['compare', 'comparator', 'greater', 'less', '比较', '大小'],
  },
  {
    kind: 'shifter',
    name: '移位器',
    nameEn: 'Shifter',
    category: 'arithmetic',
    desc: '按指定方向移动数据位',
    descEn: 'Shifts data left or right',
    keywords: ['shift', 'shifter', 'left', 'right', '移位', '左移', '右移'],
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
    kind: 'tff',
    name: 'T 触发器',
    nameEn: 'T Flip-Flop',
    category: 'memory',
    desc: 'T 为一时每个时钟沿翻转',
    descEn: 'Toggles on each clock edge while T is high',
    keywords: ['tff', 'toggle', 'flip flop', '触发器', '翻转'],
  },
  {
    kind: 'jkff',
    name: 'JK 触发器',
    nameEn: 'JK Flip-Flop',
    category: 'memory',
    desc: '支持置位、复位和翻转的边沿触发器',
    descEn: 'Edge-triggered flip-flop with set, reset and toggle',
    keywords: ['jk', 'flip flop', '触发器', '置位', '复位'],
  },
  {
    kind: 'sr',
    name: 'SR 锁存器',
    nameEn: 'S-R Latch',
    category: 'memory',
    desc: '由置位/复位输入保持状态的锁存器',
    descEn: 'A level-sensitive set/reset latch',
    keywords: ['sr', 'latch', 'set reset', '锁存', '置位', '复位'],
  },
  {
    kind: 'shift',
    name: '移位寄存器',
    nameEn: 'Shift Register',
    category: 'memory',
    desc: '在每个时钟沿把数据移入寄存器',
    descEn: 'Shifts one bit into a multi-bit register on each clock edge',
    keywords: ['shift', 'register', 'serial', '移位', '寄存器', '串行'],
  },
  {
    kind: 'register',
    name: '寄存器',
    nameEn: 'Register',
    category: 'memory',
    desc: '多位数据在时钟沿锁存',
    descEn: 'Latches multi-bit data on a clock edge',
    keywords: ['register', 'latch', 'register', '寄存器', '锁存'],
  },
  {
    kind: 'counter',
    name: '计数器',
    nameEn: 'Counter',
    category: 'memory',
    desc: '在时钟沿递增或递减',
    descEn: 'Counts up or down on a clock edge',
    keywords: ['counter', 'count', '计数器', '计数'],
  },
  {
    kind: 'ram',
    name: 'RAM',
    nameEn: 'RAM',
    category: 'memory',
    desc: '可读写的随机存取存储器',
    descEn: 'Random-access memory with a write port',
    keywords: ['ram', 'memory', 'write', 'memory', '内存', '存储器', '读写'],
  },
  {
    kind: 'rom',
    name: 'ROM',
    nameEn: 'ROM',
    category: 'memory',
    desc: '只读存储器，内容可直接编辑',
    descEn: 'Read-only memory with editable contents',
    keywords: ['rom', 'memory', 'read', 'only', '只读', '存储器'],
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
    kind: 'decoder',
    name: '译码器',
    nameEn: 'Decoder',
    category: 'plexer',
    desc: '把选择值译成一路高电平输出',
    descEn: 'Turns a select value into one active output',
    keywords: ['decoder', 'decode', '译码', '译码器'],
  },
  {
    kind: 'demux',
    name: '解复用器',
    nameEn: 'Demultiplexer',
    category: 'plexer',
    desc: '把数据送到选择信号指定的一路',
    descEn: 'Routes data to the selected output',
    keywords: ['demux', 'demultiplexer', '解复用', '分配'],
  },
  {
    kind: 'priority',
    name: '优先编码器',
    nameEn: 'Priority Encoder',
    category: 'plexer',
    desc: '输出最高有效输入位的编号',
    descEn: 'Reports the index of the highest active input',
    keywords: ['priority', 'encoder', '优先', '编码'],
  },
  {
    kind: 'bitSelect',
    name: '位选择器',
    nameEn: 'Bit Selector',
    category: 'plexer',
    desc: '从总线中选出指定的一位',
    descEn: 'Selects one bit from a bus',
    keywords: ['bit', 'select', 'selector', '位选', '选择位'],
  },
  {
    kind: 'sevenseg',
    name: '七段数码管',
    nameEn: 'Seven-Segment Display',
    category: 'io',
    desc: '把 4 位十六进制值显示为数码管字形',
    descEn: 'Displays a 4-bit hexadecimal digit',
    keywords: ['seven', 'segment', 'display', '数码管', '七段'],
  },
  {
    kind: 'sub',
    name: '子电路',
    nameEn: 'Subcircuit',
    category: 'wiring',
    desc: '把另一个电路作为元件实例化',
    descEn: 'Instantiates another circuit as a component',
    keywords: ['subcircuit', 'hierarchy', 'module', '子电路', '模块', '层次'],
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
    if (kind === 'not' || kind === 'buffer') return { label: '', bits: 1 };
    return { label: '', inputs: 2, size: 50, bits: 1 };
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
    case 'tff':
      return { label: '', trigger: 'rising' };
    case 'jkff':
      return { label: '', trigger: 'rising' };
    case 'sr':
      return { label: '' };
    case 'shift':
      return { label: '', bits: 8, trigger: 'rising', enable: true, reset: true };
    case 'register':
      return { label: '', bits: 8, trigger: 'rising', enable: true, reset: true };
    case 'counter':
      return { label: '', bits: 8, trigger: 'rising', count: 'up', enable: true, reset: true };
    case 'ram':
      return { label: '', addrBits: 4, dataBits: 8, memory: [] };
    case 'rom':
      return { label: '', addrBits: 4, dataBits: 8, memory: [] };
    case 'mux':
      return { label: '', fans: 1, bits: 1 };
    case 'decoder':
      return { label: '', fans: 1, enable: false };
    case 'demux':
      return { label: '', fans: 1, bits: 1 };
    case 'priority':
      return { label: '', fans: 2 };
    case 'bitSelect':
      return { label: '', fans: 2, bits: 8 };
    case 'adder':
    case 'subtractor':
    case 'comparator':
      return { label: '', bits: 8 };
    case 'multiplier':
      return { label: '', bits: 4 };
    case 'divider':
    case 'negator':
      return { label: '', bits: 8 };
    case 'bitAdder':
      return { label: '', bits: 8 };
    case 'bitFinder':
      return { label: '', bits: 8, find: 'low1' };
    case 'shifter':
      return { label: '', bits: 8, shift: 'left' };
    case 'split':
    case 'merge':
      return { label: '', bits: 8, fans: 2 };
    case 'pull':
      return { label: '', pull: 0 };
    case 'extend':
      return { label: '', inBits: 4, outBits: 8, sign: false };
    case 'sevenseg':
      return { label: '', color: 'rose' };
    case 'probe':
    case 'power':
    case 'ground':
      return { label: '' };
    case 'sub':
      return { label: '', circuit: '', subPins: [], subW: 80, subH: 60 };
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
  attrs: Partial<CompAttrs> = {},
): ComponentInstance {
  return {
    id: uid('c'),
    kind,
    at: { x: Math.round(at.x), y: Math.round(at.y) },
    facing,
    attrs: { ...defaultAttrs(kind, lang), ...attrs },
  };
}

export function displayName(comp: ComponentInstance, lang: Lang): string {
  const spec = SPEC_BY_KIND[comp.kind];
  const n = 1 << (comp.attrs.fans ?? 1);
  if (comp.kind === 'mux') return lang === 'zh' ? `${comp.attrs.fans ?? 1} 选 ${n}` : `${n}:1 MUX`;
  if (comp.kind === 'decoder') return lang === 'zh' ? `${n} 路译码器` : `${n}-output decoder`;
  if (comp.kind === 'demux') return lang === 'zh' ? `1 分 ${n}` : `1:${n} demux`;
  if (comp.kind === 'sub') return comp.attrs.circuitName || comp.attrs.circuit || (lang === 'zh' ? '子电路' : 'Subcircuit');
  if (isGate(comp.kind) && comp.kind !== 'not' && comp.kind !== 'buffer') {
    return lang === 'zh'
      ? `${comp.attrs.inputs ?? 2} 输入${spec.name}`
      : `${comp.attrs.inputs ?? 2}-input ${spec.nameEn}`;
  }
  return lang === 'zh' ? spec?.name ?? comp.kind : spec?.nameEn ?? comp.kind;
}
