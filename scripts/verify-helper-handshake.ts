// SECURITY PHASE 4.5 (2026-10-22): our own server-side helpers that read the database with the public key carry the
// secret handshake, so they keep working once the database refuses the bare public key.
//
// Measured in the API logs 2026-10-22: besides our robot scripts (scripts/verify-gate-handshake.ts), the remaining
// public-key callers were the home preview card (middleware.ts), the share card (api/share-card.ts), the deploy's lock
// check + live search smoke (scripts/safe-deploy.sh), the deploy drift gate (scripts/schema-drift-gate.sh) and the
// nightly findability check (scrapers/common/af_score.py). Each must send x-ezhalah-gate when EZ_GATE_SECRET is set,
// and only then. Mutations prove each check bites.
//   node --experimental-strip-types scripts/verify-helper-handshake.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ' — ' + detail}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => { console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); if (!caught) failed++; };

const SHELL_DEF = /EZ_GATE_H=\(\)\nif \[ -n "\$\{EZ_GATE_SECRET:-\}" \]; then EZ_GATE_H=\(-H "x-ezhalah-gate: \$\{EZ_GATE_SECRET\}"\); fi/;
const SHELL_USE = /\$\{EZ_GATE_H\[@\]\+"\$\{EZ_GATE_H\[@\]\}"\}/g;
const rules: [string, (s: string) => boolean][] = [
  ['middleware.ts', (s) => /'x-ezhalah-gate': process\.env\.EZ_GATE_SECRET/.test(s)],
  ['api/share-card.ts', (s) => /const GATE_HEADER[^\n]*'x-ezhalah-gate': process\.env\.EZ_GATE_SECRET/.test(s)
    && (s.match(/\.\.\.GATE_HEADER/g) ?? []).length >= 2],
  ['scripts/safe-deploy.sh', (s) => SHELL_DEF.test(s) && (s.match(SHELL_USE) ?? []).length >= 2],
  ['scripts/schema-drift-gate.sh', (s) => SHELL_DEF.test(s) && (s.match(SHELL_USE) ?? []).length >= 1],
  ['scrapers/common/af_score.py', (s) => /gate = os\.environ\.get\("EZ_GATE_SECRET"\)/.test(s) && /headers=\{"x-ezhalah-gate": gate\}/.test(s)],
];
for (const [f, ok] of rules) check(`${f} sends the handshake (only when EZ_GATE_SECRET is set)`, ok(read(f)));

mustCatch('the deploy smoke test losing the handshake', !rules[2][1](read('scripts/safe-deploy.sh').split('  ${EZ_GATE_H[@]+"${EZ_GATE_H[@]}"} \\\n').join('')));
mustCatch('the share card losing it on one of its calls', !rules[1][1](read('api/share-card.ts').replace('...GATE_HEADER', '')));
mustCatch('the Python check sending the secret unconditionally', !rules[4][1](read('scrapers/common/af_score.py').replace('gate = os.environ.get("EZ_GATE_SECRET")', 'gate = "x"')));

if (failed) { console.error(`\n❌ verify-helper-handshake: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-helper-handshake: our server-side helpers carry the secret handshake.');
