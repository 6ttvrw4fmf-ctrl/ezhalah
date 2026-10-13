// RULEBOOK DRAFT 2 IS LIVE (owner 2026-10-13: «I want those new instructions to be live»).
//
// Typed into the production agent the same day, three messages broke the new rules:
//   «شقة في الرياض وجدة»                → searched «الرياض، جدة» at once (rule: one city per search, ask which first);
//   «أبي شقة أو محل في الرياض»          → searched EVERY type in Riyadh (rule: residential and commercial are never one search);
//   «شقة تبعد ٥ كيلو عن جامعة الملك سعود» → «أدور لك شقق قريبة من جامعة الملك سعود» (nothing measures distance yet: the whole city is searched).
// This EXECUTES the three pure functions in supabase/functions/agent/locationAmbiguity.ts and pins where index.ts uses them.
//
//   node --experimental-strip-types scripts/verify-agent-draft2-rules.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { severalCitiesQuestion, residentialCommercialQuestion, proximityNotMeasuredText } from '../supabase/functions/agent/locationAmbiguity.ts';

const ROOT = join(import.meta.dirname, '..');
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? '✓' : '❌'} ${name}${!ok && detail ? ` — ${detail}` : ''}`); if (!ok) failed++; };
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);
console.log('\nRulebook Draft 2: one city, never residential + commercial together, no distance promise\n');

const DASH = /[-‐-―−]/, EMOJI_END = /\p{Extended_Pictographic}️?$/u;
const clean = (r: string | null) => !!r && EMOJI_END.test(r) && !DASH.test(r) && !/\{\w+\}/.test(r);

// ── one city per search ──────────────────────────────────────────────────────────────────────────────────────────
const cityAsks = ['a', 'b', 'c', 'd'].flatMap((s) => [severalCitiesQuestion(['الرياض', 'جدة'], s), severalCitiesQuestion(['الرياض', 'جدة'], s, '', true)]);
const namesBoth = (r: string) => (/الرياض/.test(r) && /جدة/.test(r)) || (/Riyadh/.test(r) && /Jeddah/.test(r));
check('the several-cities question names every city the user typed, in their language, and is a clean question',
  cityAsks.every((r) => namesBoth(r) && clean(r) && /[؟?]/.test(r)), cityAsks.join(' | '));
check('…and offers them as a choice («الرياض ولا جدة» / "Riyadh or Jeddah"), never as «and»',
  cityAsks.every((r) => /الرياض ولا جدة|Riyadh or Jeddah/.test(r)));
mustCatch('a question that drops one of the cities', !namesBoth('البحث يكون في مدينة وحدة كل مرة. نبدأ في الرياض؟ 📍'));

// ── residential + commercial ─────────────────────────────────────────────────────────────────────────────────────
const mixed = ['أبي شقة أو محل في الرياض', 'بيت ومكتب في الخبر', 'فيلا او معرض بجدة', 'I want an apartment or a shop in Riyadh'];
const single = ['شقة في الرياض', 'محل في الدمام', 'شقة قريبة من محلات في جدة', 'apartment near the offices in Riyadh', 'مكتب في الخرج', 'فيلا بمسبح في جدة', 'دور في الخرج'];
const asked = mixed.map((t) => residentialCommercialQuestion(t, '', /[a-z]/i.test(t)));
check('a message naming a home AND a shop/office is asked which first (with the user\'s own two words)',
  asked.every((r, i) => clean(r) && /[؟?]/.test(r!) && /(شقة|بيت|فيلا|apartment)/.test(r!) && /(محل|مكتب|معرض|shop)/.test(r!)), asked.map((r, i) => `${mixed[i]} → ${r}`).join(' | '));
const notAsked = single.filter((t) => residentialCommercialQuestion(t) !== null);
check('one kind only, or a shop that is just a nearby place («قريبة من محلات»), is never asked about', notAsked.length === 0, notAsked.join(' | '));
mustCatch('«شقة ومحلات» (shops that are a wish, not a nearby place) slipping through unasked', residentialCommercialQuestion('شقة ومحلات في جدة') !== null);

// ── distance / near a landmark ───────────────────────────────────────────────────────────────────────────────────
const NEAR = ['شقة تبعد ٥ كيلو عن جامعة الملك سعود', 'شقة قريبة من جامعة الملك سعود', 'apartment near KAFD', 'villa within 5 km of the airport', 'فيلا على بعد ١٠ دقايق من الحرم'];
const near = NEAR.map((t) => proximityNotMeasuredText(t, 'الرياض', /[a-z]/i.test(t)));
const honest = (r: string | null) => !!r && /(ما نقدر|ما هو متوفر|ما نحدد|can't|isn't available|don't filter)/.test(r) && /(الرياض|Riyadh)/.test(r) && !/(قريب|near\b|close to)/i.test(r);
check('a distance or «near a landmark» wish gets a reply that says it is not measured yet and the whole city is searched',
  near.every((r) => honest(r) && clean(r)), near.map((r, i) => `${NEAR[i]} → ${r}`).join(' | '));
mustCatch('a reply that promises «قريبة من» again', !honest('أدور لك شقق قريبة من جامعة الملك سعود في الرياض 🏡'));
check('the line never ends with 📍 (that marks a place QUESTION for the next turn; this is a statement)', near.every((r) => !!r && !/📍$/.test(r)));
check('no near / distance wording, or no single city, means no such line',
  [proximityNotMeasuredText('شقة في الرياض', 'الرياض'), proximityNotMeasuredText('أرض ٥٠٠ متر في الرياض', 'الرياض'), proximityNotMeasuredText('شقة قريبة من الجامعة', ''),
    proximityNotMeasuredText('شقة قريبة من الجامعة', 'الرياض، جدة')].every((r) => r === null));

// ── wiring in index.ts ───────────────────────────────────────────────────────────────────────────────────────────
const edge = readFileSync(join(ROOT, 'supabase/functions/agent/index.ts'), 'utf8');
const cityWired = (src: string) => /else ambiguityReply = severalCitiesQuestion\(distinct\.map\(\(a\) => a\.city\), text, lastBotReply, locale === "en"\)/.test(src)
  && src.indexOf('severalCitiesQuestion(distinct') > 0 && src.indexOf('severalCitiesQuestion(distinct') < src.indexOf('const dc = /^(?:حي');
check('two or more cities in the parsed place become ONE question, decided before the district+city pair check', cityWired(edge));
mustCatch('the several-cities question being dropped', !cityWired(edge.replace('else ambiguityReply = severalCitiesQuestion(', 'else void (')));
const resComWired = (src: string) => /if \(!ambiguityReply\) ambiguityReply = residentialCommercialQuestion\(text, lastBotReply, locale === "en"\);/.test(src)
  && src.indexOf('residentialCommercialQuestion(text') < src.indexOf('const wired = buildTurnDecision(');
check('a residential + commercial message pauses the turn as a question BEFORE the one decision authority runs (so it can never search)', resComWired(edge));
mustCatch('the residential + commercial question being dropped', !resComWired(edge.replace('if (!ambiguityReply) ambiguityReply = residentialCommercialQuestion(', 'if (!ambiguityReply) void (')));
const nearWired = (src: string) => /const notMeasured = !districtPin && !regionPin \? proximityNotMeasuredText\(text, location, locale === "en", lastBotReply\) : null;/.test(src)
  && /else if \(notMeasured\) replyOut = notMeasured;/.test(src);
check('a whole-city search with a distance wish replaces the model\'s «قريبة من …» reply', nearWired(edge));
mustCatch('the model\'s promise coming back', !nearWired(edge.replace('else if (notMeasured) replyOut = notMeasured;', '')));

if (failed) { console.error(`\n❌ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ rulebook Draft 2: one city, residential or commercial, no distance promise');
