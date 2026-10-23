// Is the PAGE right-to-left right now? (owner 2026-10-21: a laptop screenshot, English page, sidebar on the RIGHT.)
//
// A page-structure row that must keep a child on one PHYSICAL side in both languages (the docked sidebar on the
// left, the in-app ad pane on the right) uses `row-reverse` to cancel the mirroring an RTL document applies to
// `row`. That only works while the document really is RTL. Keyed on the LANGUAGE (`locale === 'ar'`), any moment
// the two disagree flips the child to the wrong side and leaves it there — reproduced on the live site by setting
// <html dir="rtl"> under English: the sidebar jumped to x=994 of 1280. Keyed on the attribute itself, watched with
// a MutationObserver, the row cancels exactly the mirroring the browser is applying, so the physical side holds
// whatever the language state says. Native has no document: it falls back to the language.
//
// THE FIRST RENDER IS A HYDRATION (owner 2026-10-23: signed in, English, refresh → sidebar on the RIGHT again).
// Every page is pre-rendered at build time in Arabic (`web.output: static`, <html dir="rtl">), so the served HTML
// already carries the row as `row-reverse`. React hydration does NOT repair an attribute or class that differs
// from the client's first render — it keeps the server's. A signed-in English refresh rendered `row` on its first
// pass, the DOM kept `row-reverse` under an LTR page, and since every later render also said `row`, React never
// saw a change to write. So the first web render returns what the SERVER rendered, and the effect then sets the
// page's real direction: that is a real state change, which React does write to the DOM.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { firstRenderDocRtl } from './firstRenderDocRtl';

export { firstChildLeftRow } from './firstChildLeftRow';

export function useDocumentRtl(fallback: boolean): boolean {
  const [rtl, setRtl] = useState<boolean | null>(() => firstRenderDocRtl(Platform.OS === 'web'));
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    const sync = () => setRtl(document.documentElement.dir === 'rtl');
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['dir'] });
    return () => mo.disconnect();
  }, []);
  return rtl ?? fallback;
}
