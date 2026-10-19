// A SOURCE WINDOW WHOSE MARKER HAS MOVED MUST FAIL, NOT WIDEN.
//
// Dozens of barriers in this repo narrow a product file to the region they mean to assert about:
//
//     const sig = index.slice(index.indexOf('const districtNarrowingSig'),
//                             index.indexOf('const hasDistrictNarrowing'));
//
// `String.prototype.indexOf` returns **-1** when it does not find the marker, and `slice` reads a
// negative end as an offset from the END OF THE STRING. So the moment the END marker is renamed,
// destructured, or refactored away, `slice(start, -1)` stops being a window at all and becomes
// "almost the entire file". Every `window.includes(x)` assertion underneath then searches 200KB of
// unrelated source and passes — not because the invariant holds, but because the needle exists
// SOMEWHERE. The guard has silently become a grep over the whole module.
//
// MEASURED, BY EXECUTION (2026-09-20, routine #10). `scripts/verify-district-counts-honest.ts` is
// the guard over the 2026-08-22 count-honesty defect — حي العارض advertising 2,914 while the search
// it triggers lands on 1,231, because the combined-mode Rent budget was missing from
// `districtNarrowingSig`. Two changes were planted in `src/app/index.tsx`:
//
//   (a) THE REAL DEFECT — `query.priceMinRent, query.priceMaxRent` deleted from the signature;
//   (b) a behaviour-preserving, type-correct refactor of the END MARKER ALONE —
//       `const hasDistrictNarrowing = useMemo(…)` → `const [hasDistrictNarrowing] = useMemo(…)`.
//
// The barrier printed `PASS  districtNarrowingSig includes query.priceMinRent` over a signature that
// no longer contained it, and closed with `✓ district counts are filter-aware`. The FULL suite —
// `npm run test:all`, all 486 checks — passed. A guard that asserts the bug, in the §0.1 sense, and
// nothing else in the tree saw it.
//
// Note (b) on its own is innocent and (a) on its own is caught. That is the whole hazard: the
// blinding change and the defect need never be made by the same person, in the same PR, or in the
// same month. Once the marker has drifted, the guard is a comment that runs.
//
// THE FIX IS NOT "be careful with indexOf" — it is that a missing marker must be UNREPRESENTABLE as
// a window. `windowBetween()` throws. A barrier that throws exits non-zero, so the failure mode is a
// loud red naming the marker that moved, which is the direction this repo has been burned by the
// absence of (nine dark detectors reading as a clean bill of health, AGENTS.md "Read this first").
//
// The ratchet over the remaining raw sites is `scripts/verify-source-windows-fail-closed.ts`.

/** Thrown when a window's marker is not where the barrier believed it was. */
export class MarkerMissing extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarkerMissing';
  }
}

const show = (m: string) => (m.length > 60 ? `${m.slice(0, 57)}…` : m);

/**
 * The source between `start` and the FIRST occurrence of `end` AFTER it, start-inclusive and
 * end-exclusive — or a thrown `MarkerMissing` if either marker is not there.
 *
 * Searching for `end` after `start` rather than from position 0 closes a second latent bug in the
 * raw idiom: when the end marker also appears somewhere ABOVE the start marker, `slice` is handed
 * `end < start` and silently yields an EMPTY window. Empty fails closed, so it is the less dangerous
 * of the two, but it is still a window nobody asked for.
 *
 * `where` is the file the source came from; it costs one argument and turns an unhelpful
 * "marker not found" into a line a reader can act on.
 */
export function windowBetween(src: string, start: string, end: string, where = 'source'): string {
  const i = src.indexOf(start);
  if (i < 0) {
    throw new MarkerMissing(
      `${where}: window START marker not found — ${JSON.stringify(show(start))}. The code this ` +
      `barrier asserts about has moved or been renamed; fix the marker, never the assertion.`);
  }
  const j = src.indexOf(end, i + start.length);
  if (j < 0) {
    throw new MarkerMissing(
      `${where}: window END marker not found after the start — ${JSON.stringify(show(end))}. ` +
      `A raw slice would have read -1 here and widened this window to the rest of the file, so ` +
      `every assertion under it would have passed against unrelated source.`);
  }
  return src.slice(i, j);
}

/**
 * The source from the beginning up to the first occurrence of `end` — or a thrown `MarkerMissing`.
 * The same hazard in its other dress: `slice(0, src.indexOf(missing))` is `slice(0, -1)`, i.e. the
 * whole file bar one character.
 */
