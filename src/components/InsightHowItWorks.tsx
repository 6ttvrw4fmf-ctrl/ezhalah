// «كيف نحسبها؟» — the popup a signed-in user sees after tapping the home headline's market fact, or the small link under it
// (owner 2026-11-11, replacing the 2026-10-22 «كيف تشتغل؟» sheet). Laid out like the «نماذج إزهله» card:
//   · the ✕ is ALWAYS on the physical right, in both languages (owner: «the x is always on the right, no matter what»);
//   · in the centre, our eagle glides in and lands on the falconer's glove — the sign-in story, played slowly
//     (assets/images/falconer-howto.svg, scripts/build-howto-falconer.mjs), replayed on every open;
//   · «من صقار إزهله؟» with Shaheen's mark, the story, then the five rules;
//   · no «تمام» button: the ✕ or a tap anywhere outside the card closes it.
// The site count is the live one the share card and welcome line use (siteCount.ts); unknown → the clause is left out.
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image as XImage } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors, radius, space } from '@/theme/tokens';
import { reportError } from '@/lib/observability';
import { HOW_IT_WORKS } from '@/lib/insightHowItWorks';
import { loadSiteCount, siteCountNow } from '@/data/siteCount';

const EAGLE = require('../../assets/images/falconer-howto.svg');
// the eagle art: 310×385 canvas units drawn at ART_W px; the falconer's centre sits (68.5, 73.5) units off the canvas centre
const ART_W = 120, ART_H = Math.round(ART_W * 385 / 310);
const ART_DX = Math.round(68.5 / 310 * ART_W), ART_DY = Math.round(73.5 / 385 * ART_H) - 10;
// A browser keeps ONE timeline per SVG URL, so every open needs its own URL for the eagle to fly again — but a new
// ?play= URL is a new download, and on a phone the flight was over (or never seen) by the time it arrived. On the web
// the SVG is fetched ONCE when the home page mounts, and each open gets a fresh blob: URL of those same bytes: no
// network on tap, the flight starts the moment the popup opens (owner 2026-11-11: «make sure the animation shows when
// the user clicks on it»). Native, or before the bytes arrive: the ?play= URL.
const uriOf = (src: unknown) => (typeof src === 'string' ? src : (src as { uri?: string } | null)?.uri) ?? null;
let eagleBlob: Blob | null = null;
let eagleLoading: Promise<void> | null = null;
export function preloadHowEagle(): Promise<void> {
  const uri = uriOf(EAGLE);
  if (eagleBlob || !uri || typeof fetch !== 'function' || typeof URL === 'undefined' || !URL.createObjectURL) return Promise.resolve();
  // A failed preload is REPORTED (never swallowed) and cleared so the next open can retry; the ?play= URL stays the fallback.
  eagleLoading ??= fetch(uri)
    .then((r) => { if (!r.ok) throw new Error(`eagle preload HTTP ${r.status}`); return r.blob(); })
    .then((b) => { eagleBlob = b; })
    .catch((e: unknown) => { eagleLoading = null; reportError(e, { source: 'InsightHowItWorks.preloadHowEagle' }); });
  return eagleLoading;
}
const freshSource = (play: number) => {
  if (eagleBlob) return { uri: URL.createObjectURL(eagleBlob) };
  const uri = uriOf(EAGLE);
  return uri ? { uri: `${uri}${uri.includes('?') ? '&' : '?'}play=${play}` } : EAGLE;
};

