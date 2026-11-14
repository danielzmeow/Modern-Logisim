import { useMemo, useRef, useState } from 'react';
import { useEditor } from '../editor/store';
import { CATEGORIES, SPECS, specDesc, specName, type Spec } from '../model/specs';
import { CompIcon } from './icons';
import { Boxes, ChevronsLeft, FunctionSquare, Plus, Search, Table2, Trash2, X } from 'lucide-react';
import { useT } from './useT';
import { viewControls } from '../canvas/view';
import { computeSubLayout } from '../model/hierarchy';

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
  const circuits = useEditor((s) => s.circuits);
  const circuitOrder = useEditor((s) => s.circuitOrder);
  const current = useEditor((s) => s.currentCircuit);
  const switchCircuit = useEditor((s) => s.switchCircuit);
  const createCircuit = useEditor((s) => s.createCircuit);
  const deleteCircuit = useEditor((s) => s.deleteCircuit);
  const setTruthOpen = useEditor((s) => s.setTruthOpen);
  const setEquationOpen = useEditor((s) => s.setEquationOpen);
  const addSubcircuit = useEditor((s) => s.addSubcircuit);
  const { lang, t } = useT();

  const groups = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      ...cat,
      specs: SPECS.filter((s) => s.kind !== 'sub' && s.category === cat.id && matches(s, query)),
    })).filter((g) => g.specs.length);
  }, [query]);

  const total = groups.reduce((n, g) => n + g.specs.length, 0);

  const addCircuit = () => {
    const ids = new Set(Object.values(circuits).map((d) => d.name));
    let n = circuitOrder.length + 1;
    let name = `${t('circuit.new')} ${n}`;
    while (ids.has(name)) name = `${t('circuit.new')} ${++n}`;
    const id = createCircuit(name);
    switchCircuit(id);
    setTimeout(() => viewControls.reset(), 20);
  };

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
              {SPECS.length - 1}
            </span>
          )}
        </div>
      </div>

      <div className="sidebar-scroll scroll-thin min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        <div className="mb-2 rounded-lg border border-[var(--line)] bg-[var(--card)]/60 p-1.5">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="panel-label flex items-center gap-1.5">
              <Boxes size={11} /> {t('sidebar.circuits')}
            </span>
            <button
              className="icon-btn !h-5 !w-5"
              title={t('sidebar.newCircuit')}
              aria-label={t('sidebar.newCircuit')}
              onClick={addCircuit}
            >
              <Plus size={12} />
            </button>
          </div>
          <div className="space-y-0.5">
            {circuitOrder.map((id) => {
              const doc = circuits[id];
              if (!doc) return null;
              const active = id === current;
              return (
                <div
                  key={id}
                  className={`group flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors ${
                    active ? 'bg-[var(--accent-soft)] text-[var(--text-strong)]' : 'hover:bg-[var(--hover)]'
                  }`}
                  draggable={!active}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', `sub:${id}`);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  title={active ? t('circuit.current') : t('circuit.subHint')}
                >
                  <button
                    className="min-w-0 flex-1 truncate text-left text-[11.5px] font-medium"
                    onClick={() => switchCircuit(id)}
                  >
                    {doc.name}
                  </button>
                  {active ? (
                    <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-text)]">
                      {t('circuit.current')}
                    </span>
                  ) : (
                    <>
                      <button
                        className="icon-btn !h-5 !w-5 opacity-60"
                        title={t('circuit.place')}
                        aria-label={t('circuit.place')}
                        onClick={() => {
                          const target = circuits[id];
                          if (!target) return;
                          const layout = computeSubLayout(target);
                          const center = viewControls.centerWorld();
                          addSubcircuit(
                            id,
                            { x: center.x - layout.subW / 2, y: center.y - layout.subH / 2 },
                          );
                          viewControls.invalidate();
                        }}
                      >
                        <Plus size={11} />
                      </button>
                      <button
                        className="icon-btn !h-5 !w-5 opacity-60"
                        title={t('circuit.open')}
                        aria-label={t('circuit.open')}
                        onClick={() => switchCircuit(id)}
                      >
                        <Boxes size={11} />
                      </button>
                      <button
                        className="icon-btn !h-5 !w-5 opacity-0 transition-opacity group-hover:opacity-100"
                        title={t('circuit.delete')}
                        aria-label={t('circuit.delete')}
                        onClick={() => deleteCircuit(id)}
                      >
                        <Trash2 size={11} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="px-1 pt-1 text-[10px] leading-[1.45] text-[var(--text-faint)]">
            {t('circuit.renameHint')}
          </div>
        </div>

        <div className="mb-2 grid grid-cols-2 gap-1">
          <button
            className="flex h-7 items-center justify-center gap-1.5 rounded-md border border-[var(--line)] bg-[var(--field)] text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]"
            onClick={() => setTruthOpen(true)}
            title={t('sidebar.truthTable')}
          >
            <Table2 size={12} /> {t('sidebar.truthTable')}
          </button>
          <button
            className="flex h-7 items-center justify-center gap-1.5 rounded-md border border-[var(--line)] bg-[var(--field)] text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]"
            onClick={() => setEquationOpen(true)}
            title={t('sidebar.fromEquation')}
          >
            <FunctionSquare size={12} /> {t('sidebar.fromEquation')}
          </button>
        </div>

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
    </aside>
  );
}
