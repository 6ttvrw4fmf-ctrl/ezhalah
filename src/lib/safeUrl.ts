// SECURITY (owner-approved plan, Phase 1.6, 2026-10-21): a listing link opens only as a real web page.
// A listing's address comes from a scraped source site. If one ever stored `javascript:…`, `data:…` or
// `vbscript:…`, a new tab or an iframe would RUN it on our origin. So every address we open, frame or
// hand to the in-app browser goes through here first: only http/https survive, everything else is
// undefined (and an undefined link simply does not open). Pure and import-free so
// scripts/verify-listing-links-are-web-only.ts can execute it.
export function safeHttpUrl(url: string | null | undefined): string | undefined {
  if (typeof url !== 'string') return undefined;
  const s = url.trim();
  if (!s) return undefined;
  let u: URL;
  try { u = new URL(s); } catch { return undefined; }
  return u.protocol === 'http:' || u.protocol === 'https:' ? s : undefined;
}
