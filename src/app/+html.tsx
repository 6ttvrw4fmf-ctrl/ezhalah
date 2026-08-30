import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';
import { buildThemeCss } from '../theme/palette';
import { THEME_KEY } from '../theme/themeMode';

// Customizes the static root HTML for every web page during static rendering (runs in Node, where
// `document` doesn't exist — so this is the ONLY place the initial <html> attributes are set).
//
// Ezhalah is Arabic-first / RTL by default, so bake `lang="ar" dir="rtl"` into the exported markup.
// Without this the static export defaults to LTR and the docked sidebar (and every flex row) paints
// on the wrong side until the client re-applies direction. The client still flips lang/dir when the
// user switches to English (see i18n.applyDirection).
//
// The app owns its own AR/EN system, so we hard-disable BROWSER translation (Chrome's "Translate
// this page" / Google Translate): `translate="no"` + the `notranslate` class on <html>, plus the
// `<meta name="google" content="notranslate">` directive. Without this, Google Translate layers a
// machine translation on top of our real bilingual copy and mangles the brand name and taxonomy.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="ar" dir="rtl" translate="no" className="notranslate">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        {/* Turn off browser auto-translation app-wide — the app manages its own AR/EN. */}
        <meta name="google" content="notranslate" />
        {/* FULL-APP THEME (owner 2026-08-28): both palettes as CSS custom properties — light on
            :root, dark on data-theme="dark" AND on the OS preference when no explicit choice is
            stored. Every entry of tokens.ts `colors` is a var() over these, so the whole app
            re-skins from this one block. Values live in src/theme/palette.ts only. */}
        <style dangerouslySetInnerHTML={{ __html: buildThemeCss() }} />
        {/* Pre-hydration boot: apply the persisted appearance BEFORE first paint (no flash of the
            wrong theme). Reads the SAME key ThemeProvider writes (src/theme/theme.tsx) — the
            theme barrier pins the two against each other. AUTH-GATED (owner 2026-08-28): the
            appearance is an authenticated-user asset, so without a Supabase auth token the page
            pins Light — a previous user's stored dark never flashes for a logged-out visitor. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var a=false;for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf('sb-')===0&&k.indexOf('-auth-token')>-1){a=true;break}}var m=a?localStorage.getItem(${JSON.stringify(THEME_KEY)}):'light';if(m==='light'||m==='dark')document.documentElement.setAttribute('data-theme',m);}catch(e){}`,
          }}
        />
        {/* Disable body scrolling on web so the root ScrollView matches native behavior. */}
        <ScrollViewStyleReset />
        {/* Desktop UI scale — REVERTED to 1:1 (owner, 2026-08-14 23:47). A zoom layer (1.1/1.2/1.3
            tiered by viewport) shipped earlier today for the "small and zoomed out" report, but on
            a MacBook it rendered the app "too zoomed in" (owner, with screenshot). Current owner
            call wins: normal browser scale everywhere. If desktop sizing comes back, revisit with
            real typography tokens rather than a body zoom. Barrier flipped to pin the ABSENCE:
            scripts/verify-desktop-ui-scale.ts. */}
      </head>
      <body>{children}</body>
    </html>
  );
}
