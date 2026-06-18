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
      </head>
      <body>{children}</body>
    </html>
  );
}
