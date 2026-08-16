#!/usr/bin/env bash
# Smoke-test the EXACT request shape the agent edge function sends to Claude, before flipping
# AGENT_PROVIDER=claude in production.
#
# WHY THIS EXISTS: the agent function's Claude path was written against the documented API surface
# but could not be executed at authoring time (no key in that environment). This proves the three
# things that would 400 or silently misbehave if the shape were wrong:
#   1. `output_config` accepts BOTH `effort` and `format` in one request
#   2. adaptive `thinking` combines with strict structured output
#   3. the JSON comes back as a `text` block that JSON.parse handles, matching the real schema
#
#   ANTHROPIC_API_KEY=sk-ant-... bash scripts/smoke-agent-claude.sh
#
# Costs a fraction of a cent. Run it once; if it prints OK, the wiring is right.
set -euo pipefail

: "${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY first}"
MODEL="${CLAUDE_MODEL:-claude-sonnet-5}"
EFFORT="${CLAUDE_EFFORT:-low}"

# A real Saudi-dialect query with an implicit city, an implicit rent period, and a budget — the exact
# kind of input the philosophy doc says must work without prompt scaffolding.
QUERY='أبي شقة غرفتين في حي النرجس بالرياض بحدود ٤ آلاف بالشهر'

read -r -d '' BODY <<JSON || true
{
  "model": "${MODEL}",
  "max_tokens": 4000,
  "system": [
    {"type": "text", "text": "You are Ezhalah, a Saudi property SEARCH assistant. Your only job: understand the user's intent and map it onto the search filters. Never recommend a property, never give financial/legal advice. Reply in the user's language.", "cache_control": {"type": "ephemeral"}},
    {"type": "text", "text": "REPLY LANGUAGE FOR THIS TURN: Arabic ONLY."}
  ],
  "messages": [{"role": "user", "content": ${QUERY@Q}}],
  "thinking": {"type": "adaptive"},
  "output_config": {
    "effort": "${EFFORT}",
    "format": {
      "type": "json_schema",
      "schema": {
        "type": "object",
        "properties": {
          "kind": {"type": "string", "enum": ["listings", "message", "interview"]},
          "reply": {"type": "string"},
          "deal": {"type": "string", "enum": ["Rent", "Buy", "Both"]},
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
      }
    }
  }
}
JSON

echo "→ ${MODEL} (effort=${EFFORT})"
echo "→ query: ${QUERY}"
echo

RESP="$(curl -sS https://api.anthropic.com/v1/messages \
  -H "x-api-key: ${ANTHROPIC_API_KEY}" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d "${BODY}")"

# A 400 here means the request SHAPE is wrong — that is exactly what this test is for.
if echo "$RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("type")!="error" else 1)'; then :; else
  echo "✗ API ERROR — the request shape is wrong. Fix before deploying:"
  echo "$RESP" | python3 -m json.tool
  exit 1
fi

python3 - <<'PY' <<<"$RESP"
import json, sys
d = json.load(sys.stdin)
if d.get("stop_reason") == "refusal":
    print("✗ model declined the request"); sys.exit(1)
text = "".join(b.get("text","") for b in d.get("content",[]) if b.get("type") == "text").strip()
if not text:
    print("✗ empty output — content blocks:", [b.get("type") for b in d.get("content",[])]); sys.exit(1)
try:
    obj = json.loads(text)
except Exception as e:
    print("✗ output is not parseable JSON:", e); print(text[:600]); sys.exit(1)

required = ["kind","reply","deal","location","type","detail","price","pricing_basis","rent_period","sort","count","platforms"]
missing = [k for k in required if k not in obj]
if missing:
    print("✗ missing required fields:", missing); sys.exit(1)

u = d.get("usage", {})
print("✓ OK — request shape valid, schema honoured\n")
print("  parsed filter:")
for k in ("kind","deal","location","type","price","pricing_basis","rent_period"):
    print(f"    {k:<14} {obj[k]!r}")
print(f"    reply          {obj['reply'][:80]!r}")
print("\n  usage:", {k: v for k, v in u.items() if "token" in k})
print("  cache_read_input_tokens:", u.get("cache_read_input_tokens", 0),
      "(0 on the FIRST run is expected — run twice to see caching engage)")
PY
