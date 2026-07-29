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
      const close = rest.match(/\$(function|)\$\s*;/i);
      found = { file: f, body: close ? rest.slice(0, close.index! + close[0].length) : rest };
    }
  }
  return found;
}

const wp = lastBodyOf('aqar_word_price');
ok('aqar_word_price has a committed migration definition', wp !== null, wp?.file ?? 'not found');
if (wp) {
  ok('aqar_word_price handles the million («مليون») + thousand («الف») forms', wp.body.includes('مليون') && wp.body.includes('لا?ف'), wp.file);
  ok('aqar_word_price is bounded (rejects implausible values)', /price\s*<\s*50000/.test(wp.body) && /price\s*>\s*500000000/.test(wp.body), wp.file);
}

const ap = lastBodyOf('aqar_parse');
ok('aqar_parse has a committed migration definition', ap !== null, ap?.file ?? 'not found');
if (ap) {
  ok('aqar_parse still calls the word-price fallback', /aqar_word_price\s*\(/.test(ap.body), ap.file);
  ok('the fallback is guarded (only when no machine-price found)', /if\s+v_price\s+is\s+null/i.test(ap.body), ap.file);
}

console.log(failed === 0 ? '\n✓ aqar word-price fallback is present in migrations'
                         : `\n✗ ${failed} check(s) FAILED — the word-price recovery was dropped`);
process.exit(failed === 0 ? 0 : 1);
