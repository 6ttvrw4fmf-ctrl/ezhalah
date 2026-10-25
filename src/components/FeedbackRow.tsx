// ChatGPT-style feedback row — thumbs up / down (mutually exclusive; highlighted when active) +
// share + read-aloud. POSITION (owner 2026-07-09): rendered ONCE per results response, directly
// BELOW the «عرضت لك أول N إعلانات. تبي أعرض لك المزيد…» message — NOT under each property card (it
// originally shipped per-card; owner moved it). The «شكراً على ملاحظتك» confirmation is NOT rendered
// here — it fires the `onFeedback` callback and the HOST shows a ChatGPT-style toast at the top of
// the chat (owner 2026-07-09: toast above the conversation, not next to the buttons). Feedback is
// stored LOCALLY only (lib/listingFeedback, keyed by the results-message id → rates the RESPONSE,
// not one listing). UI-only: no search/cards/ranking.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, withDelay, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from '@/lib/useReducedMotion';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import { getListingFeedback, setListingFeedback, type FeedbackRating } from '@/lib/listingFeedback';
import { openWhatsAppCompose, isTouchDevice } from '@/lib/shareToWhatsApp';
import { speakReadAloud, stopReadAloud, subscribeReadAloud, readAloudRefusal, hasSpeakableContent,
         type ReadAloudSegment } from '@/lib/readAloud';
import { readAloudRefusalMessageKey, type ReadAloudRefusal } from '@/lib/readAloudVoice';

