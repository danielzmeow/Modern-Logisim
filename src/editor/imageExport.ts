import { drawScene } from '../canvas/draw';
import { computePngLayout } from '../canvas/exportLayout';
import { contentBounds } from '../model/geometry';
import { sim } from '../model/sim';
import { createSimView } from '../model/simView';
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

/** Render the current circuit to an offscreen canvas. */
function renderCircuitCanvas(): HTMLCanvasElement | null {
  const st = useEditor.getState();
  const bounds = contentBounds(st.doc);
  if (!bounds) {
    st.toastMsg(tr(st.lang, 'file.pngEmpty'), 'warn');
    return null;
  }
  const layout = computePngLayout(bounds);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    st.toastMsg(tr(st.lang, 'file.pngFailed'), 'error');
    return null;
  }
  // PNG/print export always simulates from the fixed root, and maps values
  // onto whichever circuit is currently being viewed.
  const rootDoc = st.simRootId ? st.circuits[st.simRootId] : undefined;
  sim.ensure(rootDoc ?? st.doc, st.circuits, st.simRootId ?? undefined);
  const view = createSimView(sim, {
    circuits: st.circuits,
    rootId: st.simRootId,
    circuitId: st.currentCircuit,
    path: st.simPath,
  });
  drawScene({
    ctx,
    doc: st.doc,
    view,
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
  return canvas;
}

/** Render the current circuit to an offscreen canvas and download a PNG. */
export async function exportPngFile() {
  const st = useEditor.getState();
  const canvas = renderCircuitCanvas();
  if (!canvas) return;
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

/** Print the current circuit using a hidden iframe to avoid pop-up blockers. */
export function printCircuit() {
  const st = useEditor.getState();
  const canvas = renderCircuitCanvas();
  if (!canvas) return;
  try {
    const data = canvas.toDataURL('image/png');
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (!doc) {
      iframe.remove();
      st.toastMsg(tr(st.lang, 'file.printFailed'), 'error');
      return;
    }
    doc.open();
    doc.write(
      `<!doctype html><html><head><title>${st.doc.name.replace(/[<&>]/g, '')}</title>` +
        `<style>@page{margin:12mm}html,body{margin:0}img{max-width:100%;height:auto;display:block;margin:0 auto}</style>` +
        `</head><body><img src="${data}" onload="setTimeout(function(){window.print()},80)"></body></html>`,
    );
    doc.close();
    setTimeout(() => iframe.remove(), 60_000);
  } catch (err) {
    console.error(err);
    st.toastMsg(tr(st.lang, 'file.printFailed'), 'error');
  }
}
