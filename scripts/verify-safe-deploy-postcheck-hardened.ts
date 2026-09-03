// Permanent regression test for the safe-deploy.sh post-deploy bundle check (2026-09-03, run
// https://github.com/6ttvrw4fmf-ctrl/ezhalah/actions/runs/33706257876). That run's Deploy step
// exited 1 — but not because the bundle check itself was wrong that day (the real cause was an
// unrelated duplicate-overload schema-drift hit, since resolved). It exposed two real weaknesses in
// the bundle check regardless: a WARNING-ONLY supabase.co check that could pass on a STALE bundle
// (never proved it was the NEW build), and a BLOCKING alias-propagation check whose expected-bundle
// hash was read with a single, unretried curl to the fresh deployment's own unique URL — which
// returned nothing in 69ms even on a perfectly healthy deploy, so it warned-and-skipped and never
// actually ran. Neither weakness was exercised together, so a genuinely broken deploy could still
// slip past one side.
//
// Fixed by merging both into ONE bounded (>= 240s), cache-busted, BLOCKING loop that proves BOTH
// properties before the baseline is allowed to advance: (1) dtg_alias_serves() recognizes the
// canonical alias's bundle as the just-deployed one (retried, not read once — with a PRE_BUNDLE-diff
// fallback if the deployment's own URL never yields a hash), and (2) that bundle's content includes
// supabase.co. This test asserts the SHAPE that keeps it that way, not literal wording, so it
// survives future rewording without going stale.
//
// Mutation-proven manually during authorship (see the PR body for the pass/fail/pass sequence):
// reverting any ONE of checks 1-5 below in isolation reproduces a ❌ on this file.
import { readFileSync } from 'node:fs';

