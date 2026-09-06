// ── The AF search transition contract (owner 2026-08-16; RESTORED by the owner 2026-09-06) ───────
//
// After the Advanced Filter interview submits, an overlay plays while the final search runs behind
// it. Between 2026-08-31 and 2026-09-06 that overlay was a full-bleed OPAQUE surface with a dynamic
// «إزهله يدقّق في …» sentence and a card-pipeline gate (PR #1440). The owner saw it live and reverted
// it in one line — "remove this design its ass and shit, keep it how it was" — and asked, in the same
// message, that the platform roster be clearly visible during a search.
//
// So this file no longer protects that design. It protects the RESTORATION, and specifically the two
// properties that would regress silently if someone re-applied the redesign from memory:
//
//   1. THE PIPELINE STAYS RETIRED. No dynamic-sentence builder, no gate, no flowing cards.
//   2. THE BACKDROP STAYS TRANSLUCENT. This is not a style opinion — it is the owner's «make sure all
//      the platforms show clearly» requirement expressed structurally. The redesign's near-opaque
//      surface existed precisely to hide the searching turn (platform pills included) behind it; an
//      opaque backdrop therefore silently un-does what the owner asked for.
//
// The count-honesty half lives in verify-mining-total-honesty.ts (the overlay may speak only counts
// HANDED to it, both from quotableTotal()); the latch/failsafe half lives in
// verify-advanced-filter-contract.ts §9. This file does not duplicate either.
//
//   node --experimental-strip-types scripts/verify-af-deep-search-transition.ts   (auto-discovered by npm test)

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const mining = readFileSync(join(root, 'src/components/MiningTransition.tsx'), 'utf8');
const agent = readFileSync(join(root, 'src/app/agent.tsx'), 'utf8');

// CODE ONLY. The restored component's header explains, in prose, which redesign was reverted and
// which module went with it — and a scan that reads comments would take that explanation for the
// defect itself. (The inverse mistake — a barrier satisfied by a comment — is the 2026-08-29
// comment-blindness incident this repo already carries a rule about; both directions are the same
// error: asserting on prose instead of on code.)
const strip = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

console.log('\n── A. the 2026-08-31 pipeline redesign stays retired ──');

// Named predicates: section D feeds each the exact defect it exists to catch.
const pipelineGone = (src: string) => {
  const s = strip(src);
  return !/deepSearchLine|afDeepSearchCopy/.test(s) && !/PipeCard|laneLine|st\.gate/.test(s);
};
check('no dynamic-sentence builder and no card-pipeline/gate remain in the transition',
  pipelineGone(mining));
// The module is RETAINED on disk, not deleted: scripts/preflight-verify.sh refuses any deploy that
// drops a shipped src/ file present in the approved baseline (the 2026-07-09 UI-loss guard, no
// allowlist by design), so deleting it blocked production entirely (run 34017999312). Existence is
// therefore not the property to assert — REACHABILITY is. Nothing in src/ may import it, which is
// what would actually bring the retired sentence back on screen.
const importers = readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.tsx?$/.test(f))
  .filter((f) => f !== 'lib/afDeepSearchCopy.ts')   // the module itself DEFINES the symbol
  .filter((f) => /afDeepSearchCopy|deepSearchLine/.test(
    strip(readFileSync(join(root, 'src', f), 'utf8'))));
check('no src/ module imports the retired sentence builder (it is unreachable, not merely unused)',
  importers.length === 0, `importers: ${importers.join(', ')}`);
check('the overlay no longer takes the redesign-only props (agent.tsx passes just the two counts)',
  /<MiningTransition from=\{ageFlow\.from\} to=\{ageFlow\.to\} \/>/.test(agent)
  && !/labels=\{ageFlow\.labels\}|type=\{ageFlow\.type\}/.test(agent));

console.log('\n── B. the platform roster reads through — the owner\'s «show clearly» rule ──');

// The restored card sits on colors.scrim (translucent). The redesign used colors.paper at
// opacity 0.9x, which is what hid the searching turn — and the pills with it.
const backdropIsScrim = (src: string) => {
  const s = strip(src);
  return /backdrop: \{ \.\.\.fill, backgroundColor: colors\.scrim \}/.test(s)
    && !/backgroundColor: colors\.paper, opacity: 0\.9/.test(s);
};
check('the backdrop is the translucent scrim, so the searching turn (platform pills included) shows through',
  backdropIsScrim(mining),
  'an opaque backdrop silently reverses the owner\'s «make sure all the platforms show clearly» ask');
check('the transition is a boxed card, not a full-bleed takeover',
  /card: \{[\s\S]{0,200}?maxWidth: 380/.test(mining));

console.log('\n── C. the copy the owner restored ──');

check('the searching line and the honest from-count subline are both present',
  /Finding the closest match for you/.test(mining)
  && /Going through \{count\} properties to pull out the best fit/.test(mining));
check('the «لقينا N عقار أقرب لطلبك» completion beat is back',
  /We found \{count\} properties closest to your request/.test(mining));
check('reduced motion renders the static composition (no drifting fragments)',
  /useReducedMotion/.test(mining) && /!reduced && !done \?/.test(mining));

console.log('\n── D. mutation proofs ──');
const mustCatch = (what: string, caught: boolean) =>
  check(`(mutation) catches ${what}`, caught,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

// The redesign coming back, in the two shapes it would actually return in.
const pipelineBack = mining.replace('<View style={st.stage}>',
  '<View style={st.stage}><PipeCard index={0} settled={done} />');
mustCatch('the card-pipeline being re-added to the transition',
  pipelineBack !== mining && !pipelineGone(pipelineBack));

const sentenceBack = mining.replace('{t(\'Finding the closest match for you\')}',
  '{deepSearchLine(type ?? null, chips)}');
mustCatch('the dynamic «إزهله يدقّق في …» sentence builder being wired back in',
  sentenceBack !== mining && !pipelineGone(sentenceBack));

// The opaque backdrop — the exact line that hid the platform roster.
const backdropOpaque = mining.replace(
  'backdrop: { ...fill, backgroundColor: colors.scrim }',
  'backdrop: { ...fill, backgroundColor: colors.paper, opacity: 0.96 }');
mustCatch('the backdrop being made opaque again (which hides the platform pills the owner asked to see)',
  backdropOpaque !== mining && !backdropIsScrim(backdropOpaque));

console.log(failures === 0
  ? '\n✓ AF transition: the restored card, a translucent scrim, and the retired pipeline still retired\n'
  : `\n✗ ${failures} check(s) FAILED — the transition could drift back to the design the owner rejected\n`);
process.exit(failures === 0 ? 0 : 1);
