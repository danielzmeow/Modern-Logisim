import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../editor/store';
import { useT } from './useT';
import { useFocusTrap } from './useFocusTrap';
import { synthesizeEquations, EquationError } from '../analysis/equations';
import { viewControls } from '../canvas/view';
import { Sparkles, X, Wand2 } from 'lucide-react';

export function EquationDialog() {
  const open = useEditor((s) => s.equationOpen);
  const setOpen = useEditor((s) => s.setEquationOpen);
  const lang = useEditor((s) => s.lang);
  const circuits = useEditor((s) => s.circuits);
  const { t } = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('Y = A & B\nCout = (A & B) | (Cin & (A ^ B))');
  const [error, setError] = useState('');
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (open) setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  const names = useMemo(() => new Set(Object.values(circuits).map((d) => d.name)), [circuits]);

  if (!open) return null;

  const uniqueName = (base: string) => {
    let name = base || t('equations.newCircuit');
    let n = 2;
    while (names.has(name)) name = `${base || t('equations.newCircuit')} ${n++}`;
    return name;
  };

  const generate = () => {
    setError('');
    try {
      const result = synthesizeEquations(text, lang);
      const base = result.outputs.length === 1 ? result.outputs[0] : t('equations.newCircuit');
      const name = uniqueName(base);
      result.doc.name = name;
      const st = useEditor.getState();
      const id = st.createCircuit(name, result.doc);
      st.switchCircuit(id);
      setOpen(false);
      setTimeout(() => {
        st.toastMsg(t('equations.generated', { name }), 'success');
        viewControls.fit();
      }, 30);
    } catch (err) {
      console.error(err);
      setError(err instanceof EquationError ? err.message : err instanceof Error ? err.message : t('equations.error'));
    }
  };

  return (
    <div
      className="modal-backdrop flex items-start justify-center overflow-y-auto px-6 py-[7vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={panelRef}
        className="modal-panel flex w-full max-w-[700px] flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label={t('equations.title')}
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-md border border-[var(--line)] bg-[var(--field)] text-[var(--text-secondary)]">
              <Wand2 size={14} />
            </span>
            <div>
              <div className="text-[13px] font-semibold text-[var(--text-strong)]">{t('equations.title')}</div>
              <div className="text-[11px] text-[var(--text-muted)]">{t('equations.subtitle')}</div>
            </div>
          </div>
          <button
            autoFocus
            className="icon-btn !h-7 !w-7"
            onClick={() => setOpen(false)}
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              {t('equations.subtitle')}
            </span>
            <button
              className="btn btn-soft !h-6 !px-2 !text-[11px]"
              onClick={() => setText('Y = (A | B) & !C')}
            >
              <Sparkles size={11} /> {t('equations.example')}
            </button>
          </div>
          <textarea
            className="field h-[168px] resize-none py-2 font-mono text-[12px] leading-[1.65]"
            value={text}
            spellCheck={false}
            placeholder={t('equations.placeholder')}
            onChange={(e) => {
              setText(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                generate();
              }
            }}
          />
          <div className="mt-2 whitespace-pre-wrap text-[11.5px] leading-[1.6] text-[var(--text-muted)]">
            {t('equations.help')}
          </div>
          {error && (
            <div className="mt-2 rounded-md border border-[var(--danger-line)] bg-[var(--danger-soft)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--danger-text)]">
              {t('equations.error')}: {error}
            </div>
          )}
          <div className="mt-2 text-[11px] text-[var(--text-faint)]">{t('equations.hint')}</div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-3">
          <button className="btn btn-soft" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-run" onClick={generate} disabled={!text.trim()}>
            <Wand2 size={12.5} /> {t('equations.generate')}
          </button>
        </div>
      </div>
    </div>
  );
}
