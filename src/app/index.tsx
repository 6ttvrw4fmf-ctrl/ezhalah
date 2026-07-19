import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated as RNAnimated, Easing as RNEasing, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, space, cardShadow } from '@/theme/tokens';
import { RANGE_ICON, categoryImg, groupImg, typeImg, BED_IMG, DEAL_IMG, PERIOD_IMG, LOC_IMG } from '@/theme/propertyIcons';
import HeroBackground from '@/components/HeroBackground';
import { Segmented, OptionBox, FieldLabel, Tappable, Heartbeat, Reveal } from '@/components/ui';
import Sidebar, { useDocked } from '@/components/Sidebar';
import ShareSheet from '@/components/ShareSheet';
import { CATEGORIES, DEALS, detailFor, detailForContext, priceTabsFor, type Category } from '@/data/taxonomy';
import { groupsFor, groupMembers, type Macro } from '@/data/propertyTypes';
import { ensureLocationIndex, ensureCityFieldIndex, topCitiesByListings, matchCitiesByText, hasNameCollision, resolveCitySelection, type CityOption, ensureDistrictOptions, topDistrictsForCityId, matchDistrictsByCityId, type DistrictOption } from '@/data/locations';
import { grouped, type SearchQuery } from '@/data/search';
import { HOME_DEFAULT_QUERY, hasActiveFilters } from '@/lib/searchDefaults';
import { toWholeNumberDigits, wholeNumberKeyDecision } from '@/lib/inputHygiene';
import { noTranslateRef } from '@/noTranslate';
import { useApp } from '@/store';
import { shareNative } from '@/lib/share';
import { useI18n, tDetailOption, tPriceTab, isLatinOnlyInput, ARABIC_ONLY_MSG, CITY_REQUIRED_MSG } from '@/i18n';
import { iconForPrompt, useExamplePrompts } from '@/data/examplePrompts';

const MAX_W = 560; // desktop-web: keep the mobile-first column centered

// The 6 "Start here" chips ROTATE per mount — drawn from the shared examplePrompts library so the
// home grid and the AI Agent's empty-state grid stay in lockstep. A returning user sees a fresh
// random subset every visit / refresh / sidebar dismissal. Sampled inside the component via useMemo
// keyed on locale (Arabic UI → Arabic pool, English UI → English pool — never mixed). (user request:
// "always refresh whenever a user leaves or joins — same for Ezhalah AI Agent — create a rotation.")

const AnimatedPressable = RNAnimated.createAnimatedComponent(Pressable);

// react-native-web does NOT support `direction` as a style property (it throws "Invalid style
// property of 'direction'"). To pin a row to a physical orientation regardless of the page's RTL,
// set the DOM `dir` attribute directly via a callback ref. `setLtr` forces left-to-right so the
// top bar's menu button always sits on the physical LEFT (it must NOT mirror under Arabic).
const setLtr = (node: any) => {
  if (Platform.OS === 'web' && node?.setAttribute) node.setAttribute('dir', 'ltr');
};
// Keep the AgentBadge's own internal icon/text arrangement following the app locale even though
// its parent row is forced LTR — pass the locale's direction back onto the badge element.
const makeDirRef = (dir: 'ltr' | 'rtl') => (node: any) => {
  if (Platform.OS === 'web' && node?.setAttribute) node.setAttribute('dir', dir);
};

// The "Ezhalah AI Agent" badge — the hero call-to-action in the top bar. It gently breathes: the
// tinted fill + border drift between two greens on a loop, and the sparkles twinkle (fade + scale)
// so the eye is drawn to it. Driven by React Native's Animated.loop, which loops reliably on web
// (reanimated's infinite withRepeat does not).
function AgentBadge({ onPress, t, isRTL }: { onPress: () => void; t: (s: string) => string; isRTL: boolean }) {
  const pulse = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    const half = (toValue: number) =>
      RNAnimated.timing(pulse, { toValue, duration: 1300, easing: RNEasing.inOut(RNEasing.quad), useNativeDriver: false });
    const loop = RNAnimated.loop(RNAnimated.sequence([half(1), half(0)]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const bg = pulse.interpolate({ inputRange: [0, 1], outputRange: ['#e8f6ee', '#d3efdf'] });
  const border = pulse.interpolate({ inputRange: [0, 1], outputRange: ['#cfe8d6', '#9fd4b3'] });
  const starOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
  const starScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.18] });
  return (
    <AnimatedPressable ref={makeDirRef(isRTL ? 'rtl' : 'ltr')} style={[s.agentMini, { backgroundColor: bg, borderColor: border }]} onPress={onPress}>
      <RNAnimated.View style={{ opacity: starOpacity, transform: [{ scale: starScale }] }}>
        <Ionicons name="sparkles" size={20} color={colors.primary} />
      </RNAnimated.View>
      <View style={s.agentMiniTx}>
        <Text ref={noTranslateRef} style={s.agentMiniT}>{t('Ezhalah AI Agent')}</Text>
        <Text style={s.agentMiniS}>{t("Tell me what you want and I'll find it")}</Text>
      </View>
    </AnimatedPressable>
  );
}

// Small NON-BLOCKING helper note shown under the Price / Area range inputs. It only explains a
// confusing entry (min>max, min==max, 0 = no limit, one-sided range). Pure UI hint — it never blocks
// the search, never changes the user's numbers, and doesn't touch the filter logic. Arabic, per owner
// (2026-07-06). warn=true → attention styling. Applies to Price and Area identically.
type RangeHintCfg = {
  warnHiLo: string; none: string; zeroMin: string; zeroMax: string;
  near: (x: string) => string; minOnly: (x: string) => string; maxOnly: (x: string) => string;
};
function rangeHint(
  minStr: string | null | undefined, maxStr: string | null | undefined,
  cfg: RangeHintCfg, fmt: (n: number) => string,
): { text: string; warn: boolean } | null {
  const has = (v: unknown) => v !== null && v !== undefined && String(v) !== '';
  const minP = has(minStr), maxP = has(maxStr);
  if (!minP && !maxP) return null;
  const minV = minP ? (parseInt(String(minStr), 10) || 0) : null;
  const maxV = maxP ? (parseInt(String(maxStr), 10) || 0) : null;
  const minPos = minV !== null && minV > 0, maxPos = maxV !== null && maxV > 0;
  if (minPos && maxPos && (minV as number) > (maxV as number)) return { text: cfg.warnHiLo, warn: true };
  if (minPos && maxPos && minV === maxV) return { text: cfg.near(fmt(minV as number)), warn: false };
  if (minV === 0 && maxV === 0) return { text: cfg.none, warn: false };
  if (minPos && !maxPos) return { text: cfg.minOnly(fmt(minV as number)), warn: false };  // max empty or 0
  if (maxPos && !minPos) return { text: cfg.maxOnly(fmt(maxV as number)), warn: false };  // min empty or 0
  if (minV === 0 && !maxP) return { text: cfg.zeroMin, warn: false };
  if (maxV === 0 && !minP) return { text: cfg.zeroMax, warn: false };
  return null;
}
const PRICE_HINT: RangeHintCfg = {
  warnHiLo: 'تنبيه: الحد الأدنى أعلى من الحد الأعلى. راجع السعرين قبل البحث.',
  none: 'سيتم البحث بدون تحديد سعر.',
  zeroMin: '0 يعني بدون حد أدنى للسعر.',
  zeroMax: '0 يعني بدون حد أعلى للسعر.',
  near: (x) => `سيتم البحث عن العقارات بسعر ${x} ريال بالضبط.`,   // min == max → EXACT match (backend uses inclusive bounds v>=X && v<=X)
  minOnly: (x) => `سيتم البحث عن عقارات بسعر ${x} ر.س أو أعلى.`,
  maxOnly: (x) => `سيتم البحث عن عقارات بسعر ${x} ر.س أو أقل.`,
};
const AREA_HINT: RangeHintCfg = {
  warnHiLo: 'تنبيه: الحد الأدنى للمساحة أعلى من الحد الأعلى. راجع المساحتين قبل البحث.',
  none: 'سيتم البحث بدون تحديد مساحة.',
  zeroMin: '0 يعني بدون حد أدنى للمساحة.',
  zeroMax: '0 يعني بدون حد أعلى للمساحة.',
  near: (x) => `سيتم البحث عن العقارات بمساحة ${x} م² بالضبط.`,   // min == max → EXACT match (backend uses inclusive bounds v>=X && v<=X)
  minOnly: (x) => `سيتم البحث عن عقارات بمساحة ${x} م² أو أكبر.`,
  maxOnly: (x) => `سيتم البحث عن عقارات بمساحة ${x} م² أو أقل.`,
};

