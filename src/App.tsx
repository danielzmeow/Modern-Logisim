import { useEffect } from 'react';
import { useEditor, saveProjectToStorage } from './editor/store';
import { Topbar } from './ui/Topbar';
import { Sidebar } from './ui/Sidebar';
import { Canvas } from './ui/CanvasHost';
import { Inspector } from './ui/Inspector';
import { StatusBar } from './ui/StatusBar';
import { CommandPalette } from './ui/CommandPalette';
import { Shortcuts } from './ui/Shortcuts';
import { Welcome } from './ui/Welcome';
import { Toasts } from './ui/Toasts';
import { ContextMenu } from './ui/ContextMenu';
import { TruthTable } from './ui/TruthTable';
import { EquationDialog } from './ui/EquationDialog';
import { exportCircFile, openProject, saveProject } from './editor/fileActions';
import { PanelLeft, PanelRight } from 'lucide-react';
import { useT } from './ui/useT';
import { useResolvedAppearance } from './ui/useResolvedAppearance';

export default function App() {
  const doc = useEditor((s) => s.doc);
  const circuits = useEditor((s) => s.circuits);
  const circuitOrder = useEditor((s) => s.circuitOrder);
  const sidebar = useEditor((s) => s.sidebar);
  const inspector = useEditor((s) => s.inspector);
  const welcomeClosed = useEditor((s) => s.welcomeClosed);
  const setSidebar = useEditor((s) => s.setSidebar);
  const setInspector = useEditor((s) => s.setInspector);
  const markSaved = useEditor((s) => s.markSaved);
  const lang = useEditor((s) => s.lang);
  const { t } = useT();
  const resolvedTheme = useResolvedAppearance();

  const showWelcome = !welcomeClosed && doc.comps.length === 0 && doc.wires.length === 0;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.lang = lang;
    root.lang = lang === 'zh' ? 'zh-CN' : 'en';
    root.style.colorScheme = resolvedTheme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolvedTheme === 'dark' ? '#0b0c10' : '#eef0f4');
  }, [resolvedTheme, lang]);

  useEffect(() => {
    document.title = `${doc.name || t('doc.untitled')} — Logisim Studio`;
  }, [doc.name, t]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      saveProjectToStorage(useEditor.getState().snapshotProject());
      markSaved();
    }, 450);
    return () => window.clearTimeout(t);
  }, [doc, circuits, circuitOrder, markSaved]);

  useEffect(() => {
    const saveNow = () => saveProjectToStorage(useEditor.getState().snapshotProject());
    window.addEventListener('beforeunload', saveNow);
    return () => window.removeEventListener('beforeunload', saveNow);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable);
      const st = useEditor.getState();
      const meta = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape') {
        if (st.paletteOpen) {
          e.preventDefault();
          st.setPaletteOpen(false);
        } else if (st.shortcutsOpen) {
          e.preventDefault();
          st.setShortcutsOpen(false);
        }
        return;
      }
      if (meta) {
        const k = e.key.toLowerCase();
        if (k === 'k') {
          e.preventDefault();
          if (st.shortcutsOpen) st.setShortcutsOpen(false);
          st.setPaletteOpen(!st.paletteOpen);
          return;
        }
        if (k === 's') {
          e.preventDefault();
          saveProject();
          return;
        }
        if (k === 'o') {
          e.preventDefault();
          openProject();
          return;
        }
        if (k === 'e') {
          e.preventDefault();
          exportCircFile();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          st.toggleRunning();
          return;
        }
      }
      if (typing) return;
      if (e.key === '?') {
        e.preventDefault();
        st.setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[var(--app)] text-[var(--text)]">
      <Topbar />
      <div className="relative flex min-h-0 flex-1">
        {sidebar && <Sidebar />}
        <main className="relative min-w-0 flex-1">
          <Canvas />
          {showWelcome && <Welcome />}
          {!sidebar && !showWelcome && (
            <button
              className="absolute left-3 top-3 z-30 flex h-7 items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-raised)]/90 px-2.5 text-[11px] font-medium text-[var(--text-secondary)] shadow-[var(--shadow-card)] backdrop-blur transition-colors hover:bg-[var(--card)] hover:text-[var(--text)]"
              onClick={() => setSidebar(true)}
              title={t('aria.sidebar')}
            >
              <PanelLeft size={12} />
              {t('sidebar.title')}
            </button>
          )}
          {!inspector && !showWelcome && (
            <button
              className="absolute right-3 top-3 z-30 flex h-7 items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface-raised)]/90 px-2.5 text-[11px] font-medium text-[var(--text-secondary)] shadow-[var(--shadow-card)] backdrop-blur transition-colors hover:bg-[var(--card)] hover:text-[var(--text)]"
              onClick={() => setInspector(true)}
              title={t('aria.inspector')}
            >
              {t('inspector.title')}
              <PanelRight size={12} />
            </button>
          )}
        </main>
        {inspector && <Inspector />}
      </div>
      <StatusBar />
      <CommandPalette />
      <Shortcuts />
      <Toasts />
      <ContextMenu />
      <TruthTable />
      <EquationDialog />
    </div>
  );
}
