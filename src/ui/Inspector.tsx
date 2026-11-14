import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useEditor } from '../editor/store';
import type { ComponentInstance, Facing } from '../model/types';
import { buildNetlist } from '../model/netlist';
import { sim } from '../model/sim';
import { viewControls } from '../canvas/view';
import { CompIcon } from './icons';
import { useT } from './useT';
import { categoryName, displayName, SPEC_BY_KIND } from '../model/specs';
import { itemCount } from '../i18n';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CircuitBoard,
  Copy,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-[var(--line)] first:border-t-0">
      <div className="section-title">
        <span>{title}</span>
      </div>
      <div className="px-3.5 pb-3">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="inspector-row">
      <span className="inspector-label">{label}</span>
      <div className="control">{children}</div>
    </div>
  );
}

function TipRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-[11.5px] text-[var(--text-muted)]">
      <span>{label}</span>
      <kbd className="kbd !h-[17px] shrink-0 !text-[10px]">{keys}</kbd>
    </div>
  );
}

function Num({
  value,
  min,
  max,
  onChange,
  suffix,
  width = 38,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  suffix?: string;
  width?: number;
}) {
  const display = (n: number) => String(Object.is(n, -0) ? 0 : n);
  const [text, setText] = useState(display(value));
  useEffect(() => setText(display(value)), [value]);
  const commit = (n: number) => {
    if (!Number.isFinite(n)) {
      setText(display(value));
      return;
    }
    const v = Math.max(min, Math.min(max, Math.round(n)));
    setText(display(v));
    if (v !== value) onChange(v);
  };
  return (
    <div className="flex items-center gap-1.5">
      <div className="num-stepper">
        <button title="−" aria-label="−" onClick={() => commit(value - 1)} tabIndex={-1}>
          <Minus size={11} />
        </button>
        <input
          style={{ width }}
          value={text}
          inputMode="numeric"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => commit(parseFloat(text))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit(parseFloat(text));
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === 'Escape') {
              setText(display(value));
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <button title="+" aria-label="+" onClick={() => commit(value + 1)} tabIndex={-1}>
          <Plus size={11} />
        </button>
      </div>
      {suffix && <span className="text-[11px] text-[var(--text-faint)]">{suffix}</span>}
    </div>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  accent,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  accent?: boolean;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={String(o.value)}
          title={o.title}
          aria-pressed={o.value === value}
          className={`${o.value === value ? 'active' : ''} ${accent && o.value === value ? 'accent' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TextValue({ comp }: { comp: ComponentInstance }) {
  const { t } = useT();
  const [text, setText] = useState(comp.attrs.text ?? '');
  useEffect(() => setText(comp.attrs.text ?? ''), [comp.id, comp.attrs.text]);
  return (
    <textarea
      className="field h-[74px] resize-none py-1.5 leading-[1.55]"
      value={text}
      spellCheck={false}
      placeholder={t('inspector.textPlaceholder')}
      onChange={(e) => {
        setText(e.target.value);
        useEditor.getState().updateComp(comp.id, { text: e.target.value }, `text:${comp.id}`);
      }}
    />
  );
}

function HexField({ comp }: { comp: ComponentInstance }) {
  const { t } = useT();
  const bits = Math.max(1, (comp.attrs.bits ?? 8) as number);
  const current = (comp.attrs.value ?? 0) >>> 0;
  const [text, setText] = useState(current.toString(16).toUpperCase());
  useEffect(() => {
    setText(((comp.attrs.value ?? 0) >>> 0).toString(16).toUpperCase());
  }, [comp.id, comp.attrs.value]);
  const commit = (raw: string) => {
    const cleaned = raw.trim().replace(/^0x/i, '').replace(/[^0-9a-f]/gi, '');
    const n = parseInt(cleaned || '0', 16);
    const mask = (2 ** bits - 1) >>> 0;
    const v = Number.isFinite(n) ? (n & mask) >>> 0 : 0;
    useEditor.getState().updateComp(comp.id, { value: v }, `value:${comp.id}`);
    setText(v.toString(16).toUpperCase());
  };
  return (
    <div>
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] text-[var(--text-faint)]">0x</span>
        <input
          className="field mono uppercase"
          value={text}
          spellCheck={false}
          aria-label={t('inspector.constantValue')}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => commit(text)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(text);
          }}
        />
      </div>
      <div className="mt-1 pl-5 font-mono text-[11px] text-[var(--text-faint)]">
        = {current} · {bits} {t('inspector.bit')}
      </div>
    </div>
  );
}

function PinValueField({ comp }: { comp: ComponentInstance }) {
  const { t } = useT();
  const bits = Math.max(1, Math.min(32, comp.attrs.bits ?? 1));
  const simTick = useEditor((s) => s.simTick);
  const [text, setText] = useState(() => sim.pinValue(comp.id).toString(16).toUpperCase());
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(sim.pinValue(comp.id).toString(16).toUpperCase());
  }, [simTick, comp.id, focused]);
  useEffect(() => {
    setText(sim.pinValue(comp.id).toString(16).toUpperCase());
  }, [comp.id]);
  const commit = (raw = text) => {
    const cleaned = raw.trim().replace(/^0x/i, '').replace(/[^0-9a-f]/gi, '');
    const parsed = parseInt(cleaned || '0', 16);
    const mask = (2 ** bits - 1) >>> 0;
    const n = (Number.isFinite(parsed) ? parsed : 0) & mask;
    sim.setPinValue(comp.id, n >>> 0);
    useEditor.getState().setSimTick(sim.tick + 1);
    viewControls.invalidate();
    setText(n.toString(16).toUpperCase());
  };
  return (
    <div className="mt-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] text-[var(--text-muted)]">{t('inspector.runtimeValue')}</span>
        <span className="font-mono text-[11px] text-[var(--text-faint)]">
          {t('inspector.runtimeBits', { bits })}
        </span>
      </div>
      <input
        className="field mono uppercase"
        value={text}
        aria-label={t('aria.runValue')}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') {
            setText(sim.pinValue(comp.id).toString(16).toUpperCase());
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <div className="mt-1 font-mono text-[12px] text-[var(--text-faint)]">
        = {sim.pinValue(comp.id)} · {t('inspector.runtimeValueHint')}
      </div>
    </div>
  );
}

function MemoryField({ comp }: { comp: ComponentInstance }) {
  const { t } = useT();
  const simTick = useEditor((s) => s.simTick);
  const addrBits = Math.max(1, Math.min(20, comp.attrs.addrBits ?? 4));
  const dataBits = Math.max(1, Math.min(32, comp.attrs.dataBits ?? 8));
  const size = Math.min(256, 2 ** addrBits);
  const addrDigits = Math.max(1, Math.ceil(addrBits / 4));
  const dataDigits = Math.max(1, Math.ceil(dataBits / 4));
  const fmt = (v: number) => (v >>> 0).toString(16).toUpperCase().padStart(dataDigits, '0');
  const fromValues = (values: number[]) =>
    Array.from({ length: size }, (_, i) => `${i.toString(16).toUpperCase().padStart(addrDigits, '0')}: ${fmt(values[i] ?? 0)}`).join('\n');
  const currentValues = () =>
    sim.netOfPort(comp.id, 'dout') >= 0 ? sim.memoryValues(comp) : comp.attrs.memory ?? [];
  const [text, setText] = useState(() => fromValues(currentValues()));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(fromValues(currentValues()));
  }, [comp, comp.id, focused, simTick, addrBits, dataBits, size]);

  const commit = () => {
    const mask = (2 ** dataBits - 1) >>> 0;
    const values: number[] = [];
    let cursor = 0;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const addressed = trimmed.match(/^([0-9a-fA-F]+)\s*:\s*([0-9a-fA-F]+)/);
      if (addressed) {
        const addr = parseInt(addressed[1], 16);
        const n = parseInt(addressed[2], 16);
        if (Number.isFinite(addr) && Number.isFinite(n)) values[addr] = n & mask;
        continue;
      }
      for (const token of trimmed.replace(/[;,]/g, ' ').split(/\s+/).filter(Boolean)) {
        const n = parseInt(token.replace(/^0x/i, ''), 16);
        values[cursor++] = Number.isFinite(n) ? n & mask : 0;
      }
    }
    const next = Array.from({ length: Math.min(size, Math.max(cursor, values.length)) }, (_, i) => values[i] ?? 0);
    useEditor.getState().updateComp(comp.id, { memory: next }, `mem:${comp.id}`);
    sim.loadMemory(comp, next);
    setText(fromValues(next));
    viewControls.invalidate();
  };

  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] text-[var(--text-muted)]">{t('inspector.memory')}</span>
        <span className="font-mono text-[10px] text-[var(--text-faint)]">
          {t('inspector.memoryCells', { n: 1 << addrBits })}
        </span>
      </div>
      <textarea
        className="field h-[150px] resize-y py-1.5 font-mono text-[10.5px] leading-[1.55]"
        value={text}
        spellCheck={false}
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
      />
      <div className="mt-1 text-[11px] leading-[1.45] text-[var(--text-faint)]">
        {t('inspector.memoryHint')}
      </div>
    </div>
  );
}

function SubField({ comp }: { comp: ComponentInstance }) {
  const { t, lang } = useT();
  const circuits = useEditor((s) => s.circuits);
  const switchCircuit = useEditor((s) => s.switchCircuit);
  const target = comp.attrs.circuit ? circuits[comp.attrs.circuit] : undefined;
  return (
    <Section title={t('inspector.circuitTarget')}>
      <Row label={t('inspector.circuitTarget')}>
        <span className="truncate font-mono text-[11px] text-[var(--text-secondary)]">
          {target?.name ?? comp.attrs.circuitName ?? '—'}
        </span>
      </Row>
      <Row label={t('inspector.circuitPins')}>
        <span className="font-mono text-[11px] text-[var(--text-secondary)]">
          {(comp.attrs.subPins ?? []).length}
        </span>
      </Row>
      {target && (
        <button
          className="btn btn-soft mt-2 w-full"
          onClick={() => switchCircuit(comp.attrs.circuit!)}
        >
          {t('inspector.openCircuit')}
        </button>
      )}
      <div className="mt-1.5 text-[12px] leading-4 text-[var(--text-faint)]">
        {lang === 'zh'
          ? '子电路符号的引脚来自目标电路的输入/输出引脚。'
          : 'The symbol pins come from input/output pins in the target circuit.'}
      </div>
    </Section>
  );
}

const FACING_VALUES: Facing[] = ['east', 'south', 'west', 'north'];
const FACING_ICONS: Record<Facing, ReactNode> = {
  east: <ArrowRight size={13} />,
  south: <ArrowDown size={13} />,
  west: <ArrowLeft size={13} />,
  north: <ArrowUp size={13} />,
};

const LED_SWATCHES = [
  { id: 'emerald', color: '#10b981' },
  { id: 'sky', color: '#0ea5e9' },
  { id: 'amber', color: '#f59e0b' },
  { id: 'rose', color: '#f43f5e' },
  { id: 'violet', color: '#8b5cf6' },
] as const;

function CompEditor({ comp }: { comp: ComponentInstance }) {
  const { t, lang } = useT();
  const update = useEditor((s) => s.updateComp);
  const updateGeom = useEditor((s) => s.updateCompGeom);
  const duplicate = useEditor((s) => s.duplicateSelection);
  const remove = useEditor((s) => s.deleteSelection);
  const rotate = useEditor((s) => s.rotateSelection);
  const bits = Math.max(1, Math.min(32, comp.attrs.bits ?? 1));
  const isPin = comp.kind === 'input' || comp.kind === 'output';
  const isBus = comp.kind === 'split' || comp.kind === 'merge';
  const isGate = ['and', 'or', 'nand', 'nor', 'xor', 'xnor', 'odd', 'even'].includes(comp.kind);
  const isWidthGate = ['not', 'buffer', 'ctrlBuffer', 'ctrlInverter'].includes(comp.kind);
  const fans = comp.attrs.fans ?? 2;
  const spec = SPEC_BY_KIND[comp.kind];
  const category = categoryName(spec.category, lang);
  const facingLabels: Record<Facing, string> = {
    east: t('inspector.east'),
    south: t('inspector.south'),
    west: t('inspector.west'),
    north: t('inspector.north'),
  };

  return (
    <>
      <div className="px-3.5 pb-3 pt-1">
        <div className="flex items-center gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--card)] p-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[9px] border border-[var(--line)] bg-[var(--field)] text-[var(--text-secondary)]">
            <CompIcon kind={comp.kind} size={21} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
              {displayName(comp, lang)}
            </div>
            <div className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text-faint)]">
              {category}
            </div>
          </div>
          {comp.kind !== 'text' && (
            <div className="ml-auto flex gap-1">
              <button className="icon-btn !h-6 !w-6" title={t('menu.rotateCW')} onClick={() => rotate(1)}>
                <RotateCw size={12.5} />
              </button>
              <button className="icon-btn !h-6 !w-6" title={t('menu.rotateCCW')} onClick={() => rotate(-1)}>
                <RotateCcw size={12.5} />
              </button>
            </div>
          )}
        </div>
      </div>

      <Section title={t('inspector.basic')}>
        {comp.kind === 'text' ? (
          <div>
            <div className="mb-1.5 text-[11px] text-[var(--text-muted)]">{t('inspector.textContent')}</div>
            <TextValue comp={comp} />
          </div>
        ) : (
          <>
            <Row label={t('inspector.label')}>
              <input
                className="field"
                value={comp.attrs.label ?? ''}
                placeholder={t('inspector.labelPlaceholder')}
                spellCheck={false}
                aria-label={t('inspector.label')}
                onChange={(e) => update(comp.id, { label: e.target.value }, `label:${comp.id}`)}
              />
            </Row>
            {comp.kind === 'tunnel' && (
              <div className="mt-1.5 rounded-md border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2 py-1.5 text-[12px] leading-[1.5] text-[var(--accent-text)]">
                {t('inspector.tunnelHint')}
              </div>
            )}
          </>
        )}
      </Section>

      {(isPin || comp.kind === 'constant' || comp.kind === 'mux' || comp.kind === 'probe') && (
        <Section title={t('inspector.signal')}>
          <Row label={comp.kind === 'mux' ? t('inspector.dataWidth') : t('inspector.width')}>
            <Num
              value={bits}
              min={1}
              max={32}
              suffix={t('inspector.bit')}
              onChange={(n) => update(comp.id, { bits: n })}
            />
          </Row>
          {comp.kind === 'constant' && (
            <div className="mt-1">
              <div className="mb-1.5 text-[11px] text-[var(--text-muted)]">{t('inspector.constantValue')}</div>
              <HexField comp={comp} />
            </div>
          )}
          {comp.kind === 'mux' && (
            <Row label={t('inspector.selectBits')}>
              <Segmented
                accent
                value={comp.attrs.fans ?? 1}
                options={[1, 2, 3, 4].map((n) => ({
                  value: n,
                  label: n,
                  title: `${1 << n} ${lang === 'zh' ? '路输入' : 'data inputs'}`,
                }))}
                onChange={(n) => update(comp.id, { fans: n })}
              />
            </Row>
          )}
          {comp.kind === 'mux' && (
            <div className="mt-1.5 text-[12px] leading-4 text-[var(--text-faint)]">
              {t('inspector.dataInputs', { n: 1 << (comp.attrs.fans ?? 1), bits })}
            </div>
          )}
          {comp.kind === 'input' && bits > 1 && <PinValueField comp={comp} />}
        </Section>
      )}

      {isGate && (
        <Section title={t('inspector.logicGate')}>
          <Row label={t('inspector.dataWidth')}>
            <Num value={bits} min={1} max={32} suffix={t('inspector.bit')} onChange={(n) => update(comp.id, { bits: n })} />
          </Row>
          <Row label={t('inspector.inputCount')}>
            <Segmented
              accent
              value={comp.attrs.inputs ?? 2}
              options={[2, 3, 4, 5].map((n) => ({ value: n, label: n }))}
              onChange={(n) => update(comp.id, { inputs: n })}
            />
          </Row>
        </Section>
      )}

      {comp.kind === 'dff' && (
        <Section title={t('inspector.trigger')}>
          <Row label={t('inspector.triggerEdge')}>
            <Segmented
              accent
              value={comp.attrs.trigger ?? 'rising'}
              options={[
                { value: 'rising' as const, label: t('inspector.rising') },
                { value: 'falling' as const, label: t('inspector.falling') },
              ]}
              onChange={(v) => update(comp.id, { trigger: v })}
            />
          </Row>
          <div className="mt-1.5 font-mono text-[12px] text-[var(--text-faint)]">
            {t('inspector.qReadout', { q: sim.valueOfPort(comp.id, 'q').value ? '1' : '0' })}
          </div>
        </Section>
      )}

      {comp.kind === 'clock' && (
        <Section title={t('inspector.clock')}>
          <Row label={t('inspector.frequency')}>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0.5}
                max={20}
                step={0.5}
                value={comp.attrs.freq ?? 2}
                className="w-[94px]"
                aria-label={t('inspector.frequency')}
                onChange={(e) =>
                  update(comp.id, { freq: Number(e.target.value) }, `freq:${comp.id}`)
                }
              />
              <span className="w-[44px] text-right font-mono text-[11px] text-[var(--text-secondary)]">
                {(comp.attrs.freq ?? 2).toFixed(1)} Hz
              </span>
            </div>
          </Row>
          <div className="mt-1.5 text-[12px] text-[var(--text-faint)]">{t('inspector.clockHint')}</div>
        </Section>
      )}

      {comp.kind === 'led' && (
        <Section title={t('inspector.appearance')}>
          <Row label={t('inspector.color')}>
            <div className="flex items-center gap-2">
              {LED_SWATCHES.map((s) => {
                const label = t(
                  s.id === 'emerald'
                    ? 'inspector.colorEmerald'
                    : s.id === 'sky'
                      ? 'inspector.colorSky'
                      : s.id === 'amber'
                        ? 'inspector.colorAmber'
                        : s.id === 'rose'
                          ? 'inspector.colorRose'
                          : 'inspector.colorViolet',
                );
                return (
                  <button
                    key={s.id}
                    title={label}
                    aria-label={label}
                    aria-pressed={(comp.attrs.color ?? 'emerald') === s.id}
                    className={`swatch ${(comp.attrs.color ?? 'emerald') === s.id ? 'active' : ''}`}
                    style={{ background: s.color }}
                    onClick={() => update(comp.id, { color: s.id })}
                  />
                );
              })}
            </div>
          </Row>
        </Section>
      )}

      {(comp.kind === 'output' || comp.kind === 'led' || comp.kind === 'probe' || comp.kind === 'sevenseg') && (
        <Section title={t('analysis.title')}>
          <button
            className="btn btn-soft w-full"
            onClick={() => useEditor.getState().setTruthOpen(true, comp.id)}
          >
            <Sparkles size={12.5} /> {t('inspector.truthTable')}
          </button>
          <div className="mt-1.5 text-[12px] leading-4 text-[var(--text-faint)]">
            {t('analysis.subtitle')}
          </div>
        </Section>
      )}

      {isWidthGate && (
        <Section title={t('inspector.signal')}>
          <Row label={t('inspector.dataWidth')}>
            <Num value={bits} min={1} max={32} suffix={t('inspector.bit')} onChange={(n) => update(comp.id, { bits: n })} />
          </Row>
        </Section>
      )}

      {(comp.kind === 'register' || comp.kind === 'counter') && (
        <Section title={comp.kind === 'register' ? t('inspector.trigger') : t('inspector.count')}>
          <Row label={t('inspector.width')}>
            <Num value={bits} min={1} max={32} suffix={t('inspector.bit')} onChange={(n) => update(comp.id, { bits: n })} />
          </Row>
          <Row label={t('inspector.triggerEdge')}>
            <Segmented
              accent
              value={comp.attrs.trigger ?? 'rising'}
              options={[
                { value: 'rising' as const, label: t('inspector.rising') },
                { value: 'falling' as const, label: t('inspector.falling') },
              ]}
              onChange={(v) => update(comp.id, { trigger: v })}
            />
          </Row>
          {comp.kind === 'counter' && (
            <Row label={t('inspector.count')}>
              <Segmented
                accent
                value={comp.attrs.count ?? 'up'}
                options={[
                  { value: 'up' as const, label: t('inspector.countUp') },
                  { value: 'down' as const, label: t('inspector.countDown') },
                ]}
                onChange={(v) => update(comp.id, { count: v })}
              />
            </Row>
          )}
          <Row label={t('inspector.enable')}>
            <input
              type="checkbox"
              checked={comp.attrs.enable !== false}
              onChange={(e) => update(comp.id, { enable: e.target.checked })}
            />
          </Row>
          <Row label={t('inspector.reset')}>
            <input
              type="checkbox"
              checked={comp.attrs.reset !== false}
              onChange={(e) => update(comp.id, { reset: e.target.checked })}
            />
          </Row>
          <div className="mt-1.5 font-mono text-[12px] text-[var(--text-faint)]">
            Q = {comp.kind === 'counter' ? sim.valueOfPort(comp.id, 'q').value : sim.valueOfPort(comp.id, 'q').value}
          </div>
        </Section>
      )}

      {(comp.kind === 'ram' || comp.kind === 'rom') && (
        <Section title={t('inspector.memory')}>
          <Row label={t('inspector.addrBits')}>
            <Num value={comp.attrs.addrBits ?? 4} min={1} max={16} suffix={t('inspector.bit')} onChange={(n) => update(comp.id, { addrBits: n })} />
          </Row>
          <Row label={t('inspector.dataBits')}>
            <Num value={comp.attrs.dataBits ?? 8} min={1} max={32} suffix={t('inspector.bit')} onChange={(n) => update(comp.id, { dataBits: n })} />
          </Row>
          <MemoryField comp={comp} />
        </Section>
      )}

      {(comp.kind === 'adder' || comp.kind === 'subtractor' || comp.kind === 'multiplier' || comp.kind === 'comparator') && (
        <Section title={t('inspector.signal')}>
          <Row label={t('inspector.dataWidth')}>
            <Num value={bits} min={1} max={32} suffix={t('inspector.bit')} onChange={(n) => update(comp.id, { bits: n })} />
          </Row>
        </Section>
      )}

      {comp.kind === 'shifter' && (
        <Section title={t('inspector.signal')}>
          <Row label={t('inspector.dataWidth')}>
            <Num value={bits} min={1} max={32} suffix={t('inspector.bit')} onChange={(n) => update(comp.id, { bits: n })} />
          </Row>
          <Row label={t('inspector.shift')}>
            <Segmented
              accent
              value={comp.attrs.shift ?? 'left'}
              options={[
                { value: 'left' as const, label: t('inspector.shiftLeft') },
                { value: 'right' as const, label: t('inspector.shiftRight') },
                { value: 'arithmetic' as const, label: t('inspector.shiftArithmetic') },
              ]}
              onChange={(v) => update(comp.id, { shift: v })}
            />
          </Row>
        </Section>
      )}

      {(comp.kind === 'decoder' || comp.kind === 'demux' || comp.kind === 'priority' || comp.kind === 'bitSelect') && (
        <Section title={t('inspector.selectBits')}>
          <Row label={t('inspector.selectBits')}>
            <Segmented
              accent
              value={comp.attrs.fans ?? 1}
              options={[1, 2, 3, 4].map((n) => ({ value: n, label: n }))}
              onChange={(n) => update(comp.id, { fans: n })}
            />
          </Row>
          {(comp.kind === 'demux' || comp.kind === 'bitSelect') && (
            <Row label={t('inspector.dataWidth')}>
              <Num value={bits} min={1} max={32} suffix={t('inspector.bit')} onChange={(n) => update(comp.id, { bits: n })} />
            </Row>
          )}
          {comp.kind === 'decoder' && (
            <Row label={t('inspector.enable')}>
              <input
                type="checkbox"
                checked={!!comp.attrs.enable}
                onChange={(e) => update(comp.id, { enable: e.target.checked })}
              />
            </Row>
          )}
        </Section>
      )}

      {comp.kind === 'extend' && (
        <Section title={t('inspector.signal')}>
          <Row label={t('inspector.inBits')}>
            <Num value={comp.attrs.inBits ?? 4} min={1} max={32} suffix={t('inspector.bit')} onChange={(n) => update(comp.id, { inBits: n })} />
          </Row>
          <Row label={t('inspector.outBits')}>
            <Num value={comp.attrs.outBits ?? 8} min={1} max={32} suffix={t('inspector.bit')} onChange={(n) => update(comp.id, { outBits: n })} />
          </Row>
          <Row label={t('inspector.signExtend')}>
            <input
              type="checkbox"
              checked={!!comp.attrs.sign}
              onChange={(e) => update(comp.id, { sign: e.target.checked })}
            />
          </Row>
        </Section>
      )}

      {comp.kind === 'pull' && (
        <Section title={t('inspector.pull')}>
          <Row label={t('inspector.pull')}>
            <Segmented
              accent
              value={String(comp.attrs.pull ?? 0)}
              options={[
                { value: '1', label: t('inspector.pullUp') },
                { value: '0', label: t('inspector.pullDown') },
              ]}
              onChange={(v) => update(comp.id, { pull: v === '1' ? 1 : 0 })}
            />
          </Row>
        </Section>
      )}

      {comp.kind === 'sub' && <SubField comp={comp} />}

      {isBus && (
        <Section title={t('inspector.bus')}>
          <Row label={t('inspector.busWidth')}>
            <Num value={bits} min={1} max={32} suffix={t('inspector.bit')} onChange={(n) => update(comp.id, { bits: n })} />
          </Row>
          <Row label={t('inspector.fanout')}>
            <Num
              value={fans}
              min={2}
              max={12}
              suffix={lang === 'zh' ? '路' : ''}
              onChange={(n) => update(comp.id, { fans: n })}
            />
          </Row>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px]">
            <span className="text-[var(--text-faint)]">
              {lang === 'zh'
                ? t('inspector.perFan', { n: Math.max(1, Math.floor(bits / fans)) })
                : `${Math.max(1, Math.floor(bits / fans))} ${Math.max(1, Math.floor(bits / fans)) === 1 ? 'bit' : 'bits'} per channel`}
            </span>
            {bits % fans !== 0 && (
              <span className="text-right text-[var(--warning-text)]">{t('inspector.notDivisible')}</span>
            )}
          </div>
        </Section>
      )}

      <Section title={t('inspector.position')}>
        {comp.kind !== 'text' && (
          <Row label={t('inspector.facing')}>
            <Segmented
              value={comp.facing}
              options={FACING_VALUES.map((f) => ({
                value: f,
                label: FACING_ICONS[f],
                title: facingLabels[f],
              }))}
              onChange={(f) => updateGeom(comp.id, { facing: f })}
            />
          </Row>
        )}
        <Row label={t('inspector.anchor')}>
          <div className="flex items-center gap-1">
            <Num
              width={34}
              value={Math.round(comp.at.x)}
              min={-99999}
              max={99999}
              onChange={(n) => updateGeom(comp.id, { at: { x: n, y: comp.at.y } })}
            />
            <Num
              width={34}
              value={Math.round(comp.at.y)}
              min={-99999}
              max={99999}
              onChange={(n) => updateGeom(comp.id, { at: { x: comp.at.x, y: n } })}
            />
          </div>
        </Row>
        <div className="mt-1.5 text-[12px] leading-4 text-[var(--text-faint)]">
          {t(comp.kind === 'text' ? 'inspector.textMoveHint' : 'inspector.rotateHint')}
        </div>
      </Section>

      <div className="flex gap-1.5 border-t border-[var(--line)] px-3.5 py-3">
        <button className="btn btn-soft flex-1" onClick={duplicate}>
          <Copy size={12.5} /> {t('common.copy')}
        </button>
        <button className="btn btn-soft btn-danger flex-1" onClick={remove}>
          <Trash2 size={12.5} /> {t('common.delete')}
        </button>
      </div>
    </>
  );
}

function MultiEditor({ comps, wires }: { comps: ComponentInstance[]; wires: number }) {
  const { lang, t } = useT();
  const rotate = useEditor((s) => s.rotateSelection);
  const duplicate = useEditor((s) => s.duplicateSelection);
  const remove = useEditor((s) => s.deleteSelection);
  const items = itemCount(lang, comps.length, '个元件', 'component');
  const wireLabel = itemCount(lang, wires, '条导线', 'wire');
  return (
    <>
      <div className="px-3.5 pb-3 pt-1">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-3">
          <div className="text-[13px] font-semibold text-[var(--text-strong)]">{items}</div>
          <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            {wires
              ? t('inspector.multiSubtitleWires', { items, wires: wireLabel })
              : t('inspector.multiSubtitle', { items })}
          </div>
        </div>
      </div>
      <Section title={t('inspector.batchActions')}>
        <div className="grid grid-cols-2 gap-1.5">
          <button className="btn btn-soft" onClick={() => rotate(1)}>
            <RotateCw size={12.5} /> {t('inspector.clockwise')}
          </button>
          <button className="btn btn-soft" onClick={() => rotate(-1)}>
            <RotateCcw size={12.5} /> {t('inspector.counterClockwise')}
          </button>
          <button className="btn btn-soft" onClick={duplicate}>
            <Copy size={12.5} /> {t('common.copy')}
          </button>
          <button className="btn btn-soft btn-danger" onClick={remove}>
            <Trash2 size={12.5} /> {t('common.delete')}
          </button>
        </div>
        <div className="mt-2.5 text-[12px] leading-4 text-[var(--text-faint)]">{t('inspector.multiHint')}</div>
      </Section>
    </>
  );
}

function WireEditor({ count }: { count: number }) {
  const { lang, t } = useT();
  const doc = useEditor((s) => s.doc);
  const selWires = useEditor((s) => s.selWires);
  const remove = useEditor((s) => s.deleteSelection);
  const simTick = useEditor((s) => s.simTick);
  const info = useMemo(() => {
    const nl = buildNetlist(doc);
    const first = doc.wires.findIndex((w) => selWires.includes(w.id));
    if (first < 0) return null;
    const net = nl.wireNet[first];
    const sv = sim.valueOfNet(net);
    return { width: sv.width, value: sv.value, net };
  }, [doc, selWires, simTick]);
  return (
    <>
      <div className="px-3.5 pb-3 pt-1">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--text-strong)]">
            <span className="h-1.5 w-5 rounded-full bg-[var(--accent)]" />
            {t('inspector.wireTitle')}
          </div>
          <div className="mt-1 text-[11px] text-[var(--text-muted)]">
            {itemCount(lang, count, '条导线段', 'wire segment')}
          </div>
        </div>
      </div>
      {info && (
        <Section title={t('inspector.signalValue')}>
          <div className="stat-row">
            <span>{t('inspector.width')}</span>
            <b>
              {info.width} {t('inspector.bit')}
            </b>
          </div>
          <div className="stat-row">
            <span>{t('inspector.currentValue')}</span>
            <b className={info.value ? '!text-[var(--success-text)]' : ''}>
              {info.width === 1 ? info.value : `0x${(info.value >>> 0).toString(16).toUpperCase()}`}
            </b>
          </div>
          <div className="stat-row">
            <span>{t('inspector.net')}</span>
            <b>#{info.net}</b>
          </div>
        </Section>
      )}
      <Section title={t('inspector.actions')}>
        <div className="grid gap-1.5">
          <button className="btn btn-soft btn-danger" onClick={remove}>
            <Trash2 size={12.5} /> {t('inspector.deleteSegment')}
          </button>
          <button
            className="btn btn-soft"
            onClick={() => {
              const first = useEditor.getState().selWires[0];
              if (first) {
                useEditor.getState().selectWireNet(first);
                viewControls.invalidate();
              }
            }}
          >
            {t('inspector.selectNet')}
          </button>
          <button
            className="btn btn-soft btn-danger"
            onClick={() => {
              const st = useEditor.getState();
              const first = st.selWires[0];
              if (!first) return;
              st.selectWireNet(first);
              st.deleteSelection();
              viewControls.invalidate();
            }}
          >
            <Trash2 size={12.5} /> {t('inspector.deleteNet')}
          </button>
        </div>
        <div className="mt-2.5 text-[12px] leading-4 text-[var(--text-faint)]">{t('inspector.wireHint')}</div>
      </Section>
    </>
  );
}

export function Inspector() {
  const { t } = useT();
  const doc = useEditor((s) => s.doc);
  const selComps = useEditor((s) => s.selComps);
  const selWires = useEditor((s) => s.selWires);
  const setInspector = useEditor((s) => s.setInspector);
  const running = useEditor((s) => s.running);
  const simTick = useEditor((s) => s.simTick);
  const comps = doc.comps.filter((c) => selComps.includes(c.id));
  const selectedWires = doc.wires.filter((w) => selWires.includes(w.id));
  const emptyCircuit = doc.comps.length === 0 && doc.wires.length === 0;

  const stats = useMemo(() => {
    if (comps.length || selectedWires.length) return null;
    const nl = buildNetlist(doc);
    const high = nl.nets.filter((n) => sim.valueOfNet(n.id).value !== 0).length;
    return {
      comps: doc.comps.length,
      wires: doc.wires.length,
      nets: nl.nets.length,
      buses: nl.nets.filter((n) => n.width > 1).length,
      high,
    };
  }, [doc, comps.length, selectedWires.length, simTick]);

  return (
    <aside className="side-panel-right relative z-20 flex w-[280px] shrink-0 flex-col">
      <div className="flex h-[42px] shrink-0 items-center justify-between px-3.5 pt-1">
        <div className="panel-label">{t('inspector.title')}</div>
        <button className="icon-btn !h-6 !w-6" title={t('inspector.close')} onClick={() => setInspector(false)}>
          <X size={13} strokeWidth={2} />
        </button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {comps.length === 1 ? (
          <CompEditor comp={comps[0]} />
        ) : comps.length > 1 ? (
          <MultiEditor comps={comps} wires={selectedWires.length} />
        ) : selectedWires.length ? (
          <WireEditor count={selectedWires.length} />
        ) : (
          <>
            <div className="px-3.5 pb-1 pt-1">
              <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-3">
                <div className="flex items-center gap-2">
                  <CircuitBoard size={13} className="text-[var(--accent-text)]" />
                  <div className="text-[12px] font-semibold text-[var(--text-strong)]">
                    {t('inspector.overview')}
                  </div>
                  <span className="ml-auto flex items-center gap-1.5 text-[10.5px] font-medium text-[var(--text-muted)]">
                    <span className={`sim-dot ${running ? 'on' : ''}`} />
                    {running ? t('inspector.running') : t('inspector.paused')}
                  </span>
                </div>
                <div className="mt-2">
                  <div className="stat-row">
                    <span>{t('inspector.components')}</span>
                    <b>{stats?.comps ?? 0}</b>
                  </div>
                  <div className="stat-row">
                    <span>{t('inspector.wires')}</span>
                    <b>{stats?.wires ?? 0}</b>
                  </div>
                  <div className="stat-row">
                    <span>{t('inspector.nets')}</span>
                    <b>{stats?.nets ?? 0}</b>
                  </div>
                  <div className="stat-row">
                    <span>{t('inspector.buses')}</span>
                    <b>{stats?.buses ?? 0}</b>
                  </div>
                  <div className="stat-row">
                    <span>{t('inspector.highNets')}</span>
                    <b className={stats?.high ? '!text-[var(--success-text)]' : ''}>{stats?.high ?? 0}</b>
                  </div>
                </div>
              </div>
            </div>
            <Section title={t('inspector.nothingSelected')}>
              <p className="text-[12px] leading-[1.6] text-[var(--text-secondary)]">
                {emptyCircuit ? t('inspector.emptyCircuitHint') : t('inspector.nothingSelectedHint')}
              </p>
              <div className="mt-2 space-y-0.5 border-t border-[var(--line)] pt-2">
                <TipRow keys="V W H" label={t('inspector.tipTools')} />
                <TipRow keys="R" label={t('inspector.tipRotate')} />
                <TipRow keys="⌘K" label={t('inspector.tipCommands')} />
                <TipRow keys="?" label={t('inspector.tipShortcuts')} />
              </div>
            </Section>
          </>
        )}
      </div>
    </aside>
  );
}
