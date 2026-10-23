// A SAVED SEARCH CHAT NEVER REOPENS AS THE USER'S REQUEST ALONE (owner 2026-10-23: a chat from the
// sidebar showed «I'm looking for residential property to buy in Riyadh» and nothing under it — «this
// should never ever happen»). Measured: user_chats h17927353893642433 held a transcript whose only
// message was that request (saved mid-search). openSaved must treat a search transcript that ENDS on
// a user turn as unanswered and re-run the search (openStatic) instead of restoring it verbatim.
//
//   node --experimental-strip-types scripts/verify-saved-search-chat-never-reopens-unanswered.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');

function problems(a: string): string[] {
  const open = /const openSaved = async [\s\S]*?\n  \};\n/.exec(a)?.[0] ?? '';
  if (!open) return ['openSaved is gone'];
  const bad: string[] = [];
  if (!/const unansweredSearch = !!restored && hasSearch && restored\.msgs\[restored\.msgs\.length - 1\]\?\.role === 'user';/.test(open))
    bad.push('no check for a search transcript that ends on the user\'s own request');
  if (!/if \(restored && !unansweredSearch\) \{/.test(open)) bad.push('an unanswered search transcript is still restored verbatim');
  if (!/openStatic\(q, override, entry\?\.snapshot\);\n  \};\n$/.test(open)) bad.push('the fallback no longer re-runs the search (openStatic) at the end of openSaved');
  return bad;
}
let failed = 0;
const check = (label: string, bad: string[]) => { if (bad.length) failed++; console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${label}${bad.length ? '\n        ' + bad.join('\n        ') : ''}`); };
const mustCatch = (label: string, bad: string[]) => { if (!bad.length) failed++; console.log(`${bad.length ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); };

check('a saved search chat that ends on the request re-runs its search', problems(src));
mustCatch('the 2026-10-23 bubble-only reopen (restore verbatim)', problems(src.replace('if (restored && !unansweredSearch) {', 'if (restored) {')));
mustCatch('the check dropped', problems(src.replace(/    const unansweredSearch = [^\n]*\n/, '    const unansweredSearch = false;\n')));
console.log(failed ? `\n${failed} FAILED` : '\nAll unanswered-saved-chat assertions passed');
process.exit(failed ? 1 : 0);
