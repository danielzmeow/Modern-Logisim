import { drawScene } from '../canvas/draw';
import { computePngLayout } from '../canvas/exportLayout';
import { contentBounds } from '../model/geometry';
import { sim } from '../model/sim';
import { useEditor } from './store';
import { safeFilename } from './circ';
import { tr } from '../i18n';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Render the current circuit to an offscreen canvas and download a PNG. */
export async function exportPngFile() {
  const st = useEditor.getState();
  const bounds = contentBounds(st.doc);
  if (!bounds) {
    st.toastMsg(tr(st.lang, 'file.pngEmpty'), 'warn');
    return;
  }
  const layout = computePngLayout(bounds);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    st.toastMsg(tr(st.lang, 'file.pngFailed'), 'error');
    return;
  }
  sim.ensure(st.doc, st.circuits);
  drawScene({
    ctx,
    doc: st.doc,
    sim,
    selComps: [],
    selWires: [],
    hover: null,
    theme: st.canvasTheme,
    zoom: layout.zoom,
    pan: layout.pan,
    width: layout.width,
    height: layout.height,
    showGrid: false,
    running: false,
    now: 0,
    lang: st.lang,
  });
  await new Promise<void>((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        st.toastMsg(tr(st.lang, 'file.pngFailed'), 'error');
        resolve();
        return;
      }
      downloadBlob(blob, safeFilename(st.doc.name, '.png'));
      st.toastMsg(tr(st.lang, 'file.pngExported'), 'success');
      resolve();
    }, 'image/png');
  });
}
