import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

// Backlog 676 (2026-10-18). On a phone the Google One Tap sheet focuses its own iframe when it renders,
// ~1 s after the page opens, which closes the keyboard and swallows every character a visitor types after
// it: on production, typing «المرموثة» into the city field at 600 ms per character left «ال». The prompt
// must never START while a text field has focus; it waits for the next focusout and tries again. This
// barrier EXECUTES the gate (lifted from the real component) and pins that start() goes through it.

const ROOT = join(import.meta.dirname, '..');
const FILE = join(ROOT, 'src/components/GoogleOneTap.tsx');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nGoogle One Tap waits while the visitor is typing\n');

const lifted = await liftSymbols(FILE, [
  { header: 'export function isTextFieldFocused(', endsWith: /^\}$/ },
  { header: 'export function deferWhileTyping(', endsWith: /^\}$/ },
], ['isTextFieldFocused', 'deferWhileTyping']);
const isTextFieldFocused = lifted.isTextFieldFocused as (d: { activeElement: unknown }) => boolean;
const deferWhileTyping = lifted.deferWhileTyping as (d: any, fn: () => void, settleMs?: number) => boolean;

const FOCUS_CASES: Array<[unknown, boolean, string]> = [
  [null, false, 'nothing focused'],
  [{ tagName: 'BODY' }, false, 'the body'],
  [{ tagName: 'DIV' }, false, 'a plain div'],
  [{ tagName: 'INPUT' }, true, 'an input (the city field)'],
  [{ tagName: 'TEXTAREA' }, true, 'a textarea (the agent composer)'],
  [{ tagName: 'DIV', isContentEditable: true }, true, 'a contenteditable'],
  [{ tagName: 'IFRAME' }, false, 'the One Tap iframe itself'],
];
const focusRight = (fn: typeof isTextFieldFocused) => FOCUS_CASES.every(([el, want]) => fn({ activeElement: el }) === want);
check('a text field is recognised by what a keyboard types into, nothing else', focusRight(isTextFieldFocused),
  FOCUS_CASES.filter(([el, want]) => isTextFieldFocused({ activeElement: el }) !== want).map(([, , l]) => l).join(' | '));
mustCatch('a gate that never sees a text field', !focusRight(() => false));
mustCatch('a gate that only knows INPUT (the agent composer is a textarea)', !focusRight((d: any) => d.activeElement?.tagName === 'INPUT'));

function fakeDoc(active: unknown) {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    activeElement: active,
    addEventListener: (t: string, f: () => void) => { (listeners[t] ??= []).push(f); },
    removeEventListener: (t: string, f: () => void) => { listeners[t] = (listeners[t] ?? []).filter((g) => g !== f); },
    fire: (t: string) => { for (const f of [...(listeners[t] ?? [])]) f(); },
    count: (t: string) => (listeners[t] ?? []).length,
  };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

{
  const d = fakeDoc({ tagName: 'BODY' }); let calls = 0;
  const deferred = deferWhileTyping(d, () => { calls++; }, 10);
  check('nobody typing → the caller proceeds now (false) and nothing is scheduled', deferred === false && calls === 0 && d.count('focusout') === 0);
}
{
  const d = fakeDoc({ tagName: 'INPUT' }); let calls = 0;
  const deferred = deferWhileTyping(d, () => { calls++; }, 10);
  check('typing → deferred (true), the prompt is NOT started, one focusout listener waits', deferred === true && calls === 0 && d.count('focusout') === 1);
  d.activeElement = { tagName: 'BODY' }; d.fire('focusout');
  check('on focusout the listener is removed and the prompt starts after the settle delay', d.count('focusout') === 0 && calls === 0);
  await sleep(40);
  check('… exactly once', calls === 1, `calls=${calls}`);
  d.fire('focusout'); await sleep(20);
  check('a later focusout does not start it again (the listener was one-shot)', calls === 1, `calls=${calls}`);
}
const gateRight = (gate: typeof deferWhileTyping) => gate(fakeDoc({ tagName: 'INPUT' }), () => {}, 10) === true && gate(fakeDoc({ tagName: 'BODY' }), () => {}, 10) === false;
check('the real gate defers for an input and proceeds for the body', gateRight(deferWhileTyping));
mustCatch('a gate that proceeds while an input has focus', !gateRight(() => false));
mustCatch('a gate that always defers (the prompt would never show)', !gateRight(() => true));

const src = readFileSync(FILE, 'utf8');
const gated = (s: string) => /const start = \(\) => \{\s*if \(cancelled\) return;\s*\/\/[^\n]*\n\s*if \(deferWhileTyping\(document, \(\) => \{ if \(!cancelled\) start\(\); \}\)\) \{[^\n]*return; \}\s*\n(?:\s*\/\/[^\n]*\n)*\s*if \(!fedcmSupported\) \{ run\(false\); return; \}/.test(s);
check('start() goes through deferWhileTyping(document, …) BEFORE any initialize/prompt, and re-enters start() so a focus that only moved to another field waits again', gated(src));
mustCatch('start() running the prompt without the gate', !gated(src.replace(/\s*\/\/ A visitor typing keeps the prompt out[^\n]*\n\s*if \(deferWhileTyping\(document[^\n]*\n/, '\n')));
check('no google.accounts.id.cancel() was introduced (a cancel is a dismissal to Google and starts the cooldown)', !/google\.accounts\.id\.cancel\(/.test(src.replace(/\/\/[^\n]*/g, '')));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ Google One Tap waits while the visitor is typing');
