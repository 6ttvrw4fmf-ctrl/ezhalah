// NO PUBLIC TEST-CRASH SURFACE IN PRODUCTION (owner cert 2026-08-29)
//
// The Sentry E2E certification on 2026-08-29 proved the client → Sentry pipeline works. The tempting
// but wrong way to keep proving it is a "debug crash button" or a `?crash=1` route that anyone can
// hit. That is a UX cliff (curious users click it and think the app is broken), a paging cliff (an
// automated scanner hitting it burns your Sentry quota), and a certification cliff (real crash
// signal drowned in synthetic noise). This barrier makes sure no such surface ever ships.
//
// It is a source-shape barrier — the goal is to catch the SHAPE that could ever be user-reachable,
// not to police every internal test file. Everything the certification actually did was via browser
// eval / Node scripts, never via app code, so main is clean today and this barrier keeps it clean.
//
// If a synthetic-error mechanism is ever genuinely needed in the app itself, gate it on a build-time
// env var that is only set in dev/preview, exit early in production, and add its filename to the
// allow-list at the bottom of this file with a one-line comment naming its owner and why.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

// Files this barrier explicitly allows to mention the patterns. Each entry is a repo-relative path
// with a one-line "why". Adding to this list is a REVIEWED act, never a rebase side-effect.
const ALLOWLIST: Record<string, string> = {
  // The barrier itself — its whole point is to name these patterns.
  'scripts/verify-no-public-test-crash-surface.ts': 'this file — the barrier defines the patterns it forbids',
  // The observability barriers reference the shape as counter-examples in their comments.
  'scripts/verify-observability-pdpl-scrub.ts': 'PDPL scrub tests use synthetic error events as fixtures',
  'scripts/verify-observability-web-actually-initializes.ts': 'checks the SDK actually initializes; may mention synthetic patterns in comments',
  // Route smoke tests deliberately assert nothing at these paths — comment only.
  'scripts/verify-sentry-routing-wired.ts': 'routing barrier — comments reference synthetic error shapes',
};

let failed = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? '\n      ' + detail : ''}`);
  if (!ok) failed++;
};

console.log('\nNo public test-crash surface in production (owner 2026-08-29)\n');

// Walk src/ recursively — the surface the user actually reaches.
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(join(ROOT, 'src'));

// Patterns that make an error reachable by ANY user of the app, whether they meant to or not.
type Pattern = { name: string; re: RegExp; hint: string };
const PATTERNS: Pattern[] = [
  { name: 'certification signature string', re: /EZHALAH_SENTRY_E2E/, hint: 'this repo\'s cert signature must NEVER be committed to app code — the cert runs from browser eval, not shipped code' },
  { name: 'debug crash button (onPress throw)', re: /onPress=\{\s*\(\s*\)\s*=>\s*\{\s*throw\b/, hint: 'a Pressable that unconditionally throws is a user-reachable crash surface' },
  { name: 'debug crash button (onClick throw)', re: /onClick=\{\s*\(\s*\)\s*=>\s*\{\s*throw\b/, hint: 'an element that unconditionally throws is a user-reachable crash surface' },
  // Query-string trigger like ?crash=1 or ?debug=throw that could unconditionally throw
  { name: 'query-string crash trigger', re: /(searchParams|useSearchParams|useLocalSearchParams|location\.search)[^{]{0,120}\?[^{]{0,60}\bthrow\b/, hint: 'a route that throws when a query param is present — publicly reachable by URL' },
  // Debug route/screen that always throws
  { name: 'unconditional module-scope throw', re: /^\s*throw\s+new\s+Error\(/m, hint: 'a module-scope throw crashes any user who loads this file — never valid in a shipped route' },
];

const violations: string[] = [];
for (const abs of files) {
  const rel = relative(ROOT, abs);
  if (rel in ALLOWLIST) continue;
  const src = readFileSync(abs, 'utf8');
  for (const p of PATTERNS) {
    if (p.re.test(src)) {
      violations.push(`${rel} :: ${p.name} — ${p.hint}`);
    }
  }
}

check(
  'no user-reachable test-crash surface in src/',
  violations.length === 0,
  violations.length ? violations.slice(0, 10).map(v => '- ' + v).join('\n      ') : undefined,
);

// Every allow-list entry must actually exist — a stale allow-list would silently mask a real
// violation when a file is renamed or deleted.
for (const [rel, why] of Object.entries(ALLOWLIST)) {
  let exists = false;
  try { statSync(join(ROOT, rel)); exists = true; } catch { /* missing */ }
  check(`allow-list entry exists: ${rel} — ${why}`, exists);
}

// Sanity: the certification signature must NOT be in the built bundle either. This is a
// source-shape barrier, so we only look at the source tree — but if the string leaks into a
// generated file that ships, the pattern above catches it in the .ts source that generated it.
// Nothing further to do.

console.log(failed
  ? `\n✗ ${failed} check(s) FAILED — a public test-crash surface may be user-reachable`
  : `\n✓ No public test-crash surface in production — the Sentry cert stays a controlled event, never a live button`);
process.exit(failed ? 1 : 0);
