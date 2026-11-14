import { useState } from 'react';
import { useEditor } from '../editor/store';
import { viewControls } from '../canvas/view';
import { KIND_NAMES, KIND_NAMES_EN } from '../model/types';
import { itemCount } from '../i18n';
import { useT } from './useT';
import { useResolvedAppearance } from './useResolvedAppearance';
import { Preferences } from './Preferences';
import {
  Globe,
  Grid3x3,
  Keyboard,
  Maximize2,
  Minus,
  Moon,
  PanelLeft,
  PanelRight,
  Plus,
  Sun,
} from 'lucide-react';

export function StatusBar() {
  const tool = useEditor((s) => s.tool);
  const pending = useEditor((s) => s.pendingKind);
  const running = useEditor((s) => s.running);
  const selectedCompIds = useEditor((s) => s.selComps);
  const selComps = selectedCompIds.length;
  const selWires = useEditor((s) => s.selWires.length);
  const zoom = useEditor((s) => s.zoom);
  const doc = useEditor((s) => s.doc);
  const cursor = useEditor((s) => s.cursorWorld);
  const showGrid = useEditor((s) => s.showGrid);
  const sidebar = useEditor((s) => s.sidebar);
  const inspector = useEditor((s) => s.inspector);
  const lang = useEditor((s) => s.lang);
  const setLang = useEditor((s) => s.setLang);
  const setShowGrid = useEditor((s) => s.setShowGrid);
  const setSidebar = useEditor((s) => s.setSidebar);
  const setInspector = useEditor((s) => s.setInspector);
  const setShortcuts = useEditor((s) => s.setShortcutsOpen);
  const resolved = useResolvedAppearance();
  const { t } = useT();
  const [prefsOpen, setPrefsOpen] = useState(false);

  const parts = itemCount(lang, selComps, '个元件', 'component');
  const wires = itemCount(lang, selWires, '条导线', 'wire');
  const onlyText =
    selComps > 0 &&
    selWires === 0 &&
    doc.comps.filter((c) => selectedCompIds.includes(c.id)).every((c) => c.kind === 'text');
  let hint: string;
  if (pending) {
    const name = lang === 'zh' ? KIND_NAMES[pending] : KIND_NAMES_EN[pending];
    hint = t('status.place', { name });
  } else if (tool === 'wire') {
    hint = t('status.wire');
  } else if (tool === 'pan') {
    hint = t('status.pan');
  } else if (selComps && selWires) {
    hint = t('status.selectionBoth', { comps: parts, wires });
  } else if (onlyText) {
    hint = t('status.selectionText');
  } else if (selComps) {
    hint = t('status.selectionComp', { comps: parts });
  } else if (selWires) {
    hint = t('status.selectionWire', { wires });
  } else {
    hint = t('status.idle');
  }

  const coords = cursor ? t('status.coords', { x: cursor.x, y: cursor.y }) : t('status.noCoords');
  const ThemeIcon = resolved === 'dark' ? Moon : Sun;

  return (
    <footer className="statusbar relative z-30 flex h-[29px] shrink-0 items-center gap-3 px-3 text-[11px] text-[var(--text-muted)]">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`sim-dot ${running ? 'on' : ''}`} />
        <span className={running ? 'shrink-0 text-[var(--success-text)]' : 'shrink-0 text-[var(--text-secondary)]'}>
          {running ? t('status.simRunning') : t('status.simPaused')}
        </span>
        <span className="shrink-0 text-[var(--line-strong)]">/</span>
        <span className="truncate">{hint}</span>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <span className="mr-2 hidden font-mono text-[11px] tabular-nums text-[var(--text-faint)] sm:inline">
          {coords}
        </span>

        <button className="icon-btn !h-6 !w-6" title={t('status.zoomOut')} onClick={() => viewControls.zoomOut()}>
          <Minus size={11.5} />
        </button>
        <button
          className="h-6 min-w-[44px] rounded-md px-1 font-mono text-[11px] tabular-nums text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]"
          title={t('status.fit')}
          onClick={() => viewControls.fit()}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button className="icon-btn !h-6 !w-6" title={t('status.zoomIn')} onClick={() => viewControls.zoomIn()}>
          <Plus size={11.5} />
        </button>
        <button className="icon-btn !h-6 !w-6" title={t('status.fit')} onClick={() => viewControls.fit()}>
          <Maximize2 size={11.5} />
        </button>

        <div className="divider-v !h-3.5" />

        <button
          className={`icon-btn !h-6 !w-6 ${showGrid ? '!text-[var(--text-secondary)]' : '!text-[var(--text-faint)]'}`}
          title={t('status.grid')}
          aria-pressed={showGrid}
          onClick={() => setShowGrid(!showGrid)}
        >
          <Grid3x3 size={12} />
        </button>

        <button
          className="icon-btn !h-6 !w-6"
          title={t('status.appearance')}
          aria-haspopup="dialog"
          aria-expanded={prefsOpen}
          onClick={() => setPrefsOpen((v) => !v)}
        >
          <ThemeIcon size={12} />
        </button>

        <button
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold tracking-[0.02em] text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]"
          title={`${t('status.language')} · ${lang === 'zh' ? 'English' : '中文'}`}
          aria-label={t('status.language')}
          onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
        >
          <Globe size={11} strokeWidth={1.8} />
          {lang === 'zh' ? '中' : 'EN'}
        </button>

        <div className="divider-v !h-3.5" />

        <button
          className={`icon-btn !h-6 !w-6 ${sidebar ? '!text-[var(--text-secondary)]' : '!text-[var(--text-faint)]'}`}
          title={t('status.sidebar')}
          aria-pressed={sidebar}
          onClick={() => setSidebar(!sidebar)}
        >
          <PanelLeft size={12} />
        </button>
        <button
          className={`icon-btn !h-6 !w-6 ${inspector ? '!text-[var(--text-secondary)]' : '!text-[var(--text-faint)]'}`}
          title={t('status.inspector')}
          aria-pressed={inspector}
          onClick={() => setInspector(!inspector)}
        >
          <PanelRight size={12} />
        </button>
        <button className="icon-btn !h-6 !w-6" title={t('status.shortcuts')} onClick={() => setShortcuts(true)}>
          <Keyboard size={12.5} />
        </button>
      </div>

      {prefsOpen && <Preferences onClose={() => setPrefsOpen(false)} />}
    </footer>
  );
}
