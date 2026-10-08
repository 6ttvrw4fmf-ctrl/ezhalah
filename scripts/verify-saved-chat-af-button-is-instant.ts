// A REOPENED CHAT SHOWS ITS «تحديد أكثر» BUTTON AT ONCE (owner 2026-10-07: «I change the chat, go back later,
// and the Advanced Filter button takes a few seconds to show»). The offer probe's YES is saved with the chat
// and restored; the probe still re-runs in the background and corrects it.
import { readFileSync } from 'node:fs';
import { serializeChat, restoreChat } from '../src/lib/chatTranscript.ts';

const src = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');

function wiring(a: string): string[] {
  const bad: string[] = [];
  if (!/serializeChat\(\{ msgs: msgs as any, revealCount, afReceipt, guidedPills, completed, afCanNarrow \}\)/.test(a)) bad.push('the saved chat no longer records the Advanced Filter verdict');
  if (!/\}, \[busy, msgs, revealCount, afReceipt, guidedPills, completed, afCanNarrow\]\);/.test(a)) bad.push('a verdict that lands after the last save is never saved (capture effect does not watch it)');
  if (!/setAfReceipt\(restored\.afReceipt\);[\s\S]{0,400}?if \(restored\.afCanNarrow\) setAfCanNarrow\(\(c\) => \(\{ \.\.\.c, \.\.\.restored\.afCanNarrow \}\)\);/.test(a)) bad.push('reopening a chat no longer restores the Advanced Filter button');
  return bad;
}

type Ser = typeof serializeChat;
function roundTrip(ser: Ser): string[] {
  const bad: string[] = [];
  const live = { msgs: [{ id: 'u', role: 'user', text: 'x' }, { id: 'r', role: 'results', text: 's', result: { listings: [{ source: 'aqar', id: '1' }] } }],
    revealCount: { r: 1 }, afReceipt: {}, guidedPills: null, completed: false, afCanNarrow: { r: true, gone: true } } as any;
  const back = restoreChat(ser(live)) as any;
  if (back?.afCanNarrow?.r !== true) bad.push('a YES verdict does not survive save + reopen');
  if (back?.afCanNarrow && 'gone' in back.afCanNarrow) bad.push('a verdict for a turn that was not saved leaks into the transcript');
  const no = restoreChat(ser({ ...live, afCanNarrow: { r: false } })) as any;
  if (no && 'afCanNarrow' in no) bad.push('a NO verdict is saved (only YES may show a button early; NO waits for the probe)');
  return bad;
}

let failed = 0;
const check = (label: string, bad: string[]) => { if (bad.length) failed++; console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${label}${bad.length ? '\n        ' + bad.join('\n        ') : ''}`); };
const mustCatch = (label: string, bad: string[]) => { if (!bad.length) failed++; console.log(`${bad.length ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); };

console.log('\nA reopened chat shows its Advanced Filter button at once (owner 2026-10-07)\n');
check('wiring', wiring(src));
check('the verdict survives save + reopen (executed)', roundTrip(serializeChat));
mustCatch('a chat that forgets the verdict when saved', wiring(src.replace('guidedPills, completed, afCanNarrow });', 'guidedPills, completed });')));
mustCatch('a late verdict never saved', wiring(src.replace('guidedPills, completed, afCanNarrow]);', 'guidedPills, completed]);')));
mustCatch('a reopened chat that waits for the probe again', wiring(src.replace(/if \(restored\.afCanNarrow\) setAfCanNarrow[^\n]*\n/, '')));
mustCatch('a serializer that drops the verdict', roundTrip(((live: any) => serializeChat({ ...live, afCanNarrow: {} })) as Ser));
console.log(failed ? `\n${failed} FAILED` : '\nAll Advanced Filter button assertions passed');
process.exit(failed ? 1 : 0);
