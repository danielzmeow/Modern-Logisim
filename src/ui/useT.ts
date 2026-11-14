import { useMemo } from 'react';
import { useEditor } from '../editor/store';
import { tr, type Lang, type MessageKey } from '../i18n';

export function useT(): { lang: Lang; t: (key: MessageKey, vars?: Record<string, string | number>) => string } {
  const lang = useEditor((s) => s.lang);
  return useMemo(
    () => ({
      lang,
      t: (key: MessageKey, vars?: Record<string, string | number>) => tr(lang, key, vars),
    }),
    [lang],
  );
}
