import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, space, cardShadow } from '@/theme/tokens';
import { runAfterAnimation } from '@/lib/afterAnimation';
import { isAppSessionStarted } from '@/lib/appSession';
import { msgRTL } from '@/lib/textDirection';
import { stopReadAloud, subscribeReadAloud } from '@/lib/readAloud';
import { startVoiceInput, stopVoiceInput, cancelVoiceInput, isVoiceInputSupported } from '@/lib/voiceInput';
import VoiceWaveform from '@/components/VoiceWaveform';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { buildResultsReadAloudSegments } from '@/lib/readAloudScript';
import SearchLoader from '@/components/SearchLoader';
import FeedbackRow from '@/components/FeedbackRow';
import ReadAloudPlayer from '@/components/ReadAloudPlayer';
import { CardIn, LoadingDots } from '@/components/CardReveal';

// Memoized card: during the reveal cascade the list re-renders every ~55ms — already-revealed cards
// must skip reconciliation or 200+ cards stutter the very animation the cascade exists for (review
// perf fix 2026-07-09). onOpen is deliberately excluded from the comparison: it's re-created each
// render but behaves identically for the same listing.
const MemoResultCard = memo(ResultCard, (prev, next) =>
  prev.listing === next.listing && prev.rank === next.rank && prev.variant === next.variant);
import HeroBackground from '@/components/HeroBackground';
import ShareSheet from '@/components/ShareSheet';
import ModeSwitch from '@/components/ModeSwitch';
import Sidebar, { useDocked } from '@/components/Sidebar';
import { ResultCard } from '@/components/ResultCard';
import { parseQuery, respond } from '@/data/agent';
import { parseProximity } from '@/data/proximity';
import { resolveLocation, cityDisplay, topCitiesInRegion, topDistrictsForCity } from '@/data/locations';
import { arabicOrPlaceholder } from '@/lib/arabicText';
import { regionOrCityChoice, scopedLocation, scopeNamedForTwin } from '@/lib/regionOrCityAnswer';
import { openListing } from '@/lib/openListing';
import { filterToChat, searchSummary, buildAfSummary, effectiveTypes, effectiveGroups, hasClientOnlyNarrowing, quotableTotal, type SearchQuery, type SearchResult } from '@/data/search';
import { deriveGuided, sameKeys, type GuidedStep } from '@/lib/afSteps';
import { migrateGroups } from '@/lib/searchDefaults';
import { BROWSE_CAP, resultCounts } from '@/data/resultCount';
import { detailFor, detailForContext, type Category } from '@/data/taxonomy';
import { useApp } from '@/store';
import { useI18n, detectLocale, getLocale, t as tr, type Locale, LOCATION_UNRESOLVED_AR } from '@/i18n';
import { noTranslateRef } from '@/noTranslate';
import { introExamplesForWidth, introExampleHoldMs } from '@/data/introExamples';
import AdvancedQuestionCard, { AdvancedQuestionLoading, AdvancedIntroCard } from '@/components/AdvancedQuestionCard';
import MiningTransition from '@/components/MiningTransition';
import { ADVANCED_QUESTIONS, SCOPE_QUESTIONS, scopeQuestionFor, INTERVIEW_STOP_AT, MIN_USEFUL_QUESTIONS_TO_SHOW, eligibleQuestions, minOptionsFor, liveResultCount, rankQuestions, type AdvancedOption, type AdvancedQuestion, type AdvancedQuestionResult, type RankedQuestion } from '@/data/advancedFilters';
import { isScopeQuestionId, nextScopeTier, unresolvedScopeTiers, scopeCandidates, type ScopeTier } from '@/lib/afPlan';

// Property Age advanced-filter eligibility. Reached from the EXISTING «خلّنا نحدد الطلب أكثر» button
// below a results block — NEVER before first results — and ONLY for a strict single-type Residential
// scope whose property_age data has been live-verified sufficient (owner rollout Building→Room→Floor,
// 2026-07-16). Apartment is the reference (gold standard). A multi-type selection or any type not in
// this set never triggers it. Add a new type ONLY after live-verifying its data quality + counts==
// search parity, per docs/ADVANCED_FILTER_PATTERN.md. Do not widen without an explicit owner instruction.
//
// effectiveTypes() returns canonical ENGLISH keys (propertyTypes.ts), e.g. 'Apartment'/'Residential
// Building' — NOT the Arabic label (that conversion happens later at RPC-call time via typeArForTypes()).
// Comparing against Arabic here always evaluated false — caught live, 2026-07-15.
// The Property Age eligibility gate lives in src/lib/ageFilterTypes.ts (zero-dep, so `npm test` can
// assert its macros against CLEAN_MACRO — agent.tsx itself can't be imported by a plain node runner).
// The guided flow is offered when ANY advanced question is eligible for the scope — each question owns
// its own eligibility gate now (see docs/ADVANCED_FILTER_DESIGN_CONTRACT.md). Otherwise the tap falls
// through to the pre-existing plain refine chips.
// SCOPE PREFIX (owner 2026-08-23): an unresolved CATEGORY→GROUP→TYPE hierarchy is itself a reason to
// open the interview. Without this clause the tap could never open Advanced Filter above the type
// level — cohortAllows() intersects across every clean type in scope and treats an uncertified type
// as an empty cohort, so a category-only scope resolved to zero eligible questions and a group-only
// scope to zero for 5 of the 8 shipped groups. The interview then fell through to the legacy refine
// chips, which is what made the feature look absent rather than blocked.
//
// The client-only-narrowing kill switch still wins: where counts cannot be honest, no question may be
// asked — a scope option's count would be exactly as dishonest as an advanced one's.
function anyGuidedEligible(q: SearchQuery): boolean {
  if (hasClientOnlyNarrowing(q)) return false;
  return unresolvedScopeTiers(q).length > 0 || eligibleQuestions(q).length > 0;
}

const IS_WEB = Platform.OS === 'web';
// On the web the results tile into a wrap grid, so the conversation column is wider to give them
// room (the user barely scrolls). On phone it stays a comfortable single-column reading width.
const MAX_W = IS_WEB ? 940 : 560;

// Composer + mode-pill motion (redesign 2026-08-16) — the TOAST_EASE idiom: state drives the target
// style, a web-only CSS transition supplies the glide. Chosen over Animated after live-testing that
// Animated styles do not flush through createAnimatedComponent(TextInput) on this RNW version; CSS
// transitions are the codebase's proven web-motion path (feedback toast, chip hovers).
// ponytail: native (no CSS) falls back to the pre-redesign instant height step — revisit with
// Animated wrappers when the native app actually ships; web (the only live surface) is smooth.
const COMPOSER_EASE = IS_WEB ? ({ transitionProperty: 'border-color, box-shadow', transitionDuration: '180ms' } as any) : null;
const INPUT_EASE = IS_WEB ? ({ transitionProperty: 'height', transitionDuration: '140ms', transitionTimingFunction: 'ease-out' } as any) : null;
const MODE_EASE = IS_WEB ? ({ transitionProperty: 'opacity, height, transform', transitionDuration: '200ms' } as any) : null;

// Example-prompt pools, sampler, and the DB-driven hook all live in src/data/examplePrompts.ts so
// the home onboarding grid and this agent screen share ONE library — adding a prompt or a new DB
// source there now appears in both places.

// A «more precise» refine prompt attached to an agent message: ONE clarifying dimension with clickable
// answer chips (never typed). Tapping a chip merges that one field into the SAME filter and re-searches.
type RefinePrompt = { dim: string; baseQ: SearchQuery; options: { label: string; value: string }[] };

type ChatMsg =
  | { id: string; role: 'user'; text: string; typing?: boolean }
  | { id: string; role: 'agent'; text: string; typing?: boolean; greeting?: boolean; refine?: RefinePrompt; refineDone?: boolean }
  | { id: string; role: 'results'; text: string; result: SearchResult; typing?: boolean; slogan?: string; summary?: string }
  // `query` + `resultSources` feed the search-loading animation's platform strip (which real
  // platforms to show while searching); they never affect the search itself. `exiting` tells the
  // loader to fade out softly just before the morph to results (owner v4: no hard cut).
  | { id: string; role: 'status'; phase: 'thinking' | 'searching'; slogan?: string; summary?: string; query?: SearchQuery; resultSources?: string[]; exiting?: boolean };

const uid = () => 'm' + Date.now() + Math.round(Math.random() * 1e6);

// Readable labels for the refine answer chips. Numbers stay Western digits (project rule: Arabic
// everywhere EXCEPT numbers). A budget chip is a ceiling («up to X»); beds are exact counts (5 = 5+).
const budgetLabel = (c: number, ar: boolean): string =>
  c >= 1_000_000
    ? (ar ? `حتى ${c / 1_000_000} مليون` : `Up to ${c / 1_000_000}M`)
    : (ar ? `حتى ${c / 1_000} ألف` : `Up to ${c / 1_000}K`);
const bedsLabel = (n: string, ar: boolean): string => {
  if (ar) return n === '1' ? 'غرفة واحدة' : n === '2' ? 'غرفتين' : n === '5' ? '5+ غرف' : `${n} غرف`;
  return n === '1' ? '1 bedroom' : n === '5' ? '5+ bedrooms' : `${n} bedrooms`;
};

// Right before Ezhalah goes off to scrape, it answers with ONE random Saudi-dialect hype line — a
// playful "you got it" in Najdi colour, never a recommendation or any judgement on the search (user
// request: speak in the Saudi dialect, plain and simple, never advise). The English locale gets
// equivalent breezy one-liners so a non-Arabic user reads the same energy.
// The opening greeting Ezhalah types into a fresh chat (owner-authored FINAL copy, 2026-08-23 —
// verbatim, do not edit without an explicit owner instruction; the intro-rotator barrier pins it
// byte-exact). One warm Saudi sentence that says exactly what Ezhalah does. Language follows the UI
// locale — rendered live (not frozen at send time) so flipping language re-renders it. The English
// branch stays the bare brand word: the product is Arabic-only and English is latent code — no
// English marketing copy is invented here (owner brief §10).
const greetingText = (locale: Locale): string =>
  locale === 'ar'
    ? 'ارحب، أنا إزهله. قلّي وش العقار اللي تدور عليه، وأنا أبحث لك بين المنصات العقارية وأطابق الخيارات مع طلبك لين نلقى اللي يناسبك… إزهلها وفالك الطيب.'
    : 'Ezhalah';

// Ezhalah's SEARCHING-phase voice — one Najdi-flavoured swagger line chosen at random before each
// search (its recognizable Saudi personality, NOT generic "searching now"). Shown ONLY while searching,
// above the search summary; the RESULTS header switches to the professional RESULT_* copy. (user request.)
// Curated subset: user removed slogans 6, 7, 8, 9, 10, 12, 13, 15, 18, 19, 20, 21, 22 from the
// original 22 — leaving the 9 below. HYPE_AR and HYPE_EN stay in lockstep (same index = same
// slogan). To re-add a slogan later, paste both the Arabic line and its English twin back at the
// SAME index in both arrays.
// User request: no jokes / flourishes — just the word «ازهله» everywhere.
const HYPE_AR = ['ازهله'];
// English versions of the same 22 approved Arabic slogans (same index → same slogan). These are
// FAITHFUL translations of HYPE_AR — not improvisations. The word "Ezhalah" is kept verbatim
// (NEVER translated to "Leave it to us" / "facilitate" / etc.) and the Najdi imagery is preserved.
// The slogan is rendered LTR with the sparkle icon on the LEFT when the UI is English, mirroring
// the RTL Arabic placement. (user request: "translate the Arabic slogan to English and put it in
// the correct English position — just never translate the word Ezhalah.")
const HYPE_EN = ['Ezhalah'];
// RESULTS phase = professional, trustworthy (NOT the personality phrases). One picked at random;
// rendered as plain text directly under the Search Summary — NO "Ezhalah!" prefix, no sparkle icon,
// so it doesn't look like a second slogan. The branded slogan above carries the personality. (user request.)
const RESULT_AR = [
  'وجدت بعض العقارات التي تطابق بحثك.',
  'وجدت بعض الخيارات بناءً على طلبك.',
  'هذه بعض العقارات التي قد تناسب بحثك.',
];
const RESULT_EN = [
  'I found a few properties based on your search.',
  'I found a few options based on what you asked for.',
  'Here are some properties that match your search.',
];
const resultDone = (locale: Locale): string => {
  const arr = locale === 'ar' ? RESULT_AR : RESULT_EN;
  return arr[Math.floor(Math.random() * arr.length)];
};
// Pick a slogan in the LANGUAGE OF THE USER'S MESSAGE (not the UI locale). Counting Arabic vs
// Latin word-runs in the text lets a user type "I want an apartment in Riyadh" inside an Arabic
// UI and still get the English slogan back — which is what they expect. Falls back to the UI
// locale when the message has no letters (e.g. just "4000"). The two arrays stay index-aligned so
// the same random pick maps to the same translated slogan in either language. (user-reported:
// "I sent in English but the slogan came back Arabic — see, didn't get translated.")
// DETERMINISTIC location-certainty backstop (does NOT depend on the model). Returns an Arabic clarification
// question when the parsed query's location is not confident enough to search — (a) no location at all and
// the user did not ask Kingdom-wide, or (b) a bare district that exists in SEVERAL cities with no city given.
// Else null (search). The app's resolver knows the ambiguity even when Gemini decides to search anyway.
// (user: ask when unsure — «ابي بيت» must ask «في أي مدينة؟», «حي البلد» must ask which city.)
const KINGDOM_WIDE = /السعودي|المملك|كل المدن|كل المملك|كل مدن|في كل مكان|بأي مكان|أي مكان|اي مكان|everywhere|kingdom|\bsaudi\b/i;
// The user signalling they already want the WHOLE region/city — so we should NOT ask to narrow, just
// search it all. (user: "if the user wants a broad search, that is fine — search the whole region/city.")
const WHOLE_AREA = /كامل|كاملة|بالكامل|كلها|كل المدين|كل المنطق|المدينة كلها|المنطقة كلها|كل الأحياء|أي حي|اي حي|\bwhole\b|\bentire\b|all of/i;
// lm.label is usually a catalog-sourced Arabic string (resolveLocation is always called with locale
// 'ar' below), but the district-ambiguous branch's LIVE_DISTRICTS merge can carry a raw, non-Arabic
// scraped district name — or the literal unresolved user input — into it (2026-07-13 sibling-leak
// audit). Guarding every use defensively, same pattern as search.ts's locationLines().
const arLabel = (s: string) => arabicOrPlaceholder(s, 'ar', LOCATION_UNRESOLVED_AR);

// The region-AND-city TWIN NAME behind the «مدينة X ولا منطقة X كاملة؟» question (and behind the
// whole-region question for the same names), so send() knows which name the user is answering about on
// the next turn. Accepts either form the query can carry («الرياض» or «منطقة الرياض»). null when the
// location is not one of those twins — a plain city/region/district ask is untouched.
function regionOrCityTwin(loc: string | undefined): string | null {
  const bare = (loc ?? '').trim().replace(/^منطقة\s+/, '').trim();
  if (!bare) return null;
  const lm = resolveLocation(bare, 'ar');
  return lm.regionOrCity ? arLabel(lm.label) : null;
}

function locationClarification(q: SearchQuery, userText: string): string | null {
  const loc = (q.location ?? '').trim();
  if (!loc) {
    if (KINGDOM_WIDE.test(userText)) return null; // user explicitly wants the whole Kingdom
    // SMART, conversational city ask for a proximity/landmark search with no city: echo the user's OWN
    // phrase instead of a generic question — «قريب من الافنيوز» → «في أي مدينة تبحث عن عقار قريب من
    // الافنيوز؟». Feels like a continuation; never invents a city. On their answer the search resumes with
    // city + the same proximity (q.proximity is re-parsed/merged across the attempt). (clarification UX.)
    const prox = (q.proximity ?? [])
      .map((p) => (p.text || `${p.phrase} ${p.name || p.categoryAr}`).trim())
      .filter(Boolean);
    if (prox.length) return `في أي مدينة تبحث عن عقار ${prox.join(' و')}؟`;
    return 'في أي مدينة تبحث؟ (وإذا تبي كل المملكة قل لي «كل مدن المملكة»)';
  }
  // The user explicitly asked for the whole area (or the whole Kingdom) — honour it, don't ask to narrow.
  if (WHOLE_AREA.test(userText) || KINGDOM_WIDE.test(userText)) return null;
  const lm = resolveLocation(loc, 'ar');
  // The user NAMED the scope in THIS message — «مدينة الرياض» / «منطقة الرياض» — either answering the
  // region-vs-city question below or saying it up front. That word IS the answer, and send() has
  // already committed it to q.location, so asking again is asking a question the user just answered.
  // (defect `agent-clarify-loop`, found live 2026-08-23: this backstop re-asked the identical question
  // every turn, then the 2-ask cap discarded the answered city and searched the whole Kingdom.)
  const scopeChoice = regionOrCityChoice(userText);
  // Bug-fix #3: a TWIN CITY (same name in 2+ catalog regions, e.g. «الهفوف» Eastern vs Riyadh) → ask
  // WHICH REGION. The resolver flags ambiguous=true on kind='city' for these; the engine refuses to
  // fan out cross-region until the user picks. Per locked rule: same name in 2 regions → never guess.
  if (lm.kind === 'city' && lm.ambiguous && lm.twinRegions && lm.twinRegions.length > 1) {
    // audit #2 fix: show the REGIONS, not the city display labels (which are identical for twins and
    // dedupe to one blank option). «الهفوف موجودة في أكثر من منطقة (المنطقة الشرقية، منطقة الرياض)…»
    const regions = Array.from(new Set(lm.twinRegions));
    return `«${arLabel(lm.label)}» موجودة في أكثر من منطقة (${regions.join('، ')}). أي منطقة تقصد؟`;
  }
  // Region-vs-city SAME NAME (الرياض/جازان/تبوك/حائل/نجران/الباحة/الجوف) → ask مدينة ولا منطقة, never
  // default to the city. Must precede the generic city branch below. (audit #4 / Q38.)
  if (lm.regionOrCity) {
    if (scopeChoice) return null; // they picked one of the two options — search it, don't re-ask it
    const label = arLabel(lm.label);
    return `«${label}» اسم مدينة واسم منطقة في نفس الوقت. تقصد مدينة ${label} ولا منطقة ${label} كاملة؟`;
  }
  // Geography cue (sea/mountain/desert) with NO city → ask the city; never auto-pick a default.
  // (audit #12 / Q39 case A.)
  if (lm.kind === 'geography' && lm.needsCity) {
    return 'تقصد في أي مدينة أو منطقة؟';
  }
  // 1) A bare district shared by several cities → ask WHICH CITY (cities with listings first).
  if (lm.kind === 'district' && lm.ambiguous && lm.cities && lm.cities.length > 1) {
    const names = Array.from(new Set(lm.cities.slice(0, 8).map((c) => cityDisplay(c, 'ar')))).slice(0, 6);
    return `«${arLabel(lm.label)}» موجود في أكثر من مدينة (${names.join('، ')}). أي مدينة تقصدها؟`;
  }
  // 2) A REGION → ask the WHOLE region or a specific city (name a couple of its real, in-inventory cities).
  if (lm.kind === 'region') {
    // «منطقة X» for a name that is ALSO a city is literally one of the two options the twin question
    // above offers, and it means the whole region — same standing as the WHOLE_AREA wording. Asking
    // «كاملة، أو مدينة معيّنة؟» right after would re-ask what they just picked. Scoped to those twins on
    // purpose: a plain region («منطقة مكة», «المنطقة الشرقية») was never offered as an option and keeps
    // its normal narrowing question.
    // STRICT, for the same reason as the rewrite in send(): «منطقة» is an ordinary Arabic noun, so a
    // stray one («في منطقة هادئة») must NOT be read as "they already chose the whole region" and
    // silence the question. Only a scope named ON THIS TWIN counts.
    if (scopeNamedForTwin(userText, regionOrCityTwin(loc)) === 'region') return null;
    const cities = topCitiesInRegion(lm.region ?? lm.city ?? loc, 2).map((c) => cityDisplay(c, 'ar'));
    const hint = cities.length ? ` مثل ${cities.join(' أو ')}` : '';
    return `تقصد ${arLabel(lm.label)} كاملة، أو مدينة معيّنة${hint}؟`;
  }
  // 3) A whole CITY with no neighbourhood → ask the WHOLE city or a specific district.
  if (lm.kind === 'city') {
    return `تقصد مدينة ${cityDisplay(lm.city, 'ar')} كاملة، أو حي معيّن؟`;
  }
  return null;
}

function detectMsgLang(s: string): 'en' | 'ar' | null {
  const words = s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let ar = 0, en = 0;
  for (const w of words) {
    if (/[؀-ۿ]/.test(w)) ar++;
    else if (/[A-Za-z]/.test(w)) en++;
  }
  if (ar === en) return null;
  return ar > en ? 'ar' : 'en';
}
const hypePhrase = (locale: Locale, messageText?: string) => {
  const detected = messageText ? detectMsgLang(messageText) : null;
  const lang: Locale = detected ?? locale;
  const arr = lang === 'en' ? HYPE_EN : HYPE_AR;
  return arr[Math.floor(Math.random() * arr.length)];
};

// msgRTL (per-message direction: each bubble keeps its OWN direction from its OWN text) now lives in
// src/lib/textDirection.ts — imported above — so the read-aloud feature's language detection shares
// the SAME definition instead of a second copy that could disagree about what language a message is in.

// Pin a row to physical LTR so its children keep the SAME position in Arabic and English (the top bar
// must NOT mirror when the language flips). Web-only DOM dir, same approach as the home top bar. (user request.)
const setLtr = (node: any) => { if (Platform.OS === 'web' && node?.setAttribute) node.setAttribute('dir', 'ltr'); };

// How long the filter flow draws things out, for a deliberate conversational rhythm (user request):
// the request bubble types at the constant speed, "Ezhalah is searching…" holds for SEARCH_MS, then
// the response types at the same constant speed.
// Snappy pacing (user request: "respond within ~3s, type much faster"). Kept just long enough to
// read as a real "thinking → searching → answer" rhythm rather than instant, but no slower.
// CONSISTENT TYPING SPEED (user request): every AI reply — greeting, chat answer, listings reply, and
// the filter request-bubble echo — types at the SAME constant cadence: TYPE_CHARS chars every
// TYPE_TICK_MS ms (~80 chars/sec). Short replies finish fast (like "hi"); long replies type at the
// identical speed, never a sudden faster/slower burst (the old code spread each reply over a FIXED
// duration, so long lines blasted out many chars/tick while short ones dribbled). Total time scales
// with length — typeDuration() returns it so the choreography beats wait exactly as long as the text.
const TYPE_TICK_MS = 24;
const TYPE_CHARS = 2;
const typeDuration = (s: string) => Math.max(250, Math.ceil((s?.length ?? 0) / TYPE_CHARS) * TYPE_TICK_MS);
const SEARCH_MS = 600;
// Loading choreography (owner 2026-07-09 v4: the searching loader — full platform roster + calm
// highlight wave — starts the INSTANT Search is pressed and runs through the whole real search;
// results show the moment they're ready, no artificial holds beyond this floor). SEARCH_MIN_MS is
// the MINIMUM visible searching-beat, counted from when the loader appears: it overlaps the bubble
// typing + network wait and never adds once consumed. It MUST cover the full pill reveal —
// 32 pills × 60ms stagger + 260ms fade = last pill fully landed at ~2120ms — otherwise a fast query
// cuts the roster tail and breaks the "COMPLETE roster, never flashed away" rule (review finding).
const SEARCH_MIN_MS = 2200;
// Soft completion (owner v4): before morphing to results, flag the loader `exiting` and give its
// fade-out this long — the strip glides away into the results state instead of vanishing in a frame.
const LOADER_EXIT_MS = 450;
// The "Ezhalah is thinking…" beat for CHAT turns (respond() may return a clarifying question, not a
// search, so chat can't pre-flip to "searching"). Overlaps the round-trip; only the remainder waits.
const THINK_MS = 700;

