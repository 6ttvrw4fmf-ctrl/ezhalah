// The alert DELIVERY contract, in one place (Senior Production Engineer, 2026-08-26).
//
// WHY THIS FILE EXISTS. Three components have to agree on which alert severities the delivery
// channel is contracted to deliver:
//
//   1. .github/workflows/alert-dispatch.yml -- the deliverer (its PostgREST severity filter)
//   2. public.mon_detect_alert_delivery()   -- the barrier that watches the deliverer
//   3. this file                            -- the canonical statement both are checked against
//
// On 2026-08-26 they did not agree, and nothing noticed for 41 days. alert-dispatch.yml selected
// `severity=in.(P1,P2)`; P0 was simply not in the list. Every P0 alert ever raised -- 53 of them
// since 2026-07-16, all of kind silent_scraper_death -- was dropped on the floor. The barrier that
// was supposed to catch this only asked "is a destination CONFIGURED?", which had been true since
// 2026-08-11, so it read green throughout. The only P0-related thing that ever reached GitHub was
// the P2 meta-alert `unresolvable_alert_kind:silent_scraper_death` -- the alert ABOUT the alert
// got delivered while the alert itself did not.
//
// scripts/verify-alert-delivery-coverage.ts (wired into `npm test`) fails if any of the three
// drifts from the other two. That check is the reason a future edit to the workflow's filter, or
// to the detector's severity array, cannot silently re-open the blackout.

/**
 * Severities the delivery channel MUST deliver, in ascending-id order.
 *
 * P3 is deliberately absent: it is informational and is not delivered by design (3 raised ever,
 * as of 2026-08-26, none delivered). That exclusion is intentional and must stay symmetric --
 * mon_detect_alert_delivery() must not raise on undelivered P3 rows, or it would alert forever on
 * rows nothing is contracted to deliver.
 */
export const DELIVERED_SEVERITIES = ['P0', 'P1', 'P2'] as const;

/**
 * Grace period before an undelivered, delivery-eligible alert counts as a delivery failure.
 * alert-dispatch.yml runs at :09/:39, so 60 minutes is two consecutive missed runs -- one
 * transient GitHub Actions failure must not raise.
 */
export const UNDELIVERED_GRACE_MINUTES = 60;

/** The dedup keys mon_detect_alert_delivery() owns. Both must self-clear via mon_resolve_key. */
export const ALERT_DELIVERY_DEDUP_KEYS = [
  'alert_delivery_unconfigured',
  'alert_delivery_undelivered',
] as const;

/**
 * Extract the severity set from alert-dispatch.yml's PostgREST filter.
 *
 * The filter is URL-encoded in the workflow (`severity=in.%28P0,P1,P2%29`), because `(` and `)`
 * inside a shell-interpolated URL are escaped. Accept both encoded and literal parens so a future
 * hand-edit that drops the encoding is still parsed rather than silently reported as "absent" --
 * a parser that returns null on a real filter would make this whole barrier vacuous.
 *
 * COMMENT LINES ARE STRIPPED FIRST, and that is load-bearing rather than tidiness. The workflow's
 * own header documents the 2026-08-26 bug by quoting the filter it used to have,
 * `severity=in.(P1,P2)`. A naive first-match parser reads that prose instead of the executable
 * line and reports the file as still broken -- which is precisely what happened when this barrier
 * was first run. The same trap works in reverse: prose quoting the CORRECT set would make a
 * genuinely broken filter look fine. Only the executable text may be parsed.
 *
 * Returns null when no severity filter is present at all, which the verifier treats as a failure
 * (an unfiltered dispatcher is a different bug, not a pass).
 */
export function parseWorkflowSeverityFilter(yaml: string): string[] | null {
  const executable = yaml
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  const m = executable.match(/severity=in\.(?:%28|\()([^%)]*)(?:%29|\))/);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * How many severity filters appear in the workflow's EXECUTABLE text. Must be exactly 1: two
 * filters means one of them is unchecked by parseWorkflowSeverityFilter (which reads the first),
 * so a second dispatch path could quietly drop a severity again.
 */
export function countWorkflowSeverityFilters(yaml: string): number {
  const executable = yaml
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  return (executable.match(/severity=in\.(?:%28|\()/g) ?? []).length;
}

/**
 * Extract the severity array literal from the detector's SQL body, i.e. the
 * `c_delivered text[] := array['P0','P1','P2'];` declaration.
 *
 * Returns null when the declaration is absent -- again treated as a failure by the verifier,
 * because a detector with no severity scope cannot be checked for agreement.
 */
export function parseDetectorSeverities(sql: string): string[] | null {
  const m = sql.match(/c_delivered\s+text\[\]\s*:=\s*array\[([^\]]*)\]/i);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter((s) => s.length > 0);
}

/** True when two severity lists denote the same set (order-insensitive, duplicate-insensitive). */
export function sameSeveritySet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const v of sa) if (!sb.has(v)) return false;
  return true;
}
