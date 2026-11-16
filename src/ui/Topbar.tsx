import { useEditor } from '../editor/store';
import { LogoMark } from './icons';
import { exportCircFile, newCircuit, openProject, saveProject } from '../editor/fileActions';
import { sim } from '../model/sim';
import { viewControls } from '../canvas/view';
import { useT } from './useT';
import {
  Download,
  FilePlus2,
  FolderOpen,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Save,
  Search,
  StepForward,
  Undo2,
} from 'lucide-react';

export function Topbar() {
  const name = useEditor((s) => s.doc.name);
  const setName = useEditor((s) => s.setName);
  const running = useEditor((s) => s.running);
  const toggleRunning = useEditor((s) => s.toggleRunning);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const saveError = useEditor((s) => s.saveError);
  const savePending = useEditor((s) => s.savePending);
  const autosaveBlocked = useEditor((s) => s.autosaveBlocked);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const setPaletteOpen = useEditor((s) => s.setPaletteOpen);
  const { t } = useT();

  const resetSim = () => {
    sim.reset();
    viewControls.invalidate();
  };

  return (
    <header className="topbar relative z-30 flex h-[52px] shrink-0 items-center gap-2 px-3">
      <div className="flex w-[232px] shrink-0 items-center gap-2.5 pl-1">
        <LogoMark size={27} />
        <div className="flex items-baseline gap-1.5">
          <span className="text-[13.5px] font-semibold tracking-[-0.015em] text-[var(--text-strong)]">
            Logisim
          </span>
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Studio
          </span>
        </div>
      </div>

      <div className="divider-v" />

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <input
          className="doc-input w-[220px] min-w-0 max-w-[280px]"
          value={name}
          spellCheck={false}
          aria-label={t('doc.titleAria')}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
        />
        <div className="hidden items-center gap-1.5 pl-1 text-[11px] font-medium text-[var(--text-secondary)] lg:flex">
          <span
            className={`h-[5px] w-[5px] rounded-full ${
              saveError || autosaveBlocked ? 'bg-[var(--danger)]' : 'bg-[var(--success)]'
            }`}
          />
          <span className={saveError || autosaveBlocked ? 'text-[var(--danger-text)]' : ''}>
            {saveError
              ? t('save.failed')
              : autosaveBlocked
                ? t('save.paused')
                : savePending
                  ? t('doc.saving')
                  : t('doc.autosave')}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <button className="icon-btn" title={t('topbar.undo')} disabled={!past} onClick={undo}>
          <Undo2 size={16} strokeWidth={1.9} />
        </button>
        <button className="icon-btn" title={t('topbar.redo')} disabled={!future} onClick={redo}>
          <Redo2 size={16} strokeWidth={1.9} />
        </button>

        <div className="divider-v" />

        <button
          className={`btn btn-run ${running ? 'running' : ''}`}
          title={t('topbar.run')}
          onClick={toggleRunning}
        >
          {running ? <Pause size={13} strokeWidth={2.2} /> : <Play size={13} strokeWidth={2.2} />}
          {running ? t('common.pause') : t('common.run')}
        </button>
        <button className="icon-btn" title={t('topbar.reset')} onClick={resetSim}>
          <RotateCcw size={15} strokeWidth={1.9} />
        </button>
        <button
          className="icon-btn"
          title={t('topbar.step')}
          onClick={() => {
            sim.step();
            viewControls.invalidate();
          }}
        >
          <StepForward size={15} strokeWidth={1.9} />
        </button>

        <div className="divider-v hidden md:block" />

        <button className="icon-btn hidden md:inline-flex" title={t('topbar.new')} onClick={newCircuit}>
          <FilePlus2 size={15.5} strokeWidth={1.8} />
        </button>
        <button className="icon-btn hidden md:inline-flex" title={t('topbar.open')} onClick={openProject}>
          <FolderOpen size={15.5} strokeWidth={1.8} />
        </button>
        <button className="icon-btn hidden md:inline-flex" title={t('topbar.save')} onClick={saveProject}>
          <Save size={15.5} strokeWidth={1.8} />
        </button>
        <button className="icon-btn hidden md:inline-flex" title={t('topbar.export')} onClick={exportCircFile}>
          <Download size={15.5} strokeWidth={1.8} />
        </button>

        <button
          className="search-pill ml-2"
          onClick={() => setPaletteOpen(true)}
          title={`${t('topbar.search')} ⌘K`}
        >
          <Search size={13} strokeWidth={2} />
          <span className="hidden xl:inline">{t('topbar.search')}</span>
          <span className="xl:hidden">{t('topbar.command')}</span>
          <kbd className="kbd ml-0.5">⌘K</kbd>
        </button>
      </div>
    </header>
  );
}
