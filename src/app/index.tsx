import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated as RNAnimated, Easing as RNEasing, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useThemePalette } from '@/lib/appearance';
import { colors, radius, space, cardShadow } from '@/theme/tokens';
import { TAP44 } from '@/theme/palette';
import { RANGE_ICON, categoryImg, groupImg, typeImg, BED_IMG, DEAL_IMG, PERIOD_IMG, LOC_IMG } from '@/theme/propertyIcons';
import HeroBackground from '@/components/HeroBackground';
import { OptionBox, FieldLabel, Tappable, Reveal, DropdownReveal } from '@/components/ui';
import Sidebar, { useDocked } from '@/components/Sidebar';
import ShareSheet from '@/components/ShareSheet';
import ModeSwitch from '@/components/ModeSwitch';
import { CATEGORIES, detailFor, detailForContext, priceTabsFor, type Category } from '@/data/taxonomy';
import { groupsFor, groupMembers, type Macro } from '@/data/propertyTypes';
import { ensureLocationIndex, ensureCityFieldIndex, topCitiesByListings, matchCitiesByText, hasNameCollision, resolveCitySelection, type CityOption, ensureDistrictOptions, topDistrictsForCityId, matchDistrictsByCityId, type DistrictOption, cityPoolStatus, districtPoolStatus } from '@/data/locations';
import { TrendingHeader, TrendingRows } from '@/components/TrendingList';
import { buildAfSummary, grouped, type SearchQuery } from '@/data/search';
import { fetchDistrictEligibleCounts, IMPLIED_CATEGORY_DEFAULT, cohortTypesAr, rpcAllNarrowingParams, searchTableScope } from '@/data/remote';
import { HOME_DEFAULT_QUERY, hasActiveFilters, togglePeriodButton, validRentPeriod, toggleDealButton, dealSelectionFromQuery, dealSelectionToQuery, effectiveGroups, toggleGroup, typesForGroups, setCategory } from '@/lib/searchDefaults';
import { AF_ALL_QUESTIONS } from '@/data/advancedFilters';
import { reconcileCommittedAf, withoutFacet, AF_PREDICATE_FIELDS } from '@/lib/afCarry';
import { toWholeNumberDigits, wholeNumberKeyDecision } from '@/lib/inputHygiene';
import { runAfterAnimation } from '@/lib/afterAnimation';
import { noTranslateRef } from '@/noTranslate';
import { useApp } from '@/store';
import { shareNative } from '@/lib/share';
import { useI18n, tDetailOption, tPriceTab, isLatinOnlyInput, ARABIC_ONLY_MSG, CITY_REQUIRED_MSG, DISTRICT_UNCONFIRMED_MSG } from '@/i18n';

const MAX_W = 560; // desktop-web: keep the mobile-first column centered

const AnimatedPressable = RNAnimated.createAnimatedComponent(Pressable);

// react-native-web does NOT support `direction` as a style property (it throws "Invalid style
// property of 'direction'"). To pin a row to a physical orientation regardless of the page's RTL,
// set the DOM `dir` attribute directly via a callback ref. `setLtr` forces left-to-right so the
// top bar's menu button always sits on the physical LEFT (it must NOT mirror under Arabic).
const setLtr = (node: any) => {
  if (Platform.OS === 'web' && node?.setAttribute) node.setAttribute('dir', 'ltr');
};
// The old breathing "Ezhalah AI Agent" badge (and its makeDirRef helper) lived here — replaced by
// the shared two-tab ModeSwitch pill (src/components/ModeSwitch.tsx), which shows BOTH search modes
// at once in the top bar. (owner top-nav redesign, 2026-07-24.)

// Small NON-BLOCKING helper note shown under the Price / Area range inputs. It only explains a
// confusing entry (min>max, min==max, 0 = no limit, one-sided range). Pure UI hint — it never blocks
// the search, never changes the user's numbers, and doesn't touch the filter logic. Arabic, per owner
// (2026-07-06). warn=true → attention styling. Applies to Price and Area identically.
type RangeHintCfg = {
  warnHiLo: string; none: string; zeroMin: string; zeroMax: string;
  near: (x: string) => string; minOnly: (x: string) => string; maxOnly: (x: string) => string;
  both: (lo: string, hi: string) => string; // both bounds filled, a valid range (min < max)
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
  // Both bounds filled with a valid range (min < max) → confirm the range so the user sees what they
  // set (owner UI request 2026-07-19: "a note when he fills both"). warn only fires on min>max above.
  if (minPos && maxPos) return { text: cfg.both(fmt(minV as number), fmt(maxV as number)), warn: false };
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
  both: (lo, hi) => `سيتم البحث عن العقارات بسعر من ${lo} إلى ${hi} ر.س.`,
};
const AREA_HINT: RangeHintCfg = {
  warnHiLo: 'تنبيه: الحد الأدنى للمساحة أعلى من الحد الأعلى. راجع المساحتين قبل البحث.',
  none: 'سيتم البحث بدون تحديد مساحة.',
  zeroMin: '0 يعني بدون حد أدنى للمساحة.',
  zeroMax: '0 يعني بدون حد أعلى للمساحة.',
  near: (x) => `سيتم البحث عن العقارات بمساحة ${x} م² بالضبط.`,   // min == max → EXACT match (backend uses inclusive bounds v>=X && v<=X)
  minOnly: (x) => `سيتم البحث عن عقارات بمساحة ${x} م² أو أكبر.`,
  maxOnly: (x) => `سيتم البحث عن عقارات بمساحة ${x} م² أو أقل.`,
  both: (lo, hi) => `سيتم البحث عن العقارات بمساحة من ${lo} إلى ${hi} م².`,
};

