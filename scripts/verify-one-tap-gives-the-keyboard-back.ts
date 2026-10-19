import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

// 🔧 2026-10-19, backlog 739 (676 reopened). Measured on production, 4 of 4 runs: when Google's One Tap
// sheet is already on screen before a phone visitor taps the city field, its iframe takes focus while
// they type and «المرموثة» arrives as «ا» or nothing. The guard gives the field its focus back when — and
// only when — the new focus owner is Google's iframe. This barrier EXECUTES the guard lifted from the real
// component against a fake document, pins both directions (a visitor who really left the field is not
// dragged back), and pins that the component installs and tears it down.

const ROOT = join(import.meta.dirname, '..');
const FILE = join(ROOT, 'src/components/GoogleOneTap.tsx');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nGoogle One Tap gives the keyboard back to a typing visitor\n');

const lifted = await liftSymbols(FILE, [
  { header: 'export function isGsiFrame(', endsWith: /^\}$/ },
  { header: 'const isTextField = (', endsWith: /^  [^ ].*;$/ },
  { header: 'export const TYPING_WINDOW_MS', endsWith: /;$/ },
  { header: 'export function installTypingGuard(', endsWith: /^\}$/ },
], ['isGsiFrame', 'installTypingGuard', 'TYPING_WINDOW_MS'], 'type GuardDoc = any;');
const TYPING_WINDOW_MS = lifted.TYPING_WINDOW_MS as number;
const isGsiFrame = lifted.isGsiFrame as (el: any) => boolean;
const installTypingGuard = lifted.installTypingGuard as (doc: any, schedule?: (fn: () => void) => void, now?: () => number) => () => void;

// A tiny document: listeners, an active element, containment, and elements that can be focused.
function fakeDoc() {
  const listeners: Record<string, Array<(e: any) => void>> = {};
  const doc: any = {
    activeElement: null as any,
    nodes: new Set<any>(),
    addEventListener: (t: string, fn: any) => { (listeners[t] ??= []).push(fn); },
    removeEventListener: (t: string, fn: any) => { listeners[t] = (listeners[t] ?? []).filter((f) => f !== fn); },
    contains: (el: any) => doc.nodes.has(el),
    dispatch: (t: string, e: any) => { for (const fn of listeners[t] ?? []) fn(e); },
    listenerCount: (t: string) => (listeners[t] ?? []).length,
  };
  return doc;
}
const el = (tagName: string, attrs: Record<string, string> = {}) => {
  const node: any = { tagName, focusCalls: 0, getAttribute: (k: string) => attrs[k] ?? null };
  node.focus = () => { node.focusCalls++; };
  return node;
};
const gsiFrame = () => el('IFRAME', { src: 'https://accounts.google.com/gsi/iframe/select?client_id=x' });

// Run one scenario: a field loses focus, then `next` owns focus; the deferred check runs.
function scenario(opts: { fieldTag?: string; next: any; removed?: boolean; contentEditable?: boolean; idleMs?: number; keyAt?: number }) {
  const doc = fakeDoc();
  const queue: Array<() => void> = [];
  let t = 10_000;
  const stop = installTypingGuard(doc, (fn) => queue.push(fn), () => t);
  const field = el(opts.fieldTag ?? 'INPUT');
  if (opts.contentEditable) field.isContentEditable = true;
  if (!opts.removed) doc.nodes.add(field);
  doc.activeElement = field;
  doc.dispatch('focusin', { target: field });           // the visitor taps the field at t
  if (opts.keyAt !== undefined) { t += opts.keyAt; doc.dispatch('keydown', { target: field }); }
  t += opts.idleMs ?? 500;                               // …and the steal comes this long after the last typing
  doc.dispatch('focusout', { target: field });
  doc.activeElement = opts.next;         // the cross-origin frame (or whoever) owns focus AFTER the event
  queue.forEach((fn) => fn());
  return { field, doc, stop, deferred: queue.length };
}

check('isGsiFrame: Google\'s gsi iframe', isGsiFrame(gsiFrame()) === true);
check('isGsiFrame: an iframe from anywhere else is not', isGsiFrame(el('IFRAME', { src: 'https://maps.google.com/embed' })) === false);
check('isGsiFrame: a DIV, null and undefined are not', !isGsiFrame(el('DIV')) && !isGsiFrame(null) && !isGsiFrame(undefined));

