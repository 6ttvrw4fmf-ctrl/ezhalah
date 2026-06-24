import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image as RNImage,
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
import { Spinner, Tappable, Heartbeat } from '@/components/ui';
import HeroBackground from '@/components/HeroBackground';
import ShareSheet from '@/components/ShareSheet';
import Sidebar, { useDocked } from '@/components/Sidebar';
import { ResultCard, PopIn } from '@/components/ResultCard';
import { parseQuery, respond } from '@/data/agent';
import { openListing } from '@/lib/openListing';
import { filterToChat, searchSummary, type SearchQuery, type SearchResult } from '@/data/search';
import type { Category } from '@/data/taxonomy';
import { useApp } from '@/store';
import { useI18n, detectLocale, getLocale, t as tr, type Locale } from '@/i18n';
import { noTranslateRef } from '@/noTranslate';

// The Ezhalah eagle logo — used in the header (top-left) + the sign-up popup. (user request: eagle, not stars.)
const LOGO = require('../../assets/images/ezhalah-logo.png');

const IS_WEB = Platform.OS === 'web';
// On the web the results tile into a wrap grid, so the conversation column is wider to give them
// room (the user barely scrolls). On phone it stays a comfortable single-column reading width.
const MAX_W = IS_WEB ? 940 : 560;

// Example-prompt pools, sampler, and the DB-driven hook all live in src/data/examplePrompts.ts so
// the home onboarding grid and this agent screen share ONE library — adding a prompt or a new DB
// source there now appears in both places.
import { useExamplePrompts } from '@/data/examplePrompts';

type ChatMsg =
  | { id: string; role: 'user'; text: string; typing?: boolean }
  | { id: string; role: 'agent'; text: string; typing?: boolean; greeting?: boolean }
  | { id: string; role: 'results'; text: string; result: SearchResult; typing?: boolean; slogan?: string; summary?: string }
  | { id: string; role: 'status'; phase: 'thinking' | 'searching'; slogan?: string; summary?: string };

const uid = () => 'm' + Date.now() + Math.round(Math.random() * 1e6);

// Right before Ezhalah goes off to scrape, it answers with ONE random Saudi-dialect hype line — a
// playful "you got it" in Najdi colour, never a recommendation or any judgement on the search (user
// request: speak in the Saudi dialect, plain and simple, never advise). The English locale gets
// equivalent breezy one-liners so a non-Arabic user reads the same energy.
// The opening greeting Ezhalah types into a fresh chat (user-authored, verbatim). Language follows
// the UI locale — Arabic in Arabic mode, English in English mode, never mixed. Rendered live from
// the locale (not frozen at send time) so flipping language re-renders it in the other language.
const greetingText = (locale: Locale): string =>
  locale === 'ar'
    ? 'ارحب! أنا إزهله. وش العقار والمدينة اللي تدور عليها؟ عطني التفاصيل وابشر بسعدك.. ازهله، وأنا ولد الذكاء الاصطناعي!'
    : "Hello! I'm Ezhalah. What property and city are you looking for? Give me the details and I'll do my best to find it for you.. Ezhalah, for I am truly the son of Artificial Intelligence!";

