import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

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
        {/* Disable body scrolling on web so the root ScrollView matches native behavior. */}
        <ScrollViewStyleReset />
        {/* Desktop UI scale (2026-08-14). The whole app is a mobile-first px design (body 13–15,
            titles 18–26, 560px content column) rendered 1:1 — perfect on a phone, visibly
            undersized on a desktop monitor (the owner-reported "small and zoomed out" issue).
            Rather than rewriting hundreds of hardcoded px values across ~20 components (a huge,
            mobile-endangering diff), the design gains a deliberate scale LAYER: `zoom` on <body>,
            tiered by viewport width. `zoom` (standardized; all evergreen browsers) reflows layout —
            unlike transform:scale — so text wraps, scrolling, and hit-targets stay correct, and the
            content column genuinely occupies more of the canvas (560px column ≈ 47% of a 1440px
            screen's effective width vs 39% before). Phones/tablets (<1100px) are untouched by
            construction. Tiers are calibrated, monotonic, and capped at 1.3 so nothing turns
            comically large. Regression barrier: scripts/verify-desktop-ui-scale.ts. */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
@media (min-width: 1100px) { body { zoom: 1.1; } }
@media (min-width: 1400px) { body { zoom: 1.2; } }
@media (min-width: 1700px) { body { zoom: 1.3; } }
`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
