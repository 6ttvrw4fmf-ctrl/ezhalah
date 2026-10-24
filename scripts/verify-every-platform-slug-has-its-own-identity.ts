// Every platform SLUG resolves to its own website, never to the Aqar fallback (🦅 Falcon, 2026-10-23).
//
// The live barrier verify-platform-identity-matches-live-source.ts went red on 2026-10-23 (af-live-truth-check run
// 39940963632): sourceHost('arsh'), sourceHost('ashab') and sourceHost('maqam') all returned sa.aqar.fm, because
// those three branches matched only the brand string and the domain, never the slug. Today's cards carry the brand
// string, so they rendered correctly, but any surface that passes the slug (the platform column) would show Aqar's
// name and link on another company's ad. The live check runs once a day, outside the required suite. This hermetic
// half runs the REAL lifted sourceHost over every slug in the liveness registry on every PR.
//   node --experimental-strip-types scripts/verify-every-platform-slug-has-its-own-identity.ts   (discovered by `npm test`)
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(import.meta.dirname, '..');
const AQAR_FALLBACK = 'sa.aqar.fm';
const FALLBACK_OK = new Set(['aqar', 'aqarmonthly']);
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const slugs: string[] = JSON.parse(readFileSync(join(ROOT, 'sql/mirrors/liveness_registry.json'), 'utf8')).map((r: any) => r.platform);
check('the liveness registry lists the platforms', slugs.length > 50, `${slugs.length}`);

const RC = join(ROOT, 'src/components/ResultCard.tsx');
const lift = async (file: string) => {
  const rc = await liftSymbols(file, [{ header: 'function sourceHost' }], ['sourceHost'], '');
  return rc.sourceHost as (s: string) => string;
};
const offenders = (host: (s: string) => string) => slugs.filter((p) => !FALLBACK_OK.has(p) && host(p) === AQAR_FALLBACK);

const real = await lift(RC);
const bad = offenders(real);
check(`every one of ${slugs.length} platform slugs resolves to its own website (only aqar/aqarmonthly may use the Aqar fallback)`,
  bad.length === 0, `falls back to ${AQAR_FALLBACK}: ${bad.join(', ')}`);

// Mutation: the 2026-10-23 shape — a branch that knows the brand string but not the slug.
const src = readFileSync(RC, 'utf8');
const NEEDLE = "if (raw === 'arsh' || s.includes('عرش العقارية') || s.includes('arshglobal')) return 'arshglobal.com.sa';";
const mutated = src.replace(NEEDLE, NEEDLE.replace("raw === 'arsh' || ", ''));
if (mutated === src) {
  check('the arsh slug branch is present to mutate', false, 'sourceHost arsh branch not found');
} else {
  let caught = false;
  const dir = mkdtempSync(join(tmpdir(), 'slug-identity-'));
  try {
    const f = join(dir, 'ResultCard.tsx');
    writeFileSync(f, mutated);
    caught = offenders(await lift(f)).includes('arsh');
  } catch { caught = false; } finally { rmSync(dir, { recursive: true, force: true }); }
  mustCatch('the arsh branch losing its slug (the 2026-10-23 defect)', caught);
}

if (failed) { console.error(`\n❌ verify-every-platform-slug-has-its-own-identity: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-every-platform-slug-has-its-own-identity: no platform slug renders as Aqar.');
