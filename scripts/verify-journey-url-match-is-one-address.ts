// 🔗 Click Guardian 2026-11-13. e2e/engineers/journey-lib.mjs decides «did the card open the stored ad?» for the
// customer journey AND for card-parity's link field (scrapers/common/card_parity.py reads its «≠ stored» verdict).
// Its self-check was run by nothing on a PR, so when #11956 began sending Sakan through `new URL().href`
// (Arabic slug → %D8%B4…), normUrl kept comparing raw text and card-parity read both sakan cards of night
// 11-13 as «link=mismatch» — a false broken-link alarm on ads the customer really opened.
// This runs the self-check (pure: no browser, no network) so normUrl cannot lose a case again unseen, and
// proves it would fail on the defect by running the same self-check against a copy with the decode removed.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIB = 'e2e/engineers/journey-lib.mjs';
const selfCheck = (file: string) => {
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 60_000 });
  return { ok: r.status === 0 && /self-check: OK/.test(r.stdout), out: `${r.stdout}${r.stderr}`, status: r.status };
};

let failed = 0;
const real = selfCheck(LIB);
if (!real.ok) {
  console.error(`✗ journey-lib self-check failed (status ${real.status ?? 'killed'}):\n${real.out}`);
  failed++;
} else {
  console.log('✓ journey-lib self-check passes (normUrl: scheme, slash, fragment, language segment, percent-encoding)');
}

// Mutation proof: the 11-13 defect (no percent-decoding) must turn the self-check red.
function mustCatch(label: string, mutate: (src: string) => string) {
  const src = readFileSync(LIB, 'utf8');
  const mutated = mutate(src);
  if (mutated === src) { console.error(`✗ mutation «${label}» did not apply — the guard's anchor moved`); failed++; return; }
  const dir = mkdtempSync(join(tmpdir(), 'journey-lib-mut-'));
  try {
    const f = join(dir, 'journey-lib.mjs');
    writeFileSync(f, mutated);
    const r = selfCheck(f);
    if (r.ok) { console.error(`✗ (mutation) NOT caught: ${label}`); failed++; }
    else console.log(`✓ (mutation) catches ${label}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
mustCatch('normUrl comparing percent-encoded and raw Arabic as different addresses',
  (s) => s.replace('_decode(String(u ||', '(String(u ||'));
mustCatch('normUrl keeping the /ar/ language segment (the gathern /ar/view/ case)',
  (s) => s.replace(".replace(/^(https:\\/\\/[^/]+)\\/(?:ar|en)(?=\\/|$)/i, '$1')", ''));

if (failed) process.exit(1);
