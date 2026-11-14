import { useEditor } from '../editor/store';
import { useT } from './useT';
import { useFocusTrap } from './useFocusTrap';
import { useRef } from 'react';
import { Keyboard, X } from 'lucide-react';
import type { ReactNode } from 'react';

function K({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

function Row({ label, keys }: { label: string; keys: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-[7px] last:border-0">
      <span className="text-[12px] text-[var(--text-secondary)]">{label}</span>
      <span className="flex shrink-0 items-center gap-1">{keys}</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-faint)]">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

export function Shortcuts() {
  const open = useEditor((s) => s.shortcutsOpen);
  const setOpen = useEditor((s) => s.setShortcutsOpen);
  const { t } = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);
  if (!open) return null;

  return (
    <div
      className="modal-backdrop flex items-start justify-center overflow-y-auto px-6 py-[9vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpen(false);
      }}
    >
      <div ref={panelRef} className="modal-panel w-full max-w-[660px] overflow-hidden" role="dialog" aria-modal="true" aria-label={t('shortcuts.title')}>
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-md border border-[var(--line)] bg-[var(--field)] text-[var(--text-secondary)]">
              <Keyboard size={14} />
            </span>
            <div>
              <div className="text-[13px] font-semibold text-[var(--text-strong)]">{t('shortcuts.title')}</div>
              <div className="text-[11px] text-[var(--text-muted)]">{t('shortcuts.subtitle')}</div>
            </div>
          </div>
          <button
            autoFocus
            className="icon-btn !h-7 !w-7"
            onClick={() => setOpen(false)}
            title={t('shortcuts.close')}
            aria-label={t('common.close')}
          >
            <X size={14} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-5 px-5 py-4">
          <Group title={t('shortcuts.group.tool')}>
            <Row label={t('shortcuts.select')} keys={<K>V</K>} />
            <Row label={t('shortcuts.wire')} keys={<K>W</K>} />
            <Row label={t('shortcuts.pan')} keys={<K>H</K>} />
            <Row label={t('shortcuts.escape')} keys={<K>Esc</K>} />
            <Row label={t('shortcuts.rotate')} keys={<><K>R</K><K>⇧R</K></>} />
            <Row label={t('shortcuts.togglePin')} keys={<K>Enter</K>} />
          </Group>
          <Group title={t('shortcuts.group.canvas')}>
            <Row
              label={t('shortcuts.panCanvas')}
              keys={<><K>Space</K><span className="text-[11px] text-[var(--text-faint)]">{t('shortcuts.spaceDrag')}</span></>}
            />
            <Row
              label={t('shortcuts.zoom')}
              keys={<><K>⌘</K><span className="text-[11px] text-[var(--text-faint)]">{t('shortcuts.modScroll')}</span></>}
            />
            <Row label={t('shortcuts.scrollPan')} keys={<span className="text-[11px] text-[var(--text-faint)]">{t('shortcuts.twoFinger')}</span>} />
            <Row label={t('shortcuts.zoomInOut')} keys={<><K>⌘+</K><K>⌘−</K></>} />
            <Row label={t('shortcuts.fit')} keys={<><K>⌘0</K><K>0</K></>} />
            <Row label={t('shortcuts.grid')} keys={<K>G</K>} />
          </Group>
          <Group title={t('shortcuts.group.edit')}>
            <Row label={t('shortcuts.undoRedo')} keys={<><K>⌘Z</K><K>⇧⌘Z</K></>} />
            <Row label={t('shortcuts.duplicate')} keys={<K>⌘D</K>} />
            <Row label={t('shortcuts.selectAll')} keys={<K>⌘A</K>} />
            <Row label={t('shortcuts.delete')} keys={<K>⌫</K>} />
            <Row label={t('shortcuts.nudge')} keys={<><K>↑↓←→</K><K>⇧↑↓←→</K></>} />
            <Row
              label={t('shortcuts.addSelect')}
              keys={<><K>⇧</K><span className="text-[11px] text-[var(--text-faint)]">{t('shortcuts.click')}</span></>}
            />
          </Group>
          <Group title={t('shortcuts.group.file')}>
            <Row label={t('shortcuts.palette')} keys={<K>⌘K</K>} />
            <Row label={t('shortcuts.save')} keys={<K>⌘S</K>} />
            <Row label={t('shortcuts.open')} keys={<K>⌘O</K>} />
            <Row label={t('shortcuts.export')} keys={<K>⌘E</K>} />
            <Row label={t('shortcuts.run')} keys={<K>⌘↩</K>} />
            <Row label={t('shortcuts.panel')} keys={<K>?</K>} />
          </Group>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[var(--line)] px-5 py-3 text-[12px] text-[var(--text-faint)]">
          <span>{t('shortcuts.footWire')}</span>
          <span>{t('shortcuts.footPin')}</span>
          <span>{t('shortcuts.footT')}</span>
          <span className="ml-auto text-[var(--text-muted)]">{t('shortcuts.escClose')}</span>
        </div>
      </div>
    </div>
  );
}
