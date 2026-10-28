// facts-extract — a model PROXY for the facts-extraction test (owner, 2026-10-24).
//
// WHY A FUNCTION AT ALL. The DeepSeek key lives only in the edge runtime's secrets (no GitHub Actions
// secret holds it, by design). scrapers/facts/extract.py runs in Actions, so it sends sanitised ad
// texts HERE and this function makes the one paid call. It does nothing else:
//   - server-to-server only: the caller must present the project's service-role key (the Actions
//     job has it); a publishable/anon key is refused, so the public cannot drive spend through it;
//   - spend-gated: public.ai_spend_gate() is asked BEFORE the paid fetch and any failure DENIES
//     (same fail-closed contract as supabase/functions/agent/index.ts);
//   - NO database writes, NO logging of ad text; the caller logs tokens + cost to listing_facts_runs;
//   - model pinned to the non-reasoning "deepseek-chat" alias (bills as deepseek-flash). A reasoning
//     tier would spend thousands of hidden tokens per ad — see the MODEL CHOICE note in the agent;
//   - the fact catalogue is the SYSTEM message, byte-identical every request, so DeepSeek's prefix
//     cache pays for it once (CACHE PREFIX INVARIANT — nothing per-request may precede it).
// Hard per-request ceilings keep one call small; the per-RUN ceilings (calls, USD) live in the script.
const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-chat";
// TWO PROVIDERS, ONE READER (owner 2026-10-27: «the first key — reading the descriptions»). The OpenRouter READER key
// (OPENROUTER_API_KEY, its own credit limit on openrouter.ai) is a second door to the same DeepSeek model, pinned to
// the DeepSeek provider there so the prefix cache and the answers stay identical. The default provider is
// FACTS_PROVIDER (deepseek until the 500-ad pilot on openrouter is read and the owner says switch); a request may
// name `provider` to pilot the other door without flipping the default. Both doors sit behind the same service-role
// check, the same spend gate and the same monthly budget — and never behind the chat's key: each pot stops alone.
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = Deno.env.get("FACTS_OPENROUTER_MODEL") || "deepseek/deepseek-v3.2";
const OPENROUTER_PROVIDERS = (Deno.env.get("FACTS_OPENROUTER_PROVIDERS") || "DeepSeek").split(",").map((s) => s.trim()).filter(Boolean);
const DEFAULT_PROVIDER = Deno.env.get("FACTS_PROVIDER") === "openrouter" ? "openrouter" : "deepseek";
type Provider = "deepseek" | "openrouter";
const MAX_ADS = 20;
const MAX_CHARS_PER_AD = 4000;
const MAX_TOTAL_CHARS = 48000;
const MODEL_TIMEOUT_MS = 150_000;
const GATE_TIMEOUT_MS = 4000;

