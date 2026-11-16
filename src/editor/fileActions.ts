import { downloadText, exportCirc, importCirc, safeFilename } from './circ';
import { itemCount, tr, type MessageKey } from '../i18n';
import { projectFromNamedDocs, useEditor } from './store';
import { sanitizeProject } from './project';
import { sim } from '../model/sim';
import { viewControls } from '../canvas/view';
import { SPEC_BY_KIND } from '../model/specs';
import type { Template } from './templates';

function pickTextFile(accept: string, onText: (text: string, name: string) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) {
      input.remove();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      onText(String(reader.result ?? ''), file.name);
      input.remove();
    };
    reader.onerror = () => {
      const lang = useEditor.getState().lang;
      useEditor.getState().toastMsg(tr(lang, 'file.readFailed'), 'error');
      input.remove();
    };
    reader.readAsText(file);
  });
  input.click();
  setTimeout(() => input.remove(), 60_000);
}

function tx(lang: 'zh' | 'en', key: MessageKey, vars?: Record<string, string | number>) {
  return tr(lang, key, vars);
}

export function saveProject() {
  const st = useEditor.getState();
  const project = st.snapshotProject();
  const payload = {
    app: 'logisim-studio',
    version: 2,
    savedAt: new Date().toISOString(),
    project,
    doc: st.doc,
  };
  downloadText(safeFilename(st.doc.name, '.json'), JSON.stringify(payload, null, 2), 'application/json');
  st.toastMsg(tx(st.lang, 'file.saved'), 'success');
}

export function openProject() {
  pickTextFile('.json,.circ,.xml', (text, name) => {
    const st = useEditor.getState();
    const lang = st.lang;
    const trimmed = text.trim();
    try {
      if (trimmed.startsWith('<')) {
        const result = importCirc(trimmed, name.replace(/\.[^.]+$/, ''), lang);
        const project = projectFromNamedDocs(result.circuits, result.mainName);
        if (!st.loadProject(project)) return;
        sim.reset();
        const items = itemCount(lang, result.supported, '个元件', 'component');
        const warnings = result.warnings.slice(0, 4).join(' · ');
        const extra = result.warnings.length > 4 ? ` · +${result.warnings.length - 4}` : '';
        st.toastMsg(
          result.warnings.length
            ? tx(lang, 'file.importedWarn', { items, warning: warnings + extra })
            : tx(lang, 'file.imported', { items }),
          result.warnings.length ? 'warn' : 'success',
        );
        if (result.warnings.length) console.warn('[Logisim Studio] .circ import:', result.warnings);
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          throw new Error(tx(lang, 'file.invalidProject'));
        }
        const sanitized = sanitizeProject(parsed, lang);
        if (!sanitized) throw new Error(tx(lang, 'file.invalidProject'));
        if (!st.loadProject(sanitized.project)) return;
        if (sanitized.warnings.length) console.warn('[Logisim Studio] project import:', sanitized.warnings);
        sim.reset();
        st.toastMsg(tx(lang, 'file.opened'), 'success');
      }
      setTimeout(() => viewControls.fit(), 40);
    } catch (err) {
      console.error(err);
      st.toastMsg(err instanceof Error && err.message ? err.message : tx(lang, 'file.openFailed'), 'error');
    }
  });
}

export function exportCircFile() {
  const st = useEditor.getState();
  const result = exportCirc(st.doc, st.circuits, st.currentCircuit);
  setTimeout(() => {
    downloadText(safeFilename(st.doc.name, '.circ'), result.xml, 'application/xml');
    if (result.skipped.length) {
      const items = result.skipped
        .map((k) => {
          const spec = SPEC_BY_KIND[k as keyof typeof SPEC_BY_KIND];
          return st.lang === 'zh' ? spec?.name ?? k : spec?.nameEn ?? k;
        })
        .join(st.lang === 'zh' ? '、' : ', ');
      st.toastMsg(tx(st.lang, 'file.exportedWarn', { items }), 'warn');
    } else {
      st.toastMsg(tx(st.lang, 'file.exported'), 'success');
    }
  }, 20);
}

export function newCircuit() {
  const st = useEditor.getState();
  st.newDoc();
  sim.reset();
  viewControls.reset();
  setTimeout(() => viewControls.invalidate(), 20);
}

export function loadTemplate(template: Template) {
  const st = useEditor.getState();
  const doc = template.make(st.lang);
  const baseName = st.lang === 'zh' ? template.name : template.nameEn;
  const hasProject =
    Object.keys(st.circuits).length > 1 || st.doc.comps.length > 0 || st.doc.wires.length > 0;
  if (hasProject) {
    let name = baseName;
    let n = 2;
    const names = new Set(Object.values(st.circuits).map((d) => d.name));
    while (names.has(name)) name = `${baseName} ${n++}`;
    doc.name = name;
    const id = st.createCircuit(name, doc);
    st.switchCircuit(id);
    st.toastMsg(tr(st.lang, 'file.templateLoaded', { name }), 'success');
  } else {
    st.loadDoc(doc, { welcomeClosed: true });
    st.toastMsg(tr(st.lang, 'file.templateLoaded', { name: baseName }), 'success');
  }
  sim.reset();
  setTimeout(() => viewControls.fit(), 30);
}
