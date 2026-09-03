#!/usr/bin/env -S node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
/**
 * verify-info-routes-single-source — auto-discovered barrier (scripts/run-tests.mjs).
 *
 * THERE IS EXACTLY ONE About experience and EXACTLY ONE Support experience, and both live in
 * src/components/InfoModal.tsx. src/app/about.tsx and src/app/support.tsx are doors: they raise the
 * canonical modal and replace the URL with '/'.
 *
 * WHY (owner, 2026-09-03: "fix the orphan /support and /about routes so users can never reach
 * stale/contradictory old UI... Add a permanent barrier so those routes cannot drift from the real
 * UI again"). Those two routes each rendered their own prototype-era page. Nothing in the app linked
 * to them — the sidebar and account menu open InfoModal — so they were invisible to everyone editing
 * the real screens, and they drifted:
 *   • /support still showed a dead «write to support@ezhalah.com yourself» card a day after the
 *     canonical Support screen became a working message form;
 *   • /about still showed the pre-redesign plain-text page, INCLUDING its own stale copy of the
 *     licensing, disclaimer and privacy statements — a second place where legal text has to be
 *     corrected, and one that no correction ever reached.
 * A duplicate nobody links to is worse than a broken link: it looks maintained, and it is reachable
 * by URL, by an old bookmark, and by anything that remembers the route.
 *
 * WHAT THIS PINS. The doors can only be doors — a route that cannot hold copy cannot contradict the
 * screen it replaces — and no THIRD copy can appear anywhere else:
 *   1. each door raises the canonical modal for its own kind, and replaces (never pushes) the URL;
 *   2. neither door can render copy: no translator, no <Text>, no stylesheet, no address literal;
 *   3. the URLs keep working — both routes stay registered in the navigator, unanimated;
 *   4. InfoModal is still the real thing (both addresses, the form, the About sections);
 *   5. NO other file in src/ may carry a support/partners address — the general anti-duplication rule
 *      that catches the next copy wherever someone puts it;
 *   6. the in-app entry points still open the modal, and nothing navigates to the door routes.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SUPPORT = 'src/app/support.tsx';
const ABOUT = 'src/app/about.tsx';
const INFO = 'src/components/InfoModal.tsx';
const LAYOUT = 'src/app/_layout.tsx';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

const read = (p: string) => readFileSync(p, 'utf8');

// A COMMENT IS NOT A CODE PATH. Both door files carry a long header explaining why they are doors,
// and the first version of the checks below read the raw text: commenting out `openModal('support')`
// or `router.replace('/')` left the substring in the file and the barrier passed on a door that no
// longer opened anything. Every structural check about what a door DOES runs on this instead.
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');

const support = code(read(SUPPORT));
const about = code(read(ABOUT));
const info = read(INFO);
const layout = read(LAYOUT);

// ── 1. each door opens the canonical modal for its OWN kind, and REPLACES the URL ────────────────
for (const [file, src, kind] of [[SUPPORT, support, 'support'], [ABOUT, about, 'about']] as const) {
  check(`${file} raises the canonical modal (openModal('${kind}'))`, src.includes(`openModal('${kind}')`));
  check(`${file} does not open the OTHER kind`,
    !src.includes(`openModal('${kind === 'support' ? 'about' : 'support'}')`));
  // replace, not push: Back from the home screen must not bounce the user into the redirect again.
  check(`${file} replaces the URL with '/' (never push)`,
    /router\.replace\('\/'\)/.test(src) && !/router\.push\(/.test(src));
  // The modal must be raised BEFORE the navigation, or the user sees a frame of bare page.
  check(`${file} raises the modal before navigating`,
    src.indexOf(`openModal('${kind}')`) < src.indexOf("router.replace('/')"));
}

// ── 2. a door cannot hold copy ───────────────────────────────────────────────────────────────────
// This is the whole anti-drift mechanism: no translator, no text node, no stylesheet, no address.
// Anyone re-growing a page here trips this before it can contradict the canonical screen.
const EMAIL_RE = /[a-z0-9._%+-]+@ezhalah\.com/i;
for (const [file, src] of [[SUPPORT, support], [ABOUT, about]] as const) {
  check(`${file} renders no translated copy (no useI18n)`, !/useI18n/.test(src));
  check(`${file} renders no text node (no <Text)`, !/<Text[\s/>]/.test(src));
  check(`${file} declares no styles of its own (no StyleSheet.create)`, !/StyleSheet\.create/.test(src));
  check(`${file} carries no email address`, !EMAIL_RE.test(src));
  check(`${file} carries no ScrollView (a door has nothing to scroll)`, !/ScrollView/.test(src));
}

// ── 3. the URLs keep working ─────────────────────────────────────────────────────────────────────
// Deleting the routes would 404 an old bookmark; the point is to REDIRECT it, not to break it.
for (const name of ['about', 'support']) {
  check(`${LAYOUT} still registers the /${name} route (an old bookmark must still resolve)`,
    new RegExp(`<Stack\\.Screen\\s+name="${name}"`).test(layout));
  // A sheet presentation would slide an empty modal up and immediately back down.
  check(`/${name} is not presented as an animated sheet`,
    !new RegExp(`<Stack\\.Screen\\s+name="${name}"[^>]*presentation:\\s*'(modal|transparentModal)'`).test(layout));
}

// ── 4. the canonical surface is still the real thing ─────────────────────────────────────────────
check(`${INFO} holds the support form (subject/message/send states)`,
  /useState<'idle' \| 'sending' \| 'sent' \| 'error'>/.test(info) && info.includes('<SupportForm t={t} />'));
check(`${INFO} holds the partnerships address`, info.includes('partners@ezhalah.com'));
check(`${INFO} holds the About copy`,
  ["'About Us'", "'Our role'", "'Disclaimer'"].filter((h) => info.includes(h)).length >= 2);

// ── 5. no THIRD copy, anywhere in src/ ───────────────────────────────────────────────────────────
// The address literal is the tell: every duplicate Support surface this repo has had carried one.
// i18n.tsx is the dictionary, not a surface, and holds no address — so the rule is simply: only the
// canonical component may name an Ezhalah address.
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}
const strays = walk('src').filter((f) => f !== INFO && EMAIL_RE.test(read(f)));
check('only the canonical InfoModal names an @ezhalah.com address in src/', strays.length === 0, strays.join(', '));

// ── 6. the in-app entry points open the MODAL, and nothing navigates to a door ───────────────────
const sidebar = read('src/components/Sidebar.tsx');
check('the sidebar opens the modal (openInfo → openModal), not a route',
  /openInfo\('support'\)/.test(sidebar) && /openInfo\('about'\)/.test(sidebar));
const navigators = walk('src').filter((f) => f !== SUPPORT && f !== ABOUT
  && /router\.(push|replace|navigate)\(\s*['"]\/(about|support)['"]/.test(read(f)));
check('nothing in the app navigates to /about or /support (they are doors for URLs only)',
  navigators.length === 0, navigators.join(', '));

if (failed) {
  console.error(`\n${failed} check(s) FAILED — the info routes may have grown a second, drifting UI`);
  process.exit(1);
}
console.log('\nOK — one About surface, one Support surface; /about and /support are doors that cannot drift.');