export default function FeedbackRow({
  feedbackKey, shareUrl, shareText, prepareShare, onFeedback, readAloudSegments, rtl,
}: {
  // The reply's own direction (owner 2026-10-23: an English answer in the Arabic UI keeps its
  // thumbs on the LEFT). Omitted = the UI locale's direction.
  rtl?: boolean;
  feedbackKey: string;
  shareUrl?: string;
  // The line sent next to the link (owner 2026-10-17: a signed-in user shares THEIR SEARCH with
  // «عقارات من {name} لك على إزهله 🦅 …» — src/lib/shareSearch.ts). Omitted for guests: bare link.
  shareText?: string;
  // A signed-in user's Share saves a COPY of the whole chat first (src/lib/sharedChat.ts) and shares its
  // short /s/<code> link. Resolves to that link, or null → the shareUrl above is used instead.
  prepareShare?: () => Promise<string | null>;
  onFeedback?: () => void; // fired when a rating is SET (not cleared) — host shows the thanks toast
  // The structured script (إزهله -> pause -> summary -> pause -> cards, owner 2026-08-19) this
  // response's 🔊 button reads. Omit/empty to hide the button entirely rather than render one that
  // speaks nothing — the CALLER decides the script (src/lib/readAloudScript.ts for results
  // messages), this component only ever plays whatever it's given.
  readAloudSegments?: ReadAloudSegment[];
}) {
  const { t, isRTL: uiRTL, locale } = useI18n();
  // Once per script, not once per render: every key typed re-renders this row, and answering walks all 500 spoken cards.
  const speakable = useMemo(() => hasSpeakableContent(readAloudSegments), [readAloudSegments]);
  const isRTL = rtl ?? uiRTL;
  const [rating, setRating] = useState<FeedbackRating | null>(() => getListingFeedback(feedbackKey));
  const reducedMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);
  // Free, on-device TTS only (owner P0, 2026-08-18) — see src/lib/readAloud.ts. `speaking` mirrors
  // the ONE shared "who is talking right now" id, so tapping a DIFFERENT response's 🔊 flips this
  // row back to idle automatically (single-speaker, no local queue to get out of sync).
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false); // mirrors `speaking` for the unmount-only cleanup below
  // Shown briefly when speakReadAloud() refuses to speak (root-cause fix, 2026-08-22: never hand
  // Arabic text to a non-Arabic voice; a graceful Arabic message instead). Auto-hides, same pattern
  // as `copied` below.
  //
  // WHICH message is now asked of readAloudRefusal(), not assumed. This used to be a boolean that
  // always rendered «الاستماع غير متاح على هذا الجهاز», so a refusal that only meant "the voice list
  // has not finished loading yet" was reported to the user as a permanent verdict about their
  // hardware — the repo's unknown -> NO rule, in the read-aloud surface. Measured on production,
  // 4/4: the 🔊 control first becomes tappable ~30s after load, which is INSIDE readAloud.ts's 45s
  // RETRY_WINDOW_MS, so the still-looking state is on the ordinary path rather than a startup edge.
  // i18n's own comment on that string already said it is "shown ONLY when the device/browser has no
  // Arabic voice at all"; this makes that true.
  const [refusal, setRefusal] = useState<ReadAloudRefusal>('none');
  useEffect(() => subscribeReadAloud((id) => {
    const mine = id === feedbackKey;
    speakingRef.current = mine;
    setSpeaking(mine);
  }), [feedbackKey]);
  // Stop mid-speech ONLY if the row itself unmounts (e.g. the user navigates away) — never leaves a
  // dangling utterance playing over a screen that no longer shows what's being read. Mount/unmount
  // only ([] deps); speakingRef (not state) is what the cleanup reads, so a normal speaking->idle
  // transition on this same row never calls stop() redundantly.
  useEffect(() => () => { if (speakingRef.current) stopReadAloud(); }, []);
  const onReadAloud = () => {
    if (speaking) { stopReadAloud(); return; }
    if (!readAloudSegments?.length) return;
    const started = speakReadAloud(feedbackKey, readAloudSegments, locale);
    if (!started) {
      // Ask WHY it refused rather than assuming the permanent case. 'none' cannot normally appear
      // here (a confirmed voice is exactly what makes speakReadAloud start), but if it ever does —
      // e.g. an empty segment list — saying nothing is more honest than inventing a device verdict.
      const why = readAloudRefusal(locale);
      if (why !== 'none') {
        setRefusal(why);
        setTimeout(() => setRefusal('none'), 3200);
      }
    }
  };

  // Only one of up/down active; clicking the active one clears it (ChatGPT feel). The thanks toast
  // fires only when a rating is SET (not when cleared). Side effects run OUTSIDE any state updater
  // (never during render) to avoid React's "cannot update a component while rendering" warning.
  const vote = (r: FeedbackRating) => {
    const next: FeedbackRating | null = rating === r ? null : r;
    setRating(next);
    setListingFeedback(feedbackKey, next);
    if (next) onFeedback?.();
  };

  // Share flow: on a phone, the phone's share menu with the link only (owner 2026-10-22), WhatsApp's
  // composer when the browser has no menu (src/lib/shareToWhatsApp.ts); on a desktop, copy the link
  // (the share icon briefly becomes a check). Never throws
  // to the user (cancel = no-op).
  const onShare = async () => {
    let url = shareUrl || 'https://ezhalah-app.vercel.app';
    if (prepareShare) { try { url = (await prepareShare()) || url; } catch { /* the search link still works */ } }
    const withText = shareText ? `${shareText}\n${url}` : url;
    try {
      if (Platform.OS === 'web') {
        // THE PHONE'S OWN SHARE MENU (owner 2026-10-22: «why direct WhatsApp, that isn't what we agreed»), so
        // the person can pick Instagram, Snapchat, Messages… The LINK ONLY is handed over — no text next to it —
        // so the target builds the card from the link (2026-10-20: link + text through the menu reached
        // WhatsApp without a card). A touch browser with no share menu still opens WhatsApp's composer;
        // a desktop copies. A cancelled menu (AbortError) is a choice, not a failure.
        const nav: any = typeof navigator !== 'undefined' ? navigator : null;
        if (isTouchDevice(nav, typeof window !== 'undefined' ? (window as any) : null) && typeof nav?.share === 'function') {
          // The invite line rides as the message text (owner 2026-10-22); the card's title stays the invite.
          try { await nav.share(shareText ? { text: shareText, url } : { url }); return; } catch (e: any) { if (e?.name === 'AbortError') return; }
        }
        if (openWhatsAppCompose(url)) return;
        await Clipboard.setStringAsync(withText);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } else {
        await Share.share({ message: withText, url });
      }
    } catch { /* user cancelled or share unavailable — no-op */ }
  };

  return (
    <View style={[fb.container, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
      {/* THE ICON ORDER NEVER MIRRORS (owner 2026-10-23: «keep it standard, copied like the English, just fix the
          order»): 👍 👎 share 🔊 reads left to right in every language. Only the row's EDGE follows the
          language — the container above right-aligns it for an Arabic reply. */}
      <View style={[fb.row, { flexDirection: 'row' }]}>
        {/* Reserve the pair's space so share/read-aloud never jump as the thumbs merge. */}
        <View style={fb.thumbs}>
          {(['up', 'down'] as const).map((direction, index) => (
            <ThumbVote key={direction} direction={direction} index={index} rating={rating}
              rtl={false} reducedMotion={reducedMotion} onPress={() => vote(direction)}
              label={t(direction === 'up' ? 'Helpful' : 'Not helpful')} />
          ))}
        </View>
        <FbButton icon={copied ? 'checkmark' : 'share-social-outline'} active={copied} onPress={onShare} label={t('Share')} />
        {/* THE SAME PREDICATE speakReadAloud() USES, not a second one that agrees most of the time.
            `readAloudSegments?.length` counted SEGMENTS; speaking needs a speakable UNIT, and
            buildUnits() drops a segment whose text is blank. In the gap the control rendered and its
            tap was a silent no-op (ops_incident #856) — see hasSpeakableContent()'s header. */}
        {speakable ? (
          <FbButton
            icon={speaking ? 'stop-circle' : 'volume-high-outline'}
            active={speaking}
            onPress={onReadAloud}
            label={speaking ? t('Stop reading') : t('Read aloud')}
          />
        ) : null}
      </View>
      {readAloudRefusalMessageKey(refusal)
        ? <Text style={fb.unavailable}>{t(readAloudRefusalMessageKey(refusal) as any)}</Text>
        : null}
    </View>
  );
}

const ThumbMotionView = Platform.OS === 'web' ? View : Animated.View;

// Both thumbs stay visible until they touch, then the unselected thumb fades away.
// Clearing that choice reverses the motion without moving the rest of the toolbar.
function ThumbVote({ direction, index, rating, rtl, reducedMotion, onPress, label }: {
  direction: FeedbackRating; index: number; rating: FeedbackRating | null;
  rtl: boolean; reducedMotion: boolean; onPress: () => void; label: string;
}) {
  const hidden = rating !== null && rating !== direction;
  const start = (rtl ? 1 - index : index) * 32;
  const offset = rating ? 16 - start : 0;
  const motion = useAnimatedStyle(() => ({
    transform: [{ translateX: withTiming(offset, { duration: reducedMotion ? 0 : 180, easing: Easing.bezier(0.23, 1, 0.32, 1) }) }],
    opacity: withDelay(hidden && !reducedMotion ? 180 : 0,
      withTiming(hidden ? 0 : 1, { duration: reducedMotion ? 0 : 60 })),
  }), [offset, hidden, reducedMotion]);
  const webMotion = Platform.OS === 'web' ? {
    transform: [{ translateX: offset }], opacity: hidden ? 0 : 1,
    transitionProperty: 'transform, opacity', transitionDuration: reducedMotion ? '0ms' : '180ms, 60ms',
    transitionDelay: hidden && !reducedMotion ? '0ms, 180ms' : '0ms',
    transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)',
  } as any : null;
  return (
    <ThumbMotionView
      pointerEvents={hidden ? 'none' : 'auto'}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      aria-hidden={hidden}
      style={[fb.thumbSlot, { left: start, zIndex: rating === direction ? 1 : 0 }, Platform.OS === 'web' ? webMotion : motion]}
    >
      <FbButton icon={rating === direction ? `thumbs-${direction}` : `thumbs-${direction}-outline`}
        active={rating === direction} disabled={hidden} onPress={onPress} label={label} />
    </ThumbMotionView>
  );
}

function FbButton({ icon, active, onPress, label, disabled = false }: { icon: any; active: boolean; onPress: () => void; label: string; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ selected: active, disabled }}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ hovered, pressed }: any) => [fb.btn, (hovered || pressed) && fb.btnHover, active && fb.btnActive]}
    >
      <Ionicons name={icon} size={16} color={active ? colors.primary : colors.muted} />
    </Pressable>
  );
}

const fb = StyleSheet.create({
  // Thin row below the more-results message.
  container: { width: '100%', paddingHorizontal: 4, paddingTop: 6 },
  row: { alignItems: 'center', gap: 2 },
  thumbs: { width: 62, height: 30 },
  thumbSlot: { position: 'absolute', top: 0 },
  // Small icon button (~30px target). Active = light green wash + accent icon (set inline).
  btn: { padding: 7, borderRadius: 9, ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}) },
  btnHover: { backgroundColor: colors.surface2 },
  btnActive: { backgroundColor: colors.tint },
  // Graceful "no Arabic voice on this device" note (root-cause fix, 2026-08-22) — never a wrong-
  // language voice instead, per owner requirement.
  unavailable: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