let failures = 0;
const check = (name: string, cond: boolean, why?: string) => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}`);
  if (!cond) {
    failures++;
    if (why) console.error(`     ${why}`);
  }
};

const sh = readFileSync('scripts/safe-deploy.sh', 'utf8');
const workflow = readFileSync('.github/workflows/deploy-frontend.yml', 'utf8');

console.log('safe-deploy-postcheck-hardened: the post-deploy bundle check cannot be a single unretried read');

// 1. A bounded poll loop exists, with a window of at least 240s. The old 90s window is exactly what
//    timed out false on a healthy deploy in run 33706257876 — it must never shrink back below it.
const deadlineMatch = sh.match(/POLL_DEADLINE=\$\(\(\s*SECONDS\s*\+\s*(\d+)\s*\)\)/);
check('a post-deploy poll loop exists with POLL_DEADLINE = SECONDS + <n>', !!deadlineMatch);
check(
  'the poll window is at least 240s (was 90s when run 33706257876 false-failed)',
  !!deadlineMatch && Number(deadlineMatch[1]) >= 240,
  deadlineMatch ? `found ${deadlineMatch[1]}s` : 'no POLL_DEADLINE found',
);

// 2. The expected/actual bundle comparison happens INSIDE that loop (retried), not from a value
//    captured once before it. Reintroducing a single `curl "$DEPLOYED_URL"` outside any while-loop —
//    the exact regression — would still call dtg_alias_serves, so position (not mere presence) is
//    what this asserts.
const loopIdx = sh.search(/while\s*\[\s*"\$SECONDS"\s*-lt\s*"\$POLL_DEADLINE"\s*\]/);
// The real invocation, not a mention in prose/comments: `dtg_alias_serves "$X" "$Y"`.
const callMatch = sh.match(/(?:^|[^.\w])dtg_alias_serves\s+"\$\w+"\s+"\$\w+"/);
const dtgCallIdx = callMatch ? sh.indexOf(callMatch[0], 0) : -1;
check('safe-deploy.sh still CALLS dtg_alias_serves (the shared alias-match predicate)', dtgCallIdx !== -1);
check(
  'dtg_alias_serves is called INSIDE the poll loop, not from a value captured before it',
  loopIdx !== -1 && dtgCallIdx !== -1 && dtgCallIdx > loopIdx,
  `loop starts at offset ${loopIdx}, dtg_alias_serves call at ${dtgCallIdx}`,
);
// The value fed to that call must ALSO be (re)computed inside the loop — hoisting the `curl` that
// populates NEW_BUNDLE back out before the loop reintroduces the exact regression (a value captured
// once, before propagation had any chance to finish) while still calling dtg_alias_serves from
// inside the loop body, which the check above alone would not catch.
const preLoopText = loopIdx === -1 ? sh : sh.slice(0, loopIdx);
check(
  'NEW_BUNDLE is not populated by a curl read before the loop starts',
  !/NEW_BUNDLE="\$\(\s*curl\b/.test(preLoopText),
);

// 3 & 4. Isolate the bundle-verification block (from the loop to the live-search smoke test that
//    follows it) and check it is BLOCKING — an exit 1 reachable on failure, with the old
//    warning-only language gone — and that supabase.co is still asserted inside it. Never weaken
//    that assertion; it exists to catch a missing env var baked into the bundle (2026-07-10 P0).
const smokeIdx = sh.indexOf('live search smoke test', loopIdx);
const block = loopIdx !== -1 ? sh.slice(loopIdx, smokeIdx === -1 ? sh.length : smokeIdx) : '';
check('the bundle-verification block contains a blocking exit 1 on failure', /exit 1/.test(block));
check(
  'the bundle-verification block is no longer warning-only for the supabase.co assertion',
  block.length > 0 && !/is warning-only and does NOT fail the deploy/i.test(block),
);
// Must be an actual runtime assertion (`grep -q '...supabase.co...'`), not merely a mention in a
// comment or an echo'd message — a comment is not a code path.
check(
  'supabase.co is still asserted by a real grep -q, not just mentioned in prose',
  /grep\s+-q\s+["'][^"']*supabase\.co[^"']*["']/.test(block),
);

// 5. The approved-baseline advance sits structurally AFTER the bundle-verification block, so a
//    failure anywhere in it can never reach the advance code (offset check, not just presence — a
//    paste error could put the advance code earlier while both strings still exist in the file).
const baselineIdx = sh.indexOf('Recording $LOCAL as the new approved production baseline');
check(
  'the approved-baseline advance sits after the bundle-verification block',
  baselineIdx !== -1 && loopIdx !== -1 && baselineIdx > loopIdx,
);

// 6. Reporting stays accurate: deploy-frontend.yml's Report step must still derive SHIPPED from the
//    deploy having actually aliased (never from "the script exited 0"), and must render a message
//    that says production changed when a deploy shipped but a later check failed — the opposite
//    would misreport every post-check failure on an already-live deploy as "nothing happened".
check(
  "deploy-frontend.yml derives SHIPPED from an 'Aliased' marker in the log, not from exit status",
  /grep\s+-qE\s+'[^']*Aliased[^']*'\s+"\$LOG";\s*then\s+SHIPPED=yes/.test(workflow),
);
check(
  'deploy-frontend.yml distinguishes POST_FAILED (shipped, later check failed) from REFUSED_PRE (nothing shipped)',
  /POST_FAILED=yes/.test(workflow) && /REFUSED_PRE=yes/.test(workflow),
);
check(
  'deploy-frontend.yml renders "Production WAS changed" when SHIPPED=yes and POST_FAILED=yes',
  /SHIPPED"\s*=\s*"yes"\s*\]\s*&&\s*\[\s*"\$POST_FAILED"\s*=\s*"yes"/.test(workflow) &&
    /Production WAS changed\. It is NOT untouched\./.test(workflow),
);

if (failures > 0) {
  console.error(`\n❌ ${failures} check(s) failed — a post-deploy bundle failure could go unnoticed or misreported again.`);
  process.exit(1);
}
console.log('\n✓ safe-deploy-postcheck-hardened: passed.');