export function windowUpTo(src: string, end: string, where = 'source'): string {
  const j = src.indexOf(end);
  if (j < 0) {
    throw new MarkerMissing(
      `${where}: window END marker not found — ${JSON.stringify(show(end))}. A raw ` +
      `slice(0, indexOf(…)) would have read -1 here and returned the whole file.`);
  }
  return src.slice(0, j);
}

// ── THE RATCHET'S DISCOVERY PREDICATE, PURE ───────────────────────────────────────────────────────
//
// A raw site is a `.slice(…, X.indexOf('…'))` whose END argument is a BARE `indexOf` call — no `+ n`
// offset. The offset forms are deliberately NOT flagged: `slice(i, i + 700)` with a missing marker
// gives `slice(i, 699)`, and when `i > 699` that is an EMPTY window, which fails closed. Only the
// bare form turns -1 into "the rest of the file". Flagging the safe shape too would be a ratchet
// that cries wolf, and a ratchet that cries wolf gets lowered.

export type RawWindowSite = { file: string; line: number; text: string };

const SITE =
  /\.\s*slice\(\s*([^;]*?)\s*,\s*([A-Za-z0-9_$.]+\.indexOf\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*\))\s*\)/g;

/**
 * Every raw two-marker window in one barrier's source. `src` must already be CODE ONLY
 * (`stripCommentsAndStrings`), because a barrier legitimately quotes this anti-pattern inside its own
 * mutation proofs and in the header explaining why it is forbidden — this file being the first
 * example. Scanning un-stripped text would make the ratchet flag its own documentation, and the
 * obvious way to clear that red is to stop documenting it.
 */
export function rawWindowSites(file: string, src: string): RawWindowSite[] {
  const out: RawWindowSite[] = [];
  for (const m of src.matchAll(SITE)) {
    out.push({
      file,
      line: src.slice(0, m.index).split('\n').length,
      text: m[0].replace(/\s+/g, ' ').slice(0, 120),
    });
  }
  return out;
}

// ── THE RATCHET'S VERDICT, PURE ───────────────────────────────────────────────────────────────────
//
// The baseline is a per-FILE COUNT, not a line number: line numbers drift on every unrelated edit
// above them, and a baseline that goes stale for innocent reasons is a baseline someone deletes.
// Counts move only when a site is added or converted, which is exactly when a reviewer should look.

export type Baseline = Map<string, number>;

/** `filename | N` rows; blank lines and `#` comments ignored. */
export function parseBaseline(text: string): Baseline {
  const out: Baseline = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [name, n] = line.split('|').map((s) => s.trim());
    out.set(name, Number(n));
  }
  return out;
}

/**
 * What is wrong with the tree, as plain sentences. Empty means clean.
 *
 * Both directions fail, and the second is the one that keeps the ratchet honest: a baseline row
 * whose file has FEWER raw sites than it claims is reported as STALE, so the ledger can never read
 * better than the tree. That is the shape `verify-every-rpc-call-is-bounded.ts` already pins for
 * unbounded RPC calls, and the reason is the same — a ratchet that silently tolerates progress it
 * has not recorded is a ratchet whose number nobody can cite.
 */
export function windowRatchetProblems(
  found: Map<string, number>, baseline: Baseline, ceiling: number,
): string[] {
  const problems: string[] = [];
  for (const [file, n] of [...found].sort()) {
    const allowed = baseline.get(file) ?? 0;
    if (n > allowed) {
      problems.push(
        `${file}: ${n} raw window site(s), baseline allows ${allowed}. A new ` +
        `\`.slice(a.indexOf(…), b.indexOf(…))\` reads the rest of the file when its end marker ` +
        `moves. Use windowBetween() from scripts/lib/sourceWindow.ts — it throws instead.`);
    }
  }
  for (const [file, allowed] of [...baseline].sort()) {
    const n = found.get(file) ?? 0;
    if (n < allowed) {
      problems.push(
        `${file}: baseline claims ${allowed} raw window site(s) but the file has ${n}. STALE — ` +
        `lower the row (or delete it at 0) in the same diff as the fix, so the ratchet cannot ` +
        `read better than the tree.`);
    }
  }
  const total = [...found.values()].reduce((a, b) => a + b, 0);
  if (total > ceiling) {
    problems.push(
      `${total} raw window sites in total, above the pinned ceiling of ${ceiling}. The ceiling may ` +
      `only fall.`);
  }
  return problems;
}
