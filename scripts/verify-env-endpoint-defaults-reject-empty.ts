// AN UNSET SECRET IS THE EMPTY STRING, AND `??` HONOURS IT.
//
// WHY THIS EXISTS (2026-09-11, routine #10). `scripts/verify-ui-controls-have-predicates.ts` resolved
// its endpoint as `process.env.EZHALAH_SUPABASE_URL ?? 'https://…supabase.co'`, while the canonical
// resolver `scripts/lib/public-supabase.ts` uses `||` for the same value. The divergence is not
// stylistic. In GitHub Actions an unset or empty secret expands to the EMPTY STRING, never to
// `undefined` — so `??` does not fall back. The check would then aim every request at '' while
// reading as fully configured, and `scripts/af-live-truth-deploy-gate.ts` carried the same shape on
// `GITHUB_API_URL`. Both are fixed; this barrier is why neither can come back.
//
// It is a SOURCE-TEXT reader by necessity — the defect is a choice of operator at a module-scope
// constant, which is the one thing execution cannot observe once the module has loaded. Its predicate
// is therefore kept pure and is mutation-proven in both directions below, including the negative
// controls that stop it going vacuously red: `?? ''` and `?? 0` are legitimate (falling back to an
// empty value is the intent), and only a default that is a real ENDPOINT is a defect.
//
// This is the routine-#10 class in AGENTS.md's own words, one layer out: a value that failed to
// arrive being treated as a value that did. SOURCE IS TRUTH — silent→NULL, never unknown→NO.

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCommentsAndStrings } from './lib/stripComments.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The predicate, pure so a proof can hand it a broken file.
 *
 * Flags `process.env.X ?? <non-empty string literal>` — a nullish default that an empty env var
 * silently defeats. A `||` default is correct. A default that is itself empty ('' or "") is fine:
 * there is nothing to defeat.
 */
export function nullishEndpointDefaults(files: { name: string; src: string }[]): string[] {
  const BAD = /process\.env\.([A-Z0-9_]+)\s*\?\?\s*(['"`])([^'"`]*)\2/g;
  const problems: string[] = [];
  for (const { name, src } of files) {
    // Read CODE, not the anti-pattern this file quotes in its own mutation proofs. Caught on the
    // first run: every proof below is a string literal containing the exact defect, and an
    // un-stripped reader condemned this barrier for describing what it forbids.
    //
    // The match must run on the ORIGINAL source — the stripper blanks string bodies, which is
    // precisely the default value being judged — so codeness is asked as a SECOND question: does
    // `process.env.<VAR> ??` still survive the strip? If the expression were nested inside an outer
    // string (a proof input, a doc example), that outer quote opens first and takes `process.env`
    // with it, so nothing survives and nothing is flagged. In real code the default blanks to '' and
    // `process.env.X ??` remains. The reader is the SHARED scripts/lib/stripComments.ts one —
    // deliberately not a private copy (PART 1.6).
    const code = stripCommentsAndStrings(src);
    for (const m of src.matchAll(BAD)) {
      const [, envVar, , fallback] = m;
      if (fallback.trim() === '') continue;                     // '' default: nothing to defeat
      if (!new RegExp(`process\\.env\\.${envVar}\\s*\\?\\?`).test(code)) continue;   // not code
      // Locate the real line in the ORIGINAL source: the stripper collapses multi-line templates, so
      // an offset into the stripped text is not a line number in the file a human opens.
      const at = src.indexOf(`process.env.${envVar}`);
      const line = at < 0 ? 0 : src.slice(0, at).split('\n').length;
      problems.push(
        `${name}:${line} resolves ${envVar} with \`??\` and a non-empty default ` +
        `(${JSON.stringify(fallback).slice(0, 60)}) — an unset secret is '' in CI, which \`??\` ` +
        `honours. Use \`||\`, as scripts/lib/public-supabase.ts does.`,
      );
    }
  }
  return problems;
}

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nAn env-var endpoint default must reject the empty string, not honour it\n');

const names = readdirSync(join(root, 'scripts')).filter((f) => /\.(ts|mjs|cjs)$/.test(f));
check('the scripts directory was readable and non-empty', names.length > 0,
  'an empty corpus would make this check vacuously green — it fails closed instead');

const files = names.map((name) => ({ name, src: readFileSync(join(root, 'scripts', name), 'utf8') }));
const problems = nullishEndpointDefaults(files);
check(`no \`??\` endpoint default across ${files.length} scripts`, problems.length === 0,
  problems.join('\n      '));

// ── mutation proofs ─────────────────────────────────────────────────────────────────────────────
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};
const F = (src: string) => [{ name: 'f.ts', src }];

mustCatch('the defect verbatim: the endpoint default this barrier was written for',
  nullishEndpointDefaults(F("const REG_URL = process.env.EZHALAH_SUPABASE_URL ?? 'https://x.supabase.co';")).length === 1);
mustCatch('the sibling found in the same sweep: a GitHub API base defaulted with `??`',
  nullishEndpointDefaults(F('const API = process.env.GITHUB_API_URL ?? "https://api.github.com";')).length === 1);
mustCatch('the same defect written with a TEMPLATE literal default',
  nullishEndpointDefaults(F('const U = process.env.SOME_URL ?? `https://fallback.test`;')).length === 1);

// Negative controls — a check red for everything protects nothing.
mustCatch('…while the CORRECT `||` form is NOT flagged (this is the repair, and it must pass)',
  nullishEndpointDefaults(F("const REG_URL = process.env.EZHALAH_SUPABASE_URL || 'https://x.supabase.co';")).length === 0);
mustCatch('…and an intentionally EMPTY default is NOT flagged — there is nothing for \'\' to defeat',
  nullishEndpointDefaults(F("const EVENT = process.env.GATE_EVENT_NAME ?? '';")).length === 0);
mustCatch('…and the anti-pattern DESCRIBED in a comment is not committed by describing it',
  nullishEndpointDefaults(F("  // never write process.env.X ?? 'https://y.test' here\nconst a = 1;")).length === 0);
mustCatch('…and an unrelated `??` on a non-env value is not flagged',
  nullishEndpointDefaults(F("const tier = f.filter_tier ?? 'backend';")).length === 0);
mustCatch('an empty corpus yielding no findings — which is why the directory read is checked separately',
  nullishEndpointDefaults([]).length === 0);

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
if (failures) { console.error(`\n✗ ${failures} check(s) FAILED\n`); process.exit(1); }
console.log('\n✓ no check honours an empty secret as an endpoint\n');
