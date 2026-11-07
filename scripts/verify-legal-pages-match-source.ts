// Barrier: THE PUBLIC LEGAL PAGES ARE THE APP'S OWN LEGAL TEXT, AND STAY SO (2026-11-06, owner backlog 1362).
//
// /privacy and /terms answered 404 until 2026-11-06 although the texts existed in src/data/legal*.ts; app stores
// and Google sign-in need a public privacy-policy URL. The pages are static files in public/ GENERATED from the
// data modules (scripts/lib/legalPages.ts). A hand-edited or forgotten copy is exactly how the old /about door
// drifted (verify-info-routes-single-source.ts), so this check EXECUTES the renderer against the current source and
// fails unless the committed files are byte-identical to it; it also pins the contact substitution to InfoModal's.
import { readFileSync, existsSync } from 'node:fs';
import { loadLegalDocs, renderLegalPage, CONTACT, OUTPUT, type LegalKind } from './lib/legalPages.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `\n        ${detail}`}`); if (!ok) failed++; };
const mustCatch = (label: string, heldOnBroken: boolean) => check(`(mutation) catches ${label}`, heldOnBroken === false);

const docs = loadLegalDocs();
const kinds: LegalKind[] = ['privacy', 'terms'];
const current = (k: LegalKind) => (existsSync(OUTPUT[k]) ? readFileSync(OUTPUT[k], 'utf8') : '');
const matches = (k: LegalKind, d = docs) => current(k) === renderLegalPage(k, d);

for (const k of kinds) {
  check(`${OUTPUT[k]} exists`, existsSync(OUTPUT[k]));
  check(`${OUTPUT[k]} equals the renderer's output from src/data/legal*.ts (run scripts/build-legal-pages.ts)`, matches(k));
  const html = current(k);
  check(`${OUTPUT[k]} carries every Arabic section`, docs.ar[k].every((p) => html.includes(p.split('\n\n')[0].replace(/\{\{CONTACT_EMAIL\}\}/g, CONTACT[k]))));
  check(`${OUTPUT[k]} carries every English section`, docs.en[k].every((p) => html.includes(p.split('\n\n')[0].replace(/\{\{CONTACT_EMAIL\}\}/g, CONTACT[k]))));
  check(`${OUTPUT[k]} substitutes the contact token (${CONTACT[k]}), none left raw`, html.includes(CONTACT[k]) && !html.includes('{{CONTACT_EMAIL}}'));
  check(`${OUTPUT[k]} is Arabic-first RTL with an English section`, /<html lang="ar" dir="rtl">/.test(html) && /<section lang="en" dir="ltr"/.test(html));
}
// The addresses are InfoModal's (the in-app reader): privacy → admin@, terms → partners@. A change there must reach here.
const info = readFileSync('src/components/InfoModal.tsx', 'utf8');
check('InfoModal still substitutes admin@ for privacy and partners@ for terms (the pages copy that choice)',
  info.includes(`tab === 'privacy' ? '${CONTACT.privacy}' : '${CONTACT.terms}'`));
// Vercel serves public/privacy.html at /privacy only with cleanUrls on.
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
check('vercel.json cleanUrls is on, so /privacy and /terms resolve to the static files', vercel.cleanUrls === true);

// ── mutation proofs: the comparison is real ──
const mutated = { ar: { ...docs.ar, privacy: docs.ar.privacy.map((p, i) => (i === 3 ? p + ' (edited)' : p)) }, en: docs.en };
mustCatch('an edited Arabic paragraph without a rebuilt page', matches('privacy', mutated));
const dropped = { ar: docs.ar, en: { ...docs.en, terms: docs.en.terms.slice(0, -1) } };
mustCatch('a dropped English section without a rebuilt page', matches('terms', dropped));
mustCatch('a page rendered for the other document', current('privacy') === renderLegalPage('terms', docs));

if (failed) { console.error(`\n❌ verify-legal-pages-match-source: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✓ /privacy and /terms are the app\'s own legal text, generated and pinned');
