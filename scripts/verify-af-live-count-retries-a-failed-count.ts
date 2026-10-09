// A FAILED LIVE COUNT IS RETRIED, NEVER LEFT AS NOTHING (owner 2026-10-08: «why no numbers showing»). The card's 4 s
// budget trips whenever the database is busy; the header chip and «متابعة · N نتيجة» then both vanish. The liveCount
// handed to the card asks once with the background budget and retries twice before giving up.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
function wiring(a: string): string[] {
  const bad: string[] = [];
  const m = /liveCount=\{\(keys\) => \{[\s\S]*?\n              \}\}/.exec(a)?.[0] ?? '';
  // 2026-10-09 (🔬, backlog 281): the FIRST call uses the background budget too. The 4 s card budget aborted counts in the
  // slow tenth and the retry re-ran the same count on a busy database; one long-budget call shows the number with no rerun.
  if (!/let n = await primeLiveResultCount\(scoped\);/.test(m)) bad.push('the live count no longer starts with ONE long-budget call (a 4 s first try aborts slow counts and re-runs them)');
  if (!/for \(let i = 0; n === null && i < 2; i\+\+\)/.test(m)) bad.push('a failed (null) live count is no longer retried');
  if (!/\n\s+n = await primeLiveResultCount\(scoped\);/.test(m)) bad.push('the retry no longer uses the longer background budget');
  if (!/const scoped = question\.apply\(q, keys\);/.test(m)) bad.push('the retry is not tied to THIS selection (could return another selection\'s count)');
  return bad;
}
let failed = 0;
const check = (l: string, bad: string[]) => { if (bad.length) failed++; console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${l}${bad.length ? '\n        ' + bad.join('\n        ') : ''}`); };
const mustCatch = (l: string, bad: string[]) => { if (!bad.length) failed++; console.log(`${bad.length ? 'PASS' : 'FAIL'}  (mutation) catches ${l}`); };
check('wiring', wiring(src));
mustCatch('a count that is never retried', wiring(src.replace('n === null && i < 2', 'false')));
mustCatch('a first try on the short 4 s card budget', wiring(src.replace('let n = await primeLiveResultCount(scoped);', 'let n = await liveResultCount(scoped);')));
mustCatch('a retry on the short card budget', wiring(src.replace(/\n(\s+)n = await primeLiveResultCount\(scoped\);/, '\n$1n = await liveResultCount(scoped);')));
mustCatch('a retry that is not scoped to the selection', wiring(src.replace('const scoped = question.apply(q, keys);', 'const scoped = q;')));
console.log(failed ? `\n${failed} FAILED` : '\nAll live-count retry assertions passed');
process.exit(failed ? 1 : 0);
