// A PLAIN-PROSE ANSWER AFTER THE RE-ASK IS SHOWN TO THE CUSTOMER, NEVER A 502 (2026-11-03, backlog 1263).
// audit-invariants.yml measured the live agent answering a broad search («أدور لك في جدة إيجار وبيع، وكم غرفة نوم
// تحتاجون؟») as plain text on the text-mode re-ask, 3 of 3 times. There was no JSON object to cut out, so the customer
// got HTTP 502 «unparseable model output» for a perfectly good clarifying question.
// Two parts in supabase/functions/agent/index.ts, both pinned here:
//   1. the re-ask also closes the LAST user turn with JSON_ONLY_TURN_RULE (where the model looks for what to do now);
//   2. if the re-asked reply is still prose with no «{» at all, it is returned as a message, recorded as prose_fallback.
//      Only AFTER the re-ask, and only with no object in it — a broken object still fails loudly.
// Run: node --experimental-strip-types scripts/verify-agent-prose-reply-is-not-a-502.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const src = readFileSync(join(ROOT, 'supabase/functions/agent/index.ts'), 'utf8');

export function problems(s: string): string[] {
  const out: string[] = [];
  if (!/const JSON_ONLY_TURN_RULE = "[^"]*ONLY[^"]*JSON[^"]*";/.test(s)) out.push('JSON_ONLY_TURN_RULE is gone');
  if (!/i === lastIdx && m\.role === "user" \? \{ \.\.\.m, content: String\(m\.content\) \+ "\\n\\n" \+ JSON_ONLY_TURN_RULE \}/.test(s))
    out.push('the re-ask no longer closes the last user turn with JSON_ONLY_TURN_RULE');
  const fb = /if \(emptyRetried && prose && !prose\.includes\("\{"\)\) \{\s*recordHealth\("prose_fallback"[^\n]*\n\s*return \{ kind: "message", reply: prose,/;
  if (!fb.test(s)) out.push('a prose reply after the re-ask is no longer returned as a message (gated on emptyRetried and no «{»)');
  return out;
}

let failed = 0;
const check = (m: string, c: boolean) => { if (c) console.log(`  ✓ ${m}`); else { console.error(`  ❌ ${m}`); failed++; } };
const mutation = (label: string, mutant: string) => check(`(mutation) catches ${label}`, mutant !== src && problems(mutant).length > 0);

const p = problems(src);
for (const x of p) console.error(`    ${x}`);
check('the re-ask closes the last turn and a prose reply after it reaches the customer', p.length === 0);

mutation('the turn rule dropped', src.replace(/ : i === lastIdx && m\.role === "user" \? \{[^}]*\}/, ''));
mutation('the fallback without the re-ask gate', src.replace('if (emptyRetried && prose && !prose.includes("{"))', 'if (prose && !prose.includes("{"))'));
mutation('the fallback swallowing a broken object', src.replace('emptyRetried && prose && !prose.includes("{")', 'emptyRetried && prose'));
mutation('the fallback removed', src.replace(/return \{ kind: "message", reply: prose, __proseFallback: true \};/, 'throw new Error("x");'));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ a plain-prose answer after the re-ask reaches the customer as a message');
