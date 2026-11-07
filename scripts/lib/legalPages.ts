// PUBLIC LEGAL PAGES — /privacy and /terms as real, static pages (owner launch audit 2026-11-05, backlog 1362:
// «App stores and Google sign-in need a public privacy-policy URL. Serve both as real pages (same text, Arabic +
// English), prove them live»). Until 2026-11-06 both URLs answered 404: the only legal reader was the in-app
// InfoModal, which a store reviewer or Google's consent screen cannot open.
//
// ONE SOURCE OF TEXT. The words are src/data/legal.ts (Arabic, the policy) and src/data/legalEnglish.ts (its
// section-for-section translation) — nothing here is written by hand. public/privacy.html and public/terms.html are
// GENERATED copies (scripts/build-legal-pages.ts) and scripts/verify-legal-pages-match-source.ts fails the suite
// the moment they differ from what this renderer produces from the current source, so the static copy cannot drift
// the way the old /about door did. The contact token {{CONTACT_EMAIL}} is substituted exactly as InfoModal.tsx's
// LegalBody does: admin@ for the Privacy Policy, partners@ for the Terms of Use.
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

export type LegalDocs = { terms: string[]; privacy: string[] };
export type LegalKind = 'privacy' | 'terms';

export const CONTACT: Record<LegalKind, string> = { privacy: 'admin@ezhalah.com', terms: 'partners@ezhalah.com' };
export const OUTPUT: Record<LegalKind, string> = { privacy: 'public/privacy.html', terms: 'public/terms.html' };

const read = (root: string, path: string) => readFileSync(`${root}/${path}`, 'utf8');
// The data modules are plain TS objects; evaluate them without a bundler (same trick as verify-english-support-legal.ts).
const data = (source: string, name: string): LegalDocs =>
  new Function(stripTypeScriptTypes(source.replace(/^import.*;\n/gm, '').replace(/^export /gm, '')) + `;return ${name};`)();

/** Both documents in both languages, read from the source files under `root`. */
export function loadLegalDocs(root = process.cwd()): { ar: LegalDocs; en: LegalDocs } {
  const ar = data(read(root, 'src/data/legal.ts').split('/** Display translation only:')[0], 'LEGAL_DOCS');
  const en = data(read(root, 'src/data/legalEnglish.ts'), 'LEGAL_DOCS_EN');
  return { ar, en };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const linkify = (s: string) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" rel="noopener">${u}</a>`);

function section(p: string, kind: LegalKind): string {
  const [heading, ...paragraphs] = p.replace(/\{\{CONTACT_EMAIL\}\}/g, CONTACT[kind]).split('\n\n');
  if (!paragraphs.length) return `<p class="meta">${linkify(heading)}</p>`;
  return `<h2>${esc(heading)}</h2>\n${paragraphs.map((q) => `<p>${linkify(q)}</p>`).join('\n')}`;
}

const TITLES: Record<LegalKind, { ar: string; en: string }> = {
  privacy: { ar: 'سياسة الخصوصية', en: 'Privacy Policy' },
  terms: { ar: 'شروط الاستخدام', en: 'Terms of Use' },
};

/** The whole page: Arabic first (RTL), then the English translation, one anchor each. */
export function renderLegalPage(kind: LegalKind, docs: { ar: LegalDocs; en: LegalDocs }): string {
  const other: LegalKind = kind === 'privacy' ? 'terms' : 'privacy';
  const t = TITLES[kind];
  const body = (lang: 'ar' | 'en') => docs[lang][kind].map((p) => section(p, kind)).join('\n');
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.ar)} · ${esc(t.en)} — إزهله Ezhalah</title>
<meta name="description" content="${esc(t.ar)} لمنصة إزهله — ${esc(t.en)} of Ezhalah.">
<link rel="icon" href="/favicon.ico">
<style>
  :root{color-scheme:light dark;--ink:#1b1b1b;--paper:#fbfaf7;--muted:#5d5d5d;--line:#e3dfd6;--gold:#9a7b2f}
  @media (prefers-color-scheme:dark){:root{--ink:#ededed;--paper:#151515;--muted:#a9a9a9;--line:#2c2c2c;--gold:#d2b36a}}
  html{background:var(--paper)}body{margin:0;color:var(--ink);font:16px/1.75 -apple-system,system-ui,"Segoe UI",Roboto,"Noto Naskh Arabic","Noto Sans Arabic",sans-serif}
  main{max-width:720px;margin:0 auto;padding:32px 20px 64px}
  header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:24px}
  header a{color:var(--gold);text-decoration:none;font-weight:600}nav a{margin-inline-start:16px}
  h1{font-size:1.6rem;margin:0 0 8px}h2{font-size:1.1rem;margin:28px 0 8px}p{margin:0 0 12px;white-space:pre-line}
  .meta{color:var(--muted);font-size:.9rem}section[lang=en]{direction:ltr;text-align:left;border-top:1px solid var(--line);margin-top:40px;padding-top:24px}
  a{color:var(--gold)}footer{margin-top:40px;color:var(--muted);font-size:.85rem}
</style>
</head>
<body>
<main>
<header>
  <a href="/">إزهله · Ezhalah</a>
  <nav><a href="/${other}">${esc(TITLES[other].ar)}</a><a href="#en">English</a></nav>
</header>
<section lang="ar" dir="rtl" id="ar">
<h1>${esc(t.ar)}</h1>
${body('ar')}
</section>
<section lang="en" dir="ltr" id="en">
<h1>${esc(t.en)}</h1>
${body('en')}
<p class="meta"><a href="/${other}">${esc(TITLES[other].en)}</a> · <a href="#ar">العربية</a></p>
</section>
<footer>Ezhalah — a neutral property search tool. This page is generated from the app's own legal text.</footer>
</main>
</body>
</html>
`;
}
