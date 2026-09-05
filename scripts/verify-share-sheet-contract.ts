// SHARE SHEET — one link per post, and one theme for the whole sheet.
//
// Two owner-journey defects, 2026-09-04:
//   • ops_incident hunt-2026-09-04:modal:10 — X and Telegram pre-filled the composer with the
//     Ezhalah URL TWICE: the message text already ended with the link, and the intent URL passed it
//     AGAIN as `url=`. WhatsApp/Mail were correct (they have no url parameter, so their link must
//     live inside the text) — which is why this is per-target, not one blunt rule.
//   • ops_incident hunt-2026-09-04:theme:09 — the sheet rendered half-light/half-dark: `card` and
//     `grip` were raw hex while the preview / Copy Link / Cancel panels nested inside them used
//     colors.surface, which resolves to var(--ez-surface) and repaints near-black in dark mode.
//
// The link rule is proven by EXECUTING the component's own expressions — the LINK constant, the
// bilingual `lead`, `msg`, the four encodeURIComponent() lines and the four intent-URL template
// literals are extracted from ShareSheet.tsx and evaluated verbatim, per locale — so this measures
// the URL a user's composer actually receives, not the shape of the source that builds it.
//
// WHY THE THEME CHECK IS SCOPED TO THIS COMPONENT. A repo-wide "no raw hex in a themed component"
// rule was measured before writing this: 90 raw color literals across 11 token-importing files (50
// of them backgroundColor). All but two are legitimate — ResultCard's 28 per-platform brand badges,
// AuthModal's deliberate replicas of Google/Apple sign-in chrome, Sidebar's `dks` dark-override
// sheet (dark literals by design), and `color: '#fff'` on solid green fills (which is really
// onFill). A repo-wide check would be ~48 allowlist entries and 2 findings — an exemption list
// wearing a barrier's clothes. So this pins the SHAPE for the component that shipped the bug: every
// color in ShareSheet's StyleSheet must be a palette token, with zero exemptions.
//
//   node --experimental-strip-types scripts/verify-share-sheet-contract.ts   (auto-discovered by npm test)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lightColors, darkColors } from '../src/theme/palette.ts';

const root = join(import.meta.dirname, '..');
const src = readFileSync(join(root, 'src/components/ShareSheet.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failed++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};
let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFail++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

console.log('\nShare sheet — exactly one link per target, one theme for the whole surface\n');

// ── extract the REAL expressions (never a re-typed copy of them) ────────────────────────────────
const stmt = (name: string): string => {
  const m = new RegExp(`const ${name} = [\\s\\S]*?;`).exec(src);
  if (!m) { check(`ShareSheet declares \`${name}\``, false, 'declaration not found — the extraction below cannot run'); return `const ${name} = undefined;`; }
  return m[0];
};
const LINK = /const LINK = '([^']+)';/.exec(src)?.[1] ?? '';
check('the share LINK is a real absolute URL', /^https:\/\/\S+$/.test(LINK), LINK || '(missing)');