// The catalogue. SOURCE IS TRUTH: three outcomes per fact, proof or nothing, nearby never counts.
const SYSTEM = `أنت قارئ حقائق لإعلانات عقارية سعودية. تقرأ نص كل إعلان (عنوان + وصف) وتستخرج فقط الحقائق التي يذكرها النص حرفياً عن هذا العقار نفسه.

القواعد (إلزامية):
1. المصدر هو الحقيقة. لا تخمّن، لا تستنتج. "فيلا" لا تعني وجود حوش. "شقة" لا تعني وجود مصعد.
2. ثلاث نتائج لكل حقيقة: true = النص يذكر وجودها. false = النص ينفيها صراحة («بدون مسبح»، «لا يوجد مصعد»، «غير مفروشة»). لا شيء = النص ساكت عنها.
3. لا تُخرج الحقيقة إذا كانت: (أ) "تأسيس/مؤسس/مهيأ" فقط («مصعد مؤسس»، «تأسيس مسبح» = لا مصعد ولا مسبح)، (ب) عن الجوار لا عن العقار («قريب من»، «بجوار»، «مقابل»، «أمام»، «بالقرب من»)، (ج) جزئية أو غامضة («نصف مفروش»، «مفروش جزئياً»، «مفروش بالرخام/نجيل» = فرش أرضيات لا أثاث).
4. الاقتباس (quote) = كلمات الإعلان نفسها، مقطع متصل منسوخ حرفياً من النص المعطى (حتى 80 حرفاً)، بدون تصحيح إملاء أو إعادة صياغة. إن لم تجد اقتباساً حرفياً فلا تُخرج الحقيقة.
5. ممنوع: أسماء الأشخاص، أرقام الهواتف، وسائل التواصل، الأسعار، وأي وصف ذوقي (كبيرة، جميلة، فاخرة، إطلالة، موقع مميز، راقية).
6. حقيقة واحدة لكل مفتاح لكل إعلان. إن تعارض النص مع نفسه (مصعد ثم بدون مصعد) فلا تُخرجها.

الكتالوج — مفاتيح منطقية (value: true/false):
air_conditioner (مكيف، مكيفات، تكييف) · balcony (بلكونة، شرفة، تراس) · car_entrance (مدخل سيارة/سيارات) · driver_room (غرفة سائق) · electricity (كهرباء موصلة/متوفرة، عداد كهرباء — «غرفة كهرباء» أو «سليمة من غرفة الكهرباء» ليست دليلاً) · elevator (مصعد، مصاعد) · furnished (مفروش، مؤثث — كاملاً فقط) · garden (حديقة) · gym (نادي رياضي، جيم، صالة رياضية) · installment_available (تقسيط، أقساط) · kitchen (مطبخ راكب، مطبخ) · laundry_room (غرفة غسيل) · maid_room (غرفة خادمة/شغالة) · optical_fibers (ألياف بصرية، فايبر) · parking (موقف، مواقف سيارات) · payment_monthly (الدفع شهري، إيجار شهري) · pool (مسبح، بركة سباحة) · private_entrance (مدخل خاص، مدخل مستقل) · rent_now_pay_later (إيجار الآن وادفع لاحقاً، ادفع لاحقاً) · sanitation (صرف صحي) · separate_electricity_meter (عداد كهرباء مستقل) · separate_water_meter (عداد ماء/مياه مستقل) · water_supply (ماء/مياه موصلة أو متوفرة، شبكة مياه) · majlis (مجلس) · roof (سطح، روف) · warranty (ضمان، ضمانات) · water_tank (خزان ماء/مياه) · well (بئر) · annex (ملحق) · two_entrances (مدخلين) · yard (حوش) · electronic_deed (صك إلكتروني) · grill (مشب، شواية، منطقة شواء) · basement (بدروم، قبو) · storage (مستودع، مخزن) · garage (كراج، جراج).

مفاتيح رقمية (value: رقم فقط، بالأرقام الإنجليزية):
street_width_m (عرض الشارع بالمتر — فقط مع كلمة «عرض» أو وحدة «م/متر» أو اتجاه بجانب الرقم؛ «شارع 25» وحده قد يكون اسم شارع فلا يُخرج؛ طول الضلع على الشارع ليس عرضاً؛ إن ذُكر أكثر من شارع بعروض مختلفة فلا تُخرجها) · floors (عدد الأدوار الكلي: «دورين» = 2، «ثلاث أدوار» = 3 — «الدور الأول» رقم طابق وليس عدداً فلا يُخرج) · apartments_count (عدد الشقق) · shops_count (عدد المحلات) · property_age_years (عمر العقار بالسنوات — «جديد» ليست رقماً فلا تُخرج).

مفتاح نصي: boundaries (الحدود والأطوال — value = العبارة كاملة كما وردت، quote = نفس العبارة).

other: أي حقيقة مادية أخرى عن العقار غير موجودة في الكتالوج (مثل: شبكة ري، كاميرات، غرفة حارس، سخانات مركزية). value: true، مع label = تسمية عربية قصيرة (كلمة إلى ثلاث كلمات). ليس من other: الأسعار، المساحات، عدد الغرف/دورات المياه، الموقع، العروض، التواصل.

المدخل: JSON {"ads":[{"id":"…","text":"…"}]}.
المخرج: JSON فقط بهذا الشكل، بنفس ترتيب الإعلانات وبنفس id:
{"ads":[{"id":"…","facts":[{"fact":"pool","value":true,"quote":"مسبح خارجي مكشوف"},{"fact":"street_width_m","value":15,"quote":"شارع بعرض خمسة عشر متر"},{"fact":"other","label":"شبكة ري","value":true,"quote":"شبكة ري أوتوماتيكية"}]}]}
إعلان بلا حقائق: "facts": [].`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Constant-time string compare: a service-role check must not leak by timing.
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Is the caller's key a SERVICE-ROLE credential? Asked of the database itself, not by comparing bytes:
// the Actions secret and this runtime's SUPABASE_SERVICE_ROLE_KEY can be two different valid service
// keys (legacy JWT vs. the newer secret format), and the pilot's first call read 401 for exactly that
// reason (2026-10-25). listing_facts_runs has RLS on, no policies, and anon/authenticated revoked, so
// only a service-role key reads it (200); a publishable/anon key is refused by Postgres (401/403).
// Three answers, never two: "yes" (200), "no" (the database refused: 401/403) and "unknown" (unreachable,
// timeout, 5xx) — the first full run died at ad 3,776 when one PostgREST hiccup was read as "no" and
// returned 401 (2026-10-25). "unknown" still never reaches the model (fail closed); it is reported as 503
// so the caller retries instead of stopping. A "yes" is remembered for 10 minutes per key, in this
// isolate's memory only, so one flaky read cannot refuse a caller the database just approved.
const AUTH_OK_UNTIL = new Map<string, number>();
const AUTH_CACHE_MS = 10 * 60_000;
async function callerIsServiceRole(key: string): Promise<"yes" | "no" | "unknown"> {
  if (!key || !SUPABASE_URL) return "no";
  if ((AUTH_OK_UNTIL.get(key) ?? 0) > Date.now()) return "yes";
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), GATE_TIMEOUT_MS);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/listing_facts_runs?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: ac.signal,
    }).finally(() => clearTimeout(timer));
    await r.body?.cancel().catch(() => {});
    if (r.ok) {
      AUTH_OK_UNTIL.set(key, Date.now() + AUTH_CACHE_MS);
      return "yes";
    }
    return r.status === 401 || r.status === 403 ? "no" : "unknown";
  } catch {
    return "unknown";
  }
}

