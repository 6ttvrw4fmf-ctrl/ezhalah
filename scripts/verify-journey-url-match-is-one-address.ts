// 🔗 Click Guardian 2026-11-13. e2e/engineers/journey-lib.mjs decides «did the card open the stored ad?» for the
// customer journey AND for card-parity's link field (scrapers/common/card_parity.py reads its «≠ stored» verdict).
// Its self-check was run by nothing on a PR, so when #11956 began sending Sakan through `new URL().href`
// (Arabic slug → %D8%B4…), normUrl kept comparing raw text and card-parity read both sakan cards of night
// 11-13 as «link=mismatch» — a false broken-link alarm on ads the customer really opened.
// This runs the self-check (pure: no browser, no network) so normUrl cannot lose a case again unseen.
import { spawnSync } from 'node:child_process';

const r = spawnSync(process.execPath, ['e2e/engineers/journey-lib.mjs'], { encoding: 'utf8', timeout: 60_000 });
if (r.status !== 0) {
  console.error(`✗ journey-lib self-check failed (status ${r.status ?? 'killed'}):\n${r.stdout}${r.stderr}`);
  process.exit(1);
}
if (!/self-check: OK/.test(r.stdout)) {
  console.error(`✗ journey-lib self-check printed no OK line — it did not run its asserts:\n${r.stdout}`);
  process.exit(1);
}
console.log('✓ journey-lib self-check passes (normUrl: scheme, slash, fragment, language segment, percent-encoding)');