// One in-flight chat turn. The Stop box cancels it: `cancelled` makes every awaited beat bail,
// flushing the pending timers/resolvers unblocks any beat currently waiting, and `ac.abort()` tears
// down the real in-flight network request(s) (see bounded()'s external-signal support) — not just
// tells the UI to stop waiting on them.
//
// `origin` (owner 2026-08-18) decides what Stop DOES once cancellation is done: a run that began at
// «بحث» on the normal Filter must return the user to that exact Filter screen — never a run that
// began in the AI chat (typed message, a Start-here chip, or a refine tap), which keeps today's
// stop-in-place chat behavior. Only sendFilter's run is ever tagged 'filter'; every other makeRun()
// call site is a chat-style turn by construction, so the default covers them without repeating it.
type Run = { cancelled: boolean; timers: ReturnType<typeof setTimeout>[]; flush: (() => void)[]; origin: 'filter' | 'chat'; ac: AbortController };
const makeRun = (origin: Run['origin'] = 'chat'): Run => ({ cancelled: false, timers: [], flush: [], origin, ac: new AbortController() });
const waitRun = (run: Run, ms: number) =>
  new Promise<void>((resolve) => {
    run.timers.push(setTimeout(resolve, ms));
    run.flush.push(resolve);
  });
// Greeting, reply, and the request-bubble echo all share the ONE constant speed defined above —
// there are no per-type durations any more, so nothing ever types faster or slower than anything else.

// Feedback toast fade + slide (web CSS transition; native just toggles — acceptable, web ships).
const TOAST_EASE = Platform.OS === 'web' ? ({ transitionProperty: 'opacity, transform', transitionDuration: '250ms' } as any) : null;

// Brief "finishing up" beat after Stop, before the transcript lands in the composer — a ChatGPT-
// style confirming pause rather than an instant cut (user request, 2026-08-24). Capture itself
// already stopped synchronously the moment Stop was tapped; this delay is purely the loading
// indicator's minimum dwell time, never a gate on when recording actually ends.
const STOP_PROCESSING_MS = 450;

// Drives a typewriter's `n` from 0 to `total` at TYPE_CHARS/TYPE_TICK_MS, AND guarantees `onDone`
// fires within a bounded ceiling even if the interval itself gets starved.
//
// ROOT-CAUSE FIX (owner report, 2026-08-23 — "the advanced filter doesn't work in every property
// type"). The AF "narrow it down" button, the Load-more/feedback row, and the Read Aloud button are
// ALL gated on `doneTyping`, which only this interval's completion sets. Measured LIVE on two
// independent real browsers (this session's own test pane AND the owner's actual Windows Chrome,
// cross-checked specifically to rule out a tooling artifact) with a MutationObserver on the intro
// text: while the 10-card results cascade renders alongside it, ticks that should fire every 24ms
// were landing ~1000ms apart instead — a ~40x stall, some runs taking 40-60+ real seconds before the
// intro sentence's LAST character (and every button gated behind it) ever appeared. The interval's
// own state machine was never wrong — recomputing `n` and comparing to `total` is trivial — the
// SIBLING render load (reconciling the heavy card list on every tick) is what starves it of main-
// thread time between ticks. Properly insulating that render path is a larger, riskier change; the
// fix that doesn't require it is the one this codebase already uses for exactly this class of
// problem (src/lib/afterAnimation.ts's runAfterAnimation): THE ANIMATION IS DECORATION, THE HAND-OFF
// IS THE FUNCTION — so a bounded fallback timer forces `onDone` through even when the interval
// that's supposed to drive it is being starved. The ceiling is generous relative to any real typing
// duration (a natural intro sentence needs well under a second of TYPE_TICK_MS-paced reveal), so it
// never fires under normal rendering — only when something has gone this wrong.
function runTypewriter(total: number, setN: (n: number) => void, onDone?: () => void): () => void {
  if (total <= 0) { onDone?.(); return () => {}; }
  let i = 0;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    setN(total);
    onDone?.();
  };
  const id = setInterval(() => {
    i += TYPE_CHARS;
    if (i >= total) { clearInterval(id); finish(); } else { setN(i); }
  }, TYPE_TICK_MS);
  const expectedMs = Math.ceil(total / TYPE_CHARS) * TYPE_TICK_MS;
  const fallback = setTimeout(finish, Math.max(4000, expectedMs * 3));
  return () => { clearInterval(id); clearTimeout(fallback); };
}