// FAIL CLOSED: any failure to reach or read the gate is a denial (an unreachable ceiling is unbounded).
async function spendGate(): Promise<{ allow: boolean; reason?: string }> {
  if (!SUPABASE_URL || !SERVICE_KEY) return { allow: false, reason: "spend gate unreachable: no service credentials" };
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), GATE_TIMEOUT_MS);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ai_spend_gate`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ p_source: "facts_extract" }),
      signal: ac.signal,
    }).finally(() => clearTimeout(timer));
    if (!r.ok) return { allow: false, reason: `spend gate http ${r.status}` };
    const g = await r.json();
    if (!g || typeof g.allow !== "boolean") return { allow: false, reason: "spend gate returned no verdict" };
    if (!g.allow) return { allow: false, reason: g.reason };
    // THE MONTHLY FACTS BUDGET (owner 2026-10-26: 30 USD/month for the AI facts reader). public.facts_ai_budget reads
    // this calendar month's listing_facts_runs; the script asks it too, but the paid call is HERE, so the gate is here.
    const ac2 = new AbortController();
    const timer2 = setTimeout(() => ac2.abort(), GATE_TIMEOUT_MS);
    const r2 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/facts_ai_budget`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ p_estimate_usd: 0.01 }),
      signal: ac2.signal,
    }).finally(() => clearTimeout(timer2));
    if (!r2.ok) return { allow: false, reason: `facts budget gate http ${r2.status}` };
    const b = await r2.json();
    if (!b || typeof b.allow !== "boolean") return { allow: false, reason: "facts budget gate returned no verdict" };
    if (!b.allow) return { allow: false, reason: `monthly AI facts budget reached: $${b.spent_month} of $${b.cap}` };
    return { allow: true };
  } catch (e) {
    return { allow: false, reason: `spend gate error: ${String((e as Error)?.message ?? e)}` };
  }
}

