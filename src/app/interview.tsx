import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CATEGORY_TYPES, detailFor, type Category } from '@/data/taxonomy';
import { emptyQuery, type SearchQuery } from '@/data/search';
import { INTERVIEW_CITIES, neighborhoodsFor } from '@/data/locations';
import { useApp } from '@/store';
import { useI18n, t, tWord, tBudgetMain, tBudgetSub, tDetailOption, isLatinOnlyInput, ARABIC_ONLY_MSG } from '@/i18n';

// Guided interview — a faithful port of the prototype's modal (.m-iv). One continuous session walks
// the Location group (city, neighborhood) then the Details group (deal, category, type, budget,
// size) then a single category-dependent secondary question, funnelling into the Ezhalah chat via a
// `filter` param. Empty/skipped fields broaden the search rather than dead-end it (PRD §6.1).

const SKIP = '__skip';
const real = (v?: string) => !!v && v !== SKIP && v !== 'Other';

type Opt = string | { main: string; sub: string };
type Step = { key: string; group?: 'Location' | 'Details'; title: string; sub?: string; opts: Opt[] };
type Answers = Record<string, string>;

const BUY_BUDGET: Opt[] = [
  { main: 'SAR 3,500 / m²', sub: '≈ 875,000 total · 250 m²' },
  { main: 'SAR 5,000 / m²', sub: '≈ 1.5M total · 300 m²' },
  { main: 'SAR 7,000 / m²', sub: '≈ 2.45M total · 350 m²' },
  { main: 'SAR 10,000 / m²', sub: '≈ 4M total · 400 m²' },
  { main: 'SAR 14,000 / m²', sub: '≈ 6.3M total · 450 m²' },
];
const RENT_BUDGET: Opt[] = [
  { main: 'SAR 2,500 / mo', sub: '≈ 30,000 / year' },
  { main: 'SAR 4,000 / mo', sub: '≈ 48,000 / year' },
  { main: 'SAR 6,500 / mo', sub: '≈ 78,000 / year' },
  { main: 'SAR 9,000 / mo', sub: '≈ 108,000 / year' },
  { main: 'SAR 13,000 / mo', sub: '≈ 156,000 / year' },
];
const BED_OPTS = ['1 bed', '2 beds', '3 beds', '4 beds', '5+ beds'];

const SECONDARY: Record<string, { key: string; title: string; sub?: string; opts: string[] }[]> = {
  Residential: [
    {
      key: 's_amenities',
      title: 'Must-have amenities?',
      sub: 'Extra features the home includes (e.g. pool, gym, parking). Not sure? Pick “Doesn\'t matter.”',
      opts: ['Pool', 'Parking', 'Elevator', 'Gym', 'Maid room', "Doesn't matter"],
    },
  ],
  Commercial: [
    {
      key: 's_use',
      title: 'Intended use?',
      sub: 'What you\'ll use the space for. Not sure? Pick “Other.”',
      opts: ['Office', 'Storage', 'Retail', 'Workshop', 'Other'],
    },
  ],
};

const CANON_GROUP: Record<string, 'Location' | 'Details'> = {
  city: 'Location',
  neighborhood: 'Location',
  deal: 'Details',
  category: 'Details',
  type: 'Details',
  budget: 'Details',
  size: 'Details',
};

const ALL_KEYS = ['city', 'neighborhood', 'deal', 'category', 'type', 'budget', 'size', 's_amenities', 's_use'];

const KNOWN_CITIES = [
  ...INTERVIEW_CITIES,
  'taif', 'abha', 'tabuk', 'khobar', 'jubail', 'buraidah', 'hail', 'najran', 'yanbu', 'qassim', 'khamis', 'mecca', 'medina',
].map((c) => c.toLowerCase());

