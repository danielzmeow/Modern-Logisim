import { downloadText, exportCirc, importCirc, safeFilename } from './circ';
import { itemCount, tr, type MessageKey } from '../i18n';
import { projectFromNamedDocs, useEditor, type ProjectData } from './store';
import { sim } from '../model/sim';
import { viewControls } from '../canvas/view';
import type { Doc } from '../model/types';
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

function validProject(p: unknown): p is ProjectData {
  const project = p as ProjectData | null;
  return (
    !!project &&
    !!project.circuits &&
    typeof project.circuits === 'object' &&
    Array.isArray(project.order)
  );
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
  st.markSaved();
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
        st.loadProject(project);
        sim.reset();
        const items = itemCount(lang, result.supported, '个元件', 'component');
        st.toastMsg(
          result.warnings.length
            ? tx(lang, 'file.importedWarn', { items, warning: result.warnings[0] })
            : tx(lang, 'file.imported', { items }),
          result.warnings.length ? 'warn' : 'success',
        );
        if (result.warnings.length) console.warn('[Logisim Studio] .circ import:', result.warnings);
      } else {
        let parsed: { project?: unknown; doc?: Doc; circuits?: unknown; current?: string } | Doc;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          throw new Error(tx(lang, 'file.invalidProject'));
        }
        const p = parsed as { project?: unknown; doc?: Doc; circuits?: unknown; current?: string };
        if (p.project && validProject(p.project)) {
          st.loadProject(p.project);
        } else if (p.circuits && typeof p.circuits === 'object' && !Array.isArray(p.circuits)) {
          const circuits = p.circuits as Record<string, Doc>;
          const order = Object.keys(circuits);
          const first = order[0];
          if (!first) throw new Error(tx(lang, 'file.invalidProject'));
          st.loadProject({ circuits, order, current: p.current && circuits[p.current] ? p.current : first });
        } else {
          const doc: Doc = (p as { doc?: Doc }).doc ?? (p as Doc);
          if (!doc || !Array.isArray(doc.comps) || !Array.isArray(doc.wires)) {
            throw new Error(tx(lang, 'file.invalidProject'));
          }
          st.loadDoc(doc, { welcomeClosed: true });
        }
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
