// iOS SAFARI COLLAPSES A `flex: 1` CHILD OF A COLUMN TO 0px — keep it off the chat's column children.
//
// Owner's real iPhone, 2026-10-05, twice in one day:
//   1. the composer's text row (s.inputGrow, inside the composerInputColumn COLUMN) — keyboard up, text
//      typed, nothing drawn: the pill measured 53px on the phone vs 82px in every emulator (#6092);
//   2. the results sentence and the closing note (s.replyText, inside COLUMN views) — «the sentences that
//      say تم: sometimes no emoji shows». The box collapsed and a wrapped second line, often just the
//      emoji («…حسب مواصفات بحثك 🏡»), slid under the cards.
// In a column, `flex: 1` is a VERTICAL flex-basis 0%; iOS Safari resolves it against the column's
// indefinite height as 0 (RNW also sets min-height 0), overriding the content height. Desktop WebKit and
// Chromium size it by content, so no emulator reproduces it — this check is the only guard.
//
//   node --experimental-strip-types scripts/verify-ios-column-flex-collapse.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const agent = readFileSync(join(ROOT, 'src/app/agent.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
};

// The StyleSheet entries that are rendered as children of a COLUMN somewhere in the chat.
const COLUMN_CHILD_STYLES = ['inputGrow', 'replyText'];
const styleBody = (src: string, name: string): string | null =>
  (new RegExp(`\\n  ${name}: \\{([^\\n]*)\\},`).exec(src) ?? [])[1] ?? null;
const offenders = (src: string): string[] =>
  COLUMN_CHILD_STYLES.filter((n) => { const b = styleBody(src, n); return b === null || /\bflex: 1\b/.test(b); });

const bad = offenders(agent);
check(`no column-child chat style carries flex: 1 (${COLUMN_CHILD_STYLES.join(', ')})`, bad.length === 0,
  `offending or missing: ${bad.join(', ')}`);
check('the one ROW user of replyText (reply bubble beside the eagle mark) still passes flex: 1 itself',
  /<Text style=\{\[s\.replyText, \{[^}]*flex: 1 \}\]\}>/.test(agent));

// ── mutation proof: each defect, written into a copy of the source, must turn the check red ──────
const mustCatch = (what: string, mutated: string) => {
  if (mutated === agent) { failed++; console.log(`FAIL  mutation anchor missing: ${what}`); return; }
  const caught = offenders(mutated).length > 0;
  if (!caught) failed++;
  console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${what}`);
};
mustCatch('flex: 1 back on the composer text row', agent.replace('  inputGrow: { overflow:', '  inputGrow: { flex: 1, overflow:'));
mustCatch('flex: 1 back on the results sentence style', agent.replace('  replyText: { fontFamily: CHAT_FONT,', '  replyText: { fontFamily: CHAT_FONT, flex: 1,'));

console.log(failed === 0
  ? '\n✅ no chat column child can collapse to 0px on iOS Safari.\n'
  : `\n❌ ${failed} check(s) failed — a column child carries flex: 1 (iOS collapses it to 0px).\n`);
process.exit(failed === 0 ? 0 : 1);