const steal = scenario({ next: gsiFrame() });
check('the city INPUT loses focus to Google\'s iframe → it is focused again, once', steal.field.focusCalls === 1);
check('  …the check was DEFERRED (the frame owns focus only after focusout has dispatched)', steal.deferred === 1);
check('a TEXTAREA (the agent composer) is protected too', scenario({ fieldTag: 'TEXTAREA', next: gsiFrame() }).field.focusCalls === 1);
check('a contenteditable field is protected too', scenario({ fieldTag: 'DIV', contentEditable: true, next: gsiFrame() }).field.focusCalls === 1);
check('the visitor really leaves the field (focus on the body) → NOT dragged back', scenario({ next: el('BODY') }).field.focusCalls === 0);
check('the visitor taps a button → NOT dragged back', scenario({ next: el('BUTTON') }).field.focusCalls === 0);
check('the visitor moves to another field → NOT dragged back', scenario({ next: el('INPUT') }).field.focusCalls === 0);
check('a field no longer in the document is never focused', scenario({ next: gsiFrame(), removed: true }).field.focusCalls === 0);
check('the steal comes 1.5 s after the tap into the field → still refocused (inside the typing window)', scenario({ next: gsiFrame(), idleMs: 1500 }).field.focusCalls === 1);
check('the visitor typed 5 s ago and then focus moves to the sheet → NOT dragged back (a deliberate tap is honoured)', scenario({ next: gsiFrame(), idleMs: TYPING_WINDOW_MS + 3000 }).field.focusCalls === 0);
check('a keystroke renews the window: tap at t, key at t+4 s, steal 800 ms later → refocused', scenario({ next: gsiFrame(), keyAt: 4000, idleMs: 800 }).field.focusCalls === 1);
check('the window is 2 s (a human types a character well inside it)', TYPING_WINDOW_MS === 2000);
check('a non-field losing focus (a button) is ignored even when the frame wins', (() => {
  const doc = fakeDoc(); const q: Array<() => void> = []; installTypingGuard(doc, (fn) => q.push(fn));
  const btn = el('BUTTON'); doc.nodes.add(btn); doc.dispatch('focusout', { target: btn }); doc.activeElement = gsiFrame(); q.forEach((fn) => fn());
  return btn.focusCalls === 0 && q.length === 0;
})());
check('teardown removes every listener (no guard after the component unmounts)', (() => {
  const s = scenario({ next: gsiFrame() }); s.stop(); return s.doc.listenerCount('focusout') === 0 && s.doc.listenerCount('focusin') === 0 && s.doc.listenerCount('keydown') === 0;
})());

// Mutations, executed: the two ways the guard could decay.
const neverRefocus = (doc: any) => { doc.addEventListener('focusout', () => {}); return () => {}; };
const ignoresTheWindow = (doc: any, schedule: any) => { doc.addEventListener('focusout', (e: any) => schedule(() => { if (isGsiFrame(doc.activeElement)) e.target.focus(); })); return () => {}; };
const alwaysRefocus = (doc: any, schedule: any) => { doc.addEventListener('focusout', (e: any) => schedule(() => e.target.focus())); return () => {}; };
mustCatch('a guard that never refocuses', (() => {
  const doc = fakeDoc(); const q: Array<() => void> = []; neverRefocus(doc); const f = el('INPUT'); doc.nodes.add(f); doc.dispatch('focusout', { target: f }); doc.activeElement = gsiFrame(); q.forEach((fn) => fn());
  return f.focusCalls === 0 && steal.field.focusCalls === 1;
})());
mustCatch('a guard that ignores the typing window (drags back a visitor who stopped typing long ago)', (() => {
  const doc = fakeDoc(); const q: Array<() => void> = []; ignoresTheWindow(doc, (fn: any) => q.push(fn)); const f = el('INPUT'); doc.nodes.add(f); doc.dispatch('focusout', { target: f }); doc.activeElement = gsiFrame(); q.forEach((fn) => fn());
  return f.focusCalls === 1 && scenario({ next: gsiFrame(), idleMs: TYPING_WINDOW_MS + 3000 }).field.focusCalls === 0;
})());
mustCatch('a guard that drags the visitor back from the body', (() => {
  const doc = fakeDoc(); const q: Array<() => void> = []; alwaysRefocus(doc, (fn: any) => q.push(fn)); const f = el('INPUT'); doc.nodes.add(f); doc.dispatch('focusout', { target: f }); doc.activeElement = el('BODY'); q.forEach((fn) => fn());
  return f.focusCalls === 1 && scenario({ next: el('BODY') }).field.focusCalls === 0;
})());

// The component installs the guard in the prompt effect and tears it down with it.
const src = readFileSync(FILE, 'utf8');
check('GoogleOneTap installs the guard on the real document in the prompt effect', /const stopTypingGuard = installTypingGuard\(document\);/.test(src));
check('…and tears it down in the effect cleanup', /return \(\) => \{ cancelled = true; stopTypingGuard\(\);/.test(src));
check('the guard never calls google.accounts.id.cancel() (a dismissal would start the cooldown)', !/installTypingGuard[\s\S]*?cancel\(\)[\s\S]*?^\}$/m.test(src.slice(src.indexOf('export function installTypingGuard('), src.indexOf('export function installTypingGuard(') + 1200)));

console.log(failed ? `\n❌ verify-one-tap-gives-the-keyboard-back: ${failed} check(s) failed` : '\n✓ a typing visitor keeps the keyboard when One Tap\'s iframe takes focus; a visitor who left the field is never dragged back');
process.exit(failed ? 1 : 0);
