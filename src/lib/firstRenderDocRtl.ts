// Pure: the page direction a row must use on its FIRST render (see src/lib/useDocumentRtl.ts).
// On web that first render is a hydration of HTML pre-rendered in Arabic, so it must match the server — RTL —
// whatever language the client loads in; the hook's effect then moves to the real direction. Native has no
// pre-rendered HTML and no document: null means "use the language".
export const SERVER_RENDERED_RTL = true;
export const firstRenderDocRtl = (isWeb: boolean): boolean | null => (isWeb ? SERVER_RENDERED_RTL : null);