// HOME_DEFAULT_QUERY / hasActiveFilters moved to src/lib/searchDefaults.ts (zero-dependency, so a
// plain Node test can execute them — imported above).

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, locale, isRTL } = useI18n();
  // Fresh random 6 examples per mount, biased toward real DB inventory (~70%) + curated variety.
  // Renamed to `promptChips` to avoid colliding with the location-suggestions state below.
  const promptLabels = useExamplePrompts(locale === 'ar' ? 'ar' : 'en', 6);
  const promptChips = useMemo(
    () => promptLabels.map((label) => ({
      label,
      seed: label,
      icon: iconForPrompt(label) as keyof typeof Ionicons.glyphMap,
    })),
    [promptLabels],
  );
  const { query, setQuery, gated, user } = useApp();
  const docked = useDocked(); // website: sidebar is a permanent column, so hide the menu button
  // CITY-ONLY FIELD (owner spec 2026-07-17): citySuggestions holds either the Top-6-by-listings
  // (focus, empty text) or the Arabic-matched typed results — never a mix, and never a
  // region/district/landmark, per spec. citySelected is the ONLY thing that makes a search valid;
  // it is cleared on every keystroke (see onChangeText below) so a stale prior pick can never be
  // silently reused once the user starts editing the text again — "the user must select a valid
  // city result... never guess."
  const [citySuggestions, setCitySuggestions] = useState<CityOption[]>([]);
  const [citySelected, setCitySelected] = useState<CityOption | null>(null);
  const [cityFocus, setCityFocus] = useState(false);
  const [locMsg, setLocMsg] = useState(''); // Arabic-only: shown when the user types the city in English
  // District: strictly under City, disabled until a city is chosen, scoped to citySelected.cityId.
  // districtSelected is the source of truth passed to search (its matchValues → p_districts); it is
  // cleared on every city change/keystroke so a stale cross-city district can never leak.
  const [districtText, setDistrictText] = useState('');
  const [districtSuggestions, setDistrictSuggestions] = useState<DistrictOption[]>([]);
  const [districtSelected, setDistrictSelected] = useState<DistrictOption | null>(null);
  const [districtFocus, setDistrictFocus] = useState(false);
  const districtRef = useRef<TextInput>(null);
  const districtTextRef = useRef('');
  // One place to wipe all district state — called wherever the city changes/clears.
  const clearDistrict = () => {
    districtTextRef.current = '';
    setDistrictText('');
    setDistrictSelected(null);
    setDistrictSuggestions([]);
    setDistrictFocus(false);
  };
  const cityRef = useRef<TextInput>(null);
  // Mirrors query.location synchronously (state updates are async/batched) so the Top-6-on-focus
  // promise callback above can check the TRUE current text at resolution time, not a stale closure.
  const cityTextRef = useRef('');
  // Refs so the ENTIRE Price/Area/Size box is one tap target (owner 2026-07-10): tapping anywhere in
  // the box — icon, label, padding, unit text — focuses the input immediately, same pattern already
  // used for the city field above (`cityRef` + its wrapping Pressable).
  const areaMinRef = useRef<TextInput>(null);
  const areaMaxRef = useRef<TextInput>(null);
  const priceMinRef = useRef<TextInput>(null);
  const priceMaxRef = useRef<TextInput>(null);
  const sizeBoxRef = useRef<TextInput>(null);
  // Web-only keydown guard for the whole-number price/area/size boxes. toWholeNumberDigits() already
  // truncates a decimal that arrives in one shot (paste, or a full value), but char-by-char typing on
  // a web hardware keyboard can still produce "5005" (the controlled field drops the typed ".", then
  // the next digit appends). This guard blocks the separator + swallows the fractional tail per field.
  // Per-field lock; reset on focus / selection-change / any real edit so delete/select/retype stay
  // normal. No-op on iOS/Android (number-pad has no decimal key). Backend/search untouched.
  const fracLock = useRef<Record<string, boolean>>({});
  const wholeNumberKeyGuard = useCallback((field: string) => (e: any) => {
    if (Platform.OS !== 'web') return;
    const decision = wholeNumberKeyDecision(e?.nativeEvent?.key ?? '', !!fracLock.current[field]);
    fracLock.current[field] = decision.fracLocked;
    if (decision.block) e.preventDefault?.();
  }, []);
  const clearFracLock = useCallback((field: string) => { fracLock.current[field] = false; }, []);
  // The wrapping Pressable makes the whole price/area/size box tappable, but tapping directly on the
  // nested TextInput already gives it native focus — the Pressable's onPress then fires too and used to
  // call .focus() again on an already-focused node. On iOS Safari the on-screen keyboard's show/hide
  // animation is tied to the focus-event timeline, so a redundant focus() call right after the real one
  // can race that animation. Skipping the call when the target is already focused removes that race
  // without changing behavior for the common case (tapping the padding/icon/label outside the input).
  const focusIfNotAlready = useCallback((ref: { current: TextInput | null }) => {
    if (Platform.OS === 'web' && typeof document !== 'undefined' && document.activeElement === (ref.current as unknown as Element)) return;
    ref.current?.focus();
  }, []);
  // iOS Safari numeric-input bug (2026-07-10): none of these 5 boxes forced a text direction, so
  // react-native-web emitted <input dir="auto">. The whole app forces document.documentElement.dir =
  // "rtl" (Arabic is the default locale — see i18n.tsx applyDirection()), so an EMPTY numeric field sat
  // in an ambiguous bidi state: digits are a "weak" bidi type, and inserting one into an RTL-anchored,
  // dir="auto" text node is a documented WebKit-specific caret/rendering defect (confirmed NOT
  // reproducible in Chromium — the bidi/caret implementations diverge — matching the iOS-only report).
  // Like setLtr/makeDirRef above, react-native-web does not support `direction` as a style property (it
  // throws), so the DOM `dir` attribute is set directly via a callback ref that ALSO keeps populating the
  // existing ref object these 5 boxes already use for `.focus()` elsewhere in this file.
  const mergeLtrRef = useCallback((ref: { current: TextInput | null }) => (node: any) => {
    ref.current = node;
    if (Platform.OS === 'web' && node?.setAttribute) node.setAttribute('dir', 'ltr');
  }, []);
  // Auto-advance the form: as the user fills each step (deal, location, category, type, detail,
  // price), gently scroll DOWN so the just-revealed section and the Search button come into view —
  // they never have to scroll the page themselves. (user request.)
  const scrollRef = useRef<ScrollView>(null);
  const endAnchorRef = useRef<View>(null);
  // Step anchors — picking a step smoothly reveals the NEXT one, and we scroll to THAT section (its top),
  // never to the bottom of the page. (user: "guide to the next relevant step only, don't jump to the end.")
  const catAnchorRef = useRef<View>(null);
  const groupAnchorRef = useRef<View>(null);
  const typeAnchorRef = useRef<View>(null);
  const refineAnchorRef = useRef<View>(null);
  // How much of the PREVIOUS section stays visible above the newly-revealed one — the same amount on
  // every step, both platforms, so the motion always reads as "slide over a bit" rather than a jump
  // to a fresh screen. (owner 2026-07-10: "keep part of the previous section visible... every filter
  // step, not just one.") Applied via `withAnchor` below (web: CSS scroll-margin-top) and directly in
  // scrollDown (native: measureLayout offset) — same number, same feel, on both.
  const SCROLL_REVEAL_OFFSET = 96;
  const scrollDown = (target?: { current: View | null }) => {
    // Defer past the state-driven re-render so the newly revealed section is laid out first.
    setTimeout(() => {
      const sv = scrollRef.current;
      const node: any = target?.current ?? endAnchorRef.current;
      if (!node) { sv?.scrollToEnd({ animated: true }); return; }
      if (Platform.OS === 'web') {
        // scroll-margin-top (set on every anchor by withAnchor) makes 'start' land OFFSET px below the
        // node's top instead of flush against the viewport edge — the previous section stays visible.
        node.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      } else if (sv) {
        node.measureLayout(
          sv as any,
          (_x: number, y: number) => sv.scrollTo({ y: Math.max(0, y - SCROLL_REVEAL_OFFSET), animated: true }),
          () => sv.scrollToEnd({ animated: true }),
        );
      }
    }, 90);
  };
  // Attaches a ref AND (web-only) sets scroll-margin-top, so every anchor gets the same gentle offset
  // with zero extra plumbing at each call site — same pattern already used for setLtr/makeDirRef above.
  const withAnchor = (ref: React.MutableRefObject<View | null>) => (node: any) => {
    ref.current = node;
    if (Platform.OS === 'web' && node?.style) node.style.scrollMarginTop = `${SCROLL_REVEAL_OFFSET}px`;
  };
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Filter search funnels into the Ezhalah chat with listings inline (prototype parity — there is
  // no separate results page). The agent reads ?filter=… and runs it once on open. Pressing Search
  // first LIGHTENS the sketch backdrop (a deliberate "here we go" beat), then opens the results once
  // that lift has played.
  // Warm the live district index when the home opens, so a typed district that exists in real
  // inventory (e.g. "Al Doha Dist." in Yanbu) is recognized by the time the user searches.
  useEffect(() => { void ensureLocationIndex(); }, []);
  // Warm the city-listing-counts index on mount so the Top-6 list is ready the instant the field is
  // focused, rather than showing an empty list for the first render of a slow connection.
  useEffect(() => {
    void ensureCityFieldIndex().then(() => {
      // EDGE CASE (found in testing): on a slow connection, this fetch can still be pending when
      // the user has already focused AND typed a query — matchCitiesByText() would have run against
      // a still-empty pool and (correctly, not a crash) returned []. Without this, the dropdown would
      // stay empty forever even after the data arrives, since nothing else re-triggers the match once
      // typing has already happened. Re-run it now against whatever text is currently live.
      if (cityTextRef.current) {
        const latin = isLatinOnlyInput(cityTextRef.current);
        setCitySuggestions(latin ? [] : matchCitiesByText(cityTextRef.current));
      }
    });
  }, []);

  const onSearch = async () => {
    // CITY-ONLY FIELD (owner spec 2026-07-17): "The user must select a valid city result. Do not
    // accept arbitrary free text and never guess a location." citySelected is cleared on every
    // keystroke (see the TextInput's onChangeText below), so its presence here means exactly one
    // thing: the CURRENT field text is an untouched, tapped-from-the-list city. Anything else
    // (empty field, hand-typed text never confirmed by a tap, a stale pick since edited) blocks the
    // search with an explanation instead of falling through to any free-text resolution — there is
    // no resolveLocation()/guessing path in this field anymore.
    if (!citySelected) { setLocMsg(CITY_REQUIRED_MSG); return; }
    const lm = resolveCitySelection(citySelected);
    // District is optional. When chosen, send ALL spellings of the (hamza-folded) district so search
    // recall is complete; when not, districts:undefined → city-only search (spec: City-only is valid).
    const q = { ...query, location: lm.label, locationMatch: lm, districts: districtSelected ? districtSelected.matchValues : undefined };
    RNAnimated.timing(heroAnim, {
      toValue: 1,
      duration: 300,
      easing: RNEasing.out(RNEasing.cubic),
      useNativeDriver: true,
    }).start(() => {
      if (gated) {
        router.push('/auth');
        return;
      }
      router.push({ pathname: '/agent', params: { filter: JSON.stringify(q) } });
    });
  };

  // Note #3 — try the OS share sheet FIRST when it exists (native device share is the most natural
  // option) and fall back to the in-app multi-target sheet. On desktop the OS sheet is usually
  // unavailable, so the in-app sheet (WhatsApp / X / Telegram / Mail / Copy Link, fully localized)
  // is what users see. (user request.)
  const onShare = async () => {
    const shared = await shareNative();
    if (!shared) setShareOpen(true);
  };

  const onChip = (seed: string) => {
    if (gated) {
      router.push('/auth');
      return;
    }
    router.push({ pathname: '/agent', params: { seed } });
  };

  const detail = query.type ? detailFor(query.type) : null;
  // Context-level detail: shown at category/group level when no specific type is selected.
  const ctx = !query.type ? detailForContext(query.category, query.typeGroup ?? null) : null;
  // A غرفة (Room) is a single room → bedrooms are locked to exactly 1. When Room is the SOLE selected
  // type the bedroom chips collapse to just "1" (and the strict beds filter → bedrooms=1). (owner 2026-07-06.)
  const roomOnly = query.types?.length === 1 && query.types[0] === 'Room';
  // Whatever the user chose (a size band) or typed (a custom number) is mirrored INTO the size box so
  // they can see it and tap in to edit it. A band shows its label minus the trailing unit (the box
  // renders "m²" on the side); a custom number shows as-is.
  const sizeIsBand = !!detail && !detail.isBedrooms && !!query.detail && detail.options.includes(query.detail);
  // Context-level size box value: shown in the area input when no type is selected. Reads its OWN
  // field (contextSize) so a small area like "3" displays — it's never read as a bedroom count.
  const contextSizeValue = query.contextSize ? grouped(parseInt(query.contextSize, 10) || 0) : '';
  // Area/Price range box display values (comma-grouped). Empty string when unset.
  const areaMinValue = query.areaMin ? grouped(parseInt(query.areaMin, 10) || 0) : '';
  const areaMaxValue = query.areaMax ? grouped(parseInt(query.areaMax, 10) || 0) : '';
  const priceMinValue = query.priceMin ? grouped(parseInt(query.priceMin, 10) || 0) : '';
  const priceMaxValue = query.priceMax ? grouped(parseInt(query.priceMax, 10) || 0) : '';
  // Non-blocking helper notes under the Price / Area inputs (explain min>max, equal, 0=no-limit, one-sided).
  const priceHint = rangeHint(query.priceMin, query.priceMax, PRICE_HINT, grouped);
  const areaHint = rangeHint(query.areaMin, query.areaMax, AREA_HINT, grouped);
  const sizeBoxValue = !detail || detail.isBedrooms || !query.detail
    ? ''
    : sizeIsBand
      ? tDetailOption(query.detail!).replace(/\s*(m²|م²)\s*$/u, '').trim()
      : grouped(parseInt(query.detail!, 10) || 0); // free-typed number → comma-grouped
  // RENT lets the user pick the period (Monthly / Yearly) via a tiny toggle; the engine handles each.
  const rentPeriod: 'monthly' | 'annual' = query.rentPeriod ?? 'annual';
  const cityUp = cityFocus || query.location.length > 0;

  // Backdrop holds at its idle level (a touch stronger on web, per request) the whole time the user
  // fills in the form — typing or focusing a field no longer touches it. It only LIGHTENS when Search
  // is pressed (see onSearch). Returning to Home resets it back to idle so it's dark again next time.
  const heroAnim = useRef(new RNAnimated.Value(0)).current;
  // Entrance: every time the filter gains focus (incl. coming from the agent), the whole search column
  // fades up + scales in so it "pops" into place instead of the flat side-slide of a page open. (user request.)
  const entrance = useRef(new RNAnimated.Value(0)).current;
  // The AI-agent badge, the hero TITLE and the SUBTITLE each rise + fade in, staggered one after the
  // other, every time Home gains focus — so on a refresh or coming back they re-introduce themselves
  // with a cool layered reveal instead of just being there. (user request.)
  const badgeAnim = useRef(new RNAnimated.Value(0)).current;
  const titleAnim = useRef(new RNAnimated.Value(0)).current;
  const subAnim = useRef(new RNAnimated.Value(0)).current;
  // Read the optional `fresh` param that New Chat sends — every change of it should REPLAY the
  // hero entrance, even when we're already on Home (so a docked New Chat tap visibly "refreshes"
  // the screen). (user request: New Chat should feel like a refresh.)
  const { fresh } = useLocalSearchParams<{ fresh?: string }>();
  const playEntrance = useCallback(() => {
    heroAnim.setValue(0);
    entrance.setValue(0);
    badgeAnim.setValue(0);
    titleAnim.setValue(0);
    subAnim.setValue(0);
    RNAnimated.timing(entrance, {
      toValue: 1,
      duration: 440,
      easing: RNEasing.out(RNEasing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
    const rise = (v: RNAnimated.Value, delay: number) =>
      RNAnimated.timing(v, { toValue: 1, duration: 520, delay, easing: RNEasing.out(RNEasing.cubic), useNativeDriver: Platform.OS !== 'web' });
    RNAnimated.parallel([rise(badgeAnim, 80), rise(titleAnim, 230), rise(subAnim, 400)]).start();
  }, [heroAnim, entrance, badgeAnim, titleAnim, subAnim]);
  useFocusEffect(playEntrance);
  useEffect(() => { if (fresh) playEntrance(); }, [fresh, playEntrance]);
  // fade + lift; the title lifts a touch further for emphasis.
  const reveal = (v: RNAnimated.Value, lift = 16) => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [lift, 0] }) }],
  });
  const entranceStyle = {
    opacity: entrance,
    transform: [
      { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
      { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.965, 1] }) },
    ],
  };
  const heroOpacity = heroAnim.interpolate({
    inputRange: [0, 1],
    // idle → searching. Web idles a bit darker; both lighten to the same soft level on Search.
    outputRange: [Platform.OS === 'web' ? 0.92 : 0.82, 0.3],
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      {/* Hand-drawn Saudi landmarks sketch — soft full-bleed backdrop. On phones it shows in full
          ('contain'); on wide web it fills ('cover'). It dims when idle and lightens while searching. */}
      <HeroBackground
        imageOpacity={heroOpacity}
        resizeMode={Platform.OS === 'web' ? 'cover' : 'contain'}
        fadeStart={0.8}
        fadeEnd={1}
      />

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, zIndex: 1 }}
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
      >
        <RNAnimated.View style={[s.col, entranceStyle]}>
          {/* Top bar is pinned LTR (see s.top) so the menu always sits on the physical LEFT — it does
              NOT mirror to the right under Arabic. Matches the docked side menu, which is left in both
              languages per product decision. */}
          {/* Note #4 — on mobile the top bar is just HAMBURGER + BRAND (left side) and SHARE (right
              side). The AI badge / sparkles / "Ezhalah AI Agent" pill is REMOVED on mobile. The bar
              is still LTR-pinned so its physical layout matches the docked sidebar in both languages
              (Arabic users still read brand-first naturally because Arabic reads right-to-left). The
              hamburger opens the existing Sidebar drawer (no new drawer). Desktop is unchanged.
              (user request.) */}
          <View ref={setLtr} style={s.top}>
            {!docked ? (
              <View style={s.topLeft}>
                <Pressable style={s.hamb} hitSlop={8} onPress={() => setSidebarOpen(true)}>
                  <Ionicons name="menu" size={22} color={colors.ink} />
                </Pressable>
                <Text ref={noTranslateRef} style={s.topBrand}>{t('Ezhalah')}</Text>
              </View>
            ) : null}
            <View style={s.topRight}>
              {/* The "Ezhalah AI Agent" badge now shows on MOBILE too (not just docked/desktop) so the
                  AI agent is visible everywhere — parity with the website. (user request 2026-06-22.) */}
              <RNAnimated.View style={reveal(badgeAnim, 10)}>
                <AgentBadge onPress={() => router.push('/agent')} t={t} isRTL={isRTL} />
              </RNAnimated.View>
              <Pressable style={s.shareBtn} hitSlop={8} onPress={onShare}>
                <Ionicons name="share-social-outline" size={21} color={colors.ink} />
              </Pressable>
            </View>
          </View>

          {/* Hero — title then subtitle rise in, staggered (user request). */}
          <View style={s.hero}>
            <RNAnimated.Text style={[s.heroTitle, reveal(titleAnim, 20)]}>{t('Looking for a property and want to see all available listings in one place? Ezhalah.')}</RNAnimated.Text>
            <RNAnimated.Text style={[s.heroSub, reveal(subAnim, 14)]}>{t('Ezhalah An AI-powered platform that searches real estate listings across Saudi Arabia.')}</RNAnimated.Text>
            {/* Note #1 — tagline below the description. */}
            <RNAnimated.Text style={[s.heroTagline, reveal(subAnim, 10)]}>{t('Ezhalah, and may your luck be good.')}</RNAnimated.Text>
          </View>

          {/* Search card */}
          <View style={s.card}>
            {hasActiveFilters(query) && (
              <Reveal>
                <Pressable
                  style={s.clearAllBtn}
                  hitSlop={8}
                  onPress={() => {
                    setQuery(() => HOME_DEFAULT_QUERY());
                    cityTextRef.current = '';
                    setCitySuggestions([]);
                    setCitySelected(null);
                    setLocMsg('');
                    setCityFocus(false);
                    clearDistrict();
                    // The collapsing Property-type/Refine sections can leave the user stranded mid-page —
                    // scroll back to the top so the reset filter form is what they actually see.
                    scrollRef.current?.scrollTo({ y: 0, animated: true });
                  }}
                >
                  <Ionicons name="refresh-outline" size={14} color={colors.muted} />
                  <Text style={s.clearAllText}>{t('Clear all')}</Text>
                </Pressable>
              </Reveal>
            )}
            <Segmented options={DEALS} value={query.deal} icons={DEAL_IMG} onChange={(v) => { setQuery((q) => ({ ...q, deal: v as any, priceBand: null, priceMin: null, priceMax: null, priceInput: '' })); scrollDown(catAnchorRef); }} />

            {/* Location (floating label). The whole box is a tap target — tapping anywhere inside
                (icon, label, padding) focuses the input so the user can type a city OR a neighborhood
                from anywhere in the box, not just on the thin text line. */}
            {/* CITY-ONLY FIELD (owner spec 2026-07-17): "أي مدينة؟" replaces the old combined
                city-or-neighborhood field. District is explicitly out of scope for this pass — this
                field now searches and displays CITIES ONLY, never regions/districts/landmarks/areas. */}
            <Pressable style={[s.field, { marginTop: 12 }]} onPress={() => cityRef.current?.focus()}>
              <Ionicons name="location-outline" size={18} color={colors.muted} />
              <View style={s.flWrap}>
                <Text style={[s.flLabel, cityUp && s.flLabelUp]}>{t('Which city?')}</Text>
                <TextInput
                  ref={cityRef}
                  style={[s.flInput, cityUp && s.flInputUp]}
                  value={query.location}
                  autoCorrect={false}
                  onFocus={() => {
                    setCityFocus(true);
                    // Focus with no text yet → immediately show the Top 6 (spec: "When the user
                    // clicks the City field without typing, immediately show only the Top 6 cities").
                    // GUARD (real race found in testing): ensureCityFieldIndex() resolves via a
                    // microtask even when its data is already cached from the mount-time warm-up, so
                    // a keystroke typed right after focus can run its synchronous onChangeText BEFORE
                    // this .then() callback fires — if the callback then blindly overwrote
                    // citySuggestions with the Top 6, it would silently clobber the just-typed
                    // filtered results with stale ones. Re-check the LIVE text via cityTextRef (kept
                    // in sync on every keystroke below) at resolution time, not the value captured in
                    // this closure at focus time.
                    if (!query.location) {
                      void ensureCityFieldIndex().then(() => {
                        if (!cityTextRef.current) setCitySuggestions(topCitiesByListings(6));
                      });
                    }
                  }}
                  onBlur={() => setTimeout(() => setCityFocus(false), 150)}
                  onChangeText={(v) => {
                    cityTextRef.current = v;
                    setQuery((q) => ({ ...q, location: v }));
                    // Any edit invalidates a prior tap — a stale selection must never be silently
                    // reused (spec: "never guess a location").
                    setCitySelected(null);
                    clearDistrict(); // editing the city disables + clears District (no cross-city carry-over)
                    if (!v) {
                      // Cleared back to empty → the Top 6 list, same as a fresh focus.
                      setCitySuggestions(topCitiesByListings(6));
                      setLocMsg('');
                      return;
                    }
                    // Arabic-only product: English typing gets NO autocomplete and an Arabic hint —
                    // there is nothing to match against, since every city name here is Arabic. (user rule)
                    const latin = isLatinOnlyInput(v);
                    setCitySuggestions(latin ? [] : matchCitiesByText(v));
                    setLocMsg(latin ? ARABIC_ONLY_MSG : '');
                  }}
                />
              </View>
              {query.location.length > 0 && (
                <Pressable onPress={() => { cityTextRef.current = ''; setQuery((q) => ({ ...q, location: '' })); setCitySelected(null); clearDistrict(); setCitySuggestions(topCitiesByListings(6)); setLocMsg(''); cityRef.current?.focus(); }} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.muted} />
                </Pressable>
              )}
            </Pressable>

            {locMsg ? (
              <Text style={{ color: '#c0392b', fontSize: 13, marginTop: 6, textAlign: 'right' }}>{locMsg}</Text>
            ) : null}

            {cityFocus && citySuggestions.length > 0 && (
              <ScrollView style={s.suggBox} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {citySuggestions.map((opt, i) => (
                  <Tappable
                    key={opt.cityId}
                    dip={0.03}
                    style={[s.suggRow, i < citySuggestions.length - 1 && s.suggDivider]}
                    onPress={() => {
                      cityTextRef.current = opt.cityAr;
                      setQuery((q) => ({ ...q, location: opt.cityAr }));
                      setCitySelected(opt);
                      setCitySuggestions([]);
                      setCityFocus(false);
                      setLocMsg('');
                      // New city → drop any prior district and warm THIS city's district catalog so the
                      // District field (now enabled) shows its Top-6 instantly on first focus.
                      clearDistrict();
                      void ensureDistrictOptions(opt.cityId);
                      scrollDown(catAnchorRef); // carry them down to the next step (category)
                    }}
                  >
                    <Image source={LOC_IMG.city} style={s.suggLocIcon} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.suggCity}>{opt.cityAr}</Text>
                      {/* Region stays hidden per spec ("use the confirmed hidden region internally")
                          UNLESS two results in this exact list share a display name — a real,
                          verified case (e.g. الهفوف exists as two distinct real cities) — in which
                          case showing it is the only way the user can tell them apart. */}
                      {hasNameCollision(citySuggestions, opt.cityAr) && opt.regionAr ? (
                        <Text style={s.suggDist}>{opt.regionAr}</Text>
                      ) : null}
                    </View>
                  </Tappable>
                ))}
              </ScrollView>
            )}

            {/* DISTRICT — strictly under City. Disabled until a city is chosen; scoped to that city's
                canonical city_id. Empty focus → Top-6 by active-listing count; typing → the COMPLETE
                canonical district catalog for that city (incl. zero-listing). Another city's districts
                can never appear (data is fetched per city_id); changing the city clears it. Optional. */}
            <Pressable
              style={[s.field, { marginTop: 12 }, !citySelected && { opacity: 0.5 }]}
              onPress={() => { if (citySelected) districtRef.current?.focus(); }}
            >
              <Image source={LOC_IMG.district} style={{ width: 18, height: 18, resizeMode: 'contain' }} />
              <View style={s.flWrap}>
                <Text style={[s.flLabel, (!!districtText || !!districtSelected) && s.flLabelUp]}>
                  {citySelected ? t('Which district? (optional)') : t('Select a city first')}
                </Text>
                <TextInput
                  ref={districtRef}
                  editable={!!citySelected}
                  style={[s.flInput, (!!districtText || !!districtSelected) && s.flInputUp]}
                  value={districtText}
                  autoCorrect={false}
                  onFocus={() => {
                    if (!citySelected) return;
                    setDistrictFocus(true);
                    // Empty focus → Top-6 popular districts in the chosen city. Same race-guard as the
                    // city field: the options load async (though usually pre-warmed on city select), so
                    // re-check the live text via districtTextRef before showing the Top-6.
                    if (!districtTextRef.current) {
                      const cid = citySelected.cityId;
                      void ensureDistrictOptions(cid).then(() => {
                        if (!districtTextRef.current) setDistrictSuggestions(topDistrictsForCityId(cid, 6));
                      });
                    }
                  }}
                  onBlur={() => setTimeout(() => setDistrictFocus(false), 150)}
                  onChangeText={(v) => {
                    districtTextRef.current = v;
                    setDistrictText(v);
                    // Editing invalidates a prior pick — a typed-but-unconfirmed district is never searched.
                    setDistrictSelected(null);
                    if (!citySelected) return;
                    // Empty → Top-6; text → search the COMPLETE canonical catalog for THIS city only.
                    setDistrictSuggestions(matchDistrictsByCityId(citySelected.cityId, v));
                  }}
                />
              </View>
              {districtText.length > 0 && (
                <Pressable onPress={() => {
                  districtTextRef.current = '';
                  setDistrictText('');
                  setDistrictSelected(null);
                  if (citySelected) setDistrictSuggestions(topDistrictsForCityId(citySelected.cityId, 6));
                  districtRef.current?.focus();
                }} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.muted} />
                </Pressable>
              )}
            </Pressable>

            {citySelected && districtFocus && districtSuggestions.length > 0 && (
              <ScrollView style={s.suggBox} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {districtSuggestions.map((opt, i) => (
                  <Tappable
                    key={opt.districtAr + '#' + i}
                    dip={0.03}
                    style={[s.suggRow, i < districtSuggestions.length - 1 && s.suggDivider]}
                    onPress={() => {
                      districtTextRef.current = opt.districtAr;
                      setDistrictText(opt.districtAr);
                      setDistrictSelected(opt);
                      setDistrictSuggestions([]);
                      setDistrictFocus(false);
                    }}
                  >
                    <Image source={LOC_IMG.district} style={s.suggLocIcon} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.suggCity}>{opt.districtAr}</Text>
                      {/* Count shown only for districts that HAVE active listings; zero-listing catalog
                          districts are still selectable (they just return an honest empty result). */}
                      {opt.listingCount > 0 ? (
                        <Text style={s.suggDist}>{grouped(opt.listingCount)}</Text>
                      ) : null}
                    </View>
                  </Tappable>
                ))}
              </ScrollView>
            )}

            <View ref={withAnchor(catAnchorRef)} />
            {/* Category — Residential / Commercial (macro) */}
            <View style={s.pick}>
              <FieldLabel>{t('Category')}</FieldLabel>
              <View style={s.row}>
                {CATEGORIES.map((cat) => (
                  <OptionBox
                    key={cat}
                    label={t(cat)}
                    img={categoryImg(cat)}
                    selected={query.category === cat}
                    onPress={() => { setQuery((q) => ({ ...q, category: q.category === cat ? null : cat, typeGroup: null, type: null, types: null, detail: null, contextBeds: null, contextBedsList: null, contextSize: null, areaMin: null, areaMax: null, priceMin: null, priceMax: null, priceInput: '', priceBand: null })); scrollDown(groupAnchorRef); }}
                  />
                ))}
              </View>
            </View>

            <View ref={withAnchor(groupAnchorRef)} />
            {/* Subcategory group — a SOFT/broad intent (e.g. "Vacation & Rural"). Selecting just the
                group searches all its clean types; picking a specific type below makes it exact. */}
            {query.category && (
              <Reveal style={s.pick}>
                <FieldLabel>{t('Property group')}</FieldLabel>
                <View style={s.wrap}>
                  {groupsFor(query.category as Macro).map((g) => (
                    <OptionBox
                      key={g.group}
                      label={t(g.group)}
                      img={groupImg(g.group)}
                      selected={query.typeGroup === g.group}
                      onPress={() => { setQuery((q) => ({ ...q, typeGroup: q.typeGroup === g.group ? null : g.group, type: null, types: null, detail: null, contextBeds: null, contextBedsList: null, contextSize: null, areaMin: null, areaMax: null, priceMin: null, priceMax: null, priceInput: '', priceBand: null })); scrollDown(typeAnchorRef); }}
                      style={s.wrapCell}
                    />
                  ))}
                </View>
              </Reveal>
            )}

            <View ref={withAnchor(typeAnchorRef)} />
            {/* Clean property type (scoped to the chosen group) — the EXACT/hard filter. Optional:
                leaving it unselected keeps the broad group intent. */}
            {query.typeGroup && (
              <Reveal style={s.pick}>
                <FieldLabel>{t('Property type')}</FieldLabel>
                <View style={s.wrap}>
                  {groupMembers(query.typeGroup).map((ty) => (
                    <OptionBox
                      key={ty}
                      label={t(ty)}
                      img={typeImg(ty)}
                      selected={(query.types ?? []).includes(ty)}
                      onPress={() => { setQuery((q) => { const cur = q.types ?? []; const next = cur.includes(ty) ? cur.filter((x) => x !== ty) : [...cur, ty];
                        const wasRoomOnly = cur.length === 1 && cur[0] === 'Room';
                        const nowRoomOnly = next.length === 1 && next[0] === 'Room';
                        return { ...q, types: next.length ? next : null, type: null, detail: null, priceBand: null,
                          // Room = single room → force beds=1; clear the lock when the selection is no longer Room-only.
                          contextBedsList: nowRoomOnly ? ['1'] : (wasRoomOnly ? null : q.contextBedsList), contextBeds: null }; }); scrollDown(refineAnchorRef); }}
                      style={s.wrapCell}
                    />
                  ))}
                </View>
              </Reveal>
            )}

            <View ref={withAnchor(refineAnchorRef)} />

            {/* Rent only: tiny Monthly / Yearly toggle that tells the engine which period the typed
                number represents. The user sees no math; they just pick what they're thinking in.
                Hidden for Buy. MOVED above the Size filter (owner 2026-07-10) — so the user knows
                which period a price/size they're about to type applies to, before typing it; was
                previously dead last, right before Search. (user request.) */}
            {query.deal === 'Rent' && (
              <Reveal style={{ marginTop: 12 }}>
                <Segmented
                  options={['Monthly', 'Yearly']}
                  icons={PERIOD_IMG}
                  value={rentPeriod === 'monthly' ? 'Monthly' : 'Yearly'}
                  onChange={(v) => setQuery((q) => ({ ...q, rentPeriod: v === 'Monthly' ? 'monthly' : 'annual' }))}
                />
                {/* Tiny inline hint under the toggle so the user knows what each period means. */}
                <Text style={s.rentHint}>
                  {t(rentPeriod === 'monthly' ? 'Monthly: 1–11 month lease, price/month.' : 'Annual: 12-month lease, price/year.')}
                </Text>
              </Reveal>
            )}

            {/* Combined optional refine section: bedrooms + area in one card */}
            {(ctx?.showBeds || ctx?.showSize) && (
              <Reveal style={s.pick}>
                <View style={s.ctxBox}>
                  <Text style={s.ctxTitle}>{t('Refine your search')}</Text>
                  <Text style={s.ctxSub}>{t('Select bedrooms or area, or leave both empty to see all options')}</Text>

                  {ctx.showBeds && (
                    <>
                      <Text style={s.ctxSubLabel}>{t('Bedrooms')}</Text>
                      <View style={[s.wrap, { marginBottom: 4 }]}>
                        {((roomOnly ? ['1'] : ['any', '1', '2', '3', '4', '5+']) as readonly ('any' | '1' | '2' | '3' | '4' | '5+')[]).map((opt) => (
                          <OptionBox
                            key={opt}
                            label={opt === 'any' ? t('Any count') : opt}
                            img={BED_IMG[opt]}
                            selected={opt === 'any' ? !(query.contextBedsList?.length) : (query.contextBedsList ?? []).includes(opt)}
                            onPress={() => { setQuery((q) => {
                              if (opt === 'any') return { ...q, contextBedsList: null, contextBeds: null, priceBand: null };
                              const cur = q.contextBedsList ?? [];
                              const next = cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt];
                              const clearArea = next.length ? null : undefined;
                              return { ...q, contextBedsList: next.length ? next : null, contextBeds: null,
                                contextSize: next.length ? null : q.contextSize,
                                areaMin: clearArea === null ? null : q.areaMin, areaMax: clearArea === null ? null : q.areaMax,
                                priceBand: null };
                            }); scrollDown(); }}
                            style={s.wrapCell}
                          />
                        ))}
                      </View>
                    </>
                  )}

                  {/* AREA range (من / إلى م²) — shown only when no bedroom is selected (beds XOR area).
                      Typing in either box clears the bedroom selection. min only → ≥, max only → ≤. */}
                  {(!ctx.showBeds || !(query.contextBedsList?.length)) && (
                    <>
                      <View style={[s.rangeHead, ctx.showBeds ? { marginTop: 14 } : null]}>
                        <Image source={RANGE_ICON.areaHead} style={s.rangeHeadIcon} />
                        <Text style={[s.ctxSubLabel, s.rangeHeadLabel]}>{t('Area (m²)')}</Text>
                      </View>
                      <View style={s.rangeRow}>
                        <Pressable style={[s.field, s.rangeBox, query.areaMin ? s.sizeFieldOn : null]} onPress={() => focusIfNotAlready(areaMinRef)}>
                          <Image source={RANGE_ICON.areaFrom} style={s.rangeBoxIcon} accessibilityLabel={t('From')} />
                          <Text style={s.rangeLabel}>{t('From')}</Text>
                          {/* Sanity caps (real-iPhone finding 2026-07-11: the field accepted 1,008,000,000,000 م²):
                              area ≤ 7 digits (9,999,999 م²), price ≤ 10 digits (9,999,999,999 ر.س). maxLength counts
                              the GROUPED display (digits + commas) and stops TYPING early; the .slice() in onChangeText
                              hard-caps the stored digits too, covering PASTE (maxLength can't police programmatic sets). */}
                          <TextInput ref={mergeLtrRef(areaMinRef)} style={s.rangeInput} keyboardType="number-pad" placeholder="—" placeholderTextColor={colors.muted} maxLength={9}
                            value={areaMinValue}
                            onKeyPress={wholeNumberKeyGuard('areaMin')} onFocus={() => clearFracLock('areaMin')} onSelectionChange={() => clearFracLock('areaMin')} onChangeText={(v) => { clearFracLock('areaMin'); const d = toWholeNumberDigits(v).slice(0, 7); setQuery((q) => ({ ...q, areaMin: d || null, contextSize: null, contextBeds: null, contextBedsList: null, priceBand: null })); }} />
                          <Text style={s.sizeUnit}>{t('م²')}</Text>
                        </Pressable>
                        <Pressable style={[s.field, s.rangeBox, query.areaMax ? s.sizeFieldOn : null]} onPress={() => focusIfNotAlready(areaMaxRef)}>
                          <Image source={RANGE_ICON.areaTo} style={s.rangeBoxIcon} accessibilityLabel={t('To')} />
                          <Text style={s.rangeLabel}>{t('To')}</Text>
                          <TextInput ref={mergeLtrRef(areaMaxRef)} style={s.rangeInput} keyboardType="number-pad" placeholder="—" placeholderTextColor={colors.muted} maxLength={9}
                            value={areaMaxValue}
                            onKeyPress={wholeNumberKeyGuard('areaMax')} onFocus={() => clearFracLock('areaMax')} onSelectionChange={() => clearFracLock('areaMax')} onChangeText={(v) => { clearFracLock('areaMax'); const d = toWholeNumberDigits(v).slice(0, 7); setQuery((q) => ({ ...q, areaMax: d || null, contextSize: null, contextBeds: null, contextBedsList: null, priceBand: null })); }} />
                          <Text style={s.sizeUnit}>{t('م²')}</Text>
                        </Pressable>
                      </View>
                      {areaHint && (
                        <Text style={[s.rangeNote, areaHint.warn ? s.rangeNoteWarn : null]}>{areaHint.text}</Text>
                      )}
                    </>
                  )}

                  {/* PRICE range (من / إلى ريال) — always available, independent of beds/area. HARD filter. */}
                  <View style={[s.rangeHead, { marginTop: 14 }]}>
                    <Image source={RANGE_ICON.priceHead} style={s.rangeHeadIcon} />
                    <Text style={[s.ctxSubLabel, s.rangeHeadLabel]}>{t('Price')}</Text>
                  </View>
                  <View style={s.rangeRow}>
                    <Pressable style={[s.field, s.rangeBox, query.priceMin ? s.sizeFieldOn : null]} onPress={() => focusIfNotAlready(priceMinRef)}>
                      <Image source={RANGE_ICON.priceFrom} style={s.rangeBoxIcon} accessibilityLabel={t('From')} />
                      <Text style={s.rangeLabel}>{t('From')}</Text>
                      <TextInput ref={mergeLtrRef(priceMinRef)} style={s.rangeInput} keyboardType="number-pad" placeholder="—" placeholderTextColor={colors.muted} maxLength={13}
                        value={priceMinValue}
                        onKeyPress={wholeNumberKeyGuard('priceMin')} onFocus={() => clearFracLock('priceMin')} onSelectionChange={() => clearFracLock('priceMin')} onChangeText={(v) => { clearFracLock('priceMin'); const d = toWholeNumberDigits(v).slice(0, 10); setQuery((q) => ({ ...q, priceMin: d || null, priceInput: '', priceBand: null })); }} />
                      <Text style={s.sizeUnit}>{t('SAR currency')}</Text>
                    </Pressable>
                    <Pressable style={[s.field, s.rangeBox, query.priceMax ? s.sizeFieldOn : null]} onPress={() => focusIfNotAlready(priceMaxRef)}>
                      <Image source={RANGE_ICON.priceTo} style={s.rangeBoxIcon} accessibilityLabel={t('To')} />
                      <Text style={s.rangeLabel}>{t('To')}</Text>
                      <TextInput ref={mergeLtrRef(priceMaxRef)} style={s.rangeInput} keyboardType="number-pad" placeholder="—" placeholderTextColor={colors.muted} maxLength={13}
                        value={priceMaxValue}
                        onKeyPress={wholeNumberKeyGuard('priceMax')} onFocus={() => clearFracLock('priceMax')} onSelectionChange={() => clearFracLock('priceMax')} onChangeText={(v) => { clearFracLock('priceMax'); const d = toWholeNumberDigits(v).slice(0, 10); setQuery((q) => ({ ...q, priceMax: d || null, priceInput: '', priceBand: null })); }} />
                      <Text style={s.sizeUnit}>{t('SAR currency')}</Text>
                    </Pressable>
                  </View>
                  {priceHint && (
                    <Text style={[s.rangeNote, priceHint.warn ? s.rangeNoteWarn : null]}>{priceHint.text}</Text>
                  )}
                </View>
              </Reveal>
            )}

            {/* Detail (bedrooms / size) */}
            {detail && (
              <Reveal style={s.pick}>
                <FieldLabel>{t(detail.label)}</FieldLabel>
                <View style={s.wrap}>
                  {detail.options.map((opt) => (
                    <OptionBox
                      key={opt}
                      label={tDetailOption(opt)}
                      selected={query.detail === opt}
                      onPress={() => { setQuery((q) => ({ ...q, detail: q.detail === opt ? null : opt, priceBand: null })); scrollDown(); }}
                      style={s.wrapCell}
                    />
                  ))}
                </View>
                {/* Size box — mirrors the chosen band or a free-typed number; tap in to edit it. */}
                {!detail.isBedrooms && (
                  <Pressable style={[s.field, s.sizeField, query.detail ? s.sizeFieldOn : null]} onPress={() => focusIfNotAlready(sizeBoxRef)}>
                    <TextInput
                      ref={mergeLtrRef(sizeBoxRef)}
                      style={s.sizeInput}
                      keyboardType="number-pad"
                      placeholder={t('Or type an exact size')}
                      placeholderTextColor={colors.muted}
                      maxLength={9}
                      value={sizeBoxValue}
                      onKeyPress={wholeNumberKeyGuard('size')}
                      onSelectionChange={() => clearFracLock('size')}
                      onFocus={() => {
                        clearFracLock('size');
                        // Tapping in to type a custom size clears the selected band so the box goes
                        // empty (not stale band text) — the user types their own number fresh.
                        if (sizeIsBand) setQuery((q) => ({ ...q, detail: null, priceBand: null }));
                      }}
                      onChangeText={(v) => {
                        clearFracLock('size');
                        const digits = toWholeNumberDigits(v).slice(0, 7);
                        setQuery((q) => ({ ...q, detail: digits ? digits : null, priceBand: null }));
                      }}
                    />
                    <Text style={s.sizeUnit}>{t('m²')}</Text>
                  </Pressable>
                )}
              </Reveal>
            )}

            {/* Price now lives as a من/إلى range inside the «خصص بحثك أكثر» card above. Monthly/Yearly
                MOVED above the Size filter (owner 2026-07-10) — see just before the Refine/Detail
                block below, so the user knows which period their price/size answers apply to BEFORE
                they type them. */}

            <Tappable style={s.searchBtn} onPress={onSearch} dip={0.025}>
              <Text style={s.searchBtnText}>{t('Search')}</Text>
            </Tappable>
            {/* Scroll target: each selection brings this (just below Search) into view so the user is
                carried down through the form without scrolling. (user request.) */}
            <View ref={withAnchor(endAnchorRef)} style={{ height: 1 }} />
          </View>

          {/* Onboarding header — centered icon + bold heading + lighter description, explaining the
              example cards. Same structure as the AI Agent page. (user request.) */}
          <View style={s.onbWrap}>
            <Ionicons name="search" size={26} color={colors.primary} />
            <Text style={s.onbHeading}>{t("Not sure what you're looking for?")}</Text>
            <Text style={s.onbDesc}>{t('Tap one of the examples below and let Ezhalah start the search for you.')}</Text>
          </View>

          <View style={s.suggGrid}>
            {promptChips.map((sg, i) => (
              // Heartbeat wrapper holds the grid sizing and the gentle pulse; the Tappable inside keeps
              // the press-scale and fills the cell. (user request: heartbeat on the cards.)
              <Heartbeat key={sg.label} index={i} style={s.chipCell}>
                <Tappable style={s.chip} onPress={() => onChip(sg.seed)} dip={0.05}>
                  <View style={s.chipIc}>
                    <Ionicons name={sg.icon} size={21} color={colors.chipIcon} />
                  </View>
                  <Text style={s.chipTx}>{sg.label}</Text>
                </Tappable>
              </Heartbeat>
            ))}
          </View>
        </RNAnimated.View>
      </ScrollView>

      {/* Drawer overlays the home content (dimmed behind) instead of replacing it. */}
      {sidebarOpen && <Sidebar onClose={() => setSidebarOpen(false)} />}
      {shareOpen && <ShareSheet onClose={() => setShareOpen(false)} />}
    </View>
  );
}

