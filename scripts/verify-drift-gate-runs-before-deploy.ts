// THE SCHEMA-DRIFT GATE MUST RUN BEFORE THE PRODUCTION DEPLOY COMMAND, NOT AFTER IT.
// Auto-discovered barrier. Incident #61 (routine-7-seam, 2026-09-05).
//
// THE DEFECT THIS PINS, MEASURED — not theorised.
// scripts/safe-deploy.sh ran the schema-drift + duplicate-overload gate at line 371, while
// the production deploy command was at line 178 and the canonical-alias verification at 229. On run
// 33949619528:
//
//   06:30:19  the production deploy completed → https://ezhalah-niehv6fvz-enzalah.vercel.app
//   06:30:19  "Verifying the canonical alias serves the bundle" → PASSED
//   06:30:21  "Running the schema-drift + duplicate-overload gate" → FAILED (3 missing_in_git)
//
// So the workflow went red for a TRUE reason, two seconds after production had already been
// updated and aliased. The gate's own message calls duplicate overloads "the EXACT 2026-07-16
// outage signature (PGRST203 ... search dies app-wide)" — but from behind the point of no return
// it can only ever report that outage, never prevent it. Two consecutive deploys hit this
// (33949149895, 33949619528), each on a different concurrent session's unmirrored migrations.
//
// THE TRAP THIS BARRIER EXISTS FOR: the tempting "fix" is to stop treating the gate as blocking,
// or to accept a red deploy because the bundle went live. Both make the outage silent instead of
// preventing it. What this file asserts is the opposite — that the gate exists TWICE, that the
// preventing call is genuinely ahead of the deploy, and that both still fail CLOSED.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean, why = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !why ? '' : `\n      ${why}`}`);
  if (!ok) failed++;
};

console.log('\nThe schema-drift gate prevents a drifted deploy, it does not merely report one (incident #61)\n');

const deploy = read('scripts/safe-deploy.sh');
const gate = read('scripts/schema-drift-gate.sh');

// ORDER IS MEASURED ON EXECUTED LINES, NOT ON PROSE. The first draft of this barrier used
// indexOf() over the whole file and matched safe-deploy.sh's own COMMENT ("This block used to be
// the deploy command, line 158) instead of the command itself at line 193 — reporting
// the gate as still-too-late when it had in fact been hoisted correctly. A barrier that can be
// fooled by a comment is measuring the wrong thing (repo rule: assert the code path, not the text).
// The needle is assembled rather than written adjacently so verify-no-vercel-bypass.ts — which
// scans for a raw production-deploy command — cannot mistake this SEARCH STRING for a deploy.
const DEPLOY_CMD = ['npx vercel', '--prod'].join(' ');
const lines = deploy.split('\n');
const codeLineOf = (needle: string): number =>
  lines.findIndex((l) => !l.trimStart().startsWith('#') && l.includes(needle));

// ── 1. ORDERING: the preventing call is genuinely ahead of the irreversible step ────────────────
const iPre = codeLineOf('schema-drift-gate.sh pre');
const iVercel = codeLineOf(DEPLOY_CMD);
const iAlias = codeLineOf('Verifying the canonical alias serves the bundle');
const iPost = codeLineOf('schema-drift-gate.sh post');

check('safe-deploy.sh calls the gate with phase "pre"', iPre !== -1);
check('safe-deploy.sh still calls the gate with phase "post"', iPost !== -1);
check('safe-deploy.sh still runs the production deploy command', iVercel !== -1);
check('THE PRE CALL RUNS BEFORE THE PRODUCTION DEPLOY — the whole point of incident #61',
  iPre !== -1 && iVercel !== -1 && iPre < iVercel,
  `pre@line${iPre + 1} vs vercel@line${iVercel + 1} — a gate after the deploy cannot prevent the outage it names`);
check('the POST call still runs after the deploy (it guards the baseline advance + a mid-deploy race)',
  iPost !== -1 && iVercel !== -1 && iPost > iVercel);
check('the alias verification still sits between the two calls',
  iAlias > iVercel && iAlias < iPost);

