// Barrier: A MERGE BY OUR OWN BOT STILL STARTS THE WORK THAT MERGE OWES (2026-11-03).
//
// engineer-automerge.yml merges with the built-in GITHUB_TOKEN, and GitHub starts no workflow from an event that token
// makes — so a bot merge fires no `push` workflow on main. Measured 2026-11-03: #10140 (the word reader stops reading
// «بنت» as Wi-Fi on Gathern apartments) was merged by github-actions[bot] at 11:07:52 UTC and facts-words.yml's push
// re-read never ran; the fix sat on main and changed nothing a user saw. scripts/bot-merge-follow-ups.mjs now dispatches
// the follow-ups a merge owes. This barrier EXECUTES that module against the real workflow files and proves:
//   1. a reader change owes the 8-shard re-read, read from facts-words.yml's OWN push paths (no copied list);
//   2. an unrelated change owes nothing;
//   3. engineer-automerge.yml calls it after a successful gate, and holds `actions: write` to dispatch;
// and each is mutation-proven.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-ignore — plain .mjs module
import { followUpsFor, pushPaths, FOLLOW_UPS } from './bot-merge-follow-ups.mjs';

const root = process.cwd();
const wf = (name: string) => readFileSync(join(root, '.github/workflows', name), 'utf8');
let failed = 0;
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };
// mustCatch(label, broken): `broken` is the invariant evaluated on deliberately broken input — it must be false.
const mustCatch = (label: string, heldOnBroken: boolean) => check(`(mutation) catches ${label}`, heldOnBroken === false);

const readerPaths: string[] = pushPaths(wf('facts-words.yml'));
const owesReread = (files: string[], read = wf) =>
  followUpsFor(files, read).some((f: any) => f.workflow === 'facts-words.yml' && f.inputs.shards === '8' && f.inputs.embed === 'false');

check('facts-words.yml declares push paths (the re-read trigger)', readerPaths.length > 0 && readerPaths.includes('scrapers/facts/word_checker.py'));
check('every FOLLOW_UP names a workflow that exists and has push paths',
  FOLLOW_UPS.every((f: any) => { try { return pushPaths(wf(f.workflow)).length > 0 && /workflow_dispatch/.test(wf(f.workflow)); } catch { return false; } }));
for (const p of readerPaths) check(`a merge touching ${p} owes the 8-shard re-read`, owesReread([p, 'docs/x.md']));
check('a merge touching only src/ owes no re-read', !owesReread(['src/app/agent.tsx']));
check('the re-read run id passes facts-words.yml\'s own «must start with facts-words» rule',
  followUpsFor(['scrapers/facts/word_checker.py'], wf).every((f: any) => /^facts-words/.test(f.inputs.run_id)));

const am = wf('engineer-automerge.yml');
const callsAfterGate = (y: string) => /if \[ "\$gate_rc" = 0 \]; then[\s\S]{0,400}node scripts\/bot-merge-follow-ups\.mjs/.test(y);
const canDispatch = (y: string) => /^permissions:[\s\S]*?^\s+actions:\s*write/m.test(y);
check('engineer-automerge.yml starts the follow-ups right after a successful gate', callsAfterGate(am));
check('engineer-automerge.yml holds actions: write (needed to dispatch)', canDispatch(am));

// ── mutation proofs ──
mustCatch('the bot no longer calling the follow-up script', callsAfterGate(am.replace(/node scripts\/bot-merge-follow-ups\.mjs/, 'true')));
mustCatch('the bot losing actions: write', canDispatch(am.replace(/^\s+actions:\s*write.*$/m, '')));
mustCatch('facts-words.yml losing its push paths (the follow-up would silently owe nothing)',
  owesReread(['scrapers/facts/word_checker.py'], (n: string) => n === 'facts-words.yml' ? wf(n).replace(/^\s+paths:[\s\S]*?(?=^\s+workflow_dispatch:)/m, '') : wf(n)));

if (failed) { console.error(`\n❌ verify-bot-merge-starts-push-follow-ups: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✓ a bot merge still starts the work the merge owes (the reader re-read)');
