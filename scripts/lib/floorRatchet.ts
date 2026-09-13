// A RATCHET THAT IS NOT ENFORCED IS A COMMENT.
//
// scripts/image-coverage-baseline.json has said, in its own header, since the day it was created:
//
//     "Raise floors when a fix lands; never lower one to clear a red — a drop is an incident."
//
// Nothing enforced it. On 2026-09-13 I lowered wasalt's floor from 90 to 86 to clear a red, on the
// strength of an adjudication that turned out to be circular (source_capture->>'image_count' is
// written as len(photo_urls) — a restatement of what WE stored, so a photo-less row reads 0 by
// construction and proves nothing about the source; see PR #2506 and the retraction on #2512).
// The floor edit was caught only because a different session happened to land the fix that exposed
// the circularity. Every barrier in the tree was green while it sat in review.
//
// THE RULE. A floor may RISE freely — that is a fix landing. A floor may FALL only with an explicit,
// reviewed `rebased` declaration on that platform's own entry, carrying:
//
//     from     the old floor, so the diff is stated and not merely implied
//     to       the new floor, which must equal floor_pct
//     why      prose a reviewer can disagree with
//     evidence how it was established — the thing I did not actually have
//
// This does NOT make lowering a floor easy; it makes it VISIBLE and ATTRIBUTABLE. A reviewer reading
// the diff sees a declaration written in the first person rather than a number that moved.
//
// WHAT THIS DELIBERATELY DOES NOT DO: judge whether the reason is a good one. It cannot. It makes the
// claim explicit and forces it through review, which is the most a file-level check can honestly
// promise — and strictly more than the zero enforcement the prose rule had.

export type FloorRebase = { from?: number; to?: number; why?: string; evidence?: string };
export type FloorEntry = {
  floor_pct?: number;
  imageless_at_source?: boolean;
  rebased?: FloorRebase;
  [k: string]: unknown;
};
export type FloorMap = Record<string, FloorEntry>;

/**
 * Compare a proposed baseline against the one currently committed. Returns a problem per platform
 * whose floor FELL without a complete `rebased` declaration, and per declaration that does not match
 * the numbers it claims. `before` is the committed state; `after` is the proposal.
 *
 * A platform absent from `before` is new — it has no floor to lower, so nothing to police here (the
 * onboarding gate in evaluateImageCoverage already refuses an undeclared platform at run time).
 */
export function floorRatchetProblems(before: FloorMap, after: FloorMap): string[] {
  const problems: string[] = [];

  for (const [platform, now] of Object.entries(after)) {
    const was = before[platform];
    if (!was) continue;                                   // newly declared platform

    const oldFloor = typeof was.floor_pct === 'number' ? was.floor_pct : null;
    const newFloor = typeof now.floor_pct === 'number' ? now.floor_pct : null;

    // Dropping a floor by deleting it entirely is the same act with extra steps.
    if (oldFloor != null && newFloor == null && !now.imageless_at_source) {
      problems.push(`${platform}: floor_pct ${oldFloor} was REMOVED. Deleting a floor is lowering it `
        + 'to zero; declare `rebased`, or declare imageless_at_source with a reason.');
      continue;
    }
    if (oldFloor == null || newFloor == null) continue;
    if (newFloor >= oldFloor) {
      // A rise needs no declaration — but a stale `rebased` claiming a move that did not happen is
      // a false record, and this file exists to keep the record true.
      const r = now.rebased;
      if (r && typeof r.to === 'number' && r.to !== newFloor) {
        problems.push(`${platform}: carries a rebased.to of ${r.to} but floor_pct is ${newFloor} — `
          + 'the declaration describes a floor this file does not have.');
      }
      continue;
    }

    // ── The floor FELL. Everything below is the price of that. ────────────────────────────────────
    const r = now.rebased;
    if (!r) {
      problems.push(`${platform}: floor_pct LOWERED ${oldFloor} -> ${newFloor} with no \`rebased\` `
        + 'declaration. This file\'s own rule is "never lower one to clear a red — a drop is an '
        + 'incident"; if the drop is genuinely adjudicated, say so in the entry where a reviewer '
        + 'reads it.');
      continue;
    }
    const missing = (['why', 'evidence'] as const).filter((k) => !r[k] || !String(r[k]).trim());
    if (missing.length) {
      problems.push(`${platform}: floor LOWERED ${oldFloor} -> ${newFloor} but its \`rebased\` `
        + `declaration is missing ${missing.join(' and ')}. A lowered floor without stated `
        + 'evidence is exactly the silenced alarm the rule forbids.');
    }
    if (r.from !== oldFloor) {
      problems.push(`${platform}: \`rebased.from\` says ${r.from} but the committed floor was `
        + `${oldFloor} — the declaration misstates what it is changing.`);
    }
    if (r.to !== newFloor) {
      problems.push(`${platform}: \`rebased.to\` says ${r.to} but floor_pct is ${newFloor} — `
        + 'the declaration misstates what it changed it to.');
    }
  }

  return problems;
}
