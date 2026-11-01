// Regression guard — the display name is ONLY what the sign-in provider sent, never the email.
// Owner, 2026-10-23: signed in with Apple and the app called him «سدسزمجتت». Apple sends the user's
// name on the FIRST authorization only, so a later sign-up arrives with none. mapSupabaseUser then
// fell back to the email's local part — for Apple's private relay that is random («66s7zmj7t9») — and
// the translit backfill rendered that "name" in Arabic letters. The fix: no provider name → '' → the
// sidebar and account menu show the temporary «ضيف إزهله» (Ezhalah Guest, owner 2026-10-26) until the user types one.
//
// Offline, text-level: the property is "which expression builds the name", a property of the files.
//   node --experimental-strip-types scripts/verify-display-name-never-from-email.ts

import { readFileSync } from 'node:fs';

const AUTH = 'src/lib/auth.ts';
const WELCOME = 'src/lib/useFilterWelcome.ts';
const SIDEBAR = 'src/components/Sidebar.tsx';
const MENU = 'src/components/AccountMenu.tsx';
const I18N = 'src/i18n.tsx';

// Code only: whole-line `//` comments and trailing `// …` comments (with no quote after them) are prose.
const code = (src: string) => src.split('\n').filter((l) => !/^\s*\/\//.test(l))
  .map((l) => l.replace(/\s\/\/ [^'"]*$/, '')).join('\n');

/** Problems with how the name is derived and shown, as a pure function of the five sources. */
export function nameProblems(f: Record<string, string>): string[] {
  const out: string[] = [];
  const auth = code(f[AUTH] ?? '');
  const nameLine = auth.split('\n').find((l) => /const name: string =/.test(l)) ?? '';
  if (!nameLine) out.push(`${AUTH}: mapSupabaseUser no longer declares \`const name: string =\` (guard cannot read it)`);
  if (/email|split\(\s*'@'|'User'|"User"/.test(nameLine)) {
    out.push(`${AUTH}: the display name falls back to the email (or a fixed word): ${nameLine.trim()}`);
  }
  const welcome = code(f[WELCOME] ?? '');
  const baseLine = welcome.split('\n').find((l) => /const base = /.test(l)) ?? '';
  if (!baseLine) out.push(`${WELCOME}: the cached-session name line is gone (guard cannot read it)`);
  if (/email|split\(\s*'@'/.test(baseLine)) out.push(`${WELCOME}: the greeting name falls back to the email`);
  for (const p of [SIDEBAR, MENU]) {
    if (!/pickName\(user, locale\) \|\| t\('Ezhalah Guest'\)/.test(f[p] ?? '')) {
      out.push(`${p}: an empty name no longer shows «ضيف إزهله» (Ezhalah Guest)`);
    }
  }
  if (!/'Ezhalah Guest':\s*'ضيف إزهله'/.test(f[I18N] ?? '')) out.push(`${I18N}: «Ezhalah Guest» has no Arabic`);
  return out;
}

const files = Object.fromEntries([AUTH, WELCOME, SIDEBAR, MENU, I18N].map((p) => [p, readFileSync(p, 'utf8')]));
const problems = nameProblems(files);
for (const p of problems) console.error(`✗ ${p}`);
if (!problems.length) console.log('✓ the display name is only what the provider sent; no name shows «أضف اسمك»');

let mutFail = 0;
const mustCatch = (label: string, caught: boolean) => {
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) ${caught ? 'catches' : 'BLIND to'} ${label}`);
  if (!caught) mutFail++;
};
const mutate = (p: string, from: RegExp | string, to: string) => ({ ...files, [p]: files[p].replace(from, to) });

mustCatch('the 2026-10-23 bug re-introduced: mapSupabaseUser falls back to the email local part',
  nameProblems(mutate(AUTH, "String(meta.full_name || meta.name || '')", "String(meta.full_name || meta.name || u?.email?.split('@')[0] || '')")).length > 0);
mustCatch('…or to a fixed word like \'User\' (shown, then transliterated, as if it were a name)',
  nameProblems(mutate(AUTH, "String(meta.full_name || meta.name || '')", "String(meta.full_name || meta.name || 'User')")).length > 0);
mustCatch('the cached-session greeting falling back to the email',
  nameProblems(mutate(WELCOME, "m.nameAr || '')", "m.nameAr || (u?.email ? String(u.email).split('@')[0] : ''))")).length > 0);
mustCatch('the sidebar showing an empty name instead of «أضف اسمك»',
  nameProblems(mutate(SIDEBAR, " || t('Ezhalah Guest')", '')).length > 0);
mustCatch('the account menu showing an empty name instead of «أضف اسمك»',
  nameProblems(mutate(MENU, " || t('Ezhalah Guest')", '')).length > 0);
mustCatch('a COMMENT mentioning the email is prose, not the name expression (the predicate is not over-broad)',
  nameProblems(mutate(AUTH, '  const name: string =', "  // was: meta.full_name || u?.email?.split('@')[0]\n  const name: string =")).length === 0);
mustCatch('…and so is a TRAILING comment that names the email after the real expression',
  nameProblems(mutate(AUTH, "String(meta.full_name || meta.name || '').trim();", "String(meta.full_name || meta.name || '').trim(); // not the email")).length === 0);
mustCatch('the shipped sources are clean (the predicate is not vacuously red)', problems.length === 0);

if (problems.length || mutFail) process.exit(1);
