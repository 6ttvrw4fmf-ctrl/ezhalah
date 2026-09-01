// Barrier: A JOB THAT SPENDS REAL MONEY MUST NOT RUN AT PEAK PRICE.
//
// DeepSeek bills PEAK at exactly double off-peak, in two UTC windows on weekdays:
//   01:00-04:00  and  06:00-10:00
// Everything else (00:00-01:00, 04:00-06:00, 10:00-24:00, and all weekend) is half price.
//
// WHY THIS EXISTS. Reconciling our telemetry against the DeepSeek dashboard on 2026-08-31
// ($0.21 / 568 requests / 30 days) showed the account's real cost-per-request landing ~20% ABOVE the
// blended model. The cause was not the product: our own nightly automation was scheduled at 03:00
// and 03:30 UTC, squarely inside peak, so every test token billed at double. Same tests, same
// coverage, half the price — the only thing that had to change was the clock.
//
// This pins that, because a cron is exactly the kind of line that gets nudged back later "to space
// the jobs out" with nobody remembering it costs money.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WF = '.github/workflows';

// A workflow "spends" only if it actually reaches the live model. Be EXACT here: a first draft
// matched any `playwright test` and flagged selector-e2e.yml, which runs one spec that never
// submits a search and opts into nothing — a false positive that would have trained everyone to
// ignore this barrier.
//
// The third marker is the load-bearing one and it is self-maintaining: EZHALAH_ALLOW_PAID_AI is the
// explicit opt-in gate every paid e2e test is skipped behind, so ANY future workflow that turns paid
// AI on must declare it here and is audited automatically.
const PAID_MARKERS = [
  'check_audit_invariants',        // the nightly live-agent regression (2 real classifications)
  'verify-af-agent-cta-live',      // AF entry-path journeys through the real agent
  'EZHALAH_ALLOW_PAID_AI',         // the opt-in gate for the paid AI-mode e2e tests
];

const inPeak = (h: number) => (h >= 1 && h < 4) || (h >= 6 && h < 10);

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

const files = readdirSync(WF).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
let audited = 0;

for (const f of files) {
  const src = readFileSync(join(WF, f), 'utf8');
  const spends = PAID_MARKERS.some((m) => src.includes(m));
  if (!spends) continue;
  audited++;

  // every `- cron: 'M H * * *'` in the file, comments stripped so a documented example cannot fail it
  const crons = [...src.split('\n')
    .map((l) => l.split('#')[0])
    .join('\n')
    .matchAll(/cron:\s*['"]\s*(\S+)\s+(\S+)\s+/g)];

  for (const m of crons) {
    const hourField = m[2];
    // Only simple hour fields are asserted; a list/range/step is flagged for a human rather than
    // silently passed, because "*/2" genuinely does hit peak.
    if (/^\d+$/.test(hourField)) {
      const h = Number(hourField);
      check(`${f}: paid job scheduled at ${String(h).padStart(2, '0')}:xx UTC is off-peak`,
        !inPeak(h), 'peak is 01:00-04:00 and 06:00-10:00 UTC — tokens cost DOUBLE there');
    } else {
      check(`${f}: paid job cron hour "${hourField}" is a simple hour a human can verify`,
        false, 'a range/list/step may land in peak; pin an explicit off-peak hour');
    }
  }
}

check('the barrier actually found the paid-AI workflows to audit', audited >= 3,
  `audited ${audited}; if this drops, a marker in PAID_MARKERS went stale and this check is blind`);

console.log(failures === 0
  ? `\n✓ all ${audited} paid-AI workflows run off-peak (half price for identical coverage)`
  : `\n✗ ${failures} paid-AI scheduling problem(s)`);
process.exit(failures === 0 ? 0 : 1);
