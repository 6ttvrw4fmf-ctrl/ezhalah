#!/usr/bin/env bash
# Smoke-test the EXACT request the agent edge function sends to OpenAI, before setting
# AGENT_PROVIDER=openai in production.
#
# WHY: the OpenAI path targets the Responses API (/v1/responses, `input`, `text.format`) — a
# different shape from chat/completions — and was written against the docs without an API key
# available to execute it. This proves in one call, for a fraction of a cent:
#   1. the endpoint + body shape are accepted (a wrong shape is a 400, which is the whole point)
#   2. strict structured output returns the exact 12-field schema
#   3. the JSON is where the code looks for it: the `message` item of output[], not output[0]
#   4. whether OPENAI_REASONING_EFFORT is a real parameter for your model (it is NOT sent unless set)
#
#   OPENAI_API_KEY=sk-... bash scripts/smoke-agent-openai.sh
#   OPENAI_API_KEY=sk-... OPENAI_MODEL=gpt-5.6-terra bash scripts/smoke-agent-openai.sh
#   OPENAI_API_KEY=sk-... OPENAI_REASONING_EFFORT=low bash scripts/smoke-agent-openai.sh
set -euo pipefail

: "${OPENAI_API_KEY:?set OPENAI_API_KEY first}"
MODEL="${OPENAI_MODEL:-gpt-5.6-luna}"
EFFORT="${OPENAI_REASONING_EFFORT:-}"

# Real Saudi-dialect input with an IMPLICIT city (النرجس is a Riyadh district), an implicit rent
# period ("بالشهر"), Arabic-Indic numerals, and a budget — exactly the messy input the Ezhalah AI
# Agent Philosophy says must work without prompt scaffolding.
QUERY='أبي شقة غرفتين في حي النرجس بالرياض بحدود ٤ آلاف بالشهر'

SCHEMA='{
  "type": "object",
  "properties": {
    "kind": {"type": "string", "enum": ["listings","message","interview"]},
    "reply": {"type": "string"},
    "deal": {"type": "string", "enum": ["Rent","Buy","Both"]},
    "location": {"type": "string"},
    "type": {"type": "string"},
    "detail": {"type": "string"},
    "price": {"type": "string"},
    "pricing_basis": {"type": "string", "enum": ["daily_rent","weekly_rent","monthly_rent","quarterly_rent","annual_rent","full_price","price_per_sqm","none"]},
    "rent_period": {"type": "string", "enum": ["none","monthly","annual"]},
    "sort": {"type": "string", "enum": ["none","newest","oldest","price_asc","price_desc","area_asc","area_desc","ppm_asc","ppm_desc","beds_desc"]},
    "count": {"type": "string"},
    "platforms": {"type": "array", "items": {"type": "string"}}
  },
  "required": ["kind","reply","deal","location","type","detail","price","pricing_basis","rent_period","sort","count","platforms"],
  "additionalProperties": false
}'

SYS='You are Ezhalah, a Saudi property SEARCH assistant. Your only job: understand the user intent and map it onto the search filters. Never recommend a property and never give financial or legal advice. Reply in the user language.'

BODY="$(SCHEMA="$SCHEMA" SYS="$SYS" QUERY="$QUERY" MODEL="$MODEL" EFFORT="$EFFORT" python3 - <<'PY'
import json, os
body = {
    "model": os.environ["MODEL"],
    "input": [
        {"role": "system", "content": os.environ["SYS"]},
        {"role": "system", "content": "REPLY LANGUAGE FOR THIS TURN: Arabic ONLY."},
        {"role": "user", "content": os.environ["QUERY"]},
    ],
    "text": {"format": {
        "type": "json_schema", "name": "ezhalah_agent_output",
        "strict": True, "schema": json.loads(os.environ["SCHEMA"]),
    }},
}
if os.environ.get("EFFORT"):
    body["reasoning"] = {"effort": os.environ["EFFORT"]}
print(json.dumps(body))
PY
)"

echo "→ ${MODEL}${EFFORT:+  (reasoning.effort=${EFFORT})}"
echo "→ query: ${QUERY}"
echo

RESP="$(curl -sS https://api.openai.com/v1/responses \
  -H "authorization: Bearer ${OPENAI_API_KEY}" \
  -H "content-type: application/json" \
  -d "${BODY}")"

python3 - <<'PY' <<<"$RESP"
import json, sys
d = json.load(sys.stdin)

if isinstance(d, dict) and d.get("error"):
    e = d["error"]
    print("✗ API ERROR — the request shape or model ID is wrong. Do NOT deploy yet.")
    print("   type:", e.get("type"), "| param:", e.get("param"))
    print("   message:", e.get("message"))
    if e.get("param") == "reasoning":
        print("\n   → 'reasoning' is not valid for this model. Leave OPENAI_REASONING_EFFORT unset.")
    if "model" in str(e.get("message", "")).lower():
        print("\n   → check the model ID. Current IDs: gpt-5.6-luna | gpt-5.6-terra | gpt-5.6-sol")
    sys.exit(1)

# The code reads the `message` item out of output[], not output[0] — reasoning items can lead.
out = d.get("output", [])
msg = next((o for o in out if o.get("type") == "message"), out[0] if out else None)
if msg is None:
    print("✗ no output items:", json.dumps(d)[:400]); sys.exit(1)
text = "".join(c.get("text", "") for c in msg.get("content", [])).strip()
if not text:
    print("✗ empty text. output item types:", [o.get("type") for o in out]); sys.exit(1)
try:
    obj = json.loads(text)
except Exception as ex:
    print("✗ output is not parseable JSON:", ex); print(text[:600]); sys.exit(1)

required = ["kind","reply","deal","location","type","detail","price","pricing_basis","rent_period","sort","count","platforms"]
missing = [k for k in required if k not in obj]
if missing:
    print("✗ strict schema did not hold — missing:", missing); sys.exit(1)

print("✓ OK — Responses API shape valid, strict schema honoured")
print("  output item types:", [o.get("type") for o in out], "(reasoning first is normal)")
print("\n  extracted filter:")
for k in ("kind","deal","location","type","price","pricing_basis","rent_period"):
    print(f"    {k:<14} {obj[k]!r}")
print(f"    reply          {obj['reply'][:80]!r}")

u = d.get("usage", {}) or {}
print("\n  usage:", {k: v for k, v in u.items() if "token" in str(k)})
cached = (u.get("input_tokens_details") or {}).get("cached_tokens", 0)
print("  cached_tokens:", cached, "— 0 on the FIRST run is expected; run twice to see auto-caching engage")

# Judgment check: did it read the implicit signals, or does it need scaffolding?
print("\n  sanity — did it understand without being told?")
print("   ", "✓" if "رياض" in obj["location"] or "Riyadh" in obj["location"] else "✗", "city inferred from the district (النرجس → الرياض)")
print("   ", "✓" if obj["deal"] == "Rent" else "✗", f'deal = Rent (got {obj["deal"]!r})')
print("   ", "✓" if obj["rent_period"] == "monthly" else "✗", f'rent_period = monthly (got {obj["rent_period"]!r})')
PY
