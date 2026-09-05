// «تقصد مدينة الرياض ولا منطقة الرياض كاملة؟» MUST BE ASKED (owner, 2026-09-05).
//
// «الرياض» is a city AND a region. They are different searches — مدينة الرياض is one city;
// منطقة الرياض is twenty, including الخرج, الدوادمي, شقراء. Neither reading is safe to assume, so
// the app must ASK. loc_classify() returns kind="region_or_city" for exactly this shape.
//
// THE BUG THIS PINS. The question existed and was correct, but was gated on `!alreadyAsked` — the
// generic ask-once guard. Everywhere else that guard is right; here it silently decided the user's
// search scope. Any conversation that had already asked one location question suppressed it,
// `locationAmbiguous` came back false, and the ladder searched whatever the parser produced.
// Measured in production 2026-09-05: the user answered «الرياض» and received منطقة الرياض —
// 10,745 rows across 20 cities — without ever being asked. A FRESH «ابغى فيلا للبيع في الرياض»
// asked correctly in the very same build, which is what made the bug look like working behaviour.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const edge = readFileSync(join(root, 'supabase/functions/agent/index.ts'), 'utf8');
const decide = readFileSync(join(root, 'supabase/functions/agent/decide.ts'), 'utf8');
const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, '');   // a comment is not a code path
const code = strip(edge);

let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  if (ok) console.log(`  PASS  ${msg}`);
  else { console.log(`  FAIL  ${msg}${extra ? ` — ${extra}` : ''}`); failed++; }
};

// The region_or_city branch, isolated so the assertions cannot be satisfied by a sibling branch.
const start = code.indexOf('if (ck === "region_or_city")');
const branch = start > 0 ? code.slice(start, code.indexOf('} else if (ck ===', start)) : '';

check(start > 0, 'the region_or_city branch still exists');

// ── 1. THE QUESTION ──────────────────────────────────────────────────────────────────────────
check(/اسم مدينة واسم منطقة في نفس الوقت/.test(branch),
  'it still says the name is both a city and a region');
check(/تقصد مدينة \$\{nm\} ولا منطقة \$\{nm\} كاملة؟/.test(branch),
  'it asks the owner\'s exact question, naming BOTH options');

// ── 2. IT IS NOT SUPPRESSED ──────────────────────────────────────────────────────────────────
// The whole defect in one assertion: this branch must not consult the ask-once guard.
check(!/alreadyAsked/.test(branch),
  'the city-vs-region question is NOT gated on alreadyAsked',
  'that guard silently chose the scope instead of asking — it must outrank the ask-once rule');

// ── 3. IT NEVER GUESSES ──────────────────────────────────────────────────────────────────────
// The only two ways to resolve it are the user SAYING «مدينة» or «منطقة». There must be no
// fallback that picks a side on its own.
check(/const wantsCity = /.test(branch) && /const wantsRegion = /.test(branch),
  'resolution is driven by what the user actually said');
check(/if \(wantsRegion && !wantsCity\) location = `منطقة \$\{nm\}`;/.test(branch),
  '«منطقة X» resolves to the REGION, exactly as asked');
check(/else if \(wantsCity && !wantsRegion\) location = nm;/.test(branch),
  '«مدينة X» resolves to the CITY, exactly as asked');
check(!/else\s*\{[^}]*location\s*=/.test(branch),
  'there is no unconditional else that picks a side for the user');

// ── 4. THE ANSWER TERMINATES IT (no infinite loop) ───────────────────────────────────────────
// Both resolutions assign `location` and set NO ambiguityReply, so the next turn is unambiguous.
{
  const asks = (branch.match(/ambiguityReply = /g) ?? []).length;
  check(asks === 1, `the branch has exactly ONE place that asks (${asks})`,
    'a second ask path could re-ask after the user has already answered');
  const idxAsk = branch.indexOf('ambiguityReply = ');
  const idxCity = branch.indexOf('location = nm;');
  check(idxCity > 0 && idxCity < idxAsk,
    'the resolving branches are evaluated BEFORE the ask, so an answered twin never re-asks');
}

