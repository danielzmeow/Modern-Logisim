import { downloadText, exportCirc, importCirc, safeFilename } from './circ';
import { itemCount, tr, type MessageKey } from '../i18n';
import { useEditor } from './store';
import { sim } from '../model/sim';
import { viewControls } from '../canvas/view';
import type { Doc } from '../model/types';
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
  const { doc, toastMsg, markSaved, lang } = useEditor.getState();
  const payload = {
    app: 'logisim-studio',
    version: 1,
    savedAt: new Date().toISOString(),
    doc,
  };
  downloadText(safeFilename(doc.name, '.json'), JSON.stringify(payload, null, 2), 'application/json');
  markSaved();
  toastMsg(tx(lang, 'file.saved'), 'success');
}

export function openProject() {
  pickTextFile('.json,.circ,.xml', (text, name) => {
    const { loadDoc, toastMsg, lang } = useEditor.getState();
    const trimmed = text.trim();
    try {
      if (trimmed.startsWith('<')) {
        const result = importCirc(trimmed, name.replace(/\.[^.]+$/, ''), lang);
        loadDoc(result.doc, { welcomeClosed: true });
        sim.reset();
        const items = itemCount(lang, result.doc.comps.length, '个元件', 'component');
        toastMsg(
          result.warnings.length
            ? tx(lang, 'file.importedWarn', { items, warning: result.warnings[0] })
            : tx(lang, 'file.imported', { items }),
          result.warnings.length ? 'warn' : 'success',
        );
        if (result.warnings.length) console.warn('[Logisim Studio] .circ import:', result.warnings);
      } else {
        let parsed: { doc?: Doc } | Doc;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          throw new Error(tx(lang, 'file.invalidProject'));
        }
        const doc: Doc = (parsed as { doc?: Doc }).doc ?? (parsed as Doc);
        if (!doc || !Array.isArray(doc.comps) || !Array.isArray(doc.wires)) {
          throw new Error(tx(lang, 'file.invalidProject'));
        }
        loadDoc(doc, { welcomeClosed: true });
        sim.reset();
        toastMsg(tx(lang, 'file.opened'), 'success');
      }
      setTimeout(() => viewControls.fit(), 40);
    } catch (err) {
      console.error(err);
      toastMsg(err instanceof Error && err.message ? err.message : tx(lang, 'file.openFailed'), 'error');
    }
  });
}

export function exportCircFile() {
  const { doc, toastMsg, lang } = useEditor.getState();
  const result = exportCirc(doc);
  setTimeout(() => {
    downloadText(safeFilename(doc.name, '.circ'), result.xml, 'application/xml');
    if (result.skipped.length) {
      const items = result.skipped
        .map((k) => tx(lang, k === 'split' ? 'file.split' : 'file.merge'))
        .join(lang === 'zh' ? '、' : ', ');
      toastMsg(tx(lang, 'file.exportedWarn', { items }), 'warn');
    } else {
      toastMsg(tx(lang, 'file.exported'), 'success');
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
  const name = st.lang === 'zh' ? template.name : template.nameEn;
  st.loadDoc(doc, { welcomeClosed: true });
  sim.reset();
  setTimeout(() => viewControls.fit(), 30);
  st.toastMsg(tr(st.lang, 'file.templateLoaded', { name }), 'success');
}
