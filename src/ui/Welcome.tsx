import { useEffect, useRef } from 'react';
import { useEditor } from '../editor/store';
import { LogoMark, CompIcon } from './icons';
import { TEMPLATES, templateName, templateNote } from '../editor/templates';
import { loadTemplate, openProject } from '../editor/fileActions';
import { useT } from './useT';
import { useFocusTrap } from './useFocusTrap';
import { ArrowRight, ArrowUpRight, Command, FolderOpen, X } from 'lucide-react';

const TEMPLATE_ICONS = ['xor', 'or', 'mux', 'dff'] as const;

export function Welcome() {
  const setWelcomeClosed = useEditor((s) => s.setWelcomeClosed);
  const setPaletteOpen = useEditor((s) => s.setPaletteOpen);
  const lang = useEditor((s) => s.lang);
  const { t } = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWelcomeClosed(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setWelcomeClosed]);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center overflow-y-auto bg-[var(--scrim)] px-6 py-6">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Logisim Studio"
        className="welcome-panel w-[680px] max-w-full max-h-full overflow-y-auto p-7 outline-none scroll-thin"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <LogoMark size={30} />
            <div>
              <div className="text-[13px] font-semibold tracking-[-0.01em] text-[var(--text-strong)]">
                Logisim <span className="font-medium text-[var(--text-muted)]">Studio</span>
              </div>
              <div className="text-[11px] font-medium uppercase tracking-[0.15em] text-[var(--text-faint)]">
                {t('welcome.brandSub')}
              </div>
            </div>
          </div>
          <button
            className="icon-btn !h-7 !w-7"
            title={t('welcome.close')}
            aria-label={t('welcome.close')}
            onClick={() => setWelcomeClosed(true)}
          >
            <X size={14} />
          </button>
        </div>

        <h1 className="mt-7 max-w-[540px] text-[clamp(25px,2.5vw,31px)] font-semibold leading-[1.14] tracking-[-0.032em] text-[var(--text-strong)]">
          {t('welcome.title')}
        </h1>
        <p className="mt-2.5 max-w-[470px] text-[12px] leading-[1.7] text-[var(--text-secondary)]">
          {t('welcome.body')}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <button className="btn btn-primary h-9 px-4 text-[12px]" onClick={() => setWelcomeClosed(true)}>
            {t('welcome.startBlank')}
            <ArrowRight size={13.5} strokeWidth={2.2} />
          </button>
          <button className="btn btn-soft h-9 px-3.5 text-[12px]" onClick={openProject}>
            <FolderOpen size={13.5} />
            {t('welcome.open')}
          </button>
          <button
            className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            onClick={() => setPaletteOpen(true)}
          >
            <Command size={11} />
            {t('welcome.command')}
            <kbd className="kbd">⌘K</kbd>
          </button>
        </div>

        <div className="mt-7 border-t border-[var(--line)] pt-4">
          <div className="mb-2.5 flex items-baseline justify-between gap-4">
            <span className="panel-label">{t('welcome.templateTitle')}</span>
            <span className="text-right text-[12px] text-[var(--text-faint)]">{t('welcome.templateSub')}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(212px,1fr))] gap-0.5">
            {TEMPLATES.map((template, i) => (
              <button
                key={template.id}
                className="welcome-row"
                onClick={() => loadTemplate(template)}
                aria-label={`${templateName(template, lang)} — ${templateNote(template, lang)}`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[var(--line)] bg-[var(--field)] text-[var(--text-secondary)]">
                  <CompIcon kind={TEMPLATE_ICONS[i] ?? 'and'} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold text-[var(--text)]">
                    {templateName(template, lang)}
                  </span>
                  <span className="mt-0.5 block line-clamp-2 text-[11px] leading-[1.45] text-[var(--text-muted)]">
                    {templateNote(template, lang)}
                  </span>
                </span>
                <ArrowUpRight size={13} className="shrink-0 text-[var(--text-faint)]" />
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-[var(--text-faint)]">
          <span className="flex items-center gap-1.5">
            <kbd className="kbd !h-[17px] !text-[11px]">?</kbd>
            {t('welcome.footerShortcuts')}
          </span>
          <span>{t('welcome.footerDrag')}</span>
          <span className="ml-auto">{t('welcome.local')}</span>
        </div>
      </div>
    </div>
  );
}
