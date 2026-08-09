// TRUTHFULNESS TRIPWIRE — no user-facing claim we cannot prove. (owner-approved 2026-08-06)
//
// WHY THIS EXISTS
// Two false statements shipped to real users and sat in production:
//   1. «Ezhalah operates under REGA FAL license number XXXXXXXX» (about.tsx) and «We operate under FAL
//      license No. XXXXXXXX» (InfoModal.tsx) — Ezhalah holds NO REGA FAL licence, and the number was a
//      literal placeholder. Claiming a regulator's licence you do not hold is materially worse than being
//      unlicensed: unlicensed is a paperwork gap, a false licence claim is a misrepresentation.
//   2. «All user data is stored on Saudi servers» / «servers inside the Kingdom» — production data lives in
//      Supabase region ap-northeast-1 (Tokyo). Verified live via the Supabase project API on 2026-08-06.
// Both were removed. This test makes their return a BUILD FAILURE rather than a discovery.
//
// THE RULE IT ENFORCES
// A user-facing string may not assert (a) that Ezhalah holds a licence, (b) a placeholder licence number,
// or (c) a data-residency location — unless the claim is TRUE and the allowlist below is updated in the
// same, deliberate commit that makes it true. Editing this file is the checkpoint where someone must ask
// "can we prove this?".
//
//   node --experimental-strip-types scripts/verify-no-unsupported-claims.ts   (wired into `npm test`)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

let failed = 0;
const fail = (msg: string) => { failed++; console.log(`FAIL  ${msg}`); };
const pass = (msg: string) => console.log(`PASS  ${msg}`);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const files = walk(SRC);

// ── 1. Placeholder licence numbers in any user-facing string ─────────────────────────────────────
// A run of X's standing in for a licence/registration number. (auth.tsx's "+966 5XXXXXXXX" is a phone
// FORMAT HINT inside a code comment, not a claim — excluded by requiring licence context on the line.)
const PLACEHOLDER = /X{6,}/;
const LICENCE_CTX = /licen[cs]e|ترخيص|رخصة|FAL|فال|سجل تجاري|CR\b/i;
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (PLACEHOLDER.test(line) && LICENCE_CTX.test(line)) {
      fail(`placeholder licence number in ${f.replace(ROOT + '/', '')}:${i + 1} — ${line.trim().slice(0, 100)}`);
    }
  });
}
if (!failed) pass('no placeholder licence numbers in any user-facing string');

// ── 2. Ezhalah asserting it HOLDS a licence ──────────────────────────────────────────────────────
// Matches "Ezhalah operates under … licence", "we operate under FAL", "نعمل بموجب ترخيص",
// "تعمل إزهله بموجب ترخيص". Add to ALLOWED_LICENCE_CLAIMS only when the licence genuinely exists.
const ALLOWED_LICENCE_CLAIMS: string[] = [
  // (empty — Ezhalah holds no licence today. Adding a line here is a deliberate, provable act.)
];
const HOLDS_LICENCE = [
  /(?:we|ezhalah)\s+(?:operate|operates)\s+under[^.\n]{0,40}licen[cs]e/i,
  /نعمل\s+بموجب\s+ترخيص/,
  /تعمل\s+إزهله\s+بموجب\s+ترخيص/,
  /(?:holds?|issued to)\s+(?:a\s+)?(?:REGA\s+)?FAL\s+licen[cs]e/i,
];
let claimHits = 0;
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (line.trimStart().startsWith('//')) return;                 // comments explain, they don't claim
    if (ALLOWED_LICENCE_CLAIMS.some((a) => line.includes(a))) return;
    if (HOLDS_LICENCE.some((re) => re.test(line))) {
      claimHits++;
      fail(`unproven licence claim in ${f.replace(ROOT + '/', '')}:${i + 1} — ${line.trim().slice(0, 120)}`);
    }
  });
}
if (!claimHits) pass('no string asserts that Ezhalah holds a licence it does not hold');

// ── 3. Data-residency claims ─────────────────────────────────────────────────────────────────────
// Production is Supabase ap-northeast-1 (Tokyo). Any claim that user data lives in the Kingdom is false
// until that changes AND this allowlist is updated in the same commit.
const ALLOWED_RESIDENCY_CLAIMS: string[] = [];
const RESIDENCY = [
  /stored?\s+on\s+(?:saudi|ksa)\s+servers/i,
  /servers?\s+(?:inside|within)\s+(?:the\s+)?(?:kingdom|saudi)/i,
  /خوادم\s+(?:داخل\s+)?(?:المملكة|السعودية)/,
  /خوادم\s+سعودية/,
  /data\s+(?:is\s+)?(?:stored|hosted)\s+in\s+saudi/i,
];
let resHits = 0;
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (line.trimStart().startsWith('//')) return;
    if (ALLOWED_RESIDENCY_CLAIMS.some((a) => line.includes(a))) return;
    if (RESIDENCY.some((re) => re.test(line))) {
      resHits++;
      fail(`unproven data-residency claim in ${f.replace(ROOT + '/', '')}:${i + 1} — ${line.trim().slice(0, 120)}`);
    }
  });
}
if (!resHits) pass('no string claims user data is stored inside the Kingdom (prod is ap-northeast-1)');

// ── 4. The honest replacements are actually present (guards against silent deletion) ─────────────
const about = readFileSync(join(SRC, 'app/about.tsx'), 'utf8');
const info = readFileSync(join(SRC, 'components/InfoModal.tsx'), 'utf8');
const hasProvenance = (s: string) => /Listing licensing/.test(s) && /does not issue/i.test(s);
if (hasProvenance(about) && hasProvenance(info)) {
  pass('both screens carry the truthful listing-provenance statement instead of a licence claim');
} else {
  fail('the truthful listing-provenance statement is missing from about.tsx and/or InfoModal.tsx');
}

console.log(failed === 0
  ? '\n✓ no unsupported user-facing claims'
  : `\n✗ ${failed} unsupported claim(s) — a user-facing statement asserts something we cannot prove`);
process.exit(failed === 0 ? 0 : 1);
