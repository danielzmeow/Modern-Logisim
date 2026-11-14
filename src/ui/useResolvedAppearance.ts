import { useEffect, useState } from 'react';
import { useEditor } from '../editor/store';

export type ResolvedAppearance = 'light' | 'dark';

export function useResolvedAppearance(): ResolvedAppearance {
  const appearance = useEditor((s) => s.appearance);
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance;
}
