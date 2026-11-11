// Hermetic proof of scripts/drift-held-in-open-prs.ts (owner 2026-11-09 «Yes»): drift lets a deploy through ONLY when
// every missing migration sits byte-exact in an open PR, and the drift gate still refuses duplicate overloads first.
//   node --experimental-strip-types scripts/verify-drift-held-in-open-prs.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unheld, type OpenPrFile } from './drift-held-in-open-prs.ts';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const mustCatch = (label: string, caught: boolean) => check(`MUTATION — ${label}`, caught);

const V = '20261109045105', W = '20261109072817';
const SQL = 'create or replace view public.map_no_pin as select 1;';
const prod = new Map<string, string | null>([[V, SQL], [W, 'select 2;']]);
const f = (v: string, text: string | null, pr = 1): OpenPrFile => ({ pr, path: `supabase/migrations/${v}_x.sql`, text });

check('every missing migration byte-exact in an open PR → held', unheld([V, W], [f(V, SQL), f(W, 'select 2;\n', 2)], prod).length === 0);
check('one migration with no open PR → not held', unheld([V, W], [f(V, SQL)], prod).join() === W);
check('a PR file that differs from what production ran → not held', unheld([V], [f(V, SQL.replace('1', '2'))], prod).length === 1);
check('…but a second PR holding the exact copy still holds it', unheld([V], [f(V, 'x'), f(V, SQL, 2)], prod).length === 0);
check('a file unreadable at the PR head → not held', unheld([V], [f(V, null)], prod).length === 1);
check('production returned no SQL for it → not held', unheld([V], [f(V, SQL)], new Map([[V, null]])).length === 1);
check('a file for another version never holds this one', unheld([V], [f(W, SQL)], prod).length === 1);

const gate = readFileSync(join(import.meta.dirname ?? '.', 'schema-drift-gate.sh'), 'utf8');
const HELD = /if \[ "\$DUPS" = "0" \] && \[ "\$MISSING" != "parse_error" \]; then[\s\S]*?scripts\/drift-held-in-open-prs\.ts "\$RESP"; then[\s\S]*?exit 0/;
check('the gate consults the helper only when there are NO duplicate overloads', HELD.test(gate));
check('the gate still refuses after the helper says no', /scripts\/drift-held-in-open-prs\.ts[\s\S]*?\n  fi\n  echo ""\n  echo "❌ \$\{REFUSAL\}: production schema drift detected\."/.test(gate));

mustCatch('a hold that ignores the bytes', unheld([V], [f(V, 'anything')], prod).length === 1);
mustCatch('the gate letting duplicate overloads through the helper', !HELD.test(gate.replace('[ "$DUPS" = "0" ] && ', '')));

if (failed) { console.error(`\n❌ verify-drift-held-in-open-prs: ${failed} check(s) failed`); process.exit(1); }
console.log('\nverify-drift-held-in-open-prs: drift passes a deploy only when every missing migration is byte-exact in an open PR');