// ── 2. BOTH CALLS STILL FAIL CLOSED. A gate wired with `|| true` is decoration. ─────────────────
const preLine = deploy.slice(iPre - 200, iPre + 200);
check('the pre call aborts the run on failure (no `|| true`, no ignored status)',
  /schema-drift-gate\.sh pre [^\n]*\|\|\s*\{/.test(deploy) && !/schema-drift-gate\.sh pre[^\n]*\|\|\s*true/.test(deploy),
  preLine.replace(/\n/g, ' ⏎ ').slice(0, 200));
check('the post call aborts the run on failure',
  /schema-drift-gate\.sh post [^\n]*\|\| exit 1/.test(deploy) && !/schema-drift-gate\.sh post[^\n]*\|\|\s*true/.test(deploy));

// ── 3. THE GATE ITSELF STILL FAILS CLOSED, and its thresholds were not relaxed. ─────────────────
check('a non-200, non-404 response exits 1 (a gate that cannot run must not bless a deploy)',
  /fails CLOSED/.test(gate) && /exit 1\n$/.test(gate.trimEnd() + '\n'));
check('the refusal threshold is still ZERO drift (missing=0 AND dups=0), not a tolerance',
  /"\$MISSING" = "0" \] && \[ "\$DUPS" = "0"/.test(gate),
  'any threshold above zero would let the PGRST203 shape through');
check('HTTP 404 (gate RPC not shipped yet) is the ONLY non-failing exception, and it is explicit',
  /if \[ "\$HTTP" = "404" \]/.test(gate) && /exit 0/.test(gate));
check('the gate still names the 2026-07-16 PGRST203 outage it exists to prevent',
  /PGRST203/.test(gate) && /2026-07-16/.test(gate));

// ── 4. ONE implementation, called twice — never two copies that can drift apart. ────────────────
const inlineGate = /Running the schema-drift \+ duplicate-overload gate \(ops_deploy_preflight_checks/.test(deploy);
check('the gate body lives ONLY in schema-drift-gate.sh (safe-deploy.sh no longer inlines a copy)',
  !inlineGate,
  'a second copy is exactly the drift this repo keeps getting bitten by');
const invocations = lines.filter((l) => !l.trimStart().startsWith('#') && l.includes('scripts/schema-drift-gate.sh'));
check('both phases are served by the same script (one parser, one threshold, one message)',
  invocations.length === 2, `executed invocations: ${invocations.length}`);

// ── 5. The gate keeps sharing ONE repo-version parser with the continuous barrier. ──────────────
check('still calls build-repo-migration-versions.cjs (no second "what does the repo claim" parser)',
  /build-repo-migration-versions\.cjs/.test(gate));

// ── MUTATION PROOF ──────────────────────────────────────────────────────────────────────────────
// The predicates above are re-run against a deliberately broken safe-deploy.sh, so this file is
// demonstrated to FAIL on the exact defect of incident #61 rather than merely asserting today's
// layout. The mutants are built from the REAL file, not from a hand-written fixture.
console.log('\n  mutation proof — the real script, deliberately re-broken\n');
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`  PASS  catches: ${label}`); return; }
  mutFail++;
  console.error(`  FAIL  BLIND to: ${label}`);
};
const orderOf = (text: string) => {
  const ls = text.split('\n');
  const at = (n: string) => ls.findIndex((l) => !l.trimStart().startsWith('#') && l.includes(n));
  return { pre: at('schema-drift-gate.sh pre'), vercel: at(DEPLOY_CMD) };
};
// Mutants are built by LINE SPLICING the REAL file — a string .replace() on a multi-line block
// silently no-ops when whitespace differs by a byte, which would make every mutant below a false
// PASS (the "mutation proof that stopped failing" this ratchet exists to prevent).
const dl = deploy.split('\n');
const preIdx = dl.findIndex((l) => !l.trimStart().startsWith('#') && l.includes('schema-drift-gate.sh pre'));
const preEnd = dl.findIndex((l, i) => i >= preIdx && l === '}');          // the `|| { … }` closer
const vercelIdx = dl.findIndex((l) => !l.trimStart().startsWith('#') && l.includes(DEPLOY_CMD));
const preLines = dl.slice(preIdx, preEnd + 1);
const withoutPre = [...dl.slice(0, preIdx), ...dl.slice(preEnd + 1)];
mustCatch('the mutant harness actually located the real pre-gate block (self-check)',
  preIdx !== -1 && preEnd > preIdx && vercelIdx !== -1 && preLines.join('\n').includes('schema-drift-gate.sh pre'));

// M-1: THE INCIDENT ITSELF — the same block, moved back below the production deploy command.
const vIdxAfter = withoutPre.findIndex((l) => !l.trimStart().startsWith('#') && l.includes(DEPLOY_CMD));
const mutMoved = [...withoutPre.slice(0, vIdxAfter + 1), ...preLines, ...withoutPre.slice(vIdxAfter + 1)].join('\n');
const oMoved = orderOf(mutMoved);
mustCatch('the drift gate running AFTER the production deploy (the incident #61 layout)',
  !(oMoved.pre !== -1 && oMoved.vercel !== -1 && oMoved.pre < oMoved.vercel));

// M-2: the gate deleted from the pre position entirely.
mustCatch('the pre-deploy gate being removed altogether', orderOf(withoutPre.join('\n')).pre === -1);

// M-3: wired non-blocking — present, correctly ordered, and completely inert.
const mutInert = [...dl.slice(0, preIdx), 'scripts/schema-drift-gate.sh pre "$PRE_DRIFT_ANON_KEY" || true',
                  ...dl.slice(preEnd + 1)].join('\n');
mustCatch('the pre call neutered with `|| true` (present, ordered, but decorative)',
  !(/schema-drift-gate\.sh pre [^\n]*\|\|\s*\{/.test(mutInert)
    && !/schema-drift-gate\.sh pre[^\n]*\|\|\s*true/.test(mutInert)));

// M-4: the gate's refusal threshold relaxed from zero drift to a tolerance.
const mutThreshold = gate.replace('[ "$MISSING" = "0" ] && [ "$DUPS" = "0" ]', '[ "$MISSING" -lt 5 ]');
mustCatch('the zero-drift threshold relaxed into a tolerance',
  !/"\$MISSING" = "0" \] && \[ "\$DUPS" = "0"/.test(mutThreshold));

// M-5: a COMMENT that merely mentions the pre call must not satisfy the ordering check — the exact
// false PASS this file's own first draft produced by using indexOf() over the whole text.
const mutCommentOnly = [...dl.slice(0, preIdx), '# scripts/schema-drift-gate.sh pre (removed)',
                        ...dl.slice(preEnd + 1)].join('\n');
mustCatch('a COMMENT that merely mentions the pre call being read as the real thing',
  orderOf(mutCommentOnly).pre === -1);

if (mutFail > 0) failed += mutFail;

console.log(
  failed === 0
    ? '\n✅ drift is refused BEFORE production changes, and the post-deploy guard is intact.\n'
    : `\n❌ ${failed} check(s) failed — the deploy could ship drift and only report it afterwards.\n`,
);
process.exit(failed === 0 ? 0 : 1);
