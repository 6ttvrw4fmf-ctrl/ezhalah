// OPENING A SAVED CHAT NEVER SHOWS AN EMPTY SCREEN WHILE THE SERVER ANSWERS (owner 2026-10-10, iPhone on
// LTE: the hero header over a blank page after choosing a chat in the sidebar). The page turn
// (turnToSavedChat) fades the chat in after 180 ms no matter what; openSaved's hydrate is a network
// round trip. Whatever this device already holds — a stale transcript or the saved snapshot — must be
// painted BEFORE that await, so the fade-in never reveals an empty transcript.
//
//   node --experimental-strip-types scripts/verify-saved-chat-never-blank-while-hydrating.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');

function problems(a: string): string[] {
  const bad: string[] = [];
  const open = /const openSaved = async [\s\S]*?\n  \};\n/.exec(a)?.[0] ?? '';
  if (!open) return ['openSaved is gone'];
  const hydrateAt = open.indexOf('await hydrateTranscript(');
  if (hydrateAt < 0) return ['openSaved no longer hydrates (re-read this barrier)'];
  const before = open.slice(0, hydrateAt);
  if (!/restoreChat\(local\)/.test(before)) bad.push('the held (stale) transcript is not restored before the hydrate await');
  if (!/setMsgs\(early\.msgs/.test(before)) bad.push('the early copy is not painted (setMsgs) before the hydrate await');
  if (!/openStatic\(q, override, entry\.snapshot\)/.test(before)) bad.push('a chat with only a snapshot is not painted before the hydrate await');
  if (!/lastCapturedRef\.current = JSON\.stringify\(local\)/.test(before)) bad.push('the painted copy is not marked as captured (it would be written back over the server)');
  return bad;
}
let failed = 0;
const check = (label: string, bad: string[]) => { if (bad.length) failed++; console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${label}${bad.length ? '\n        ' + bad.join('\n        ') : ''}`); };
const mustCatch = (label: string, bad: string[]) => { if (!bad.length) failed++; console.log(`${bad.length ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); };

check('a saved chat is painted from what the device holds before the server round trip', problems(src));
mustCatch('the 2026-10-10 blank (no early paint at all)', problems(src.replace(/    if \(!t && entryId\) \{[\s\S]*?t = await hydrateTranscript\(entryId\)\.catch\(\(\) => null\);/, '    if (!t && entryId) {\n      t = await hydrateTranscript(entryId).catch(() => null);')));
mustCatch('a snapshot-only chat left blank', problems(src.replace('void openStatic(q, override, entry.snapshot);', 'void 0;')));
mustCatch('an early copy that would be written back over the server', problems(src.replace('lastCapturedRef.current = JSON.stringify(local);', '')));
console.log(failed ? `\n${failed} FAILED` : '\nAll never-blank assertions passed');
process.exit(failed ? 1 : 0);
