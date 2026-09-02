// THE TEST FIXTURE MUST NOT RESURRECT A SESSION THE APP DELIBERATELY DESTROYED.
//
// `e2e/journeys/harness.mjs` seeds a signed-in session by writing the Supabase auth token into
// localStorage from a Playwright init script. That script re-runs on EVERY document — every
// navigation and every `page.reload()`. Writing the token unconditionally therefore signs the user
// back in after any sign-out or account deletion, which is not a cosmetic fixture wart:
//
//   · it FABRICATES failures. Measured 2026-09-02 (routine #6): `signout-leaves-no-trace` went red
//     4/4 — both viewports, fresh contexts each — on "the previous account's chats came back after a
//     reload", while the product was entirely correct. A direct probe of the key across the flow
//     settled it (PART 9.1's required positive proof that a reproducible failure is harness):
//         seeded                      → authToken PRESENT, chrome signed-in
//         after sign-out, pre-reload  → authToken ABSENT,  chrome guest      ← the app did its job
//         after reload                → authToken PRESENT, chrome signed-in  ← only the fixture writes it
//
//   · and it HIDES real ones, which is worse (PART 9's second and costlier error). A genuine
//     "sign-out doesn't stick" regression looks EXACTLY like this fixture's own behaviour, so it
//     would have been invisible to every sign-out and account-deletion journey, forever.
//
// The lesson was already learned in this same file for the HISTORY seed — "Seed ONCE per context …
// re-seeding on a reload would wipe the very change a persistence journey just made" — and applied
// to only one of the two keys. This barrier pins the CLASS: every key the fixture seeds is seeded
// once per context, checked by EXECUTING the real init script against a fake localStorage rather
// than string-matching it.
//
// Run: node --experimental-strip-types scripts/verify-journey-fixture-session-seed.ts
import { seedInitScript } from '../e2e/journeys/harness.mjs';

const AUTH_KEY = 'sb-aannarbkwcymrotzwdbo-auth-token';
const SENTINEL = '__ez_qa_session_seeded';
const SUB = 'qa@ezhalah.test';
const SESS = { access_token: 'fake' };
const HIST = [{ id: 'h1', title: 'عقارات الرياض' }];

let failed = 0;
const ok = (m: string) => console.log(`  ok  ${m}`);
const check = (m: string, cond: boolean) => { if (cond) ok(m); else { console.error(`  FAIL  ${m}`); failed++; } };

/** A localStorage good enough for the init script, plus the origin gate it checks first. */
function makeEnv(protocol = 'https:') {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
  };
  (globalThis as Record<string, unknown>).localStorage = store;
  (globalThis as Record<string, unknown>).location = { protocol };
  return map;
}
/** One document load: the init script runs exactly once per navigation. */
const navigate = (wantAuth = true, hist: unknown = HIST) => seedInitScript([SESS, hist, SUB, wantAuth]);

// ── 1. the first load seeds ─────────────────────────────────────────────────────────────────────
let m = makeEnv();
navigate();
check('a fresh context is seeded with the auth token', m.get(AUTH_KEY) === JSON.stringify(SESS));
check('a fresh context is seeded with the history', m.get('history:' + SUB) === JSON.stringify(HIST));
check('hasSeenIntro is set so the intro never eats a journey', m.get('hasSeenIntro') === '1');

// ── 2. THE REGRESSION: sign out, then navigate again ────────────────────────────────────────────
// This is the exact sequence that produced the 4/4 false positive. supabase.auth.signOut() removes
// the token; store.tsx's signOut() clears the guest bucket. The next document must NOT undo that.
m.delete(AUTH_KEY);
navigate();
check('after a sign-out, a reload does NOT resurrect the auth token', m.get(AUTH_KEY) === undefined);
check('the account\'s own saved history still survives (the re-login restore contract)',
  m.get('history:' + SUB) === JSON.stringify(HIST));

// And it must stay dead across several more navigations, not just the next one.
navigate(); navigate();
check('the session stays signed out across repeated navigations', m.get(AUTH_KEY) === undefined);

// ── 3. the seed is once-per-context, not once-per-absence ───────────────────────────────────────
// The tempting wrong fix is `if (!localStorage.getItem(AUTH_KEY)) seed()`. It passes check 1 and
// FAILS check 2, because after a sign-out the token is legitimately absent. Prove the guard in the
// shipped code is not that one, by showing the sentinel — not the token — is what gates it.
m = makeEnv();
navigate();
check('seeding records a sentinel distinct from the auth token itself', m.get(SENTINEL) === '1' && SENTINEL !== AUTH_KEY);
m.delete(SENTINEL);
m.delete(AUTH_KEY);
navigate();
check('clearing the sentinel re-arms seeding (so the guard is really the sentinel, not the token)',
  m.get(AUTH_KEY) === JSON.stringify(SESS));

// ── 4. the history seed keeps its own once-per-context guarantee ────────────────────────────────
// The sidebar/persistence journeys rename, delete, star and reorder, then reload and re-assert.
// Re-seeding history would wipe the change under test and turn every one of them into a false pass.
m = makeEnv();
navigate();
m.set('history:' + SUB, JSON.stringify([{ id: 'h1', title: 'RENAMED BY THE JOURNEY' }]));
navigate();
check('a reload does NOT overwrite history the journey just changed',
  JSON.parse(m.get('history:' + SUB)!)[0].title === 'RENAMED BY THE JOURNEY');

// ── 5. the guest and about:blank paths are unchanged ────────────────────────────────────────────
m = makeEnv();
navigate(false);
check('a guest context is never given an auth token', m.get(AUTH_KEY) === undefined);
check('a guest context still gets hasSeenIntro', m.get('hasSeenIntro') === '1');

m = makeEnv('about:');
navigate();
check('about:blank writes nothing (the SecurityError → false pageErrors defect stays fixed)', m.size === 0);

console.log(failed
  ? `\nFAIL: ${failed} check(s) failed — the fixture can resurrect or clobber state it must not touch.`
  : '\nPASS: every fixture-seeded key is seeded once per context; sign-out sticks and journey edits survive.');
process.exit(failed ? 1 : 0);