// name → the intent-URL template literal, exactly as the component writes it.
const targets: [string, string][] = [];
for (const m of src.matchAll(/\{ name: (?:t\('([^']+)'\)|'([^']+)'),[\s\S]*?openShare\((\x60[^\x60]+\x60)\)/g)) {
  targets.push([(m[1] ?? m[2])!, m[3]!]);
}
check('all four share targets were extracted (WhatsApp / X / Telegram / Mail)',
  targets.length === 4 && ['WhatsApp', 'X', 'Telegram', 'Mail'].every((n) => targets.some(([k]) => k === n)),
  targets.map(([k]) => k).join(', '));

const body = [
  stmt('LINK'), stmt('lead'), stmt('msg'),
  stmt('text'), stmt('textNoLink'), stmt('link'), stmt('subject'),
  `return { msg, text, textNoLink, link, urls: { ${targets.map(([n, tpl]) => `${JSON.stringify(n)}: ${tpl}`).join(', ')} } };`,
].join('\n');
const build = new Function('locale', 't', body) as (locale: string, t: (s: string) => string) => {
  msg: string; text: string; textNoLink: string; link: string; urls: Record<string, string>;
};

const occurrences = (hay: string, needle: string) => hay.split(needle).length - 1;

// ── 1. EXECUTED: exactly one link in what the composer receives, in BOTH languages ──────────────
for (const locale of ['ar', 'en'] as const) {
  const out = build(locale, (s) => s);
  check(`[${locale}] the message itself carries the link exactly once (Copy Link / WhatsApp / Mail body)`,
    occurrences(out.msg, LINK) === 1, out.msg);
  for (const [name, url] of Object.entries(out.urls)) {
    const composed = decodeURIComponent(url);
    check(`[${locale}] ${name}: the composed post contains the link EXACTLY ONCE`,
      occurrences(composed, LINK) === 1, `${occurrences(composed, LINK)}× — ${composed}`);
  }
  // Per-target convention, not one blunt rule: a target with no url parameter must carry the link
  // in its text; a target that takes the link separately must NOT repeat it in its text.
  check(`[${locale}] WhatsApp has no url= parameter, so its text= carries the link`,
    !/[?&]url=/.test(out.urls.WhatsApp) && occurrences(decodeURIComponent(out.urls.WhatsApp), LINK) === 1);
  check(`[${locale}] Mail has no url= parameter, so its body= carries the link`,
    !/[?&]url=/.test(out.urls.Mail) && occurrences(decodeURIComponent(out.urls.Mail), LINK) === 1);
  for (const name of ['X', 'Telegram'] as const) {
    const u = new URL(out.urls[name]);
    check(`[${locale}] ${name}: url= is the link and text= is the sentence WITHOUT it`,
      u.searchParams.get('url') === LINK && !(u.searchParams.get('text') ?? '').includes(LINK),
      `text=${u.searchParams.get('text')}`);
  }
  check(`[${locale}] the sentence is still in the user's own language`,
    locale === 'ar' ? /[؀-ۿ]/.test(out.msg) : /^Ezhalah/.test(out.msg));
}

// mutation — the exact defect: hand the url=-carrying targets the link-bearing text as well.
{
  const out = build('en', (s) => s);
  const brokenX = `https://twitter.com/intent/tweet?text=${out.text}&url=${out.link}`;
  const brokenTg = `https://t.me/share/url?url=${out.link}&text=${out.text}`;
  mustCatch('X posting the link twice (text= already ends with it, url= repeats it)',
    occurrences(decodeURIComponent(brokenX), LINK) !== 1);
  mustCatch('Telegram posting the link twice',
    occurrences(decodeURIComponent(brokenTg), LINK) !== 1);
  // …and the opposite over-correction: stripping the link from WhatsApp, which has nowhere else to put it.
  const brokenWa = `https://wa.me/?text=${out.textNoLink}`;
  mustCatch('WhatsApp losing the link entirely (it has no url= parameter)',
    occurrences(decodeURIComponent(brokenWa), LINK) !== 1);
}

// ── 2. the whole sheet is themed — every color in its StyleSheet is a palette token ─────────────
const sheet = src.slice(src.indexOf('const s = StyleSheet.create('));
check('the module-scope StyleSheet was located', sheet.length > 200);

const RAW_COLOR = /'#[0-9a-fA-F]{3,8}'|'rgba?\([^']*\)'/g;
const rawInSheet = (block: string) => block.replace(/^\s*\/\/.*$/gm, '').match(RAW_COLOR) ?? [];
check('NO raw color literal anywhere in the sheet (card, grip and backdrop included)',
  rawInSheet(sheet).length === 0, rawInSheet(sheet).join(', '));
mustCatch('the raw-hex card body coming back',
  rawInSheet("card: { backgroundColor: '#f2f2f5', borderTopLeftRadius: 22 },").length > 0);
mustCatch('a raw rgba backdrop coming back',
  rawInSheet("backdrop: { backgroundColor: 'rgba(8,18,12,0.4)' },").length > 0);

// EXECUTED against the real palettes: every token the sheet names exists, and the surfaces that
// shipped light-only genuinely re-skin (a token identical in both themes would repaint nothing).
const used = [...new Set([...sheet.matchAll(/colors\.(\w+)/g)].map((m) => m[1]!))];
check('every token the sheet uses is a real palette key', used.every((k) => k in lightColors),
  used.filter((k) => !(k in lightColors)).join(', '));
for (const [key, why] of [['card', 'the sheet body'], ['grip', 'the grab handle'], ['backdrop', 'the backdrop']] as const) {
  const token = new RegExp(`${key}: \\{[^}]*backgroundColor: colors\\.(\\w+)`).exec(sheet)?.[1] ?? '';
  const reskins = token in lightColors && lightColors[token as keyof typeof lightColors] !== darkColors[token as keyof typeof lightColors];
  check(`${why} uses a token that actually re-skins in dark (colors.${token || '?'})`, reskins,
    token ? `light=${lightColors[token as keyof typeof lightColors]} dark=${darkColors[token as keyof typeof lightColors]}` : 'no token found');
}
mustCatch('a token that is identical in both themes being used as the sheet ground',
  lightColors.onFill === darkColors.onFill);

// The nested panels are what the card must agree with — pin that they are still tokens, so a future
// edit cannot "fix" a mismatch by pushing the panels back to literals instead.
check('the panels inside the card are still colors.surface (preview / rows / cancel)',
  (sheet.match(/backgroundColor: colors\.surface\b/g) ?? []).length >= 3);
// The one place raw colors are legitimate: the share targets' own brand fills, which are BRAND
// identity, not theme — and they live in the component body, never in the StyleSheet.
check('brand fills stay inline on the target buttons (never in the themed sheet)',
  /bg: '#25d366'/.test(src) && !/appIc: \{[^}]*backgroundColor: '#/.test(sheet));

if (mutFail) { console.error(`\n✗ ${mutFail} guard(s) are BLIND to their own defect\n`); process.exit(1); }
console.log(failed === 0
  ? '\n✓ one link per target, and the whole sheet follows the resolved theme\n'
  : `\n✗ ${failed} check(s) FAILED — the share sheet contract is broken\n`);
process.exit(failed === 0 ? 0 : 1);
