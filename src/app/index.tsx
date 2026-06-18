import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated as RNAnimated, Easing as RNEasing, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, space, cardShadow } from '@/theme/tokens';
import HeroBackground from '@/components/HeroBackground';
import { Segmented, OptionBox, FieldLabel, Tappable, Heartbeat } from '@/components/ui';
import Sidebar, { useDocked } from '@/components/Sidebar';
import ShareSheet from '@/components/ShareSheet';
import { CATEGORIES, CATEGORY_TYPES, DEALS, detailFor, priceTabsFor, type Category } from '@/data/taxonomy';
import { matchLocations, placeLabel, placeTitle, placeSub, placeIcon, placeKey, resolveLocation, type Place } from '@/data/locations';
import { grouped, toLatinDigits } from '@/data/search';
import { noTranslateRef } from '@/noTranslate';
import { useApp } from '@/store';
import { shareNative } from '@/lib/share';
import { useI18n, tDetailOption, tPriceTab, detectLocale } from '@/i18n';

const MAX_W = 560; // desktop-web: keep the mobile-first column centered

// "Start here" suggestion chips — verbatim from the prototype (ezhalah-mobile.jsx §Sugg grid).
const SUGGESTIONS: { icon: keyof typeof Ionicons.glyphMap; label: string; seed: string }[] = [
  { icon: 'home-outline', label: 'Family villa in North Riyadh', seed: 'Family villa in North Riyadh' },
  { icon: 'business-outline', label: 'Apartment for rent in Khobar', seed: 'Apartment for rent in Khobar' },
  { icon: 'map-outline', label: 'Commercial land in Jeddah', seed: 'Commercial land in Jeddah' },
  { icon: 'pricetag-outline', label: 'What can I get for SAR 500,000?', seed: 'What can I get for SAR 500,000?' },
  { icon: 'water-outline', label: 'I want a villa with a pool', seed: 'I want a villa with a pool' },
  { icon: 'storefront-outline', label: 'Shop for rent in Jeddah', seed: 'Shop for rent in Jeddah' },
];

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

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, locale, setLocale, isRTL } = useI18n();
  const { query, setQuery, gated, user } = useApp();
  const docked = useDocked(); // website: sidebar is a permanent column, so hide the menu button
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [cityFocus, setCityFocus] = useState(false);
  const cityRef = useRef<TextInput>(null);
  // Auto-advance the form: as the user fills each step (deal, location, category, type, detail,
  // price), gently scroll DOWN so the just-revealed section and the Search button come into view —
  // they never have to scroll the page themselves. (user request.)
  const scrollRef = useRef<ScrollView>(null);
  const endAnchorRef = useRef<View>(null);
  const scrollDown = () => {
    // Defer past the state-driven re-render so the newly revealed section is laid out first.
    setTimeout(() => {
      if (Platform.OS === 'web') {
        (endAnchorRef.current as any)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      } else {
        scrollRef.current?.scrollToEnd({ animated: true });
      }
    }, 90);
  };
  const priceRef = useRef<TextInput>(null);
  const [priceFocus, setPriceFocus] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  // Filter search funnels into the Ezhalah chat with listings inline (prototype parity — there is
  // no separate results page). The agent reads ?filter=… and runs it once on open. Pressing Search
  // first LIGHTENS the sketch backdrop (a deliberate "here we go" beat), then opens the results once
  // that lift has played.
  const onSearch = () => {
    // Commit the language on Search (not per keystroke): if the user typed the city in English the
    // app follows to English, in Arabic → Arabic. Empty/neutral input leaves the current language.
    const loc = detectLocale(query.location);
    if (loc && loc !== locale) setLocale(loc);
    // AI-assisted location: resolve a free-typed location (the user need not pick from the dropdown
    // nor know the exact district/spelling) to the closest DB match, and carry that resolution into
    // the chat so the Search Summary shows exactly what Ezhalah understood. The header/bubble use a
    // clean display location; never fail on an unknown location — fall back to the raw text. (user request.)
    const lm = resolveLocation(query.location, loc ?? locale);
    const displayLoc =
      lm.kind === 'none'
        ? query.location
        : lm.kind === 'area'
          ? lm.raw // keep "North Riyadh" in the request bubble; districts show in the summary
          : lm.kind === 'district' || lm.kind === 'city' || lm.kind === 'region'
            ? lm.label
            : lm.city || query.location; // landmark / geography / lifestyle → the canonical city
    const q = { ...query, location: displayLoc, locationMatch: lm.kind === 'none' ? undefined : lm };
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
  // Whatever the user chose (a size band) or typed (a custom number) is mirrored INTO the size box so
  // they can see it and tap in to edit it. A band shows its label minus the trailing unit (the box
  // renders "m²" on the side); a custom number shows as-is.
  const sizeIsBand = !!detail && !detail.isBedrooms && !!query.detail && detail.options.includes(query.detail);
  const sizeBoxValue = !detail || detail.isBedrooms || !query.detail
    ? ''
    : sizeIsBand
      ? tDetailOption(query.detail!).replace(/\s*(m²|م²)\s*$/u, '').trim()
      : grouped(parseInt(query.detail!, 10) || 0); // free-typed number → comma-grouped
  // Preset price bands for the chosen type + deal + size (Office for now). Null → free-type box only.
  const priceTabs = priceTabsFor(query.type, query.deal, query.detail);
  // Filter budget field. RENT lets the user pick the period (Monthly / Yearly) via a tiny toggle —
  // the engine knows how to handle each, no math shown to the user. BUY is the total Purchase Budget.
  // No price/m² tabs, no automatic conversions in the UI. (user request.)
  const rentPeriod: 'monthly' | 'annual' = query.rentPeriod ?? 'annual';
  const priceLabel = query.deal === 'Rent'
    ? (rentPeriod === 'monthly' ? 'Monthly Rent Budget' : 'Yearly Rent Budget')
    : 'Purchase Budget';
  const cityUp = cityFocus || query.location.length > 0;
  // Show the city suggestions in whichever script the user is typing (English input → English
  // names, Arabic input → Arabic names), independent of the app's UI language. Falls back to the
  // app locale before any letters are typed.
  const sugLocale = detectLocale(query.location) ?? locale;
  const priceUp = priceFocus || query.priceInput.length > 0 || !!query.priceBand;
  const priceText = query.priceInput ? grouped(parseInt(query.priceInput, 10)) : '';
  // Rent price bands are annual figures — show a "/yr" marker on the tab + mirrored box label so
  // it's clear (Buy bands are absolute, no marker). Canonical band strings stay unmarked so search
  // parsing is unaffected.
  const tPriceTabDeal = (opt: string) =>
    query.deal === 'Rent' ? `${tPriceTab(opt)}${t(' /yr')}` : tPriceTab(opt);
  // A selected price band is mirrored into the price box too (with its SAR label); typing or the ×
  // clears it. Bands aren't digit-editable.
  const priceBoxValue = query.priceBand ? tPriceTabDeal(query.priceBand) : priceText;

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
              {docked && (
                <RNAnimated.View style={reveal(badgeAnim, 10)}>
                  <AgentBadge onPress={() => router.push('/agent')} t={t} isRTL={isRTL} />
                </RNAnimated.View>
              )}
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
            <Segmented options={DEALS} value={query.deal} onChange={(v) => { setQuery((q) => ({ ...q, deal: v as any, priceBand: null })); scrollDown(); }} />

            {/* Location (floating label). The whole box is a tap target — tapping anywhere inside
                (icon, label, padding) focuses the input so the user can type a city OR a neighborhood
                from anywhere in the box, not just on the thin text line. */}
            <Pressable style={[s.field, { marginTop: 12 }]} onPress={() => cityRef.current?.focus()}>
              <Ionicons name="location-outline" size={18} color={colors.muted} />
              <View style={s.flWrap}>
                <Text style={[s.flLabel, cityUp && s.flLabelUp]}>{t('Which city or neighborhood?')}</Text>
                <TextInput
                  ref={cityRef}
                  style={[s.flInput, cityUp && s.flInputUp]}
                  value={query.location}
                  autoCorrect={false}
                  onFocus={() => setCityFocus(true)}
                  onBlur={() => setTimeout(() => setCityFocus(false), 150)}
                  onChangeText={(v) => {
                    setQuery((q) => ({ ...q, location: v }));
                    setSuggestions(matchLocations(v));
                    // The first letter sets the whole app's language live — an English letter flips
                    // everything to English, an Arabic letter to Arabic — for everyone, signed in or
                    // out. The app always reflects the LAST language the user typed (user request); a
                    // signed-in user's choice is also persisted so it sticks across a refresh.
                    const loc = detectLocale(v);
                    if (loc && loc !== locale) setLocale(loc);
                  }}
                />
              </View>
              {query.location.length > 0 && (
                <Pressable onPress={() => { setQuery((q) => ({ ...q, location: '' })); setSuggestions([]); cityRef.current?.focus(); }} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.muted} />
                </Pressable>
              )}
            </Pressable>

            {cityFocus && suggestions.length > 0 && (
              <ScrollView style={s.suggBox} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {suggestions.map((sg, i) => (
                  <Pressable
                    key={placeKey(sg)}
                    style={[s.suggRow, i < suggestions.length - 1 && s.suggDivider]}
                    onPress={() => {
                      const label = placeLabel(sg, sugLocale);
                      setQuery((q) => ({ ...q, location: label }));
                      setSuggestions([]);
                      setCityFocus(false);
                      // Choosing a city/neighborhood is a deliberate commit, so it switches the whole
                      // app's language to match the chosen name's script — even when signed in (an
                      // English pick → English UI, an Arabic pick → Arabic). (user request.)
                      const loc = detectLocale(label);
                      if (loc && loc !== locale) setLocale(loc);
                      scrollDown(); // carry them down to the next step (category)
                    }}
                  >
                    <Ionicons name={placeIcon(sg)} size={16} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.suggCity}>{placeTitle(sg, sugLocale)}</Text>
                      <Text style={s.suggDist}>{placeSub(sg, sugLocale)}</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}

            {/* Category */}
            <View style={s.pick}>
              <FieldLabel>{t('Category')}</FieldLabel>
              <View style={s.row}>
                {CATEGORIES.map((cat) => (
                  <OptionBox
                    key={cat}
                    label={t(cat)}
                    selected={query.category === cat}
                    onPress={() => { setQuery((q) => ({ ...q, category: q.category === cat ? null : cat, type: null, detail: null, priceBand: null })); scrollDown(); }}
                  />
                ))}
              </View>
            </View>

            {/* Property type (scoped) */}
            {query.category && (
              <View style={s.pick}>
                <FieldLabel>{t('Property type')}</FieldLabel>
                <View style={s.wrap}>
                  {CATEGORY_TYPES[query.category as Category].map((ty) => (
                    <OptionBox
                      key={ty}
                      label={t(ty)}
                      selected={query.type === ty}
                      onPress={() => { setQuery((q) => ({ ...q, type: q.type === ty ? null : ty, detail: q.type === ty ? null : ty === 'Room' ? '1' : null, priceBand: null })); scrollDown(); }}
                      style={s.wrapCell}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* Detail (bedrooms / size) */}
            {detail && (
              <View style={s.pick}>
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
                  <View style={[s.field, s.sizeField, query.detail ? s.sizeFieldOn : null]}>
                    <TextInput
                      style={s.sizeInput}
                      keyboardType="number-pad"
                      placeholder={t('Or type an exact size')}
                      placeholderTextColor={colors.muted}
                      value={sizeBoxValue}
                      onFocus={() => {
                        // Tapping in to type a custom size clears the selected band so the box goes
                        // empty (not stale band text) — the user types their own number fresh.
                        if (sizeIsBand) setQuery((q) => ({ ...q, detail: null, priceBand: null }));
                      }}
                      onChangeText={(v) => {
                        const digits = toLatinDigits(v).replace(/\D/g, '');
                        setQuery((q) => ({ ...q, detail: digits ? digits : null, priceBand: null }));
                      }}
                    />
                    <Text style={s.sizeUnit}>{t('m²')}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Rent only: tiny Monthly / Yearly toggle that tells the engine which period the typed
                number represents. The user sees no math; they just pick what they're thinking in.
                Hidden for Buy. (user request.) */}
            {query.deal === 'Rent' && (
              <View style={{ marginTop: 12 }}>
                <Segmented
                  options={['Monthly', 'Yearly']}
                  value={rentPeriod === 'monthly' ? 'Monthly' : 'Yearly'}
                  onChange={(v) => setQuery((q) => ({ ...q, rentPeriod: v === 'Monthly' ? 'monthly' : 'annual' }))}
                />
                {/* Tiny inline hint under the toggle so the user knows what each period means. */}
                <Text style={s.rentHint}>
                  {t(rentPeriod === 'monthly' ? 'Monthly: 1–11 month lease, price/month.' : 'Annual: 12-month lease, price/year.')}
                </Text>
              </View>
            )}
            <Pressable style={[s.field, { marginTop: 12 }]} onPress={() => priceRef.current?.focus()}>
              <View style={s.flWrap}>
                <Text style={[s.flLabel, priceUp && s.flLabelUp]}>{t(priceLabel)}</Text>
                <TextInput
                  ref={priceRef}
                  style={[s.flInput, priceUp && s.flInputUp]}
                  keyboardType="number-pad"
                  value={priceBoxValue}
                  onFocus={() => {
                    setPriceFocus(true);
                    // Tapping in to type a custom max clears the selected price band so the box goes
                    // empty (not stale band text) — the user types their own amount fresh.
                    if (query.priceBand) setQuery((q) => ({ ...q, priceBand: null }));
                  }}
                  onBlur={() => setPriceFocus(false)}
                  onChangeText={(v) => setQuery((q) => ({ ...q, priceInput: toLatinDigits(v), priceBand: null }))}
                />
              </View>
            </Pressable>

            <Tappable style={s.searchBtn} onPress={onSearch} dip={0.025}>
              <Text style={s.searchBtnText}>{t('Search')}</Text>
            </Tappable>
            {/* Scroll target: each selection brings this (just below Search) into view so the user is
                carried down through the form without scrolling. (user request.) */}
            <View ref={endAnchorRef} style={{ height: 1 }} />
          </View>

          {/* Onboarding header — centered icon + bold heading + lighter description, explaining the
              example cards. Same structure as the AI Agent page. (user request.) */}
          <View style={s.onbWrap}>
            <Ionicons name="search" size={26} color={colors.primary} />
            <Text style={s.onbHeading}>{t("Not sure what you're looking for?")}</Text>
            <Text style={s.onbDesc}>{t('Tap one of the examples below and let Ezhalah start the search for you.')}</Text>
          </View>

          <View style={s.suggGrid}>
            {SUGGESTIONS.map((sg, i) => (
              // Heartbeat wrapper holds the grid sizing and the gentle pulse; the Tappable inside keeps
              // the press-scale and fills the cell. (user request: heartbeat on the cards.)
              <Heartbeat key={sg.label} index={i} style={s.chipCell}>
                <Tappable style={s.chip} onPress={() => onChip(sg.seed)} dip={0.05}>
                  <View style={s.chipIc}>
                    <Ionicons name={sg.icon} size={21} color={colors.chipIcon} />
                  </View>
                  <Text style={s.chipTx}>{t(sg.label)}</Text>
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
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: radius.field, paddingHorizontal: 14, backgroundColor: colors.surface },
  sizeField: { marginTop: 8, height: 46 },
  sizeFieldOn: { borderColor: colors.primary },
  sizeInput: { flex: 1, fontSize: 14, color: colors.ink, padding: 0, height: '100%', textAlign: 'left', ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  sizeUnit: { fontSize: 13.5, fontWeight: '700', color: colors.muted },

  flWrap: { flex: 1, height: 52, justifyContent: 'center', position: 'relative' },
  flLabel: { position: 'absolute', left: 0, top: 17, fontSize: 14, color: colors.muted },
  flLabelUp: { top: 7, fontSize: 10, color: colors.primary, fontWeight: '600' },
  flInput: { fontSize: 14, color: colors.ink, padding: 0, height: '100%', ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  flInputUp: { paddingTop: 15 },

  suggBox: { marginTop: 8, maxHeight: 268, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: radius.field, backgroundColor: colors.surface, overflow: 'hidden' },
  suggRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12 },
  suggDivider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  suggCity: { fontSize: 13.5, fontWeight: '600', color: colors.ink },
  suggDist: { fontSize: 11.5, color: colors.muted },

  pick: { marginTop: 12 },
  row: { flexDirection: 'row', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
