import { useEffect } from 'react';
import { useEditor } from '../editor/store';
import { useT } from './useT';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export function Toasts() {
  const toast = useEditor((s) => s.toast);
  const dismiss = useEditor((s) => s.dismissToast);
  const { t } = useT();

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => dismiss(), 4200);
    return () => window.clearTimeout(timer);
  }, [toast?.id, dismiss]);

  if (!toast) return null;
  const Icon =
    toast.tone === 'success'
      ? CheckCircle2
      : toast.tone === 'warn'
        ? AlertTriangle
        : toast.tone === 'error'
          ? XCircle
          : Info;
  const color =
    toast.tone === 'success'
      ? 'text-[var(--success-text)]'
      : toast.tone === 'warn'
        ? 'text-[var(--warning-text)]'
        : toast.tone === 'error'
          ? 'text-[var(--danger-text)]'
          : 'text-[var(--accent-text)]';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[42px] z-[70] flex justify-center px-4">
      <div className="toast pointer-events-auto flex max-w-[560px] items-start gap-2.5 rounded-xl px-3.5 py-2.5">
        <Icon size={14} className={`mt-[1px] shrink-0 ${color}`} />
        <div className="whitespace-pre-wrap text-[12px] leading-[1.5] text-[var(--text)]">{toast.text}</div>
        <button
          className="ml-1 grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-faint)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]"
          onClick={dismiss}
          aria-label={t('common.close')}
        >
          <X size={11.5} />
        </button>
      </div>
    </div>
  );
}