const s = StyleSheet.create({

  scroll: { paddingHorizontal: space.screenSide, alignItems: 'center' },
  col: { width: '100%', maxWidth: MAX_W },

  // Force LTR for the top bar so it never mirrors under Arabic: the hamburger stays pinned to the
  // physical LEFT (same side as the docked side menu) and the share button to the right, in every
  // language. (Per product decision the menu lives on the left in both AR and EN.)
  top: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4 },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // Note #4 — mobile brand text next to the hamburger.
  topBrand: { fontSize: 18, fontWeight: '800', color: colors.primary, letterSpacing: -0.4 },
  // AI Agent badge + Share icon, grouped and pushed to the far-right edge (marginStart:auto) so they
  // sit together in the top-right corner in BOTH languages. (user request.)
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 6, marginStart: 'auto' },
  hamb: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  word: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, color: colors.ink },
  // The bar is forced LTR (see s.top), so `marginStart: 'auto'` pushes the badge away from the
  // left-pinned hamburger toward the share button on the right.
  agentMini: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.tint, borderColor: colors.tintLine, borderWidth: 1.5, borderRadius: 16, paddingVertical: 9, paddingStart: 12, paddingEnd: 15, ...cardShadow, shadowOpacity: 0.1, shadowRadius: 10 },
  agentMiniTx: { gap: 1.5 },
  agentMiniT: { fontSize: 12.5, fontWeight: '800', color: colors.ink },
  agentMiniS: { fontSize: 9.5, fontWeight: '500', color: colors.accentLeaf },
  shareBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },

  hero: { alignItems: 'center', marginTop: 12, marginHorizontal: 4 },
  heroTitle: { fontSize: 31, fontWeight: '700', color: colors.primary, letterSpacing: -0.6, textAlign: 'center', lineHeight: 34 },
  heroSub: { fontSize: 13.5, fontWeight: '600', color: colors.dark, textAlign: 'center', marginTop: 5, lineHeight: 20 },
  heroTagline: { fontSize: 12.5, fontWeight: '700', color: colors.primary, textAlign: 'center', marginTop: 8, fontStyle: 'italic' },
  // Small inline hint under the Rent Monthly/Yearly toggle — explains the period the user picked.
  rentHint: { fontSize: 11.5, color: colors.muted, marginTop: 6, paddingHorizontal: 4, lineHeight: 16 },

  card: { marginTop: 46, backgroundColor: colors.surface, borderRadius: radius.sheet, borderWidth: 1, borderColor: colors.fieldLine, padding: space.card, ...cardShadow },
  // "مسح الكل" (Clear All) — only rendered when hasActiveFilters(query), so an already-empty filter
  // never shows a clear control with nothing to clear (mirrors the location field's own per-field
  // clear icon, which is likewise conditional on query.location.length > 0).
  clearAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', marginBottom: 10 },
  clearAllText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: radius.field, paddingHorizontal: 14, backgroundColor: colors.surface, ...(Platform.OS === 'web' ? { cursor: 'text' as any } : {}) },
  sizeField: { marginTop: 8, height: 46 },
  sizeFieldOn: { borderColor: colors.primary },
  // fontSize 16 (not 14) on the numeric inputs is deliberate: iOS Safari AUTO-ZOOMS the whole page
  // when focusing any input whose font is under 16px, which on this RTL layout pans/zooms the
  // viewport so the field's text can appear detached from its box (real-iPhone finding, 2026-07-11).
  // minWidth: 0 stops WebKit's flex min-width:auto from letting the <input> grow past its box and
  // spill text over the artwork. Applies to sizeInput + rangeInput (the 5 whole-number fields).
  sizeInput: { flex: 1, minWidth: 0, fontSize: 16, color: colors.ink, padding: 0, height: '100%', textAlign: 'left', ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  sizeUnit: { fontSize: 13.5, fontWeight: '700', color: colors.muted },
  // من / إلى range row: two equal boxes, each "label  input  unit".
  rangeRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  rangeBox: { flex: 1, height: 46, flexDirection: 'row', alignItems: 'center', gap: 6 },
  rangeLabel: { fontSize: 12.5, fontWeight: '700', color: colors.muted },
  // 16px + minWidth: 0 for the same iOS-Safari reasons as sizeInput above.
  rangeInput: { flex: 1, minWidth: 0, fontSize: 16, color: colors.ink, padding: 0, height: '100%', textAlign: 'left', ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  // Price/Area (السعر / المساحة) filter icons restored 2026-07-04 (were lost when a git reset --hard
  // reverted the uncommitted index.tsx wiring; the RANGE_ICON map + PNGs survived as untracked files).
  rangeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginBottom: 8 },
  rangeHeadIcon: { width: 17, height: 17, resizeMode: 'contain' },
  rangeHeadLabel: { marginBottom: 0 },
  rangeBoxIcon: { width: 15, height: 15, resizeMode: 'contain' },

  flWrap: { flex: 1, height: 52, justifyContent: 'center', position: 'relative', ...(Platform.OS === 'web' ? { cursor: 'text' as any } : {}) },
  flLabel: { position: 'absolute', left: 0, top: 17, fontSize: 14, color: colors.muted, ...(Platform.OS === 'web' ? { cursor: 'text' as any, transitionProperty: 'top, font-size, color' as any, transitionDuration: '140ms' as any } : {}) },
  flLabelUp: { top: 7, fontSize: 10, color: colors.primary, fontWeight: '600' },
  flInput: { fontSize: 14, color: colors.ink, padding: 0, height: '100%', ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  flInputUp: { paddingTop: 15 },

  suggBox: { marginTop: 8, maxHeight: 268, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: radius.field, backgroundColor: colors.surface, overflow: 'hidden' },
  suggRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12 },
  suggLocIcon: { width: 20, height: 20, resizeMode: 'contain' }, // Saudi/Region/City/District designed art (assets/images/loc)
  suggDivider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  suggCity: { fontSize: 13.5, fontWeight: '600', color: colors.ink },
  suggDist: { fontSize: 11.5, color: colors.muted },

  pick: { marginTop: 12 },
  ctxBox: { backgroundColor: colors.chipFill, borderWidth: 1, borderColor: colors.chipLine, borderRadius: 12, padding: 14 },
  ctxTitle: { fontSize: 14, fontWeight: '700', color: colors.ink, textAlign: 'right', marginBottom: 5 },
  ctxSub: { fontSize: 12, color: colors.muted, textAlign: 'right', lineHeight: 18, marginBottom: 14 },
  ctxSubLabel: { fontSize: 12.5, fontWeight: '600', color: colors.muted, textAlign: 'right', marginBottom: 8 },
  // Non-blocking helper note under Price / Area inputs. Subtle by default; amber (attention) when warn.
  rangeNote: { fontSize: 12, color: colors.muted, textAlign: 'right', lineHeight: 18, marginTop: 8 },
  rangeNoteWarn: { color: colors.amberInk, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  wrapCell: { flexGrow: 1, flexBasis: '30%', minWidth: 90, flex: 0 },

  searchBtn: { marginTop: 11, height: 51, borderRadius: radius.field, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  searchBtnText: { color: '#fff', fontSize: 15.5, fontWeight: '600' },

  startHead: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 9, marginHorizontal: 2 },
  startT: { fontSize: 18, fontWeight: '700', color: colors.ink },
  startS: { fontSize: 12, color: colors.muted, marginTop: 1 },
  // Centered onboarding header above the example chips (matches the AI Agent page).
  onbWrap: { alignItems: 'center', gap: 7, marginTop: 12, marginBottom: 4, paddingHorizontal: 12 },
  onbHeading: { fontSize: 19, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  onbDesc: { fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 18, maxWidth: 380 },

  suggGrid: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // Sizing lives on the Heartbeat wrapper; the chip fills it. (Two-per-row grid, same as before.)
  chipCell: { flexGrow: 1, flexBasis: '45%' },
  chip: { width: '100%', backgroundColor: colors.chipFill, borderWidth: 1, borderColor: colors.chipLine, borderRadius: 16, paddingTop: 12, paddingBottom: 13, paddingHorizontal: 13, gap: 10 },
  chipIc: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  chipTx: { fontSize: 12.5, fontWeight: '600', color: colors.ink, lineHeight: 16 },
});
