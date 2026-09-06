// TRIPWIRE: the AI-chat composer must behave like ChatGPT on a phone (owner 2026-08-19).
//
// WHY THIS EXISTS. On mobile WEB (iPhone Safari / Android Chrome — the surface ezhalah-app.vercel.app
// actually runs on for phones), the composer had three latent regressions the desktop path hid:
//
//   1. KeyboardAvoidingView is a NO-OP off iOS-native (its `behavior` is undefined), so when the
//      on-screen keyboard opened the layout viewport was unchanged and the composer sat HIDDEN behind
//      the keyboard. The fix tracks window.visualViewport and lifts the column by the real keyboard
//      height (kbInset) — no hardcoded numbers.
//   2. An input fontSize < 16px makes mobile Safari/Chrome auto-zoom the page on focus and never zoom
//      back out — the single worst mobile-web chat bug. The input must be >= 16px on web.
//   3. An autoFocus / mount-time .focus() would pop the keyboard open on page load. The owner's brief
//      is explicit: the keyboard opens ONLY when the user taps the input. So NO autofocus may exist.
//
// This is a hermetic source-parse of src/app/agent.tsx — it needs no browser and no network, so it
// runs in `npm test` on every CI. It locks in the contract; a future refactor that drops any guarantee
// fails here instead of silently shipping the phone bug again.
//
//   node --experimental-strip-types scripts/verify-mobile-composer-keyboard.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const src = readFileSync(new URL('../src/app/agent.tsx', import.meta.url), 'utf8');
// Strip line comments so a guarantee mentioned only in prose can never satisfy a check.
const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

// ── 1. NO auto-open on page load ─────────────────────────────────────────────────────────────────
check('1a. the composer has NO autoFocus (keyboard must not open on load)',
  !/\bautoFocus\b/i.test(code),
  'autoFocus would pop the keyboard the moment the chat screen loads — owner brief: opens on TAP only');
// A mount-time focus() call is the other way to force the keyboard open. Any inputRef.current.focus()
// is suspicious; there is legitimately none today.
check('1b. the input is never programmatically focused (no inputRef.current.focus())',
  !/inputRef\.current\??\.focus\s*\(/.test(code),
  'a mount effect calling focus() would auto-open the keyboard');

// ── 2. real keyboard tracking via visualViewport, no hardcoded height ────────────────────────────
// RETARGETED 2026-09-05, not relaxed. These three checks required agent.tsx to read visualViewport
// ITSELF, and that turned out to be only half of the problem: compensating for the shrinking visual
// viewport put the composer in the right place while iOS ALSO scrolled the layout viewport, so the
// conversation above it slid off the top of the screen (owner: "i basically lose the conversation
// above it"). The mechanism moved to lib/visualViewportFrame.ts and is applied once at the app root,
// so it now fixes every screen instead of this one — and a screen keeping its own copy would
// compensate TWICE, measured live as a 259px gap. The invariant is unchanged and is asserted here
// against the module that now owns it: measured, never hardcoded, and listening to both events.
// The geometry itself is EXECUTED across 64 phone/keyboard/scroll combinations by
// scripts/verify-mobile-keyboard-layout.ts, which is strictly stronger than these greps.
const frame = readFileSync('src/lib/visualViewportFrame.ts', 'utf8');
check('2a. mobile keyboard geometry is read from window.visualViewport (not hardcoded)',
  /window\.visualViewport/.test(frame));
check('2b. it listens to BOTH resize and scroll on the visual viewport (keyboard animates smoothly)',
  /addEventListener\(['"]resize['"]/.test(frame) && /addEventListener\(['"]scroll['"]/.test(frame));
check('2c. the root frame is derived from the live viewport, never a fixed pixel guess',
  /visualHeight: vv\.height, visualOffsetTop: vv\.offsetTop/.test(frame)
  && !/=\s*\d{2,}\s*;\s*\/\/\s*keyboard/i.test(frame),
  'the frame must be real geometry, never a magic number');
check('2d. the screen contributes no keyboard padding of its own (no double lift)',
  /const kbInset = screenKeyboardInset\(\);/.test(code));
// The lift must actually be applied to the KeyboardAvoidingView, and only on web.
check('2d. the KeyboardAvoidingView is lifted by kbInset on web (composer sits ABOVE the keyboard)',
  /IS_WEB\s*&&\s*kbInset\s*>\s*0\s*\?\s*\{\s*paddingBottom:\s*kbInset/.test(code),
  'without this the composer stays hidden behind the on-screen keyboard on mobile web');

// ── 3. no mobile focus-zoom: input font >= 16 on web ─────────────────────────────────────────────
const inputStyle = code.match(/^\s*input:\s*\{[^}]*\}/m)?.[0] ?? '';
check('3a. found the composer input style', inputStyle.length > 0);
// Accept an explicit >=16 web branch. Reject a bare fontSize < 16 with no web override.
const webFont = inputStyle.match(/fontSize:\s*Platform\.OS\s*===\s*['"]web['"]\s*\?\s*(\d+)/);
check('3b. the input font is >= 16px on web (mobile Safari/Chrome zoom under 16 and never zoom back)',
  !!webFont && Number(webFont[1]) >= 16,
  webFont ? `web fontSize = ${webFont[1]}` : 'no web-specific fontSize branch — a bare <16px value auto-zooms mobile');
check('3c. the input scrolls internally once it hits its max height (overflowY on web)',
  /overflowY:\s*['"]auto['"]/.test(inputStyle),
  'a grown multiline textarea must scroll inside itself, not push the layout');

// ── 4. keyboard stays open while chatting (web) ──────────────────────────────────────────────────
check('4. blurOnSubmit is false on web so the keyboard stays open between messages',
  /blurOnSubmit=\{!IS_WEB\}/.test(code) || /blurOnSubmit=\{false\}/.test(code),
  'blurOnSubmit={true} would dismiss the keyboard after each send — not the ChatGPT feel');

console.log(failures === 0
  ? '\n✓ the mobile-web chat composer keeps every ChatGPT-style keyboard guarantee\n'
  : `\n✗ ${failures} check(s) FAILED — a mobile keyboard regression would ship\n`);
process.exit(failures === 0 ? 0 : 1);
