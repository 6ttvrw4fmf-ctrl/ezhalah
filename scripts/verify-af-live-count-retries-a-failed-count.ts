// A FAILED LIVE COUNT IS RETRIED, NEVER LEFT AS NOTHING (owner 2026-10-08: «why no numbers showing»). The card's 4 s
// budget trips whenever the database is busy; the header chip and «متابعة · N نتيجة» then both vanish. The liveCount
// handed to the card retries twice with the background budget before giving up.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
function wiring(a: string): string[] {
  const bad: string[] = [];
  const m = /liveCount=\{\(keys\) => \{[\s\S]*?\n              \}\}/.exec(a)?.[0] ?? '';
  if (!/let n = await liveResultCount\(scoped\);/.test(m)) bad.push('the live count no longer starts with the card-budget call');
  if (!/for \(let i = 0; n === null && i < 2; i\+\+\)/.test(m)) bad.push('a failed (null) live count is no longer retried');
  if (!/n = await primeLiveResultCount\(scoped\);/.test(m)) bad.push('the retry no longer uses the longer background budget');
  if (!/const scoped = question\.apply\(q, keys\);/.test(m)) bad.push('the retry is not tied to THIS selection (could return another selection\'s count)');
  return bad;
}
let failed = 0;
const check = (l: string, bad: string[]) => { if (bad.length) failed++; console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${l}${bad.length ? '\n        ' + bad.join('\n        ') : ''}`); };
const mustCatch = (l: string, bad: string[]) => { if (!bad.length) failed++; console.log(`${bad.length ? 'PASS' : 'FAIL'}  (mutation) catches ${l}`); };
check('wiring', wiring(src));
mustCatch('a count that is never retried', wiring(src.replace('n === null && i < 2', 'false')));
mustCatch('a retry on the short card budget', wiring(src.replace('n = await primeLiveResultCount(scoped);', 'n = await liveResultCount(scoped);')));
mustCatch('a retry that is not scoped to the selection', wiring(src.replace('const scoped = question.apply(q, keys);', 'const scoped = q;')));
console.log(failed ? `\n${failed} FAILED` : '\nAll live-count retry assertions passed');
process.exit(failed ? 1 : 0);
