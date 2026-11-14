import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useEditor } from '../editor/store';
import { SPECS, specDesc, specName } from '../model/specs';
import { CompIcon } from './icons';
import { viewControls } from '../canvas/view';
import { exportCircFile, loadTemplate, newCircuit, openProject, saveProject } from '../editor/fileActions';
import { TEMPLATES, templateName, templateNote } from '../editor/templates';
import { sim } from '../model/sim';
import { useT } from './useT';
import { useFocusTrap } from './useFocusTrap';
import {
  CheckSquare,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  Grid3x3,
  Keyboard,
  LayoutGrid,
  Languages,
  Monitor,
  Moon,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Scan,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  Redo2,
  Save,
  Sun,
  CornerDownLeft,
  type LucideIcon,
} from 'lucide-react';

interface Item {
  id: string;
  group: string;
  label: string;
  sub?: string;
  keywords: string;
  icon: ReactNode;
  shortcut?: string;
  run: () => void;
}

function score(hay: string, q: string): number {
  if (!q) return 0;
  const h = hay.toLowerCase();
  const query = q.toLowerCase().trim();
  if (!query) return 0;
  const idx = h.indexOf(query);
  if (idx === 0) return 120;
  if (idx > 0) return 80 - Math.min(idx, 30);
  let hi = 0;
  let streak = 0;
  let total = 0;
  for (const ch of query) {
    const found = h.indexOf(ch, hi);
    if (found < 0) return -1;
    if (found === hi) streak++;
    else streak = 0;
    total += streak * 2 + Math.max(0, 12 - (found - hi)) * 0.2;
    hi = found + 1;
  }
  return total;
}