function primaryStep(a: Answers): Step | null {
  if (a.city === undefined) return { key: 'city', group: 'Location', title: 'Which city?', opts: [...INTERVIEW_CITIES, 'Other'] };
  if (a.city !== SKIP && a.city !== 'Other' && a.neighborhood === undefined) {
    const hoods = neighborhoodsFor(a.city);
    return { key: 'neighborhood', group: 'Location', title: 'Which neighborhood?', opts: hoods.length ? [...hoods, 'Other'] : ['Other'] };
  }
  if (a.deal === undefined) return { key: 'deal', group: 'Details', title: 'Rent or Buy?', opts: ['Rent', 'Buy'] };
  if (a.category === undefined) return { key: 'category', group: 'Details', title: 'Property category?', opts: ['Residential', 'Commercial'] };
  if (a.category !== SKIP && a.type === undefined) return { key: 'type', group: 'Details', title: 'Property type?', opts: CATEGORY_TYPES[a.category as Category] ?? [] };
  if (a.budget === undefined)
    return {
      key: 'budget',
      group: 'Details',
      title: a.deal === 'Buy' ? "What's your max budget?" : "What's your rent budget?",
      sub: a.deal === 'Buy' ? 'Price per m², total shown for a typical size. Or type any amount.' : 'Monthly amount, annual shown too. Or type any amount.',
      opts: a.deal === 'Buy' ? BUY_BUDGET : RENT_BUDGET,
    };
  if (a.size === undefined) {
    const isBed = real(a.type) ? detailFor(a.type).isBedrooms : true;
    const opts = real(a.type) ? (isBed ? BED_OPTS : detailFor(a.type).options) : BED_OPTS;
    return { key: 'size', group: 'Details', title: isBed ? 'How many bedrooms?' : 'Size?', opts };
  }
  return null;
}

function secList(a: Answers) {
  const c = real(a.category) ? (a.category as string) : 'Residential';
  return SECONDARY[c] ?? SECONDARY.Residential;
}

function nextSecondary(a: Answers): Step | null {
  for (const q of secList(a)) if (a[q.key] === undefined) return { key: q.key, title: q.title, sub: q.sub, opts: q.opts };
  return null;
}

function nextStep(a: Answers): Step | null {
  return primaryStep(a) ?? nextSecondary(a);
}

function buildQuery(a: Answers): SearchQuery {
  const q = emptyQuery();
  q.deal = a.deal === 'Buy' ? 'Buy' : 'Rent';
  if (real(a.neighborhood)) q.location = `${a.neighborhood}, ${a.city}`;
  else if (real(a.city)) q.location = a.city;
  if (real(a.category)) q.category = a.category as Category;
  if (real(a.type)) q.type = a.type;
  if (real(a.size)) q.detail = /bed/i.test(a.size) ? a.size.replace(/\s*beds?/i, '').trim() : a.size;
  if (real(a.budget)) q.priceInput = (a.budget.match(/\d/g) ?? []).join('');
  return q;
}

// Skipped/broadened primary fields → the assistant's "I broadened …" note (prototype skippedNote).
function skippedNote(a: Answers, isRTL: boolean): string {
  const labels: Record<string, string> = {
    neighborhood: t('the neighborhood'),
    budget: t('the budget'),
    size: t('the size'),
  };
  const skipped = ['neighborhood', 'budget', 'size'].filter(
    (k) => a[k] === SKIP || a[k] === 'Other' || a[k] === undefined,
  );
  const names = skipped.map((k) => labels[k]).filter(Boolean);
  if (!names.length) return '';
  let list: string;
  if (names.length === 1) list = names[0];
  else if (isRTL) list = names.slice(0, -1).join('، ') + ' و' + names[names.length - 1];
  else list = names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  return t(' I broadened {fields} to show you more options.', { fields: list });
}

