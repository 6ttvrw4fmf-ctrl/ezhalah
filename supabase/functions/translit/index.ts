// ─────────────────────────────────────────────────────────────────────────────
// translit — transliterate a PERSON'S NAME between Arabic and Latin script.
//
// Ezhalah shows the user's name in the app's language: Arabic UI → Arabic name,
// English UI → Latin name. When the user edits their name in one script we
// generate the other so both stay synced. Names aren't "translated" — they're
// transliterated, and a phonetic table mangles them ("Al Nashwan" → "ال ناشوان"
// instead of "النشوان"). Gemini knows the natural spelling, so we use it, with the
// client keeping a deterministic phonetic fallback for when this is unavailable.
//
// Stateless, non-advisory, writes nothing. Soft-gated by the public project key.
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
// Names are a trivial task — use the cheapest fast tier.
const MODEL = Deno.env.get("TRANSLIT_MODEL") ?? "gemini-2.5-flash-lite";
const urlFor = (m: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

const PUBLIC_KEY = "sb_publishable_vXzwxdpfrzmbwtbR5aXcKA_cMUO8hVB";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const apikey = req.headers.get("apikey") ?? "";
  const ok = [ANON_KEY, PUBLIC_KEY].filter(Boolean);
  if (!ok.includes(token) && !ok.includes(apikey)) return json({ error: "unauthorized" }, 401);

  if (!GEMINI_API_KEY) return json({ error: "model not configured" }, 503);

  let name = "";
  let target: "ar" | "en" = "ar";
  try {
    const body = await req.json();
    name = String(body?.name ?? "").slice(0, 120).trim();
    target = body?.target === "en" ? "en" : "ar";
  } catch {
    return json({ error: "bad request" }, 400);
  }
  if (!name) return json({ error: "empty" }, 400);

  const targetName = target === "ar" ? "Arabic" : "English (Latin)";
  const prompt =
    `Transliterate this personal name into ${targetName} script. Rules: output ONLY the transliterated ` +
    `name and nothing else — no quotes, no notes, no extra words. Keep the same word order and the same ` +
    `number of name parts. Use the natural, commonly-used spelling a Saudi person would use ` +
    `(e.g. Yusuf ↔ يوسف, Mohammed ↔ محمد, Al Nashwan ↔ النشوان). If a part is already in the target ` +
    `script, keep it as-is.\n\nName: ${name}`;

  try {
    const headers = { "x-goog-api-key": GEMINI_API_KEY, "content-type": "application/json" };
    const payload = JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 60 },
    });

    let res: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(urlFor(MODEL), { method: "POST", headers, body: payload });
      if (r.ok) { res = r; break; }
      res = r;
      if (![429, 500, 502, 503].includes(r.status)) break;
      await r.body?.cancel().catch(() => {});
      if (attempt === 0) await new Promise((rs) => setTimeout(rs, 400));
    }
    if (!res || !res.ok) {
      const detail = res ? await res.text() : "no response";
      return json({ error: `gemini ${res?.status ?? 0}`, detail }, 502);
    }
    const data = await res.json();
    let out = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p: any) => p?.text ?? "")
      .join("")
      .trim();
    // Strip any stray quotes/labels the model might add despite the instruction.
    out = out.replace(/^["'«»]+|["'«»]+$/g, "").replace(/^name\s*:\s*/i, "").trim();
    if (!out) return json({ error: "empty model output" }, 502);
    return json({ name: out, target });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
