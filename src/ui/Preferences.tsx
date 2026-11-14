import { useEffect, useRef } from 'react';
import { useEditor } from '../editor/store';
import { useT } from './useT';
import { useResolvedAppearance } from './useResolvedAppearance';
import { PALETTES } from '../canvas/theme';
import type { Appearance } from '../model/types';
import type { Lang } from '../i18n';
import { Check, Monitor, Moon, Sun, X } from 'lucide-react';

export function Preferences({ onClose }: { onClose: () => void }) {
  const appearance = useEditor((s) => s.appearance);
  const setAppearance = useEditor((s) => s.setAppearance);
  const canvasTheme = useEditor((s) => s.canvasTheme);
  const setCanvasTheme = useEditor((s) => s.setCanvasTheme);
  const lang = useEditor((s) => s.lang);
  const setLang = useEditor((s) => s.setLang);
  const paletteOpen = useEditor((s) => s.paletteOpen);
  const shortcutsOpen = useEditor((s) => s.shortcutsOpen);
  const resolved = useResolvedAppearance();
  const panelRef = useRef<HTMLDivElement>(null);
  const { t } = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (paletteOpen || shortcutsOpen) onClose();
  }, [paletteOpen, shortcutsOpen, onClose]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const appearanceOptions: { value: Appearance; label: string; icon: typeof Sun }[] = [
    { value: 'system', label: t('prefs.system'), icon: Monitor },
    { value: 'light', label: t('prefs.light'), icon: Sun },
    { value: 'dark', label: t('prefs.dark'), icon: Moon },
  ];

  const langs: { value: Lang; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'zh', label: '中文' },
  ];

  return (
    <>
      <div
        className="fixed inset-0 z-[52]"
        onPointerDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label={t('prefs.title')}
        className="prefs-panel fixed bottom-[38px] right-3 z-[53] w-[286px] overflow-hidden rounded-xl outline-none"
        style={{ animation: 'pop-in 130ms cubic-bezier(0.2,0.9,0.3,1)' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-3.5 py-2.5">
          <span className="text-[11.5px] font-semibold tracking-[-0.005em] text-[var(--text-strong)]">
            {t('prefs.title')}
          </span>
          <button className="icon-btn !h-6 !w-6" title={t('prefs.close')} onClick={onClose}>
            <X size={12.5} />
          </button>
        </div>

        <div className="space-y-3 px-3.5 pb-3 pt-3">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="panel-label">{t('prefs.appearance')}</span>
              {appearance === 'system' && (
                <span className="text-[11px] text-[var(--text-faint)]">
                  {t(resolved === 'dark' ? 'prefs.dark' : 'prefs.light')}
                </span>
              )}
            </div>
            <div className="seg w-full">
              {appearanceOptions.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  className={`flex flex-1 items-center justify-center gap-1.5 ${appearance === value ? 'active accent' : ''}`}
                  onClick={() => setAppearance(value)}
                  aria-pressed={appearance === value}
                >
                  <Icon size={11.5} strokeWidth={1.9} />
                  <span className="text-[11px]">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="panel-label mb-1.5">{t('prefs.canvas')}</div>
            <div className="grid grid-cols-2 gap-1.5">
              {(['paper', 'graphite'] as const).map((theme) => {
                const p = PALETTES[theme];
                const active = canvasTheme === theme;
                return (
                  <button
                    key={theme}
                    className={`canvas-choice ${active ? 'active' : ''}`}
                    onClick={() => setCanvasTheme(theme)}
                    aria-pressed={active}
                    title={`${t(theme === 'paper' ? 'prefs.paper' : 'prefs.graphite')} — ${t(
                      theme === 'paper' ? 'prefs.paperHint' : 'prefs.graphiteHint',
                    )}`}
                  >
                    <span
                      className="canvas-preview"
                      style={{
                        background: p.bg,
                        ['--swatch-dot' as string]: p.gridMajor,
                        ['--swatch-line' as string]: p.chipStroke,
                      }}
                    >
                      <span className="canvas-preview-wire" />
                    </span>
                    <span className="min-w-0 flex-1 text-left text-[12px] font-medium text-[var(--text)]">
                      {t(theme === 'paper' ? 'prefs.paper' : 'prefs.graphite')}
                    </span>
                    {active && <Check size={12} className="shrink-0 text-[var(--accent-text)]" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="panel-label mb-1.5">{t('prefs.language')}</div>
            <div className="seg w-full">
              {langs.map((l) => (
                <button
                  key={l.value}
                  className={`flex-1 text-center ${lang === l.value ? 'active accent' : ''}`}
                  onClick={() => setLang(l.value)}
                  aria-pressed={lang === l.value}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--line)] px-3.5 py-2 text-[12px] text-[var(--text-faint)]">
          <span>{t('prefs.footer')}</span>
          <kbd className="kbd !h-[17px] !text-[11px]">⌘K</kbd>
        </div>
      </div>
    </>
  );
}