// ── 5. AND AN AMBIGUITY CAN NEVER BECOME A NATIONWIDE SEARCH ─────────────────────────────────
// The floor under all of this (PR #1785). If these ever regress, the twin question failing would
// go back to meaning "search the whole Kingdom" rather than "ask again".
check(/if \(locationAmbiguous\) \{/.test(strip(decide)),
  'decide.ts still asks on ANY unresolved ambiguity, at every askCount');
check(!/locationAmbiguous && askCount < QUESTION_BUDGET_CEILING/.test(strip(decide)),
  'the ambiguity step is not re-bounded by the question budget');
check(!/location = "";/.test(strip(readFileSync(join(root, 'supabase/functions/agent/turnWiring.ts'), 'utf8'))),
  'turnWiring still never blanks the location (blank == nationwide downstream)');

// ── 6. THE CLIENT MAY NOT SEARCH PAST A LOCATION QUESTION ────────────────────────────────────
// The edge asking is only half of it. The client keeps its OWN ask-ceiling ("asked twice and we can
// see some intent, so just search"), and that ceiling discarded the twin question and searched
// منطقة الرياض — 10,932 rows across 20 cities — for a user who had said only «الرياض» (production,
// 2026-09-05). The edge now flags the two location questions and the ceiling must honour the flag.
{
  const client = strip(readFileSync(join(root, 'src/app/agent.tsx'), 'utf8'));
  const dataAgent = strip(readFileSync(join(root, 'src/data/agent.ts'), 'utf8'));

  check(/const locationQuestion = !!\(ambiguityReply \?\? noPlaceReply\);/.test(code),
    'the edge flags a location question (ambiguity OR no usable place)');
  check(/kind: "message", reply, locationQuestion,/.test(code),
    'and ships that flag on the message turn');
  check(/locationQuestion\?: boolean/.test(dataAgent),
    'the client TYPE carries the flag');
  check(/d\.locationQuestion === true \? \{ locationQuestion: true \}/.test(dataAgent),
    'and it is read from the edge verbatim, never inferred client-side');

  check(/const mustAnswer = turn\.kind === 'message' && turn\.locationQuestion === true;/.test(client),
    'the client derives mustAnswer from the edge flag alone');
  check(/askCountRef\.current >= 2 && !mustAnswer/.test(client),
    'the client ask-ceiling does NOT fire on a location question',
    'this is the branch that searched منطقة الرياض instead of showing the question');
  // The ceiling must still work for everything else — this fix must not disable it wholesale.
  check(/if \(hasIntent && askCountRef\.current >= 2 && !mustAnswer\)/.test(client),
    '…and still fires for an ordinary clarification (hasIntent + the count are both still required)');
}

// ── MUTATION PROOF ───────────────────────────────────────────────────────────────────────────
console.log('\n  mutation proof — each guard must FAIL on its own defect\n');
const mustCatch = (label: string, caught: boolean) => {
  if (caught) console.log(`  PASS  catches: ${label}`);
  else { console.log(`  FAIL  BLIND to: ${label}`); failed++; }
};
const mut = (from: string, to: string) => {
  if (!branch.includes(from)) throw new Error(`anchor missing: ${from.slice(0, 50)}`);
  return branch.replace(from, to);
};

mustCatch('the ask-once guard put back, silently choosing the scope again (THE bug)',
  /alreadyAsked/.test(mut('else if (!wantsCity && !wantsRegion) {',
                          'else if (!wantsCity && !wantsRegion && !alreadyAsked) {')));
mustCatch('the question deleted entirely',
  !/تقصد مدينة \$\{nm\} ولا منطقة \$\{nm\} كاملة؟/.test(
    mut('تقصد مدينة ${nm} ولا منطقة ${nm} كاملة؟', 'وش تقصد؟')));
mustCatch('a silent default that guesses the city',
  /else\s*\{[^}]*location\s*=/.test(
    mut('else if (!wantsCity && !wantsRegion) {', 'else { location = nm; } else if (false) {')));
{
  const client = strip(readFileSync(join(root, 'src/app/agent.tsx'), 'utf8'));
  const mutC = (from: string, to: string) => {
    if (!client.includes(from)) throw new Error(`client anchor missing: ${from.slice(0, 50)}`);
    return client.replace(from, to);
  };
  mustCatch('the client ask-ceiling searching past a location question again (the production defect)',
    !/askCountRef\.current >= 2 && !mustAnswer/.test(
      mutC('askCountRef.current >= 2 && !mustAnswer', 'askCountRef.current >= 2')));
  mustCatch('the client inferring the flag itself instead of trusting the edge',
    !/const mustAnswer = turn\.kind === 'message' && turn\.locationQuestion === true;/.test(
      mutC("const mustAnswer = turn.kind === 'message' && turn.locationQuestion === true;",
           "const mustAnswer = /مدينة|منطقة/.test(turn.reply);")));
  mustCatch('the ceiling disabled wholesale (it must still apply to ordinary clarifications)',
    !/if \(hasIntent && askCountRef\.current >= 2 && !mustAnswer\)/.test(
      mutC('if (hasIntent && askCountRef.current >= 2 && !mustAnswer)', 'if (false)')));
}

mustCatch('«منطقة X» no longer resolving to the region',
  !/if \(wantsRegion && !wantsCity\) location = `منطقة \$\{nm\}`;/.test(
    mut('if (wantsRegion && !wantsCity) location = `منطقة ${nm}`;',
        'if (wantsRegion && !wantsCity) location = nm;')));

console.log(failed === 0
  ? '\n✅ verify-city-or-region-is-always-asked: all checks passed.'
  : `\n❌ verify-city-or-region-is-always-asked: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
