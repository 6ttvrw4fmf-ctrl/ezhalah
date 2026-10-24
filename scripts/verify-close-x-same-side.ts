// Every ✕ sits where English puts it — top-right — in BOTH languages (owner 2026-10-24: «every x should be positioned
// the same way English is … don't mirror the x»). Measured before the fix on a local build in Arabic: the About/Support
// sheet, account sheet, share card, map, delete-chat dialog and the deep-search sheet put the ✕ on the LEFT, some by an
// explicit `isRTL ? { left } : { right }`, the header rows because a flex row follows the page direction.
// The ad viewer's phone tab strip and its «slow site» pill are pinned left-to-right too (owner 2026-10-24: «don't mirror it
// cuz it's Arabic»); the laptop browser chrome already was.
import { readFileSync } from 'node:fs';
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

type Files = Record<string, string>;
const FILES = ['src/app/index.tsx', 'src/components/ListingPreview.tsx', 'src/components/Sidebar.tsx', 'src/components/InfoModal.tsx',
  'src/components/AccountMenu.tsx', 'src/app/agent.tsx', 'src/app/interview.tsx', 'src/components/AdvancedQuestionCard.tsx',
  'src/components/AgentModelSelector.tsx', 'src/components/AdViewer.tsx'];

function problems(f: Files): string[] {
  const out: string[] = [];
  for (const [p, src] of Object.entries(f)) {
    if (/(isRTL|rtl|closeOnLeft|I18nManager\.isRTL)\s*\?\s*\{\s*left:\s*12\s*\}\s*:\s*\{\s*right:\s*12\s*\}/.test(src)) out.push(`${p}: a ✕ flips to the left in Arabic`);
    if (/rtl\s*\?\s*\{\s*left:\s*12\s*\}/.test(src) && /centerClose/.test(src)) out.push(`${p}: account ✕ flips`);
    if (/closeOnLeft \? s\.xBtnLeft/.test(src)) out.push(`${p}: info ✕ flips`);
  }
  if (!/platformPickerHeader, locale === 'ar' && \{ flexDirection: 'row-reverse' \}/.test(f['src/app/agent.tsx'])) out.push('deep-search header ✕ follows the page direction');
  if (!/\[s\.bar, isRTL && \{ flexDirection: 'row-reverse'/.test(f['src/app/interview.tsx'])) out.push('interview header ✕ follows the page direction');
  if (!/\[s\.bar, isRTL && \{ flexDirection: 'row-reverse'/.test(f['src/components/AdvancedQuestionCard.tsx'])) out.push('AF card header ✕ follows the page direction');
  if (!/storyHead, \{ flexDirection: arabic \? 'row-reverse' : 'row' \}/.test(f['src/components/AgentModelSelector.tsx'])) out.push('models sheet ✕ follows the page direction');
  if (!/<View style=\{s\.tabRow\} ref=\{setLtr\}>/.test(f['src/components/AdViewer.tsx'])) out.push('ad viewer phone tab strip mirrors its ✕');
  if (!/testID="ad-slow-hint" style=\{s\.slowPill\} ref=\{setLtr\}/.test(f['src/components/AdViewer.tsx'])) out.push('ad viewer slow-site pill mirrors its ✕');
  if (/rtl \? \{ paddingLeft: 44 \}/.test(f['src/components/AccountMenu.tsx'])) out.push('account title reserves room on the LEFT — the right-side × covers it in Arabic');
  if (/hClearLeft/.test(f['src/components/InfoModal.tsx'])) out.push('info title reserves room on the LEFT — the right-side × covers it in Arabic');
  return out;
}

const real: Files = Object.fromEntries(FILES.map((p) => [p, read(p)]));
let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`); if (!ok) failed++; };
const mutation = (name: string, brokenStillPasses: boolean) => check(`(mutation) catches ${name}`, !brokenStillPasses);

const found = problems(real);
check('every ✕ is top-right in both languages', found.length === 0);
for (const p of found) console.log(`     ✗ ${p}`);
mutation('a ✕ that flips left in Arabic again', problems({ ...real, 'src/app/index.tsx': real['src/app/index.tsx'].replace('[s.sharedClose, { right: 12 }]', '[s.sharedClose, isRTL ? { left: 12 } : { right: 12 }]') }).length === 0);
mutation('a header row that mirrors the ✕ again', problems({ ...real, 'src/app/agent.tsx': real['src/app/agent.tsx'].replace("[s.platformPickerHeader, locale === 'ar' && { flexDirection: 'row-reverse' }]", 's.platformPickerHeader') }).length === 0);

mutation('the ad viewer tab strip mirroring again', problems({ ...real, 'src/components/AdViewer.tsx': real['src/components/AdViewer.tsx'].replace('<View style={s.tabRow} ref={setLtr}>', '<View style={s.tabRow}>') }).length === 0);

mutation('an Arabic title sliding under the × again', problems({ ...real, 'src/components/AccountMenu.tsx': real['src/components/AccountMenu.tsx'].replace('paddingHorizontal: 8, paddingRight: 44 },', 'paddingHorizontal: 8, ...(rtl ? { paddingLeft: 44 } : { paddingRight: 44 }) },') }).length === 0);

if (failed) { console.error(`\n✗ close ✕ side: ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ every ✕ sits top-right, the same as English');
