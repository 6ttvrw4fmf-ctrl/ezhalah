import { Platform } from 'react-native';

// Callback ref that marks a text node as "do not translate" for the browser's built-in page
// translation (Google Translate, Safari Translate, etc.). The Ezhalah brand name and the
// "Ezhalah AI Agent" label are proper nouns: auto-translation turns "إزهله بالذكاء الصناعي" into
// nonsense like "press him with artificial intelligence". Setting translate="no" (plus the
// conventional `notranslate` class) keeps them exactly as authored — Arabic stays Arabic, the brand
// stays the brand. No-op on native, where there is no browser translator.
//
// react-native-web forwards props through a whitelist that does NOT include `translate`, so we can't
// pass it as a prop — we reach the underlying DOM node through a ref instead.
export function noTranslateRef(node: unknown) {
  if (Platform.OS !== 'web') return;
  const el = node as { setAttribute?: (k: string, v: string) => void; classList?: { add: (c: string) => void } } | null;
  if (!el || typeof el.setAttribute !== 'function') return;
  el.setAttribute('translate', 'no');
  el.classList?.add('notranslate');
}
