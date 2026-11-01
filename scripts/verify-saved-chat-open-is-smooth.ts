// OPENING A SAVED CHAT IS A PAGE TURN, NOT A HARD CUT (owner 2026-10-03: «the animation feels too tough»).
// The sidebar open used to wipe the old chat in one frame, paint the new one at its top and jump to the bottom
// up to five times in view. Now it fades out, swaps + lands while invisible, and fades in once settled.
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
const reveal = readFileSync(new URL('../src/components/CardReveal.tsx', import.meta.url), 'utf8');

// A REOPENED CHAT NEVER GOES BLANK (owner 2026-10-10, iPhone: «when I switch between chats … always a
// glitch»). Its cards used to replay the mount-in all at once, each held at opacity 0 by an animation that
// could not start while hundreds of cards mounted. Only a turn a search produced LIVE plays it
// (cardInMotion, executed in verify-loadmore-reveal-is-instant.ts); this pins the two halves around it.
function neverBlank(a: string, r: string): string[] {
  const bad: string[] = [];
  const reset = /const resetConversationState = \(\) => \{[\s\S]*?\n  \};\n/.exec(a)?.[0] ?? '';
  if (!/liveTurnsRef\.current = new Set\(\);/.test(reset)) bad.push('switching chats does not forget the old conversation\'s live turns (a reopened turn could replay its mount-in)');
  if (!/liveTurnsRef\.current\.add\(statusId\);[^\n]*\n\s*setMsgs\(\(m\) =>\n\s*m\.map\(\(x\) =>\n\s*x\.id === statusId\n\s*\? \{ id: statusId, role: 'results'/.test(a)) bad.push('a live results turn is not registered where it is created');
  const fills = r.match(/animationFillMode: '([a-z]+)'/g) ?? [];
  if (fills.length !== 2 || fills.some((f) => !f.includes("'backwards'"))) bad.push(`card mount-in fill is not backwards (${fills.join(', ')}) — a finished card keeps an animated opacity/transform pinned`);
  return bad;
}

function wiring(a: string): string[] {
  const bad: string[] = [];
  if (!/if \(replay !== '0'\) open\(\);\n\s*else turnToSavedChat\(open\);/.test(a)) bad.push('the sidebar replay does not go through the page turn');
  const block = /const turnToSavedChat = [\s\S]*?\n  \};\n/.exec(a)?.[0] ?? '';
  if (!block) { bad.push('turnToSavedChat is gone'); return bad; }
  if (!/Animated\.timing\(freshFade, \{ toValue: 0,/.test(block)) bad.push('the old chat is not faded out before the swap');
  if (!/runAfterAnimation\(/.test(block)) bad.push('the swap is not driven by runAfterAnimation (a frozen rAF would block opening the chat)');
  if (!/if \(token !== savedOpenTokenRef\.current \|\| epochAtTap !== conversationEpochRef\.current\) return;\s*\n\s*open\(\);/.test(block)) bad.push('a stale open (second tap / New Chat during the fade) can still swap over the newer screen, or leaves it faded out');
  if (!/Animated\.timing\(freshFade, \{ toValue: 1,/.test(block)) bad.push('the opened chat never fades back in');
  if (!/\}, 180\)\)?;/.test(block)) bad.push('the fade-in no longer waits for the first re-bottom (the jump would be seen)');
  if (!/conversationEpochRef\.current\+\+;/.test((/const resetConversationState = \(\) => \{[\s\S]*?\n  \};\n/.exec(a)?.[0] ?? ''))) bad.push('New Chat does not cancel a pending saved-chat open');
  return bad;
}

let failed = 0;
const check = (label: string, bad: string[]) => { if (bad.length) failed++; console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${label}${bad.length ? '\n        ' + bad.join('\n        ') : ''}`); };
const mustCatch = (label: string, bad: string[]) => { if (!bad.length) failed++; console.log(`${bad.length ? 'PASS' : 'FAIL'}  (mutation) catches ${label}`); };

console.log('\nOpening a saved chat fades out, lands while hidden, fades in (owner 2026-10-03)\n');
check('wiring', wiring(src));
check('a reopened chat never goes blank (its cards mount still; nothing stays pinned on a card)', neverBlank(src, reveal));
mustCatch('a chat switch that keeps the old live turns', neverBlank(src.replace('    liveTurnsRef.current = new Set();', '   '), reveal));
mustCatch('a live turn that is never registered', neverBlank(src.replace('    liveTurnsRef.current.add(statusId);', '   '), reveal));
mustCatch('a card fill pinned again (both)', neverBlank(src, reveal.replace("animationFillMode: 'backwards'", "animationFillMode: 'both'")));
mustCatch('the hard cut coming back (no fade-out)', wiring(src.replace('(onFinished) => Animated.timing(freshFade, { toValue: 0, duration: 110, useNativeDriver: true }).start(onFinished)', '(onFinished) => onFinished()')));
mustCatch('showing the chat before it landed', wiring(src.replace(/(const turnToSavedChat[\s\S]*?)\}, 180\)(\)?);/, '$1}, 0)$2;')));
mustCatch('a stale open swapping over the newer chat', wiring(src.replace('if (token !== savedOpenTokenRef.current || epochAtTap !== conversationEpochRef.current) return;', '')));
mustCatch('New Chat that does not cancel a pending open', wiring(src.replace('conversationEpochRef.current++; // every in-flight', '// every in-flight')));
mustCatch('a chat that never fades back in', wiring(src.replace(/(const turnToSavedChat[\s\S]*?)Animated\.timing\(freshFade, \{ toValue: 1,/, '$1Animated.timing(freshFade, { toValue: 0,')));
mustCatch('a replay that skips the page turn', wiring(src.replace('else turnToSavedChat(open);', 'else open();')));
console.log(failed ? `\n${failed} FAILED` : '\nAll smooth-open assertions passed');
process.exit(failed ? 1 : 0);