// Interview → chat copy. Faithful port of the prototype's buildInterviewQuery (user bubble) +
// interviewToChat heading (result subheading). Unlike the filter path, the interview lists the
// chosen budget label verbatim (e.g. "SAR 7,000 / m²") rather than multiplying it out, so the recap
// reads naturally. Empty/skipped fields are omitted and folded into the "I broadened …" note.
function interviewToChat(a: Answers, isRTL: boolean): { bubble: string; sub: string } {
  const comma = isRTL ? '، ' : ', ';
  const whatPhrase = real(a.type)
    ? tWord(a.type)
    : real(a.category)
      ? t('{cat} property', { cat: tWord(a.category) })
      : t('a property');
  const subWhat = real(a.type)
    ? tWord(a.type)
    : real(a.category)
      ? t('{cat} properties', { cat: tWord(a.category) })
      : t('properties');

  const verbWord = real(a.deal) ? t(a.deal === 'Buy' ? 'to buy' : 'to rent') : '';
  const verbSeg = verbWord ? ' ' + verbWord : '';

  let place = '';
  if (real(a.neighborhood)) place = `${t(a.neighborhood)}${comma}${t(a.city)}`;
  else if (real(a.city)) place = t(a.city);

  const sizeLabel = real(a.size) ? (/bed/i.test(a.size) ? t(a.size) : tDetailOption(a.size)) : '';
  const budgetLabel = real(a.budget) && /SAR|\d|ر\.س/.test(a.budget) ? tBudgetMain(a.budget) : '';

  const extras: string[] = [];
  for (const q of secList(a)) if (real(a[q.key])) extras.push(t(a[q.key]));

  // User bubble — "I'm looking for villa to buy in Al Narjis, Riyadh, 3 beds, budget SAR 7,000 / m²."
  const bubblePlace = t('in {place}', { place: place || t('Saudi Arabia') });
  const bubble = t("I'm looking for {what}{verb} {place}{size}{budget}{extras}.", {
    what: whatPhrase,
    verb: verbSeg,
    place: bubblePlace,
    size: sizeLabel ? comma + sizeLabel : '',
    budget: budgetLabel ? comma + t('budget {b}', { b: budgetLabel }) : '',
    extras: extras.length ? ` (${extras.join(comma)})` : '',
  });

  // Result subheading — "Here are villas in Al Narjis, Riyadh (to buy, 3 beds, SAR 7,000 / m²) that …"
  const bits = [verbWord, sizeLabel, budgetLabel].filter(Boolean);
  const subPlace = place ? t('in {place}', { place }) : t('across Saudi Arabia');
  const sub = t('Here are {what} {place}{bits} that best match what you want.{note}', {
    what: subWhat,
    place: subPlace,
    bits: bits.length ? ` (${bits.join(comma)})` : '',
    note: skippedNote(a, isRTL),
  });

  return { bubble, sub };
}

// Progress = answered + how many remain (simulated by skipping every future question).
function progress(a: Answers): { cur: number; total: number } | null {
  let sim: Answers = { ...a };
  let remaining = 0;
  while (remaining < 30) {
    const q = nextStep(sim);
    if (!q) break;
    remaining++;
    sim = { ...sim, [q.key]: SKIP };
  }
  const answered = ALL_KEYS.filter((k) => a[k] !== undefined).length;
  const total = answered + remaining;
  if (total <= 1) return null;
  return { cur: answered + 1, total };
}

