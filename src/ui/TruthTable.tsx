import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../editor/store';
import { useT } from './useT';
import { useFocusTrap } from './useFocusTrap';
import { buildTruthTable, applyTruthOverrides, formatCell, truthTableCsv, truthTablePla, type TruthOverride, type TruthOverrides } from '../analysis/truthTable';
import { minimizeTruthTable } from '../analysis/minimize';
import { synthesizeEquations } from '../analysis/equations';
import { viewControls } from '../canvas/view';
import { ClipboardCopy, FunctionSquare, Hash, Wand2, X } from 'lucide-react';

export function TruthTable() {
  const open = useEditor((s) => s.truthOpen);
  const focus = useEditor((s) => s.truthFocus);
  const setOpen = useEditor((s) => s.setTruthOpen);
  const doc = useEditor((s) => s.doc);
  const circuits = useEditor((s) => s.circuits);
  const { t, lang } = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [copiedPla, setCopiedPla] = useState(false);
  const [showExpressions, setShowExpressions] = useState(false);
  const [overrides, setOverrides] = useState<TruthOverrides>({});
  useFocusTrap(panelRef, open);

  const baseTable = useMemo(() => {
    if (!open) return null;
    try {
      return buildTruthTable(doc, circuits);
    } catch (err) {
      console.error(err);
      return null;
    }
  }, [open, doc, circuits]);

  const table = useMemo(
    () => (baseTable ? applyTruthOverrides(baseTable, overrides) : null),
    [baseTable, overrides],
  );

  useEffect(() => {
    setOverrides({});
  }, [open, doc, circuits]);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setCopiedPla(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) setShowExpressions(false);
  }, [open]);

  const minimized = useMemo(() => {
    if (!open || !showExpressions || !table || table.sequential) return null;
    try {
      return minimizeTruthTable(table);
    } catch (err) {
      console.error(err);
      return null;
    }
  }, [open, showExpressions, table]);

  if (!open) return null;

  const copy = async () => {
    if (!table) return;
    try {
      await navigator.clipboard.writeText(truthTableCsv(table));
      setCopied(true);
      useEditor.getState().toastMsg(t('analysis.copied'), 'success');
    } catch {
      useEditor.getState().toastMsg(t('analysis.failed'), 'error');
    }
  };

  const copyPla = async () => {
    if (!table) return;
    try {
      await navigator.clipboard.writeText(truthTablePla(table));
      setCopiedPla(true);
      useEditor.getState().toastMsg(t('analysis.plaCopied'), 'success');
    } catch {
      useEditor.getState().toastMsg(t('analysis.failed'), 'error');
    }
  };

  const empty = !table || !table.outputs.length || (!table.inputs.length && !table.outputs.length);
  const editedCount = Object.keys(overrides).length;

  const cycleCell = (rowIndex: number, outputIndex: number) => {
    if (!table || table.sequential || table.outputs[outputIndex]?.bits !== 1) return;
    const key = `${rowIndex}:${outputIndex}`;
    const cell = table.rows[rowIndex]?.outputs[outputIndex];
    setOverrides((prev) => {
      const current = prev[key];
      let next: TruthOverride | undefined;
      if (!current) next = cell?.value ? '0' : '1';
      else if (current === '0') next = '1';
      else if (current === '1') next = 'x';
      else next = undefined;
      const copy = { ...prev };
      if (next) copy[key] = next;
      else delete copy[key];
      return copy;
    });
  };

  const generateCircuit = () => {
    if (!minimized?.expressions.length) return;
    try {
      const source = minimized.expressions
        .map((entry) => `${entry.name} = ${entry.expression}`)
        .join('\n');
      const result = synthesizeEquations(source, lang);
      const st = useEditor.getState();
      const base = minimized.expressions.length === 1
        ? minimized.expressions[0].name
        : t('analysis.generatedName');
      let name = base;
      let n = 2;
      const names = new Set(Object.values(st.circuits).map((d) => d.name));
      while (names.has(name)) name = `${base} ${n++}`;
      result.doc.name = name;
      const id = st.createCircuit(name, result.doc);
      st.switchCircuit(id);
      setOpen(false);
      setTimeout(() => {
        st.toastMsg(t('analysis.generated', { name }), 'success');
        viewControls.fit();
      }, 30);
    } catch (err) {
      console.error(err);
      useEditor.getState().toastMsg(t('analysis.generateFailed'), 'error');
    }
  };

  return (
    <div
      className="modal-backdrop flex items-start justify-center overflow-y-auto px-6 py-[6vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={panelRef}
        className="modal-panel flex max-h-[86vh] w-full max-w-[900px] flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label={t('analysis.title')}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-md border border-[var(--line)] bg-[var(--field)] text-[var(--text-secondary)]">
              <Hash size={14} />
            </span>
            <div>
              <div className="text-[13px] font-semibold text-[var(--text-strong)]">{t('analysis.title')}</div>
              <div className="text-[11px] text-[var(--text-muted)]">
                {doc.name} · {t('analysis.subtitle')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {editedCount > 0 && (
              <button
                className="btn btn-soft !h-7 !text-[11px]"
                onClick={() => setOverrides({})}
              >
                {t('analysis.resetEdits', { n: editedCount })}
              </button>
            )}
            <button
              className="btn btn-soft !h-7 !text-[11px]"
              onClick={() => setShowExpressions((v) => !v)}
              disabled={!table || table.sequential || !table.outputs.length}
            >
              <FunctionSquare size={12} />{' '}
              {showExpressions ? t('analysis.hideExpressions') : t('analysis.simplify')}
            </button>
            <button className="btn btn-soft !h-7 !text-[11px]" onClick={copy} disabled={!table || empty}>
              <ClipboardCopy size={12} /> {copied ? '✓' : t('analysis.copyCsv')}
            </button>
            <button className="btn btn-soft !h-7 !text-[11px]" onClick={copyPla} disabled={!table || empty}>
              <ClipboardCopy size={12} /> {copiedPla ? '✓' : t('analysis.copyPla')}
            </button>
            <button
              autoFocus
              className="icon-btn !h-7 !w-7"
              onClick={() => setOpen(false)}
              title={t('analysis.close')}
              aria-label={t('common.close')}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-auto">
          {empty ? (
            <div className="px-6 py-14 text-center text-[12px] text-[var(--text-muted)]">
              {table && !table.outputs.length ? t('analysis.noOutputs') : t('analysis.empty')}
            </div>
          ) : (
            <table className="w-full border-collapse text-[11.5px]">
              <thead className="sticky top-0 z-10 bg-[var(--surface-raised)] shadow-[0_1px_0_var(--line)]">
                <tr>
                  {table!.inputs.map((input) => (
                    <th
                      key={`in-${input.comp.id}`}
                      className="border-r border-[var(--line)] px-2.5 py-2 text-left font-semibold text-[var(--text-secondary)] last:border-r-0"
                    >
                      <span className="flex items-center gap-1.5">
                        {input.label}
                        <span className="font-mono text-[10px] font-normal text-[var(--text-faint)]">
                          {input.bits}b
                        </span>
                      </span>
                    </th>
                  ))}
                  {table!.outputs.map((output) => {
                    const active = output.comp.id === focus;
                    return (
                      <th
                        key={`out-${output.comp.id}`}
                        title={t('analysis.focus', { name: output.label })}
                        className={`border-l border-[var(--line)] px-2.5 py-2 text-left font-semibold ${
                          active
                            ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                            : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          {output.label}
                          <span className="font-mono text-[10px] font-normal text-[var(--text-faint)]">
                            {output.bits}b
                          </span>
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {table!.rows.map((row, ri) => (
                  <tr key={ri} className="border-t border-[var(--line)] hover:bg-[var(--hover)]">
                    {row.inputs.map((value, i) => (
                      <td
                        key={`i-${ri}-${i}`}
                        className="border-r border-[var(--line)] px-2.5 py-1.5 font-mono tabular-nums text-[var(--text)] last:border-r-0"
                      >
                        {formatCell(value, table!.inputs[i].bits)}
                      </td>
                    ))}
                    {row.outputs.map((output, i) => {
                      const active = table!.outputs[i].comp.id === focus;
                      const editable = !table!.sequential && table!.outputs[i].bits === 1;
                      const override = overrides[`${ri}:${i}`];
                      const text = output.dontCare
                        ? 'X'
                        : output.state === 'e'
                          ? 'E'
                          : output.state === 'z'
                            ? 'Z'
                            : formatCell(output.value, table!.outputs[i].bits);
                      return (
                        <td
                          key={`o-${ri}-${i}`}
                          title={editable ? t('analysis.editCell') : undefined}
                          tabIndex={editable ? 0 : undefined}
                          onClick={() => cycleCell(ri, i)}
                          onKeyDown={(e) => {
                            if (!editable) return;
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              cycleCell(ri, i);
                            }
                          }}
                          className={`border-l border-[var(--line)] px-2.5 py-1.5 font-mono tabular-nums ${
                            editable ? 'cursor-pointer select-none hover:bg-[var(--hover)]' : ''
                          } ${override ? 'ring-1 ring-inset ring-[var(--accent-line)]' : ''} ${
                            active
                              ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]'
                              : output.dontCare
                                ? 'text-[var(--warning-text)]'
                                : output.state === 'e'
                                  ? 'text-[var(--danger-text)]'
                                  : output.state === 'z'
                                    ? 'text-[var(--text-faint)]'
                                    : output.value
                                      ? 'text-[var(--success-text)]'
                                      : 'text-[var(--text-muted)]'
                          }`}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {showExpressions && (
          <div className="scroll-thin max-h-[30vh] shrink-0 overflow-auto border-t border-[var(--line)] bg-[var(--surface-raised)] px-4 py-3">
            <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
              <FunctionSquare size={12} />
              {t('analysis.expressions')}
              {!!minimized?.expressions.length && (
                <button
                  className="btn btn-soft ml-auto !h-6 !text-[10.5px] normal-case tracking-normal"
                  onClick={generateCircuit}
                >
                  <Wand2 size={11} /> {t('analysis.generateCircuit')}
                </button>
              )}
            </div>
            {table?.sequential ? (
              <div className="text-[11.5px] text-[var(--warning-text)]">
                {t('analysis.sequentialNoMinimize')}
              </div>
            ) : minimized?.tooManyVariables ? (
              <div className="text-[11.5px] text-[var(--warning-text)]">
                {t('analysis.tooManyVariables', { n: 10 })}
              </div>
            ) : minimized && minimized.expressions.length ? (
              <div className="grid gap-1.5">
                {minimized.expressions.map((entry) => (
                  <div
                    key={entry.name}
                    className="flex items-start gap-2 rounded-md border border-[var(--line)] bg-[var(--card)] px-2 py-1.5"
                  >
                    <span className="shrink-0 font-mono text-[11.5px] font-semibold text-[var(--text-strong)]">
                      {entry.label} =
                    </span>
                    <code className="break-all font-mono text-[11.5px] leading-[1.5] text-[var(--accent-text)]">
                      {entry.expression}
                    </code>
                  </div>
                ))}
                {!!minimized.skipped.length && (
                  <div className="text-[11px] text-[var(--text-faint)]">
                    {t('analysis.skippedExpressions', { names: minimized.skipped.join(', ') })}
                  </div>
                )}
                <div className="text-[11px] leading-[1.45] text-[var(--text-faint)]">
                  {t('analysis.expressionsHint')}
                </div>
              </div>
            ) : (
              <div className="text-[11.5px] text-[var(--text-muted)]">{t('analysis.noExpressions')}</div>
            )}
          </div>
        )}

        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--line)] px-4 py-2 text-[11px] text-[var(--text-faint)]">
          <span>
            {t('analysis.inputs')} {table?.inputs.length ?? 0} · {t('analysis.outputs')}{' '}
            {table?.outputs.length ?? 0} · {t('analysis.rows', { n: table?.rows.length ?? 0 })}
          </span>
          {table?.sequential && (
            <span className="text-[var(--warning-text)]">{t('analysis.sequential')}</span>
          )}
          {table?.truncated && (
            <span className="text-[var(--warning-text)]">
              {t('analysis.tooMany', { n: table.maxRows })}
            </span>
          )}
          {table && !table.sequential && (
            <span>{t('analysis.editHint')}</span>
          )}
          <span className="ml-auto">
            {lang === 'zh' ? 'E = 冲突 / Z = 高阻 / X = 无关项' : 'E = conflict / Z = high-Z / X = don’t care'}
          </span>
        </div>
      </div>
    </div>
  );
}
