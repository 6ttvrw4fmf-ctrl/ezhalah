// ──────────────────────────────────────────────────────────────────────────────
// agent — Ezhalah real AI Agent (PRD §7, §13) — Google Gemini
//
// Turns a free-text message (Arabic-first) into a structured classification the
// chat client already understands: { kind, reply, query }.
//
// ⚠ CLEAN SLATE (owner brief, 2026-08-16). The entire historical instruction layer was removed:
// the baked prompt, `agent_notes`, the city/type lists, the landmark injection, the question
// policy, the language directive, personality, and all per-request prompt text. What remains is
// PLUMBING ONLY — user message → Gemini → schema-shaped JSON → the existing deterministic
// post-processing → Ezhalah search.
//
// This means the model is NO LONGER INSTRUCTED with the PRD §7 non-advisory rule, the
// Gathern-is-rent-only rule, or any other product rule. Those must be rebuilt deliberately by
// the owner. Do NOT re-add them here ad hoc — and do not assume they are in force today.
// The deterministic layers below (price, period, location, platform) are untouched and still hold.
//
// The API key lives ONLY here (a Supabase secret), never in the app bundle. The
// client calls this function and falls back to its bundled heuristic if the
// function is unavailable, so the app never hard-fails.
//
// Auth: soft-gated (verify_jwt disabled at deploy). The client invokes with the
// public project key; this endpoint does no privileged work and writes nothing.
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
// Default to the mid 2.5 tier (strong instruction-following + Saudi Arabic);
// override with GEMINI_MODEL (e.g. gemini-2.5-flash-lite to cut cost, or -pro).
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
// When the primary model is rate-limited (503 "high demand"), fall back to the
// lighter tier rather than dropping the user to the bundled client heuristic.
const FALLBACK_MODEL = Deno.env.get("GEMINI_FALLBACK_MODEL") ?? "gemini-2.5-flash-lite";
const urlFor = (m: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── DETERMINISTIC CATALOG CLASSIFIER (loc_classify RPC) ───────────────────────
// The SQL function loc_classify(token) maps a location token to the official Arabic
// catalog, inventory-aware. It tells us, with certainty the LLM cannot, whether a
// place is a twin city (same name, ≥2 regions), a twin district (same «حي», ≥2
// cities), a region-or-city same-name (الرياض/جازان/…), a single city, or unknown.
// We use it as a POST-MODEL backstop so twin disambiguation + honest-zero are
// guaranteed regardless of model drift. Best-effort: any failure → null → normal path.
async function locClassify(token: string): Promise<Record<string, unknown> | null> {
  const t = (token || "").trim();
  if (!t) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/loc_classify`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ p_token: t }),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Arabic fold mirroring SQL normalize_ar: unify alef/ta-marbuta/alef-maqsura, drop
// tatweel + bidi marks, collapse spaces. Used to check whether the user already named
// one of the catalog candidates (so we don't re-ask a question they've answered).
function arNorm(s: string): string {
  return (s || "")
    .replace(/[‎‏‪-‮؜]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

// EDGE ANTI-GUESS (deterministic; parity with production v81). The model still sometimes "helpfully"
// appends a famous district's city («حي العزيزية» → «حي العزيزية، الخبر») despite the prompt. Never let a
// guessed city/region survive: if the location is a compound «X، anchor» whose trailing anchor (a city, or
// a «منطقة …» region) does NOT appear in anything the USER actually typed (this turn + prior user turns),
// drop the anchor and keep the bare place. The catalog backstop (loc_classify) then resolves a unique place
// or ASKS for an ambiguous district. An anchor the user DID type is always kept.
function stripGuessedAnchor(loc: unknown, text: string, history: Array<{ role?: string; text?: string }>): string {
  if (typeof loc !== "string" || !loc.trim()) return "";
  let s = loc.trim();
  const said = arNorm([text, ...(Array.isArray(history) ? history : [])
    .filter((h) => h && h.role !== "model")
    .map((h) => String(h?.text ?? ""))].join(" "));
  const parts = s.split(/[،,]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const anchor = parts[parts.length - 1];
    const core = anchor.replace(/^\s*(?:ال)?منطقة\s+/, "").trim();
    if (!said.includes(arNorm(anchor)) && (!core || !said.includes(arNorm(core)))) {
      s = parts.slice(0, -1).join("، ");
    }
  }
  return s;
}

// Public project keys (already shipped in the app bundle) — soft gate so random
// callers can't burn the model budget. No privileged work here.
const PUBLIC_KEY = "sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


// ── SYSTEM INSTRUCTION — DELIBERATELY BLANK (owner brief, 2026-08-16) ────────
// The entire historical instruction layer was removed for a clean-slate rebuild: the old baked
// prompt, all `agent_notes`, the hardcoded city/type lists, the landmark injection, the question
// policy, the language directive, personality, platform and currency prose.
//
// This is the BASELINE. It is one sentence of plumbing — enough for the model to know it is
// filling the response schema, and nothing else. Product behaviour is being rebuilt rule by rule
// by the owner. DO NOT append rules here: `scripts/verify-agent-prompt-clean-slate.ts` enforces
// the size ceiling and the no-dynamic-injection contract, and it is wired into `npm test`.
const SYSTEM = `You turn a property-search message into the JSON response schema.`;

// Deterministic price extraction — LLMs are unreliable at exact arithmetic, so we never trust the
// model's currency math. We re-parse the user's own text here and convert currencies + scale
// shorthand to a raw SAR figure ourselves (the SAME rules as the client heuristic). The model still
// classifies deal/location/type; this just guarantees "5000 kd" → 61000, "2m bd" → 19900000, etc.
const CURRENCY_RATES: Record<string, number> = {
  sar: 1, sr: 1, riyal: 1,
  usd: 3.75, dollar: 3.75, aed: 1.02, dh: 1.02, dhm: 1.02, dhs: 1.02, dirham: 1.02,
  eur: 4.1, euro: 4.1, gbp: 4.8, pound: 4.8,
  kwd: 12.2, kd: 12.2, dinar: 12.2, bhd: 9.95, bd: 9.95,
  qar: 1.03, qr: 1.03, omr: 9.75, egp: 0.08,
};

// Arabic currency words → SAR rate. Specific (two-word) forms before the bare word.
const AR_CURRENCY: Array<[RegExp, number]> = [
  [/دينار\s*كويتي/, 12.2],
  [/دينار\s*بحريني/, 9.95],
  [/دينار\s*أردني|دينار\s*اردني/, 5.3],
  [/دينار/, 12.2],
  [/درهم/, 1.02],
  [/دولار/, 3.75],
  [/يورو/, 4.1],
  [/جنيه\s*(?:استرليني|إسترليني)/, 4.8],
  [/جنيه/, 0.08],
  [/ريال|ريالات|﷼/, 1],
];

// An explicit RANGE ("من 300,000 الى 1,500,000" / "بين 300 ألف و 1.5 مليون" / "from 300k to 1.5m" /
// "between 300,000 and 1,500,000" / "300000-1500000") — the two-sided connector, not just a bare "و".
// JS \b is only defined relative to ASCII \w, so it NEVER matches a boundary next to Arabic script
// (the same defect as the region_or_city Arabic-boundary bug elsewhere in this file) — a plain
// /\bمن\b/ would silently never match any real Arabic text. Unicode-aware lookarounds instead; \b is
// still correct for the English connectors (ASCII words only).
const RANGE_RE = /(?<![\p{L}\p{N}])من(?![\p{L}\p{N}])[\s\S]{0,40}?(?<![\p{L}\p{N}])(?:الى|إلى)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])بين(?![\p{L}\p{N}])[\s\S]{0,60}?(?<![\p{L}\p{N}])و(?![\p{L}\p{N}])|\bfrom\b[\s\S]{0,40}?\bto\b|\bbetween\b[\s\S]{0,60}?\band\b|\d\s*-\s*\d/imu;

function extractPrice(input: string): string {
  const t = input.toLowerCase();
  const NUM_RE =
    /(\d[\d,.]*)\s*(?:(k|m|mn|million|thousand|bn|billion)(?![a-z]))?\s*(sar|sr|riyal|usd|\$|dollar|aed|dirham|dhm|dhs|dh|eur|€|euro|gbp|£|pound|kwd|kd|dinar|bhd|bd|qar|qr|omr|egp)?/gi;
  const candidates: number[] = [];
  for (const mm of t.matchAll(NUM_RE)) {
    const after = t.slice(mm.index! + mm[0].length, mm.index! + mm[0].length + 24);
    // A number followed by a SIZE/area unit is a SIZE, not money — skip it. We tolerate up to ~16
    // NON-DIGIT chars before the unit so a typo'd adjective ("1500 quare feet") or "square feet" still
    // counts as a size; a digit in between stops the match (so "5000 for 200 sqm" keeps 5000 as money).
    if (/^[^\d]{0,16}?(bed|bedroom|br\b|sqm|sq\.?\s*m|m2|m²|meter|metre|cm|centimeters?|centimetres?|square|sqft|sq\.?\s*ft|ft2|ft²|foot|feet|sq\b|متر|م٢|م2|غرف|غرفة|غرفه)/i.test(after)) continue;
    let n = parseFloat(mm[1].replace(/,/g, ""));
    if (!isFinite(n)) continue;
    const scale = (mm[2] || "").toLowerCase();
    if (scale === "k" || scale === "thousand") n *= 1_000;
    else if (scale === "m" || scale === "mn" || scale === "million") n *= 1_000_000;
    else if (scale === "bn" || scale === "billion") n *= 1_000_000_000;
    else if (/^\s*(?:ألف|الف|آلاف)/.test(after)) n *= 1_000;
    else if (/^\s*(?:مليون|ملايين)/.test(after)) n *= 1_000_000;
    else if (/^\s*(?:مليار)/.test(after)) n *= 1_000_000_000;
    let rate = 0;
    const cur = (mm[3] || "").toLowerCase();
    if (cur) rate = CURRENCY_RATES[cur] ?? 0;
    if (!rate) { for (const [re, r] of AR_CURRENCY) { if (re.test(after)) { rate = r; break; } } }
    if (rate && rate !== 1) n = Math.round(n * rate);
    if (n >= 100) candidates.push(Math.round(n));
  }
  if (!candidates.length) return "";
  // This function's single price slot has no separate minimum — it's always applied as a CEILING (see
  // the client's agentPriceCapAnnual()). Historically this
  // returned the FIRST valid money figure encountered, so an explicit range ("من 300,000 الى
  // 1,500,000") returned the LOWER bound (300,000) as the ceiling — turning a 300k-1.5m budget search
  // into a ≤300k-only search (found live 2026-07-27: a 254,000 SAR listing came back, below the user's
  // own stated floor). When 2+ valid candidates exist AND the text reads as an explicit range, use the
  // HIGHEST one instead. A single number (the overwhelmingly common case) is unaffected; multiple
  // numbers with no range phrasing keep the original first-match behavior (unrelated figures elsewhere
  // in the message must not silently become the budget).
  if (candidates.length > 1 && RANGE_RE.test(input)) return String(Math.max(...candidates));
  return String(candidates[0]);
}

// Detect a FOREIGN-currency budget and format it for display ("USD 100,000"), so the client can show
// BOTH the user's original figure and the SAR conversion. Returns "" for SAR-only or no currency.
// Checks Latin-script currency words/codes first, then falls back to Arabic currency words (found
// live 2026-07-26: this previously had NO Arabic-word path at all, unlike extractPrice()'s own
// AR_CURRENCY fallback a few lines up — so query.priceOriginal silently never populated for a budget
// stated in Arabic, e.g. "5000 دينار كويتي", even though the SAR conversion itself (query.price) was
// already correct via extractPrice()).
const CUR_LABEL: Record<string, string> = {
  usd: "USD", dollar: "USD", dollars: "USD", aed: "AED", dh: "AED", dhm: "AED", dhs: "AED", dirham: "AED",
  eur: "EUR", euro: "EUR", gbp: "GBP", pound: "GBP", kwd: "KWD", kd: "KWD", dinar: "KWD", bhd: "BHD", bd: "BHD",
  qar: "QAR", qr: "QAR", omr: "OMR", egp: "EGP",
};
// Arabic currency words → canonical display code — mirrors AR_CURRENCY's Arabic→rate mapping above,
// same ordering (specific two-word forms before the bare word).
const AR_CUR_LABEL: Array<[RegExp, string]> = [
  [/دينار\s*كويتي/, "KWD"],
  [/دينار\s*بحريني/, "BHD"],
  [/دينار\s*أردني|دينار\s*اردني/, "JOD"],
  [/دينار/, "KWD"],
  [/درهم/, "AED"],
  [/دولار/, "USD"],
  [/يورو/, "EUR"],
  [/جنيه\s*(?:استرليني|إسترليني)/, "GBP"],
  [/جنيه/, "EGP"],
];
function originalCurrency(input: string): string {
  const t = input.toLowerCase();
  const RE = /(\d[\d,.]*)\s*(k|m|mn|million|thousand|bn|billion)?\s*(usd|dollars?|aed|dirham|dhm|dhs|dh|eur|euro|gbp|pound|kwd|kd|dinar|bhd|bd|qar|qr|omr|egp)\b/i;
  const m = RE.exec(t);
  if (m) {
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (isFinite(n)) {
      const scale = (m[2] || "").toLowerCase();
      if (scale === "k" || scale === "thousand") n *= 1_000;
      else if (scale === "m" || scale === "mn" || scale === "million") n *= 1_000_000;
      else if (scale === "bn" || scale === "billion") n *= 1_000_000_000;
      const code = CUR_LABEL[(m[3] || "").toLowerCase()] ?? "";
      if (code) return `${code} ${Math.round(n).toLocaleString("en-US")}`;
    }
  }
  // No Latin match — scan for a number followed (within a short window, same as extractPrice()'s
  // own `after` lookahead) by an Arabic currency word.
  const AR_NUM_RE = /(\d[\d,.]*)\s*(ألف|الف|آلاف|مليون|ملايين|مليار)?/g;
  for (const mm of input.matchAll(AR_NUM_RE)) {
    const after = input.slice(mm.index! + mm[0].length, mm.index! + mm[0].length + 24);
    const hit = AR_CUR_LABEL.find(([re]) => re.test(after));
    if (!hit) continue;
    let n = parseFloat(mm[1].replace(/,/g, ""));
    if (!isFinite(n)) continue;
    if (mm[2] === "ألف" || mm[2] === "الف" || mm[2] === "آلاف") n *= 1_000;
    else if (mm[2] === "مليون" || mm[2] === "ملايين") n *= 1_000_000;
    else if (mm[2] === "مليار") n *= 1_000_000_000;
    return `${hit[1]} ${Math.round(n).toLocaleString("en-US")}`;
  }
  return "";
}

// LANGUAGE DETECTION (deterministic) — the reply language must follow the user's LATEST
// message, NOT the app's UI locale. (The app was sending its UI locale, so typing English in an
// Arabic-set app got an Arabic reply.) We count WORDS, not characters: more Arabic words → "ar",
// more Latin words → "en". A tie or a letter-less message (digits/punctuation only, e.g. "4000")
// returns null so the caller can fall back to the conversation's language. Counting words (not
// letters) means a single foreign name — "ابحث عن فيلا في Riyadh" — doesn't flip the whole reply.
function detectLang(s: string): "ar" | "en" | null {
  const words = s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let ar = 0, en = 0;
  for (const w of words) {
    if (/[؀-ۿ]/.test(w)) ar++;
    else if (/[A-Za-z]/.test(w)) en++;
  }
  if (ar === en) return null;
  return ar > en ? "ar" : "en";
}

// The model occasionally ignores the "no generic chatbot filler" rule, so strip the
// boilerplate openers deterministically. (Ezhalah's own "أبشر"/"On it" swagger is NOT stripped.)
function stripFiller(s: string): string {
  let out = String(s ?? "").trim();
  const patterns: RegExp[] = [
    /^(?:sure|of course|absolutely|no problem|great|got it|okay|ok|alright|certainly)[,!.]*\s+/i,
    /^i(?:'| a)?m happy to help[^.!?]*[.!?]\s*/i,
    /^i can (?:definitely |certainly )?help (?:you )?(?:with that|find|out)[^.!?]*[.!?]\s*/i,
    /^i'?d be (?:happy|glad) to help[^.!?]*[.!?]\s*/i,
    /^happy to help[^.!?]*[.!?]\s*/i,
    /^(?:أكيد|طبعاً|طبعا|حاضر|بكل سرور|ما يحتاج)[،,!.]*\s+/,
    /^(?:نقدر|أقدر|بقدر) (?:نساعدك|أساعدك|اساعدك)[^.؟!]*[.؟!]\s*/,
  ];
  for (const p of patterns) {
    const next = out.replace(p, "").trim();
    if (next && next !== out) out = next;
  }
  if (out && /[a-z]/.test(out[0])) out = out[0].toUpperCase() + out.slice(1);
  return out || String(s ?? "").trim();
}

// Gemini structured-output schema (OpenAPI subset; uppercase types).
const SCHEMA = {
  type: "OBJECT",
  properties: {
    kind: { type: "STRING", enum: ["listings", "message", "interview"] },
    reply: { type: "STRING" },
    deal: { type: "STRING", enum: ["Rent", "Buy", "Both"] },
    location: { type: "STRING" },
    type: { type: "STRING" },
    detail: { type: "STRING" },
    price: { type: "STRING" },
    pricing_basis: {
      type: "STRING",
      enum: ["daily_rent", "weekly_rent", "monthly_rent", "quarterly_rent", "annual_rent", "full_price", "price_per_sqm", "none"],
    },
    rent_period: { type: "STRING", enum: ["none", "monthly", "annual"] },
    sort: {
      type: "STRING",
      enum: ["none", "newest", "oldest", "price_asc", "price_desc", "area_asc", "area_desc", "ppm_asc", "ppm_desc", "beds_desc"],
    },
    count: { type: "STRING" },
    platforms: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["kind", "reply", "deal", "location", "type", "detail", "price", "pricing_basis", "rent_period", "sort", "count", "platforms"],
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const apikey = req.headers.get("apikey") ?? "";
  const ok = [ANON_KEY, PUBLIC_KEY].filter(Boolean);
  if (!ok.includes(token) && !ok.includes(apikey)) {
    return json({ error: "unauthorized" }, 401);
  }

  if (!GEMINI_API_KEY) {
    // Tell the client to fall back to its bundled heuristic.
    return json({ error: "model not configured" }, 503);
  }

  let text = "";
  let locale = "ar";
  let loggedIn = false;
  let order = false;
  let history: Array<{ role?: string; text?: string }> = [];
  try {
    const body = await req.json();
    text = String(body?.text ?? "").slice(0, 1000);
    locale = body?.locale === "en" ? "en" : "ar";
    loggedIn = body?.loggedIn === true;
    order = body?.order === true;
    // Prior conversation turns so the model has MEMORY. The client sends recent turns; we cap here too.
    if (Array.isArray(body?.history)) history = body.history.slice(-12);
  } catch {
    return json({ error: "bad request" }, 400);
  }
  if (!text.trim()) return json({ error: "empty" }, 400);

  // REPLY LANGUAGE = the language of the user's LATEST message, never the app's UI locale.
  // If this message is letters-free (e.g. just "4000"), keep the conversation going in the
  // language of the most recent message that HAD letters; only then fall back to the UI locale.
  const appLocale = locale;
  let replyLang = detectLang(text);
  if (!replyLang) {
    // detectLang returned null for one of two reasons:
    //  (a) the message MIXES Arabic and Latin words evenly — a true tie. Per the
    //      training rule, a tie follows the conversation's STARTING language, so we
    //      scan history oldest→newest and take the first message that had letters.
    //  (b) the message has NO letters at all (e.g. "4000") — keep the conversation in
    //      the language of the most RECENT message that had letters.
    const tie = /[؀-ۿ]/.test(text) && /[A-Za-z]/.test(text);
    if (tie) {
      for (let i = 0; i < history.length; i++) {
        const d = detectLang(String(history[i]?.text ?? ""));
        if (d) { replyLang = d; break; }
      }
    } else {
      for (let i = history.length - 1; i >= 0; i--) {
        const d = detectLang(String(history[i]?.text ?? ""));
        if (d) { replyLang = d; break; }
      }
    }
  }
  locale = replyLang ?? appLocale;

  try {
    const headers = {
      "x-goog-api-key": GEMINI_API_KEY, // key in header, never the URL
      "content-type": "application/json",
    };
    // Build a multi-turn conversation: prior turns (memory) + the current message VERBATIM. We
    // sanitize so Gemini's rules hold — contents must START with a user turn and not repeat a role.
    // No wrapper, no directives, no injected context: the user's text is sent as the user typed it.
    const currentTurn = text;
    const rawTurns = [
      ...history.map((h) => ({ role: h?.role === "model" ? "model" : "user", text: String(h?.text ?? "").slice(0, 2000).trim() })),
      { role: "user", text: currentTurn },
    ].filter((tn) => tn.text);
    while (rawTurns.length && rawTurns[0].role === "model") rawTurns.shift();
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    for (const tn of rawTurns) {
      const last = contents[contents.length - 1];
      if (last && last.role === tn.role) last.parts[0].text += "\n" + tn.text;
      else contents.push({ role: tn.role, parts: [{ text: tn.text }] });
    }

    const genConfig = {
      temperature: 0.3,
      // Gemini 2.5 Flash is a "thinking" model — reasoning tokens count against maxOutputTokens. We
      // don't need chain-of-thought for classification, so we disable thinking and give JSON headroom.
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 800,
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
    };
    const models = [MODEL, FALLBACK_MODEL].filter((m, i, a) => a.indexOf(m) === i);
    // Call Gemini with the given contents and return the parsed JSON object, or { __err } with a ready
    // Response on failure. Flash can return 503 during spikes — retry once, then fall back to lite.
    // NOTE: no `sysExtra` seam. The system instruction is exactly SYSTEM — nothing may be appended
    // per-request. That is the clean-slate contract, enforced by verify-agent-prompt-clean-slate.ts.
    const runModel = async (cts: Array<{ role: string; parts: Array<{ text: string }> }>): Promise<any> => {
      const payload = JSON.stringify({ system_instruction: { parts: [{ text: SYSTEM }] }, contents: cts, generationConfig: genConfig });
      let res: Response | null = null;
      outer: for (const m of models) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const r = await fetch(urlFor(m), { method: "POST", headers, body: payload });
          if (r.ok) { res = r; break outer; }
          res = r;
          if (![429, 500, 502, 503].includes(r.status)) break outer;
          await r.body?.cancel().catch(() => {});
          if (attempt === 0) await new Promise((rs) => setTimeout(rs, 500));
        }
      }
      if (!res || !res.ok) { const detail = res ? await res.text() : "no response"; return { __err: json({ error: `gemini ${res?.status ?? 0}`, detail }, 502) }; }
      const data = await res.json();
      const raw = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? "").join("").trim();
      if (!raw) return { __err: json({ error: "empty model output" }, 502) };
      try { return JSON.parse(raw); } catch { return { __err: json({ error: "unparseable model output", raw }, 502) }; }
    };

    let out: any = await runModel(contents);
    if (out?.__err) return out.__err;
    if (!out?.kind) return json({ error: "no classification" }, 502);


    const lead = (s: string) => {
      let body = stripFiller(String(s ?? "").trim());
      // Belt-and-braces on the no-language-mixing rule: if we're replying in English, strip a leading
      // Arabic interjection the model sometimes adds for flavor ("أبشر! ...", "يا هلا، ...").
      if (locale === "en") {
        body = body.replace(/^\s*(?:أبشر|يا\s*هلا|هلا|أهلاً?|أهلين|تم|حياك(?:\s*الله)?|أكيد|إن\s*شاء\s*الله)[\s,!.،؛-]*/u, "").trim();
        if (body && /[a-z]/.test(body[0])) body = body[0].toUpperCase() + body.slice(1);
      } else {
        // Brand greeting normalization (Arabic): the model occasionally still opens with "يا هلا" /
        // "هلا" / "أهلاً" — replace any of those leading greeting variants with the canonical "ارحب".
        body = body.replace(/^\s*(?:يا\s*هلا(?:\s*بك)?|هلا(?:\s*بك)?|أهلاً?(?:\s*وسهلاً)?|أهلين|مرحب(?:ا|اً|ًا)?)\b/u, "ارحب");
      }
      return body;
    };

    if (out.kind === "interview") return json({ kind: "interview" });
    if (out.kind === "listings") {
      // Trust our deterministic conversion of the user's own text over the model's arithmetic;
      // only fall back to the model's price when we couldn't detect a figure ourselves.
      let detPrice = extractPrice(text);
      // A budget stated EARLIER in the conversation ("2,000,000 BHD house" up front, then "in Hail",
      // then "just a house") must not be lost when the search finally fires on a later, price-free
      // message — and it must keep its currency conversion. So if THIS message has no figure, scan the
      // user's previous turns (newest → oldest) and re-extract the most recent one (extractPrice does
      // the BHD/USD/… → SAR math). (user-reported: foreign-currency budget dropped across turns.)
      if (!detPrice) {
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i]?.role === "model") continue; // only the user states a budget
          const p = extractPrice(String(history[i]?.text ?? ""));
          if (p) { detPrice = p; break; }
        }
      }
      let modelPrice = String(out.price ?? "").replace(/[^\d]/g, "");
      // A SIZE is not a budget. When the user gives one number with a size unit ("200000 cm", "500
      // sqm"), extractPrice rightly skips it — but the model sometimes ALSO copies that number into
      // `price`, so it shows as both Size and Budget. If we found no real money figure and the model's
      // "price" is just the SIZE repeated, drop it. (user-reported double-count of "200000 cm".)
      const detailDigits = String(out.detail ?? "").replace(/[^\d]/g, "");
      if (!detPrice && modelPrice && modelPrice === detailDigits) modelPrice = "";
      // The price BASIS disambiguates rent vs sale better than the bare number: a recurring
      // basis is always Rent; a sale/per-meter basis is always Buy. Trust it over the model's
      // own "deal" only when it's an unambiguous signal (the model occasionally sets deal wrong
      // when the user gives a monthly figure without saying "rent").
      const basis = String(out.pricing_basis ?? "");
      // "Both" = the agent searched without knowing rent vs buy → show both. A price BASIS still
      // disambiguates (any rent period is Rent, a sale figure is Buy), so it cancels "Both".
      let bothDeals = out.deal === "Both";
      let deal: "Rent" | "Buy" = out.deal === "Buy" ? "Buy" : "Rent";
      const rentMult: Record<string, number> = { daily_rent: 365, weekly_rent: 52, monthly_rent: 12, quarterly_rent: 4, annual_rent: 1 };
      if (basis in rentMult) { deal = "Rent"; bothDeals = false; }
      else if (basis === "full_price" || basis === "price_per_sqm") { deal = "Buy"; bothDeals = false; }
      // EXPLICIT rental-period filter (senior audit run #3, 2026-08-03): «للإيجار الشهري» must search
      // the MONTHLY pool — before this, the client's emptyQuery() default ('annual') silently searched
      // annual-only for an explicitly-monthly request (100% intent inversion). Two explicit signals
      // only: the model's rent_period (the user's own wording) and a budget whose basis is monthly/
      // annual. Unstated stays undefined → the client keeps its Filter-parity default. Daily/weekly/
      // quarterly budgets annualize the NUMBER but don't remap the pool (conservative).
      let rentPeriod: "monthly" | "annual" | undefined;
      const rp = String(out.rent_period ?? "");
      if (rp === "monthly" || rp === "annual") rentPeriod = rp;
      else if (basis === "monthly_rent") rentPeriod = "monthly";
      else if (basis === "annual_rent") rentPeriod = "annual";
      if (deal !== "Rent") rentPeriod = undefined;
      // Rent is compared ANNUALLY — convert the stated period to a yearly figure (daily ×365,
      // weekly ×52, monthly ×12, quarterly ×4) so the client filters on an annual budget.
      let price = detPrice || modelPrice;
      let priceIsAnnual = false;
      if (deal === "Rent" && price && basis in rentMult) {
        const n = parseInt(price, 10);
        if (isFinite(n)) { price = String(n * rentMult[basis]); priceIsAnnual = true; }
      }
      // The user's ORIGINAL foreign-currency budget (e.g. "USD 100,000") — current message first, else
      // the most recent prior user turn that carried it — so the client can show both it and the SAR.
      let priceOriginal = originalCurrency(text);
      if (!priceOriginal) {
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i]?.role === "model") continue;
          const o = originalCurrency(String(history[i]?.text ?? ""));
          if (o) { priceOriginal = o; break; }
        }
      }
      // Bug-fix #7 (audit `agent-no-postmodel-catalog-guard`): defensive post-model location guard.
      // Pass through the model's location verbatim — the client resolver validates against the full
      // catalog (4,581 cities). NEVER force into a fixed city list; if Gemini outputs Arabic
      // (e.g. "ذبحة" for the unknown Eastern-Province city), let it through unchanged so the client
      // can match it exactly. Just normalize whitespace and reject objects/arrays sneaking through.
      const rawLoc = typeof out.location === "string" ? out.location : "";
      // EDGE ANTI-GUESS (parity with prod v81): strip any city/region the user never typed BEFORE the
      // catalog backstop runs, so a model-appended anchor («حي العزيزية» → «حي العزيزية، الخبر») can't slip
      // a guessed city past loc_classify. A user-typed anchor is kept; loc_classify then asks for a bare
      // ambiguous district. The client safeguard remains as the final net.
      let location = stripGuessedAnchor(rawLoc, text, history).replace(/\s+/g, " ").trim();

      // ── DETERMINISTIC CATALOG BACKSTOP ──────────────────────────────────────
      // Disambiguate twins + region-vs-city against the official Arabic catalog BEFORE
      // searching — never silently pick a region/city, never false-zero a real twin.
      // loc_classify is authoritative; the model only proposes the token. A follow-up
      // guard prevents re-asking a question the user just answered (no ask-loops).
      let regionPin: string | undefined;   // region_ar to scope a twin city to one region
      let districtPin: string | undefined; // «حي …» to scope a twin district to one city
      if (location) {
        const cls = await locClassify(location);
        const ck = String(cls?.kind ?? "");
        const nm = String(cls?.name ?? location);
        const lastModel = [...history].reverse().find((h) => h?.role === "model")?.text ?? "";
        // markers of a clarification WE generated on the previous turn → this turn answers it
        const alreadyAsked = /أكثر من منطقة|أكثر من مدينة|اسم مدينة واسم منطقة|ولا منطقة/.test(String(lastModel));
        const hay = arNorm(`${text} ${history.map((h) => String(h?.text ?? "")).join(" ")}`);
        const said = (s: string) => !!s && hay.includes(arNorm(s));

        if (ck === "region_or_city") {
          // JS \b is only defined relative to ASCII \w — it never matches Arabic script, so the old
          // /\bمدينة\b/ / /\bمنطقة\b/ could NEVER match any Arabic text, making this whole branch dead
          // for every real user (found live 2026-07-25). Use Unicode-aware boundaries instead
          // ((?<![\p{L}\p{N}])...(?![\p{L}\p{N}])) — plain .includes() would false-positive on a place
          // name that happens to CONTAIN one of these words fused with no space, e.g. «المدينة المنورة»
          // (Madinah) contains «مدينة», «المنطقة الشرقية» (Eastern Province) contains «منطقة»; the
          // lookaround correctly excludes both since the preceding character there is a letter (from
          // «ال»), not a boundary.
          const wantsCity = /(?<![\p{L}\p{N}])مدينة(?![\p{L}\p{N}])/u.test(text);
          const wantsRegion = /(?<![\p{L}\p{N}])منطقة(?![\p{L}\p{N}])/u.test(text);
          // regionPin's contract (see its declaration above) is "pin a TWIN CITY to one region" — it
          // was never meant for "search the whole region" and resolveSearchScope() has no way to tell
          // the two apart (found live 2026-07-25: reusing it here silently narrowed a whole-region
          // request down to the one city sharing the region's name, hiding every other city in it).
          // Set `location` instead, reusing the client's already-correct resolution paths: an explicit
          // "منطقة X" resolves as a REGION (locations.ts's own resolveLocation, independent of this
          // function); a bare city name resolves as an exact single city. Never touch regionPin here.
          if (wantsRegion && !wantsCity) location = `منطقة ${nm}`;
          else if (wantsCity && !wantsRegion) location = nm;
          else if (!wantsCity && !wantsRegion && !alreadyAsked) {
            return json({ kind: "message", reply: `«${nm}» اسم مدينة واسم منطقة في نفس الوقت. تقصد مدينة ${nm} ولا منطقة ${nm} كاملة؟` });
          }
        } else if (ck === "twin_city") {
          const regions = (Array.isArray(cls?.regions) ? cls!.regions : []) as Array<Record<string, unknown>>;
          const pick = regions.find((r) => said(String(r.region_ar)) || said(String(r.region_ar).replace(/^منطقة\s+/, "")));
          if (pick) regionPin = String(pick.region_ar);
          else if (!alreadyAsked && regions.length > 1) {
            const list = regions.map((r) => String(r.region_ar)).join("، ");
            return json({ kind: "message", reply: `«${nm}» موجودة في أكثر من منطقة (${list}). أي منطقة تقصد؟` });
          }
        } else if (ck === "twin_district") {
          const cities = (Array.isArray(cls?.cities) ? cls!.cities : []) as Array<Record<string, unknown>>;
          const pick = cities.find((c) => said(String(c.city_ar)));
          if (pick) { location = String(pick.city_ar); districtPin = `حي ${nm}`; }
          else if (!alreadyAsked && cities.length > 1) {
            const top = cities.slice(0, 8);
            const lines = top.map((c) => `• ${c.city_ar}`).join("\n");
            const more = cities.length > top.length ? "\n• أو مدينة أخرى" : "";
            return json({ kind: "message", reply: `حي ${nm} موجود في أكثر من مدينة. تقصد حي ${nm} في أي مدينة؟\n${lines}${more}` });
          }
        }
      }

      // The model's own reply SENTENCE is free-form and inconsistently mentions a SIZE the user gave —
      // it always lands in query.detail and therefore always shows in the deterministic "Search Summary"
      // block, but the sentence itself sometimes omits it (found live 2026-07-27: "فيلا 500 متر" showed
      // "Size: 500 m²" in the summary while the reply sentence never said 500 at all). Same fix pattern as
      // extractPrice() above: don't trust the model to be exhaustive, backstop it deterministically. The
      // bedroom-shape regex mirrors the client's own detail-is-bedrooms-vs-size check (src/data/search.ts).
      const detailStr = typeof out.detail === "string" ? out.detail.trim() : "";
      const isSizeDetail = detailStr !== "" && !/^([1-4]|5\+?)$/.test(detailStr);
      let replyOut = lead(out.reply);
      if (isSizeDetail && !replyOut.includes(detailStr)) {
        replyOut = locale === "en" ? `${replyOut} (${detailStr} m²)` : `${replyOut} (${detailStr} م²)`;
      }

      return json({
        kind: "listings",
        reply: replyOut,
        query: {
          deal,
          bothDeals,
          priceIsAnnual,
          rentPeriod,
          location,
          regionPin,
          districtPin,
          type: typeof out.type === "string" && out.type ? out.type : null,
          detail: typeof out.detail === "string" && out.detail ? out.detail : null,
          price,
          priceOriginal: priceOriginal || undefined,
          sort: typeof out.sort === "string" && out.sort && out.sort !== "none" ? out.sort : undefined,
          count: (() => {
            const n = parseInt(String(out.count ?? "").replace(/[^\d]/g, ""), 10);
            return isFinite(n) && n >= 1 ? Math.min(n, 15) : undefined;
          })(),
          platforms: Array.isArray(out.platforms) ? out.platforms.filter((p: unknown) => typeof p === "string" && p) : [],
        },
      });
    }
    return json({ kind: "message", reply: lead(out.reply) });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