export function InsightHowItWorks({ visible, locale, onClose }: { visible: boolean; locale: 'ar' | 'en'; onClose: () => void }) {
  const c = HOW_IT_WORKS[locale];
  const rtl = locale === 'ar';
  const align = { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' } as const;
  const row = { flexDirection: 'row' } as const; // the page's own direction puts the mark first: right in Arabic, left in English
  const [sites, setSites] = useState<number | null>(siteCountNow());
  const plays = useRef(0);
  const [src, setSrc] = useState<unknown>(null);
  useEffect(() => { void preloadHowEagle(); }, []);
  useEffect(() => {
    if (!visible) return;
    plays.current += 1;
    if (!eagleBlob) void preloadHowEagle(); // a failed preload is retried on the next open
    const next = freshSource(plays.current) as { uri?: string };
    setSrc(next);
    let alive = true;
    void loadSiteCount().then((n) => { if (alive && n !== null) setSites(n); });
    return () => {
      alive = false;
      if (next?.uri?.startsWith('blob:')) URL.revokeObjectURL(next.uri);
    };
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} accessibilityLabel={c.title}>
      <View style={s.screen}>
        {/* pointer-only dismissal: not in the keyboard order and hidden from screen readers — the ✕ is the accessible close */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} focusable={false} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden testID="insight-how-backdrop" />
        <View style={s.card} testID="insight-how-it-works">
          <Pressable style={s.close} onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={c.close} testID="insight-how-close">
            <Ionicons name="close" size={24} color={colors.ink} />
          </Pressable>
          <ScrollView contentContainerStyle={s.body}>
            <Text style={s.title} accessibilityRole="header">{c.title}</Text>
            <View style={s.eagleBox}>
              {/* The canvas keeps empty sky for the flight (viewBox -140 -170 310 385; the falconer stands in 0..167 × 0..192),
                  so the art is shifted to put HIM in the centre and the box crops the spare sky — no dead space (owner
                  2026-11-11: «too much space»). Mirrored in Arabic, as on the home page. */}
              {visible && src ? (
                <View style={{ transform: [{ translateX: rtl ? ART_DX : -ART_DX }, { translateY: -ART_DY }] }}>
                  <XImage source={src as any} contentFit="fill" priority="high" cachePolicy="none" accessible={false} style={[s.eagle, rtl && s.flip]} testID="insight-how-eagle" />
                </View>
              ) : null}
            </View>
            <View style={[s.falconerRow, row]}>
              {/* ONE LOGO, THE FALCONER (owner 2026-11-12: «let's just make 1 logo which is the صقار»): no Shaheen mark here. */}
              <Text style={[s.falconer, align]}>{c.falconer}</Text>
            </View>
            <Text style={[s.story, align]}>{c.story(sites)}</Text>
            <Text style={[s.rulesTitle, align]}>{c.rulesTitle}</Text>
            {c.rules.map((r, i) => (
              <Text key={r.title} style={[s.rule, align, i === c.rules.length - 1 && s.ruleLast]}>
                <Text style={s.ruleTitle}>{`${rtl ? String(i + 1).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]) : i + 1}. ${r.title}: `}</Text>
                {r.body}
              </Text>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: space.card },
  card: { width: '100%', maxWidth: 460, maxHeight: '94%', backgroundColor: colors.surface, borderRadius: radius.sheet, overflow: 'hidden' },
  // physical right in BOTH languages — never flipped by RTL
  close: { position: 'absolute', top: space.card, right: space.card, zIndex: 2, padding: 2 },
  body: { paddingHorizontal: space.screenSide, paddingTop: space.card, paddingBottom: space.card },
  title: { fontSize: 19, fontWeight: '700', color: colors.ink, textAlign: 'center', marginHorizontal: 30 },
  eagleBox: { alignItems: 'center', justifyContent: 'center', height: 90, overflow: 'hidden', marginTop: 0 },
  eagle: { width: ART_W, height: ART_H },
  flip: { transform: [{ scaleX: -1 }] },
  falconerRow: { alignItems: 'center', gap: space.base, marginBottom: space.base / 2 },
  falconer: { fontSize: 17, fontWeight: '700', color: colors.ink },
  story: { fontSize: 14, lineHeight: 21, color: colors.body, marginBottom: 8 },
  rulesTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 2 },
  rule: { fontSize: 13, lineHeight: 19, color: colors.body, marginBottom: 4 },
  // «معلومة فقط» — the whole sentence bold (owner 2026-11-11: «make the entire sentence bold»)
  ruleLast: { fontWeight: '700', color: colors.ink },
  ruleTitle: { fontWeight: '700', color: colors.ink },
});