export function CommandPalette() {
  const open = useEditor((s) => s.paletteOpen);
  const setOpen = useEditor((s) => s.setPaletteOpen);
  const running = useEditor((s) => s.running);
  const showGrid = useEditor((s) => s.showGrid);
  const canvasTheme = useEditor((s) => s.canvasTheme);
  const appearance = useEditor((s) => s.appearance);
  const lang = useEditor((s) => s.lang);
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const actions = useMemo<Item[]>(() => {
    const st = () => useEditor.getState();
    const closeThen = (fn: () => void) => () => {
      setOpen(false);
      requestAnimationFrame(fn);
    };
    const iconWrap = (Icon: LucideIcon, tint = 'var(--text-muted)') => (
      <Icon size={15} strokeWidth={1.9} style={{ color: tint }} />
    );
    const list: Item[] = [
      {
        id: 'run',
        group: t('palette.group.sim'),
        label: running ? t('palette.pause') : t('palette.run'),
        sub: running ? t('palette.pauseSub') : t('palette.runSub'),
        keywords: 'run pause sim 仿真 运行 暂停',
        icon: iconWrap(running ? Pause : Play, running ? 'var(--warning-text)' : 'var(--success-text)'),
        shortcut: '⌘↩',
        run: closeThen(() => st().toggleRunning()),
      },
      {
        id: 'reset',
        group: t('palette.group.sim'),
        label: t('palette.reset'),
        sub: t('palette.resetSub'),
        keywords: 'reset 复位 清零',
        icon: iconWrap(RotateCcw, 'var(--text-muted)'),
        run: closeThen(() => {
          sim.reset();
          viewControls.invalidate();
        }),
      },
      {
        id: 'fit',
        group: t('palette.group.view'),
        label: t('palette.fit'),
        sub: t('palette.fitSub'),
        keywords: 'fit zoom 适应 缩放 视图',
        icon: iconWrap(Scan, 'var(--text-muted)'),
        shortcut: '⌘0',
        run: closeThen(() => viewControls.fit()),
      },
      {
        id: 'grid',
        group: t('palette.group.view'),
        label: showGrid ? t('palette.hideGrid') : t('palette.showGrid'),
        sub: t('palette.gridSub'),
        keywords: 'grid 网格 点阵 显示',
        icon: iconWrap(Grid3x3, 'var(--text-muted)'),
        shortcut: 'G',
        run: closeThen(() => {
          st().setShowGrid(!st().showGrid);
          viewControls.invalidate();
        }),
      },
      {
        id: 'canvas-paper',
        group: t('palette.group.view'),
        label: t('palette.paper'),
        sub: t('palette.paperSub'),
        keywords: 'paper light canvas 画布 浅色',
        icon: iconWrap(LayoutGrid, 'var(--text-muted)'),
        run: closeThen(() => {
          st().setCanvasTheme('paper');
          viewControls.invalidate();
        }),
      },
      {
        id: 'canvas-graphite',
        group: t('palette.group.view'),
        label: t('palette.graphite'),
        sub: t('palette.graphiteSub'),
        keywords: 'graphite dark canvas 画布 深色',
        icon: iconWrap(LayoutGrid, 'var(--text-muted)'),
        run: closeThen(() => {
          st().setCanvasTheme('graphite');
          viewControls.invalidate();
        }),
      },
      {
        id: 'appearance-light',
        group: t('palette.group.appearance'),
        label: t('palette.light'),
        sub: t('palette.lightSub'),
        keywords: 'light appearance theme 浅色 外观 主题',
        icon: iconWrap(Sun, 'var(--warning-text)'),
        run: closeThen(() => st().setAppearance('light')),
      },
      {
        id: 'appearance-dark',
        group: t('palette.group.appearance'),
        label: t('palette.dark'),
        sub: t('palette.darkSub'),
        keywords: 'dark appearance theme 深色 外观 主题',
        icon: iconWrap(Moon, 'var(--accent-text)'),
        run: closeThen(() => st().setAppearance('dark')),
      },
      {
        id: 'appearance-system',
        group: t('palette.group.appearance'),
        label: t('palette.system'),
        sub: t('palette.systemSub'),
        keywords: 'system auto appearance theme 跟随系统 外观',
        icon: iconWrap(Monitor, 'var(--text-muted)'),
        run: closeThen(() => st().setAppearance('system')),
      },
      {
        id: 'language-en',
        group: t('palette.group.appearance'),
        label: t('palette.english'),
        sub: t('palette.englishSub'),
        keywords: 'english language lang 英文 英语',
        icon: iconWrap(Languages, 'var(--text-muted)'),
        run: closeThen(() => st().setLang('en')),
      },
      {
        id: 'language-zh',
        group: t('palette.group.appearance'),
        label: t('palette.chinese'),
        sub: t('palette.chineseSub'),
        keywords: 'chinese language lang 中文 汉语',
        icon: iconWrap(Languages, 'var(--text-muted)'),
        run: closeThen(() => st().setLang('zh')),
      },
      {
        id: 'rotate',
        group: t('palette.group.edit'),
        label: t('palette.rotate'),
        sub: t('palette.rotateSub'),
        keywords: 'rotate 旋转 顺时针',
        icon: iconWrap(RotateCw, 'var(--text-muted)'),
        shortcut: 'R',
        run: closeThen(() => {
          st().rotateSelection(1);
          viewControls.invalidate();
        }),
      },
      {
        id: 'duplicate',
        group: t('palette.group.edit'),
        label: t('palette.duplicate'),
        sub: t('palette.duplicateSub'),
        keywords: 'duplicate copy 复制',
        icon: iconWrap(Copy, 'var(--text-muted)'),
        shortcut: '⌘D',
        run: closeThen(() => {
          st().duplicateSelection();
          viewControls.invalidate();
        }),
      },
      {
        id: 'delete',
        group: t('palette.group.edit'),
        label: t('palette.delete'),
        sub: t('palette.deleteSub'),
        keywords: 'delete remove 删除',
        icon: iconWrap(Trash2, 'var(--danger-text)'),
        shortcut: '⌫',
        run: closeThen(() => {
          st().deleteSelection();
          viewControls.invalidate();
        }),
      },
      {
        id: 'undo',
        group: t('palette.group.edit'),
        label: t('palette.undo'),
        sub: t('palette.undoSub'),
        keywords: 'undo 撤销',
        icon: iconWrap(Undo2, 'var(--text-muted)'),
        shortcut: '⌘Z',
        run: closeThen(() => {
          st().undo();
          viewControls.invalidate();
        }),
      },
      {
        id: 'redo',
        group: t('palette.group.edit'),
        label: t('palette.redo'),
        sub: t('palette.redoSub'),
        keywords: 'redo 重做',
        icon: iconWrap(Redo2, 'var(--text-muted)'),
        shortcut: '⇧⌘Z',
        run: closeThen(() => {
          st().redo();
          viewControls.invalidate();
        }),
      },
      {
        id: 'selectAll',
        group: t('palette.group.edit'),
        label: t('palette.selectAll'),
        sub: t('palette.selectAllSub'),
        keywords: 'select all 全选',
        icon: iconWrap(CheckSquare, 'var(--text-muted)'),
        shortcut: '⌘A',
        run: closeThen(() => {
          st().selectAll();
          viewControls.invalidate();
        }),
      },
      {
        id: 'save',
        group: t('palette.group.file'),
        label: t('palette.save'),
        sub: t('palette.saveSub'),
        keywords: 'save 保存 项目 导出 json',
        icon: iconWrap(Save, 'var(--text-muted)'),
        shortcut: '⌘S',
        run: closeThen(saveProject),
      },
      {
        id: 'open',
        group: t('palette.group.file'),
        label: t('palette.open'),
        sub: t('palette.openSub'),
        keywords: 'open import 打开 导入 circ',
        icon: iconWrap(FolderOpen, 'var(--text-muted)'),
        shortcut: '⌘O',
        run: closeThen(openProject),
      },
      {
        id: 'exportCirc',
        group: t('palette.group.file'),
        label: t('palette.export'),
        sub: t('palette.exportSub'),
        keywords: 'export circ 导出 logisim',
        icon: iconWrap(Download, 'var(--text-muted)'),
        shortcut: '⌘E',
        run: closeThen(exportCircFile),
      },
      {
        id: 'new',
        group: t('palette.group.file'),
        label: t('palette.new'),
        sub: t('palette.newSub'),
        keywords: 'new 新建 清空',
        icon: iconWrap(FilePlus2, 'var(--text-muted)'),
        run: closeThen(newCircuit),
      },
      {
        id: 'shortcuts',
        group: t('palette.group.help'),
        label: t('palette.shortcuts'),
        sub: t('palette.shortcutsSub'),
        keywords: 'keyboard shortcuts 快捷键',
        icon: iconWrap(Keyboard, 'var(--text-muted)'),
        shortcut: '?',
        run: closeThen(() => st().setShortcutsOpen(true)),
      },
    ];
    for (const template of TEMPLATES) {
      const name = templateName(template, lang);
      list.push({
        id: `template:${template.id}`,
        group: t('palette.group.template'),
        label: t('palette.template', { name }),
        sub: templateNote(template, lang),
        keywords: `template 模板 ${template.name} ${template.nameEn} ${template.note} ${template.noteEn}`,
        icon: iconWrap(Sparkles, 'var(--accent-text)'),
        run: closeThen(() => loadTemplate(template)),
      });
    }
    return list;
  }, [running, showGrid, canvasTheme, appearance, lang, t, setOpen]);

  const items = useMemo(() => {
    const q = query.trim();
    const comps: Item[] = SPECS.map((s) => ({
      id: `comp:${s.kind}`,
      group: t('palette.group.components'),
      label: t('palette.place', { name: specName(s.kind, lang) }),
      sub: lang === 'zh' ? `${s.nameEn} · ${specDesc(s.kind, lang)}` : specDesc(s.kind, lang),
      keywords: `${s.name} ${s.nameEn} ${s.desc} ${s.descEn} ${s.keywords.join(' ')}`,
      icon: <CompIcon kind={s.kind} size={17} />,
      run: () => {
        setOpen(false);
        useEditor.getState().setPendingKind(s.kind);
      },
    }));
    const all = [...actions, ...comps];
    if (!q) return all;
    return all
      .map((item) => ({ item, s: score(`${item.label} ${item.sub ?? ''} ${item.keywords}`, q) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.item)
      .slice(0, 60);
  }, [actions, query, lang, t, setOpen]);

  useEffect(() => {
    if (index >= items.length) setIndex(0);
  }, [items.length, index]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;

  let lastGroup = '';
  return (
    <div
      className="modal-backdrop flex items-start justify-center px-6 pt-[11vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={panelRef}
        className="modal-panel flex w-full max-w-[640px] flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label={t('topbar.search')}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIndex((i) => Math.min(items.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            items[index]?.run();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
          }
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--line)] px-4 py-3">
          <Search size={16} className="text-[var(--text-muted)]" strokeWidth={2} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            placeholder={t('palette.placeholder')}
            spellCheck={false}
            aria-label={t('topbar.search')}
            className="h-6 flex-1 bg-transparent text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
          <kbd className="kbd">esc</kbd>
        </div>

        <div ref={listRef} className="palette-list scroll-thin max-h-[min(520px,calc(100vh-180px))] overflow-y-auto p-1.5">
          {items.length === 0 && (
            <div className="px-3 py-10 text-center text-[11.5px] text-[var(--text-muted)]">
              {t('palette.noResults')}
            </div>
          )}
          {items.map((item, i) => {
            const showGroup = !query.trim() && item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {showGroup && (
                  <div className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--text-faint)]">
                    {item.group}
                  </div>
                )}
                <button
                  data-index={i}
                  className={`palette-item ${i === index ? 'active' : ''}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => item.run()}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[var(--line)] bg-[var(--field)]">
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-inherit">{item.label}</span>
                    {item.sub && (
                      <span className="mt-[1px] block truncate text-[11px] text-[var(--text-muted)]">
                        {item.sub}
                      </span>
                    )}
                  </span>
                  {item.shortcut ? (
                    <kbd className="kbd">{item.shortcut}</kbd>
                  ) : i === index ? (
                    <CornerDownLeft size={13} className="text-[var(--text-faint)]" />
                  ) : null}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 border-t border-[var(--line)] px-4 py-2 text-[12px] text-[var(--text-faint)]">
          <span className="flex items-center gap-1">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd>
            {t('palette.navigate')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">↵</kbd>
            {t('palette.execute')}
          </span>
          <span className="ml-auto">Logisim Studio</span>
        </div>
      </div>
    </div>
  );
}