// Typewriter — reveals the text one character at a time, spread evenly across `duration` ms (so a
// short or long sentence both take the same ~5s), making a filter search read as if Ezhalah is
// writing it out (prototype parity: ezhalah-mobile.jsx Typer). Renders an unstyled <Text> so it
// inherits the surrounding bubble/reply styling. onDone fires once the full text is shown.
function Typer({ text, onDone }: { text: string; onDone?: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    return runTypewriter(text.length, setN, onDone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return <Text>{text.slice(0, n)}</Text>;
}

// Like Typer, but reveals "Ezhalah! " (styled as the brand) followed by the reply as one continuous
// stream over `duration` ms — so the answer literally writes itself starting with the brand, then
// the rest (user request). The brand prefix stays reserved for listings (PRD §7.3); plain message
// replies use the unbranded Typer instead.
function BrandReveal({ brand, text, onDone }: { brand: string; text: string; onDone?: () => void }) {
  const full = brand + text;
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    return runTypewriter(full.length, setN, onDone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);
  const shown = full.slice(0, n);
  return (
    <>
      <Text style={s.brand}>{shown.slice(0, brand.length)}</Text>
      {shown.slice(brand.length)}
    </>
  );
}

// ── Rotating composer examples (owner brief 2026-08-23) ─────────────────────────────────────────
// Real, PROVEN search sentences rotating in the placeholder slot of the EMPTY AI landing screen —
// they teach what to ask, then get out of the way the moment the user interacts. Decorative
// guidance only: absolutely positioned inside the input's own clipped wrapper (it can never move
// the mic/Send or create overflow), pointerEvents none (taps land on the real input), aria-hidden
// (a screen reader hears ONLY the composer's stable Arabic label, never 25 rotating sentences).
// Transition = the transport the owner asked for: the old sentence fades out with a subtle upward
// slide, the new one settles in softly — no typewriter, no bounce. State drives the target style,
// a web-only CSS transition supplies the glide (the file's TOAST_EASE idiom; native = instant
// swap, web is the live surface). Reduced motion → ONE static example, zero repeating animation
// (owner brief §3/§11 allows "a static example"). Width-adaptive: the measured slot width picks
// which pool members rotate, so narrow screens show SHORT examples instead of squeezing long ones
// (owner brief §9). This component NEVER touches `typed` or any other state — render-only, so user
// text is structurally impossible to overwrite.
const INTRO_EX_FADE_MS = 220;
function IntroExampleRotator({ reducedMotion }: { reducedMotion: boolean }) {
  const [w, setW] = useState(0);
  const pool = useMemo(() => introExamplesForWidth(w), [w]);
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<'in' | 'shown' | 'out'>('shown');
  const text = pool.length ? pool[i % pool.length] : '';
  // Hold each example long enough to read, then leave. Plain timers, never rAF (hidden-tab rule).
  useEffect(() => {
    if (reducedMotion || pool.length <= 1 || phase !== 'shown') return;
    const hold = setTimeout(() => setPhase('out'), introExampleHoldMs(text));
    return () => clearTimeout(hold);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, pool, phase, reducedMotion]);
  useEffect(() => {
    if (phase === 'out') {
      // old sentence has finished fading up+out → swap the text in its enter-start pose…
      const t1 = setTimeout(() => { setI((n) => n + 1); setPhase('in'); }, INTRO_EX_FADE_MS);
      return () => clearTimeout(t1);
    }
    if (phase === 'in') {
      // …then release it to settle (two-frame beat so the enter pose paints without a transition).
      const t2 = setTimeout(() => setPhase('shown'), 40);
      return () => clearTimeout(t2);
    }
  }, [phase]);
  const ease = IS_WEB && !reducedMotion && phase !== 'in'
    ? ({ transitionProperty: 'opacity, transform', transitionDuration: `${INTRO_EX_FADE_MS}ms`, transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' } as any)
    : null;
  const pose = reducedMotion || phase === 'shown'
    ? { opacity: 1, transform: [{ translateY: 0 }] }
    : phase === 'out'
      ? { opacity: 0, transform: [{ translateY: -6 }] }
      : { opacity: 0, transform: [{ translateY: 6 }] };
  return (
    <View
      testID="intro-example-rotator"
      pointerEvents="none"
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={s.introRotator}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
    >
      {text ? (
        <Text numberOfLines={1} ellipsizeMode="tail" style={[s.introRotatorText, ease, pose]}>
          {text}
        </Text>
      ) : null}
    </View>
  );
}

export default function Agent() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, locale, setLocale } = useI18n();
  const { seed, filter, chatBubble, chatSub, replay, fresh, hid } = useLocalSearchParams<{
    seed?: string;
    filter?: string;
    chatBubble?: string;
    chatSub?: string;
    replay?: string;
    fresh?: string;
    hid?: string; // history entry id — lets the replay path pick up the entry's saved result snapshot
  }>();
  const { user, runQuery, loadMoreListings, pendingMessage, setPendingMessage, recordChatTurn, trackOpen, history, setQuery, openAuth } = useApp();
  // Per-message "Load More" in flight, so a double-tap can't double-fetch the same page.
  const [loadingMore, setLoadingMore] = useState<Record<string, boolean>>({});
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [typed, setTyped] = useState('');
  // Rotating-example interaction latch (owner brief §6): the FIRST click/tap into the composer, the
  // first typed character, or a mic tap stops the rotating placeholder for good — it never fights
  // the user and never restarts mid-session. Only a genuinely fresh empty chat (sendGreeting: New
  // Chat, or first mount) re-arms it. Deliberately NOT reset on blur/clear — "may restart" is
  // optional in the brief, and staying away once the user has engaged is the calmer reading.
  const [introInteracted, setIntroInteracted] = useState(false);
  // Composer height: single line by default, grows only as text wraps (ChatGPT-style). (owner 2026-07-08)
  // Composer sizing (redesign 2026-08-16, owner brief: "closer to ChatGPT/Claude, but Ezhalah").
  // MIN = one 22px Arabic line; MAX = ~5 lines, then the input scrolls internally. `inputH` holds
  // the TARGET height from RN's own content metrics; `inputHAnim` glides to it (140ms ease-out) so
  // growth and shrink are smooth — the box never jumps between sizes. JS driver: height cannot use
  // the native driver, and 140ms of JS-driven height is imperceptible as work.
  const COMPOSER_MIN_H = 22;
  const COMPOSER_MAX_H = 112;
  const [inputH, setInputH] = useState(COMPOSER_MIN_H);
  // Focus glow — border eases fieldLine→primary and the lift deepens slightly (s.composerFocused +
  // COMPOSER_EASE). Same calm register as ModeSwitch's raised indicator: a state change you feel
  // more than notice.
  const [composerFocused, setComposerFocused] = useState(false);
  // Send button feel — the ModeSwitch/share spring constants, so the whole surface shares one
  // motion language. Hover (web) swells to 1.06; press dips to 0.9.
  const sendScale = useRef(new Animated.Value(1)).current;
  const sendSpring = (toValue: number) =>
    Animated.spring(sendScale, { toValue, stiffness: 260, damping: 26, mass: 0.7, useNativeDriver: Platform.OS !== 'web' }).start();
  const [sendHover, setSendHover] = useState(false);
  const inputRef = useRef<any>(null);
  // Desktop-web keyboard contract (ChatGPT/Claude convention): Enter sends and KEEPS focus for the
  // next message; Shift+Enter makes a new line. Bound as a raw DOM keydown on the textarea because
  // RNW's onKeyPress normalization reported key: "" for Enter (observed live) — the DOM event is
  // authoritative. preventDefault stops the newline; blurOnSubmit is web-false so RNW never blurs.
  // sendRef keeps the listener on the LATEST send() without re-binding per render.
  const sendRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!IS_WEB) return;
    const node: any = inputRef.current;
    if (!node?.addEventListener) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      // key === 'Enter' is the standard; 'Return' and keyCode 13 cover synthetic/legacy dispatchers.
      const isEnter = ev.key === 'Enter' || ev.key === 'Return' || ev.keyCode === 13;
      if (isEnter && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        // Enter while recording = the voice Send (atomic finalize + one submission), never a raw
        // send() of the pre-recording text out from under the live transcript.
        if (voiceActiveRef.current) sendVoiceRef.current();
        else sendRef.current();
      }
    };
    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, []);
  // ── Mobile-web keyboard tracking (ChatGPT-style) ──────────────────────────────────────────────
  // On mobile WEB, KeyboardAvoidingView is a no-op (its `behavior` is undefined off iOS-native), so
  // when the on-screen keyboard opens the LAYOUT viewport is unchanged and the composer ends up
  // hidden BEHIND the keyboard. The VISUAL viewport does shrink — track it and lift the composer by
  // exactly the keyboard height, with NO hardcoded numbers. iPhone Safari + Android Chrome both fire
  // these events continuously as the keyboard animates, so the composer follows it smoothly. Native
  // apps keep their own KeyboardAvoidingView behavior, so this stays 0 there.
  const [kbInset, setKbInset] = useState(0);
  useEffect(() => {
    if (!IS_WEB || typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // keyboard height = the slice of the layout viewport the visual viewport no longer covers
        setKbInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
      });
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => { cancelAnimationFrame(raf); vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []);
  const [busy, setBusy] = useState(false);
  // True once the user hit Stop mid-display: freezes the cards already shown and hides the "more
  // precise" CTA on the stopped results. Reset on every new turn. (user request.)
  const [stopped, setStopped] = useState(false);
  // Note #5 — Share sheet visibility in AI Agent mode. The button stays in the header throughout.
  const [shareOpen, setShareOpen] = useState(false);
  // Share button press feel — reuses ModeSwitch's own spring constants (stiffness 260, damping 26,
  // mass 0.7) so the header's two controls share one motion language (design review 2026-07-24;
  // mirrors the same redesign applied to the home screen's share button for cross-screen consistency).
  const shareScale = useRef(new Animated.Value(1)).current;
  const shareSpring = (toValue: number) =>
    Animated.spring(shareScale, { toValue, stiffness: 260, damping: 26, mass: 0.7, useNativeDriver: Platform.OS !== 'web' }).start();
  // Filter / AI ModeSwitch (owner 2026-08-16): the pill no longer lives in the top-right corner —
  // it sits CENTERED under the header, mirroring the home hero's centered pill, so switching modes
  // reads as one control staying in the middle rather than teleporting into the corner. And the
  // moment a search happens (any user message or results — same condition that hides the guest
  // chips), it fades + collapses away: mid-conversation the pill is noise. JS driver (height).
  const modeSearched = msgs.some((m) => m.role === 'user' || m.role === 'results');
  const [modeGone, setModeGone] = useState(false);
  useEffect(() => {
    if (modeSearched && !modeGone) {
      // Let the CSS collapse (MODE_EASE, 200ms) finish, then unmount. setTimeout, not an animation
      // callback — hidden tabs freeze rAF, and unmount must never hang on one (see afterAnimation).
      const id = setTimeout(() => setModeGone(true), 220);
      return () => clearTimeout(id);
    }
    if (!modeSearched && modeGone) setModeGone(false); // new chat — pill returns settled
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeSearched]);
  // ChatGPT-style feedback confirmation: a small «شكراً على ملاحظتك» toast at the TOP of the chat
  // (above the conversation, below the header) that appears briefly after a 👍/👎 and auto-dismisses
  // ~2.4s later. (owner 2026-07-09: like ChatGPT — not next to the buttons.) Fade/slide via the CSS
  // transition pattern (RN Animated/reanimated proved unreliable for opacity on this RN-web setup).
  const [fbToast, setFbToast] = useState(false);
  const fbToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showFbToast = () => {
    setFbToast(true);
    if (fbToastTimer.current) clearTimeout(fbToastTimer.current);
    fbToastTimer.current = setTimeout(() => setFbToast(false), 2400);
  };
  useEffect(() => () => { if (fbToastTimer.current) clearTimeout(fbToastTimer.current); }, []);

  // ── Voice input (owner brief 2026-08-23 — ChatGPT-style recording composer) ────────────────────
  // The composer itself morphs into recording mode: [X · live waveform · ■ · ↑] layered over the
  // normal controls inside the SAME s.composer surface — never a modal/sheet/second composer.
  // Capture + transcription live in src/lib/voiceInput.ts (free/native Web Speech, Arabic-only);
  // this block is only the UI state machine. Text typed before recording is preserved: the
  // transcript is APPENDED to it on Stop/Send, and X restores exactly the pre-recording composer.
  // 'processing' is the brief post-Stop beat only — capture has already fully torn down by the
  // time it's entered; it exists purely to show a loading indicator instead of an instant cut.
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'processing'>('idle');
  // Invalidates a pending "processing" beat's setTimeout if superseded (new recording, cancel,
  // unmount, navigation) — the same generation-token idiom voiceInput.ts uses, so a stale timeout
  // can never stomp a newer state or fire setTyped after this screen is gone.
  const voiceStopGenRef = useRef(0);
  // The SYNCHRONOUS truth for every guard (and the raw-DOM Enter handler). Managed explicitly in
  // each transition, never derived from render — a render-assigned mirror stays stale for the rest
  // of the tick, which let Stop→Send in the SAME tick pass both guards and submit the base text
  // without the transcript (found tracing journey E; sub-16ms, but real).
  const voiceActiveRef = useRef(false);
  const voiceBaseRef = useRef(''); // `typed` at the moment recording started (owner brief §8/§15)
  // Reentrancy latch (owner brief §5/§17): sendVoice's finalize+submit is atomic — double tap,
  // Stop+Send races and late recognizer events all collapse into at most ONE submission (send()'s
  // own busy guard is the second wall; stopVoiceInput() hands the transcript out exactly once).
  const voiceFinalizingRef = useRef(false);
  // Transient Arabic notice above the composer (permission denied / unsupported) — the fbToast
  // pattern with its own text. Never surfaces raw browser error text (owner brief §15).
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const voiceNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showVoiceNotice = (msg: string) => {
    setVoiceNotice(msg);
    if (voiceNoticeTimer.current) clearTimeout(voiceNoticeTimer.current);
    voiceNoticeTimer.current = setTimeout(() => setVoiceNotice(null), 3200);
  };
  useEffect(() => () => { if (voiceNoticeTimer.current) clearTimeout(voiceNoticeTimer.current); }, []);

  const startVoice = async () => {
    if (voiceActiveRef.current || busy) return; // mic tapped twice → one state transition
    setIntroInteracted(true); // mic tap stops the rotating examples cleanly (owner brief §6/§7)
    // Voice input and Read Aloud never share audio (owner brief §19): starting the mic stops any
    // reading immediately, and the subscription below keeps read-aloud out for the whole session.
    stopReadAloud();
    if (!isVoiceInputSupported()) { showVoiceNotice(t('Voice input is not supported on this browser')); return; }
    voiceStopGenRef.current++; // invalidate any pending "processing" beat from a previous Stop
    voiceBaseRef.current = typed;
    voiceActiveRef.current = true; // synchronous latch — a second tap in the same tick is a no-op
    setVoiceState('recording'); // morph now; a denied permission gracefully restores below
    await startVoiceInput({
      onFailure: (kind, detail) => {
        voiceActiveRef.current = false;
        setVoiceState('idle'); // composer restores cleanly — never stuck in recording mode
        // 'blocked' (service/hardware failure, not permission) gets its own honest message —
        // never the "check your settings" text, which is only correct for a true 'denied'.
        // 'service-not-allowed' specifically is Apple's own on-device speech-recognition service
        // refusing the request — confirmed real on an actual iPhone, 2026-08-24 (mic permission had
        // already been granted cleanly; this fired anyway). That's an iOS Settings state (Dictation
        // disabled, or no on-device Arabic model), not anything this code can force — but the generic
        // "try again" is actively unhelpful when the real fix is one specific toggle, so this exact
        // code gets its own actionable message instead of the generic 'blocked' text.
        const msg = kind === 'denied'
          ? t('Microphone access is needed for voice input. Enable it in your browser settings.')
          : detail === 'service-not-allowed'
          ? t('Speech recognition is turned off on your device. Enable Dictation in your iPhone Settings, then try again.')
          : kind === 'blocked'
          ? t("The microphone couldn't be reached. Please try again.")
          : t('Voice input is not available right now.');
        // A short, standardized API code tag (never a raw Error message/stack) so a real-device
        // report can be traced to its exact cause instead of guessed at (owner report, 2026-08-24).
        showVoiceNotice(detail ? `${msg} (${detail})` : msg);
      },
    });
  };
  // ■ Stop — finish listening WITHOUT submitting: capture stops instantly (synchronous teardown,
  // exactly as before); a brief "processing" beat then shows a loading indicator in the waveform's
  // place — ChatGPT-style — before the transcript lands in the composer for the user to inspect/edit
  // (Send is theirs to tap, owner brief §5/§9). The beat is purely cosmetic dwell time: it never
  // delays when recording actually ends, only when the UI settles back to idle.
  const stopVoice = () => {
    if (!voiceActiveRef.current) return; // Stop tapped twice → one finalization
    voiceActiveRef.current = false;
    const transcript = stopVoiceInput(); // mic is fully torn down NOW, regardless of the beat below
    const merged = [voiceBaseRef.current.trim(), transcript].filter(Boolean).join(' ');
    setVoiceState('processing');
    const myGen = ++voiceStopGenRef.current;
    setTimeout(() => {
      if (voiceStopGenRef.current !== myGen) return; // superseded — a newer action already resolved this
      setVoiceState('idle');
      if (merged) setTyped(merged);
    }, STOP_PROCESSING_MS);
  };
  // X — cancel: discard capture AND transcript, send nothing, add nothing to the chat; `typed`
  // was never touched during recording, so the composer returns to its exact pre-recording state.
  const cancelVoice = () => {
    if (!voiceActiveRef.current) return;
    voiceActiveRef.current = false;
    voiceStopGenRef.current++; // invalidate a pending "processing" beat — X wins outright
    cancelVoiceInput();
    setVoiceState('idle');
  };
  // ↑ Send while recording — atomic: stop capture, finalize the transcript, submit exactly once.
  const sendVoice = () => {
    if (voiceFinalizingRef.current || !voiceActiveRef.current) return;
    voiceFinalizingRef.current = true;
    voiceActiveRef.current = false;
    const transcript = stopVoiceInput(); // synchronous teardown — no late event can re-enter
    setVoiceState('idle');
    voiceFinalizingRef.current = false;
    const merged = [voiceBaseRef.current.trim(), transcript].filter(Boolean).join(' ');
    if (!merged) return; // nothing was said — exit recording, never send an empty message
    // Land the transcript in the composer FIRST: if send() proceeds it clears it (its own
    // setTyped('')), and if send() refuses (busy — e.g. a replayed pending message raced in), the
    // words the user spoke are sitting in the input instead of vanishing.
    setTyped(merged);
    void send(merged);
  };
  const sendVoiceRef = useRef<() => void>(() => {});
  sendVoiceRef.current = sendVoice;
  // LIFECYCLE SAFETY (owner brief §16): the mic dies the moment this screen unmounts or loses
  // navigation focus (route change, sidebar navigation, in-app browser) — never a hidden capture.
  useEffect(() => () => { voiceStopGenRef.current++; cancelVoiceInput(); }, []);
  useFocusEffect(useCallback(() => () => { voiceStopGenRef.current++; voiceActiveRef.current = false; cancelVoiceInput(); setVoiceState('idle'); }, []));
  // While the mic is live, a Read Aloud started from an old message is stopped instantly — the two
  // audio paths can never run together (owner brief §19).
  useEffect(() => {
    if (voiceState !== 'recording') return;
    return subscribeReadAloud((id) => { if (id) stopReadAloud(); });
  }, [voiceState]);
  // Morph motion (owner brief §3/§11): one physical surface, ~180ms soft cross-fade + a few px of
  // settle — state drives the target, CSS drives the motion (the TOAST_EASE idiom). Reduced motion
  // collapses to a plain opacity state change; the waveform keeps showing real amplitude, which is
  // information, not decoration (owner brief §18).
  const reducedMotion = useReducedMotion();
  const VOICE_EASE = IS_WEB && !reducedMotion
    ? ({ transitionProperty: 'opacity, transform', transitionDuration: '180ms', transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' } as any)
    : null;
  // True WHILE the property cards are popping in one-by-one — so the Send button shows as a Stop button
  // for the whole reveal (not just the network wait), letting the user halt the drip. (user request.)
  const [revealing, setRevealing] = useState(false);
  // Same pattern as the home screen: on mobile the sidebar isn't docked, so a hamburger opens it.
  // On desktop it's a permanent column → no button. (user: couldn't see the burger on the phone.)
  const docked = useDocked();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Which result messages have finished typing their reply. The property cards stay hidden until the
  // words above them are fully written out, so listings never appear before Ezhalah has spoken (user
  // request). Keyed by message id.
  const [doneTyping, setDoneTyping] = useState<Record<string, boolean>>({});
  // After the reply finishes typing, the listing cards are revealed ONE AT A TIME, slowly, and the
  // page eases down to each new card as it pops in — so the user is carried below one listing at a
  // time instead of a whole grid landing at once. (user request.) revealCount[id] = how many cards
  // are visible so far; absent = show all (used for replayed/history turns that don't type out).
  const REVEAL_STEP_MS = 130; // snappy one-by-one cascade (25 cards ≈ 3s), smooth not distracting
  const FIRST_PAGE = 10; // show the first 10; «عرض المزيد» pages the rest of the matched set. (owner 2026-07-08.)
  // Page 0 fetches up to data/remote.ts QUERY_LIMIT (1500) MATCHING candidates (RPC filters before the cap).
  // If it fills that page the DB has more (m.result.hasMore) — the "how many" message then says «أكثر من N»
  // (never a faked exact total) and «عرض المزيد» fetches the next real page. Once fully paged, listings.length
  // IS the exact match count. (owner 2026-07-08: never hide a valid match behind the display limit.)
  const [revealCount, setRevealCount] = useState<Record<string, number>>({});
  const pendingRefineRef = useRef<{ q: SearchQuery; dim: string } | null>(null); // a >25 "refine" question awaiting the user's one-line answer
  // Advanced-question overlay (عمر العقار, apartment-only for now) — a transient card shown ON TOP of
  // the current results when «خلّنا نحدد الطلب أكثر» is tapped in an apartment scope. Answering hands
  // off to the SAME runRefine mechanism used by the pre-existing chip flow (echoes a user bubble,
  // re-runs search, renders a new results turn) — never a separate navigation/route.
  const [ageFlow, setAgeFlow] = useState<
    | { phase: 'loading' }
    // Opening state (owner 2026-08-16): after an eligible Filter search lands with > 25 results the
    // overlay opens on this calm invitation — the count, «خلّنا نحدد طلبك أكثر», one soft line —
    // never a question. Begin is opt-in; «عرض النتائج» closes it (the results are already behind).
    | { phase: 'intro'; total: number | null }
    | { phase: 'asking'; stepIndex: number; question: AdvancedQuestion; options: AdvancedOption[]; unknownCount: number; initialKeys: string[]; progressCur: number; progressTotal: number }
    // The «digging through the market» beat (owner 2026-08-16): shown once after the interview
    // finishes while the final search runs behind it. Dismissal is driven by plain setTimeout
    // latches in finishGuided — NEVER an animation callback (src/lib/afterAnimation.ts rule).
    | { phase: 'mining'; from: number | null; to: number | null }
    | null
  >(null);
  // The query accumulates answers as the flow advances; `token` supersedes a stale async fetch when a
  // newer tap/turn restarts the flow; `changed` gates the single end-of-flow re-search (skip-everything
  // → close); `labels` collects picked labels for the summary bubble; `plan` is the eligible+qualifying
  // question set resolved up front, so the progress bar reflects the questions that will actually show.
  const ageFlowQueryRef = useRef<SearchQuery | null>(null);
  const ageFlowTokenRef = useRef(0);
  const ageFlowChangedRef = useRef(false);
  const ageFlowLabelsRef = useRef<string[]>([]);
  const ageFlowPlanRef = useRef<Array<{ question: AdvancedQuestion; options: AdvancedOption[]; unknownCount: number; total: number }>>([]);
  // Questions already answered OR skipped this session — never re-asked (owner 2026-08-11). The
  // plan is RE-RANKED against the narrowed set after every answer, so ask-order is contextual.
  const ageFlowAskedRef = useRef<Set<string>>(new Set());
  // Latest KNOWN size of the narrowed set (from the ranked probes) — feeds the intro count and the
  // mining transition's «نراجع N عقار» line with real numbers, never placeholders.
  const ageFlowTotalRef = useRef<number | null>(null);
  // The interview's answers as removable FACETS (owner 2026-08-16): each committed answer records
  // {question id, picked keys, labels}. The results pills rebuild the query from baseQ by re-applying
  // the REMAINING facets — removal is pure recomputation, never an ad-hoc inverse per question.
  const ageFlowBaseQRef = useRef<SearchQuery | null>(null);
  const ageFlowFacetsRef = useRef<Array<{ id: string; keys: string[]; labels: string[] }>>([]);
  // THE interview record (owner 2026-08-22, «رجوع»): one ordered list of every question presented,
  // each carrying the answer given for it. `keys: null` = presented but not answered yet; `[]` =
  // skipped (no preference, NO predicate). A cursor walks it, so Back is simply "move the cursor
  // back one and show that step again".
  //
  // Every guided ref above is DERIVED from this list by syncGuidedFromSteps — the query is rebuilt
  // from baseQ by re-applying the steps before the cursor, never un-applied by a hand-written
  // inverse. That is what makes «no stale hidden predicate» structural rather than a promise: a
  // step that is dropped or changed simply stops contributing to the rebuild, and an amenity list
  // (which appends) can never accumulate twice from re-answering the same question.
  const ageFlowStepsRef = useRef<GuidedStep[]>([]);

  // Rebuild query/asked/labels/facets from steps[0 .. upTo-1]. `upTo` is the CURSOR: the step being
  // asked is deliberately NOT applied, so its option counts and live count read against the scope
  // the user is answering from — re-answering a question never stacks on top of its own old answer.
  const syncGuidedFromSteps = (upTo: number) => {
    const d = deriveGuided(ageFlowBaseQRef.current, ageFlowStepsRef.current, upTo);
    ageFlowQueryRef.current = d.query;
    ageFlowAskedRef.current = new Set(d.askedIds);
    ageFlowLabelsRef.current = d.labels;
    ageFlowFacetsRef.current = d.facets;
    ageFlowChangedRef.current = d.facets.length > 0;
  };
  // Intro «يلا نبدأ» tapped before the ranked plan resolved — present the first question the moment
  // it lands instead of leaving the user waiting on a silent card.
  const introBeginRef = useRef(false);
  const miningTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { miningTimersRef.current.forEach(clearTimeout); }, []);
  const revealTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // The results turn whose cards are still popping in one-by-one (id + total count), so a new user
  // message can instantly finish it and stop the drip. null once the reveal completes. (user request.)
  const revealActiveRef = useRef<{ id: string; count: number } | null>(null);
  // Reveal a results turn's cards one-by-one. Driven directly with the known count `n` (so it works
  // even right after a setMsgs morph, when `msgs` is still stale). markTyped is the onDone shim.
  // All cards appear AT ONCE (the user disliked the one-by-one pop-in animation). We still mark the
  // reply as "done typing" so the cards render, but we reveal the full count in a single state update
  // and skip the staggered timers entirely. No `revealing` state → Stop button is gone from the card
  // phase. (user request: remove the property-card reveal animation.)
  // Y-offset of each message inside the scroll content, captured via onLayout. Lets us scroll to the
  // TOP of a results message (so the Ezhalah response stays visible and cards appear below) instead of
  // yanking to the very bottom of the chat. (user request: don't drag the whole screen down.)
  const msgYRef = useRef<Record<string, number>>({});
  // After the reply text + sort line finish, reveal the property cards ONE BY ONE with a gentle
  // stagger — and do NOT force-scroll to the bottom. We scroll once to bring the TOP of the response
  // near the top of the viewport (keeping the message context visible), then let the cards fill in
  // below at their own pace without any further auto-scroll. (user request: controlled, smooth, cards
  // appear under the response; text fully typed BEFORE any card shows.)
  // Guard so the drip starts exactly once per results message — playListings kicks it off the moment
  // results are ready (cards appear WHILE the intro still types, owner 2026-07-09), and markTyped's
  // later call becomes a no-op instead of restarting the cascade.
  const dripStartedRef = useRef<Record<string, true>>({});
  // Reveal cards (from → to] one-by-one — shared by the FIRST page (beginCardDrip) and every
  // «عرض المزيد» batch (owner 2026-07-09: new cards must cascade in with a soft fade+rise, never
  // land all at once). Each mounting card animates itself (CardIn); the tick cadence provides the
  // stagger. Uses the shared timers/active-ref so Stop and new-turn finalize keep working.
  const dripRange = (id: string, from: number, to: number, stepMs: number, onDone?: () => void) => {
    if (to <= from) { onDone?.(); return; }
    revealActiveRef.current = { id, count: to };
    setRevealing(true);
    let shown = from;
    const tick = () => {
      // OWNERSHIP GUARD (review fix 2026-07-09): if a newer drip (new turn) or finalize/stop took
      // over the shared active-ref, this cascade stops silently — it must never clear state it no
      // longer owns (that stranded the new turn's drip). Unrevealed cards stay recoverable behind
      // «عرض المزيد» (bufferMore).
      if (revealActiveRef.current?.id !== id) return;
      shown += 1;
      setRevealCount((c) => ({ ...c, [id]: shown }));
      if (shown < to) {
        revealTimers.current.push(setTimeout(tick, stepMs));
      } else {
        revealActiveRef.current = null;
        setRevealing(false);
        onDone?.();
      }
    };
    revealTimers.current.push(setTimeout(tick, 40)); // start right away — no empty gap
  };
  // Begin the one-by-one card cascade for a results message. Does NOT touch doneTyping — the intro
  // text keeps typing above while cards fill in below; the more-message + feedback row still wait
  // for the text (their own doneTyping gates).
  const beginCardDrip = (id: string, n: number) => {
    if (dripStartedRef.current[id]) return;
    dripStartedRef.current[id] = true;
    pinModeRef.current = 'none'; // stop the bottom-follow so growing card list never yanks the view
    if (n <= 0) return;
    // Start from ZERO in the same render so the full grid never flashes in before the cascade.
    setRevealCount((c) => ({ ...c, [id]: 0 }));
    // Gentle one-time scroll: bring the response's top ~80px from the top of the viewport. Keeps the
    // slogan + summary + intro in view with the first cards just below — never the far bottom.
    const y = msgYRef.current[id];
    if (typeof y === 'number') {
      setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true }), 60);
    }
    dripRange(id, 0, n, REVEAL_STEP_MS);
  };
  const startReveal = (id: string, n: number) => {
    setDoneTyping((d) => (d[id] ? d : { ...d, [id]: true }));
    if (n <= 0) {
      if (!dripStartedRef.current[id]) { revealActiveRef.current = null; setRevealing(false); }
      pinModeRef.current = 'none';
      return;
    }
    beginCardDrip(id, n);
  };
  const markTyped = (id: string) => {
    const msg = msgs.find((m) => m.id === id);
    startReveal(id, msg?.role === 'results' ? Math.min(FIRST_PAGE, msg.result?.listings?.length ?? 0) : 0);
  };
  // Cancel any pending one-by-one reveals (on unmount, or when a new turn starts).
  const clearReveals = () => { revealTimers.current.forEach(clearTimeout); revealTimers.current = []; };
  useEffect(() => clearReveals, []);
  // A new user turn must STOP the previous search's card drip immediately — show whatever that turn
  // had (all of it, so nothing is lost) and kill the pending timers. We never touch any other message.
  // (user: "when I write something, the cards above should stop." )
  const finalizeReveal = () => {
    clearReveals();
    const active = revealActiveRef.current;
    if (active) setRevealCount((c) => ({ ...c, [active.id]: active.count }));
    revealActiveRef.current = null;
    setRevealing(false);
  };
  const scrollRef = useRef<ScrollView>(null);
  // Per-param change detection so REPEATED filter/seed searches re-run. The agent screen is REUSED
  // (not remounted) between searches, so a one-shot "seeded" guard used to swallow every search after
  // the first → "keep searching, nothing pops up". Track the last-handled param and re-run on change.
  const lastFilterRef = useRef<string | undefined>(undefined);
  const lastSeedRef = useRef<string | undefined>(undefined);
  const greetedRef = useRef(false);
  const consumedPendingRef = useRef(false);
  const greetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which edge the thread sticks to as content grows. A filter search opens at the TOP (so the
  // user reads their request bubble first, then scrolls down through results); typed chat sticks
  // to the bottom like a normal conversation. 'none' = leave the user wherever they scrolled.
  const pinModeRef = useRef<'top' | 'bottom' | 'none'>('bottom');
  // Holds the query + response subheading while the request bubble types itself out, so onBubbleDone
  // can move on to the "searching…" beat and then the typed response.
  const pendingFilterRef = useRef<{ q: SearchQuery; sub: string; statusId: string } | null>(null);
  // The current in-flight turn, so the Stop box can cancel its remaining beats.
  const runRef = useRef<Run | null>(null);
  // Anti-loop state for the logged-in conversational mode. The backend is stateless — it only ever
  // sees the LATEST message — so when the user gives vague follow-ups ("idk floor", "idk floor
  // maybe") the model keeps re-asking the same thing forever. We hold the conversation here: every
  // user line is accumulated in `saidRef`, and `askCountRef` counts how many clarifying questions
  // we've shown. After 2 questions, if anything usable was said, we stop asking and just search with
  // whatever we have. (user request: "Ask maximum 2 times per field. If no answer → skip → scrape.")
  const saidRef = useRef<string[]>([]);
  const askCountRef = useRef(0);
  // The region-AND-city twin name we last asked «تقصد مدينة X ولا منطقة X كاملة؟» about. That question
  // is OURS (deterministic, generated below), so its answer is committed deterministically too — the
  // model replied to it with a greeting or yet another question often enough that leaving the answer to
  // the model WAS the loop. Read-and-cleared once per turn; also cleared by New Chat.
  const pendingScopeRef = useRef<string | null>(null);

  const toBottom = () => requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  const toTop = () => requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
  const onGrow = () => {
    if (pinModeRef.current === 'top') toTop();
    else if (pinModeRef.current === 'bottom') toBottom();
  };

  // Stop box: cancel the current turn. Drop the in-flight "thinking/searching" bubbles (anything
  // already written — the reply, earlier results — stays), unblock any waiting beat, and re-enable
  // the composer. (user request: a box the user can click to stop the search.)
  // FILTER → SEARCH → STOP → SAME FILTER (owner 2026-08-18). A search that began at «بحث» on the
  // normal Filter must feel like it never happened: cancel everything for real, then land the user
  // back on the exact Filter state they submitted — never a partial-results or empty Agent screen.
  // A search that began in the AI chat keeps the existing ChatGPT-like stop-in-place behavior below
  // unchanged; only sendFilter() ever tags its run 'filter' (see the Run type), so that's the one and
  // only signal this reads — no separate "did the user come from Filter" tracking to keep in sync.
  const stop = () => {
    const run = runRef.current;
    // Was a REAL search turn in flight, or only a «عرض المزيد» card cascade? (review fix 2026-07-09:
    // stopping a mere pagination cascade must NOT claim "I've stopped the search" or hide CTAs.)
    const hadTurn = !!run;
    if (run) {
      run.cancelled = true;
      run.ac.abort(); // real network cancellation — see bounded()'s external-signal support in remote.ts
      run.timers.forEach(clearTimeout);
      run.flush.forEach((r) => r());
    }
    const wasFilterOrigin = run?.origin === 'filter';
    runRef.current = null;
    pendingFilterRef.current = null; // also cancels a filter flow still typing its request bubble
    clearReveals();   // stop revealing more cards immediately — never continue toward card #15
    revealActiveRef.current = null; // forget the in-progress reveal so the NEXT message never completes it
    setRevealing(false); // Stop reverts to Send
    if (!hadTurn) return; // cascade halted; cards stay frozen, «عرض المزيد» recovers via bufferMore

    if (wasFilterOrigin) {
      // Erase the cancelled turn rather than freezing/annotating it — if the user opens الوكيل الذكي
      // again later, a dangling "بحث..." bubble from a search that (from their side) never completed
      // would contradict "it should feel like the search never completed". A bare `/agent` (no
      // filter/seed) then greets fresh, exactly like any other new chat.
      setMsgs([]);
      setBusy(false);
      // The just-cancelled filter's JSON is still sitting in lastFilterRef (set by the param-consuming
      // effect before sendFilter ran). Without clearing it, resubmitting the SAME filter unchanged would
      // match `filter !== lastFilterRef.current` as false and the effect would silently no-op — the
      // exact "keep searching → nothing pops up" class lastFilterRef exists to prevent, here triggered
      // by Stop instead of a stale mount.
      lastFilterRef.current = undefined;
      lastSeedRef.current = undefined;
      // The submitted Filter state already lives in the shared query context — the param-consuming
      // effect wrote it verbatim from `?filter=` before this search began (setQuery(() => q)), and
      // nothing between then and here ever touches query context again. router.replace('/') is the
      // exact navigation «تصفية» already uses to leave this screen (ModeSwitch's onSwitch below), which
      // is what lets the Filter form's own rehydration (city/district catalog matching against query
      // context) and — when the screen never unmounted — its still-live local state (price/area inputs,
      // bedroom pills, category/type) show the pre-search selections back exactly, city and districts
      // included. No separate "snapshot the filter" mechanism needed: nothing here ever overwrote it.
      router.replace('/');
      return;
    }

    setStopped(true); // hide the "I can get you something more precise" CTA on the stopped results
    setBusy(false);   // search no longer running
    // Drop the in-flight thinking/searching bubbles; the cards already shown stay frozen. Add Ezhalah's
    // stop acknowledgement directly under the user's request (shown instantly, no typewriter). (user request.)
    setMsgs((m) => [
      ...m.filter((x) => x.role !== 'status'),
      { id: uid(), role: 'agent', text: tr("I've stopped the search. Is there anything else I can help you with today?"), typing: false },
    ]);
    toBottom();
  };

  // Guests are NOT interrupted by any sign-up popup after a search — they search freely within their
  // session (a guest's chats just aren't persisted). NO-OP by design: the post-search sign-up modal was
  // removed. (user 2026-06-28: "remove this popup, no need.") Re-enable a soft nudge here if ever wanted.
  const promptSignupSoon = async (_run: Run) => { /* intentionally does nothing */ };

  // The "about to scrape" intro: one random Saudi-dialect hype line, then a compact read-back of
  // exactly what we're going to search for — "Looking for:" + "Villa · Rent · Riyadh · SAR 5,000 ·
  // 3 beds". No price math, no prose, no judgement — just the parsed query echoed back so the user
  // can see we understood, right before "Ezhalah is searching…". (user request.)
  // The structured "Search Summary" of exactly what we parsed — now shown WITH the results (under the
  // professional header), NOT with the slogan. The slogan lives only in the transient searching status.
  const buildScrapeIntro = (q: SearchQuery) => searchSummary(q);

  // When each status bubble's SEARCHING phase became visible — playListings only waits out the
  // REMAINDER of SEARCH_MIN_MS from this moment, so the beat overlaps the real network time instead
  // of following it. (owner 2026-07-09: no artificial delays, results show as soon as ready.)
  const searchingAtRef = useRef<Record<string, number>>({});
  // Flip a chat-turn 'thinking' status into the live searching loader the moment the query is KNOWN
  // (right before runQuery) — the pills + min-beat then overlap the fetch exactly like the
  // filter/refine paths. Without this, chat searches only started their beat AFTER the results were
  // already in memory, holding them the full SEARCH_MIN_MS + exit (review finding, 2026-07-09).
  const beginSearching = (statusId: string, q: SearchQuery) => {
    searchingAtRef.current[statusId] = searchingAtRef.current[statusId] ?? Date.now();
    setMsgs((m) => m.map((x) => (x.id === statusId && x.role === 'status' ? { ...x, phase: 'searching', query: q } : x)));
    toBottom();
  };

  // Shared "found" choreography: the typed reply ("answer respond") → a held "Ezhalah is searching…"
  // beat → the results header + cards. `statusId` is the thinking bubble we morph into the reply.
  const playListings = async (run: Run, statusId: string, summary: string, result: SearchResult, messageText?: string) => {
    // 1) SEARCHING phase: status bubble shows the slogan + summary. Slogan language follows the
    // user's MESSAGE text (English message → English slogan) instead of the UI locale, so users
    // who chat in one language and have their UI in the other still get the matching slogan.
    const slogan = hypePhrase(getLocale(), messageText);
    // The searching status renders the platform-checking ANIMATION (SearchLoader), not the slogan.
    // We still carry slogan + summary through so they appear in the RESULTS bubble below (unchanged).
    // `resultSources` only lets result-present platforms LEAD the (frozen) pill order — it is NOT a
    // completion signal and must never drive checkmarks (owner: no ✓ in the loader, ever).
    const resultSources = Array.from(new Set(result.listings.map((l) => l.source).filter(Boolean)));
    setMsgs((m) => m.map((x) => (x.id === statusId
      ? { id: statusId, role: 'status', phase: 'searching', slogan, summary, query: result.query ?? (x.role === 'status' ? x.query : undefined), resultSources }
      : x)));
    toBottom();
    // Wait only the REMAINDER of the minimum searching beat (counted from when the searching loader
    // became visible — at Search press for filter/refine flows). It overlapped the bubble typing +
    // network, so in practice it's already consumed → results morph in IMMEDIATELY on resolve.
    const since = searchingAtRef.current[statusId] ?? Date.now();
    searchingAtRef.current[statusId] = since;
    const remaining = SEARCH_MIN_MS - (Date.now() - since);
    if (remaining > 0) await waitRun(run, remaining);
    delete searchingAtRef.current[statusId];
    if (run.cancelled) return;
    // Soft completion (owner v4): the loader fades out gently instead of vanishing in a single
    // frame — flag it `exiting`, give the fade its beat, then morph into the results state.
    setMsgs((m) => m.map((x) => (x.id === statusId && x.role === 'status' ? { ...x, exiting: true } : x)));
    await waitRun(run, LOADER_EXIT_MS);
    if (run.cancelled) return;
    // 2) RESULTS: ONE consolidated bubble in the exact order the user wants:
    //    [slogan] → [Search Summary] → [Result intro] → [Sort line] → [Property cards].
    //    The slogan + summary CARRY OVER from the searching status into this same bubble — they don't
    //    disappear and don't appear as a duplicate block. (user-reported order bug.)
    setMsgs((m) =>
      m.map((x) =>
        x.id === statusId
          ? { id: statusId, role: 'results', text: resultDone(getLocale()), result, typing: true, slogan, summary }
          : x,
      ),
    );
    toBottom();
    // NOTE (owner 2026-08-16, supersedes the morning's PR#705): results are deliberately NOT mirrored
    // back into `?filter=` here. Publishing them made a refresh restore the search — which is exactly
    // the behaviour the owner then ruled against ("refresh must never count as a new user search").
    // A search now lives only in this screen's state and, once run, in the sidebar history; the URL
    // carries it for the navigation hop and is consumed on arrival. Do not re-add a URL write here.
    // Cards start appearing NOW — one by one, while the intro text is still typing above (owner
    // 2026-07-09: show the first card as soon as valid listings are ready; don't hold them hostage
    // to the typewriter). The more-message + feedback row still wait for the text (doneTyping).
    beginCardDrip(statusId, Math.min(FIRST_PAGE, result.listings.length));
  };

  // «عرض المزيد» (Load more) — reveal the NEXT 100 matching listings (owner 2026-07-08: "100 at a time";
  // if fewer than 100 remain, show all remaining). Correctness rule: the RPC filters the FULL matching set
  // BEFORE any cap, so paging always reaches every match — nothing valid is hidden behind the display limit.
  // Each tap reveals REVEAL_STEP more from what's already fetched; when that buffer is spent and the DB still
  // has more pages (m.result.hasMore), we fetch the next REAL page (store.loadMoreListings, gap-free via
  // p_offset), append it de-duped, then reveal into it. So a broad search (e.g. Riyadh villas & houses =
  // 11,438) can be walked all the way to the end. loadingMore guards a double-tap from double-fetching.
  const REVEAL_STEP = 100;
  // «عرض المزيد» cascade cadence — inside the owner's 40–80ms stagger window; each mounting card also
  // fades+rises via CardIn, so the batch flows in instead of landing at once. (owner 2026-07-09.)
  const LOAD_MORE_STEP_MS = 55;
  // Only the VISIBLE screenful cascades one-by-one (~0.8s); the rest of the 100 mount together right
  // after, below the fold, each still fading in via CardIn. Keeps the premium feel without 100
  // sequential re-renders of the whole unvirtualized card list (review perf fix 2026-07-09).
  const CASCADE_VISIBLE = 14;
  const cascadeIn = (mid: string, from: number, target: number) => {
    const animEnd = Math.min(from + CASCADE_VISIBLE, target);
    dripRange(mid, from, animEnd, LOAD_MORE_STEP_MS, () => {
      if (target > animEnd) setRevealCount((c) => ({ ...c, [mid]: target }));
    });
  };
  const loadMore = async (m: Extract<ChatMsg, { role: 'results' }>) => {
    const mid = m.id;
    const q = m.result.query;
    if (runRef.current) return; // a real turn is mid-flight — never start a cascade under it (review fix)
    const fetched = m.result.listings.length;
    const cur = revealCount[mid] ?? Math.min(FIRST_PAGE, fetched);
    // BROWSE CAP (owner 2026-08-20): a search shows at most BROWSE_CAP cards. Once the cap is on screen
    // there is nothing more to reveal and no more pages to fetch — min(trueTotal, BROWSE_CAP) is the hard
    // ceiling on what the user can browse, even when thousands actually match (they see the true total in
    // the closing message, not more cards). This is the single gate that makes the cap a cap.
    if (cur >= BROWSE_CAP) return;
    // (A) fetched-but-unrevealed cards remain → cascade the next slice in from the buffer, up to the cap.
    if (cur < fetched) {
      cascadeIn(mid, cur, Math.min(cur + REVEAL_STEP, fetched, BROWSE_CAP));
      return;
    }
    // (B) buffer exhausted but the DB has more → fetch the next real page, append de-duped, cascade.
    if (!m.result.hasMore || !q || loadingMore[mid]) return;
    setLoadingMore((s) => ({ ...s, [mid]: true }));
    try {
      const { listings: more, nextOffset, hasMore } = await loadMoreListings(q, m.result.pageOffset ?? 0);
      // De-dup against the CLOSURE copy (same data the message holds) so the cascade target is exact.
      const seen = new Set(m.result.listings.map((l) => `${l.source}:${l.id}`));
      const add = more.filter((l) => !seen.has(`${l.source}:${l.id}`));
      const mergedLen = fetched + add.length;
      setMsgs((prev) =>
        prev.map((mm) => {
          if (mm.id !== mid || mm.role !== 'results' || !mm.result) return mm;
          return { ...mm, result: { ...mm.result, listings: [...mm.result.listings, ...add], pageOffset: nextOffset, hasMore } };
        }),
      );
      const target = Math.min(cur + REVEAL_STEP, mergedLen, BROWSE_CAP);
      // If a new turn started while the page was fetching, reveal instantly (no cascade) — the drip
      // machinery belongs to the new turn now; cards still fade in via CardIn. (review fix.)
      if (runRef.current) setRevealCount((c) => ({ ...c, [mid]: target }));
      else cascadeIn(mid, cur, target);
    } finally {
      setLoadingMore((s) => ({ ...s, [mid]: false }));
    }
  };

  // «ساعدني ألقى نتائج أدق» — pick ONE missing/broad dimension and ask a single clarifying question with
  // CLICKABLE answer chips (never typed). The tapped answer is merged into the SAME filter query and
  // re-searched. One question at a time; never shows more listings itself. A typed reply still works as a
  // fallback (the refine intercept in send). (user 2026-06-27: clickable, not typed.)
  //
  // GUARD (AF+Trending Data Integrity run, 2026-08-23): `pendingRefineRef` is the single source of truth
  // for "a refine question is already on screen awaiting an answer" — `send()`'s REFINE INTERCEPT and
  // `runRefine()` both already treat it that way (only ONE pending refine is ever a valid state). Nothing
  // previously stopped a second startRefine() call while one was already pending: both call sites route
  // through this ONE function via «خلّنا نحدد الطلب أكثر» (the fallback when the AF plan has 0 useful
  // questions — see startAgeFlow) and the outline «نتائج أدق» button, and NEITHER call site disables
  // itself while its own async work is in flight. A rapid double-tap on either (or the AF entry re-showing
  // its CTA the instant `setAgeFlow(null)` fires, one tick before this runs) fired startRefine() twice and
  // appended the IDENTICAL question+chips twice into the chat — reproduced live 2026-08-23 on a real
  // production search (شقة/3 غرف/الصفاء، جدة → «كم ميزانيتك تقريباً؟» rendered as two back-to-back
  // messages with duplicate, independently-tappable chip sets). Root-caused here, the one shared function
  // every caller already routes through, rather than patched at each Pressable.
  const startRefine = (q?: SearchQuery) => {
    if (!q || pendingRefineRef.current) return;
    const ar = getLocale() !== 'en'; // Arabic-first; English session → English labels.
    let dim = ''; let ask = ''; let options: { label: string; value: string }[] = [];
    // DISTRICT first — only when a city is set AND we have real, listing-backed neighbourhoods to offer.
    if (q.location && !(q.districts && q.districts.length) && q.locationMatch?.kind !== 'district') {
      const ds = topDistrictsForCity(q.location, 6);
      if (ds.length >= 2) {
        dim = 'district';
        // (fix, 2026-07-16 Arabic-only sweep) q.location can be the LLM's own canonical-ENGLISH
        // city choice on the AI-agent path (the system prompt explicitly prefers English for known
        // cities) — arLabel() (already used elsewhere in this file for the same reason) falls back
        // to the unresolved placeholder instead of interpolating raw English into this Arabic chip.
        ask = ar ? `أي حي تفضّل في ${arLabel(q.location)}؟` : `Which district in ${q.location}?`;
        options = ds.map((d) => ({ label: d, value: d }));
      }
    }
    if (!dim && !q.priceInput && !q.priceBand) {
      dim = 'budget';
      ask = ar ? 'كم ميزانيتك تقريباً؟' : 'What is your approximate budget?';
      const ceil = q.deal === 'Buy' ? [500_000, 1_000_000, 2_000_000, 5_000_000] : [30_000, 50_000, 80_000, 150_000];
      options = ceil.map((c) => ({ label: budgetLabel(c, ar), value: String(c) }));
    }
    // Bedrooms are asked ONLY where the canonical applicability rules (the same detailFor/
    // detailForContext the Filter home uses) say they exist — never for land/warehouse/factory/
    // workshop/etc. Asking there caused the "3" answer to be misparsed as a 3 m² area filter.
    // (audit item 5, owner rule 2026-07-27.)
    const bedsApplicable = q.type
      ? detailFor(q.type).isBedrooms
      : (detailForContext(q.category ?? 'Residential', effectiveGroups(q))?.showBeds ?? true);
    if (!dim && !q.detail && bedsApplicable) {
      dim = 'beds';
      ask = ar ? 'كم غرفة نوم تبغى؟' : 'How many bedrooms?';
      options = ['1', '2', '3', '4', '5'].map((n) => ({ label: bedsLabel(n, ar), value: n }));
    }
    // THE LEGACY TYPE QUESTION IS DELETED (owner 2026-08-23). It hardcoded four labels
    // (شقة/فيلا/دور/أرض) that were NOT the canonical taxonomy — no group tier, no Studio/Room/
    // Residential Building/Rest House/Duplex, nothing commercial — and wrote only the scalar
    // `q.type`, bypassing the typeGroups/types multi-select the whole app is built on. It was
    // reachable from the same «خلّنا نحدد الطلب أكثر» button as the interview, so which type
    // question a user got depended on live counts. Property type is now asked in exactly ONE place,
    // the Advanced Filter's scope prefix, always from HIERARCHY. `applyRefinement`'s 'type' branch
    // is deliberately kept: an in-flight `pendingRefineRef` from before this change, and the
    // free-text path, can still deliver a typed type answer.
    if (!dim) { // everything already specified → open free-form question (typed answer)
      dim = 'free';
      ask = ar ? 'وش تحب نضيّق فيه أكثر؟ (الميزانية، الحي، عدد الغرف، نوع العقار…)'
               : 'What would you like to narrow further? (budget, district, bedrooms, type…)';
    }
    pendingRefineRef.current = { q, dim }; // typed-answer fallback; chips are the primary path
    const refine = options.length ? { dim, baseQ: q, options } : undefined;
    setMsgs((m) => [...m, { id: uid(), role: 'agent', text: ask, typing: true, refine }]);
    toBottom();
  };

  // Merge the user's one-line refine answer into the existing filter query — only the asked dimension.
  const applyRefinement = (base: SearchQuery, dim: string, answer: string): SearchQuery => {
    const a = answer.trim();
    const refined: SearchQuery = { ...base };
    if (dim === 'district') {
      const hood = a.replace(/^\s*حي\s+/, '').trim();
      refined.location = `حي ${hood}، ${base.location ?? ''}`.trim(); // resolveLocation handles «District، City»
      refined.locationMatch = undefined; refined.districts = undefined;
    } else if (dim === 'budget') {
      refined.priceInput = a;
    } else if (dim === 'beds') {
      const n = (a.match(/\d+/) || [])[0]; if (n) refined.detail = n;
    } else if (dim === 'type') {
      const p = parseQuery(a);
      if (p.type) refined.type = p.type;
      if (p.typeGroups && p.typeGroups.length) refined.typeGroups = p.typeGroups;
      if (p.category) refined.category = p.category;
    } else if (dim === '__guided__') {
      // The chained guided flow (2026-07-20) already merged every answered step into `base` via each
      // config's applyAnswer/applyMulti — so search it exactly as accumulated, no further refinement.
      return base;
    } else if (ADVANCED_QUESTIONS.some((c) => c.id === dim)) {
      // Advanced-question answers — delegate to that question's own config (generic, per the contract).
      return ADVANCED_QUESTIONS.find((c) => c.id === dim)!.apply(base, [a]);
    } else {
      const p = parseQuery(`${a} ${base.location ?? ''}`);
      if (p.type) refined.type = p.type;
      if (p.priceInput) refined.priceInput = p.priceInput;
      if (p.detail) refined.detail = p.detail;
    }
    return refined;
  };

  // What the guided interview committed, attached to its results turn so the summary line +
  // removable pills can render there (owner 2026-08-16). One at a time — a newer guided search
  // (including a pill removal, which re-runs through the same path) replaces it.
  const [guidedPills, setGuidedPills] = useState<{
    msgId: string; baseQ: SearchQuery; facets: Array<{ id: string; keys: string[]; labels: string[] }>; total: number | null;
  } | null>(null);

  // Run a refine answer (tapped chip OR typed reply): echo `label` as the user's bubble, merge the one
  // asked dimension into the SAME filter, and re-search. (user 2026-06-27.)
  // `opts.onFetched` reports the honest RPC total as soon as it's known (drives the mining beat);
  // `opts.guided` attaches the interview's facets to the results turn for the removable pills.
  const runRefine = async (
    baseQ: SearchQuery, dim: string, value: string, label: string,
    opts?: { onFetched?: (total: number | null) => void; guided?: { baseQ: SearchQuery; facets: Array<{ id: string; keys: string[]; labels: string[] }> } },
  ) => {
    pendingRefineRef.current = null;
    finalizeReveal();
    setStopped(false);
    setBusy(true);
    const refined = applyRefinement(baseQ, dim, value);
    const run = makeRun(); runRef.current = run;
    const statusId = uid();
    // Guaranteed search → the searching loader (roster + wave) starts IMMEDIATELY, no thinking beat.
    searchingAtRef.current[statusId] = Date.now();
    setMsgs((m) => [...m, { id: uid(), role: 'user', text: label }, { id: statusId, role: 'status', phase: 'searching', query: refined }]);
    toBottom();
    const result = await runQuery(refined, true, run.ac.signal);
    if (run.cancelled) return;
    // quotableTotal, never `result.total` — that is this page's buffer length (≤ the 1500-row
    // QUERY_LIMIT), so the mining overlay quoted «لقينا 1,500 عقار» on every set larger than a page
    // while the results headline behind it stated the real match total. ONE total for both.
    const honestTotal = quotableTotal(result);
    opts?.onFetched?.(honestTotal);
    if (opts?.guided) setGuidedPills({ msgId: statusId, baseQ: opts.guided.baseQ, facets: opts.guided.facets, total: honestTotal });
    await playListings(run, statusId, buildScrapeIntro(result.query ?? refined), result, label);
    if (run.cancelled) return;
    void promptSignupSoon(run);
    setBusy(false); runRef.current = null; toBottom();
  };

  // Remove one interview facet from the results pills (owner 2026-08-16: «The user can remove any
  // advanced choice and results should immediately update»). Pure recomputation: rebuild the query
  // from the interview's baseQ by re-applying every REMAINING facet in order via its own question's
  // apply() — never a hand-written inverse — then re-search through the same guided path so the
  // pills row carries over minus the removed one. No mining beat here; removal is instant.
  const removeGuidedFacet = (facetIndex: number) => {
    if (!guidedPills || busy) return;
    const removed = guidedPills.facets[facetIndex];
    const remaining = guidedPills.facets.filter((_, i) => i !== facetIndex);
    let q = guidedPills.baseQ;
    for (const f of remaining) {
      // SCOPE questions live outside ADVANCED_QUESTIONS, so the lookup must span BOTH pools: a
      // surviving group/type facet whose question could not be resolved would be silently dropped
      // from the rebuild and quietly widen the search (owner 2026-08-23).
      const question = ADVANCED_QUESTIONS.find((x) => x.id === f.id) ?? SCOPE_QUESTIONS.find((x) => x.id === f.id);
      if (question) q = question.apply(q, f.keys);
    }
    const label = t('Without: {label}', { label: removed.labels.join('، ') });
    void runRefine(q, '__guided__', '', label,
      remaining.length ? { guided: { baseQ: guidedPills.baseQ, facets: remaining } } : undefined);
    if (!remaining.length) setGuidedPills(null);
  };

  // Present the step at `stepIndex`. A step the user has already seen (walked Back to, or one
  // preserved past a changed earlier answer) is shown again with its recorded answer restored;
  // beyond the end of the record we re-rank against the NARROWED set and append the most useful
  // next question. `token` supersedes a stale flow.
  const presentGuided = async (stepIndex: number, token: number) => {
    // The cursor moved: query/asked/facets must reflect the steps BEFORE it before anything reads them.
    syncGuidedFromSteps(stepIndex);
    const steps = ageFlowStepsRef.current;
    if (stepIndex < steps.length) {
      const st = steps[stepIndex];
      // Re-resolve this question's options against the CURRENT scope before showing it again. The
      // stored options were live for the scope the step was first presented in — after the user
      // changes an EARLIER answer that scope has moved, and re-showing the captured numbers would
      // put stale per-option counts on screen. Count honesty applies to the option pills exactly as
      // it does to the header chip. If the re-probe fails we keep what we had rather than blanking
      // the card; the header chip is independently live either way.
      const q0 = ageFlowQueryRef.current;
      let fresh: AdvancedQuestionResult | null = null;
      if (q0) {
        try { fresh = await st.question.resolveOptions(q0); } catch { fresh = null; }
        if (ageFlowTokenRef.current !== token) return;
      }
      const options = fresh?.options.length ? fresh.options : st.options;
      const unknownCount = fresh?.options.length ? fresh.unknownCount : st.unknownCount;
      const total = fresh?.options.length ? fresh.total : st.total;
      ageFlowStepsRef.current = steps.map((x, i) => (i === stepIndex ? { ...x, options, unknownCount, total } : x));
      ageFlowTotalRef.current = total;
      setAgeFlow({
        phase: 'asking', stepIndex, question: st.question, options,
        unknownCount, initialKeys: st.keys ?? [],
        progressCur: stepIndex + 1, progressTotal: Math.max(steps.length, stepIndex + 1),
      });
      return;
    }
    // ── THE SCOPE PREFIX RUNS FIRST: CATEGORY → GROUP → TYPE (owner 2026-08-23) ──────────────────
    // This is not merely a preferred ask-order. The advanced pool's OWN eligibility depends on the
    // resolved type scope, so ranking it before the scope is chosen scores every question against a
    // scope the user has not picked yet — and for a category-only scope that ranking is empty by
    // construction. Resolving the hierarchy first is what makes the cohort intersection non-empty,
    // by NARROWING, never by loosening cohortAllows (a union there would silently amputate rows).
    const scopeQ = ageFlowQueryRef.current;
    const tier = scopeQ ? nextScopeTier(scopeQ, ageFlowAskedRef.current) : null;
    if (tier && scopeQ) {
      const question = scopeQuestionFor(tier);
      let res: AdvancedQuestionResult | null = null;
      try { res = await question.resolveOptions(scopeQ); } catch { res = null; }
      if (ageFlowTokenRef.current !== token) return;
      const opts = res?.options ?? [];
      if (opts.length <= 1) {
        // Nothing to CHOOSE between. One option is not a question — it is the scope the user already
        // has, so it is recorded as ANSWERED with that single key: the result set cannot move (every
        // other branch here is empty), while the cohort scope becomes a certified single type, which
        // is precisely what unlocks the advanced questions for a one-member group like «Residential
        // Plots». Zero options records an open skip. Either way the walk moves DOWN a tier instead of
        // stalling, and neither case invents a predicate the user did not ask for.
        const auto = opts.length === 1 ? [opts[0].key] : [];
        ageFlowStepsRef.current = [...steps, { question, options: opts, unknownCount: 0, total: res?.total ?? 0, keys: auto }];
        // ADVANCE PAST the step we just recorded. Re-entering on the SAME cursor would find the step
        // now present in the record and take the REPLAY branch above — rendering the very question
        // that had nothing to choose between. Moving to stepIndex + 1 both skips it and makes
        // syncGuidedFromSteps apply its auto-committed answer to the scope.
        await presentGuided(stepIndex + 1, token);
        return;
      }
      ageFlowStepsRef.current = [...steps, { question, options: opts, unknownCount: res!.unknownCount, total: res!.total, keys: null }];
      ageFlowTotalRef.current = res!.total;
      setAgeFlow({
        phase: 'asking', stepIndex, question, options: opts, unknownCount: res!.unknownCount, initialKeys: [],
        // The advanced plan does not exist yet (it cannot be ranked until this answer lands), so the
        // bar shows "at least one more to come" rather than a number it would have to invent. The
        // design contract bans a numeric «N of M» caption, so this only drives the bar's fill.
        progressCur: stepIndex + 1, progressTotal: stepIndex + 2,
      });
      return;
    }
    // CONTEXTUAL re-ranking (owner 2026-08-11): after any answer the remaining pool is re-probed and
    // re-scored against the NARROWED set, so the next question is always the most useful one for the
    // listings the user actually has left — and the flow stops by itself the moment the set drops to
    // ≤ INTERVIEW_STOP_AT (rankQuestions returns nothing below the floor).
    if (stepIndex > 0) {
      const q = ageFlowQueryRef.current;
      if (!q || ageFlowTokenRef.current !== token) return;
      const ranked = await rankQuestions(q, ageFlowAskedRef.current);
      if (ageFlowTokenRef.current !== token) return;
      ageFlowPlanRef.current = ranked
        .map((r: RankedQuestion) => ({ question: r.question, options: r.options, unknownCount: r.unknownCount, total: r.total }))
        .filter((pl) => pl.options.length >= minOptionsFor(pl.question.selection));
    }
    const plan = ageFlowPlanRef.current;
    // THE >=1-USEFUL GATE, EVALUATED AT THE SCOPE→ADVANCED TRANSITION (owner 2026-08-23; REVISED
    // owner 2026-08-24 — 0 closes, 1+ asks, superseding the original ">=2" brief). It cannot run at
    // startAgeFlow any more: with an unresolved hierarchy the ranked plan is empty by construction,
    // so the old placement closed the interview before the first scope question could render. It is
    // evaluated exactly once — the first time the cursor leaves a record made only of scope steps —
    // and it counts ADVANCED questions only: the hierarchy steps are what earned the right to ask,
    // never toward this count. 0 useful advanced questions ends the interview CLEANLY on the results
    // the scope answers already narrowed to; it never bounces to the legacy chips, because by this
    // point the user has answered real questions we must honour. 1+ proceeds into `plan[0]` below
    // exactly like any other useful question — the continuation loop then asks down to the last one.
    if (steps.length && steps.every((st) => isScopeQuestionId(st.question.id))
        && plan.length < MIN_USEFUL_QUESTIONS_TO_SHOW) { finishGuided(token); return; }
    if (!plan.length) { finishGuided(token); return; }
    const { question, options, unknownCount, total } = plan[0];
    ageFlowStepsRef.current = [...steps, { question, options, unknownCount, total, keys: null }];
    ageFlowTotalRef.current = total; // the narrowed set the user is answering against, always real
    setAgeFlow({
      phase: 'asking', stepIndex, question, options, unknownCount, initialKeys: [],
      progressCur: stepIndex + 1, progressTotal: stepIndex + plan.length,
    });
  };

  // Re-validate the answers given AFTER `from` against the scope `from`'s NEW answer produces
  // (owner 2026-08-22 §1.4/§1.5): keep every later answer that still selects something, drop only
  // the ones that have become incompatible — no longer offered in this scope, or would now select
  // nothing. A skip is always compatible: it carries no predicate. Whatever survives is re-applied
  // from baseQ by syncGuidedFromSteps, so a dropped answer leaves nothing behind.
  const revalidateStepsAfter = async (from: number, token: number) => {
    const steps = ageFlowStepsRef.current;
    const later = steps.slice(from + 1);
    if (!later.length) return;
    let q = ageFlowQueryRef.current; // already rebuilt through steps[0..from]
    if (!q) return;
    const kept: GuidedStep[] = [];
    for (const st of later) {
      if (st.keys == null) continue;                    // never answered — let the re-ranker pick afresh
      if (!st.keys.length) { kept.push(st); continue; } // a skip stays a skip: open, no predicate
      // SCOPE steps are not members of the advanced pool, so eligibleQuestions() can never vouch for
      // them — they need their own in-scope test: every picked group/type must STILL be a candidate
      // under the answer that changed above it. This is what makes «Back to Group, pick a different
      // group» drop a type that no longer belongs to it (owner 2026-08-23), rather than leaving a
      // stale type predicate behind or dropping a type that is still perfectly valid.
      const stillInScope = isScopeQuestionId(st.question.id)
        ? st.keys.every((k) => scopeCandidates(st.question.id as ScopeTier, q!).includes(k))
        : eligibleQuestions(q).some((x) => x.id === st.question.id);
      if (!stillInScope) continue;                    // out of scope now
      const n = await liveResultCount(st.question.apply(q, st.keys));
      if (ageFlowTokenRef.current !== token) return;
      if (n == null || n <= 0) continue;                // incompatible: it would select nothing
      kept.push(st);
      q = st.question.apply(q, st.keys);
    }
    ageFlowStepsRef.current = [...steps.slice(0, from + 1), ...kept];
  };

  // End of the flow: if the user answered ≥1 step, re-search the accumulated query in ONE combined
  // turn (runRefine's __guided__ passes it through unchanged) BEHIND the mining transition — the
  // Ezhalah «digging through the market» beat (owner 2026-08-16). If they skipped everything, close.
  //
  // TIMING (all plain setTimeout — never an animation callback, per src/lib/afterAnimation.ts):
  //   finish → mining overlay (from = last known narrowed total) + the search starts immediately
  //   search resolves → hold until ≥ 1.4s total has played (never artificially longer)
  //   → swap copy to «لقينا N عقار أقرب لطلبك» → ~1.1s beat → dismiss, revealing the result cards.
  // A 15s failsafe (and a catch on the search itself) dismisses the overlay even if the turn dies,
  // so the user can never be trapped behind a stuck animation.
  const finishGuided = (token: number) => {
    if (ageFlowTokenRef.current !== token) return;
    const q = ageFlowQueryRef.current;
    if (!(q && ageFlowChangedRef.current)) { setAgeFlow(null); return; }
    const startedAt = Date.now();
    setAgeFlow({ phase: 'mining', from: ageFlowTotalRef.current, to: null });
    const timers = miningTimersRef.current;
    const stillMining = () => ageFlowTokenRef.current === token;
    timers.push(setTimeout(() => { if (stillMining()) setAgeFlow((f) => (f?.phase === 'mining' ? null : f)); }, 15000));
    const guided = ageFlowBaseQRef.current
      ? { baseQ: ageFlowBaseQRef.current, facets: [...ageFlowFacetsRef.current] }
      : undefined;
    void runRefine(q, '__guided__', '', ageFlowLabelsRef.current.join('، '), {
      guided,
      onFetched: (total) => {
        if (!stillMining()) return;
        const wait = Math.max(0, 1400 - (Date.now() - startedAt));
        timers.push(setTimeout(() => { if (stillMining()) setAgeFlow((f) => (f?.phase === 'mining' ? { ...f, to: total } : f)); }, wait));
        timers.push(setTimeout(() => { if (stillMining()) setAgeFlow((f) => (f?.phase === 'mining' ? null : f)); }, wait + 1100));
      },
    }).catch(() => { if (stillMining()) setAgeFlow((f) => (f?.phase === 'mining' ? null : f)); });
  };

  // Entry point for «خلّنا نحدد الطلب أكثر» (and the auto-open after an eligible Filter search). Build
  // the PLAN once — the eligible questions whose initial options clear the floor — so the progress bar
  // reflects reality, then present them select-then-confirm. Nothing qualifies → fall through to the
  // pre-existing refine chips so a manual TAP is never a no-op. The AUTO path passes fallbackToRefine=
  // false: a filter user didn't ask to narrow, so an empty plan must close silently, never pop a chip.
  const startAgeFlow = async (q: SearchQuery, fallbackToRefine = true, opts?: { auto?: boolean; total?: number | null }) => {
    const token = ++ageFlowTokenRef.current;
    miningTimersRef.current.forEach(clearTimeout);
    miningTimersRef.current = [];
    ageFlowQueryRef.current = q;
    ageFlowChangedRef.current = false;
    ageFlowLabelsRef.current = [];
    ageFlowPlanRef.current = [];
    ageFlowBaseQRef.current = q;
    ageFlowFacetsRef.current = [];
    ageFlowStepsRef.current = [];
    ageFlowTotalRef.current = opts?.total ?? null;
    introBeginRef.current = false;
    // AUTO entry (owner 2026-08-16, supersedes the 2026-08-03 results-first rule): an eligible
    // Filter search with > 25 results opens on the calm INTRO — the count + invitation — never a
    // question. The plan resolves in the background while the intro is on screen, so «يلا نبدأ»
    // feels instant. A manual «خلّنا نحدد الطلب أكثر» tap skips the intro (the user already opted in).
    setAgeFlow(opts?.auto ? { phase: 'intro', total: opts?.total ?? null } : { phase: 'loading' });
    ageFlowAskedRef.current = new Set();
    // SCOPE PREFIX SHORT-CIRCUIT (owner 2026-08-23): when CATEGORY→GROUP→TYPE is not yet resolved,
    // the interview opens on the hierarchy and there is nothing to rank yet — ranking the advanced
    // pool here would probe the whole pool against a scope the user has not chosen (and, for a
    // category-only scope, return empty by construction and close the interview before it started).
    // The ≥2-useful gate is deliberately NOT applied on this path; it moves to the scope→advanced
    // transition in presentGuided, where the type scope finally exists to judge it against.
    if (unresolvedScopeTiers(q).length) { void presentGuided(0, token); return; }
    // Rank the pool against the user's ACTUAL current result set (score = split × salience over the
    // live counts). Below the >25 floor rankQuestions returns [], so the interview simply never
    // opens on a small result set — the ≤25 rule and the entry gate are the same constant.
    const ranked = await rankQuestions(q, ageFlowAskedRef.current);
    if (ageFlowTokenRef.current !== token) return; // superseded by a newer tap/turn
    ageFlowPlanRef.current = ranked
      .map((r) => ({ question: r.question, options: r.options, unknownCount: r.unknownCount, total: r.total }))
      .filter((p) => p.options.length >= minOptionsFor(p.question.selection));
    if (ageFlowTotalRef.current == null && ranked.length) ageFlowTotalRef.current = ranked[0].total;
    // MIN 1 USEFUL QUESTION TO OPEN (owner 2026-08-22; REVISED owner 2026-08-24 — 0 closes, 1+
    // asks, superseding the original ">=2" brief that withheld a lone useful question). A genuinely
    // useful question — one that passes scoreQuestion(), real narrowing power over the CURRENT
    // eligible set — is a real, honest step for the user even when it is the only one; only a
    // TRULY empty plan (0 useful) closes silently. Reuses the SAME plan (ranked, already scored by
    // scoreQuestion via rankQuestions) rather than a second computation, so this can never disagree
    // with what the interview actually asks, and it is computed AFTER cohortAllows' combined-period
    // intersection (rankQuestions -> eligibleQuestions -> question.eligibility) for free. 0 useful ⇒
    // the SAME fallback an empty plan already used: AUTO closes silently, a manual tap falls through
    // to the plain refine chips — never a NEW code path. This gate governs the OPENING decision
    // only; presentGuided's own re-rank after each answer/skip is untouched below, so an already-
    // open interview still keeps asking down to the very last useful question (owner §2/§6).
    if (ageFlowPlanRef.current.length < MIN_USEFUL_QUESTIONS_TO_SHOW) {
      setAgeFlow(null);
      if (fallbackToRefine) startRefine(q);
      return;
    }
    if (opts?.auto && !introBeginRef.current) return; // stay on the intro until the user opts in
    void presentGuided(0, token);
  };

  // Intro handlers: «يلا نبدأ» opts in (or arms the flag if the plan is still resolving);
  // «عرض النتائج» simply closes — the results are already rendered behind the overlay.
  const onIntroBegin = () => {
    if (ageFlow?.phase !== 'intro') return;
    introBeginRef.current = true;
    if (ageFlowPlanRef.current.length) void presentGuided(0, ageFlowTokenRef.current);
    else setAgeFlow({ phase: 'loading' });
  };
  const onIntroShowResults = () => { ageFlowTokenRef.current++; setAgeFlow(null); };

  // REENTRANCY GUARD (bug-hunt 2026-08-23): presentGuided's re-rank does a real network round trip
  // (rankQuestions) before the next question's card actually replaces the current one on screen. A
  // second confirm/skip tap landing in that gap — a slow network, or just an impatient double-tap
  // while the card looks unresponsive — used to be processed as a SECOND answer to the SAME visual
  // step (stale `ageFlow.stepIndex` closure, nothing rejected it): confirmed once more, an
  // already-selected single-select option reads as a re-click and clears back to unanswered, silently
  // downgrading a real answer to "no preference" and re-showing the question the user already
  // answered. Never lost EARLIER answers (each is its own step, independently recorded) — but it did
  // quietly discard the one landed on. One ref, held for exactly the span a tap could double-fire
  // across: set before the async work starts, released only once the NEXT question is actually on
  // screen (or the flow has genuinely finished) — never released early by a fire-and-forget call.
  const ageFlowCommittingRef = useRef(false);

  // Record the answer for the step under the cursor and advance one. ONE handler for single, multi
  // AND skip — `keys` is ≤1 entry for single, ≥0 for multi, and `[]` for a skip (no preference: no
  // predicate is written, the step is simply marked answered so the re-ranker moves on). The answer
  // is stored on the step; the query is then REBUILT from it, never mutated in place.
  const commitGuidedStep = async (keys: string[], finish = false) => {
    if (ageFlowCommittingRef.current) return; // a previous confirm/skip is still mid-transition — ignore the duplicate tap, don't double-process
    if (ageFlow?.phase !== 'asking') return;
    ageFlowCommittingRef.current = true;
    try {
      const token = ageFlowTokenRef.current;
      const { stepIndex } = ageFlow;
      const steps = ageFlowStepsRef.current;
      if (!steps[stepIndex]) return;
      const prev = steps[stepIndex].keys;
      const changedAnswer = prev != null && !sameKeys(prev, keys);
      ageFlowStepsRef.current = steps.map((st, i) => (i === stepIndex ? { ...st, keys } : st));
      syncGuidedFromSteps(stepIndex + 1);
      // A SCOPE answer redefines what the advanced pool even means, so the plan ranked for the OLD
      // scope must not survive it. presentGuided only re-ranks past the end of the record, so
      // without this a group/type change could hand the user a question ranked for the scope they
      // just left (owner 2026-08-23).
      if (isScopeQuestionId(steps[stepIndex].question.id)) ageFlowPlanRef.current = [];
      // Only a CHANGED earlier answer can invalidate what came after it — a first answer has nothing
      // after it to invalidate, and re-confirming the same answer leaves the later scope identical.
      if (changedAnswer) await revalidateStepsAfter(stepIndex, token);
      if (ageFlowTokenRef.current !== token) return;
      if (finish) { finishGuided(token); return; }
      // Awaited (not fire-and-forget): the guard above must stay held for presentGuided's own
      // network round trip too, since THAT is the actual window a duplicate tap lands in — releasing
      // the guard the instant commitGuidedStep's own synchronous part finishes would leave it wide
      // open for the entire re-rank, which is the one gap this guard exists to close.
      await presentGuided(stepIndex + 1, token);
    } finally {
      ageFlowCommittingRef.current = false;
    }
  };

  const onAgeConfirm = (keys: string[]) => { void commitGuidedStep(keys); };

  // Skip THIS question → next; skip-all → finish now; X (close) → abandon the flow.
  // Skip = NO PREFERENCE (owner): nothing is filtered, no false is written, the question is just
  // marked answered-as-open for this session — and walking Back to it restores it as skipped.
  const onAgeSkip = () => { void commitGuidedStep([]); };

  // «رجوع» — one question back (owner 2026-08-22). From the FIRST question it leaves the interview
  // entirely: the record is dropped and ageFlow goes null, which is exactly what the pre-AF CTA row
  // is gated on, so «خلّنا نحدد الطلب أكثر» + «عرض المزيد» come straight back. Nothing was searched
  // during the interview, so there is nothing else to undo.
  const onAgeBack = () => {
    if (ageFlow?.phase !== 'asking') return;
    const { stepIndex } = ageFlow;
    if (stepIndex <= 0) {
      ageFlowTokenRef.current++;
      ageFlowStepsRef.current = [];
      syncGuidedFromSteps(0);
      setAgeFlow(null);
      return;
    }
    // Bump the token BEFORE walking back: the step being abandoned may still have an in-flight
    // resolveOptions/rankQuestions probe, and every one of those guards on the token it captured. A
    // scope step fires one count per taxonomy option, which widens that window materially — without
    // this, a slow probe for the question the user just left could re-show it over the earlier one.
    const back = ++ageFlowTokenRef.current;
    void presentGuided(stepIndex - 1, back);
  };
  // «عرض النتائج» leaves the interview NOW — but through the same commit path, so the answer the
  // user can currently see selected is recorded first. Otherwise the card's own «عرض N نتيجة» chip
  // and the results it lands on would disagree.
  const onAgeSkipAll = (keys: string[]) => { void commitGuidedStep(keys, true); };
  const onAgeClose = () => { ageFlowTokenRef.current++; setAgeFlow(null); };

  // Tap on a refine answer chip → lock that question's chips so it can't be answered twice, then run.
  const pickRefine = (msgId: string, r: RefinePrompt, opt: { label: string; value: string }) => {
    if (busy) return;
    setMsgs((m) => m.map((x) => (x.id === msgId ? { ...x, refineDone: true } : x)));
    void runRefine(r.baseQ, r.dim, opt.value, opt.label);
  };

  const send = async (override?: string) => {
    const v = (override ?? typed).trim();
    if (!v || busy) return;
    // The CHAT agent accepts English as an input convenience: it normalizes any English place to the
    // canonical ARABIC location, searches in Arabic, and shows every location/result in Arabic (never an
    // English place name). The agent_notes location rules enforce the Arabic-canonical output. The FILTER
    // stays Arabic-catalog only (its own Latin guard remains). (user: accept English in chat, normalize.)
    // Search is FREE, always (owner rule 2026-08-15): a typed chat message goes straight to the
    // agent — no auth gate. verify-search-is-free.ts fails the build if a gate comes back.
    setTyped('');
    finalizeReveal(); // stop the previous search's cards from drip-revealing now that the user moved on
    stopReadAloud(); // a new turn starting is "another response" — stop any read-aloud from the last one
    setStopped(false); // new turn — re-enable the refine CTA and clear the stopped state
    setBusy(true);
    // REFINE INTERCEPT: if we just asked a «نتائج أدق» clarifying question, read THIS message as the answer,
    // merge it into the SAME filter, and re-search — never run it through the normal agent path. (user 2026-06-27.)
    if (pendingRefineRef.current) {
      const { q: baseQ, dim } = pendingRefineRef.current;
      await runRefine(baseQ, dim, v, v);
      return;
    }
    // Sidebar Recent entry: title = the user's exact message. First send in a new chat creates the
    // entry; subsequent sends update the title to the latest user message. Signed-in users only —
    // for guests this is a no-op (their chats stay session-local). (user request.)
    recordChatTurn(v);
    const run = makeRun();
    runRef.current = run;
    // Switch the whole app to the language of THIS message — on Send, not per keystroke. An English
    // message flips the UI to English and the reply comes back in English; an Arabic message to
    // Arabic. (setLocale syncs the data-layer locale immediately, so respond() answers in kind.)
    const loc = detectLocale(v);
    if (loc && loc !== locale) setLocale(loc);
    pinModeRef.current = 'bottom';
    // First beat: "Ezhalah is thinking…" — the real respond() round-trip fills this pause.
    const statusId = uid();
    setMsgs((m) => [...m, { id: uid(), role: 'user', text: v }, { id: statusId, role: 'status', phase: 'thinking' }]);
    toBottom();

    // Remember everything the user has said this search attempt, so a forced scrape can read the
    // whole conversation ("a house" + "floor") and not just the last vague line.
    saidRef.current = [...saidRef.current, v];

    const startedAt = Date.now();
    // Build the conversation MEMORY from prior turns (before this new message) so the agent can
    // reason across the chat and never re-ask what was already said. The greeting (text:'') drops out.
    const history = msgs
      .filter((m) => m.role === 'user' || m.role === 'agent' || m.role === 'results')
      .map((m) => {
        const role = m.role === 'user' ? ('user' as const) : ('model' as const);
        // For a results turn, hand the agent the FACTS of the cards it showed (numbered #1..#N) so it
        // can resolve later references like "the 2nd one", "#3", "the cheapest", "the Al Malqa one" —
        // restating only what's on the card, never inventing. (user training decision.)
        if (m.role === 'results') {
          // JUNK_LOCATION_TOKENS guard, own display path (2026-07-10 location-data-quality audit):
          // this text feeds straight into the AGENT's conversation memory (so it can later resolve
          // "the Al Malqa one" etc.). l.city/l.district already went through remote.ts's junk guard,
          // so a sentinel can't arrive as a literal string here, but an honestly-unresolved '' still
          // needs a neutral label — otherwise this would show "in , " for a fully-unresolved location.
          const cards = (m.result?.listings ?? []).map((l, i) => {
            const locationLabel = l.district && l.city ? `${l.district}, ${l.city}`
              : (l.district || l.city || LOCATION_UNRESOLVED_AR);
            return `#${i + 1}: ${l.type} ${l.deal === 'Rent' ? 'for rent' : 'for sale'} in ${locationLabel} — ${l.price}` +
              `${l.area ? `, ${l.area} m²` : ''}${l.beds ? `, ${l.beds} bed` : ''}, on ${l.source}`;
          });
          const text = cards.length ? `${m.text}\n${cards.join('\n')}` : m.text;
          return { role, text };
        }
        return { role, text: (m as { text?: string }).text ?? '' };
      })
      .filter((h) => !!h.text.trim())
      .slice(-10);
    // Pass auth state: a guest searches on any property query; a logged-in user only gets listings
    // when their message is a direct order, otherwise Ezhalah replies conversationally. (user request.)
    let turn = await respond(v, { loggedIn: !!user, history, attemptTexts: saidRef.current });
    if (run.cancelled) return;

    // ── The user NAMED a scope: «مدينة الرياض» / «منطقة الرياض» ────────────────────────────────────
    // Either answering our own «تقصد مدينة X ولا منطقة X كاملة؟» question or saying it up front. Either
    // way it is an EXACT scope in the user's own words, so this turn SEARCHES it — «منطقة X» the whole
    // region, «مدينة X» the city — instead of re-asking it or falling through to the 2-ask cap's
    // Kingdom-wide «ما قدرت أحدد الموقع بدقة» (defect `agent-clarify-loop`, found live 2026-08-23:
    // answering «مدينة الرياض» never produced a search in 7/7 fresh runs).
    const askedTwin = pendingScopeRef.current;
    pendingScopeRef.current = null;
    const scopeChoice = regionOrCityChoice(v);
    if (turn.kind === 'listings') {
      // Rewrite ONLY when the model's own location is that same twin — never override a different city
      // the user just named, and never invent one.
      const twin = regionOrCityTwin(turn.query.location);
      // AND only when the user really did name a scope FOR THIS TWIN. «منطقة» is an ordinary Arabic
      // noun, so «شقة في الرياض في منطقة هادئة» must NOT widen the city of Riyadh into the region —
      // that would be the same EXACT-LOCATION violation this fix exists to prevent, reversed. When we
      // just asked the twin question (askedTwin), a bare «مدينة» IS an answer, because we asked.
      const named = scopeNamedForTwin(v, twin) ?? (askedTwin ? scopeChoice : null);
      if (twin && named) turn = { ...turn, query: { ...turn.query, location: scopedLocation(twin, named) } };
    } else if (scopeChoice && askedTwin && turn.kind === 'message') {
      // The model drifted off the thread (a greeting, or another question). The user still answered a
      // question WE asked, so run their search from everything said this attempt, scoped to their pick.
      turn = { kind: 'listings', reply: '', query: { ...parseQuery(saidRef.current.join(' ')), location: scopedLocation(askedTwin, scopeChoice) } };
    }
    // Hold "Ezhalah is thinking…" for at least THINK_MS even if the network came back faster, so the
    // thinking beat always reads as a deliberate ~3s pause before the reply types out (user request).
    const elapsed = Date.now() - startedAt;
    if (elapsed < THINK_MS) await waitRun(run, THINK_MS - elapsed);
    if (run.cancelled) return;

    if (turn.kind === 'interview') {
      setMsgs((m) => m.filter((x) => x.id !== statusId));
      setBusy(false);
      runRef.current = null;
      router.push('/interview');
      return;
    }

    if (turn.kind === 'listings') {
      // DETERMINISTIC backstop: even though the model chose to search, if the location is not usable
      // (no city / a bare multi-city district) ASK in Arabic instead — accuracy over speed. After 2 asks
      // we stop pestering and search with whatever we have. (user: it MUST ask, not guess the location.)
      const clarifyQ = locationClarification(turn.query, v);
      if (clarifyQ && askCountRef.current < 2) {
        askCountRef.current += 1;
        // Remember WHICH twin name this question is about, so the user's next message can commit their
        // pick even if the model answers with something else entirely.
        pendingScopeRef.current = regionOrCityTwin(turn.query.location);
        setMsgs((m) =>
          m.map((x) => (x.id === statusId ? { id: statusId, role: 'agent', text: clarifyQ, typing: true } : x)),
        );
      } else {
        // Bug-fix #10 (audit `agent-2ask-cap-silent-search`): when we hit the 2-question cap with an
        // unusable location, the silent fallback search needs to TELL the user what scope was used so
        // they're not surprised by broad results. (user directive: "explain the search scope used".)
        const forcedBroad = !!clarifyQ && askCountRef.current >= 2;
        askCountRef.current = 0;
        saidRef.current = [];
        beginSearching(statusId, turn.query); // loader + min-beat overlap the fetch (like filter/refine)
        const result = await runQuery(turn.query, true, run.ac.signal);
        const reply = forcedBroad
          ? `${getLocale() !== 'en'
              ? 'ما قدرت أحدد الموقع بدقة، فبحثت في نطاق أوسع — هذي اللي لقيتها.'
              : "I couldn't narrow the location, so I searched a broader scope — here's what I found."}\n\n${buildScrapeIntro(result.query ?? turn.query)}`
          : buildScrapeIntro(result.query ?? turn.query);
        await playListings(run, statusId, reply, result, v);
        if (run.cancelled) return;
        void promptSignupSoon(run);
      }
    } else {
      const attemptText = saidRef.current.join(' ');
      const combined = parseQuery(attemptText);
      // STANDARD smart city ask: a proximity/landmark search with NO city → ask WHICH CITY, echoing the
      // user's own phrase, even if the model chose to ask something else (e.g. the property type). For a
      // proximity search the city is the highest-value missing piece, and we never invent one. On the
      // user's answer the search resumes with city + the same proximity (re-parsed across the attempt).
      const proxAll = parseProximity(attemptText);
      if (proxAll.length && !combined.location && !KINGDOM_WIDE.test(attemptText) && askCountRef.current < 2) {
        const phrase = proxAll
          .map((p) => (p.text || `${p.phrase} ${p.name || p.categoryAr}`).trim())
          .filter(Boolean)
          .join(' و');
        askCountRef.current += 1;
        setMsgs((m) =>
          m.map((x) => (x.id === statusId
            ? { id: statusId, role: 'agent', text: phrase ? `في أي مدينة تبحث عن عقار ${phrase}؟` : 'في أي مدينة تبحث؟', typing: true }
            : x)),
        );
      } else {
        // The model asked a clarifying question. Read back EVERYTHING said so far: if we can already see
        // a usable detail (a type, a city, a size, a budget) and we've asked twice, stop pestering and
        // just search with whatever we have. (user request: max 2 asks → skip → scrape.)
        const hasIntent = !!(combined.type || combined.location || combined.detail || combined.priceInput);
        if (hasIntent && askCountRef.current >= 2) {
          askCountRef.current = 0;
          saidRef.current = [];
          beginSearching(statusId, combined); // loader + min-beat overlap the fetch (like filter/refine)
          const result = await runQuery(combined, true, run.ac.signal);
          await playListings(run, statusId, buildScrapeIntro(result.query ?? combined), result, v);
          if (run.cancelled) return;
          void promptSignupSoon(run);
        } else {
          if (hasIntent) askCountRef.current += 1; // only count asks once the user has shown intent
          setMsgs((m) =>
            m.map((x) => (x.id === statusId ? { id: statusId, role: 'agent', text: turn.reply, typing: true } : x)),
          );
        }
      }
    }
    // The network turn is done; the cards then reveal on their own timers (busy is free, so the user can
    // type a new message — which finalizes the reveal via finalizeReveal). interview returns earlier.
    setBusy(false);
    runRef.current = null;
    toBottom();
  };

  // Example chip: skip classification — but play the same thinking → reply → searching → results
  // beats so it reads identically to a typed search (there's just no network round-trip).
  // Example chips now route through the REAL agent: tapping one calls send(text) so it goes through
  // Gemini + the landmark layer (with the bundled-heuristic fallback) exactly like a typed message —
  // so a tapped chip demonstrates the full intelligence, not the offline heuristic. (user request.)

  // Keep the DOM Enter listener on the latest send() (it guards empty/busy itself).
  sendRef.current = () => { void send(); };

  // Filter search / history open routes here with ?filter=<JSON SearchQuery> — show the
  // natural-language bubble + listings inline (prototype parity: no separate results page).
  // The interview path supplies its own bubble + subheading (prototype interviewToChat copy, which
  // lists the budget label verbatim); the filter path derives them via filterToChat.
  const sendFilter = (q: SearchQuery, override?: { bubble: string; sub: string }) => {
    // Search is FREE, always — the filter's results render for every visitor, signed in or not.
    finalizeReveal(); // stop any previous search's cards from drip-revealing
    setStopped(false); // new search — clear any prior stopped state
    setBusy(true);
    askCountRef.current = 0;
    saidRef.current = [];
    runRef.current = makeRun('filter'); // owner 2026-08-18: tags this turn so Stop returns to Filter
    // Filter search: open at the top and let the request bubble type itself out FIRST, on its own —
    // the SEARCHING loader (full platform roster + highlight wave) does not mount until the bubble
    // has fully finished typing (onBubbleDone). (owner 2026-07-15: reversed from the prior "loader
    // starts the instant Search is pressed" behavior — the sentence must be fully readable before any
    // platform logo or search animation appears, never simultaneously.)
    pinModeRef.current = 'top';
    const { bubble, sub } = override ?? filterToChat(q);
    const statusId = uid();
    pendingFilterRef.current = { q, sub, statusId };
    setMsgs((m) => [...m, { id: uid(), role: 'user', text: bubble, typing: true }]);
    toTop();
  };

  // Request bubble finished typing → NOW mount the searching loader (platform roster) and run the
  // SAME beats a typed chat search gets: "Ezhalah is thinking…" → the reply types out → "Ezhalah is
  // searching…" → "Here is what I found:" + the cards. (user request — the filter flow used to skip
  // straight to the reply+cards; now it reads identically to the chat.)
  const onBubbleDone = () => {
    const pending = pendingFilterRef.current;
    if (!pending) return;
    pendingFilterRef.current = null;
    pinModeRef.current = 'none';
    const run = runRef.current ?? makeRun();
    runRef.current = run;
    // The searching status (full platform roster, highlight wave) mounts HERE — only after the
    // request bubble has fully finished typing, never before or simultaneously with it.
    const statusId = pending.statusId;
    searchingAtRef.current[statusId] = Date.now();
    setMsgs((m) => [...m, { id: statusId, role: 'status', phase: 'searching', query: pending.q }]);
    toBottom();
    void (async () => {
      // Fetch the matching subset DURING the loading animation — the network wait hides inside the
      // thinking→searching choreography (no post-network hold: playListings morphs to results as soon
      // as the minimum searching beat — which overlapped the fetch — has played). (owner 2026-07-09.)
      // RC-A (hardening 2026-07-13): the busy-clear + status-morph used to run ONLY on the success path,
      // and this IIFE had no .catch — so a thrown turn (malformed row, or an error escaping the data
      // layer) left the «إزهله يبحث» loader spinning forever with no recovery. Wrapped in try/catch/
      // finally (mirrors loadMore) so the loader ALWAYS clears and a thrown turn shows an inline retry.
      try {
        const result = await runQuery(pending.q, true, run.ac.signal);
        if (run.cancelled) return;
        await playListings(run, statusId, buildScrapeIntro(result.query ?? pending.q), result);
        if (run.cancelled) return;
        // REMOVED (owner 2026-08-19): the auto-open AF intro popup after a filter search is killed.
        // The advanced filter interview must ONLY appear inline below the result cards when the user
        // manually taps «خلّنا نحدد الطلب أكثر». No popup, no overlay, no auto-open — ever.
        void promptSignupSoon(run); // guest used their free search (filter) → prompt sign-up
      } catch {
        if (!run.cancelled) {
          setMsgs((m) => m.filter((x) => x.id !== statusId).concat({ id: uid(), role: 'agent', text: 'تعذّر البحث، حاول مرة أخرى' } as ChatMsg));
        }
      } finally {
        if (!run.cancelled) { setBusy(false); runRef.current = null; }
      }
    })();
  };

  // Reopening a past search from the sidebar (replay='0') just SHOWS the saved conversation — the
  // request bubble and the results render in their final state with no typewriter replay, no
  // "thinking/searching" beats. It's a history view, not a fresh run. (user request.)
  const openStatic = async (q: SearchQuery, override?: { bubble: string; sub: string }, snapshot?: SearchResult) => {
    const { bubble, sub } = override ?? filterToChat(q);
    const userId = uid();
    const resultsId = uid();
    // A saved chat carries the results it already found — render them INSTANTLY, zero network,
    // no "searching…" beat of any kind (owner 2026-08-14: "it should already show him the property
    // because he already listed it. This is just saved."). «عرض المزيد» still pages live from here.
    if (snapshot) {
      setMsgs([
        { id: userId, role: 'user', text: bubble },
        { id: resultsId, role: 'results', text: sub, result: snapshot },
      ]);
      setDoneTyping((d) => ({ ...d, [resultsId]: true }));
      setRevealCount((c) => ({ ...c, [resultsId]: Math.min(FIRST_PAGE, snapshot.listings.length) }));
      pinModeRef.current = 'top';
      toTop();
      return;
    }
    // Render the user bubble + a brief "searching…" status immediately so the screen is never blank
    // while the per-search fetch (now async) resolves. (runQuery used to be synchronous.)
    setMsgs([
      { id: userId, role: 'user', text: bubble },
      { id: resultsId, role: 'status', phase: 'searching', summary: buildScrapeIntro(q), query: q },
    ]);
    pinModeRef.current = 'top';
    toTop();
    const result = await runQuery(q, false); // viewing a saved chat — don't create a new history entry
    // Soft completion here too (review finding): history replay used to hard-cut the loader in a
    // single frame. Flag `exiting`, give the fade its beat, THEN swap to the final results state.
    // (History stays beat-free otherwise — no min-beat, no typewriter; this is just the fade.)
    setMsgs([
      { id: userId, role: 'user', text: bubble },
      { id: resultsId, role: 'status', phase: 'searching', summary: buildScrapeIntro(q), query: q, exiting: true },
    ]);
    await new Promise((r) => setTimeout(r, LOADER_EXIT_MS));
    // Morph into the final results state — all cards at once, no typewriter (history view).
    setMsgs([
      { id: userId, role: 'user', text: bubble },
      { id: resultsId, role: 'results', text: sub, result },
    ]);
    setDoneTyping((d) => ({ ...d, [resultsId]: true }));
    setRevealCount((c) => ({ ...c, [resultsId]: Math.min(FIRST_PAGE, result.listings.length) }));
    pinModeRef.current = 'top';
    toTop();
  };

  // Ezhalah greets a fresh chat itself: after a short beat (~1.2s) it drops its opening message as a
  // normal agent bubble that types itself out, with the quick-suggestion chips underneath. Only fires
  // when the chat is still empty (a filter/seed/history open never gets the greeting on top).
  const sendGreeting = () => {
    if (greetTimerRef.current) clearTimeout(greetTimerRef.current);
    // Stay pinned to the TOP while the greeting types and the "Click here to start" cards pop in one
    // by one — never glide the user downward as each box appears (web + phone). (user request.)
    pinModeRef.current = 'top';
    // Drop the greeting almost immediately so the FIRST sentence starts typing right away — no blank
    // screen on entering the agent. The example chips wait until this greeting finishes typing, then
    // pop in one by one. (user request.)
    greetTimerRef.current = setTimeout(() => {
      setMsgs((m) => (m.length === 0 ? [{ id: uid(), role: 'agent', text: '', greeting: true, typing: true }] : m));
    }, 150);
    // A genuinely fresh empty chat re-arms the rotating composer examples (owner brief §6) — the
    // ONLY re-arm point, so they can never restart while the user is mid-interaction.
    setIntroInteracted(false);
  };

  // REFRESH MUST NEVER RE-EXECUTE A SEARCH (owner 2026-08-16). The search params are a ONE-SHOT
  // INTENT that belongs to the navigation hop, not a standing instruction re-run on every mount.
  //
  // ROOT CAUSE they name: this screen read `?filter=`/`?seed=` as "run this search NOW", evaluated
  // on mount. On a cold mount `lastFilterRef.current` is undefined, so ANY param looked new and
  // fired a full turn — a second AI call, a second property RPC, a second history write — with
  // nothing distinguishing "the user pressed بحث" from "the browser re-mounted this route".
  //
  // Consuming the param the moment it is picked up removes the input a reload would replay, so
  // zero-duplication is structural rather than defended by a flag or a timer: after the hop the URL
  // is a bare `/agent`, and a refresh has literally nothing to execute. It then renders its
  // new-chat state, which IS the owner's target screen (greeting + empty composer).
  //
  // setParams (not replace/history.replaceState): a same-route param update, so the screen is not
  // remounted and the search now rendering into it is untouched.
  const consumeSearchParams = () => {
    if (Platform.OS !== 'web') return;
    // The greeting branch below keys off "no params"; mark it done so clearing them cannot inject a
    // greeting bubble into the conversation this navigation just started.
    greetedRef.current = true;
    router.setParams({ filter: undefined, seed: undefined, chatBubble: undefined, chatSub: undefined, replay: undefined, hid: undefined });
  };

  // A "Start here" chip routes here with ?seed=…; Filter search with ?filter=… — run once on open.
  // With neither, this is a brand-new chat → Ezhalah sends its greeting.
  useEffect(() => {
    // Re-run whenever the param CHANGES — the agent screen is REUSED (not remounted) between searches,
    // so a one-shot guard silently swallowed every search after the first. A new filter/seed search
    // starts a fresh chat (prior chats stay in the sidebar). (bug fix: "keep searching → nothing pops up".)
    const startFresh = () => {
      if (runRef.current) runRef.current.cancelled = true; // stop any in-flight previous search
      finalizeReveal();                                    // stop the prior search's drip-reveal/typing
      setStopped(false);
      setBusy(false);
      setMsgs([]);                                         // new search = a clean chat view
    };
    // THE GATE (owner 2026-08-16). Params that were in the URL when the DOCUMENT loaded — a refresh,
    // a restored tab, a pasted link — are not a user action, so they must not execute anything. Drop
    // them and let this render as the new-chat screen the owner asked for. Params that arrive later
    // came from «بحث», a chip, or the sidebar, and run normally. See src/lib/appSession.ts.
    if ((filter || seed) && !isAppSessionStarted()) {
      consumeSearchParams();   // clear them so the URL matches the blank chat actually on screen
      sendGreeting();          // AI home: greeting + empty composer
      return;
    }
    if (filter && filter !== lastFilterRef.current) {
      lastFilterRef.current = filter;
      lastSeedRef.current = undefined;
      try {
        // migrateGroups: a `?filter=` payload minted before the multi-group change carries the
        // legacy single `typeGroup`; convert it at the boundary so nothing downstream sees it.
        const q = migrateGroups(JSON.parse(filter) as SearchQuery);
        // Seed the shared filter state from the URL payload (Search & Matching QA §29, 2026-08-15).
        // The results already survive a hard refresh (PR#589) and `?filter=` carries the whole
        // SearchQuery — but that payload was never read back into the app context, which is the ONLY
        // thing «تصفية» rehydrates from. So after a refresh the form came back blank (المدينة, السعر,
        // المساحة, غرف النوم, فئة/نوع and the «سنوي»/«شهري» control all gone) and «بحث» failed with
        // «الرجاء اختيار مدينة من القائمة» — a refreshed, bookmarked or shared results link could not
        // be adjusted, only rebuilt from scratch.
        //
        // setQuery takes an UPDATER FUNCTION, never a value — passing the object directly is what
        // shipped `TypeError: e is not a function` to production on 2026-08-15 (PR#661, reverted by
        // PR#662): the store does `setQueryState((prev) => updater(prev))`, so a plain object gets
        // *called*. `() => q` is the whole difference. scripts/verify-web-runtime-smoke.mjs now
        // drives this exact journey in a real browser and fails on that crash.
        //
        // Replacing rather than merging is deliberate: the payload IS the search whose results are on
        // screen, so the form must show exactly that and nothing left over from a previous query. On
        // the normal path this is an identity write (the filter form put this same query here before
        // navigating); it only changes anything when the context is a fresh HOME_DEFAULT_QUERY() and
        // the payload is not — the reload/bookmark/share case. The existing city/district rehydration
        // effects in index.tsx then restore the picked المدينة/الأحياء from the catalog exactly as
        // they already do on the no-reload round-trip.
        setQuery(() => q);
        const override = chatBubble && chatSub ? { bubble: chatBubble, sub: chatSub } : undefined;
        startFresh();
        if (replay === '0') openStatic(q, override, hid ? history.find((h) => h.id === hid)?.snapshot : undefined);
        else sendFilter(q, override);
        // Intent consumed — including for a sidebar replay, so refreshing a REOPENED chat also lands
        // on a new blank chat rather than reopening it again (owner requirement 6).
        consumeSearchParams();
      } catch {}
    } else if (seed && seed !== lastSeedRef.current) {
      lastSeedRef.current = seed;
      lastFilterRef.current = undefined;
      startFresh();
      send(seed);
      consumeSearchParams();
    } else if (!filter && !seed) {
      // No params: either a genuinely new chat, or the tick right after consumeSearchParams cleared
      // them. Release the "already handled" refs so the SAME search can be run again later from
      // «تصفية» — without this, re-running an identical query would match the stale ref and do
      // nothing (the "keep searching → nothing pops up" class this guard was written for).
      lastFilterRef.current = undefined;
      lastSeedRef.current = undefined;
      if (!greetedRef.current) {
        greetedRef.current = true;
        sendGreeting();
      }
    }
  }, [seed, filter, chatBubble, chatSub, replay, hid]);

  // New Chat routes back here with a changing ?fresh=… — wipe the conversation and greet again, even
  // if we were already on the agent screen (where the component doesn't remount). (user request.)
  // The wipe is a "fresh page turn", not a hard cut (owner 2026-08-14: the New Chat moment should
  // FEEL like a new chat): the old conversation breathes out (~110ms fade), the clean chat rises
  // softly back in, and the greeting starts typing as it settles. The wipe itself rides
  // runAfterAnimation — the animation is decoration, the fresh chat is the function, so a frozen
  // rAF (hidden tab) can never leave the user stuck on the old conversation.
  const freshFade = useRef(new Animated.Value(1)).current;
  const freshRise = useRef(new Animated.Value(0)).current;
  const freshMountRef = useRef(true);
  useEffect(() => {
    if (freshMountRef.current) { freshMountRef.current = false; return; }
    if (fresh === undefined) return;
    if (runRef.current) runRef.current.cancelled = true;
    if (greetTimerRef.current) clearTimeout(greetTimerRef.current);
    // New Chat kills any live mic capture instantly (owner brief §16) — and inherits nothing from
    // it (PR #832 contract: the store owns newChat(); this only stops hardware, adds no state).
    voiceActiveRef.current = false;
    cancelVoiceInput();
    setVoiceState('idle');
    runAfterAnimation(
      (onFinished) => Animated.timing(freshFade, { toValue: 0, duration: 110, useNativeDriver: true }).start(onFinished),
      () => {
        setBusy(false);
        setMsgs([]);
        pendingScopeRef.current = null; // New Chat inherits nothing — not even a half-answered question
        // Forget the last-handled filter/seed so a re-search AFTER New Chat re-runs even if it's
        // identical to a previous one (otherwise the change-detection would skip it and leave just
        // the greeting).
        lastFilterRef.current = undefined;
        lastSeedRef.current = undefined;
        freshRise.setValue(10);
        Animated.parallel([
          Animated.timing(freshFade, { toValue: 1, duration: 240, useNativeDriver: true }),
          Animated.timing(freshRise, { toValue: 0, duration: 240, useNativeDriver: true }),
        ]).start();
        sendGreeting();
      },
      180,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh]);

  // Replay a parked message once (a message typed mid-OAuth-round-trip, or left over from the
  // retired auth gate) so a sign-in never loses what the user wrote. Search itself is FREE and
  // never gated (owner rule 2026-08-15) — this effect is pure recovery, not a gate.
  useEffect(() => {
    if (consumedPendingRef.current) return;
    if (busy || !pendingMessage) return;
    consumedPendingRef.current = true;
    const msg = pendingMessage;
    setPendingMessage(null);
    setTyped('');
    send(msg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, pendingMessage]);

  // A DOCUMENT LOAD of this screen (refresh, pasted link, restored tab) is on its way Home — the
  // root layout calls router.replace('/') in its mount effect (see lib/webRefreshRoute.ts). Until
  // that lands, render the bare paper background instead of the whole AI screen: otherwise the user
  // watches the header, backdrop and composer paint and then get yanked away, which reads as the app
  // being stuck on the wrong page. (owner 2026-08-16: "still get stuck then it shows filter".)
  // In-app navigation is unaffected — the session is already started by then, so this is false.
  if (IS_WEB && !isAppSessionStarted()) {
    return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
  }

  // Rotating examples show ONLY on the clean AI-search entry screen (owner brief §2): the chat holds
  // nothing but the greeting (no user/results/status turn — so results screens, conversations, and
  // replayed history are all excluded structurally), the composer is empty, the user hasn't
  // interacted, no recording, no turn in flight. Filter mode is a different screen (index.tsx) and
  // never renders this component at all.
  const introLanding = msgs.every((m) => m.role === 'agent' && !!m.greeting);
  const showIntroExamples =
    introLanding && !introInteracted && !typed && voiceState === 'idle' && !busy;

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      {/* Sketch backdrop behind the chat. The bottom fade is pushed all the way down (0.8→1, same as
          Home) so the landmarks fill the whole frame — including the center, which used to wash out
          to plain white during "Ezhalah is searching…". A light opacity + paper scrim keep it faint
          enough that message text stays readable: the user sees the same sketch, just light. */}
      <HeroBackground imageOpacity={0.55} scrim={0.2} fadeStart={0.8} fadeEnd={1} />
      {/* Header */}
      <View ref={setLtr} style={[s.topBar, { paddingTop: insets.top + 8 }]}>
        {/* Mobile only: a plain hamburger that opens the existing sidebar — same clean style as the
            home screen's. On desktop the sidebar is docked, so just a small spacer. No eagle here. */}
        {!docked ? (
          <Pressable style={s.hamb} hitSlop={8} onPress={() => setSidebarOpen(true)}>
            <Ionicons name="menu" size={22} color={colors.ink} />
          </Pressable>
        ) : (
          <View style={{ width: 6 }} />
        )}
        {/* Brand — always just "إزهله" here now: the ModeSwitch pill's raised «المساعد الذكي» tab
            identifies the screen, so the old collapsing "✨ Ezhalah AI Agent"→"Ezhalah" title and the
            small تصفية button are both replaced by the shared two-tab control (same spot as home's,
            so switching reads as one continuous control). (owner top-nav redesign, 2026-07-24.) */}
        <Text ref={noTranslateRef} style={s.title}>{t('Ezhalah')}</Text>
        <View style={{ flex: 1 }} />
        {/* Logged-out sign-in (mobile only — desktop has the docked sidebar CTA). Owner 2026-08-19. */}
        {!user && !docked && (
          <Pressable style={s.topSignIn} onPress={openAuth} hitSlop={6}>
            <Ionicons name="person-outline" size={15} color="#fff" />
            <Text style={s.topSignInText}>{t('Sign up / Log in')}</Text>
          </Pressable>
        )}
        {/* Note #5 — Share is ALWAYS visible the moment the user is in AI Agent mode. Not gated on
            results, not gated on a completed search. Throughout the entire experience. (user request.) */}
        {/* Redesigned to match the home screen's share button (design review 2026-07-24) — same
            tint fill/hairline/height/radius as ModeSwitch's own track, so the pill + share cluster
            reads as one continuous control across both screens, not just within one. */}
        <Pressable
          onPress={() => setShareOpen(true)}
          style={({ pressed }) => [s.shareIcon, pressed && s.shareIconPressed]}
          hitSlop={8}
          onPressIn={() => shareSpring(0.94)}
          onPressOut={() => shareSpring(1)}
        >
          <Animated.View style={{ transform: [{ scale: shareScale }] }}>
            <Ionicons name="share-outline" size={19} color={colors.chipIcon} />
          </Animated.View>
        </Pressable>
      </View>
      {/* Filter / AI pill — centered under the header (same middle-of-screen band as home's hero
          pill, owner 2026-08-16: "it stays in the middle, not far right"). Fades + collapses away
          the moment a search happens, in either mode; the wrapper's animated height keeps the chat
          area from snapping up when it leaves. */}
      {!modeGone && (
        <View style={[s.modeWrap, MODE_EASE, modeSearched && s.modeWrapHidden]}>
          <ModeSwitch active="agent" onSwitch={() => router.replace('/')} t={t} />
        </View>
      )}
      {shareOpen && <ShareSheet onClose={() => setShareOpen(false)} />}
      {sidebarOpen && <Sidebar onClose={() => setSidebarOpen(false)} />}

      <KeyboardAvoidingView
        // iOS-native does its own lifting. On mobile WEB this is a no-op, so we lift the whole column
        // by the REAL keyboard height (kbInset, from visualViewport): the composer lands just above the
        // keyboard and the scroll area shrinks — exactly the ChatGPT-mobile feel. (owner 2026-08-19)
        style={[{ flex: 1 }, IS_WEB && kbInset > 0 ? { paddingBottom: kbInset } : null]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 52}
      >
        {/* The fresh-page turn (New Chat): this wrapper fades the whole conversation out and rises
            the clean chat back in — see the ?fresh effect. Decoration only; the wipe never depends
            on it completing. */}
        <Animated.View style={{ flex: 1, opacity: freshFade, transform: [{ translateY: freshRise }] }}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={[s.scroll, { paddingBottom: 16 }]}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={onGrow}
        >
          <View style={s.col}>
            {(() => { const lastId = msgs[msgs.length - 1]?.id; return msgs.map((m) => {
              if (m.role === 'user') {
                // User messages ALWAYS sit on the user side (alignSelf: 'flex-end') regardless of the
                // message language — the page direction (RTL/LTR) decides which screen edge that is.
                // Only the TEXT inside the bubble follows its own writingDirection so Arabic still reads
                // right-to-left and English left-to-right. The bubble never jumps sides because the
                // message language changed. (user request.)
                const rtl = msgRTL(m.text);
                return (
                  <View key={m.id} style={s.userBubble}>
                    <Text style={[s.userText, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' }]}>
                      {m.typing ? <Typer text={m.text} onDone={onBubbleDone} /> : m.text}
                    </Text>
                  </View>
                );
              }
              if (m.role === 'status') {
                // The calm, Perplexity-style search-loading animation: «إزهله يفكر…» → «إزهله يبحث في
                // المنصات…» + a rotating strip of real platform pills + up to 3 filter status lines.
                // The branded slogan + search summary are NOT shown here anymore (owner: keep loading
                // clean/focused); they still appear in the RESULTS bubble below, unchanged. RTL is
                // handled inside SearchLoader (the message column is LTR-pinned).
                return <SearchLoader key={m.id} phase={m.phase} query={m.query} resultSources={m.resultSources} exiting={m.exiting} />;
              }
              if (m.role === 'agent') {
                // Per-message direction: each AI reply renders in its OWN language's direction and
                // stays put even if the next message flips. ARABIC reply → the whole row is RTL and
                // anchored to the RIGHT (sparkle on far right, Arabic text flows right → left to its
                // left). ENGLISH reply → row is LTR and anchored to the LEFT (sparkle on far left,
                // English text flows left → right to its right). Earlier rows never move when a new
                // message in the other language arrives. (user request.)
                const txt = m.greeting ? greetingText(locale) : m.text;
                const rtl = msgRTL(txt);
                return (
                  <View key={m.id} style={{ gap: 10, alignSelf: rtl ? 'flex-end' : 'flex-start', maxWidth: '88%' }}>
                    <View style={[s.reply, { alignSelf: rtl ? 'flex-end' : 'flex-start' }]}>
                      <View style={s.replyIcon}>
                        <Ionicons name="sparkles" size={14} color={colors.primary} />
                      </View>
                      <Text testID={m.greeting ? 'intro-greeting' : undefined} style={[s.replyText, m.greeting && s.greetingText, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left', flex: 1 }]}>
                        {m.typing ? <Typer text={txt} onDone={() => markTyped(m.id)} /> : txt}
                      </Text>
                    </View>
                    {/* Clickable refine answer chips — appear once the question finishes typing; tapping one
                        re-searches with that single field merged in (never typed). (user 2026-06-27.) */}
                    {m.refine && !m.refineDone && (!m.typing || doneTyping[m.id]) ? (
                      <View style={[s.rChipRow, { flexDirection: rtl ? 'row-reverse' : 'row', justifyContent: rtl ? 'flex-end' : 'flex-start' }]}>
                        {m.refine.options.map((opt) => (
                          <Pressable key={opt.value} style={s.rChip} onPress={() => pickRefine(m.id, m.refine!, opt)}>
                            <Text style={s.rChipTx}>{opt.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              }
              // results — STRICT ORDER (user request, repeated as a bug fix): slogan → summary →
              // result intro → sort line → property cards. Slogan + summary persist from the searching
              // status into the same bubble (no duplicate slogan/summary block, no out-of-order intro).
              const rtl = msgRTL(m.text);
              // Hoisted out of the RESULT INTRO block below (§3) so Read Aloud speaks the EXACT
              // same sentence the reply types on screen — one computation, never a second copy that
              // could drift from what's actually shown.
              const introZeroResult = m.result.listings.length === 0;
              // Same helper the mining overlay quotes (src/data/search.ts) — one definition of "the
              // total we may state", so the interview's closing beat and this headline, describing the
              // SAME search, can never name two different numbers. null ⇒ no honest count ⇒ say nothing.
              const introTotal = quotableTotal(m.result);
              const introText = introZeroResult
                ? (m.result.suggestion ?? t('No exact matches — try broadening your search.'))
                : introTotal != null
                  ? t('We found {n} listings matching your search.', { n: introTotal.toLocaleString('en-US') })
                  : m.text;
              return (
                // ARABIC: the whole assistant response (slogan + summary + intro) sits on the RIGHT,
                // directly under the user's right-aligned message — so alignItems flex-end clusters the
                // text blocks to the right edge with the sparkle on the right. ENGLISH: flex-start (left).
                // The property-cards View below opts back out with alignSelf:'stretch' so cards stay
                // full-width regardless. (user request: Arabic assistant reply on the right, not left.)
                <View
                  key={m.id}
                  onLayout={(e) => { msgYRef.current[m.id] = e.nativeEvent.layout.y; }}
                  style={{ gap: 6, alignItems: rtl ? 'flex-end' : 'flex-start', width: '100%' }}
                >
                  {/* 1) BRANDED SLOGAN — sparkle icon + Ezhalah's personality line. The row sizes to its
                      content and is pushed to the correct edge by the parent's alignItems. ENGLISH →
                      icon then text (reads left-to-right, clustered left). ARABIC → text then icon
                      (icon on the far right, clustered right). */}
                  {m.slogan ? (
                    <View style={[s.reply, { flexDirection: 'row', alignItems: 'center' }]}>
                      {!msgRTL(m.slogan) && (
                        <View style={s.replyIcon}>
                          <Ionicons name="sparkles" size={14} color={colors.primary} />
                        </View>
                      )}
                      <Text style={[s.sloganText, { writingDirection: msgRTL(m.slogan) ? 'rtl' : 'ltr', textAlign: msgRTL(m.slogan) ? 'right' : 'left' }]}>{m.slogan}</Text>
                      {msgRTL(m.slogan) && (
                        <View style={s.replyIcon}>
                          <Ionicons name="sparkles" size={14} color={colors.primary} />
                        </View>
                      )}
                    </View>
                  ) : null}
                  {/* 2) SEARCH SUMMARY — what Ezhalah understood, directly under the slogan. */}
                  {m.summary ? (
                    <Text style={[s.summaryText, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left', alignSelf: 'stretch' }]}>{m.summary}</Text>
                  ) : null}
                  {/* 3) RESULT INTRO — always typed/animated (user: "never show the text just like this,
                      always written with animation"). For 0-result searches: type the empty-state
                      suggestion directly here so it animates; the static block below is suppressed to
                      avoid a duplicate. For searches with results: type the normal intro text. */}
                  {(() => (
                    <Text style={[s.replyText, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left', marginTop: 6, alignSelf: 'stretch' }]}>
                      {m.typing ? <Typer text={introText} onDone={() => markTyped(m.id)} /> : introText}
                    </Text>
                  ))()}
                  {/* GUIDED SUMMARY + REMOVABLE PILLS (owner 2026-08-16): after the interview, briefly
                      show what Ezhalah understood — «بناءً على: …» — and each committed answer as a
                      removable pill. Removing one rebuilds the query from the interview's baseQ with
                      the remaining facets and re-searches immediately. */}
                  {guidedPills && guidedPills.msgId === m.id && guidedPills.facets.length ? (
                    <View style={{ alignSelf: 'stretch', gap: 7, marginTop: 2 }}>
                      <Text style={[s.guidedBasedOn, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' }]}>
                        {buildAfSummary(guidedPills.facets)}
                      </Text>
                      <View style={[s.guidedPillRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
                        {guidedPills.facets.map((f, i) => (
                          // SCOPE facets (group/type) are deliberately NOT removable (owner
                          // 2026-08-23). Every other advanced answer only ever NARROWS, so removing
                          // its pill widens back to a scope the user already had; removing a TYPE
                          // pill would instead broaden the search past anything they ever asked for,
                          // with no re-interview and no control to get it back. It renders as a plain
                          // chip — same row, no «×», not pressable.
                          isScopeQuestionId(f.id) ? (
                            <View key={`${f.id}-${i}`} style={s.guidedPill}>
                              <Text style={s.guidedPillTx}>{f.labels.join('، ')}</Text>
                            </View>
                          ) : (
                            <Pressable key={`${f.id}-${i}`} style={s.guidedPill} onPress={() => removeGuidedFacet(i)} disabled={busy}>
                              <Text style={s.guidedPillTx}>{f.labels.join('، ')}</Text>
                              <Ionicons name="close" size={13} color={colors.primary} />
                            </Pressable>
                          )
                        ))}
                      </View>
                    </View>
                  ) : null}
                  {/* Cards no longer wait for the intro text — they cascade in as soon as results are
                      ready (beginCardDrip fires at the morph), while the reply types above (owner
                      2026-07-09: show the first card the moment valid listings exist). The
                      more-message + feedback row still wait for the text via their doneTyping gates. */}
                  {m.result.listings.length === 0 ? (
                    // Zero-result: text already animated in slot above — render nothing here to avoid duplicate.
                    null
                  ) : (
                    <>
                      {/* The default "مرتبة حسب الأقرب لطلبك" note was removed per owner request (2026-07-07).
                          An EXPLICIT objective sort (newest/cheapest…) still shows its own note; the plain
                          relevance default now shows nothing (and it waits for the text like before). */}
                      {m.result.sortNote && !(m.typing && !doneTyping[m.id]) ? (
                        <Text style={[s.rankLine, { textAlign: rtl ? 'right' : 'left', alignSelf: 'stretch' }]}>{m.result.sortNote}</Text>
                      ) : null}
                      {/* All result cards render AT ONCE — the per-card pop-in animation was removed
                          per user request ("remove that, not nice"). The cards just appear, no fade,
                          no scale, no stagger. Cards stay FULL-WIDTH via alignSelf:stretch even though
                          the parent clusters text to the right for Arabic. */}
                      <View style={{ gap: 12, marginTop: 12, alignSelf: 'stretch' }}>
                        {/* Live typed turn: default to 0 visible until startReveal begins the one-by-one
                            drip (prevents a full-grid flash if setDoneTyping flushes a render before
                            setRevealCount(0)). History/replay turns (not typing) show all immediately. */}
                        {m.result.listings.slice(0, revealCount[m.id] ?? (m.typing ? 0 : Math.min(FIRST_PAGE, m.result.listings.length))).map((l, i) => (
                          // CardIn = soft mount-in (fade + slight rise). Keyed by source:id (ids are
                          // only unique per source table — matches the de-dup identity), so cards
                          // already on screen NEVER re-animate — only newly-revealed ones enter softly.
                          <CardIn key={`${l.source}:${l.id}`}>
                            <MemoResultCard
                              listing={l}
                              variant="compact"
                              rank={i + 1}
                              onOpen={() => { trackOpen(l); void openListing(l); }}
                            />
                          </CardIn>
                        ))}
                      </View>
                      {/* MORE-RESULTS message + actions (user 2026-06-27, paging owner 2026-07-08): a NORMAL
                          assistant message shown once the first 10 are on screen and MORE matches exist.
                          Correctness: the RPC filtered the FULL matching set before any cap, so we page it —
                          «عرض المزيد» walks the next real DB pages (broad searches reach every match), and once
                          the whole matched set is in the buffer «عرض جميع النتائج» reveals it in one tap. «ساعدني
                          ألقى نتائج أدق» asks ONE clarifying question then re-searches. */}
                      {(() => {
                        const fetched = m.result.listings.length;
                        const shown = revealCount[m.id] ?? (m.typing ? 0 : Math.min(FIRST_PAGE, fetched));
                        const serverMore = !!m.result.hasMore; // the DB still has more matching pages to fetch
                        // Show once this page's cards are on screen. Gate on (typing && !doneTyping) — the SAME
                        // condition the cards use — NOT on `m.typing` alone: a live results message keeps typing=true
                        // even after the intro finishes (only doneTyping flips), so gating on m.typing hid this block.
                        // min(FIRST_PAGE, fetched): a search with <10 matches still gets its closing message.
                        // ALSO gates FeedbackRow/Read Aloud below (merged into one block, owner 2026-08-23 — the
                        // spoken closing note must reuse this SAME computed text, never re-derive it separately).
                        if ((m.typing && !doneTyping[m.id]) || shown < Math.min(FIRST_PAGE, fetched)) return null;
                        // RESULT-CAP RULE (owner 2026-08-20) — the browse cap, the "load more" gate and the
                        // closing count all come from ONE pure function (src/data/resultCount.ts), so they can
                        // never disagree and one test locks them. The user browses min(trueTotal, BROWSE_CAP)
                        // cards; the closing message states the TRUE total, never the cap or the buffer length.
                        const clientNarrowed = !!(m.result.query && hasClientOnlyNarrowing(m.result.query));
                        // TRUE eligible total — matchTotal FIRST (PR #608 "never the page-capped total"), NEVER
                        // `fetched`/`listings.length` (a page-buffer size). Under client-only narrowing the RPC
                        // total OVERSTATES (it never applied the client filter), so it may neither be quoted nor
                        // capped-against: we cap against the cap itself so paging still reaches it, and word the
                        // message from `shown` — the same reason the intro suppresses the count. (bug-hunt 2026-07-30.)
                        const rawTotal = m.result.matchTotal ?? fetched;
                        const trueTotal = clientNarrowed ? BROWSE_CAP : rawTotal;
                        const rc = resultCounts({ trueTotal, shown, fetched, serverMore });
                        const hasMore = rc.hasMore;
                        // Quote an exact match total ONLY when it is trustworthy (whole filter ran server-side)
                        // AND more than the cap actually matched — that is the only case with two honest numbers.
                        const quoteTotal = !clientNarrowed && rc.endKind === 'capped';
                        // ≤25 RULE (owner brief 2026-08-19, item 4): the auto-opening AF intro already
                        // correctly gated on this same threshold (agent.tsx ~1375) — this SEPARATE manual
                        // button did not, and its click path (startAgeFlow → rankQuestions, which itself
                        // floors on the SAME MIN_TOTAL_TO_SHOW=26 constant) fell through to the plain
                        // refine-chip flow for any ≤25 scope rather than doing nothing. A ≤25 result set
                        // gets ONLY the normal lightweight actions (Load more if genuinely more exists,
                        // FeedbackRow below) — never a "narrow further" prompt when there is nothing
                        // useful left to narrow.
                        const canNarrowFurther = rawTotal > INTERVIEW_STOP_AT;
                        // fetching = THIS message's page fetch; cascading = THIS message's card drip.
                        // Only the owning message's button shows the dots (review fix: a global flag
                        // was falsely lighting every visible «عرض المزيد»).
                        const fetching = !!loadingMore[m.id];
                        const cascading = revealing && revealActiveRef.current?.id === m.id;
                        const moreNoteText = rc.endKind === 'more'
                          ? (canNarrowFurther
                              ? t('I showed you the first {n} listings. Want me to show more, or help you find more precise ones?', { n: rc.endShown.toLocaleString('en-US') })
                              : t('I showed you the first {n} listings. Want me to show more?', { n: rc.endShown.toLocaleString('en-US') }))
                          : quoteTotal
                            // More than the cap matched: two honest numbers — the true total AND the {cap} shown.
                            ? (canNarrowFurther
                                ? t('We found {total} listings matching your search, and showed you {shown}. Want help finding more precise ones?', { total: rc.endTotal.toLocaleString('en-US'), shown: rc.endShown.toLocaleString('en-US') })
                                : t('We found {total} listings matching your search, and showed you {shown}.', { total: rc.endTotal.toLocaleString('en-US'), shown: rc.endShown.toLocaleString('en-US') }))
                            // Everything matching is on screen (≤ cap, or a hidden-total narrowed search):
                            // state the real matched count — which equals what's shown.
                            : (canNarrowFurther
                                ? t('I showed you all {n} matching listings. Want help finding more precise ones?', { n: (clientNarrowed ? rc.endShown : rc.endTotal).toLocaleString('en-US') })
                                : t('I showed you all {n} matching listings.', { n: (clientNarrowed ? rc.endShown : rc.endTotal).toLocaleString('en-US') }));
                        // HIDDEN WHILE THE ADVANCED FILTER IS OPEN (owner 2026-08-21) — see the comment on the
                        // buttons row below; the SAME gate decides whether Read Aloud may mention them too.
                        const showActionsRow = (hasMore || canNarrowFurther) && !ageFlow;
                        // Read Aloud closing note (owner request, 2026-08-23: "read the note... and say the
                        // button also") — names the SAME button label(s) actually rendered below, in the same
                        // order, so it can never mention an action that isn't on screen to tap.
                        const spokenActionLabels = [hasMore && t('Load more'), canNarrowFurther && t('Let’s narrow it down')].filter(Boolean) as string[];
                        const spokenActionsNote = !showActionsRow ? ''
                          : spokenActionLabels.length === 2
                            ? t('You can tap {a} or {b}.', { a: spokenActionLabels[0], b: spokenActionLabels[1] })
                            : t('You can tap {a}.', { a: spokenActionLabels[0] });
                        const readAloudClosingNote = [moreNoteText, spokenActionsNote].filter(Boolean).join(' ');
                        const readAloudSegments = buildResultsReadAloudSegments(introText, m.result.listings.slice(0, shown), readAloudClosingNote);
                        return (
                          <>
                            <View style={{ gap: 8, marginTop: 14, alignSelf: 'stretch' }}>
                              <Text style={[s.replyText, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' }]}>
                                {moreNoteText}
                              </Text>
                              {/* The old «100 at a time» line was a hardcoded 100 that read as a result count even
                                  when far fewer matched (owner 2026-08-20). Removed: with the browse cap one «عرض
                                  المزيد» reveals everything up to the cap, so the button needs no count caption. */}
                              {/* «عرض المزيد» ALWAYS pages the next 100 (buffer reveal, then real DB fetch when spent);
                                  «خلّنا نحدد الطلب أكثر» asks ONE clarifying question then re-searches — but only
                                  when there is genuinely more than INTERVIEW_STOP_AT=25 left to narrow. */}
                              {/* HIDDEN WHILE THE ADVANCED FILTER IS OPEN (owner 2026-08-21). Once the
                                  user taps «خلّنا نحدد الطلب أكثر», the AF interview owns this moment —
                                  the old CTA row must not sit behind it competing for the same decision.
                                  `ageFlow` covers every AF phase (loading → intro → asking → mining), so
                                  the row is gone from the tap until the flow closes, and returns by itself
                                  afterwards because closing sets ageFlow back to null. The AF card is an
                                  absolute overlay, so without this gate the two buttons stayed rendered
                                  (and reachable) underneath it. */}
                              {showActionsRow ? (
                                <View style={[s.mBtnRow, { flexDirection: rtl ? 'row-reverse' : 'row', marginTop: 4 }]}>
                                  {hasMore ? (
                                    // Active state = calm pulsing dots (owner 2026-07-09: the button must
                                    // visibly work, not sit static) — while THIS message's page fetches or
                                    // its new cards cascade in. Fixed min-size → zero layout shift on swap.
                                    // Disabled during any reveal or a live turn (never two drips at once).
                                    <Pressable
                                      style={({ hovered, pressed }: any) => [s.mBtnPrimary, (hovered || pressed) && !fetching && !revealing && s.mBtnPrimaryHover]}
                                      disabled={fetching || revealing || busy}
                                      onPress={() => loadMore(m)}
                                    >
                                      {fetching || cascading
                                        ? <LoadingDots />
                                        : <Text style={s.mBtnPrimaryTx}>{t('Load more')}</Text>}
                                    </Pressable>
                                  ) : null}
                                  {canNarrowFurther ? (
                                    <Pressable
                                      style={s.mBtnAlt}
                                      onPress={() => {
                                        const q = m.result.query;
                                        if (q && anyGuidedEligible(q)) void startAgeFlow(q);
                                        else startRefine(q);
                                      }}
                                    >
                                      <Text style={s.mBtnAltTx}>{t('Let’s narrow it down')}</Text>
                                    </Pressable>
                                  ) : null}
                                </View>
                              ) : null}
                            </View>
                            {/* Response-level feedback (thumbs up/down + share) — the LAST element of the
                                response, so the order reads: cards → «تبي أعرض لك المزيد…» message + buttons
                                → this row. MOVED here from under each card (owner 2026-07-09: one row,
                                directly below the more-message, nowhere else). Still shows when the
                                more-block is hidden (few results / all shown) — it belongs to the response.
                                Keyed by the results-message id → rates the RESPONSE, not one listing.
                                Read Aloud script (owner structure requirement, 2026-08-19): إزهله -> pause ->
                                summary -> pause -> cards, in the SAME order shown on screen, -> pause -> the
                                closing note + available actions above (owner 2026-08-23). Sliced to `shown`
                                — never past what's actually rendered right now ("no hidden listing should be
                                spoken") — but otherwise reads every visible card (owner 2026-08-22: no further cap). */}
                            <FeedbackRow feedbackKey={m.id} onFeedback={showFbToast} readAloudSegments={readAloudSegments} />
                          </>
                        );
                      })()}
                    </>
                  )}
                </View>
              );
            }); })()}

            {/* REMOVED 2026-08-16 (owner composer brief: "One Arabic RTL AI input, the send arrow,
                and the disclaimer underneath. No suggestion boxes and no unnecessary elements."):
                the guest-only «مو متأكد وش تبحث عنه؟» heading + example-chips grid that popped in
                under the greeting. src/data/examplePrompts.ts and the ex* / onb* styles are KEPT
                (restore = git revert of this commit, no re-authoring); the chips' prompts library is
                still pinned healthy by scripts/verify-example-prompts-arabic.ts. */}
          </View>
        </ScrollView>
        </Animated.View>

        {/* Composer — redesigned 2026-08-16 (owner brief: "closer to ChatGPT/Claude in interaction,
            still Ezhalah in identity"). One RTL input + the send arrow + the disclaimer; nothing else.
            The surface is the ModeSwitch family's raised-white card: hairline border that eases to
            brand green on focus, soft green-tinted lift that deepens with it, pill radius. Height
            GLIDES between line counts (inputHAnim) instead of snapping; the send arrow pins to the
            bottom edge as the box grows, and the input keeps paddingEnd so text never reaches it. */}
        {/* When the keyboard is open (web), the home-indicator safe area sits behind it, so drop
            insets.bottom and keep the composer tight above the keyboard instead of double-padding. */}
        <View style={[s.composerWrap, { paddingBottom: (IS_WEB && kbInset > 0 ? 0 : insets.bottom) + 8 }]}>
          <View style={[s.col, s.composerCol]}>
            <View style={[s.composer, COMPOSER_EASE, composerFocused && s.composerFocused]}>
              {/* ── Normal controls ── keep LAYOUT ownership even while recording OR processing (the
                  recording row is an absolute overlay on the same surface), so the composer's size
                  never jumps during the morph — one physical object changing state, not a component
                  swap (owner brief §3). Inert and faded out for the whole voice flow, not just while
                  the mic is literally live — the brief post-Stop beat is still part of that flow. */}
              <View
                pointerEvents={voiceState !== 'idle' ? 'none' : 'auto'}
                style={[s.composerInner, VOICE_EASE, voiceState !== 'idle' && s.composerInnerHidden]}
              >
              {/* The GLIDE lives on this wrapper, never on the textarea itself: a CSS height
                  transition on the measured element corrupts RNW's content measurement (it reads
                  mid-transition heights and ratchets an empty box to max — observed live). The
                  textarea keeps the pre-redesign numeric-height contract; the wrapper eases to the
                  same target and clips the single frame of difference. */}
              <View style={[s.inputGrow, INPUT_EASE, { height: Math.min(COMPOSER_MAX_H, Math.max(COMPOSER_MIN_H, inputH)) }]}>
              <TextInput
                ref={inputRef}
                // writingDirection RTL for Arabic (the parent col is LTR-pinned, so without this the
                // placeholder's trailing «...» lands on the wrong side — it must read «…السعودية»). (owner 2026-07-09)
                style={[s.input, { textAlign: locale === 'ar' ? 'right' : 'left', writingDirection: locale === 'ar' ? 'rtl' : 'ltr', height: Math.min(COMPOSER_MAX_H, Math.max(COMPOSER_MIN_H, inputH)) } as any]}
                // While the rotating examples occupy the placeholder slot, the input's own static
                // placeholder yields (empty string) so the two never overlap; the moment the
                // rotation stops (any interaction) the familiar static placeholder returns.
                placeholder={showIntroExamples ? '' : t("Type the property you're looking for in Saudi Arabia...")}
                placeholderTextColor={colors.muted}
                selectionColor={colors.primary}
                // Stable Arabic label (owner brief §11): a screen reader always hears this one
                // sentence for the field — never the rotating examples (those are aria-hidden).
                accessibilityLabel={t('Describe the property you are looking for')}
                value={typed}
                onChangeText={(v: string) => { setIntroInteracted(true); setTyped(v); if (!v) setInputH(COMPOSER_MIN_H); }}
                // Grows only as text wraps, capped at COMPOSER_MAX_H (then scrolls internally); the
                // TARGET comes from RN's own line metrics (native + web), the MOTION from INPUT_EASE.
                // (owner 2026-07-08 metrics; owner 2026-08-16 smooth growth.)
                onContentSizeChange={(e: any) => setInputH(Math.min(COMPOSER_MAX_H, Math.max(COMPOSER_MIN_H, e.nativeEvent.contentSize.height)))}
                // Clicking/tapping into the composer counts as interaction — the rotating examples
                // stop cleanly and the static placeholder takes over (owner brief §6).
                onFocus={() => { setComposerFocused(true); setIntroInteracted(true); }}
                onBlur={() => setComposerFocused(false)}
                // The language does NOT flip while typing a chat message — it switches only when the
                // message is SENT (see send(): an English message → English UI, Arabic → Arabic).
                // Live per-character switching is reserved for the Home filter's location field.
                // (user request.)
                multiline
                // Desktop-web Enter handling lives in a raw DOM keydown listener (see the effect by
                // inputRef): RNW's onKeyPress normalization delivered key: "" for Enter here, so the
                // send shortcut binds below the framework. Native keeps the platform submit path.
                onSubmitEditing={IS_WEB ? undefined : () => send()}
                returnKeyType="search"
                blurOnSubmit={!IS_WEB}
              />
              {/* Rotating real-query examples in the placeholder slot — EMPTY AI landing only.
                  Absolutely positioned inside this clipped wrapper: it can never resize the
                  composer, push the mic/Send, or overflow horizontally (owner brief §7/§9). */}
              {showIntroExamples ? <IntroExampleRotator reducedMotion={reducedMotion} /> : null}
              </View>
              {busy || revealing ? (
                // While Ezhalah is thinking/searching OR the cards are still popping in, the Send button
                // is a Stop box — tap it to cancel the search and freeze the cards shown. (user request.)
                <Pressable onPress={stop} style={s.stopBtn} hitSlop={8} accessibilityLabel={t('Stop')}>
                  <Ionicons name="stop" size={15} color="#fff" />
                </Pressable>
              ) : (
                <>
                  {/* Mic — enters recording mode (owner brief §2): immediate press feedback, then the
                      composer itself morphs. Sits immediately left of Send, same 34px control family.
                      Hidden entirely where isVoiceInputSupported() is false — a LIVE runtime check,
                      not a browser-name assumption (owner correction, 2026-08-24: macOS Safari has
                      shipped webkitSpeechRecognition since Safari 14.1 and correctly shows the mic;
                      only engines that genuinely lack it — e.g. iOS/iPadOS WebKit — hide it). Showing
                      a mic that can only ever flash a toast and revert reads as broken. */}
                  {isVoiceInputSupported() ? (
                  <Pressable
                    testID="voice-mic"
                    onPress={() => { void startVoice(); }}
                    hitSlop={8}
                    accessibilityLabel={t('Voice input')}
                    style={({ pressed }: any) => [s.micBtn, pressed && s.micBtnPressed]}
                  >
                    <Ionicons name="mic-outline" size={19} color={colors.body} />
                  </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => send()}
                    disabled={!typed.trim()}
                    onPressIn={() => sendSpring(0.9)}
                    onPressOut={() => sendSpring(1)}
                    onHoverIn={() => { setSendHover(true); sendSpring(1.06); }}
                    onHoverOut={() => { setSendHover(false); sendSpring(1); }}
                    hitSlop={6}
                    accessibilityLabel={t('Search')}
                    style={!typed.trim() ? s.sendDisabled : undefined}
                  >
                    <Animated.View style={[s.sendBtn, sendHover && !!typed.trim() && s.sendBtnHover, { transform: [{ scale: sendScale }] }]}>
                      <Ionicons name="arrow-up" size={17} color="#fff" />
                    </Animated.View>
                  </Pressable>
                </>
              )}
              </View>
              {/* ── Recording mode ── same composer surface, ChatGPT's spatial hierarchy, PHYSICALLY
                  pinned LTR (owner brief §13 — the page is RTL but these four controls never mirror):
                  [ X ] [———— live waveform ————] [ ■ ] [ ↑ ]. Absolute overlay: amplitude can never
                  resize the row or push Stop/Send (owner brief §1/§4). Stays mounted through the
                  brief post-Stop "processing" beat too (waveform swaps for a loading indicator) —
                  only fully hides once idle; inert (pointerEvents) the instant recording itself ends. */}
              <View
                testID="voice-recording-row"
                pointerEvents={voiceState === 'recording' ? 'auto' : 'none'}
                // direction:'ltr' pins the PHYSICAL order X → waveform → ■ → ↑ against the page's
                // RTL (owner brief §13; Sidebar's LTR_PIN idiom — inline, not StyleSheet.create).
                style={[s.voiceRow, { direction: 'ltr' } as any, VOICE_EASE, voiceState === 'idle' && s.voiceRowHidden]}
              >
                <Pressable
                  testID="voice-cancel"
                  onPress={cancelVoice}
                  hitSlop={8}
                  accessibilityLabel={t('Cancel recording')}
                  style={({ pressed }: any) => [s.voiceRoundBtn, pressed && s.micBtnPressed]}
                >
                  <Ionicons name="close" size={18} color={colors.body} />
                </Pressable>
                <View style={s.voiceWaveWrap} testID="voice-waveform">
                  {voiceState === 'recording' ? (
                    <VoiceWaveform />
                  ) : voiceState === 'processing' ? (
                    <ActivityIndicator testID="voice-processing" size="small" color={colors.muted} />
                  ) : null}
                </View>
                <Pressable
                  testID="voice-stop"
                  onPress={stopVoice}
                  hitSlop={8}
                  accessibilityLabel={t('Stop recording')}
                  style={({ pressed }: any) => [s.voiceRoundBtn, pressed && s.micBtnPressed]}
                >
                  <View style={s.voiceStopSquare} />
                </Pressable>
                <Pressable
                  testID="voice-send"
                  onPress={sendVoice}
                  onPressIn={() => sendSpring(0.9)}
                  onPressOut={() => sendSpring(1)}
                  hitSlop={6}
                  accessibilityLabel={t('Send')}
                >
                  <Animated.View style={[s.sendBtn, { transform: [{ scale: sendScale }] }]}>
                    <Ionicons name="arrow-up" size={17} color="#fff" />
                  </Animated.View>
                </Pressable>
              </View>
            </View>
            <Text style={s.disc}>
              {t('Ezhalah displays listings from third-party property platforms. We do not own, verify, or recommend any listing. Please review all details carefully before making a decision.')}
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* ChatGPT-style feedback toast — floats top-center ABOVE the conversation (below the header),
          appears briefly after a 👍/👎 and auto-dismisses. pointerEvents none so it never blocks taps.
          Same treatment on mobile and desktop (owner 2026-07-09). */}
      <View pointerEvents="none" style={[s.fbToastWrap, { top: insets.top + 54 }]}>
        <View style={[s.fbToast, { opacity: fbToast ? 1 : 0, transform: [{ translateY: fbToast ? 0 : -8 }] }, TOAST_EASE]}>
          <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
          <Text style={s.fbToastText}>{t('Thanks for your feedback')}</Text>
        </View>
      </View>
      {/* Voice-input notice (permission denied / unsupported) — same toast family as the feedback
          one; concise Arabic via t(), never raw browser error text (owner brief §2/§15). */}
      <View pointerEvents="none" style={[s.fbToastWrap, { top: insets.top + 54 }]}>
        <View style={[s.fbToast, { opacity: voiceNotice ? 1 : 0, transform: [{ translateY: voiceNotice ? 0 : -8 }] }, TOAST_EASE]}>
          <Ionicons name="mic-off-outline" size={16} color={colors.primary} />
          <Text style={s.fbToastText}>{voiceNotice ?? ''}</Text>
        </View>
      </View>
      {/* Floating Read Aloud playback controller (owner 2026-08-22) — ONE instance for the whole
          screen (there is only ever one active reading session), self-hides when nothing is playing,
          self-positions fixed/top regardless of scroll. See src/components/ReadAloudPlayer.tsx. */}
      <ReadAloudPlayer />
      {/* عمر العقار advanced-question overlay (owner 2026-07-13) — a transient card over the CURRENT
          results, reached only via «خلّنا نحدد الطلب أكثر» in an apartment-only scope. Absolutely
          positioned over the whole screen, same visual language as the interview overlay (dimmed
          backdrop + centered card), but rendered inline here rather than as a separate route, so
          answering can hand off directly to runRefine and update THIS same conversation in place. */}
      {ageFlow ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {ageFlow.phase === 'loading' ? (
            <AdvancedQuestionLoading onClose={onAgeClose} />
          ) : ageFlow.phase === 'intro' ? (
            <AdvancedIntroCard
              total={ageFlow.total}
              onBegin={onIntroBegin}
              onShowResults={onIntroShowResults}
              onClose={onIntroShowResults}
            />
          ) : ageFlow.phase === 'mining' ? (
            <MiningTransition from={ageFlow.from} to={ageFlow.to} />
          ) : (
            <AdvancedQuestionCard
              titleKey={ageFlow.question.titleKey}
              descriptionKey={ageFlow.question.descriptionKey}
              brandImage={ageFlow.question.brandImage}
              selection={ageFlow.question.selection}
              options={ageFlow.options}
              unknownCount={ageFlow.unknownCount}
              progressCur={ageFlow.progressCur}
              progressTotal={ageFlow.progressTotal}
              liveCount={(keys) => (ageFlowQueryRef.current
                ? liveResultCount(ageFlow.question.apply(ageFlowQueryRef.current, keys))
                : Promise.resolve(null))}
              initialKeys={ageFlow.initialKeys}
              onConfirm={onAgeConfirm}
              onSkip={onAgeSkip}
              onBack={onAgeBack}
              onSkipAll={onAgeSkipAll}
              onClose={onAgeClose}
            />
          )}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.screenSide, paddingBottom: 8 },
  // Guided-interview summary + removable pills on the results turn (owner 2026-08-16). fontWeight
  // (not fontFamily) matches the idiom of every other text style in this sheet.
  guidedBasedOn: { fontSize: 12.5, fontWeight: '500', color: colors.muted },
  guidedPillRow: { flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  guidedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.tint,
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5,
  },
  guidedPillTx: { fontSize: 12.5, fontWeight: '600', color: colors.primary },
  // ChatGPT-style feedback toast: centered pill just below the header, floating over the chat.
  fbToastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 200 },
  fbToast: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.fieldLine,
    borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 14, ...cardShadow,
  },
  fbToastText: { fontSize: 12.5, fontWeight: '600', color: colors.ink },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  hamb: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}) },
  title: { fontSize: 14, fontWeight: '700', color: colors.ink },
  // Note #5 — share icon sits beside the Filter pill in the agent header.
  // Matches the taller premium ModeSwitch (46-tall, tint fill + hairline, pill radius, soft lift) so
  // the pill + share read as one cluster across both screens (owner redesign 2026-07-24 r2).
  shareIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    backgroundColor: colors.tint,
    borderWidth: 1,
    borderColor: colors.tintLine,
    ...cardShadow,
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  shareIconPressed: { opacity: 0.85 },
  topSignIn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 13, marginRight: 8 },
  topSignInText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  preciseBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.tint, borderColor: colors.tintLine, borderWidth: 1, borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: 12, marginRight: 6 },

  scroll: { paddingHorizontal: space.screenSide, alignItems: 'center', paddingTop: 4 },
  // Tight, connected vertical rhythm — the whole search flow (summary → phrase → searching →
  // results header → ranking → cards) reads as ONE section, not separated blocks. (user request.)
  // Chat column is LTR-pinned so flex alignment is consistent regardless of the UI language: user
  // bubbles (alignSelf: 'flex-end') always end up on the RIGHT, AI replies (alignSelf: 'flex-start')
  // always on the LEFT. Only the text INSIDE each bubble follows its own writingDirection. (user
  // request: bubble position never changes per language; only text direction does.)
  // LOAD-BEARING: the whole message column is pinned to LTR cross-axis so `alignSelf:'flex-end'` reliably
  // resolves to the RIGHT (user bubble + Arabic agent replies), regardless of the app's RTL root. RN-web
  // DROPS a raw `direction` style (it only warns), so we use `writingDirection:'ltr'`, which RN-web maps
  // to CSS `direction:ltr` on the element. Without this the column inherits RTL and every flex-end block
  // flips to the left. (Text inside each bubble keeps its own writingDirection so Arabic still reads RTL.)
  col: { width: '100%', maxWidth: MAX_W, gap: 8, writingDirection: 'ltr' as any },

  aiex: { marginTop: 12, gap: 11 },
  greet: { marginBottom: 6 },
  greetTag: { fontSize: 20, fontWeight: '800', color: colors.primary },
  greetBody: { fontSize: 14, color: colors.dark, fontWeight: '600', marginTop: 6, lineHeight: 21 },
  startHead: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 4 },
  startT: { fontSize: 18, fontWeight: '700', color: colors.dark },
  startS: { fontSize: 12, color: colors.dark, fontWeight: '600', marginTop: 1 },
  // On the website the chips are deliberately BIG — tall blocks with large text that fill the screen
  // and pop in one by one; on phone they stay the snug original size. (user request.)
  suggest: { gap: IS_WEB ? 14 : 10, marginTop: IS_WEB ? 18 : 14 },
  suggestLead: { fontSize: IS_WEB ? 15 : 13.5, fontWeight: '700', color: colors.dark, marginBottom: IS_WEB ? 4 : 1 },
  // Centered onboarding header above the example cards — icon, bold heading, lighter description.
  onbWrap: { alignItems: 'center', gap: 7, marginBottom: IS_WEB ? 14 : 10, paddingHorizontal: 12 },
  onbHeading: { fontSize: IS_WEB ? 19 : 16.5, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  onbDesc: { fontSize: IS_WEB ? 13.5 : 12.5, color: colors.muted, textAlign: 'center', lineHeight: IS_WEB ? 19 : 17, maxWidth: 380 },
  // Responsive grid of green example cards: 3 columns on web/desktop, 2 columns on phone. The cards
  // flow across the row (RTL-aware via flexWrap, mirroring the results cardsGrid) and tile downward so
  // a dozen-plus prompts fill the screen instead of one tall column. (user request.)
  exGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: IS_WEB ? 12 : 10 },
  exGridItem: { width: IS_WEB ? '31.5%' : '48.5%' },
  exBeat: { width: '100%' },
  // EVERY card is the SAME fixed height (not min-height) so the grid is perfectly uniform; the prompt
  // is clamped to 2 lines (numberOfLines) and vertically centred next to a rounded icon tile that
  // mirrors the filter's "Start here" chips. (user request.)
  exChip: { flexDirection: 'row', alignItems: 'center', gap: IS_WEB ? 10 : 8, width: '100%', height: IS_WEB ? 78 : 64, backgroundColor: colors.exFill, borderRadius: IS_WEB ? 16 : 14, paddingVertical: 0, paddingHorizontal: IS_WEB ? 14 : 11 },
  exChipHover: { opacity: 0.9 },
  // Rounded icon tile on the card — surface-coloured like the filter chip's icon box.
  exIcBox: { width: IS_WEB ? 34 : 28, height: IS_WEB ? 34 : 28, borderRadius: IS_WEB ? 11 : 9, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  exChipTx: { flex: 1, fontSize: IS_WEB ? 14 : 12, fontWeight: '600', color: '#fff', lineHeight: IS_WEB ? 19 : 16 },

  rankLine: { fontSize: 11, fontWeight: '600', color: colors.muted },
  // "Show more" pill, centered under the cards — neutral, never a "load best" CTA. (user request.)
  showMore: { alignSelf: 'center', marginTop: 14, paddingVertical: 9, paddingHorizontal: 22, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  showMoreTxt: { fontSize: 13, fontWeight: '700', color: colors.primary },
  // The two actions under the «more than 25» message: primary (show all) + outline (refine). (user 2026-06-27.)
  mBtnRow: { flexWrap: 'wrap', gap: 8, marginTop: 2 },
  // minWidth + centered content: the text↔dots swap never changes the button's size (no layout shift).
  mBtnPrimary: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999, backgroundColor: colors.primary, minWidth: 118, alignItems: 'center', justifyContent: 'center', ...(Platform.OS === 'web' ? ({ cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '150ms' } as any) : {}) },
  mBtnPrimaryHover: { backgroundColor: colors.dark },
  mBtnPrimaryTx: { fontSize: 13, fontWeight: '700', color: '#fff', lineHeight: 18 },
  mBtnAlt: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  mBtnAltTx: { fontSize: 13, fontWeight: '700', color: colors.primary },
  // Clickable refine answer chips (district/budget/beds/type) under a «more precise» question. (user 2026-06-27.)
  rChipRow: { flexWrap: 'wrap', gap: 8, alignSelf: 'stretch' },
  rChip: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  rChipTx: { fontSize: 13, fontWeight: '700', color: colors.primary },
  // Inline "I can get you something more precise." pill, sits under the visible listing. (user request.)
  preciseInline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'center', marginTop: 10, paddingVertical: 9, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: colors.tintLine, backgroundColor: colors.tint },
  preciseInlineTxt: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  // Web: a wrap grid — cards flow across the row (right-to-left under RTL) and tile down only as
  // needed, so results spread over the screen instead of one long scroll.
  // Web results are a balanced 2-column grid → 4 cards read as a clean 2×2 block, never an uneven
  // "3 on top + 1 stranded below". space-between sets the column gutter; rowGap spaces the rows. (user request.)
  cardsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14, marginTop: 14 },
  // Each card takes just under half the row so exactly two sit side by side, all the same size.
  gridItem: { width: '48.5%' },

  // Guest sign-up wall (centered dialog over a dimmed page).
  promptOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, alignItems: 'center', justifyContent: 'center', padding: 28 },
  promptBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,18,12,0.5)' },
  promptCard: { width: '100%', maxWidth: 360, backgroundColor: colors.surface, borderRadius: 20, padding: 22, alignItems: 'center', gap: 9, ...cardShadow },
  promptIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 2, overflow: 'hidden' },
  promptLogo: { width: 56, height: 56, borderRadius: 28 },
  promptTitle: { fontSize: 17, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  promptBody: { fontSize: 13.5, lineHeight: 19, color: colors.muted, textAlign: 'center' },
  promptPrimary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 13, paddingVertical: 13, width: '100%', marginTop: 6 },
  promptPrimaryTx: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
  promptSecondary: { paddingVertical: 8 },
  promptSecondaryTx: { color: colors.muted, fontSize: 13.5, fontWeight: '600' },

  // marginTop adds breathing room above each user message so it isn't cramped against the property
  // cards / reply text above it (on top of the column's 8px gap). (user request.)
  // User message bubble — deliberately STRONGER light-green so it pops against the cream paper bg,
  // like the selected recent-chat row in the sidebar. Dark green text for contrast. (user request.)
  // User message bubble — soft light green pill, normal text weight (not heavy/black). (user request.)
  userBubble: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: '#d7eede', borderColor: '#bedfc9', borderWidth: 1, borderRadius: 16, borderBottomRightRadius: 5, paddingVertical: 10, paddingHorizontal: 14, marginTop: 10 },
  userText: { color: '#1d4a37', fontSize: 14, lineHeight: 19, fontWeight: '500' },

  status: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingLeft: 2 },
  statusText: { fontSize: 12.5, color: colors.muted },
  // The Ezhalah slogan during search — plain text, prominent, with the summary beneath it. No icon.
  sloganWrap: { gap: 8, paddingVertical: 2 },
  sloganText: { fontSize: 15.5, fontWeight: '700', color: colors.dark, flexShrink: 1 },
  // The search summary shown under the results header (not with the slogan).
  summaryText: { fontSize: 12.5, color: colors.muted, lineHeight: 18, marginTop: 2 },

  reply: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  replyIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  replyText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.ink },
  // The opening greeting is larger and a touch heavier than a normal reply so it reads as a proper
  // welcome, not just another line. (user request: make it bigger.) 17/27 since the 2026-08-23 copy
  // became a full marketing sentence — still clearly the welcome, without turning into a wall.
  greetingText: { fontSize: 17, lineHeight: 27, fontWeight: '600', color: colors.dark },
  // Rotating composer examples (owner brief 2026-08-23): the absolute overlay fills the input's own
  // clipped wrapper (inputGrow), so it is structurally unable to move the mic/Send or overflow; the
  // text mirrors the input's placeholder metrics exactly (16px web / muted / RTL right-aligned) so
  // it reads as the placeholder, not as a second element.
  introRotator: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'center' },
  introRotatorText: { fontSize: Platform.OS === 'web' ? 16 : 15, lineHeight: 22, color: colors.muted, paddingHorizontal: 2, textAlign: 'right', writingDirection: 'rtl' as any },
  brand: { fontWeight: '700', color: colors.primary },

  emptyRes: { fontSize: 14, color: colors.muted },

  refine: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.tint, borderColor: colors.tintLine, borderWidth: 1, borderRadius: 14, padding: 12 },
  refineIc: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  refineT: { fontSize: 13, fontWeight: '700', color: colors.ink },
  refineS: { fontSize: 11, color: colors.body, marginTop: 1, lineHeight: 15 },
  refineBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: 11 },
  refineBtnTx: { fontSize: 12, fontWeight: '700', color: '#fff' },

  composerWrap: { paddingHorizontal: space.screenSide, paddingTop: 10, alignItems: 'center' },
  // The send/stop button is pinned to the PHYSICAL right (right:4) and never mirrors — it stays on the
  // right in Arabic too, so paddingRight leaves room for it regardless of text direction. (user request.)
  // Inline row (no absolute button): input flexes, the send/stop button sits at the end, vertically
  // centered with comfortable edge padding. flexDirection is set per language at the call site so the
  // button lands on the correct side in both LTR and RTL. (user request: balanced, centered send button.)
  // ChatGPT-style bar (owner 2026-07-08): single row, send button anchored on the far right (16px from
  // the edge, vertically centered), thinner single-line input that grows on wrap. paddingRight 16 places
  // the button; the input + button are flex siblings so text always stops before the button (never under).
  // The composer sits inside the LTR-pinned `col`, so `row` (not row-reverse) is what puts the send
  // button on the FAR RIGHT here; the input (flex:1) fills to its left and right-aligns its Arabic
  // text next to the button. (owner 2026-07-09: send button must be far right.)
  // Composer redesign (2026-08-16). The chat column is 940 wide on desktop — a full-width composer
  // there reads as a search bar, not a place to talk. 720 keeps it a deliberate, centered object.
  composerCol: { maxWidth: 720, alignSelf: 'center' },
  // alignItems flex-end pins the send arrow to the BOTTOM edge as the box grows (the ChatGPT/Claude
  // composer contract); the input's own marginVertical re-centers a single line against the 34px
  // button, so idle still reads as one compact pill. borderColor/shadowOpacity/shadowRadius are
  // ANIMATED inline (focus glow) — only the static halves live here.
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: 24, paddingVertical: 8, paddingLeft: 18, paddingRight: 8, shadowColor: cardShadow.shadowColor, shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  // Focus glow target — COMPOSER_EASE (web) glides border-color and box-shadow between these two.
  // Carries the FULL shadow set: RNW compiles box-shadow per-style, so a partial override here
  // would win wholesale and drop the green tint + offset (observed live).
  composerFocused: { borderColor: colors.primary, shadowColor: cardShadow.shadowColor, shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  // The wrapper owns the glide (INPUT_EASE) and the row position; marginVertical 6 =
  // (34 send-button − 22 line) / 2, the single-line centering trick above.
  inputGrow: { flex: 1, overflow: 'hidden', marginVertical: 6 },
  // 15/22 breathes better for Arabic script than the old 14/20. Height is the same numeric target
  // as the wrapper's — set state-wise, never transitioned (see the JSX note on measurement).
  // fontSize MUST be >=16 on web: mobile Safari/Chrome auto-zoom the page when focusing an input under
  // 16px and never zoom back out — the single worst mobile-web chat bug. overflowY:'auto' gives the
  // internal scroll once the textarea reaches COMPOSER_MAX_H. (owner 2026-08-19)
  input: { width: '100%', fontSize: Platform.OS === 'web' ? 16 : 15, lineHeight: 22, color: colors.ink, paddingVertical: 0, paddingHorizontal: 2, textAlignVertical: 'center', ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any, overflowY: 'auto' as any } : {}) },
  sendBtn: { width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnHover: { backgroundColor: colors.dark },
  sendDisabled: { opacity: 0.35 },
  // ── Voice recording composer (owner brief 2026-08-23) ──
  // composerInner keeps the normal controls' exact pre-voice layout (it owns the composer's size at
  // all times); the recording row overlays it absolutely so the morph never changes the surface.
  composerInner: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  composerInnerHidden: { opacity: 0 },
  micBtn: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  micBtnPressed: { backgroundColor: colors.segTrack, transform: [{ scale: 0.96 }] },
  // The LTR pin that fixes the physical order lives INLINE on the row (Sidebar's LTR_PIN idiom —
  // RNW rejects `direction` inside StyleSheet.create but honours it as an inline style).
  voiceRow: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 8, paddingRight: 8 },
  voiceRowHidden: { opacity: 0, transform: [{ translateY: 4 }] },
  voiceRoundBtn: { width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.segTrack, alignItems: 'center', justifyContent: 'center' },
  voiceStopSquare: { width: 12, height: 12, borderRadius: 3, backgroundColor: colors.ink },
  // flex:1 + overflow hidden: the waveform owns ALL flexible middle space and can never push the
  // fixed-width controls, whatever the amplitude (owner brief §1/§4).
  voiceWaveWrap: { flex: 1, alignSelf: 'stretch', minHeight: 34, overflow: 'hidden' },
  stopBtn: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  disc: { fontSize: 11, lineHeight: 16, color: colors.muted, textAlign: 'center', marginTop: 10, paddingHorizontal: 12 },
  // Centered Filter/AI pill band under the header (see the JSX note). Explicit height on BOTH ends
  // so MODE_EASE can glide it to 0; overflow hidden so the collapse clips instead of squashing.
  modeWrap: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center', height: 58, overflow: 'hidden' },
  modeWrapHidden: { opacity: 0, height: 0, transform: [{ scale: 0.96 }] },
});
