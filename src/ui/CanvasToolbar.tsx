import { Cable, CircuitBoard, Hand, MousePointer2, X } from 'lucide-react';
import { useEditor } from '../editor/store';
import { SPEC_BY_KIND, specName } from '../model/specs';
import type { Tool } from '../model/types';
import { useT } from './useT';
import { CompIcon } from './icons';

const TOOLS = [
  { id: 'select', label: 'canvas.select', key: 'V', Icon: MousePointer2 },
  { id: 'wire', label: 'canvas.wire', key: 'W', Icon: Cable },
  { id: 'pan', label: 'canvas.hand', key: 'H', Icon: Hand },
] as const satisfies ReadonlyArray<{
  id: Tool;
  label: 'canvas.select' | 'canvas.wire' | 'canvas.hand';
  key: string;
  Icon: typeof MousePointer2;
}>;

export function CanvasToolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const setPendingKind = useEditor((s) => s.setPendingKind);
  const pendingKind = useEditor((s) => s.pendingKind);
  const lang = useEditor((s) => s.lang);
  const { t } = useT();
  const pending = pendingKind ? SPEC_BY_KIND[pendingKind] : null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-full items-center gap-1 overflow-hidden rounded-xl border border-[var(--line-strong)] bg-[var(--surface-raised)]/95 p-1 shadow-[var(--shadow-float)] backdrop-blur-md">
        {pending && pendingKind && (
          <>
            <div className="flex min-w-0 items-center gap-2 pl-1.5 pr-1">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--accent-soft)] text-[var(--accent-text)]">
                <CompIcon kind={pendingKind} size={15} />
              </span>
              <span className="hidden shrink-0 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)] sm:inline">
                {t('canvas.placing')}
              </span>
              <span className="max-w-[128px] truncate text-[11.5px] font-semibold text-[var(--text-strong)]">
                {specName(pendingKind, lang)}
              </span>
              <span className="hidden shrink-0 text-[10.5px] text-[var(--text-faint)] lg:inline">
                {t('canvas.rotateHint')} · {t('canvas.cancelHint')}
              </span>
              <button
                className="icon-btn !h-5 !w-5 shrink-0"
                title={t('common.cancel')}
                aria-label={t('common.cancel')}
                onClick={() => setPendingKind(null)}
              >
                <X size={11} />
              </button>
            </div>
            <div className="mx-0.5 h-5 w-px shrink-0 bg-[var(--line)]" />
          </>
        )}

        <div role="toolbar" aria-label={t('canvas.tools')} className="flex items-center gap-0.5">
          {TOOLS.map(({ id, label, key, Icon }) => {
            const active = tool === id && !pending;
            return (
              <button
                key={id}
                className={`flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11.5px] font-medium transition-colors ${
                  active
                    ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--hover)] hover:text-[var(--text-strong)]'
                }`}
                aria-pressed={active}
                aria-keyshortcuts={key}
                title={`${t(label)} · ${key}`}
                onClick={() => {
                  setPendingKind(null);
                  setTool(id);
                }}
              >
                <Icon size={13.5} strokeWidth={1.9} />
                <span className="hidden sm:inline">{t(label)}</span>
                <kbd
                  className={`hidden h-[16px] min-w-[15px] items-center justify-center rounded border px-1 font-mono text-[9.5px] leading-none md:inline-flex ${
                    active
                      ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
                      : 'border-[var(--kbd-border)] bg-[var(--kbd-bg)] text-[var(--text-faint)]'
                  }`}
                >
                  {key}
                </kbd>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function CanvasEmptyHint({ empty }: { empty: boolean }) {
  const { t } = useT();
  if (!empty) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-8 pb-16">
      <div className="max-w-[300px] rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)]/92 px-6 py-5 text-center shadow-[var(--shadow-float)] backdrop-blur-md">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl border border-[var(--line)] bg-[var(--card)] text-[var(--text-muted)] shadow-[var(--shadow-card)]">
          <CircuitBoard size={20} strokeWidth={1.6} />
        </div>
        <div className="mt-3 text-[13px] font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
          {t('canvas.emptyTitle')}
        </div>
        <div className="mt-1 text-[11.5px] leading-[1.6] text-[var(--text-muted)]">
          {t('canvas.emptyHint')}
        </div>
      </div>
    </div>
  );
}
