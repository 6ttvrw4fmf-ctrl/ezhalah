import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, space, cardShadow } from '@/theme/tokens';
import { Tappable, Heartbeat } from '@/components/ui';
import SearchLoader from '@/components/SearchLoader';
import FeedbackRow from '@/components/FeedbackRow';
import { CardIn, LoadingDots } from '@/components/CardReveal';

// Memoized card: during the reveal cascade the list re-renders every ~55ms — already-revealed cards
// must skip reconciliation or 200+ cards stutter the very animation the cascade exists for (review
// perf fix 2026-07-09). onOpen is deliberately excluded from the comparison: it's re-created each
// render but behaves identically for the same listing.
const MemoResultCard = memo(ResultCard, (prev, next) =>
  prev.listing === next.listing && prev.rank === next.rank && prev.variant === next.variant);
import HeroBackground from '@/components/HeroBackground';
import ShareSheet from '@/components/ShareSheet';
import Sidebar, { useDocked } from '@/components/Sidebar';
import { ResultCard, PopIn } from '@/components/ResultCard';
import { parseQuery, respond } from '@/data/agent';
import { parseProximity } from '@/data/proximity';
import { resolveLocation, cityDisplay, topCitiesInRegion, topDistrictsForCity } from '@/data/locations';
import { arabicOrPlaceholder } from '@/lib/arabicText';
import { openListing } from '@/lib/openListing';
import { filterToChat, searchSummary, effectiveTypes, type SearchQuery, type SearchResult } from '@/data/search';
import type { Category } from '@/data/taxonomy';
import { useApp } from '@/store';
import { useI18n, detectLocale, getLocale, t as tr, type Locale, LOCATION_UNRESOLVED_AR } from '@/i18n';
import { noTranslateRef } from '@/noTranslate';
import AdvancedQuestionCard, { AdvancedQuestionLoading } from '@/components/AdvancedQuestionCard';
import { ADVANCED_QUESTIONS, MIN_OPTIONS_TO_SHOW, type AdvancedOption } from '@/data/advancedFilters';

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
const AGE_FILTER_TYPES = new Set<string>([
  'Apartment',            // gold standard, live since 2026-07-16 (PR #101)
  'Residential Building', // added 2026-07-16 (PR #114): live-verified 34% coverage, genuine 5-bucket spread
                          // (buy: new 289/1-2 34/3-5 387/6-9 569/10+ 933), counts==search parity confirmed
  'Room',                 // غرفة, added 2026-07-16: rooms are rented — enough data only in the big rent
                          // scopes (الرياض/إيجار 1,127 rows, all 5 buckets; جدة/إيجار 425), self-protecting
                          // thresholds hide it elsewhere. macro=Residential, counts==search parity confirmed
                          // (الرياض cnt_3_5=220==search 220, all 220 strictly in [3,5], zero unknown).
  'Floor',                // دور, added 2026-07-16 (final rollout step): الرياض/إيجار has a genuine 5-bucket
                          // spread (new 280/1-2 73/3-5 446/6-9 246/10+ 200); الرياض/بيع (9,839) skews «new»
                          // but all 5 buckets still clear MIN_REAL_BUCKET_COUNT. macro=Residential,
                          // counts==search parity confirmed (الرياض/إيجار cnt_3_5=446==search 446, all strict).
]);
function isAgeFilterScope(q: SearchQuery): boolean {
  const types = effectiveTypes(q);
  return q.category === 'Residential' && types.length === 1 && AGE_FILTER_TYPES.has(types[0]);
}

const IS_WEB = Platform.OS === 'web';
// On the web the results tile into a wrap grid, so the conversation column is wider to give them
// room (the user barely scrolls). On phone it stays a comfortable single-column reading width.
const MAX_W = IS_WEB ? 940 : 560;