// HOME_DEFAULT_QUERY / hasActiveFilters moved to src/lib/searchDefaults.ts (zero-dependency, so a
// plain Node test can execute them — imported above).

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, locale, isRTL } = useI18n();
  const { query: storeQuery, setQuery, user, openAuth, dismissSignInCard } = useApp();
  // THE ONE QUERY THIS SCREEN DERIVES EVERYTHING FROM (owner P0 2026-09-01).
  //
  // The store may now carry Advanced Filter answers committed in the chat — that is the whole fix:
  // before it, returning here and pressing «بحث» (through a Trending card or not) silently re-ran
  // the PRE-AF search, and the Trending row counts, built from the same stripped query, advertised
  // exactly the wrong number they then delivered. Measured live: الرياض/إيجار/سنوي/تجاري/محل +
  // «جديد» committed 243, re-entry returned 566 with p_is_new_construction absent from the request.
  //
  // Reconciled, not raw, because THIS screen can move the cohort under a carried answer — change
  // فئة, drop the group, pick a different نوع, switch شراء/إيجار or شهري/سنوي. reconcileCommittedAf
  // re-checks every carried facet against the CURRENT cohort with cohortAllows() (the same gate that
  // decided the question could be asked) and re-applies only the survivors through each question's
  // OWN apply(). Applying an uncertified answer would not narrow honestly — the AF's SQL predicates
  // are strict-NULL-excluding, so it would delete every row that never stated the attribute, turning
  // UNKNOWN into No.
  //
  // SCOPE facets (group/type) are dropped outright — see certifiedFacets in src/lib/afCarry.ts. They
  // license nothing (applyScopeAnswer writes only typeGroups/types/type, all Normal-tier fields the
  // sanitizer already carries and the group/type boxes already control), and re-applying one made
  // those boxes DEAD: the rows write the RAW store while rendering from this reconciled query, so
  // every scope tap was overwritten on the next render. The interview's scope answer still rides —
  // as the types/typeGroups it wrote.
  //
  // Derived ONCE, here, and read by the Trending city params, the district live counts, the AF chips
  // and buildFilterBaseQuery alike — so what is counted, what is shown and what is searched cannot
  // disagree, by construction rather than by four call sites remembering to agree.
  const query = useMemo(
    () => reconcileCommittedAf(storeQuery, AF_ALL_QUESTIONS),
    [storeQuery],
  );
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
  // MULTI-SELECT (owner 2026-08-10): districtsSelected is an ARRAY — the user can pick several
  // districts and search them as OR (the whole pipeline below already takes districts: string[] →
  // p_districts; the field was the only single-select hop). Keyed by districtAr, which is already
  // dedup-safe: district_options_ar folds hamza twins into ONE option row, and Trending and typed
  // suggestions render the SAME rows — so picking «حي النرجس» from Trending and again from search is
  // one key, one entry. Tap toggles: tapping a selected district removes it. The array is cleared on
  // every city change (clearDistrict below) so a stale cross-city district can never leak — same
  // invariant as before, now over a list.
  const [districtText, setDistrictText] = useState('');
  const [districtSuggestions, setDistrictSuggestions] = useState<DistrictOption[]>([]);
  const [districtsSelected, setDistrictsSelected] = useState<DistrictOption[]>([]);
  const [districtFocus, setDistrictFocus] = useState(false);
  // One inline message line under the district field: the Arabic-only warning while typing, and
  // (2026-08-23) the "you typed a حي but never picked it" block that onSearch raises — see there.
  const [districtMsg, setDistrictMsg] = useState('');
  const districtRef = useRef<TextInput>(null);
  const districtTextRef = useRef('');
  // One place to wipe all district state — called wherever the city changes/clears.
  const clearDistrict = () => {
    districtTextRef.current = '';
    setDistrictText('');
    setDistrictsSelected([]);
    setDistrictSuggestions([]);
    setDistrictFocus(false);
    setDistrictMsg('');
  };
  // Toggle a district in/out of the multi-select. Membership by districtAr (see comment above).
  const toggleDistrict = (opt: DistrictOption) => {
    setDistrictsSelected((prev) =>
      prev.some((d) => d.districtAr === opt.districtAr)
        ? prev.filter((d) => d.districtAr !== opt.districtAr)
        : [...prev, opt]);
  };
  const cityRef = useRef<TextInput>(null);
  // Mirrors query.location synchronously (state updates are async/batched) so the Top-6-on-focus
  // promise callback above can check the TRUE current text at resolution time, not a stale closure.
  const cityTextRef = useRef('');
  // P3 fix (findings 2026-08-13): the 150ms close-on-blur timers are STORED and cancelled on the
  // matching onFocus, on a suggestion-row press, and on unmount. An uncancelled timer from a
  // blur-then-quick-refocus used to fire AFTER the refocus, closing the dropdown while the input
  // stayed focused — and with focus already held, no further tap could ever raise a focus event, so
  // the selector was dead until the user blurred somewhere else. No timing changed: same 150ms.
  const cityBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const districtBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearBlurTimer = (timer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };
  useEffect(() => () => { clearBlurTimer(cityBlurTimer); clearBlurTimer(districtBlurTimer); }, []);
  // Rent period the user has toggled (Monthly/Yearly) — drives the period-scoped Trending lists AND
  // the search summary. Buy has no period. Declared HIGH (above the warm effects below) because those
  // effects depend on it. (Was previously derived lower down; moved up 2026-07-21.)
  // validRentPeriod (owner invariant 2026-08-19): defense in depth against an empty/neither period
  // state reaching the two toggle buttons from ANY origin, not just a direct tap — a corrupted/
  // unexpected value here (e.g. from some future code path that bypasses TypeScript's own type)
  // must still fall back to the safe default rather than leaving both buttons unselected.
  const rentPeriod: 'monthly' | 'annual' | 'both' = validRentPeriod(query.rentPeriod) ?? 'annual';
  // Buy+Rent combined multi-select (owner feature 2026-08-20): every Trending/pool call below reads
  // effDeal instead of query.deal directly — null tells top_cities_by_deal_ar/district_options_ar
  // (and every locations.ts pool wrapping them) to scope to the combined Buy ∪ Rent(any period) set,
  // exactly like the backend's own p_deal IS NULL branch (verified live, PR#817). query.deal itself
  // is untouched (still the last concrete button pressed) — the two-button toggle UI and any text
  // that still needs a single-deal flavor keep reading it directly.
  const effDeal = query.dealCombined ? null : query.deal;
  // Period token for the Trending-scope RPCs (top_cities_by_deal_ar / district_options_ar) — the
  // SAME 'شهري'/'سنوي'/'كلاهما' Arabic token remote.ts's rentPeriodParam() sends to the results RPC,
  // never a boolean (owner mixed-period feature 2026-08-19, fixing a real Trending-vs-results scope
  // mismatch: the old boolean had no representation for "both known periods, excluding unpublished",
  // so a combined search used to send `null` here — a BROADER pool than what Search actually returns
  // for 'كلاهما', since null also sweeps in rent rows whose source published no period at all).
  // Buy → null (no filter), same as before.
  // dealCombined's Rent side has no period selector — it accepts both known periods AND unpublished-
  // period rows (no period filter at all, matching the backend's p_rent_period IS NULL branch), same
  // null-means-unrestricted convention Buy already uses. effDeal reads as null under combined mode,
  // so `effDeal !== 'Rent'` already covers that case with no separate dealCombined check needed.
  const rentPeriodTok: string | null =
    effDeal !== 'Rent' ? null
    : rentPeriod === 'monthly' ? 'شهري'
    : rentPeriod === 'both' ? 'كلاهما'
    : 'سنوي';
  // COUNT-SCOPE PARITY (findings 2026-08-13, R1): every City/District pool call is scoped to the
  // category the results RPC will ACTUALLY search — the picked category, else the same implied
  // default remote.ts applies to a category-less search (imported, never a duplicated literal).
  // Before this, pools counted ALL categories while a bare search implied Residential: district
  // counts overstated up to 86%, and commercial-only districts presented as alive yet searched to 0
  // — silently defeating the PR#384 zero-mark.
  const effCategory: Category = query.category ?? IMPLIED_CATEGORY_DEFAULT;
  // The cohort's Arabic types — the EXACT array the search RPC receives (one shared definition in
  // remote.ts), so Trending cities/districts, their counts, and their percentages always describe
  // the same inventory pressing Search returns.
  const cohortTypes = cohortTypesAr(query);
  const cohortTypesSig = cohortTypes ? cohortTypes.join('|') : '';
  // EVERY predicate the user has already chosen, in the SAME shape the search RPC receives — the
  // advanced answers AND the normal narrowing (bedrooms, price, area, combined-mode rent budget).
  //
  // OWNER RULE (2026-08-22, supersedes the 2026-08-15 "price is deliberately absent" scoping):
  // «Trending is not a generic location suggestion. It is the location breakdown of the user's exact
  // current eligible set.» The number beside a city must be "listings matching EVERYTHING I picked,
  // in that city" — not the type/deal total for that city.
  //
  // Measured live on production BEFORE this fix, Apartment + Rent + Annual + 3 bedrooms:
  // picking the bedroom count changed NOTHING — الرياض stayed 10,618 against a truth of 3,863 — and
  // every top_cities_by_deal_ar request went out with beds/area/price all null. Adding the owner's
  // full example (+120-180 m² +70k-100k) the truth is 705: a 15x overstatement, and جدة 78x, مكة 708x.
  //
  // IDENTITY IS KEYED ON THE CONTENT, NOT A HAND-WRITTEN DEP LIST. The params are derived from many
  // query fields (bedroomTokens alone reads type, detail, types and beds), so an explicit dependency
  // array is a standing invitation to forget one — which is precisely the defect being fixed here.
  // Recomputing each render is cheap; memoising on the SIGNATURE gives a stable object identity that
  // changes if and only if a real predicate changed, so the pool cache key and the refresh effect
  // below can never serve a count for a filter state the user has already left.
  //
  // THE TABLE SCOPE RIDES ALONG (defect 2026-09-03). The narrowing params alone are not enough for
  // Trending to describe the search: the results RPC is also scoped to a TABLE list, and Trending was
  // sending none — so it counted every platform table in search_listings_ar while results read only
  // RES_TABLES/COM_TABLES. The moment five platforms went live in the view without being added to
  // those client lists, Trending began advertising inventory results cannot return (measured live:
  // الهفوف/أرض سكنية/بيع advertised 2,478, search delivered 109). searchTableScope(query) is the SAME
  // pure function resolveSearchScope uses for the results call, never a second copy of the lists —
  // a copy is exactly how this drifted. null (no readable table for this query) leaves the scope off
  // and is unreachable here in practice: tablesFor() is non-empty for every real Filter state.
  // isBroadCommercial is dropped: it is a local branch flag for fetchListingsForQuery, NOT an RPC
  // argument — passing it would make PostgREST reject the whole call with PGRST202.
  const { isBroadCommercial: _cityScopeFlag, ...cityTableScopeRaw } = searchTableScope(query) ?? {};
  // Memoised on its own CONTENT signature, exactly like cityAfParams below. The district pool takes
  // this object directly (its cache key folds it in), and the scope can change WITHOUT deal/category/
  // types changing — a platform filter alone rewrites it — so a stable identity keyed on the content
  // is what makes the district effects re-run on precisely the changes that matter and no others.
  const cityTableScopeSig = JSON.stringify(cityTableScopeRaw);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cityTableScope = useMemo(() => cityTableScopeRaw, [cityTableScopeSig]);
  const cityAfRaw = { ...rpcAllNarrowingParams(query), ...cityTableScope };
  const cityAfSig = JSON.stringify(cityAfRaw);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cityAfParams = useMemo(() => cityAfRaw, [cityAfSig]);
  // «N إعلان» — how many ACTIVE listings this option really has, in the current cohort.
  //
  // The share percentage that used to trail this label («… · 38٪») was REMOVED on owner instruction
  // (2026-08-16): "remove this percentage and show these active numbers". A share answers a question
  // nobody asked at this moment — the user is choosing where to search, so the only useful fact is
  // how much is actually there. The count itself is unchanged and still comes straight from the
  // counting RPC, so nothing about its accuracy moved.
  //
  // Returns undefined for a zero/absent count so a caller can render its own explicit "nothing here"
  // message instead of a bare «0 إعلان» (see the districts list, which does exactly that).
  const cohortCountLabel = (n: number): string | undefined => {
    if (!(n > 0)) return undefined;
    return `${grouped(n)} ${t('ads')}`;
  };
  // Refs so the ENTIRE Price/Area/Size box is one tap target (owner 2026-07-10): tapping anywhere in
  // the box — icon, label, padding, unit text — focuses the input immediately, same pattern already
  // used for the city field above (`cityRef` + its wrapping Pressable).
  const areaMinRef = useRef<TextInput>(null);
  const areaMaxRef = useRef<TextInput>(null);
  const priceMinRef = useRef<TextInput>(null);
  const priceMaxRef = useRef<TextInput>(null);
  // Rent-side budget box, shown only when both شراء+إيجار are selected (owner feature 2026-08-20) —
  // priceMin/priceMax stay the Buy budget unchanged.
  const priceMinRentRef = useRef<TextInput>(null);
  const priceMaxRentRef = useRef<TextInput>(null);
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
  // Like setLtr above, react-native-web does not support `direction` as a style property (it
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
  const cityAnchorRef = useRef<View>(null);
  const districtAnchorRef = useRef<View>(null);
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
    // MUST outlast DropdownReveal's close animation (ui.tsx DROPDOWN_CLOSE.duration = 150ms): picking
    // a City/District suggestion closes that dropdown AND calls scrollDown in the same tick. The
    // dropdown stays fully mounted (occupying its normal layout height) until its fade-out finishes,
    // then unmounts instantly, shifting every section below it upward. At the old 90ms delay this fired
    // BEFORE that unmount, so the browser's smooth-scroll targeted a position that moved out from under
    // it 60ms later — observed live as the page jumping to the very bottom instead of stopping at the
    // next section (owner report 2026-07-20, "when I choose the district it takes me fully down").
    // 220ms clears the 150ms close animation with margin; still fast enough to feel instant.
    setTimeout(() => {
      const sv = scrollRef.current;
      const node: any = target?.current;
      // No target (or not yet mounted) → do nothing rather than guess. The old fallback jumped to the
      // very bottom of the page (scrollToEnd) whenever a ref wasn't ready, which is a worse outcome
      // than not scrolling at all — never re-add a "when in doubt, jump to the end" fallback here.
      if (!node) return;
      if (Platform.OS === 'web') {
        // scroll-margin-top (set on every anchor by withAnchor) makes 'start' land OFFSET px below the
        // node's top instead of flush against the viewport edge — the previous section stays visible.
        node.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      } else if (sv) {
        node.measureLayout(
          sv as any,
          (_x: number, y: number) => sv.scrollTo({ y: Math.max(0, y - SCROLL_REVEAL_OFFSET), animated: true }),
          () => {}, // measurement failed (unmounted/detached) — do nothing, same reasoning as above.
        );
      }
    }, 220);
  };
  // Attaches a ref AND (web-only) sets scroll-margin-top, so every anchor gets the same gentle offset
  // with zero extra plumbing at each call site — same pattern already used for setLtr above.
  const withAnchor = (ref: React.MutableRefObject<View | null>) => (node: any) => {
    ref.current = node;
    if (Platform.OS === 'web' && node?.style) node.style.scrollMarginTop = `${SCROLL_REVEAL_OFFSET}px`;
  };
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Monthly↔Yearly flip cleared typed price bounds (unit changed) — drives the one-line explanation
  // under the period toggle; hides itself once the user types a new price. (audit item 3.)
  const [periodPriceCleared, setPeriodPriceCleared] = useState(false);
  // Same "unit changed → clear + explain" precedent, for the شراء/إيجار toggle (owner feature
  // 2026-08-20): priceMin/priceMax means "Buy budget" under Buy-only AND under Combined, but means
  // "Rent budget (annual)" under Rent-only — so it must be cleared exactly when a toggle press
  // flips WHICH deal that pair currently prices, never on a press that keeps the same meaning
  // (Buy-only→Both keeps meaning Buy; Both→Buy keeps meaning Buy — no clear either time).
  const [shareOpen, setShareOpen] = useState(false);
  // Share button press feel — reuses ModeSwitch's own spring constants (stiffness 260, damping 26,
  // mass 0.7) so the header's two controls share one motion language (design review 2026-07-24).
  const shareScale = useRef(new RNAnimated.Value(1)).current;
  const shareSpring = (toValue: number) =>
    RNAnimated.spring(shareScale, { toValue, stiffness: 260, damping: 26, mass: 0.7, useNativeDriver: Platform.OS !== 'web' }).start();

  // Filter search funnels into the Ezhalah chat with listings inline (prototype parity — there is
  // no separate results page). The agent reads ?filter=… and runs it once on open. Pressing Search
  // first LIGHTENS the sketch backdrop (a deliberate "here we go" beat), then opens the results once
  // that lift has played.
  // Warm the live district index when the home opens, so a typed district that exists in real
  // inventory (e.g. "Al Doha Dist." in Yanbu) is recognized by the time the user searches.
  useEffect(() => { void ensureLocationIndex(); }, []);
  // Warm the DEAL-SCOPED city-listing-counts pool whenever Deal changes (incl. the initial mount,
  // since query.deal always starts as a concrete 'Buy'/'Rent' — never null). Deal is picked BEFORE
  // City in this form, so it's always known here; Category is picked AFTER City/District, so a
  // Category-aware ranking can't reach this field without moving Category earlier in the flow — a
  // bigger UX change the owner declined (2026-07-20). Deal-only is what this data can support today.
  useEffect(() => {
    void ensureCityFieldIndex(effDeal, rentPeriodTok, effCategory, cohortTypes, cityAfParams).then((pool) => {
      // EDGE CASE (found in testing, generalizes to every deal change too): a fetch can still be
      // pending when the user has already focused AND typed a query — matchCitiesByText() would have
      // run against a still-empty/stale-deal pool and (correctly, not a crash) returned []/old
      // results. Without this, the dropdown would stay stale forever once the fresh data arrives.
      // Re-run against whatever text is currently live, or — if the field is showing its empty-focus
      // Top-6 — refresh that list too, so flipping Buy↔Rent visibly reorders it (owner request:
      // replay only "when the section first appears or when the rankings change").
      if (cityTextRef.current) {
        const latin = isLatinOnlyInput(cityTextRef.current);
        setCitySuggestions(latin ? [] : matchCitiesByText(effDeal, rentPeriodTok, effCategory, cityTextRef.current, cohortTypes, cityAfParams));
      } else if (cityFocus) {
        setCitySuggestions(topCitiesByListings(effDeal, rentPeriodTok, effCategory, 6, cohortTypes, cityAfParams));
      }
      // REHYDRATION (bug fix 2026-08-04): returning to this screen after a search REMOUNTS it —
      // query.location persists in the app context (the field still shows the city), but
      // citySelected is local state and comes back null, so pressing Search on an untouched,
      // previously-VERIFIED city was rejected with "select a city from the list" until the user
      // cleared + re-picked the very city already on screen.
      // Restoring it here is NOT free-text guessing (spec: "never guess a location"):
      //  • If the rich resolution survived (query.locationMatch, kind:'city' exact — it does NOT
      //    survive the /agent?filter=… URL round-trip, which serializes only the simple fields;
      //    live-proven 2026-08-04), the candidate must round-trip resolveCitySelection() to that
      //    same resolution (city AND region) — disambiguating real same-name twins (e.g. الهفوف).
      //  • Without it, the persisted text must EXACTLY equal the label of exactly ONE catalog city
      //    in the pool — nothing fuzzy, nothing partial, and a twin label (2 candidates) restores
      //    nothing. An exact, unique, catalog-attested label is a determination, not a guess: the
      //    only city it can search is the one displayed in the field.
      // 0 or 2+ candidates → no rehydration, the user re-picks exactly as before.
      const lm = query.locationMatch;
      const lmOk = !!lm && lm.kind === 'city' && lm.exact === true && !!query.location && query.location === lm.label;
      if (lmOk || (!lm && !!query.location)) {
        const cands = pool.filter((o) => o.cityAr === query.location);
        const match = lmOk
          ? cands.filter((o) => {
              const r = resolveCitySelection(o);
              return r.city === lm!.city && r.region === lm!.region;
            })
          : cands;
        if (match.length === 1) {
          cityTextRef.current = match[0].cityAr;
          setCitySelected((prev) => prev ?? match[0]);
        }
      }
    });
    // Deliberately NOT depending on cityFocus/citySelected — this effect should fire only on a real
    // Deal/period/category change (or mount), not on every focus/blur toggle; cityFocus is read for
    // its value AT that moment via closure, which is exactly what's wanted (see comment above).
    // effCategory joined the deps with count-scope parity: the pool is now keyed by the effective
    // category, so a Residential↔Commercial pick re-warms the pool at its true scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // DEPS: deal / period / category / types ONLY — deliberately NOT cityAfSig.
    //
    // This effect does two jobs: warm the city pool, and REHYDRATE citySelected after a remount
    // (returning from a search, or the post-Stop restore). Adding the narrowing signature here made
    // it re-run on every bedroom, price and area edit, and re-entering the rehydration path that
    // often mid-flight left the form in a state where pressing «بحث» issued no search at all — the
    // web-runtime smoke test caught it as «resubmitting after rapid-Stop» never landing a count.
    // Counts still follow the narrowing: the effect BELOW refreshes the pool whenever the field is
    // actually open, which is the only time those numbers are on screen.
  }, [effDeal, rentPeriodTok, effCategory, cohortTypesSig]);

  // Narrowing changed (bedrooms / price / area / an advanced answer) — the CITY COUNTS are now stale.
  // Refetch for the new key and re-render the list, but ONLY while the field is actually in use, and
  // WITHOUT touching rehydration: this effect never sets citySelected, so it cannot disturb the form.
  useEffect(() => {
    if (!cityFocus && !cityTextRef.current) return;
    void ensureCityFieldIndex(effDeal, rentPeriodTok, effCategory, cohortTypes, cityAfParams).then(() => {
      if (cityTextRef.current) {
        const latin = isLatinOnlyInput(cityTextRef.current);
        setCitySuggestions(latin ? [] : matchCitiesByText(effDeal, rentPeriodTok, effCategory, cityTextRef.current, cohortTypes, cityAfParams));
      } else if (cityFocus) {
        setCitySuggestions(topCitiesByListings(effDeal, rentPeriodTok, effCategory, 6, cohortTypes, cityAfParams));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityAfSig, cityFocus]);

  // Same reactive refresh for District, scoped to the currently-selected city — and ALSO to Category
  // (owner decision 2026-07-20, after proving live that Category matters more for districts than for
  // cities): even though Category is picked after District in this form, the moment the user sets it
  // — or changes Deal — District's Top-6 re-fetches for the now-more-complete scope. Until then the
  // pool is scoped to effCategory (the implied-Residential default a bare search actually runs at —
  // count-scope parity, findings R1), never to the old all-categories null scope.
  // Only meaningful once a city is picked; a no-op otherwise (ensureDistrictOptions is never called
  // without one).
  useEffect(() => {
    if (!citySelected) return;
    const cid = citySelected.cityId;
    void ensureDistrictOptions(cid, effDeal, effCategory, rentPeriodTok, cohortTypes, cityTableScope).then(() => {
      if (districtTextRef.current) {
        const latin = isLatinOnlyInput(districtTextRef.current);
        setDistrictSuggestions(latin ? [] : matchDistrictsByCityId(cid, effDeal, effCategory, rentPeriodTok, districtTextRef.current, cohortTypes, cityTableScope));
      } else if (districtFocus) {
        setDistrictSuggestions(topDistrictsForCityId(cid, effDeal, effCategory, rentPeriodTok, 6, cohortTypes, cityTableScope));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effDeal, effCategory, citySelected, rentPeriodTok, cohortTypesSig, cityTableScopeSig]);

  // DISTRICT REHYDRATION — the districtsSelected twin of the citySelected fix above (2026-08-04).
  //
  // The bug (live-proven on production, browser E2E 2026-08-14): search «الرياض + حي النرجس + شقة +
  // 3 غرف + 20,000–90,000 + 100–300 م²» → 266 نتيجة → reopen «تصفية» → press «بحث» with NOTHING
  // touched → 1,255 نتيجة. Root cause: districtsSelected is LOCAL component state and comes back
  // EMPTY on remount, while every other selection persists in the app context — and onSearch reads
  // only the local array, so `districtMatchUnion` was undefined and the rebuilt query dropped
  // districts entirely. The user's search was SILENTLY WIDENED from their chosen حي to the whole
  // city (+989 listings they never asked for), with the removable حي chip gone from the form too, so
  // nothing on screen said the filter had been dropped. Search & Matching QA §13 (never silently
  // widen the user's request) and §29 (selections survive the results → filter round-trip).
  //
  // Restoring is a determination, not a guess — the same discipline as the city rehydration:
  //  • Candidates come from the SAME canonical catalog the field itself picks from
  //    (ensureDistrictOptions for this city/deal/category/period), matched on matchValues — the
  //    exact array persisted in query.districts, so there is no fuzzy or partial matching.
  //  • The restored union must equal query.districts EXACTLY (set equality both ways). A catalog
  //    that has drifted since the search restores NOTHING rather than quietly running a different
  //    search than the one whose results the user is looking at.
  //  • It runs at most once per mount, so a later city change (clearDistrict) is permanent, and the
  //    in-flight catalog promise is cancelled when the city changes so a stale pick cannot land in
  //    the new city.
  //  • setDistrictsSelected uses a functional (prev.length ? prev : …) update, so a district the
  //    user picks while the catalog is loading is never clobbered.
  const districtsRehydrated = useRef(false);
  useEffect(() => {
    if (districtsRehydrated.current || !citySelected) return;
    const want = query.districts ?? [];
    if (!want.length) return;
    districtsRehydrated.current = true;
    if (districtsSelected.length) return;   // a live pick already stands — nothing to restore
    let cancelled = false;
    void ensureDistrictOptions(citySelected.cityId, effDeal, effCategory, rentPeriodTok, cohortTypes, cityTableScope).then((pool) => {
      if (cancelled) return;
      const wanted = new Set(want);
      const restored = pool.filter((d) => d.matchValues.some((v) => wanted.has(v)));
      const union = new Set(restored.flatMap((d) => d.matchValues));
      if (union.size !== wanted.size) return;              // drifted catalog → restore nothing
      for (const v of wanted) if (!union.has(v)) return;   // exact round-trip only
      setDistrictsSelected((prev) => (prev.length ? prev : restored));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citySelected, effDeal, effCategory, rentPeriodTok, cohortTypesSig, cityTableScopeSig]);

  // ONE query builder shared by onSearch and the district live-count effect below — the count call
  // and the search call must be built from the SAME state or their numbers can drift apart, which
  // is the exact bug class this exists to prevent (owner rule 2026-08-13: the number beside a
  // district = what selecting it returns, under the CURRENT filter selections). District fields are
  // deliberately absent here: onSearch adds the picked districts, the count effect overrides
  // p_districts per visible option.
  const buildFilterBaseQuery = (): SearchQuery | null => {
    if (!citySelected) return null;
    const lm = resolveCitySelection(citySelected);
    return {
      ...query,
      location: lm.label,
      locationMatch: lm,
      // effDeal reads null under combined mode, so this correctly skips the 'annual' default there too
      // (harmless either way — remote.ts's rentPeriodParam forces null whenever dealCombined is set).
      rentPeriod: effDeal === 'Rent' ? (query.rentPeriod ?? 'annual') : query.rentPeriod,
    } as SearchQuery;
  };

  // District marking must use the user's CURRENT filter state (owner, 2026-08-13). The pools behind
  // the district list (district_options_ar) know deal/category/period only — the moment any
  // narrower filter is active (نوع/مجموعة/سعر/مساحة/غرف), a district's scope count can no longer
  // stand in for "what you'd get if you picked it": measured live, with نوع=مستودع set, 10/10 of
  // Riyadh's top rent districts presented as having inventory while holding ZERO warehouses. When
  // narrowing is active, fetch the VISIBLE rows' real eligible counts from the results RPC itself
  // (fetchDistrictEligibleCounts, one p_limit:1 call per row) and mark honesty from those. When no
  // narrowing is active there are no extra calls — scope count = results count there, a parity the
  // DB barrier (mon_trending_district_barrier) pins at 40/40 exact.
  // ADVANCED answers narrow just as hard as نوع/سعر/مساحة and must be in this signature for two
  // reasons: they decide whether the live-count path runs AT ALL (an AF-only narrowing would
  // otherwise fall back to district_options_ar's deal/category/period scope count), and they must
  // INVALIDATE cached counts when an answer changes. Measured 2026-08-20 (AF major certification)
  // and re-measured 2026-08-22 on live production: Riyadh / Rent-Annual / شقة with
  // amenities=[elevator] + bathMin=3 advertised 4,449 across the top 8 districts and returned 592
  // on click — 7.5x, every row wrong in the same direction.
  // priceMinRent/priceMaxRent are the COMBINED-mode (شراء+إيجار) Rent-side budget. They were missing
  // here, so a combined search narrowed ONLY by a rent budget looked un-narrowed: hasDistrictNarrowing
  // stayed false, the live-count fetch never ran, and every district row kept district_options_ar's
  // deal/category/period scope count. Measured live: حي العارض advertised 2,914 and the search landed
  // on 1,231 (2.4x), while the CITY list on the same screen was correct — the two contradicted each
  // other in one state. The engine does apply the bound (rpcFilterParams spreads p_price_min_rent /
  // p_price_max_rent whenever dealCombined), so only the COUNT was lying. (owner Trending rule.)
  const districtNarrowingSig = JSON.stringify([query.type, query.typeGroups, query.types, query.detail,
    query.contextBeds, query.contextBedsList, query.contextSize, query.priceInput, query.priceBand,
    query.priceMin, query.priceMax, query.priceMinRent, query.priceMaxRent, query.areaMin, query.areaMax,
    // The Advanced-Filter half is ITERATED from the one list, never re-typed here. Hand-listing the
    // 11 fields meant a 12th AF predicate would silently stop invalidating these live counts — the
    // exact "advertised count disagrees with the delivered result set" class this signature exists
    // to close, re-opened by omission. AF_PREDICATE_FIELDS is pinned against the real RPC builder by
    // verify-af-survives-filter-reentry.ts, so one list stays honest for both.
    ...AF_PREDICATE_FIELDS.map((f) => query[f])]);
  const hasDistrictNarrowing = useMemo(
    () => (JSON.parse(districtNarrowingSig) as unknown[]).some((v) =>
      Array.isArray(v) ? v.length > 0 : v != null && v !== ''),
    [districtNarrowingSig]);
  // Upper bound on how many district rows get a live, filter-aware count. Must cover everything the
  // dropdown can render (matchDistrictsByCityId caps its typed matches at 30) — see the fetch below.
  const DISTRICT_COUNT_FETCH_MAX = 30;
  const [districtLiveCounts, setDistrictLiveCounts] = useState<Record<string, number> | null>(null);
  const districtLiveReq = useRef(0);
  useEffect(() => {
    // Any relevant filter change invalidates the previous counts IMMEDIATELY (stale numbers are the
    // bug, not a fallback) — then refetch for what's on screen.
    setDistrictLiveCounts(null);
    if (!citySelected || !hasDistrictNarrowing || districtSuggestions.length === 0) return;
    const id = ++districtLiveReq.current;
    const q = buildFilterBaseQuery();
    if (!q) return;
    // EVERY rendered row, not the first 12. matchDistrictsByCityId returns up to 30 typed matches and
    // all of them are rendered, so a 12-row fetch left rows 13-30 falling back to the deal/category
    // SCOPE count — presented identically to a real one, and wrong whenever a filter is active.
    // DISTRICT_COUNT_FETCH_MAX is deliberately >= that 30 so the two can't drift apart silently; the
    // render below still refuses to print a number for any row this fetch did not cover.
    const visible = districtSuggestions.slice(0, DISTRICT_COUNT_FETCH_MAX)
      .map((o) => ({ districtAr: o.districtAr, matchValues: o.matchValues }));
    void fetchDistrictEligibleCounts(q, visible).then((counts) => {
      if (id === districtLiveReq.current && counts) setDistrictLiveCounts(counts);
    });
    // buildFilterBaseQuery reads query/citySelected — both captured via the deps that matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citySelected, hasDistrictNarrowing, districtSuggestions, districtNarrowingSig]);

  // Dropdown zero-states (findings 2026-08-13, P1 + cases A/C/D/E/F/H): an empty suggestion list
  // used to render NOTHING — loading, a failed fetch, a typed no-match and a city with no
  // listing-bearing districts were all the same invisible box. Each now shows ONE small muted
  // Arabic row. English typing is excluded on purpose: that case already has its own message
  // (ARABIC_ONLY_MSG under the field) and must keep it, unchanged.
  const cityLatin = !!query.location && isLatinOnlyInput(query.location);
  const cityStatus = cityPoolStatus(effDeal, rentPeriodTok, effCategory, cohortTypes, cityAfParams);
  const cityZeroRow: 'loading' | 'error' | 'empty' | null =
    citySuggestions.length > 0 || cityLatin ? null
      : cityStatus !== 'ready' ? cityStatus
      : query.location ? 'empty' : null;
  const districtLatin = !!districtText && isLatinOnlyInput(districtText);
  const districtStatus = citySelected ? districtPoolStatus(citySelected.cityId, effDeal, effCategory, rentPeriodTok, cohortTypes, cityTableScope) : 'loading';
  const districtZeroRow: 'loading' | 'error' | 'empty' | null =
    !citySelected || districtSuggestions.length > 0 || districtLatin ? null
      : districtStatus !== 'ready' ? districtStatus
      : 'empty'; // covers both "no districts with listings" (empty focus) and a typed no-match
  // Tap-to-retry for the error row: re-run the ensure (the failed promise was evicted, so this is a
  // real refetch), and keep the box open across the tap — the row press blurs the input, so cancel
  // the pending close and put focus straight back, same pattern as districtOnPress below.
  const retryCityPool = () => {
    clearBlurTimer(cityBlurTimer);
    cityRef.current?.focus();
    setCitySuggestions([]); // fresh [] reference → re-render → the row flips to «جاري التحميل…»
    void ensureCityFieldIndex(effDeal, rentPeriodTok, effCategory, cohortTypes, cityAfParams).then(() => {
      if (cityTextRef.current) {
        const latin = isLatinOnlyInput(cityTextRef.current);
        setCitySuggestions(latin ? [] : matchCitiesByText(effDeal, rentPeriodTok, effCategory, cityTextRef.current, cohortTypes, cityAfParams));
      } else {
        setCitySuggestions(topCitiesByListings(effDeal, rentPeriodTok, effCategory, 6, cohortTypes, cityAfParams));
      }
    });
  };
  const retryDistrictPool = () => {
    if (!citySelected) return;
    const cid = citySelected.cityId;
    clearBlurTimer(districtBlurTimer);
    districtRef.current?.focus();
    setDistrictSuggestions([]);
    void ensureDistrictOptions(cid, effDeal, effCategory, rentPeriodTok, cohortTypes, cityTableScope).then(() => {
      if (districtTextRef.current) {
        const latin = isLatinOnlyInput(districtTextRef.current);
        setDistrictSuggestions(latin ? [] : matchDistrictsByCityId(cid, effDeal, effCategory, rentPeriodTok, districtTextRef.current, cohortTypes, cityTableScope));
      } else {
        setDistrictSuggestions(topDistrictsForCityId(cid, effDeal, effCategory, rentPeriodTok, 6, cohortTypes, cityTableScope));
      }
    });
  };

  const onSearch = async () => {
    // CITY-ONLY FIELD (owner spec 2026-07-17): "The user must select a valid city result. Do not
    // accept arbitrary free text and never guess a location." citySelected is cleared on every
    // keystroke (see the TextInput's onChangeText below), so its presence here means exactly one
    // thing: the CURRENT field text is an untouched, tapped-from-the-list city. Anything else
    // (empty field, hand-typed text never confirmed by a tap, a stale pick since edited) blocks the
    // search with an explanation instead of falling through to any free-text resolution — there is
    // no resolveLocation()/guessing path in this field anymore.
    if (!citySelected) {
      setLocMsg(CITY_REQUIRED_MSG);
      // The validation message sits at the top (under the City field), but Search is at the bottom of
      // the card — so bring the top into view and focus the field, otherwise the user presses Search and
      // sees nothing change. (owner UI request 2026-07-18.)
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      cityRef.current?.focus();
      return;
    }
    // DISTRICT FIELD — same "no silent drop" rule, for the optional field (2026-08-23).
    // The district box is a SEARCH box over the catalog: only a TAPPED suggestion becomes a chip in
    // districtsSelected, and only chips are ever searched. So typed-but-never-confirmed text was
    // dropped here in complete silence — reproduced live: pick الرياض, type «النرجس», the dropdown
    // offers «حي النرجس · 1,699 إعلان», press «بحث» without tapping it → the search runs city-wide
    // (36,908), no chip, no «• الحي» line in the summary, no warning, and the field still reads
    // «النرجس». That breaks the standing rule that the VISIBLE form state must equal the COMMITTED
    // request state. It is NOT fixable by resolving the text ourselves — that would be guessing a
    // location, which this screen never does (see the City rule above) — so Search stops and names
    // the two honest choices: tap the district, or clear the text and search the whole city.
    // Whitespace-only text is not a filter the user can see, so it never blocks.
    if (districtText.trim()) {
      setDistrictMsg(DISTRICT_UNCONFIRMED_MSG);
      scrollDown(districtAnchorRef);
      districtRef.current?.focus();
      return;
    }
    // Base = the SAME builder the district live-count effect uses (see buildFilterBaseQuery above) —
    // one construction site, so the counts shown and the search run can never be built from
    // different state.
    const base = buildFilterBaseQuery()!;
    // District is optional, now MULTI (owner 2026-08-10): send the UNION of every selected district's
    // matchValues (all spellings of each hamza-folded district, deduped) — the RPC's p_districts is
    // already OR over the array, ANDed with every other filter. Zero picks → districts:undefined →
    // city-only search (spec: City-only is valid). One pick serializes to exactly the same query an
    // old single-district link carries, so old links and new ones are the same shape.
    const districtMatchUnion = districtsSelected.length
      ? [...new Set(districtsSelected.flatMap((d) => d.matchValues))]
      : undefined;
    const q = {
      ...base,
      districts: districtMatchUnion,
      // Display label → drives the summary sentence. Owner 2026-08-11: ALWAYS name every picked
      // district («النرجس والياسمين والملقا»), never collapse to a count («3 أحياء») — the user
      // chose specific places and the summary must say them back. Joined with «، » and a final «و».
      districtLabel: districtsSelected.length === 0 ? undefined
        : districtsSelected.length === 1 ? districtsSelected[0].districtAr
        : `${districtsSelected.slice(0, -1).map((d) => d.districtAr).join('، ')} و${districtsSelected[districtsSelected.length - 1].districtAr}`,
      // Live count for the picked districts — for multi-select the SUM (folds are disjoint, so the
      // sum IS the union size at that scope) — so the 0-results path can tell an EMPTY area
      // ("widen area") from a type mismatch ("widen type").
      //
      // ONLY SENT WHEN IT IS ACTUALLY CATEGORY-SCOPED (2026-09-05, ops_incident #16). The consumer
      // in src/data/search.ts branches on the DOCUMENTED meaning — "the district's own count at the
      // deal/category scope" — and that is the only meaning that can separate the two cases: a count
      // over ALL types is what tells you the area has listings but not YOURS. Since the district
      // picker became type-scoped (`p_types` in ensureDistrictOptions, sharpened again by the
      // 2026-09-03 af_eligibility_clause migration) these counts are per-TYPE, which INVERTS both
      // branches: a حي full of villas with zero apartments reports 0 and is diagnosed as an empty
      // AREA, so the user is offered a wider area when the area was never the problem — and after a
      // «تصفية» round-trip the same search can answer differently depending on whether a نوع was
      // selected yet.
      //
      // The picker's own counts must STAY type-scoped — that is what the user is choosing between,
      // and it is what makes the number beside each حي true. So the diagnosis simply declines to
      // speak when it has no category-scoped number to speak from: `undefined` makes
      // noResultsSuggestion fall through to its generic probes, which re-count against the real pool
      // and are correct in both cases. A message we cannot ground is worse than the general one.
      districtListingCount: districtsSelected.length && !(cohortTypes && cohortTypes.length)
        ? districtsSelected.reduce((sum, d) => sum + d.listingCount, 0)
        : undefined,
    };
    // PERSIST the picked districts into the app context before navigating (2026-08-14).
    // Every OTHER control (المدينة, السعر, المساحة, غرف النوم, فئة/نوع) writes itself into `query` as
    // the user edits, which is why the form comes back filled when «تصفية» is reopened. The districts
    // did NOT: they lived only in the local districtsSelected array and were merged into `q` right
    // here, at search time, and handed to navigateWithQuery — which only serialises them into the
    // /agent?filter=… URL. So `query.districts` was ALWAYS empty on the filter screen, the reopened
    // form had nothing to restore from, and pressing «بحث» untouched silently widened the search from
    // the chosen حي to the whole city. Writing them to the same place every sibling field already
    // lives is what makes the rehydration effect above able to see them at all.
    setQuery((prev) => ({
      ...prev,
      districts: q.districts,
      districtLabel: q.districtLabel,
      districtListingCount: q.districtListingCount,
    }));
    navigateWithQuery(q);
  };

  // Shared "play the here-we-go backdrop lift, then open results" navigation — used by the Search
  // button (above) and by the proactive Trending chips below (which search immediately on tap).
  //
  // NAVIGATION IS NEVER GATED ON THE ANIMATION (bug fix 2026-08-07: "I press بحث and nothing
  // happens"). This used to live entirely inside `.start(callback)`. On web, RNAnimated is driven by
  // requestAnimationFrame — `useNativeDriver` is a no-op there — and the browser FREEZES rAF whenever
  // the tab is backgrounded, the window is minimised, or the OS throttles for power. The timing then
  // never completes, its completion callback never fires, and Search silently does nothing at all: no
  // navigation, no error, no spinner. Reproduced live with rAF stalled — SEARCH_PRESSED fired and the
  // app was still sitting on `/` 10s later.
  // Fix: runAfterAnimation() plays the backdrop lift but drives the navigation from a timer too, so
  // the user always lands on their results. See src/lib/afterAnimation.ts — the exactly-once
  // behaviour is unit-tested there against an animation that never completes.
  const navigateWithQuery = (q: SearchQuery) => {
    runAfterAnimation(
      (onFinished) => RNAnimated.timing(heroAnim, {
        toValue: 1,
        duration: 300,
        easing: RNEasing.out(RNEasing.cubic),
        useNativeDriver: true,
      }).start(onFinished),
      () => {
        // Search is FREE, always (owner rule 2026-08-15): no auth gate may ever sit between the
        // Search button and results. verify-search-is-free.ts fails the build if one comes back.
        // The user SENT something — the small sign-in card retires for the rest of this load
        // (owner 2026-08-29). Placed on the successful path only: a blocked submit (no city
        // picked) is not a send. Note the card never gated this search either way.
        dismissSignInCard();
        router.push({ pathname: '/agent', params: { filter: JSON.stringify(q) } });
      },
      320,
    );
  };

  // Note #3 — try the OS share sheet FIRST when it exists (native device share is the most natural
  // option) and fall back to the in-app multi-target sheet. On desktop the OS sheet is usually
  // unavailable, so the in-app sheet (WhatsApp / X / Telegram / Mail / Copy Link, fully localized)
  // is what users see. (user request.)
  const onShare = async () => {
    const shared = await shareNative();
    if (!shared) setShareOpen(true);
  };

  const detail = query.type ? detailFor(query.type) : null;
  // Context-level detail: shown at category/group level when no specific type is selected.
  const ctx = !query.type ? detailForContext(query.category, effectiveGroups(query)) : null;
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
  // Rent-side budget (dealCombined only) — same convention as priceMin/priceMaxValue above.
  const priceMinRentValue = query.priceMinRent ? grouped(parseInt(query.priceMinRent, 10) || 0) : '';
  const priceMaxRentValue = query.priceMaxRent ? grouped(parseInt(query.priceMaxRent, 10) || 0) : '';
  // Non-blocking helper notes under the Price / Area inputs (explain min>max, equal, 0=no-limit, one-sided).
  const priceHint = rangeHint(query.priceMin, query.priceMax, PRICE_HINT, grouped);
  const priceRentHint = rangeHint(query.priceMinRent, query.priceMaxRent, PRICE_HINT, grouped);
  const areaHint = rangeHint(query.areaMin, query.areaMax, AREA_HINT, grouped);
  const sizeBoxValue = !detail || detail.isBedrooms || !query.detail
    ? ''
    : sizeIsBand
      ? tDetailOption(query.detail!).replace(/\s*(m²|م²)\s*$/u, '').trim()
      : grouped(parseInt(query.detail!, 10) || 0); // free-typed number → comma-grouped
  // (rentPeriod / rentPeriodTok are derived higher up now — the warm effects above depend on them.)

  // Selection "achievement" confirmation for the City / District fields (owner UI request 2026-07-18):
  // on confirming a pick the field does a subtle scale pop, its border settles to green, and a green
  // checkmark scales/fades in — so choosing a location feels like completing a step. Mirrors the
  // OptionBox/Segmented "pop + settle" vocabulary; driven with RN Animated on the JS driver (web is the
  // ship target and we animate border colour, which the native driver can't).
  const cityPop = useRef(new RNAnimated.Value(0)).current;       // 0→1→0 one-shot scale pulse
  const citySel = useRef(new RNAnimated.Value(0)).current;       // 0/1 persistent: green border + checkmark
  const districtPop = useRef(new RNAnimated.Value(0)).current;
  const districtSel = useRef(new RNAnimated.Value(0)).current;
  const confirmPop = useCallback((pop: RNAnimated.Value) => {
    pop.setValue(0);
    RNAnimated.sequence([
      RNAnimated.timing(pop, { toValue: 1, duration: 130, easing: RNEasing.out(RNEasing.quad), useNativeDriver: false }),
      RNAnimated.spring(pop, { toValue: 0, stiffness: 210, damping: 9, mass: 0.5, useNativeDriver: false }),
    ]).start();
  }, []);
  useEffect(() => {
    RNAnimated.timing(citySel, { toValue: citySelected ? 1 : 0, duration: citySelected ? 220 : 140, easing: RNEasing.out(RNEasing.cubic), useNativeDriver: false }).start();
    if (citySelected) confirmPop(cityPop);
  }, [citySelected, citySel, cityPop, confirmPop]);
  // Multi-select keeps the exact same confirmation vocabulary (owner: "don't forget the animation"):
  // the green border + checkmark persist while ≥1 district is picked, and the one-shot scale pop
  // replays on every ADDITION — each new district feels like completing a step, exactly like the
  // single-select did. Removals (and clears) don't pop; the border just settles back when the last
  // pick goes. prevDistrictCount is a ref, not state — it only gates the pop.
  const prevDistrictCount = useRef(0);
  useEffect(() => {
    const n = districtsSelected.length;
    RNAnimated.timing(districtSel, { toValue: n > 0 ? 1 : 0, duration: n > 0 ? 220 : 140, easing: RNEasing.out(RNEasing.cubic), useNativeDriver: false }).start();
    if (n > prevDistrictCount.current) confirmPop(districtPop);
    prevDistrictCount.current = n;
  }, [districtsSelected, districtSel, districtPop, confirmPop]);
  // Field style while/after a pick is confirmed: a scale overshoot (one-shot) + the border easing to
  // green (persistent while selected). `sel` is the 0/1 persistent value, `pop` the one-shot pulse.
  // Literal palette: RN Animated color interpolation PARSES its output range and cannot digest the
  // var() theme tokens — same rule as ui.tsx's interpolateColor sites.
  const pal = useThemePalette();
  const confirmFieldStyle = (pop: RNAnimated.Value, sel: RNAnimated.Value) => ({
    transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] }) }],
    borderColor: sel.interpolate({ inputRange: [0, 1], outputRange: [pal.fieldLine, pal.primary] }),
  });
  const checkStyle = (sel: RNAnimated.Value) => ({
    opacity: sel,
    transform: [{ scale: sel.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
  });

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
                <Pressable
                  style={s.hamb}
                  hitSlop={8}
                  // hitSlop is a NO-OP on react-native-web; the 44px floor comes from
                  // TAP_TARGET_CSS via this marker (ops_incident #17).
                  // @ts-expect-error web-only DOM props on the RNW host node
                  dataSet={{ ...TAP44 }}
                  onPress={() => setSidebarOpen(true)}
                >
                  <Ionicons name="menu" size={22} color={colors.ink} />
                </Pressable>
                <Text ref={noTranslateRef} style={s.topBrand}>{t('Ezhalah')}</Text>
              </View>
            ) : null}
            <View style={s.topRight}>
              {/* Logged-out users always see a sign-in action in the top bar (owner 2026-08-19).
                  On desktop the docked sidebar already shows it; on mobile the sidebar is a drawer,
                  so without this the sign-in CTA is invisible until the hamburger is tapped. */}
              {!user && !docked && (
                <Pressable
                  style={s.topSignIn}
                  onPress={openAuth}
                  hitSlop={6}
                  // @ts-expect-error web-only DOM props on the RNW host node
                  dataSet={{ ...TAP44 }}
                >
                  <Ionicons name="person-outline" size={15} color="#fff" />
                  <Text style={s.topSignInText}>{t('Sign up / Log in')}</Text>
                </Pressable>
              )}
              <Pressable
                style={({ pressed }) => [s.shareBtn, pressed && s.shareBtnPressed]}
                hitSlop={8}
                onPress={onShare}
                onPressIn={() => shareSpring(0.94)}
                onPressOut={() => shareSpring(1)}
              >
                <RNAnimated.View style={{ transform: [{ scale: shareScale }] }}>
                  <Ionicons name="share-outline" size={19} color={colors.chipIcon} />
                </RNAnimated.View>
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

          {/* Filter / AI Agent — the hero's focal choice: centered between the headline and the search
              card so opening Ezhalah reads as "pick how you search," then flows into the card. Moved
              here from the top-right corner. (owner redesign 2026-07-24 r3.) */}
          {/* REPLACE, never push (defect fix 2026-08-23): the pill is a MODE TOGGLE between two peer
              screens, not a step into a child screen — and the return trip (agent.tsx's ModeSwitch)
              has always been router.replace('/'). Pushing on the way out and replacing on the way
              back left the pushed /agent slot occupied by a duplicate '/', so every Filter→AI→Filter
              round trip added a junk history entry and leaked another mounted Filter screen: the
              Back button then just re-showed the same page N times before leaving the site. Both
              halves of the toggle replace, so toggling costs no history and mounts no duplicates.
              (Search «بحث» still PUSHES — results ARE a child of the form; see onSearch above.) */}
          <RNAnimated.View style={[s.modeWrap, reveal(badgeAnim, 12)]}>
            <ModeSwitch active="filter" onSwitch={() => router.replace('/agent')} t={t} />
          </RNAnimated.View>

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
            {/* THE ADVANCED FILTER ANSWERS CARRIED IN FROM THE CHAT (owner P0 2026-09-01).
                THIS IS NOT DECORATION — it is what licenses the carry to exist at all.
                sanitizeForFilterRestore is a strict allowlist of "what the Filter UI can actually
                show", written for a measured P1: an AF predicate active with no on-screen control
                silently amputated an unrelated search (a leaked ratingMin returned 0 of 11,552 on
                الرياض/شراء/فيلا). The owner's requirement — every committed AF predicate must survive
                a return to this screen — is only reconcilable with that rule by SHOWING them here and
                letting the user remove any of them. Removing one rebuilds the query from the
                remaining facets through each question's own apply(), exactly like the chat's pills.
                Same «بناءً على» summary text the user already read in the chat, so the two screens
                describe one search in one voice.
                SCOPE facets (group/type) are absent because reconcileCommittedAf does not carry
                them at all — the group boxes and type boxes below already ARE their control, and a
                receipt whose predicate has a live control is not a receipt, it is a second writer
                fighting the user (it re-applied itself over every scope edit; see @/lib/afCarry).
                So `query.afFacets` here is exactly the advanced answers, and chip index i is facet
                index i — which is what lets the «×» below hand `i` straight to withoutFacet(). */}
            {query.afFacets?.length ? (
              <Reveal>
                <View style={s.afCarryWrap}>
                  <Text style={[s.afCarryLead, { textAlign: isRTL ? 'right' : 'left' }]}>{buildAfSummary(query.afFacets)}</Text>
                  <View style={[s.afCarryRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                    {query.afFacets.map((f, i) => (
                      <Pressable
                        key={`${f.id}-${i}`}
                        testID={`filter-af-chip-${i}`}
                        style={s.afCarryChip}
                        hitSlop={6}
                        // Removed from the RECONCILED list this row is rendered from, never from the
                        // raw store list — a facet the cohort already retired would otherwise shift
                        // the indexes and a «×» would delete somebody else's answer. Writing the
                        // reconciled query back is the same commit the user just made on screen.
                        onPress={() => setQuery(() => withoutFacet(query, i, AF_ALL_QUESTIONS))}
                      >
                        <Text style={s.afCarryChipTx}>{f.labels.join('، ')}</Text>
                        <Ionicons name="close" size={13} color={colors.primary} />
                      </Pressable>
                    ))}
                  </View>
                </View>
              </Reveal>
            ) : null}
            {/* شراء / إيجار — TWO independent toggle buttons, not a radio (owner feature 2026-08-20,
                mirrors the already-shipped سنوي+شهري pattern exactly): both can be on at once, which
                means "match either Buy or Rent — Rent side accepts both Annual and Monthly." No third
                "both" button exists; toggleDealButton enforces at-least-one-selected the same way
                togglePeriodButton does for the period pair. */}
            <View style={s.row}>
              {(['Buy', 'Rent'] as const).map((which) => (
                <OptionBox
                  key={which}
                  label={t(which)}
                  img={DEAL_IMG[which]}
                  selected={query.dealCombined || query.deal === which}
                  onPress={() => {
                    const nextSel = toggleDealButton(dealSelectionFromQuery(query), which);
                    const nextFields = dealSelectionToQuery(nextSel, query.deal);
                    setQuery((q) => {
                      // What priceMin/priceMax currently means (Buy budget under Buy-only/Combined,
                      // Rent budget under Rent-only) vs. what it will mean after this press — clear
                      // only when that flips, same "unit changed" rule the period toggle uses.
                      const prevAppliesTo = q.dealCombined ? 'Buy' : q.deal;
                      const nextAppliesTo = nextFields.dealCombined ? 'Buy' : nextFields.deal;
                      const flips = prevAppliesTo !== nextAppliesTo;
                      const leavingCombined = q.dealCombined && !nextFields.dealCombined;
                      return {
                        ...q,
                        ...nextFields,
                        ...(flips ? { priceMin: null, priceMax: null, priceBand: null, priceInput: '' } : {}),
                        // Leaving Combined drops the now-hidden, now-inert Rent-side budget box —
                        // stale-state hygiene (owner barrier: no stale state can survive a deal-mode
                        // transition), never silently carried forward into a mode that can't show it.
                        ...(leavingCombined ? { priceMinRent: null, priceMaxRent: null } : {}),
                      };
                    });
                    scrollDown(cityAnchorRef);
                  }}
                />
              ))}
            </View>
            {/* Deal-pair helper (owner 2026-08-22). The old note here was a RED WARNING that fired
                whenever the price basis flipped — which includes the ordinary Buy→Rent switch, so a
                user who simply wanted Rent got a scary "limits were cleared" message about a budget
                they had usually never typed. Buy-only and Rent-only now say NOTHING. The only state
                that genuinely needs explaining is the combined one, where the two deals really do
                keep SEPARATE budgets (Buy budget + Rent budget boxes below), and that is said once,
                calmly, in muted helper type — never as an error. The clearing LOGIC is unchanged. */}
            {query.dealCombined ? (
              <Text style={s.rangeNote}>{t('When you choose Buy and Rent together, each one has its own budget.')}</Text>
            ) : null}

            <View ref={withAnchor(cityAnchorRef)} />

            {/* Rent period — سنوي / شهري ONLY (owner request 2026-08-19: no third «كلاهما» button).
                Each is an INDEPENDENT toggle, not a radio — both can be on at once, which reaches the
                exact same 'both' query value (and the already-proven كلاهما backend architecture,
                docs/ARCHITECTURE.md §17) the old third button used to set explicitly. MOVED here,
                directly above the City field (owner request 2026-07-21): the user picks the period
                FIRST, then the Trending chips + City/District suggestions all reflect it. Rent-only
                (Buy has no period). Still tells the engine which period a later typed price/size means.
                HIDDEN under dealCombined (owner 2026-08-20): combined mode's Rent side already accepts
                both periods automatically — "do not ask the user to choose Annual vs Monthly first in
                this mode." */}
            {query.deal === 'Rent' && !query.dealCombined && (
              <Reveal style={{ marginTop: 12 }}>
                <View style={s.row}>
                  {(['annual', 'monthly'] as const).map((which) => (
                    <OptionBox
                      key={which}
                      label={t(which === 'monthly' ? 'Monthly' : 'Yearly')}
                      img={PERIOD_IMG[which === 'monthly' ? 'Monthly' : 'Yearly']}
                      selected={which === 'monthly' ? rentPeriod === 'monthly' || rentPeriod === 'both'
                                                     : rentPeriod === 'annual' || rentPeriod === 'both'}
                      onPress={() => {
                        const next = togglePeriodButton(rentPeriod, which);
                        // Monthly↔Yearly inverts what a typed price MEANS (3,000/شهري ≠ 3,000/سنوي).
                        // Same rule as the Buy↔Rent toggle above: never silently keep bounds whose unit
                        // just changed — clear them and say why. (audit item 3, owner rule 2026-07-27.)
                        setQuery((q) => {
                          if ((q.rentPeriod ?? 'annual') === next) return q; // no-op: same value, or the guard button
                          const hadPrice = !!(q.priceMin || q.priceMax || q.priceInput || q.priceBand);
                          setPeriodPriceCleared(hadPrice);
                          return hadPrice
                            ? { ...q, rentPeriod: next, priceMin: null, priceMax: null, priceInput: '', priceBand: null }
                            : { ...q, rentPeriod: next };
                        });
                      }}
                    />
                  ))}
                </View>
                <Text style={s.rentHint}>
                  {t(rentPeriod === 'monthly' ? 'Monthly: the displayed price is the monthly price.'
                    // Owner feedback (2026-08-22): drop the "this means you want both, so you get
                    // both" framing — selecting both buttons is already self-explanatory. Keep only
                    // the one genuinely non-obvious fact: mixed results show mixed price units.
                    : rentPeriod === 'both' ? 'Each listing shows its own price basis (monthly or yearly).'
                    : 'Yearly: the displayed price is the yearly price.')}
                </Text>
                {periodPriceCleared && !query.priceMin && !query.priceMax && !query.priceInput ? (
                  <Text style={[s.rangeNote, s.rangeNoteWarn]}>{t('Price limits were cleared because the price unit changed (monthly ↔ yearly) — please re-enter them.')}</Text>
                ) : null}
              </Reveal>
            )}

            {/* CITY-ONLY FIELD (owner spec 2026-07-17): "أي مدينة؟". Field now searches/displays CITIES
                ONLY, never regions/districts/landmarks/areas. The label sits ABOVE the field, far-right
                (RTL) — a static header, not a floating placeholder. (owner UI request 2026-07-18.)
                The whole box is a tap target — tapping anywhere inside focuses the input. */}
            <Text style={[s.fieldLabelAbove, { marginTop: 12 }]}>{t('Which city?')}</Text>
            <AnimatedPressable style={[s.field, confirmFieldStyle(cityPop, citySel)]} onPress={() => cityRef.current?.focus()}>
              {/* Selected-value identity (2026-08-14): once a city is confirmed the leading glyph is
                  the SAME designed city art the suggestion rows carry (LOC_IMG.city) — the pick
                  visibly "becomes" the thing that was tapped. Unselected keeps the neutral pin. */}
              {citySelected ? (
                <Image testID="selected-city-visual" source={LOC_IMG.city} style={s.fieldLocIcon} />
              ) : (
                <Ionicons name="location-outline" size={18} color={colors.muted} />
              )}
              <View style={s.flWrap}>
                <TextInput
                  ref={cityRef}
                  testID="city-input"
                  style={s.flInput}
                  value={query.location}
                  autoCorrect={false}
                  onFocus={() => {
                    clearBlurTimer(cityBlurTimer); // P3: a pending close from a just-blurred state must not outlive the refocus
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
                      void ensureCityFieldIndex(effDeal, rentPeriodTok, effCategory, cohortTypes, cityAfParams).then(() => {
                        if (!cityTextRef.current) setCitySuggestions(topCitiesByListings(effDeal, rentPeriodTok, effCategory, 6, cohortTypes, cityAfParams));
                      });
                    } else {
                      // P2 fix: the field already holds text (a confirmed pick, or mid-typing
                      // refocus) — populate its matches from the cache instead of opening nothing.
                      // Suggestions only otherwise arrive via onChangeText, so a tap on a prefilled
                      // field used to show an empty box until a keystroke. English text keeps the
                      // existing behavior exactly (no autocomplete; the Arabic-only hint stands).
                      if (!isLatinOnlyInput(query.location)) {
                        setCitySuggestions(matchCitiesByText(effDeal, rentPeriodTok, effCategory, query.location, cohortTypes, cityAfParams));
                      }
                    }
                  }}
                  onBlur={() => { cityBlurTimer.current = setTimeout(() => setCityFocus(false), 150); }}
                  onChangeText={(v) => {
                    cityTextRef.current = v;
                    setQuery((q) => ({ ...q, location: v }));
                    // Any edit invalidates a prior tap — a stale selection must never be silently
                    // reused (spec: "never guess a location").
                    setCitySelected(null);
                    clearDistrict(); // editing the city disables + clears District (no cross-city carry-over)
                    if (!v) {
                      // Cleared back to empty → the Top 6 list, same as a fresh focus.
                      setCitySuggestions(topCitiesByListings(effDeal, rentPeriodTok, effCategory, 6, cohortTypes, cityAfParams));
                      setLocMsg('');
                      return;
                    }
                    // Arabic-only product: English typing gets NO autocomplete and an Arabic hint —
                    // there is nothing to match against, since every city name here is Arabic. (user rule)
                    const latin = isLatinOnlyInput(v);
                    setCitySuggestions(latin ? [] : matchCitiesByText(effDeal, rentPeriodTok, effCategory, v, cohortTypes, cityAfParams));
                    setLocMsg(latin ? ARABIC_ONLY_MSG : '');
                  }}
                />
              </View>
              {/* Confirmed pick → a green checkmark scales/fades in (owner UI request). */}
              {citySelected ? (
                <RNAnimated.View style={checkStyle(citySel)} pointerEvents="none">
                  <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                </RNAnimated.View>
              ) : null}
              {query.location.length > 0 && (
                <Pressable onPress={() => { cityTextRef.current = ''; setQuery((q) => ({ ...q, location: '' })); setCitySelected(null); clearDistrict(); setCitySuggestions(topCitiesByListings(effDeal, rentPeriodTok, effCategory, 6, cohortTypes, cityAfParams)); setLocMsg(''); cityRef.current?.focus(); }} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.muted} />
                </Pressable>
              )}
            </AnimatedPressable>

            {locMsg ? (
              <Text style={{ color: colors.danger, fontSize: 13, marginTop: 6, textAlign: 'right' }}>{locMsg}</Text>
            ) : null}

            {/* Merge note (2026-07-20): outer open/close wrapper is PR #156's DropdownReveal; inner
                Trending-vs-plain-list split is this branch's content. Content is byte-identical to
                each side's own version — only the boundary between them moved. */}
            <DropdownReveal visible={cityFocus && (citySuggestions.length > 0 || cityZeroRow != null)}>
              {(() => {
                // Trending treatment ONLY for the empty-focus Top-6 — a typed/filtered result set keeps
                // today's plain list (a fast-scan moment, not a "discovery" one). Derived, not separate
                // state: the Top-6 is precisely what's showing whenever there's no typed text.
                const isTop6 = !query.location;
                const cityOnPress = (opt: CityOption) => {
                  clearBlurTimer(cityBlurTimer); // P3: the row press blurred the input — its close timer must not fire later
                  cityTextRef.current = opt.cityAr;
                  setQuery((q) => ({ ...q, location: opt.cityAr }));
                  setCitySelected(opt);
                  setCitySuggestions([]);
                  setCityFocus(false);
                  setLocMsg('');
                  // New city → drop any prior district; the [query.deal, effCategory, citySelected]
                  // effect above warms THIS city's district catalog so District shows its Top-6 instantly.
                  clearDistrict();
                  scrollDown(districtAnchorRef); // carry them down to the next step (district)
                };
                return (
                  <ScrollView style={s.suggBox} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {cityZeroRow ? (
                      // ONE muted Arabic row — never an invisible box (findings P1). Error taps retry.
                      cityZeroRow === 'error' ? (
                        <Tappable style={s.suggRow} onPress={retryCityPool}>
                          <Text style={s.suggStatusText}>{t('Could not load the list — tap to retry')}</Text>
                        </Tappable>
                      ) : (
                        <View style={s.suggRow}>
                          <Text style={s.suggStatusText}>
                            {cityZeroRow === 'loading' ? t('Loading…') : t('No matching city — pick from the list')}
                          </Text>
                        </View>
                      )
                    ) : isTop6 ? (
                      <>
                        <TrendingHeader title={t('Trending cities now')} />
                        <TrendingRows
                          items={citySuggestions.map((opt) => ({
                            key: String(opt.cityId),
                            label: opt.cityAr,
                            // count + honest cohort share (owner, 2026-08-15); region only on a real
                            // display-name collision (e.g. الهفوف ×2), prepended so it stays visible.
                            sublabel: [
                              hasNameCollision(citySuggestions, opt.cityAr) ? opt.regionAr ?? undefined : undefined,
                              cohortCountLabel(opt.listingCount),
                            ].filter(Boolean).join(' · ') || undefined,
                            icon: LOC_IMG.city, // restored designed art (see TrendingList.tsx note)
                          }))}
                          onPress={(_item, i) => cityOnPress(citySuggestions[i])}
                        />
                      </>
                    ) : (
                      citySuggestions.map((opt, i) => (
                        <Tappable
                          key={opt.cityId}
                          dip={0.03}
                          style={[s.suggRow, i < citySuggestions.length - 1 && s.suggDivider]}
                          onPress={() => cityOnPress(opt)}
                        >
                          <Image source={LOC_IMG.city} style={s.suggLocIcon} />
                          <View style={{ flex: 1 }}>
                            <Text style={s.suggCity}>{opt.cityAr}</Text>
                            {/* Region stays hidden per spec ("use the confirmed hidden region internally")
                                UNLESS two results in this exact list share a display name — a real,
                                verified case (e.g. الهفوف exists as two distinct real cities) — in which
                                case showing it is the only way the user can tell them apart. */}
                            {(() => {
                              const parts = [
                                hasNameCollision(citySuggestions, opt.cityAr) ? opt.regionAr ?? undefined : undefined,
                                cohortCountLabel(opt.listingCount),
                              ].filter(Boolean);
                              return parts.length ? <Text style={s.suggDist}>{parts.join(' · ')}</Text> : null;
                            })()}
                          </View>
                        </Tappable>
                      ))
                    )}
                  </ScrollView>
                );
              })()}
            </DropdownReveal>

            {/* DISTRICT — strictly under City. Disabled until a city is chosen; scoped to that city's
                canonical city_id. Empty focus → Top-6 by active-listing count; typing → the COMPLETE
                canonical district catalog for that city (incl. zero-listing). Another city's districts
                can never appear (data is fetched per city_id); changing the city clears it. Optional. */}
            {/* Static label above, far-right (RTL): "أي حي؟" with a lighter "اختياري" beside it — the
                optional-ness is its own label, not baked into the field placeholder. (owner UI request.) */}
            <View ref={withAnchor(districtAnchorRef)} />
            <Text style={[s.fieldLabelAbove, { marginTop: 12 }]}>
              {t('Which neighborhood?')}
              {'  '}
              <Text style={s.fieldLabelOptional}>{t('Optional')}</Text>
            </Text>
            {/* Multi-select capability line (owner copy, 2026-08-10) — shown once the field is usable. */}
            {citySelected ? (
              <Text style={s.districtMultiHint}>{t('You can pick more than one neighborhood')}</Text>
            ) : null}
            <AnimatedPressable
              style={[s.field, confirmFieldStyle(districtPop, districtSel), !citySelected && { opacity: 0.5 }]}
              // P7 (findings): tapping the disabled district field used to be a silent no-op — the
              // 0.5 opacity + placeholder stay as the signals, but the tap itself now lands the user
              // in the CITY field, the one step that unlocks this one.
              onPress={() => { if (citySelected) districtRef.current?.focus(); else cityRef.current?.focus(); }}
            >
              <Image source={LOC_IMG.district} style={{ width: 18, height: 18, resizeMode: 'contain' }} />
              <View style={s.flWrap}>
                <TextInput
                  ref={districtRef}
                  testID="district-input"
                  editable={!!citySelected}
                  style={s.flInput}
                  placeholder={citySelected ? '' : t('Select a city first')}
                  placeholderTextColor={colors.muted}
                  value={districtText}
                  autoCorrect={false}
                  onFocus={() => {
                    if (!citySelected) return;
                    clearBlurTimer(districtBlurTimer); // P3 — same stale-close guard as the city field
                    setDistrictFocus(true);
                    // Empty focus → Top-6 popular districts in the chosen city. Same race-guard as the
                    // city field: the options load async (though usually pre-warmed on city select), so
                    // re-check the live text via districtTextRef before showing the Top-6.
                    if (!districtTextRef.current) {
                      const cid = citySelected.cityId;
                      void ensureDistrictOptions(cid, effDeal, effCategory, rentPeriodTok, cohortTypes, cityTableScope).then(() => {
                        if (!districtTextRef.current) setDistrictSuggestions(topDistrictsForCityId(cid, effDeal, effCategory, rentPeriodTok, 6, cohortTypes, cityTableScope));
                      });
                    } else if (!isLatinOnlyInput(districtTextRef.current)) {
                      // P2 — refocusing mid-typing shows the current matches, not an empty box.
                      setDistrictSuggestions(matchDistrictsByCityId(citySelected.cityId, effDeal, effCategory, rentPeriodTok, districtTextRef.current, cohortTypes, cityTableScope));
                    }
                  }}
                  onBlur={() => { districtBlurTimer.current = setTimeout(() => setDistrictFocus(false), 150); }}
                  onChangeText={(v) => {
                    districtTextRef.current = v;
                    setDistrictText(v);
                    // Multi-select: typing NEVER touches the confirmed picks — the text is only a
                    // search box over the catalog now; picks live as chips below and only chips are
                    // searched. (The old "editing invalidates the pick" rule protected against a
                    // typed-but-unconfirmed string being searched; that stays true by construction,
                    // since districtText itself is never sent anywhere.)
                    if (!citySelected) return;
                    if (!v) { setDistrictSuggestions(topDistrictsForCityId(citySelected.cityId, effDeal, effCategory, rentPeriodTok, 6, cohortTypes, cityTableScope)); setDistrictMsg(''); return; }
                    // Arabic-only product: English typing gets NO autocomplete and the same Arabic hint the
                    // City field shows — every district name here is Arabic, so there is nothing to match. (owner UI request.)
                    const latin = isLatinOnlyInput(v);
                    setDistrictSuggestions(latin ? [] : matchDistrictsByCityId(citySelected.cityId, effDeal, effCategory, rentPeriodTok, v, cohortTypes, cityTableScope));
                    setDistrictMsg(latin ? ARABIC_ONLY_MSG : '');
                  }}
                />
              </View>
              {/* ≥1 confirmed pick → the green checkmark scales/fades in (owner UI request). */}
              {districtsSelected.length > 0 ? (
                <RNAnimated.View style={checkStyle(districtSel)} pointerEvents="none">
                  <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                </RNAnimated.View>
              ) : null}
              {districtText.length > 0 && (
                <Pressable onPress={() => {
                  // Clears the TYPED text only — confirmed picks are removed via their own chip ✕
                  // below, so wiping a half-typed search can never throw away the user's selections.
                  districtTextRef.current = '';
                  setDistrictText('');
                  setDistrictMsg('');
                  if (citySelected) setDistrictSuggestions(topDistrictsForCityId(citySelected.cityId, effDeal, effCategory, rentPeriodTok, 6, cohortTypes, cityTableScope));
                  districtRef.current?.focus();
                }} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.muted} />
                </Pressable>
              )}
            </AnimatedPressable>

            {/* Selected districts — always-visible removable chips, so the user can see exactly what
                they picked whether it came from Trending or typed search. Same chip vocabulary as the
                rest of the app (chipFill/chipLine); ✕ removes just that district. */}
            {districtsSelected.length > 0 ? (
              <View style={s.districtChipsRow}>
                {districtsSelected.map((d) => (
                  <View key={d.districtAr} testID="district-chip" style={s.districtChip}>
                    {/* Same designed district art as the rows the pick came from (2026-08-14). Fixed
                        14px; the TEXT is what shrinks at narrow widths (flexShrink on the style), so
                        the image can never be the thing that overflows the chip row. */}
                    <Image source={LOC_IMG.district} style={s.districtChipIcon} />
                    <Text style={s.districtChipText} numberOfLines={1}>{d.districtAr}</Text>
                    <Pressable onPress={() => toggleDistrict(d)} hitSlop={8}>
                      <Ionicons name="close-circle" size={16} color={colors.chipIcon} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}

            {districtMsg ? (
              <Text style={{ color: colors.danger, fontSize: 13, marginTop: 6, textAlign: 'right' }}>{districtMsg}</Text>
            ) : null}

            {/* Merge note (2026-07-20): outer open/close wrapper is PR #156's DropdownReveal; inner
                Trending-vs-plain-list split is this branch's content — same pattern as City above. */}
            <DropdownReveal visible={citySelected != null && districtFocus && (districtSuggestions.length > 0 || districtZeroRow != null)}>
              {(() => {
                // Same derived Top-6-vs-typed split as the City field above.
                const isTop6 = !districtText;
                // MULTI-SELECT tap = toggle, and the dropdown STAYS OPEN so the user can keep
                // picking (the whole point of multi-select — closing after each tap would make
                // picking 3 districts take 3 open-the-dropdown round-trips). Typed text clears on
                // pick so the list falls back to Trending and the next search starts clean. The
                // dropdown closes the way every dropdown here closes: tapping away (onBlur). No
                // auto-scroll to Category — we can't know the user is done picking.
                // P4 fix (findings): "stays open" was only a comment before — on web the row press
                // BLURS the input, arming the 150ms close timer, so the list vanished after the
                // first pick. Cancel that timer and put focus straight back on the input; now the
                // contract above is actually true.
                const districtOnPress = (opt: DistrictOption) => {
                  clearBlurTimer(districtBlurTimer);
                  districtRef.current?.focus();
                  toggleDistrict(opt);
                  districtTextRef.current = '';
                  setDistrictText('');
                  setDistrictMsg('');
                  if (citySelected) setDistrictSuggestions(topDistrictsForCityId(citySelected.cityId, effDeal, effCategory, rentPeriodTok, 6, cohortTypes, cityTableScope));
                };
                const selectedLabels = new Set(districtsSelected.map((d) => d.districtAr));
                return (
                  <ScrollView style={s.suggBox} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {districtZeroRow ? (
                      // ONE muted Arabic row — the district mirror of the city zero-states above.
                      districtZeroRow === 'error' ? (
                        <Tappable style={s.suggRow} onPress={retryDistrictPool}>
                          <Text style={s.suggStatusText}>{t('Could not load the list — tap to retry')}</Text>
                        </Tappable>
                      ) : (
                        <View style={s.suggRow}>
                          <Text style={s.suggStatusText}>
                            {districtZeroRow === 'loading' ? t('Loading…') : t('No districts available in this city right now')}
                          </Text>
                        </View>
                      )
                    ) : isTop6 && citySelected ? (
                      <>
                        <TrendingHeader title={`${t('Trending districts in')} ${citySelected.cityAr}`} />
                        <TrendingRows
                          items={districtSuggestions.map((opt, i) => ({
                            key: `${opt.districtAr}#${i}`,
                            label: opt.districtAr,
                            // Honest zero under the CURRENT filter state (owner 2026-08-13): when a
                            // narrower filter is active and this district's LIVE eligible count is 0,
                            // say so in Arabic — same message the typed list already uses — instead of
                            // presenting a popular-at-category-scope district that would dead-end.
                            // THE NUMBER MUST BE THE ONE THE USER WILL LAND ON (owner 2026-08-22).
                            // districtLiveCounts is this district's count under the FULL current
                            // filter state, fetched from the results RPC itself; opt.listingCount is
                            // only the deal/category/period SCOPE count. Until now the live value was
                            // consulted solely to detect zero, so a narrowed search still displayed the
                            // scope number — measured live with 3 beds + 120-180 m² + 70k-100k, حي
                            // النرجس advertised 1,064 while the whole CITY had 705 eligible listings.
                            // Prefer the live count whenever it exists; fall back to the scope count
                            // only when no narrowing is active (there the two are equal by definition).
                            // NEVER PRINT THE SCOPE COUNT AS IF IT WERE THE FILTERED ONE. With a
                            // narrowing filter active the only honest number is the live one; if this
                            // row has no live count yet (still loading, or beyond the fetch bound),
                            // show NOTHING rather than the wider deal/category number — the same
                            // "no count beats a wrong count" rule the city pool already follows.
                            sublabel: districtLiveCounts?.[opt.districtAr] === 0
                              ? t('No listings here right now')
                              : hasDistrictNarrowing
                                ? (districtLiveCounts?.[opt.districtAr] != null
                                    ? cohortCountLabel(districtLiveCounts[opt.districtAr]) : '')
                                : cohortCountLabel(opt.listingCount),
                            icon: LOC_IMG.district, // restored designed art (see TrendingList.tsx note)
                          }))}
                          onPress={(_item, i) => districtOnPress(districtSuggestions[i])}
                          selectedLabels={selectedLabels}
                        />
                      </>
                    ) : (
                      districtSuggestions.map((opt, i) => {
                        // listingCount is the district's live count at the CURRENT deal/category scope.
                        // 0 → picking it would return nothing right now. Zero-listing catalog districts
                        // stay findable + selectable (owner 2026-07-18) BUT are now clearly marked, so a
                        // user is never silently led into a dead-end pick (2026-08-09).
                        // listingCount is the deal/category/period-scope count; districtLiveCounts is
                        // the results-RPC count under the user's FULL current filter state (fetched
                        // only when a narrower filter is active — see the effect above). When a live
                        // count exists it is the truth for this row's empty-marking: the number/signal
                        // beside a district must equal what selecting it returns (owner, 2026-08-13).
                        const live = districtLiveCounts?.[opt.districtAr];
                        const isEmpty = live != null ? live === 0 : opt.listingCount === 0;
                        const isPicked = selectedLabels.has(opt.districtAr);
                        return (
                        <Tappable
                          key={opt.districtAr + '#' + i}
                          dip={0.03}
                          style={[s.suggRow, i < districtSuggestions.length - 1 && s.suggDivider, isEmpty && s.suggRowEmpty, isPicked && s.suggRowPicked]}
                          onPress={() => districtOnPress(opt)}
                        >
                          <Image source={LOC_IMG.district} style={[s.suggLocIcon, isEmpty && s.suggIconEmpty]} />
                          <View style={{ flex: 1 }}>
                            <Text style={[s.suggCity, isEmpty && s.suggCityEmpty]}>{opt.districtAr}</Text>
                            {/* Same rule as the trending rows above: show the count the user will
                                actually land on (live, under the full filter state) whenever it has
                                been fetched, never the wider deal/category scope count. */}
                            {/* Same rule as the trending rows: under an active filter only a LIVE
                                count may be printed; without one the row shows no number at all. */}
                            {(() => {
                              if (isEmpty) return <Text style={s.suggEmptyNote}>{t('No listings here right now')}</Text>;
                              const n = hasDistrictNarrowing ? live : (live ?? opt.listingCount);
                              const label = n != null ? cohortCountLabel(n) : '';
                              return label ? <Text style={s.suggDist}>{label}</Text> : null;
                            })()}
                          </View>
                          {isPicked ? <Ionicons name="checkmark-circle" size={18} color={colors.primary} /> : null}
                        </Tappable>
                        );
                      })
                    )}
                  </ScrollView>
                );
              })()}
            </DropdownReveal>

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
                    onPress={() => { setQuery((q) => setCategory(q, cat)); scrollDown(groupAnchorRef); }}
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
                      selected={effectiveGroups(query).includes(g.group)}
                      // MULTI-SELECT (owner 2026-08-20). toggleGroup() is the ONE writer of the group
                      // dimension: it OR-adds/removes the group and prunes any selected type that no
                      // longer belongs to a remaining group, so an invisible orphan filter is impossible.
                      onPress={() => { setQuery((q) => toggleGroup(q, g.group)); scrollDown(typeAnchorRef); }}
                      style={s.wrapCell}
                    />
                  ))}
                </View>
              </Reveal>
            )}

            <View ref={withAnchor(typeAnchorRef)} />
            {/* Clean property type (scoped to the chosen group) — the EXACT/hard filter. Optional:
                leaving it unselected keeps the broad group intent. */}
            {effectiveGroups(query).length > 0 && (
              <Reveal style={s.pick}>
                <FieldLabel>{t('Property type')}</FieldLabel>
                <View style={s.wrap}>
                  {typesForGroups(query).map((ty) => (
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

            {/* Combined optional refine section: bedrooms + area in one card */}
            {(ctx?.showBeds || ctx?.showSize) && (
              <Reveal style={s.pick}>
                <View style={s.ctxBox}>
                  <Text style={s.ctxTitle}>{t('Refine your search')}</Text>
                  <Text style={s.ctxSub}>{t('Select bedrooms and/or area, or leave both empty to see all options')}</Text>

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
                              return { ...q, contextBedsList: next.length ? next : null, contextBeds: null,
                                contextSize: next.length ? null : q.contextSize,
                                priceBand: null };
                            }); scrollDown(); }}
                            style={s.wrapCell}
                          />
                        ))}
                      </View>
                    </>
                  )}

                  {/* AREA range (من / إلى م²) — always shown alongside bedrooms (both supported by the RPC).
                      min only → ≥, max only → ≤. */}
                  {ctx?.showSize && (
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
                          <TextInput testID="area-min-input" ref={mergeLtrRef(areaMinRef)} style={s.rangeInput} keyboardType="number-pad" placeholder="—" placeholderTextColor={colors.muted} maxLength={9}
                            value={areaMinValue}
                            onKeyPress={wholeNumberKeyGuard('areaMin')} onFocus={() => clearFracLock('areaMin')} onSelectionChange={() => clearFracLock('areaMin')} onChangeText={(v) => { clearFracLock('areaMin'); const d = toWholeNumberDigits(v).slice(0, 7); setQuery((q) => ({ ...q, areaMin: d || null, contextSize: null, priceBand: null })); }} />
                          <Text style={s.sizeUnit}>{t('م²')}</Text>
                        </Pressable>
                        <Pressable style={[s.field, s.rangeBox, query.areaMax ? s.sizeFieldOn : null]} onPress={() => focusIfNotAlready(areaMaxRef)}>
                          <Image source={RANGE_ICON.areaTo} style={s.rangeBoxIcon} accessibilityLabel={t('To')} />
                          <Text style={s.rangeLabel}>{t('To')}</Text>
                          <TextInput testID="area-max-input" ref={mergeLtrRef(areaMaxRef)} style={s.rangeInput} keyboardType="number-pad" placeholder="—" placeholderTextColor={colors.muted} maxLength={9}
                            value={areaMaxValue}
                            onKeyPress={wholeNumberKeyGuard('areaMax')} onFocus={() => clearFracLock('areaMax')} onSelectionChange={() => clearFracLock('areaMax')} onChangeText={(v) => { clearFracLock('areaMax'); const d = toWholeNumberDigits(v).slice(0, 7); setQuery((q) => ({ ...q, areaMax: d || null, contextSize: null, priceBand: null })); }} />
                          <Text style={s.sizeUnit}>{t('م²')}</Text>
                        </Pressable>
                      </View>
                      {areaHint && (
                        <Text style={[s.rangeNote, areaHint.warn ? s.rangeNoteWarn : null]}>{areaHint.text}</Text>
                      )}
                    </>
                  )}

                  {/* PRICE range (من / إلى ريال) — always available, independent of beds/area. HARD filter.
                      When شراء+إيجار are BOTH selected (owner feature 2026-08-20), this box is the BUY
                      budget and a SECOND, independent Rent budget box renders right below it — owner
                      decision (asked and answered): two ranges shown together, never one shared/naive
                      range that would misleadingly mix a sale price with a rent price. */}
                  <View style={[s.rangeHead, { marginTop: 14 }]}>
                    <Image source={RANGE_ICON.priceHead} style={s.rangeHeadIcon} />
                    <Text style={[s.ctxSubLabel, s.rangeHeadLabel]}>{t(query.dealCombined ? 'Buy budget' : 'Price')}</Text>
                  </View>
                  <View style={s.rangeRow}>
                    <Pressable style={[s.field, s.rangeBox, query.priceMin ? s.sizeFieldOn : null]} onPress={() => focusIfNotAlready(priceMinRef)}>
                      <Image source={RANGE_ICON.priceFrom} style={s.rangeBoxIcon} accessibilityLabel={t('From')} />
                      <Text style={s.rangeLabel}>{t('From')}</Text>
                      <TextInput testID="price-min-input" ref={mergeLtrRef(priceMinRef)} style={s.rangeInput} keyboardType="number-pad" placeholder="—" placeholderTextColor={colors.muted} maxLength={13}
                        value={priceMinValue}
                        onKeyPress={wholeNumberKeyGuard('priceMin')} onFocus={() => clearFracLock('priceMin')} onSelectionChange={() => clearFracLock('priceMin')} onChangeText={(v) => { clearFracLock('priceMin'); const d = toWholeNumberDigits(v).slice(0, 10); setQuery((q) => ({ ...q, priceMin: d || null, priceInput: '', priceBand: null })); }} />
                      <Text style={s.sizeUnit}>{t('SAR currency')}</Text>
                    </Pressable>
                    <Pressable style={[s.field, s.rangeBox, query.priceMax ? s.sizeFieldOn : null]} onPress={() => focusIfNotAlready(priceMaxRef)}>
                      <Image source={RANGE_ICON.priceTo} style={s.rangeBoxIcon} accessibilityLabel={t('To')} />
                      <Text style={s.rangeLabel}>{t('To')}</Text>
                      <TextInput testID="price-max-input" ref={mergeLtrRef(priceMaxRef)} style={s.rangeInput} keyboardType="number-pad" placeholder="—" placeholderTextColor={colors.muted} maxLength={13}
                        value={priceMaxValue}
                        onKeyPress={wholeNumberKeyGuard('priceMax')} onFocus={() => clearFracLock('priceMax')} onSelectionChange={() => clearFracLock('priceMax')} onChangeText={(v) => { clearFracLock('priceMax'); const d = toWholeNumberDigits(v).slice(0, 10); setQuery((q) => ({ ...q, priceMax: d || null, priceInput: '', priceBand: null })); }} />
                      <Text style={s.sizeUnit}>{t('SAR currency')}</Text>
                    </Pressable>
                  </View>
                  {priceHint && (
                    <Text style={[s.rangeNote, priceHint.warn ? s.rangeNoteWarn : null]}>{priceHint.text}</Text>
                  )}

                  {query.dealCombined && (
                    <Reveal>
                      <View style={[s.rangeHead, { marginTop: 14 }]}>
                        <Image source={RANGE_ICON.priceHead} style={s.rangeHeadIcon} />
                        <Text style={[s.ctxSubLabel, s.rangeHeadLabel]}>{t('Rent budget (yearly basis)')}</Text>
                      </View>
                      <View style={s.rangeRow}>
                        <Pressable style={[s.field, s.rangeBox, query.priceMinRent ? s.sizeFieldOn : null]} onPress={() => focusIfNotAlready(priceMinRentRef)}>
                          <Image source={RANGE_ICON.priceFrom} style={s.rangeBoxIcon} accessibilityLabel={t('From')} />
                          <Text style={s.rangeLabel}>{t('From')}</Text>
                          <TextInput ref={mergeLtrRef(priceMinRentRef)} style={s.rangeInput} keyboardType="number-pad" placeholder="—" placeholderTextColor={colors.muted} maxLength={13}
                            value={priceMinRentValue}
                            onKeyPress={wholeNumberKeyGuard('priceMinRent')} onFocus={() => clearFracLock('priceMinRent')} onSelectionChange={() => clearFracLock('priceMinRent')} onChangeText={(v) => { clearFracLock('priceMinRent'); const d = toWholeNumberDigits(v).slice(0, 10); setQuery((q) => ({ ...q, priceMinRent: d || null })); }} />
                          <Text style={s.sizeUnit}>{t('SAR currency')}</Text>
                        </Pressable>
                        <Pressable style={[s.field, s.rangeBox, query.priceMaxRent ? s.sizeFieldOn : null]} onPress={() => focusIfNotAlready(priceMaxRentRef)}>
                          <Image source={RANGE_ICON.priceTo} style={s.rangeBoxIcon} accessibilityLabel={t('To')} />
                          <Text style={s.rangeLabel}>{t('To')}</Text>
                          <TextInput ref={mergeLtrRef(priceMaxRentRef)} style={s.rangeInput} keyboardType="number-pad" placeholder="—" placeholderTextColor={colors.muted} maxLength={13}
                            value={priceMaxRentValue}
                            onKeyPress={wholeNumberKeyGuard('priceMaxRent')} onFocus={() => clearFracLock('priceMaxRent')} onSelectionChange={() => clearFracLock('priceMaxRent')} onChangeText={(v) => { clearFracLock('priceMaxRent'); const d = toWholeNumberDigits(v).slice(0, 10); setQuery((q) => ({ ...q, priceMaxRent: d || null })); }} />
                          <Text style={s.sizeUnit}>{t('SAR currency')}</Text>
                        </Pressable>
                      </View>
                      {priceRentHint && (
                        <Text style={[s.rangeNote, priceRentHint.warn ? s.rangeNoteWarn : null]}>{priceRentHint.text}</Text>
                      )}
                    </Reveal>
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

          {/* REMOVED 2026-08-16 (owner: "remove this for now"): the «مو متأكد وش تبحث عنه؟» onboarding
              header + the 6 "Start here" example cards that sat below the Search button. The supporting
              code (promptChips/onChip + the examplePrompts import) went with it so nothing dead is left
              behind — `git revert` of that commit restores the whole block. The styles (onbWrap/
              onbHeading/onbDesc/suggGrid/chip*) are deliberately KEPT so a restore needs no re-authoring.
              The AI Agent page still shows its own version of this block to guests. */}
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
  // Redesigned to match the taller premium ModeSwitch (46-tall, tint fill + hairline, pill radius,
  // soft green-tinted lift) so the pill + share read as one control cluster (owner redesign 2026-07-24 r2).
  shareBtn: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.tint,
    borderWidth: 1,
    borderColor: colors.tintLine,
    ...cardShadow,
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  shareBtnPressed: { opacity: 0.85 },
  // Top-bar sign-in (mobile, logged-out only — owner 2026-08-19). Compact pill matching the sidebar's
  // CTA green so the action is unmistakable. On desktop the docked sidebar already shows it.
  topSignIn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.selFill, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: 13, marginRight: 8 },
  topSignInText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  hero: { alignItems: 'center', marginTop: 12, marginHorizontal: 4 },
  // The Filter / AI Agent control, centered in the hero flow between the tagline and the card.
  modeWrap: { alignSelf: 'center', marginTop: 20 },
  heroTitle: { fontSize: 31, fontWeight: '700', color: colors.primary, letterSpacing: -0.6, textAlign: 'center', lineHeight: 34 },
  heroSub: { fontSize: 13.5, fontWeight: '600', color: colors.dark, textAlign: 'center', marginTop: 5, lineHeight: 20 },
  heroTagline: { fontSize: 12.5, fontWeight: '700', color: colors.primary, textAlign: 'center', marginTop: 8, fontStyle: 'italic' },
  // Small inline hint under the Rent Monthly/Yearly toggle — explains the period the user picked.
  rentHint: { fontSize: 11.5, color: colors.muted, marginTop: 6, paddingHorizontal: 4, lineHeight: 16 },

  card: { marginTop: 22, backgroundColor: colors.surface, borderRadius: radius.sheet, borderWidth: 1, borderColor: colors.fieldLine, padding: space.card, ...cardShadow },
  // "مسح الكل" (Clear All) — only rendered when hasActiveFilters(query), so an already-empty filter
  // never shows a clear control with nothing to clear (mirrors the location field's own per-field
  // clear icon, which is likewise conditional on query.location.length > 0).
  clearAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end', marginBottom: 10 },
  clearAllText: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  // Carried Advanced Filter answers — same tinted pill the chat's removable pills use, so one
  // committed answer looks like itself on whichever screen the user is standing on.
  afCarryWrap: { alignSelf: 'stretch', gap: 7, marginBottom: 12 },
  afCarryLead: { fontSize: 12.5, fontWeight: '500', color: colors.muted },
  afCarryRow: { flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  afCarryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.tint,
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5,
  },
  afCarryChipTx: { fontSize: 12.5, fontWeight: '600', color: colors.primary },
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

  // Static field label sitting ABOVE the City / District inputs, aligned to the far right for the
  // Arabic RTL layout, with consistent spacing. (owner UI request 2026-07-18.)
  fieldLabelAbove: { fontSize: 13, fontWeight: '700', color: colors.primary, textAlign: 'right', writingDirection: 'rtl', marginBottom: 7, marginHorizontal: 2 },
  fieldLabelOptional: { fontSize: 11.5, fontWeight: '600', color: colors.muted },
  flWrap: { flex: 1, height: 52, justifyContent: 'center', position: 'relative', ...(Platform.OS === 'web' ? { cursor: 'text' as any } : {}) },
  flLabel: { position: 'absolute', left: 0, top: 17, fontSize: 14, color: colors.muted, ...(Platform.OS === 'web' ? { cursor: 'text' as any, transitionProperty: 'top, font-size, color' as any, transitionDuration: '140ms' as any } : {}) },
  flLabelUp: { top: 7, fontSize: 10, color: colors.primary, fontWeight: '600' },
  // City + District are Arabic text fields → right-align so the caret sits on the RIGHT and the
  // Arabic value/placeholder reads correctly (the numeric area/price inputs stay LTR — rangeInput/
  // sizeInput). Fixes the caret/placeholder appearing on the far left. (owner UI request 2026-07-19.)
  // iOS focus-zoom trap: mobile Safari zooms the page on focus for any input under 16px and never
  // zooms back out. The web font is pinned to 16 (native keeps the designed 14). The field box is a
  // fixed 52px with height:'100%' here, so nothing reflows. See scripts/verify-input-font-no-ios-zoom.ts.
  flInput: { fontSize: Platform.OS === 'web' ? 16 : 14, color: colors.ink, padding: 0, height: '100%', textAlign: 'right', writingDirection: 'rtl', ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  flInputUp: { paddingTop: 15 },

  suggBox: { marginTop: 8, maxHeight: 268, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: radius.field, backgroundColor: colors.surface, overflow: 'hidden' },
  suggRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12 },
  suggLocIcon: { width: 20, height: 20, resizeMode: 'contain' }, // Saudi/Region/City/District designed art (assets/images/loc)
  // Zero-state row text (loading / error / no-match) — muted, RTL, never a Latin leak.
  suggStatusText: { flex: 1, fontSize: 12.5, color: colors.muted, textAlign: 'right', writingDirection: 'rtl' },
  // City field's selected-state glyph — the same LOC_IMG.city art as the suggestion rows, field-sized.
  fieldLocIcon: { width: 18, height: 18, resizeMode: 'contain' },
  suggDivider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  suggCity: { fontSize: 13.5, fontWeight: '600', color: colors.ink },
  suggDist: { fontSize: 11.5, color: colors.muted },
  // Zero-listing (for the current deal/category) district rows: dimmed + a plain "no listings" note so
  // the user is never silently led into a dead-end pick. Still tappable (findability + never-dead-end).
  suggRowEmpty: { opacity: 0.6 },
  // District multi-select (2026-08-10) — selected rows/chips reuse the app's chip vocabulary.
  suggRowPicked: { backgroundColor: colors.chipFill },
  districtMultiHint: { fontSize: 11.5, color: colors.muted, textAlign: 'right', marginTop: 3 },
  districtChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  districtChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.chipFill, borderWidth: 1, borderColor: colors.chipLine,
    borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10,
  },
  // flexShrink so the NAME truncates at narrow widths — the fixed 14px art and the ✕ never overflow.
  districtChipText: { fontSize: 12.5, fontWeight: '700', color: colors.dark, flexShrink: 1 },
  districtChipIcon: { width: 14, height: 14, resizeMode: 'contain' },
  suggIconEmpty: { opacity: 0.5 },
  suggCityEmpty: { color: colors.muted, fontWeight: '500' },
  suggEmptyNote: { fontSize: 11, color: colors.muted, marginTop: 1 },

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

  searchBtn: { marginTop: 11, height: 51, borderRadius: radius.field, backgroundColor: colors.selFill, alignItems: 'center', justifyContent: 'center' },
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
