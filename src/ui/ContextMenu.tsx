import { useEffect } from 'react';
import { useEditor } from '../editor/store';
import { viewControls } from '../canvas/view';
import { sim } from '../model/sim';
import type { ComponentInstance } from '../model/types';
import { displayName } from '../model/specs';
import { itemCount } from '../i18n';
import { useT } from './useT';
import {
  CheckSquare,
  ClipboardPaste,
  Copy,
  Grid3x3,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Scan,
  Scissors,
  SlidersHorizontal,
  Table2,
  FunctionSquare,
  Network,
  Trash2,
  Undo2,
  Redo2,
  Zap,
  Command,
  Eye,
  ArrowUp,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

function Item({
  icon: Icon,
  label,
  shortcut,
  onClick,
  danger,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`context-item ${danger ? 'danger' : ''}`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon size={13.5} strokeWidth={1.9} />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="context-shortcut">{shortcut}</span>}
    </button>
  );
}

export function ContextMenu() {
  const menu = useEditor((s) => s.menu);
  const setMenu = useEditor((s) => s.setMenu);
  const selected = useEditor((s) => s.selComps);
  const doc = useEditor((s) => s.doc);
  const running = useEditor((s) => s.running);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const paletteOpen = useEditor((s) => s.paletteOpen);
  const shortcutsOpen = useEditor((s) => s.shortcutsOpen);
  const canWriteRuntime = useEditor(
    (s) => s.simRootId !== null && s.simPath !== null && s.simPath.length === 0,
  );
  const inInstanceView = useEditor((s) => s.simPath !== null && s.simPath.length > 0);
  const { lang, t } = useT();

  useEffect(() => {
    if (paletteOpen || shortcutsOpen) setMenu(null);
  }, [paletteOpen, shortcutsOpen, setMenu]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', onKey);
    const onBlur = () => setMenu(null);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [menu, setMenu]);

  if (!menu) return null;
  const close = () => setMenu(null);
  const st = () => useEditor.getState();
  const comps = doc.comps.filter((c) => selected.includes(c.id));
  const first: ComponentInstance | undefined = comps[0];
  const isInputPin = comps.length === 1 && first?.kind === 'input' && (first.attrs.bits ?? 1) === 1;
  const rotatable = comps.some((c) => c.kind !== 'text');
  const isRunning = running;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 208));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 280));
  const header =
    menu.target === 'comp'
      ? comps.length === 0
        ? t('menu.component')
        : comps.length === 1
          ? displayName(first!, lang)
          : itemCount(lang, comps.length, '个元件', 'component')
      : menu.target === 'wire'
        ? t('menu.wire')
        : t('menu.canvas');

  return (
    <>
      <div
        className="fixed inset-0 z-[50]"
        onPointerDown={close}
        onContextMenu={(e) => {
          e.preventDefault();
          close();
        }}
      />
      <div
        className="context-menu fixed z-[51] w-[196px] overflow-hidden rounded-xl p-1 shadow-[var(--shadow-float)]"
        style={{ left, top, animation: 'pop-in 110ms cubic-bezier(0.2,0.9,0.3,1)' }}
        role="menu"
        aria-label={header}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
          {header}
        </div>
        {menu.target === 'comp' && (
          <>
            {isInputPin && (
              <Item
                icon={Zap}
                label={t('menu.toggleLevel')}
                shortcut="↵"
                disabled={!canWriteRuntime}
                onClick={() => {
                  if (first) sim.togglePin(first);
                  setMenu(null);
                  viewControls.invalidate();
                }}
              />
            )}
            {comps.length === 1 && first?.kind === 'sub' && !!first.attrs.circuit && (
              <Item
                icon={Eye}
                label={t('menu.viewInstance')}
                onClick={() => {
                  st().enterInstance(first.id);
                  close();
                  viewControls.invalidate();
                }}
              />
            )}
            {(first?.kind === 'output' || first?.kind === 'led' || first?.kind === 'probe') && (
              <Item
                icon={Table2}
                label={t('menu.truthTable')}
                onClick={() => {
                  st().setTruthOpen(true, first!.id);
                  close();
                }}
              />
            )}
            <Item
              icon={SlidersHorizontal}
              label={t('menu.editInspector')}
              onClick={() => {
                st().setInspector(true);
                close();
              }}
            />
            {rotatable && (
              <>
                <Item
                  icon={RotateCw}
                  label={t('menu.rotateCW')}
                  shortcut="R"
                  onClick={() => {
                    st().rotateSelection(1);
                    close();
                    viewControls.invalidate();
                  }}
                />
                <Item
                  icon={RotateCcw}
                  label={t('menu.rotateCCW')}
                  onClick={() => {
                    st().rotateSelection(-1);
                    close();
                    viewControls.invalidate();
                  }}
                />
              </>
            )}
            <Item
              icon={Scissors}
              label={t('menu.cut')}
              shortcut="⌘X"
              onClick={() => {
                st().cutSelection();
                close();
                viewControls.invalidate();
              }}
            />
            <Item
              icon={Copy}
              label={t('menu.copy')}
              shortcut="⌘C"
              onClick={() => {
                st().copySelection();
                close();
              }}
            />
            <Item
              icon={Copy}
              label={t('common.duplicate')}
              shortcut="⌘D"
              onClick={() => {
                st().duplicateSelection();
                close();
                viewControls.invalidate();
              }}
            />
            <div className="my-1 h-px bg-[var(--line)]" />
            <Item
              icon={Trash2}
              label={t('menu.deleteSelection')}
              shortcut="⌫"
              danger
              onClick={() => {
                st().deleteSelection();
                close();
                viewControls.invalidate();
              }}
            />
          </>
        )}
        {menu.target === 'wire' && (
          <>
            <Item
              icon={Trash2}
              label={t('menu.deleteSegment')}
              shortcut="⌫"
              danger
              onClick={() => {
                st().deleteSelection();
                close();
                viewControls.invalidate();
              }}
            />
            <Item
              icon={Network}
              label={t('menu.selectNet')}
              onClick={() => {
                if (menu.wireId) st().selectWireNet(menu.wireId);
                close();
                viewControls.invalidate();
              }}
            />
            <Item
              icon={Trash2}
              label={t('menu.deleteNet')}
              danger
              onClick={() => {
                const state = st();
                if (menu.wireId) state.selectWireNet(menu.wireId);
                state.deleteSelection();
                close();
                viewControls.invalidate();
              }}
            />
            <div className="my-1 h-px bg-[var(--line)]" />
            <Item
              icon={Scissors}
              label={t('menu.splitWire')}
              disabled={!menu.wireId || !menu.world}
              onClick={() => {
                if (menu.wireId && menu.world) st().splitWire(menu.wireId, menu.world);
                close();
                viewControls.invalidate();
              }}
            />
            <Item
              icon={Scan}
              label={t('menu.fit')}
              shortcut="⌘0"
              onClick={() => {
                close();
                viewControls.fit();
              }}
            />
          </>
        )}
        {menu.target === 'canvas' && (
          <>
            {inInstanceView && (
              <Item
                icon={ArrowUp}
                label={t('menu.exitInstance')}
                onClick={() => {
                  st().exitInstance();
                  close();
                  viewControls.invalidate();
                }}
              />
            )}
            <Item
              icon={Undo2}
              label={t('menu.undo')}
              shortcut="⌘Z"
              disabled={!past}
              onClick={() => {
                st().undo();
                close();
                viewControls.invalidate();
              }}
            />
            <Item
              icon={Redo2}
              label={t('menu.redo')}
              shortcut="⇧⌘Z"
              disabled={!future}
              onClick={() => {
                st().redo();
                close();
                viewControls.invalidate();
              }}
            />
            <Item
              icon={CheckSquare}
              label={t('menu.selectAll')}
              shortcut="⌘A"
              onClick={() => {
                st().selectAll();
                close();
                viewControls.invalidate();
              }}
            />
            <Item
              icon={ClipboardPaste}
              label={t('menu.paste')}
              shortcut="⌘V"
              onClick={() => {
                st().pasteClipboard();
                close();
                viewControls.invalidate();
              }}
            />
            <div className="my-1 h-px bg-[var(--line)]" />
            <Item
              icon={isRunning ? Pause : Play}
              label={isRunning ? t('menu.pause') : t('menu.run')}
              shortcut="⌘↵"
              onClick={() => {
                st().toggleRunning();
                close();
              }}
            />
            <Item
              icon={RotateCcw}
              label={t('menu.reset')}
              onClick={() => {
                sim.reset();
                close();
                viewControls.invalidate();
              }}
            />
            <div className="my-1 h-px bg-[var(--line)]" />
            <Item
              icon={Scan}
              label={t('menu.fit')}
              shortcut="⌘0"
              onClick={() => {
                close();
                viewControls.fit();
              }}
            />
            <Item
              icon={Grid3x3}
              label={st().showGrid ? t('menu.hideGrid') : t('menu.showGrid')}
              shortcut="G"
              onClick={() => {
                st().setShowGrid(!st().showGrid);
                close();
                viewControls.invalidate();
              }}
            />
            <div className="my-1 h-px bg-[var(--line)]" />
            <Item
              icon={Table2}
              label={t('menu.truthTable')}
              onClick={() => {
                st().setTruthOpen(true);
                close();
              }}
            />
            <Item
              icon={FunctionSquare}
              label={t('menu.fromEquation')}
              onClick={() => {
                st().setEquationOpen(true);
                close();
              }}
            />
            <Item
              icon={Command}
              label={t('menu.palette')}
              shortcut="⌘K"
              onClick={() => {
                st().setPaletteOpen(true);
                close();
              }}
            />
          </>
        )}
      </div>
    </>
  );
}
