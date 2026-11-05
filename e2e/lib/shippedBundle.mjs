// WHICH SHIPPED SCRIPT CARRIES A FEATURE — read across the whole SPLIT web build, never only the first <script>.
//
// The web build is split (ALWAYS FAST, owner 2026-10-27): the home page's first <script> is the 3.8 KB metro runtime
// and screens ride in hashed route chunks. A live check that read only the first script failed on every run after the
// split while production still shipped the feature (ad-viewer-speed-live, run 41567582462, 2026-11-03). Pure apart from
// `get`, so scripts/verify-shipped-bundle-reader.ts executes it against a fake site.
/** Every script the home page loads plus every hashed route chunk they reference; which one ships the tab. */
export async function shippedInstantShowTab(base, get = (u) => fetch(u).then((r) => (r.ok ? r.text() : '')).catch(() => '')) {
  const html = await get(`${base}/?cb=${Date.now()}`);
  const first = [...html.matchAll(/\/_expo\/static\/js\/web\/[^"']+\.js/g)].map((m) => m[0]);
  const seen = new Set(first);
  const queue = [...first];
  let files = 0, shipped = null;
  while (queue.length && !shipped) {
    const path = queue.shift();
    const js = await get(base + path);
    if (!js) continue;
    files++;
    if (js.includes('ad-load-bar') && js.includes('ad-slow-hint')) { shipped = path.split('/').pop(); break; }
    for (const m of js.matchAll(/[A-Za-z0-9_\-]+-[0-9a-f]{32}\.js/g)) {
      const p = `/_expo/static/js/web/${m[0]}`;
      if (!seen.has(p)) { seen.add(p); queue.push(p); }
    }
  }
  return { files, shipped };
}


/** The TEXT of every script the home page loads plus every hashed route chunk they reference, joined (2026-11-05).
 *  For a live check that asks «does the served build carry X anywhere» — the frontend-bundle parity check read only
 *  entry-*.js and went red on every run after the split while the deployed build carried main's certification. */
export async function shippedScriptsText(base, get = (u) => fetch(u).then((r) => (r.ok ? r.text() : '')).catch(() => '')) {
  const html = await get(`${base}/?cb=${Date.now()}`);
  const first = [...html.matchAll(/\/_expo\/static\/js\/web\/[^"']+\.js/g)].map((m) => m[0]);
  const seen = new Set(first);
  const pending = [...first];
  const parts = [];
  let files = 0, missing = 0;
  while (pending.length) {
    const path = pending.shift();
    const js = await get(base + path);
    if (!js) { missing++; continue; }
    files++;
    parts.push(js);
    for (const m of js.matchAll(/[A-Za-z0-9_\-]+-[0-9a-f]{32}\.js/g)) {
      const p = `/_expo/static/js/web/${m[0]}`;
      if (!seen.has(p)) { seen.add(p); pending.push(p); }
    }
  }
  return { files, missing, text: parts.join('\n') };
}