type Ad = { id: string; text: string };

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = req.headers.get("authorization") ?? "";
  const callerKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!sameSecret(callerKey, SERVICE_KEY)) {
    const verdict = await callerIsServiceRole(callerKey);
    if (verdict === "no") return json({ error: "unauthorized" }, 401);
    if (verdict === "unknown") return json({ error: "auth check unavailable, retry" }, 503);
  }
  let ads: Ad[];
  let runId = "";
  let provider: Provider = DEFAULT_PROVIDER;
  try {
    const body = await req.json();
    runId = String(body?.run_id ?? "");
    ads = Array.isArray(body?.ads) ? body.ads : [];
    if (body?.provider === "openrouter" || body?.provider === "deepseek") provider = body.provider;
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const apiKey = provider === "openrouter" ? OPENROUTER_API_KEY : DEEPSEEK_API_KEY;
  if (!apiKey) return json({ error: `model key not configured (${provider})` }, 503);
  const model = provider === "openrouter" ? OPENROUTER_MODEL : MODEL;
  if (!runId || ads.length === 0 || ads.length > MAX_ADS) return json({ error: `need run_id and 1..${MAX_ADS} ads` }, 400);
  let total = 0;
  for (const a of ads) {
    if (typeof a?.id !== "string" || typeof a?.text !== "string" || !a.id || !a.text) return json({ error: "each ad needs id and text" }, 400);
    if (a.text.length > MAX_CHARS_PER_AD) return json({ error: `ad ${a.id} longer than ${MAX_CHARS_PER_AD} chars` }, 400);
    total += a.text.length;
  }
  if (total > MAX_TOTAL_CHARS) return json({ error: `batch longer than ${MAX_TOTAL_CHARS} chars` }, 400);

  const gate = await spendGate();
  if (!gate.allow) return json({ error: "spend gate denied", reason: gate.reason ?? null }, 503);

  // ~220 output tokens per ad is generous for a long fact list; the ceiling must never be tight,
  // because a truncated JSON body costs the whole batch (the caller counts finish_reason=length).
  const maxTokens = Math.min(200 + ads.length * 220, 6000);
  const payload = JSON.stringify({
    model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify({ ads: ads.map((a) => ({ id: a.id, text: a.text })) }) },
    ],
    temperature: 0,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    // OpenRouter only: bill-exact cost in the reply (usage.cost) and the DeepSeek provider pinned, no fallbacks
    ...(provider === "openrouter"
      ? { usage: { include: true }, provider: { order: OPENROUTER_PROVIDERS, allow_fallbacks: false } }
      : {}),
  });

  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), MODEL_TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch(provider === "openrouter" ? OPENROUTER_URL : DEEPSEEK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...(provider === "openrouter" ? { "HTTP-Referer": "https://ezhalah-app.vercel.app", "X-Title": "Ezhalah facts reader" } : {}),
      },
      body: payload,
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    return json({ error: "model unreachable", detail: String((e as Error)?.message ?? e), latency_ms: Date.now() - t0 }, 502);
  }
  clearTimeout(timer);
  const latency = Date.now() - t0;
  if (!r.ok) {
    const detail = (await r.text().catch(() => "")).slice(0, 300);
    return json({ error: `${provider} ${r.status}`, http_status: r.status, detail, latency_ms: latency }, 502);
  }
  const data = await r.json();
  const choice = data?.choices?.[0];
  const cost = Number(data?.usage?.cost);
  return json({
    run_id: runId,
    http_status: 200,
    provider,
    requested_model: model,
    model: data?.model ?? null,
    cost_usd: Number.isFinite(cost) && cost >= 0 ? cost : null,   // OpenRouter's own bill for this call; null = compute from tokens
    finish_reason: choice?.finish_reason ?? null,
    usage: {
      prompt_tokens: data?.usage?.prompt_tokens ?? null,
      completion_tokens: data?.usage?.completion_tokens ?? null,
      cache_hit_tokens: data?.usage?.prompt_cache_hit_tokens ?? data?.usage?.prompt_tokens_details?.cached_tokens ?? null,
      cache_miss_tokens: data?.usage?.prompt_cache_miss_tokens ?? null,
      reasoning_tokens: data?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
    },
    content: String(choice?.message?.content ?? ""),
    latency_ms: latency,
  });
});

// A module, not a global script: scripts/verify-edge-functions-parse.ts type-checks every function in
// one program, and two import-free files sharing a const name would otherwise "redeclare" each other.
export {};