// Ezhalah's SEARCHING-phase voice — one Najdi-flavoured swagger line chosen at random before each
// search (its recognizable Saudi personality, NOT generic "searching now"). Shown ONLY while searching,
// above the search summary; the RESULTS header switches to the professional RESULT_* copy. (user request.)
// Curated subset: user removed slogans 6, 7, 8, 9, 10, 12, 13, 15, 18, 19, 20, 21, 22 from the
// original 22 — leaving the 9 below. HYPE_AR and HYPE_EN stay in lockstep (same index = same
// slogan). To re-add a slogan later, paste both the Arabic line and its English twin back at the
// SAME index in both arrays.
const HYPE_AR = [
  'ازهله، على شنبي!',
  'ازهله، على خشمي الوجيه!',
  'ازهله، ودونك غترتي وعقالي!',
  'ازهله، وفالك طيب!',
  'ازهله، من عيوني!',
  'ازهله، وابشر بسعدك!',
  'ازهله، وعلى يمناي كل اللي تبيه!',
];
// English versions of the same 22 approved Arabic slogans (same index → same slogan). These are
// FAITHFUL translations of HYPE_AR — not improvisations. The word "Ezhalah" is kept verbatim
// (NEVER translated to "Leave it to us" / "facilitate" / etc.) and the Najdi imagery is preserved.
// The slogan is rendered LTR with the sparkle icon on the LEFT when the UI is English, mirroring
// the RTL Arabic placement. (user request: "translate the Arabic slogan to English and put it in
// the correct English position — just never translate the word Ezhalah.")
const HYPE_EN = [
  'Ezhalah, on my mustache!',                              // ازهله، على شنبي!
  'Ezhalah, on my honorable nose!',                        // ازهله، على خشمي الوجيه!
  'Ezhalah, take my ghutra and igal as collateral!',       // ازهله، ودونك غترتي وعقالي!
  'Ezhalah, and may your fortune be good!',                // ازهله، وفالك طيب!
  'Ezhalah, from my own eyes!',                            // ازهله، من عيوني!
  'Ezhalah, rejoice in your good fortune!',                // ازهله، وابشر بسعدك!
  'Ezhalah, everything you want is in my right hand!',     // ازهله، وعلى يمناي كل اللي تبيه!
];
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
// The "Ezhalah is thinking…" beat. A typed send overlaps this with the real respond() round-trip
// and only waits out whatever time is left, so the first response lands within ~1–3s total.
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
  const { user, runQuery, gated, pendingMessage, setPendingMessage, recordChatTurn, trackOpen } = useApp();
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  // True once the user hit Stop mid-display: freezes the cards already shown and hides the "more
  // precise" CTA on the stopped results. Reset on every new turn. (user request.)
  const [stopped, setStopped] = useState(false);
  // Note #5 — Share sheet visibility in AI Agent mode. The button stays in the header throughout.
  const [shareOpen, setShareOpen] = useState(false);
  // True WHILE the property cards are popping in one-by-one — so the Send button shows as a Stop button
  // for the whole reveal (not just the network wait), letting the user halt the drip. (user request.)
  const [revealing, setRevealing] = useState(false);
  // Shows the guest sign-up popup ONCE per session (the existing authPrompt modal). (user request.)
  const signupShownRef = useRef(false);
  // Same pattern as the home screen: on mobile the sidebar isn't docked, so a hamburger opens it.
  // On desktop it's a permanent column → no button. (user: couldn't see the burger on the phone.)
  const docked = useDocked();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // After a GUEST's one free search has displayed, a sign-up popup appears (shown once per session).
  // Accept → /auth (the search is already in history and carries over on sign-in); decline → keep
  // reading, but no more searching until they sign up / log in. (user request.)
  const [authPrompt, setAuthPrompt] = useState(false);
  // Which result messages have finished typing their reply. The property cards stay hidden until the
  // words above them are fully written out, so listings never appear before Ezhalah has spoken (user
  // request). Keyed by message id.
  const [doneTyping, setDoneTyping] = useState<Record<string, boolean>>({});
  // After the reply finishes typing, the listing cards are revealed ONE AT A TIME, slowly, and the
  // page eases down to each new card as it pops in — so the user is carried below one listing at a
  // time instead of a whole grid landing at once. (user request.) revealCount[id] = how many cards
  // are visible so far; absent = show all (used for replayed/history turns that don't type out).
  const REVEAL_STEP_MS = 130; // snappy one-by-one cascade (25 cards ≈ 3s), smooth not distracting
  const [revealCount, setRevealCount] = useState<Record<string, number>>({});
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
  const startReveal = (id: string, n: number) => {
    setDoneTyping((d) => (d[id] ? d : { ...d, [id]: true }));
    pinModeRef.current = 'none'; // stop the bottom-follow so growing card list never yanks the view
    if (n <= 0) { revealActiveRef.current = null; setRevealing(false); return; }
    // Start with ZERO cards visible in the same render that reveals the text/sort line, so cards never
    // flash in before the text is complete.
    setRevealCount((c) => ({ ...c, [id]: 0 }));
    // Gentle one-time scroll: bring the response's top ~80px from the top of the viewport. Keeps the
    // slogan + summary + intro in view with the first cards just below — never the far bottom.
    const y = msgYRef.current[id];
    if (typeof y === 'number') {
      setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true }), 60);
    }
    // Reveal cards one-by-one after a short beat (lets the sort line be read first). No scroll per card.
    revealActiveRef.current = { id, count: n };
    setRevealing(true);
    let shown = 0;
    const tick = () => {
      shown += 1;
      setRevealCount((c) => ({ ...c, [id]: shown }));
      if (shown < n) {
        revealTimers.current.push(setTimeout(tick, REVEAL_STEP_MS));
      } else {
        revealActiveRef.current = null;
        setRevealing(false);
      }
    };
    revealTimers.current.push(setTimeout(tick, 40)); // start the cascade right away — no empty gap
  };
  const markTyped = (id: string) => {
    const msg = msgs.find((m) => m.id === id);
    startReveal(id, msg?.role === 'results' ? (msg.result?.listings?.length ?? 0) : 0);
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
  const pendingFilterRef = useRef<{ q: SearchQuery; sub: string } | null>(null);
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

  // Guests are no longer blocked after a search — they can keep searching freely within their
  // session/chat; only the saving differs (a guest's chats are never persisted, so they're gone on
  // leave). So this is intentionally a NO-OP: no sign-up wall interrupts a guest. (Re-enable a soft,
  // non-blocking "sign up to save your searches" nudge here later if wanted.) (user request.)
  const promptSignupSoon = async (_run: Run) => {
    // A guest just completed a search → softly invite them to sign up. Once per session, after a
    // beat so the cards land first; never for signed-in users. (user request: sign-up popup after search.)
    if (user || signupShownRef.current) return;
    signupShownRef.current = true;
    setTimeout(() => { if (!user) setAuthPrompt(true); }, 1400);
  };

  // The "about to scrape" intro: one random Saudi-dialect hype line, then a compact read-back of
  // exactly what we're going to search for — "Looking for:" + "Villa · Rent · Riyadh · SAR 5,000 ·
  // 3 beds". No price math, no prose, no judgement — just the parsed query echoed back so the user
  // can see we understood, right before "Ezhalah is searching…". (user request.)
  // The structured "Search Summary" of exactly what we parsed — now shown WITH the results (under the
  // professional header), NOT with the slogan. The slogan lives only in the transient searching status.
  const buildScrapeIntro = (q: SearchQuery) => searchSummary(q);

  // Shared "found" choreography: the typed reply ("answer respond") → a held "Ezhalah is searching…"
  // beat → the results header + cards. `statusId` is the thinking bubble we morph into the reply.
  const playListings = async (run: Run, statusId: string, summary: string, result: SearchResult, messageText?: string) => {
    // 1) SEARCHING phase: status bubble shows the slogan + summary. Slogan language follows the
    // user's MESSAGE text (English message → English slogan) instead of the UI locale, so users
    // who chat in one language and have their UI in the other still get the matching slogan.
    const slogan = hypePhrase(getLocale(), messageText);
    setMsgs((m) => m.map((x) => (x.id === statusId ? { id: statusId, role: 'status', phase: 'searching', slogan, summary } : x)));
    toBottom();
    // Hold the searching phase long enough for BOTH the slogan and the (typewriter) Search Summary to
    // finish typing, so the summary is fully written before it morphs into the results bubble. (user.)
    await waitRun(run, Math.max(1500, typeDuration(slogan), typeDuration(summary)));
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
  };

  const send = async (override?: string) => {
    const v = (override ?? typed).trim();
    if (!v || busy) return;
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
          const cards = (m.result?.listings ?? []).map((l, i) =>
            `#${i + 1}: ${l.type} ${l.deal === 'Rent' ? 'for rent' : 'for sale'} in ${l.district}, ${l.city} — ${l.price}` +
            `${l.area ? `, ${l.area} m²` : ''}${l.beds ? `, ${l.beds} bed` : ''}, on ${l.source}`,
          );
          const text = cards.length ? `${m.text}\n${cards.join('\n')}` : m.text;
          return { role, text };
        }
        return { role, text: (m as { text?: string }).text ?? '' };
      })
      .filter((h) => !!h.text.trim())
      .slice(-10);
    // Pass auth state: a guest searches on any property query; a logged-in user only gets listings
    // when their message is a direct order, otherwise Ezhalah replies conversationally. (user request.)
    const turn = await respond(v, { loggedIn: !!user, history });
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
      // A real search resolved — clear the anti-loop state so the next request starts fresh.
      askCountRef.current = 0;
      saidRef.current = [];
      const result = await runQuery(turn.query); // now async: fetches the matching subset server-side
      // About to scrape: a random Saudi hype line + a compact read-back of the parsed query, then the
      // "searching…" beat. Build the read-back from the RESOLVED query (result.query) so a corrected
      // location (typo → real city + Region → District) shows in the summary. (user request.)
      const reply = buildScrapeIntro(result.query ?? turn.query);
      await playListings(run, statusId, reply, result, v);
      if (run.cancelled) return;
      void promptSignupSoon(run); // a guest just used their one free search → prompt sign-up
    } else {
      // The model asked a clarifying question. Read back EVERYTHING said so far: if we can already see
      // a usable detail (a type, a city, a size, a budget) and we've asked twice, stop pestering and
      // just search with whatever we have. (user request: max 2 asks → skip → scrape.)
      const combined = parseQuery(saidRef.current.join(' '));
      const hasIntent = !!(combined.type || combined.location || combined.detail || combined.priceInput);
      if (hasIntent && askCountRef.current >= 2) {
        askCountRef.current = 0;
        saidRef.current = [];
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
    // Filter search: open at the top and let the request bubble type itself out (~5s). The
    // "searching…" beat and the typed response follow once the bubble finishes (onBubbleDone).
    pinModeRef.current = 'top';
    const { bubble, sub } = override ?? filterToChat(q);
    pendingFilterRef.current = { q, sub };
    setMsgs((m) => [...m, { id: uid(), role: 'user', text: bubble, typing: true }]);
    toTop();
  };

  // Request bubble finished typing → run the SAME beats a typed chat search gets: "Ezhalah is
  // thinking…" → the reply (the price-math note + "Here are villa…") types out → "Ezhalah is
  // searching…" → "Here is what I found:" + the cards. (user request — the filter flow used to skip
  // straight to the reply+cards; now it reads identically to the chat.)
  const onBubbleDone = () => {
    const pending = pendingFilterRef.current;
    if (!pending) return;
    pendingFilterRef.current = null;
    pinModeRef.current = 'none';
    const run = runRef.current ?? makeRun();
    runRef.current = run;
    const statusId = uid();
    setMsgs((m) => [...m, { id: statusId, role: 'status', phase: 'thinking' }]);
    toBottom();
    void (async () => {
      // Fetch the matching subset DURING the thinking beat — the network wait hides inside the pause
      // the user already sees, so the choreography timing is unchanged. (runQuery is now async.)
      const result = await runQuery(pending.q);
      if (run.cancelled) return;
      await waitRun(run, THINK_MS);
      if (run.cancelled) return;
      await playListings(run, statusId, buildScrapeIntro(result.query ?? pending.q), result);
      if (run.cancelled) return;
      setBusy(false);
      runRef.current = null;
      void promptSignupSoon(run); // guest used their free search (filter) → prompt sign-up
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
      { id: resultsId, role: 'status', phase: 'searching', summary: buildScrapeIntro(q) },
    ]);
    pinModeRef.current = 'top';
    toTop();
    const result = await runQuery(q, false); // viewing a saved chat — don't create a new history entry
    // Morph into the final results state — all cards at once, no typewriter (history view).
    setMsgs([
      { id: userId, role: 'user', text: bubble },
      { id: resultsId, role: 'results', text: sub, result },
    ]);
    setDoneTyping((d) => ({ ...d, [resultsId]: true }));
    setRevealCount((c) => ({ ...c, [resultsId]: result.listings.length }));
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
                // While searching, the slogan is rendered with the SAME sparkle-icon layout as in the
                // results phase. Earlier this block omitted the icon ("plain text only") which caused
                // a visible flicker on phase transition: the text was there during searching, then a
                // star "popped in" beside it when results arrived. Now the icon is present from the
                // first frame, so the transition is seamless — only the message below the slogan
                // changes. (user request: "they are displayed then the star pops up — fix it.")
                if (m.slogan) {
                  const sr = msgRTL(m.slogan);
                  return (
                    // Searching-phase slogan + summary: anchored to the RIGHT for Arabic (alignItems
                    // flex-end), exactly like the final results block, so it never jumps left/centre
                    // between the searching and results phases. (user request: Arabic assistant content
                    // always on the right.)
                    <View key={m.id} style={{ gap: 6, alignItems: sr ? 'flex-end' : 'flex-start', width: '100%' }}>
                      <View style={[s.reply, { flexDirection: 'row', alignItems: 'center' }]}>
                        {!sr && (
                          <View style={s.replyIcon}>
                            <Ionicons name="sparkles" size={14} color={colors.primary} />
                          </View>
                        )}
                        <Text style={[s.sloganText, { writingDirection: sr ? 'rtl' : 'ltr', textAlign: sr ? 'right' : 'left' }]}>{m.slogan}</Text>
                        {sr && (
                          <View style={s.replyIcon}>
                            <Ionicons name="sparkles" size={14} color={colors.primary} />
                          </View>
                        )}
                      </View>
                      {m.summary ? (
                        // The Search Summary TYPES OUT (typewriter) while Ezhalah is searching, then
                        // persists fully-typed into the results bubble below. The searching beat waits
                        // for it to finish (see playListings). (user request: "type it down, animation style".)
                        <Text style={[s.summaryText, { writingDirection: sr ? 'rtl' : 'ltr', textAlign: sr ? 'right' : 'left', alignSelf: 'stretch' }]}>
                          <Typer text={m.summary} />
                        </Text>
                      ) : null}
                    </View>
                  );
                }
                {
                  // "إزهله يفكر…" / "إزهله يبحث…" must sit on the FAR RIGHT for Arabic, exactly where
                  // every Ezhalah message appears — never centered, never left, never LTR. The outer
                  // View anchors the whole row to the right edge (alignItems flex-end); row-reverse
                  // puts the spinner on the right with the text flowing right-to-left to its left.
                  // English keeps the original left-anchored layout. (user request.)
                  const sr = locale === 'ar';
                  return (
                    <View key={m.id} style={{ width: '100%', alignItems: sr ? 'flex-end' : 'flex-start' }}>
                      <View style={[s.status, sr && { flexDirection: 'row-reverse', paddingLeft: 0, paddingRight: 2 }]}>
                        <Spinner />
                        <Text style={[s.statusText, { writingDirection: sr ? 'rtl' : 'ltr', textAlign: sr ? 'right' : 'left' }]}>
                          {m.phase === 'thinking' ? t('Ezhalah is thinking…') : t('Ezhalah is searching…')}
                        </Text>
                      </View>
                    </View>
                  );
                }
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
                  <View key={m.id} style={[s.reply, { alignSelf: rtl ? 'flex-end' : 'flex-start', maxWidth: '85%', direction: (rtl ? 'rtl' : 'ltr') as any }]}>
                    <View style={s.replyIcon}>
                      <Ionicons name="sparkles" size={14} color={colors.primary} />
                    </View>
                    <Text style={[s.replyText, m.greeting && s.greetingText, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left', flex: 1 }]}>
                      {m.typing ? <Typer text={txt} onDone={() => markTyped(m.id)} /> : txt}
                    </Text>
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
                  {/* 3) RESULT INTRO — plain text, no sparkle, no "Ezhalah!" prefix — professional and
                      neutral. Sits below the Search Summary. (user request.) */}
                  <Text style={[s.replyText, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left', marginTop: 6, alignSelf: 'stretch' }]}>
                    {m.typing ? <Typer text={m.text} onDone={() => markTyped(m.id)} /> : m.text}
                  </Text>
                  {/* Hold the property cards back until Ezhalah has finished writing the words above —
                      listings never appear before the reply types out (user request). */}
                  {m.typing && !doneTyping[m.id] ? null : m.result.listings.length === 0 ? (
                    // Prefer the SPECIFIC, actionable recommendation runSearch attached to the result
                    // ("No listings within that budget — want me to remove it?"). Falls back to the
                    // generic broaden line only when the diagnostic couldn't find a single relaxation
                    // that would unlock results. (user request: "give the user a recommendation
                    // like change something — put it like 'do you want me to?'".)
                    <Text style={[s.emptyRes, { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left', alignSelf: 'stretch' }]}>
                      {m.result.suggestion ?? t('No exact matches — try broadening your search.')}
                    </Text>
                  ) : (
                    <>
                      <Text style={[s.rankLine, { textAlign: rtl ? 'right' : 'left', alignSelf: 'stretch' }]}>{m.result.sortNote ?? t('Ranked by closest match.')}</Text>
                      {/* All result cards render AT ONCE — the per-card pop-in animation was removed
                          per user request ("remove that, not nice"). The cards just appear, no fade,
                          no scale, no stagger. Cards stay FULL-WIDTH via alignSelf:stretch even though
                          the parent clusters text to the right for Arabic. */}
                      <View style={{ gap: 12, marginTop: 12, alignSelf: 'stretch' }}>
                        {/* Live typed turn: default to 0 visible until startReveal begins the one-by-one
                            drip (prevents a full-grid flash if setDoneTyping flushes a render before
                            setRevealCount(0)). History/replay turns (not typing) show all immediately. */}
                        {m.result.listings.slice(0, revealCount[m.id] ?? (m.typing ? 0 : m.result.listings.length)).map((l, i) => (
                          <ResultCard
                            key={l.id}
                            listing={l}
                            variant="compact"
                            rank={i + 1}
                            onOpen={() => { trackOpen(l); void openListing(l); }}
                          />
                        ))}
                      </View>
                      {/* The "I can get you something more precise." refine CTA was removed here per user
                          request — no message sits below the result cards now. */}
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
            <View style={[s.composer, { flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }]}>
              <TextInput
                style={[s.input, { textAlign: locale === 'ar' ? 'right' : 'left' }]}
                placeholder={t("Type what you're looking for...")}
                placeholderTextColor={colors.muted}
                value={typed}
                onChangeText={(v) => setTyped(v)}
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

      {/* Sign-up wall: shown once, just after a guest's free search reveals. Accept → /auth (the
          search is already saved and carries over on sign-in); decline → keep reading, no more
          searching until they sign up / log in. (user request.) */}
      {authPrompt && (
        <View style={s.promptOverlay}>
          <Pressable style={s.promptBackdrop} onPress={() => setAuthPrompt(false)} />
          <View style={s.promptCard}>
            <View style={s.promptIcon}>
              <RNImage source={LOGO} style={s.promptLogo} resizeMode="cover" />
            </View>
            <Text style={s.promptTitle}>{t('Get more with a free account')}</Text>
            <Text style={s.promptBody}>
              {t('Sign up free to save your searches and favorites, and pick up right where you left off.')}
            </Text>
            <Pressable style={s.promptPrimary} onPress={() => { setAuthPrompt(false); router.push('/auth'); }}>
              <Ionicons name="person-outline" size={16} color="#fff" />
              <Text style={s.promptPrimaryTx}>{t('Sign up / Log in')}</Text>
            </Pressable>
            <Pressable style={s.promptSecondary} onPress={() => setAuthPrompt(false)}>
              <Text style={s.promptSecondaryTx}>{t('Not now')}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.screenSide, paddingBottom: 8 },
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
  col: { width: '100%', maxWidth: MAX_W, gap: 8, direction: 'ltr' as any },

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
  composer: { alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: 18, paddingVertical: 5, paddingHorizontal: 8, ...cardShadow },
  input: { flex: 1, fontSize: 14, color: colors.ink, paddingVertical: 6, paddingHorizontal: 4, maxHeight: 110, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  sendBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  stopBtn: { width: 28, height: 28, borderRadius: 9, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' },
  disc: { fontSize: 10.8, lineHeight: 16, color: colors.muted, textAlign: 'center', marginTop: 8, paddingHorizontal: 8 },
});
