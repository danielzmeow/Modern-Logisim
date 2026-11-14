import { useMemo, useRef, useState } from 'react';
import { useEditor } from '../editor/store';
import { CATEGORIES, SPECS, specDesc, specName, type Spec } from '../model/specs';
import { CompIcon } from './icons';
import { ChevronsLeft, Search, X } from 'lucide-react';
import { useT } from './useT';

function matches(spec: Spec, q: string): boolean {
  if (!q) return true;
  const hay = [spec.name, spec.nameEn, spec.desc, spec.descEn, ...spec.keywords].join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => hay.includes(part));
}

export function Sidebar() {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingKind = useEditor((s) => s.pendingKind);
  const setPendingKind = useEditor((s) => s.setPendingKind);
  const setSidebar = useEditor((s) => s.setSidebar);
  const { lang, t } = useT();

  const groups = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      ...cat,
      specs: SPECS.filter((s) => s.category === cat.id && matches(s, query)),
    })).filter((g) => g.specs.length);
  }, [query]);

  const total = groups.reduce((n, g) => n + g.specs.length, 0);

  return (
    <aside className="side-panel relative z-20 flex w-[232px] shrink-0 flex-col border-r border-[var(--line)]">
      <div className="flex h-[42px] shrink-0 items-center justify-between px-3.5 pt-1">
        <div className="panel-label">{t('sidebar.title')}</div>
        <button className="icon-btn !h-6 !w-6" title={t('sidebar.collapse')} onClick={() => setSidebar(false)}>
          <ChevronsLeft size={13.5} strokeWidth={2} />
        </button>
      </div>

      <div className="shrink-0 px-3 pb-2">
        <div className="sidebar-search">
          <Search size={12.5} strokeWidth={2} className="shrink-0 text-[var(--text-faint)]" />
          <input
            ref={inputRef}
            value={query}
            placeholder={t('sidebar.search')}
            aria-label={t('aria.searchComponents')}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                inputRef.current?.blur();
              }
            }}
          />
          {query ? (
            <button
              className="grid h-4 w-4 place-items-center rounded text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
              onClick={() => setQuery('')}
              aria-label={t('common.cancel')}
            >
              <X size={11} />
            </button>
          ) : (
            <span className="rounded border border-[var(--line)] bg-[var(--kbd-bg)] px-1 py-0.5 font-mono text-[11px] text-[var(--text-faint)]">
              {SPECS.length}
            </span>
          )}
        </div>
      </div>

      <div className="sidebar-scroll scroll-thin min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {groups.map((group) => (
          <div key={group.id} className="mb-1">
            <div className="flex items-baseline justify-between px-1 pb-1 pt-1.5">
              <span className="panel-label">{lang === 'zh' ? group.name : group.nameEn}</span>
              <span className="font-mono text-[11px] text-[var(--text-faint)]">{group.specs.length}</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {group.specs.map((spec) => {
                const active = pendingKind === spec.kind;
                const name = specName(spec.kind, lang);
                return (
                  <button
                    key={spec.kind}
                    className={`tile ${active ? 'active' : ''}`}
                    title={`${name}\n${specDesc(spec.kind, lang)}`}
                    aria-pressed={active}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', spec.kind);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => setPendingKind(active ? null : spec.kind)}
                  >
                    <CompIcon kind={spec.kind} size={23} />
                    <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap px-1 text-[12px] font-medium leading-none tracking-[0.005em]">
                      {name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {!total && (
          <div className="px-2 py-10 text-center text-[11.5px] text-[var(--text-muted)]">
            {t('sidebar.empty')}
            <div className="mt-1 text-[11px] text-[var(--text-faint)]">{t('sidebar.emptyHint')}</div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-[var(--line)] px-3 py-2 text-[12px] text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          {t('sidebar.dragOrClick')}
        </span>
        <span className="flex items-center gap-1">
          <kbd className="kbd !h-[17px] !min-w-[17px] !text-[11px]">R</kbd>
          {t('sidebar.rotate')}
        </span>
      </div>
    </aside>
  );
}