// Example-prompt pools, sampler, and the DB-driven hook all live in src/data/examplePrompts.ts so
// the home onboarding grid and this agent screen share ONE library — adding a prompt or a new DB
// source there now appears in both places.
import { useExamplePrompts } from '@/data/examplePrompts';

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
// The opening greeting Ezhalah types into a fresh chat (user-authored, verbatim). Language follows
// the UI locale — Arabic in Arabic mode, English in English mode, never mixed. Rendered live from
// the locale (not frozen at send time) so flipping language re-renders it in the other language.
// Welcome banner: user request — just the word «ازهله», no flourishes / jokes / "son of AI" line.
const greetingText = (locale: Locale): string =>
  locale === 'ar' ? 'ازهله' : 'Ezhalah';

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

// PER-MESSAGE direction: each bubble keeps its OWN direction from its OWN text — an Arabic message is
// RTL, an English message LTR — so sending a new Arabic message never re-flips older English bubbles.
// (user request: never apply one global direction to the whole chat.) Dominant by word count.
const msgRTL = (s: string): boolean => {
  const words = (s || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let ar = 0, en = 0;
  for (const w of words) { if (/[؀-ۿ]/.test(w)) ar++; else if (/[A-Za-z]/.test(w)) en++; }
  return ar > en;
};

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

// One in-flight chat turn. The Stop box cancels it: `cancelled` makes every awaited beat bail, and
// flushing the pending timers/resolvers unblocks any beat currently waiting.
type Run = { cancelled: boolean; timers: ReturnType<typeof setTimeout>[]; flush: (() => void)[] };
const makeRun = (): Run => ({ cancelled: false, timers: [], flush: [] });
const waitRun = (run: Run, ms: number) =>
  new Promise<void>((resolve) => {
    run.timers.push(setTimeout(resolve, ms));
    run.flush.push(resolve);
  });
// Greeting, reply, and the request-bubble echo all share the ONE constant speed defined above —
// there are no per-type durations any more, so nothing ever types faster or slower than anything else.

// Soft background fade on hover/press for the suggestion chips (web only).
const WEB_TAP = Platform.OS === 'web' ? ({ transitionProperty: 'opacity, background-color', transitionDuration: '150ms' } as any) : null;
// Feedback toast fade + slide (web CSS transition; native just toggles — acceptable, web ships).
const TOAST_EASE = Platform.OS === 'web' ? ({ transitionProperty: 'opacity, transform', transitionDuration: '250ms' } as any) : null;

// Typewriter — reveals the text one character at a time, spread evenly across `duration` ms (so a
// short or long sentence both take the same ~5s), making a filter search read as if Ezhalah is
// writing it out (prototype parity: ezhalah-mobile.jsx Typer). Renders an unstyled <Text> so it
// inherits the surrounding bubble/reply styling. onDone fires once the full text is shown.
function Typer({ text, onDone }: { text: string; onDone?: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const total = text.length;
    if (total === 0) {
      onDone?.();
      return;
    }
    // Constant cadence: reveal TYPE_CHARS every TYPE_TICK_MS, the SAME for short and long text. Total
    // time = length × speed, so nothing ever bursts faster or crawls slower than anything else.
    let i = 0;
    const id = setInterval(() => {
      i += TYPE_CHARS;
      if (i >= total) {
        setN(total);
        clearInterval(id);
        onDone?.();
      } else {
        setN(i);
      }
    }, TYPE_TICK_MS);
    return () => clearInterval(id);
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
    const total = full.length;
    if (total === 0) {
      onDone?.();
      return;
    }
    // Same constant cadence as Typer (TYPE_CHARS per TYPE_TICK_MS) so the listings reply types at the
    // EXACT same speed as a plain chat reply — no separate, faster "found" animation.
    let i = 0;
    const id = setInterval(() => {
      i += TYPE_CHARS;
      if (i >= total) {
        setN(total);
        clearInterval(id);
        onDone?.();
      } else {
        setN(i);
      }
    }, TYPE_TICK_MS);
    return () => clearInterval(id);
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

export default function Agent() {
  const insets = useSafeAreaInsets();
  // Responsive to the ACTUAL viewport (not just native vs web): a narrow screen — a phone, OR the web
  // app opened on a phone browser — gets the reduced 2-column / few-cards layout. (user request.)
  const { width: winW } = useWindowDimensions();
  const narrowGrid = winW < 680;
  const router = useRouter();
  const { t, locale, setLocale } = useI18n();
  // A FRESH random subset of example prompts each mount/refresh — from the pool matching the UI
  // language (Arabic UI → Arabic pool, English UI → English pool, never mixed). Re-samples if the
  // language or column count changes. Phone shows 6, wider screens 12. (user request: rotation.)
  const exampleSet = useExamplePrompts(locale === 'ar' ? 'ar' : 'en', narrowGrid ? 6 : 12);
  const { seed, filter, chatBubble, chatSub, replay, fresh } = useLocalSearchParams<{
    seed?: string;
    filter?: string;
    chatBubble?: string;
    chatSub?: string;
    replay?: string;
    fresh?: string;
  }>();
  const { user, runQuery, loadMoreListings, gated, pendingMessage, setPendingMessage, recordChatTurn, trackOpen } = useApp();
  // Per-message "Load More" in flight, so a double-tap can't double-fetch the same page.
  const [loadingMore, setLoadingMore] = useState<Record<string, boolean>>({});
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [typed, setTyped] = useState('');
  // Composer height: single line by default, grows only as text wraps (ChatGPT-style). (owner 2026-07-08)
  const [inputH, setInputH] = useState(20);
  const inputRef = useRef<any>(null);
  const [busy, setBusy] = useState(false);
  // True once the user hit Stop mid-display: freezes the cards already shown and hides the "more
  // precise" CTA on the stopped results. Reset on every new turn. (user request.)
  const [stopped, setStopped] = useState(false);
  // Note #5 — Share sheet visibility in AI Agent mode. The button stays in the header throughout.
  const [shareOpen, setShareOpen] = useState(false);
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
    | { phase: 'asking'; dim: string; titleKey: string; options: AdvancedOption[]; unknownCount: number }
    | null
  >(null);
  const ageFlowQueryRef = useRef<SearchQuery | null>(null);
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

  const toBottom = () => requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  const toTop = () => requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: 0, animated: false }));
  const onGrow = () => {
    if (pinModeRef.current === 'top') toTop();
    else if (pinModeRef.current === 'bottom') toBottom();
  };

  // Stop box: cancel the current turn. Drop the in-flight "thinking/searching" bubbles (anything
  // already written — the reply, earlier results — stays), unblock any waiting beat, and re-enable
  // the composer. (user request: a box the user can click to stop the search.)
  const stop = () => {
    const run = runRef.current;
    // Was a REAL search turn in flight, or only a «عرض المزيد» card cascade? (review fix 2026-07-09:
    // stopping a mere pagination cascade must NOT claim "I've stopped the search" or hide CTAs.)
    const hadTurn = !!run;
    if (run) {
      run.cancelled = true;
      run.timers.forEach(clearTimeout);
      run.flush.forEach((r) => r());
    }
    runRef.current = null;
    pendingFilterRef.current = null; // also cancels a filter flow still typing its request bubble
    clearReveals();   // stop revealing more cards immediately — never continue toward card #15
    revealActiveRef.current = null; // forget the in-progress reveal so the NEXT message never completes it
    setRevealing(false); // Stop reverts to Send
    if (!hadTurn) return; // cascade halted; cards stay frozen, «عرض المزيد» recovers via bufferMore
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
    // (A) fetched-but-unrevealed cards remain → cascade the next slice in from the buffer.
    if (cur < fetched) {
      cascadeIn(mid, cur, Math.min(cur + REVEAL_STEP, fetched));
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
      const target = Math.min(cur + REVEAL_STEP, mergedLen);
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
  const startRefine = (q?: SearchQuery) => {
    if (!q) return;
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
    if (!dim && !q.detail) {
      dim = 'beds';
      ask = ar ? 'كم غرفة نوم تبغى؟' : 'How many bedrooms?';
      options = ['1', '2', '3', '4', '5'].map((n) => ({ label: bedsLabel(n, ar), value: n }));
    }
    if (!dim && !q.type) {
      dim = 'type';
      ask = ar ? 'أي نوع عقار تفضّل؟' : 'Which property type?';
      const pairs: [string, string][] = ar
        ? [['شقة', 'شقة'], ['فيلا', 'فيلا'], ['دور', 'دور'], ['أرض', 'أرض']]
        : [['Apartment', 'apartment'], ['Villa', 'villa'], ['Floor', 'floor'], ['Land', 'land']];
      options = pairs.map(([label, value]) => ({ label, value }));
    }
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
      if (p.typeGroup) refined.typeGroup = p.typeGroup;
      if (p.category) refined.category = p.category;
    } else if (ADVANCED_QUESTIONS.some((c) => c.key === dim)) {
      // Advanced-question answers (currently: property_age) — delegate to that question's own
      // config so this stays generic as more fields are added, per the reusable-engine design.
      return ADVANCED_QUESTIONS.find((c) => c.key === dim)!.applyAnswer(base, a);
    } else {
      const p = parseQuery(`${a} ${base.location ?? ''}`);
      if (p.type) refined.type = p.type;
      if (p.priceInput) refined.priceInput = p.priceInput;
      if (p.detail) refined.detail = p.detail;
    }
    return refined;
  };

  // Run a refine answer (tapped chip OR typed reply): echo `label` as the user's bubble, merge the one
  // asked dimension into the SAME filter, and re-search. (user 2026-06-27.)
  const runRefine = async (baseQ: SearchQuery, dim: string, value: string, label: string) => {
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
    const result = await runQuery(refined);
    if (run.cancelled) return;
    await playListings(run, statusId, buildScrapeIntro(result.query ?? refined), result, label);
    if (run.cancelled) return;
    void promptSignupSoon(run);
    setBusy(false); runRef.current = null; toBottom();
  };

  // Entry point for «خلّنا نحدد الطلب أكثر» in an apartment-only scope (owner 2026-07-13): show the
  // Claude-style loading state, resolve live-scoped option counts for the (currently single) advanced
  // question, and either display it as a centered card or — if fewer than MIN_OPTIONS_TO_SHOW real
  // options exist for THIS exact scope — fall through to the pre-existing narrowing chips instead of
  // leaving the tap with no effect.
  const startAgeFlow = async (q: SearchQuery) => {
    setAgeFlow({ phase: 'loading' });
    ageFlowQueryRef.current = q;
    for (const cfg of ADVANCED_QUESTIONS) {
      const result = await cfg.fetchOptions(q);
      if (ageFlowQueryRef.current !== q) return; // superseded by a newer tap/turn
      if (result.options.length >= MIN_OPTIONS_TO_SHOW) {
        setAgeFlow({ phase: 'asking', dim: cfg.key, titleKey: cfg.titleKey, options: result.options, unknownCount: result.unknownCount });
        return;
      }
    }
    setAgeFlow(null);
    startRefine(q);
  };

  // Picking a real option hands off to the SAME chat-turn mechanism as the existing refine chips —
  // echoes the picked label as the user's bubble, merges it into the unchanged rest of the query, and
  // re-searches. Skipping (an optional question) just closes the card — nothing has changed, so there
  // is nothing to re-run.
  const onAgeAnswer = (key: string) => {
    if (ageFlow?.phase !== 'asking') return;
    const opt = ageFlow.options.find((o) => o.key === key);
    const baseQ = ageFlowQueryRef.current;
    const dim = ageFlow.dim;
    setAgeFlow(null);
    if (baseQ) void runRefine(baseQ, dim, key, opt?.label ?? key);
  };
  const onAgeSkip = () => setAgeFlow(null);

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
    if (gated) {
      // Park what they wrote and send them to sign in — after auth the chat replays it (see the
      // pending-message effect below), so logging in never makes them lose it or start over.
      setPendingMessage(v);
      router.push('/auth');
      return;
    }
    setTyped('');
    finalizeReveal(); // stop the previous search's cards from drip-revealing now that the user moved on
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
    const turn = await respond(v, { loggedIn: !!user, history, attemptTexts: saidRef.current });
    if (run.cancelled) return;
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
        const result = await runQuery(turn.query);
        const reply = forcedBroad
          ? `${v === 'ar'
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
          const result = await runQuery(combined);
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

  // Filter search / history open routes here with ?filter=<JSON SearchQuery> — show the
  // natural-language bubble + listings inline (prototype parity: no separate results page).
  // The interview path supplies its own bubble + subheading (prototype interviewToChat copy, which
  // lists the budget label verbatim); the filter path derives them via filterToChat.
  const sendFilter = (q: SearchQuery, override?: { bubble: string; sub: string }) => {
    if (gated) {
      router.push('/auth');
      return;
    }
    finalizeReveal(); // stop any previous search's cards from drip-revealing
    setStopped(false); // new search — clear any prior stopped state
    setBusy(true);
    askCountRef.current = 0;
    saidRef.current = [];
    runRef.current = makeRun();
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
        const result = await runQuery(pending.q);
        if (run.cancelled) return;
        await playListings(run, statusId, buildScrapeIntro(result.query ?? pending.q), result);
        if (run.cancelled) return;
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
  const openStatic = async (q: SearchQuery, override?: { bubble: string; sub: string }) => {
    const { bubble, sub } = override ?? filterToChat(q);
    const userId = uid();
    const resultsId = uid();
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
    if (filter && filter !== lastFilterRef.current) {
      lastFilterRef.current = filter;
      lastSeedRef.current = undefined;
      try {
        const q = JSON.parse(filter) as SearchQuery;
        const override = chatBubble && chatSub ? { bubble: chatBubble, sub: chatSub } : undefined;
        startFresh();
        if (replay === '0') openStatic(q, override);
        else sendFilter(q, override);
      } catch {}
    } else if (seed && seed !== lastSeedRef.current) {
      lastSeedRef.current = seed;
      lastFilterRef.current = undefined;
      startFresh();
      send(seed);
    } else if (!filter && !seed && !greetedRef.current) {
      greetedRef.current = true;
      sendGreeting();
    }
  }, [seed, filter, chatBubble, chatSub, replay]);

  // New Chat routes back here with a changing ?fresh=… — wipe the conversation and greet again, even
  // if we were already on the agent screen (where the component doesn't remount). (user request.)
  const freshMountRef = useRef(true);
  useEffect(() => {
    if (freshMountRef.current) { freshMountRef.current = false; return; }
    if (fresh === undefined) return;
    if (runRef.current) runRef.current.cancelled = true;
    if (greetTimerRef.current) clearTimeout(greetTimerRef.current);
    setBusy(false);
    setMsgs([]);
    // Forget the last-handled filter/seed so a re-search AFTER New Chat re-runs even if it's identical
    // to a previous one (otherwise the change-detection would skip it and leave just the greeting).
    lastFilterRef.current = undefined;
    lastSeedRef.current = undefined;
    sendGreeting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh]);

  // After the user signs in at the gate, replay the message they were trying to send. Runs once —
  // the moment they're no longer gated and a parked message exists. This is what makes "log in →
  // back to your search" seamless instead of dropping them on an empty screen. (gate UX, PRD §9)
  useEffect(() => {
    if (consumedPendingRef.current) return;
    if (gated || busy || !pendingMessage) return;
    consumedPendingRef.current = true;
    const msg = pendingMessage;
    setPendingMessage(null);
    setTyped('');
    send(msg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gated, busy, pendingMessage]);

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
        {/* Landing state (only the agent's greeting so far) → "✨ Ezhalah AI Agent". Once the USER sends
            a message or a filter search produces results, the header collapses to just the brand
            "Ezhalah" with no sparkle. The greeting is role 'agent', so it doesn't count as "started".
            (user request: "after he sends a message just show Ezhalah, remove the star".) */}
        {(() => {
          const started = msgs.some((m) => m.role === 'user' || m.role === 'results');
          return (
            <View style={s.titleWrap}>
              {!started && <Ionicons name="sparkles" size={16} color={colors.primary} />}
              <Text ref={noTranslateRef} style={s.title}>{started ? t('Ezhalah') : t('Ezhalah AI Agent')}</Text>
            </View>
          );
        })()}
        <View style={{ flex: 1 }} />
        {/* Precise tab removed from the header (user request) — refining now happens inline, via the
            "I can get you something more precise." button under the results. */}
        <Pressable onPress={() => router.replace('/')} style={s.filterBtn} hitSlop={8}>
          <Ionicons name="options-outline" size={15} color={colors.primary} />
          <Text style={s.filterText}>{t('Filter')}</Text>
        </Pressable>
        {/* Note #5 — Share is ALWAYS visible the moment the user is in AI Agent mode. Not gated on
            results, not gated on a completed search. Throughout the entire experience. (user request.) */}
        <Pressable onPress={() => setShareOpen(true)} style={s.shareIcon} hitSlop={8}>
          <Ionicons name="share-social-outline" size={20} color={colors.ink} />
        </Pressable>
      </View>
      {shareOpen && <ShareSheet onClose={() => setShareOpen(false)} />}
      {sidebarOpen && <Sidebar onClose={() => setSidebarOpen(false)} />}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 52}
      >
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
                      <Text style={[s.replyText, m.greeting && s.greetingText, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left', flex: 1 }]}>
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
                  {(() => {
                    const zeroResult = m.result.listings.length === 0;
                    // EXACT count headline «لقينا N إعلان يطابق طلبك» from the RPC's count(*) over() (matchTotal).
                    // Safe/exact for the standard path; the priceIsAnnual edge makes the RPC skip the price cap
                    // (so the count would overstate) → fall back to the generic intro there. (owner: exact only if safe.)
                    const total = m.result.matchTotal ?? m.result.listings.length;
                    const countSafe = !m.result.query?.priceIsAnnual && total > 0;
                    const txt = zeroResult
                      ? (m.result.suggestion ?? t('No exact matches — try broadening your search.'))
                      : countSafe
                        ? t('We found {n} listings matching your search.', { n: total.toLocaleString('en-US') })
                        : m.text;
                    return (
                      <Text style={[s.replyText, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left', marginTop: 6, alignSelf: 'stretch' }]}>
                        {m.typing ? <Typer text={txt} onDone={() => markTyped(m.id)} /> : txt}
                      </Text>
                    );
                  })()}
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
                        const bufferMore = shown < fetched; // fetched cards not yet revealed on screen
                        // Show once this page's cards are on screen. Gate on (typing && !doneTyping) — the SAME
                        // condition the cards use — NOT on `m.typing` alone: a live results message keeps typing=true
                        // even after the intro finishes (only doneTyping flips), so gating on m.typing hid this block.
                        // min(FIRST_PAGE, fetched): a search with <10 matches still gets its closing message.
                        if ((m.typing && !doneTyping[m.id]) || shown < Math.min(FIRST_PAGE, fetched)) return null;
                        // ALWAYS show a closing count message above the feedback row (owner 2026-07-09: the
                        // message must never disappear and leave the thumbs alone). Honesty rule: when
                        // everything matching is already on screen, say so and DROP «عرض المزيد» (a load-more
                        // button with nothing to load would be a lie) — only «خلّنا نحدد الطلب أكثر» stays.
                        const hasMore = serverMore || bufferMore;
                        // fetching = THIS message's page fetch; cascading = THIS message's card drip.
                        // Only the owning message's button shows the dots (review fix: a global flag
                        // was falsely lighting every visible «عرض المزيد»).
                        const fetching = !!loadingMore[m.id];
                        const cascading = revealing && revealActiveRef.current?.id === m.id;
                        return (
                          <View style={{ gap: 8, marginTop: 14, alignSelf: 'stretch' }}>
                            <Text style={[s.replyText, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' }]}>
                              {hasMore
                                ? t('I showed you the first {n} listings. Want me to show more, or help you find more precise ones?', { n: shown.toLocaleString('en-US') })
                                : t('I showed you all {n} matching listings. Want help finding more precise ones?', { n: shown.toLocaleString('en-US') })}
                            </Text>
                            {/* Tell the user exactly how Load More behaves (owner 2026-07-08): 100 at a time. */}
                            {hasMore ? (
                              <Text style={[s.rankLine, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left', alignSelf: 'stretch' }]}>
                                {t('I can show you 100 listings at a time.')}
                              </Text>
                            ) : null}
                            {/* «عرض المزيد» ALWAYS pages the next 100 (buffer reveal, then real DB fetch when spent);
                                «خلّنا نحدد الطلب أكثر» asks ONE clarifying question then re-searches. */}
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
                              <Pressable
                                style={s.mBtnAlt}
                                onPress={() => {
                                  const q = m.result.query;
                                  if (q && isAgeFilterScope(q)) void startAgeFlow(q);
                                  else startRefine(q);
                                }}
                              >
                                <Text style={s.mBtnAltTx}>{t('Let’s narrow it down')}</Text>
                              </Pressable>
                            </View>
                          </View>
                        );
                      })()}
                      {/* Response-level feedback (thumbs up/down + share) — the LAST element of the
                          response, so the order reads: cards → «تبي أعرض لك المزيد…» message + buttons
                          → this row. MOVED here from under each card (owner 2026-07-09: one row,
                          directly below the more-message, nowhere else). Still shows when the
                          more-block is hidden (few results / all shown) — it belongs to the response.
                          Keyed by the results-message id → rates the RESPONSE, not one listing. */}
                      {(() => {
                        const fetched = m.result.listings.length;
                        const shown = revealCount[m.id] ?? (m.typing ? 0 : Math.min(FIRST_PAGE, fetched));
                        // Wait for the cards to be on screen AND the intro text to finish (cards now
                        // cascade during typing — the thumbs must never appear before the closing
                        // message above them).
                        if ((m.typing && !doneTyping[m.id]) || shown < Math.min(FIRST_PAGE, fetched)) return null;
                        return <FeedbackRow feedbackKey={m.id} onFeedback={showFbToast} />;
                      })()}
                    </>
                  )}
                </View>
              );
            }); })()}

            {/* Quick-suggestion chips sit directly under Ezhalah's greeting on a fresh chat, and
                disappear once the user has searched (any user message or results present). They're a
                first-timer onboarding nudge, so they only show for GUESTS — a logged-in user who lives
                in the app finds them noise, so we hide them entirely. (user request.) */}
            {(() => {
              // Chips appear only AFTER the greeting has finished typing (not during the blank/typing
              // beat), then POP IN one-by-one. Guests only; gone once a search has happened. (user request.)
              const greet = msgs.find((m) => m.role === 'agent' && m.greeting);
              const ready = !!greet && !!doneTyping[greet.id];
              if (user || !ready || msgs.some((m) => m.role === 'user' || m.role === 'results')) return null;
              return (
                <View style={s.suggest}>
                  <View style={s.onbWrap}>
                    <Ionicons name="search" size={IS_WEB ? 26 : 22} color={colors.primary} />
                    <Text style={s.onbHeading}>{t("Not sure what you're looking for?")}</Text>
                    <Text style={s.onbDesc}>{t('Tap one of the examples below and let Ezhalah start the search for you.')}</Text>
                  </View>
                  <View style={s.exGrid}>
                    {/* A randomized subset (exampleSet) already matched to the UI language — sent to the
                        real agent as-is on tap (no translation). Narrow viewport shows 6 in 2 columns,
                        wider shows 12 in 3 columns; each pops in then keeps a gentle heartbeat. (user request.) */}
                    {exampleSet.map((ex, i) => (
                      <PopIn key={ex} index={i} style={[s.exGridItem, { width: narrowGrid ? '48.5%' : '31.5%' }]}>
                        <Heartbeat index={i} style={s.exBeat}>
                          {/* Tappable gives the same press-scale the home "Start here" cards have. */}
                          <Tappable style={[s.exChip, Platform.OS === 'web' && WEB_TAP] as any} dip={0.06} onPress={() => send(ex)}>
                            {/* Rounded icon tile, mirroring the filter's "Start here" chips. */}
                            <View style={s.exIcBox}>
                              <Ionicons name="search-outline" size={IS_WEB ? 18 : 15} color={colors.primary} />
                            </View>
                            <Text style={s.exChipTx} numberOfLines={2}>{ex}</Text>
                          </Tappable>
                        </Heartbeat>
                      </PopIn>
                    ))}
                  </View>
                </View>
              );
            })()}
          </View>
        </ScrollView>

        {/* Composer */}
        <View style={[s.composerWrap, { paddingBottom: insets.bottom + 8 }]}>
          <View style={s.col}>
            <View style={s.composer}>
              <TextInput
                ref={inputRef}
                // writingDirection RTL for Arabic (the parent col is LTR-pinned, so without this the
                // placeholder's trailing «...» lands on the wrong side — it must read «…عنه»). (owner 2026-07-09)
                style={[s.input, { textAlign: locale === 'ar' ? 'right' : 'left', writingDirection: locale === 'ar' ? 'rtl' : 'ltr', height: Math.min(110, Math.max(20, inputH)) } as any]}
                placeholder={t("Type what you're looking for...")}
                placeholderTextColor={colors.muted}
                value={typed}
                onChangeText={(v) => { setTyped(v); if (!v) setInputH(20); }}
                // Single line by default; grows only as text wraps, capped at maxHeight (then scrolls).
                // onContentSizeChange uses RN's own line metrics (native + web). (owner 2026-07-08)
                onContentSizeChange={(e) => setInputH(Math.min(110, Math.max(20, e.nativeEvent.contentSize.height)))}
                // The language does NOT flip while typing a chat message — it switches only when the
                // message is SENT (see send(): an English message → English UI, Arabic → Arabic).
                // Live per-character switching is reserved for the Home filter's location field.
                // (user request.)
                multiline
                onSubmitEditing={() => send()}
                returnKeyType="search"
                blurOnSubmit
              />
              {busy || revealing ? (
                // While Ezhalah is thinking/searching OR the cards are still popping in, the Send button
                // is a Stop box — tap it to cancel the search and freeze the cards shown. (user request.)
                <Pressable onPress={stop} style={s.stopBtn} hitSlop={8} accessibilityLabel={t('Stop')}>
                  <Ionicons name="stop" size={14} color="#fff" />
                </Pressable>
              ) : (
                <Pressable onPress={() => send()} disabled={!typed.trim()} style={[s.sendBtn, !typed.trim() && { opacity: 0.4 }]}>
                  <Ionicons name="arrow-up" size={16} color="#fff" />
                </Pressable>
              )}
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
      {/* عمر العقار advanced-question overlay (owner 2026-07-13) — a transient card over the CURRENT
          results, reached only via «خلّنا نحدد الطلب أكثر» in an apartment-only scope. Absolutely
          positioned over the whole screen, same visual language as the interview overlay (dimmed
          backdrop + centered card), but rendered inline here rather than as a separate route, so
          answering can hand off directly to runRefine and update THIS same conversation in place. */}
      {ageFlow ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {ageFlow.phase === 'loading' ? (
            <AdvancedQuestionLoading onClose={onAgeSkip} />
          ) : (
            <AdvancedQuestionCard
              titleKey={ageFlow.titleKey}
              options={ageFlow.options}
              unknownCount={ageFlow.unknownCount}
              progressCur={1}
              progressTotal={1}
              onAnswer={onAgeAnswer}
              onSkip={onAgeSkip}
              onSkipAll={onAgeSkip}
              onClose={onAgeSkip}
            />
          )}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.screenSide, paddingBottom: 8 },
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
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { fontSize: 14, fontWeight: '700', color: colors.ink },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.tint, borderColor: colors.tintLine, borderWidth: 1, borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: 12 },
  // Note #5 — share icon sits beside the Filter pill in the agent header.
  shareIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  preciseBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.tint, borderColor: colors.tintLine, borderWidth: 1, borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: 12, marginRight: 6 },
  filterText: { fontSize: 12.5, fontWeight: '600', color: colors.primary },

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
  // welcome, not just another line. (user request: make it bigger.)
  greetingText: { fontSize: 18, lineHeight: 27, fontWeight: '600', color: colors.dark },
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
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: 18, paddingVertical: 4, paddingLeft: 16, paddingRight: 16, ...cardShadow },
  input: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.ink, paddingVertical: 0, paddingHorizontal: 4, minHeight: 20, maxHeight: 110, textAlignVertical: 'center', ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  sendBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  stopBtn: { width: 28, height: 28, borderRadius: 9, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  disc: { fontSize: 10.8, lineHeight: 16, color: colors.muted, textAlign: 'center', marginTop: 8, paddingHorizontal: 8 },
});
