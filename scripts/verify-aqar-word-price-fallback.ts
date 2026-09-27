// Automated guard — aqar_parse must keep its Arabic WORD-price fallback (2026-07-29).
//
// THE FIX THIS PINS
// aqar broker posts often state the price in words («المطلوب 380 الف», «مليون و 150 الف», «3.5 مليون»)
// with no §/ريال/﷼ machine-price. Before the fallback, those listings showed NO price (and the earlier
// enrich fallback grabbed a broker phone/ID as the "price"). aqar_word_price() recovers the stated price;
// aqar_parse() calls it ONLY when no §/ريال/﷼ price was found, so a real machine-price is never overridden.
//
// WHY A MIGRATION-TEXT TEST
// The functions live only in the live database; a future "full-body-replace" of aqar_parse (the documented
// hazard) could paste a stale body back and silently delete the fallback — listings would silently lose
// their price again. This verifier replays the migration directory the way Postgres would (last definition
// wins) and fails if the winning aqar_parse no longer calls aqar_word_price. Offline (repo files only).
//
// Run: node --experimental-strip-types scripts/verify-aqar-word-price-fallback.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeOnly } from './lib/rpcReplay.ts';

let failed = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass || !detail ? '' : `  → ${detail}`}`);
};

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'supabase', 'migrations');
const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

function lastBodyOf(name: string): { file: string; body: string } | null {
  let found: { file: string; body: string } | null = null;
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    const header = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = header.exec(sql)) !== null) {
      const rest = sql.slice(m.index);
      // BLIND-GUARD REPAIR, 2026-09-24 (routine-10-barrier). This used to match the two tags it
      // happened to know (`$function$;` / `$$;`) and, on any OTHER tag — `$mig$`, `$f$`, all legal
      // and all present in this tree — fall back to `rest`, THE WHOLE REST OF THE FILE. Every
      // assertion below then matched text that is not in the function. The identical idiom in
      // scripts/verify-nonprice-price-monitor.ts was REPRODUCED the same day: with the P0
      // phone/ID-price guard deleted from the winning body, that barrier printed PASS on every
      // check. The tag is now READ, its close REQUIRED, and an unreadable body is '' — which fails
      // the assertions — never the file.
      const tag = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
      const closeAt = tag ? rest.indexOf(tag[0], tag.index + tag[0].length) : -1;
      found = { file: f, body: tag && closeAt >= 0 ? rest.slice(0, closeAt + tag[0].length) : '' };
    }
  }
  return found;
}

// The two rules, as PURE functions over a body, so a proof can hand each one a broken body. Both
// strip `--` comments first: a replacement body that dropped a rule but kept the header comment
// explaining it would otherwise satisfy the assertion (the decoy shape that survived two AF barriers
// on 2026-09-01).
export function wordPriceProblems(rawBody: string): string[] {
  const b = codeOnly(rawBody);
  const problems: string[] = [];
  if (!(b.includes('مليون') && b.includes('لا?ف'))) {
    problems.push('the million («مليون») / thousand («الف») word forms are gone');
  }
  if (!(/price\s*<\s*50000/.test(b) && /price\s*>\s*500000000/.test(b))) {
    problems.push('the plausibility bounds are gone — an implausible word-price can be published');
  }
  return problems;
}

export function aqarParseProblems(rawBody: string): string[] {
  const b = codeOnly(rawBody);
  const problems: string[] = [];
  if (!/aqar_word_price\s*\(/.test(b)) problems.push('aqar_parse no longer calls the word-price fallback');
  // The fallback must run ONLY when no machine price was found. Unguarded, it would OVERWRITE a
  // source-published numeric price with one inferred from prose — a source-fidelity violation.
  if (!/if\s+v_price\s+is\s+null/i.test(b)) problems.push('the fallback is no longer guarded by `if v_price is null`');
  return problems;
}

const wp = lastBodyOf('aqar_word_price');
ok('aqar_word_price has a committed migration definition', wp !== null, wp?.file ?? 'not found');
if (wp) for (const p of wordPriceProblems(wp.body)) ok(p, false, wp.file);
if (wp && wordPriceProblems(wp.body).length === 0) {
  ok('aqar_word_price handles the word forms and is bounded', true);
}

const ap = lastBodyOf('aqar_parse');
ok('aqar_parse has a committed migration definition', ap !== null, ap?.file ?? 'not found');
if (ap) for (const p of aqarParseProblems(ap.body)) ok(p, false, ap.file);
if (ap && aqarParseProblems(ap.body).length === 0) {
  ok('aqar_parse calls the fallback, and only when no machine price was found', true);
}

// ── MUTATION PROOFS — the predicates are EXECUTED against deliberately broken input ─────────────
// Every input is the REAL shipped body with one thing changed, never a body invented here.
const mustCatch = (what: string, run: () => boolean) => ok(run() ? `mutation caught: ${what}` : `MUTATION SURVIVED: ${what}`, run());

// Negative controls first: a predicate red for everything proves nothing.
ok('negative control: the REAL aqar_word_price body is not flagged',
  wp !== null && wordPriceProblems(wp.body).length === 0);
ok('negative control: the REAL aqar_parse body is not flagged',
  ap !== null && aqarParseProblems(ap.body).length === 0);

const WP = wp?.body ?? '';
const AP = ap?.body ?? '';

mustCatch('the word forms removed from aqar_word_price', () =>
  wordPriceProblems(WP.replace(/مليون/g, 'XXX')).length > 0);
mustCatch('the LOWER plausibility bound removed (a 300 SAR "price" becomes publishable)', () =>
  wordPriceProblems(WP.replace(/price\s*<\s*50000/g, 'price < 0')).length > 0);
mustCatch('the UPPER plausibility bound removed (the phone/ID-artifact band returns)', () =>
  wordPriceProblems(WP.replace(/price\s*>\s*500000000/g, 'price > 9999999999999')).length > 0);
mustCatch('aqar_parse no longer calling the fallback at all', () =>
  aqarParseProblems(AP.replace(/aqar_word_price\s*\(/g, 'some_other_fn(')).length > 0);
mustCatch('the `if v_price is null` guard dropped — prose would OVERWRITE a source-published price', () =>
  aqarParseProblems(AP.replace(/if\s+v_price\s+is\s+null/gi, 'if true')).length > 0);
mustCatch('a rule surviving ONLY as a `--` comment (prose is not a code path)', () =>
  wordPriceProblems(`-- bounded: price < 50000 / price > 500000000, مليون and لا?ف\n`
    + WP.replace(/price\s*<\s*50000/g, 'price < 0')).length > 0);

console.log(failed === 0 ? '\n✓ aqar word-price fallback is present in migrations'
                         : `\n✗ ${failed} check(s) FAILED — the word-price recovery was dropped`);
process.exit(failed === 0 ? 0 : 1);