export default function Interview() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, isRTL } = useI18n();
  const { gated } = useApp();

  const [ans, setAns] = useState<Answers>({});
  const [order, setOrder] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customVal, setCustomVal] = useState('');
  // Arabic-only product: a custom-typed answer in English never proceeds (matches src/app/index.tsx's
  // onSearch() guard) — this screen had no such guard, so an English custom answer would flow raw
  // into t()/tWord() calls with no dictionary entry and leak into the Arabic UI (2026-07-13 audit).
  const [customErr, setCustomErr] = useState('');
  const authPushed = useRef(false);

  const curQ = useMemo(() => nextStep(ans), [ans]);
  const prog = useMemo(() => (curQ ? progress(ans) : null), [ans, curQ]);
  const done = curQ === null && order.length > 0;

  // Everything answered → run the search in chat, unless the free search is used up (then sign in).
  useEffect(() => {
    if (!done) return;
    if (gated) {
      if (!authPushed.current) {
        authPushed.current = true;
        router.push('/auth');
      }
      return;
    }
    const { bubble, sub } = interviewToChat(ans, isRTL);
    router.replace({
      pathname: '/agent',
      params: { filter: JSON.stringify(buildQuery(ans)), chatBubble: bubble, chatSub: sub },
    });
  }, [done, gated]);

  const localizeVal = (key: string, val?: string): string => {
    if (val === undefined || val === SKIP) return t('Any');
    if (key === 'budget') return tBudgetMain(val);
    if (key === 'size' && !/bed/i.test(val)) return tDetailOption(val);
    return t(val);
  };

  const answer = (key: string, val: string) => {
    setCustomMode(false);
    setCustomVal('');
    setCustomErr('');
    setSelected(null);
    setOrder((o) => (o.includes(key) ? o : [...o, key]));
    setAns((a) => ({ ...a, [key]: val }));
  };

  const jumpTo = (key: string) => {
    setCustomMode(false);
    setCustomVal('');
    setCustomErr('');
    const idx = order.indexOf(key);
    if (idx < 0) return;
    const removed = order.slice(idx);
    const prevVal = ans[key];
    setAns((a) => {
      const na = { ...a };
      removed.forEach((k) => delete na[k]);
      return na;
    });
    setOrder(order.slice(0, idx));
    setSelected(prevVal === SKIP ? null : prevVal ?? null);
  };

  const back = () => {
    setCustomMode(false);
    setCustomVal('');
    setCustomErr('');
    if (!order.length) {
      router.back();
      return;
    }
    const last = order[order.length - 1];
    const prevVal = ans[last];
    setAns((a) => {
      const na = { ...a };
      delete na[last];
      return na;
    });
    setOrder((o) => o.slice(0, -1));
    setSelected(prevVal === SKIP ? null : prevVal ?? null);
  };

  const goNext = () => {
    if (!curQ || !(customMode && customVal.trim())) return;
    // Arabic-only product: reject a pure-English custom answer here, ABOVE every t()/tWord() call
    // this answer eventually reaches — same guard, same message as src/app/index.tsx's onSearch().
    if (isLatinOnlyInput(customVal.trim())) { setCustomErr(ARABIC_ONLY_MSG); return; }
    answer(curQ.key, customVal.trim());
  };

  const onCustomChange = (text: string) => {
    let val = text;
    if (curQ?.key === 'budget') {
      const d = val.replace(/[^\d]/g, '');
      val = d ? Number(d).toLocaleString('en-US') : '';
    }
    setCustomVal(val);
    setSelected(null);
    setCustomErr('');
  };

  const leadText = (q: Step): string => {
    if (order.length === 0) return t("Let's find your place, I'll ask a few quick questions.");
    const lk = order[order.length - 1];
    const prevGroup = CANON_GROUP[lk];
    if (prevGroup && q.group && prevGroup !== q.group) {
      const got = order
        .filter((k) => CANON_GROUP[k] === prevGroup && ans[k] && ans[k] !== SKIP)
        .map((k) => localizeVal(k, ans[k]));
      const recap = got.length ? t("I've got {got}.", { got: got.join(isRTL ? '، ' : ', ') }) : t('Got it.');
      const more = q.group === 'Details' ? t('Just a few quick details now.') : t('Just a few quick more now.');
      return `${recap} ${more}`;
    }
    const v = ans[lk];
    if (v === SKIP) return t("No problem, I'll keep that open.");
    const lv = localizeVal(lk, v);
    switch (lk) {
      case 'city':
        return t('Nice, {v} it is.', { v: lv });
      case 'neighborhood':
        return t('Perfect.');
      case 'deal':
        return t('{v}, got it.', { v: lv });
      case 'category':
        return t('Okay!');
      case 'type':
        return t('Love it.');
      case 'budget':
        return t('Got your budget noted.');
      default:
        return t('Got it.');
    }
  };

  const cityTyped = curQ?.key === 'city' && customMode && !!customVal.trim();
  const cityUnknown = cityTyped && !KNOWN_CITIES.includes(customVal.trim().toLowerCase());

  const optMain = (key: string, o: Opt): string => {
    if (typeof o !== 'string') return tBudgetMain(o.main);
    if (key === 'size' && !/bed/i.test(o)) return tDetailOption(o);
    return t(o);
  };
  const optSub = (o: Opt): string | null => (typeof o === 'string' ? null : tBudgetSub(o.sub));
  const optVal = (o: Opt): string => (typeof o === 'string' ? o : o.main);

  return (
    <View style={[s.overlay, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 18 }]}>
      <Pressable style={s.backdrop} onPress={() => router.back()} />
      <View style={s.card}>
        <View style={s.bar}>
          <View style={s.barLeft}>
            {curQ && order.length > 0 ? (
              <Pressable onPress={back} style={s.backBtn} hitSlop={6}>
                <Ionicons name="chevron-back" size={16} color="#1d4a37" />
              </Pressable>
            ) : null}
            <View style={s.titleWrap}>
              <Ionicons name="sparkles" size={16} color="#2f7247" />
              <Text style={s.title} numberOfLines={1}>{t('Ezhalah AI Agent')}</Text>
            </View>
          </View>
          <Pressable onPress={() => router.back()} style={s.xBtn} hitSlop={6}>
            <Ionicons name="close" size={18} color="#56635c" />
          </Pressable>
        </View>

        {prog ? (
          <View style={s.progTrack}>
            <View style={[s.progFill, { width: `${(prog.cur / prog.total) * 100}%` }]} />
          </View>
        ) : null}

        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {curQ ? (
            <>
              {order.length > 0 ? (
                <View style={s.crumbs}>
                  {order.map((k) => (
                    <Pressable key={k} style={s.crumb} onPress={() => jumpTo(k)} hitSlop={4}>
                      <Text style={s.crumbText}>{localizeVal(k, ans[k])}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <View style={s.qhead}>
                <Text style={s.lead}>{leadText(curQ)}</Text>
                <Text style={s.qt}>{t(curQ.title)}</Text>
                {curQ.sub ? <Text style={s.qsub}>{t(curQ.sub)}</Text> : null}
              </View>

              <View style={s.list}>
                {curQ.opts
                  .filter((o) => (typeof o === 'string' ? o !== 'Other' : true))
                  .map((o, i) => {
                    const val = optVal(o);
                    const on = selected === val;
                    const sub = optSub(o);
                    return (
                      <Pressable key={val} style={[s.opt, i === 0 && s.optFirst, on && s.optOn]} onPress={() => answer(curQ.key, val)}>
                        <View style={[s.num, i === 0 && s.numFirst, on && s.numOn]}>
                          <Text style={[s.numText, i === 0 && s.numTextFirst, on && s.numTextOn]}>{i + 1}</Text>
                        </View>
                        <View style={s.lblWrap}>
                          <Text style={s.lbl}>{optMain(curQ.key, o)}</Text>
                          {sub ? <Text style={s.sub2}>{sub}</Text> : null}
                        </View>
                        {on ? <Ionicons name="checkmark" size={17} color="#1d4a37" /> : null}
                      </Pressable>
                    );
                  })}

                <View style={[s.opt, customMode && s.optOn]}>
                  <View style={[s.num, s.numCustom]}>
                    <Ionicons name="pencil" size={13} color="#2f7247" />
                  </View>
                  {customMode ? (
                    <TextInput
                      style={s.customInput}
                      autoFocus
                      keyboardType={curQ.key === 'budget' ? 'numeric' : 'default'}
                      value={customVal}
                      onChangeText={onCustomChange}
                      onSubmitEditing={goNext}
                      placeholder={t(curQ.key === 'budget' ? 'Type any amount (e.g. 7500)' : 'Type your own answer')}
                      placeholderTextColor="#9aa6a0"
                    />
                  ) : (
                    <Pressable style={s.lblWrap} onPress={() => { setCustomMode(true); setSelected(null); setCustomErr(''); }}>
                      <Text style={[s.lbl, s.lblMuted]}>{t(curQ.key === 'budget' ? 'Enter your own amount' : 'Something else')}</Text>
                    </Pressable>
                  )}
                </View>
                {customErr ? <Text style={s.note}>{customErr}</Text> : null}
              </View>

              {/* Suppressed while customErr is showing: goNext()'s Arabic-only guard just rejected
                  this exact answer (never called answer()), so "I'll still search using your other
                  answers" would be false in that instant — the two notes must never stack.
                  (2026-07-13 integration-gap fix.) */}
              {cityUnknown && !customErr ? (
                <Text style={s.note}>{t('"{city}" isn\'t a city I recognize, I\'ll still search using your other answers.', { city: customVal.trim() })}</Text>
              ) : null}

              <View style={s.foot}>
                {customMode && customVal.trim() ? (
                  <Pressable style={s.nextBtn} onPress={goNext}>
                    <Text style={s.nextText}>{t('Next')}</Text>
                  </Pressable>
                ) : null}
                <Pressable style={s.skipLink} onPress={() => answer(curQ.key, SKIP)}>
                  <Text style={s.skipText}>{t('Skip this question')}</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Text style={s.qt}>{t('Searching…')}</Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,18,12,0.45)' },
  card: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '100%',
    backgroundColor: '#fbfbfa',
    borderRadius: 20,
    overflow: 'hidden',
    borderLeftWidth: 6,
    borderLeftColor: '#1d4a37',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 24 },
    elevation: 16,
  },

  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  barLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  backBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#f1f3f1', alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  title: { fontSize: 14, fontWeight: '700', color: '#1d4a37' },
  xBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#f1f3f1', alignItems: 'center', justifyContent: 'center' },

  progTrack: { height: 3, backgroundColor: '#e9ece9', marginHorizontal: 16, marginBottom: 4, borderRadius: 3, overflow: 'hidden' },
  progFill: { height: '100%', backgroundColor: '#1d4a37', borderRadius: 3 },

  body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 18 },

  crumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  crumb: { borderWidth: 1, borderColor: '#d6e8db', backgroundColor: '#eef6f0', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 },
  crumbText: { color: '#1d4a37', fontSize: 11.5, fontWeight: '600' },

  qhead: { paddingHorizontal: 2, paddingTop: 6, paddingBottom: 10 },
  lead: { fontSize: 12.5, fontWeight: '600', color: '#2f7247', marginBottom: 4 },
  qt: { fontSize: 18, fontWeight: '700', color: '#15201b', lineHeight: 24 },
  qsub: { fontSize: 12.5, color: '#7b8a82', marginTop: 5, lineHeight: 18 },

  list: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e7ebe8', borderRadius: 14, overflow: 'hidden' },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: '#f0f2f0' },
  optFirst: { borderTopWidth: 0 },
  optOn: { backgroundColor: '#eef6f0' },
  lblWrap: { flex: 1 },
  num: { width: 26, height: 26, borderRadius: 8, backgroundColor: '#f1f3f1', alignItems: 'center', justifyContent: 'center' },
  numFirst: { backgroundColor: '#e6efe9' },
  numOn: { backgroundColor: '#1d4a37' },
  numCustom: { backgroundColor: '#e6efe9' },
  numText: { fontSize: 12.5, fontWeight: '700', color: '#6b7a72' },
  numTextFirst: { color: '#2f7247' },
  numTextOn: { color: '#fff' },
  lbl: { fontSize: 14.5, fontWeight: '500', color: '#15201b' },
  lblMuted: { color: '#9aa6a0' },
  sub2: { fontSize: 11.5, fontWeight: '500', color: '#8a978f', marginTop: 2 },
  customInput: { flex: 1, fontSize: 14.5, color: '#15201b', padding: 0 },

  note: { marginTop: 10, marginHorizontal: 2, fontSize: 12, color: '#b06a1f', backgroundColor: '#fdf6ec', borderWidth: 1, borderColor: '#f3e2c6', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11, lineHeight: 17 },

  foot: { marginTop: 16, gap: 10 },
  nextBtn: { backgroundColor: '#1d4a37', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  nextText: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
  skipLink: { borderWidth: 1, borderColor: '#d6e8db', backgroundColor: '#eef6f0', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  skipText: { color: '#1d4a37', fontSize: 14, fontWeight: '700' },
});
