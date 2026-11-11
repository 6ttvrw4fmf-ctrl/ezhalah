// The AF / Trending live checks can READ a long PostgREST reply (2026-11-11, owner launch audit: «fix every checking robot»).
//
// PostgREST echoes the whole query back in its Content-Location reply header. A broad oracle read — every residential and
// commercial table and type, ~15 KB of URL — makes that header overflow Node's default 16 KB limit, and fetch throws
// «fetch failed» (cause UND_ERR_HEADERS_OVERFLOW) although the database answered 200. Every failed run of
// af-live-truth-check.yml from 2026-11-04 to 11-10 ended «search_listings_ar count unreachable — fetch failed» on Trending
// scope «3 COMMERCIAL (broad)»: a harness defect reading as a product failure, and it kept af_live_check_failed open.
// Measured 2026-11-11 against production: a 15,601-char URL throws at the default and answers 200 (header 16,755 bytes)
// at --max-http-header-size=65536; a 26,001-char URL gets an honest HTTP 400 from the gateway either way.
//
// This barrier pins the workflow-level NODE_OPTIONS that lifts the limit, and that it reaches every job (workflow env,
// not one step's), and proves it would fail if the line were removed or set back below the measured header.
//   node --experimental-strip-types scripts/verify-live-checks-read-long-postgrest-replies.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const WF = '.github/workflows/af-live-truth-check.yml';
const MEASURED_HEADER = 16_755;   // the Content-Location the broad oracle read produced, bytes

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
  if (!ok) failed++;
};

/** The --max-http-header-size the workflow-level env gives every job, or null. */
export function workflowHeaderLimit(yaml: string): number | null {
  const top = yaml.split(/\njobs:\s*\n/)[0] ?? '';
  const env = top.match(/\nenv:\s*\n((?:[ \t]+.*\n?|\s*\n)*)/);
  if (!env) return null;
  const line = env[1].split('\n').find((l) => /^\s{2}NODE_OPTIONS:/.test(l));
  const m = line?.match(/--max-http-header-size[= ](\d+)/);
  return m ? Number(m[1]) : null;
}
const enough = (yaml: string) => (workflowHeaderLimit(yaml) ?? 0) > MEASURED_HEADER;

const real = readFileSync(join(ROOT, WF), 'utf8');
check(`${WF} gives every job a header limit above the measured ${MEASURED_HEADER}-byte reply`, enough(real),
  `found ${workflowHeaderLimit(real)} — without it the broad Trending oracle read throws «fetch failed» on a 200`);

// Mutations: each must be caught.
const mutants: [string, string][] = [
  ['the NODE_OPTIONS line removed', real.replace(/\n\s{2}NODE_OPTIONS:.*\n/, '\n')],
  ['the limit set back to the 16 KB default', real.replace(/--max-http-header-size=\d+/, '--max-http-header-size=16384')],
  ['the setting moved into one job only (not workflow env)', real.replace(/\n\s{2}NODE_OPTIONS:.*\n/, '\n').replace(/\njobs:\s*\n/, '\njobs:\n  # NODE_OPTIONS: --max-http-header-size=65536\n')],
];
const mustCatch = (what: string, caught: boolean) => check(`MUTATION caught: ${what}`, caught);
for (const [what, src] of mutants) mustCatch(what, src !== real && !enough(src));
check('…and a workflow that has it is accepted (not simply always-false)', enough('name: x\nenv:\n  NODE_OPTIONS: --max-http-header-size=65536\n\njobs:\n  a:\n'));

console.log(failed ? `\n❌ verify-live-checks-read-long-postgrest-replies: ${failed} check(s) failed.\n` : '\n✅ verify-live-checks-read-long-postgrest-replies: the live checks can read a long PostgREST reply.\n');
process.exit(failed ? 1 : 0);
