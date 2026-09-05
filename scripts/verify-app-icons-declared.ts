#!/usr/bin/env -S node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON
/**
 * verify-app-icons-declared — auto-discovered barrier (scripts/run-tests.mjs).
 *
 * WHY (owner, 2026-09-05: "i still see it"). The favicon WAS replaced and WAS live — the server
 * returned the new eagle with `must-revalidate` and a fresh etag — and the browser still showed
 * Expo's blue chevron. Two separate causes, both invisible from the server side:
 *   1. the page declared ONE icon, `<link rel="icon" href="/favicon.ico">`. Safari's Favorites,
 *      bookmarks and "Add to Home Screen" read apple-touch-icon; finding none declared it probed
 *      /apple-touch-icon.png, got a 404, and kept showing what it had remembered.
 *   2. a browser's favicon store is keyed by URL and does not honour revalidation, so new bytes at
 *      an unchanged path can stay invisible for a long time.
 * "It's just your cache" was true about the file and useless to the person looking at the wrong
 * logo. This pins the fix so neither cause can come back quietly.
 */
import { existsSync, readFileSync } from 'node:fs';

const HTML = 'src/app/+html.tsx';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

// A COMMENT IS NOT A CODE PATH — and this file's own comment quotes the very tag it explains
// (`<link rel="icon" href="/favicon.ico">`, the unversioned one Expo emits by itself). Scanning raw
// text found that quotation and failed the ?v= rule against a sentence. JSX comments are stripped
// so every rule below reads what the page actually RENDERS.
export const stripComments = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

export type IconLink = { rel: string; href: string };

export function parseIconLinks(src: string): IconLink[] {
  return [...stripComments(src).matchAll(/<link\s+rel="(icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)]
    .map((m) => ({ rel: m[1], href: m[2] }));
}

/** Every way the declared icon set can leave a browser showing a stale or missing icon. */
export function auditIcons(src: string, exists: (path: string) => boolean): string[] {
  const links = parseIconLinks(src);
  const bad: string[] = [];
  if (links.length === 0) bad.push('no icon is declared at all');
  if (!links.some((l) => l.rel === 'apple-touch-icon'))
    bad.push('no apple-touch-icon — Safari Favorites and iOS home screen keep whatever they remembered');
  if (!links.some((l) => l.rel === 'icon' && /\.png/.test(l.href)))
    bad.push('no PNG icon declared, only .ico');
  if (!links.some((l) => l.href.startsWith('/favicon.ico')))
    bad.push('/favicon.ico is not declared (oldest, widest support)');
  for (const l of links) {
    if (!/\?v=\d+/.test(l.href))
      bad.push(`${l.href} has no ?v= token — a favicon store is keyed by URL, so new bytes at an unchanged path stay invisible`);
    const path = l.href.split('?')[0].replace(/^\//, '');
    // Expo generates favicon.ico from app.json's `favicon` at build time; everything else is served
    // verbatim out of public/.
    const onDisk = path === 'favicon.ico' ? 'assets/images/favicon.png' : `public/${path}`;
    if (!exists(onDisk)) bad.push(`${l.href} points at a file that does not exist (${onDisk})`);
  }
  return bad;
}

// ── MUTATION PROOF (executable — this barrier is watched failing, not assumed to work) ───────────
const REAL = readFileSync(HTML, 'utf8');
const allExist = () => true;
const mustCatch = (label: string, broken: string[]) =>
  check(`mutation caught: ${label}`, broken.length > 0, 'the audit passed a deliberately broken head');

mustCatch('apple-touch-icon removed (the exact Safari bug this was written for)',
  auditIcons(REAL.replace(/<link rel="apple-touch-icon"[^>]*\/>/, ''), allExist));
mustCatch('every PNG icon removed, leaving only the .ico',
  auditIcons(REAL.replace(/<link rel="icon" type="image\/png"[^>]*\/>/g, ''), allExist));
mustCatch('the ?v= token dropped (new bytes, stale icon survives)',
  auditIcons(REAL.replace(/\?v=\d+/g, ''), allExist));
mustCatch('an icon points at a file that does not exist',
  auditIcons(REAL, (p) => !p.includes('apple-touch')));
mustCatch('no icons declared at all',
  auditIcons('<head></head>', allExist));
// …and the audit must PASS on a head that is actually correct, or the proofs above prove nothing.
check('the audit passes on the real, unmodified head', auditIcons(REAL, existsSync).length === 0,
  auditIcons(REAL, existsSync).join('; '));

// ── the live rules ───────────────────────────────────────────────────────────────────────────────
for (const problem of auditIcons(REAL, existsSync)) check(problem, false);
const links = parseIconLinks(REAL);
check('an apple-touch-icon is declared (Safari Favorites / iOS home screen read this one)',
  links.some((l) => l.rel === 'apple-touch-icon'));
check('every icon href carries a ?v= cache-busting token', links.every((l) => /\?v=\d+/.test(l.href)));

// iOS composites apple-touch-icon on BLACK and applies its own corner radius, so a transparent
// source shows black corners on the home screen.
const APPLE = 'public/apple-touch-icon.png';
check(`${APPLE} exists`, existsSync(APPLE));
if (existsSync(APPLE)) {
  const buf = readFileSync(APPLE);
  const colourType = buf[25];   // PNG IHDR colour type: 6 = RGBA, 4 = grey+alpha
  check('apple-touch-icon.png is OPAQUE (iOS paints transparency black)',
    colourType !== 6 && colourType !== 4, `PNG colour type ${colourType}`);
  check('apple-touch-icon.png is 180x180',
    buf.readUInt32BE(16) === 180 && buf.readUInt32BE(20) === 180,
    `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`);
}

if (failed) {
  console.error(`\n${failed} check(s) FAILED — a browser would fall back to a stale or missing icon`);
  process.exit(1);
}
console.log(`\nOK — ${links.length} icon link(s) declared, versioned, present on disk; 5 mutations caught.`);
