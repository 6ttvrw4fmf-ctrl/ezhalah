// A typewriter reveals TEXT TO A HUMAN, so its unit must be what a human sees — a glyph — and never
// a UTF-16 code unit.
//
// WHY THIS EXISTS (measured on production 2026-09-19, routine #9, ops_incident #347).
// `Typer` in src/app/agent.tsx rendered `text.slice(0, n)` with `n` counted in UTF-16 code units. A
// non-BMP emoji is TWO code units (🎉 is 🎉), so any frame landing between them renders a
// LONE HIGH SURROGATE — which the browser draws as the replacement box ▯. Twenty of the forty
// Results-Found templates the app ships (src/data/resultsFoundRotation.ts) end in exactly such an
// emoji, so the last frame before completion is a broken glyph for every one of them.
//
// Normally that frame lasts one 24 ms tick and nobody sees it. It is not always one tick. Measured
// live on ezhalah-app.vercel.app, three independent runs, with the harness completely silent for 90
// seconds so it could not be starving what it measured: after the second «عرض المزيد» press (500
// cards mounted) the reveal FROZE one tick short of the end and stayed there —
//
//     "لقينا لك 72,470 نتيجة تطابق بحثك \ud83c"      34 of 35 code units
//     "لقينا 72,470 نتيجة تطابق اللي بحثت عنه \ud83d"  40 of 41 code units
//
// — so a real user is left looking at a broken box, indefinitely, on the sentence that tells them how
// many results they got.
//
// TWO SEPARATE DEFECTS, and this module fixes exactly ONE of them. The freeze (why the final commit
// never lands under that render load) is ops_incident #347 and is NOT addressed here; so is the
// re-pick that restarts the reveal, which is fixed on main by PR #3232 and, as of this writing, has
// never been deployed (ops_incident #346). What IS fixed here is unconditional and independent of
// both: a partially-revealed string must never contain half a glyph, whether the frame lasts 24 ms
// or forever. Slicing by code unit is wrong even when everything else works.
//
// GRAPHEME, NOT MERELY CODE POINT. `[...text]` splits by code point, which fixes surrogate pairs but
// still cuts a variation selector off its base (🏘️ is U+1F3D8 U+FE0F — one of the shipped templates)
// and would split a ZWJ sequence. `Intl.Segmenter` is the right unit and is present in every browser
// this app supports; the code-point path is a fallback for a runtime without it, never the norm.

/**
 * `text` split into the units a human perceives as single characters.
 *
 * Grapheme clusters via `Intl.Segmenter` where available, code points otherwise. Never code units:
 * the one thing this must never return is a lone surrogate.
 */
export function glyphsOf(text: string): string[] {
  const s = String(text ?? '');
  if (!s) return [];
  const Seg = (globalThis as { Intl?: { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } } }).Intl?.Segmenter;
  if (Seg) {
    try {
      const out: string[] = [];
      for (const { segment } of new Seg(undefined, { granularity: 'grapheme' }).segment(s)) out.push(segment);
      return out;
    } catch {
      // fall through to the code-point path — a runtime that has Segmenter but rejects these options
      // must still reveal text, just with the weaker unit.
    }
  }
  return [...s];   // code points: still never splits a surrogate pair
}

/**
 * The first `n` GLYPHS of `text`.
 *
 * `n` is clamped, so a caller whose counter has run past the end (or been left short by a starved
 * animation) still gets well-formed text rather than a half-glyph. `n >= glyphCount(text)` returns
 * the ORIGINAL string, byte for byte — re-joining segments must never alter the completed sentence.
 */
export function revealPrefix(text: string, n: number): string {
  const s = String(text ?? '');
  if (!(n > 0)) return '';
  const g = glyphsOf(s);
  if (n >= g.length) return s;
  return g.slice(0, n).join('');
}

/** How many reveal steps `text` takes — the denominator the animation counts up to. */
export function glyphCount(text: string): number {
  return glyphsOf(text).length;
}

/**
 * `text` shortened to at most `max` GLYPHS, with `ellipsis` appended when anything was dropped.
 *
 * The same defect as the reveal above, in its other form: `s.slice(0, 117) + '…'` counts code units,
 * so a truncation boundary landing inside a surrogate pair leaves a lone surrogate — the ▯ box — in
 * text a user reads. Found alongside ops_incident #347 in two places that both display or PERSIST
 * the result: source free-text attributes on the property card (src/data/remote.ts) and a user's own
 * chat rename, which is pushed to the server (src/store.tsx).
 *
 * `max` counts the glyphs of the RESULT including `ellipsis`, so the output is never longer than the
 * caller's budget. A string already within budget is returned byte for byte.
 */
export function truncateGlyphs(text: string, max: number, ellipsis = '…'): string {
  const s = String(text ?? '');
  if (!(max > 0)) return '';
  const g = glyphsOf(s);
  if (g.length <= max) return s;
  const keep = Math.max(0, max - glyphsOf(ellipsis).length);
  return g.slice(0, keep).join('') + ellipsis;
}

/** True when `s` contains an unpaired surrogate — i.e. a rendering that shows the ▯ box. */
export function hasLoneSurrogate(s: string): boolean {
  const t = String(s ?? '');
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = t.charCodeAt(i + 1);
      if (!(d >= 0xdc00 && d <= 0xdfff)) return true;   // high surrogate not followed by a low one
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      const b = i > 0 ? t.charCodeAt(i - 1) : NaN;
      if (!(b >= 0xd800 && b <= 0xdbff)) return true;   // low surrogate not preceded by a high one
    }
  }
  return false;
}
