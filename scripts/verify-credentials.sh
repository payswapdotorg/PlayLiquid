#!/usr/bin/env bash
# PlayLiquid credential verification — primary -> fallback, redacted output.
# Self-sourcing: loads /home/z/my-project/.env so it works in any shell.
set -a; source /home/z/my-project/.env; set +a

red() { local k="$1"; echo "${k:0:10}…${k: -4}"; }
code() { curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$@"; }

echo "=== 0. Env loaded from project .env ==="
echo "  vars: $(grep -cE '^[A-Z]' /home/z/my-project/.env) entries in file; GITHUB_PAT length: ${#GITHUB_PAT}"

echo "=== 1. GitHub PAT (payswap) ==="
for v in GITHUB_PAT GITHUB_PAT_FALLBACK; do
  k="${!v}"; c=$(code -H "Authorization: Bearer $k" https://api.github.com/user)
  echo "  $v ($(red "$k")) -> HTTP $c $([ "$c" = 200 ] && echo 'VALID' || echo 'try next')"
  [ "$c" = 200 ] && { echo "  => ACTIVE GITHUB KEY: $v"; break; }
done

echo "=== 2. Composio platform key (ak_) ==="
for ep in "https://backend.composio.dev/api/v1/apps?limit=1" "https://backend.composio.dev/api/v2/apps?limit=1" "https://api.composio.dev/v3/apps?limit=1"; do
  c=$(code -H "X-API-Key: $COMPOSIO_API_KEY" "$ep")
  echo "  COMPOSIO_API_KEY ($(red "$COMPOSIO_API_KEY")) @ $ep -> HTTP $c"
  [ "$c" = 200 ] && { echo "  => VALID at $ep"; break; }
done

echo "=== 3. Composio MCP key (ck_) ==="
c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 -L -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1.0"}}}' \
  "https://mcp.composio.dev/mcp?composio_api_key=$COMPOSIO_MCP_API_KEY")
echo "  COMPOSIO_MCP_API_KEY ($(red "$COMPOSIO_MCP_API_KEY")) @ mcp.composio.dev (POST initialize, -L) -> HTTP $c $([ "$c" = 200 ] && echo 'VALID')"

echo "=== 4. OpenRouter ==="
body=$(curl -s --max-time 15 -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/auth/key)
if echo "$body" | grep -q '"is_provisioned"'; then
  label=$(echo "$body" | grep -o '"label":"[^"]*"' | head -1)
  usage=$(echo "$body" | grep -o '"usage":[0-9]*' | head -1)
  limit=$(echo "$body" | grep -o '"limit":[^,}]*' | head -1)
  echo "  OPENROUTER_API_KEY ($(red "$OPENROUTER_API_KEY")) -> VALID ($label; $usage; $limit)"
else
  echo "  OPENROUTER_API_KEY ($(red "$OPENROUTER_API_KEY")) -> RESPONSE: $(echo "$body" | head -c 200)"
fi

echo "=== 5. Vercel ==="
for v in VERCEL_TOKEN_1 VERCEL_TOKEN_2; do
  k="${!v}"; c=$(code -H "Authorization: Bearer $k" https://api.vercel.com/v2/user)
  echo "  $v ($(red "$k")) -> HTTP $c $([ "$c" = 200 ] && echo 'VALID' || echo 'try next')"
  [ "$c" = 200 ] && { echo "  => ACTIVE VERCEL TOKEN: $v"; break; }
done

echo "=== 6. Neon (order 1->2->3->4) ==="
root=$(code --max-time 15 https://api.neon.tech/)
echo "  reachability: https://api.neon.tech/ -> HTTP $root"
for i in 1 2 3 4; do
  v="NEON_API_KEY_$i"; k="${!v}"
  c=$(code -H "Authorization: Bearer $k" https://api.neon.tech/api/v2/users/me)
  [ "$c" = 404 ] && c=$(code -H "Authorization: Bearer $k" https://api.neon.tech/api/v2/projects)
  echo "  $v ($(red "$k")) -> HTTP $c $([ "$c" = 200 ] && echo 'VALID' || echo 'try next')"
  [ "$c" = 200 ] && { echo "  => ACTIVE NEON KEY: $v"; break; }
done

echo "=== 7. Upstash Redis (token 1 -> 2) ==="
for v in UPSTASH_REDIS_REST_TOKEN_1 UPSTASH_REDIS_REST_TOKEN_2; do
  k="${!v}"; r=$(curl -s --max-time 15 "$UPSTASH_REDIS_REST_URL/ping" -H "Authorization: Bearer $k")
  echo "  $v ($(red "$k")) -> '$r' $([ "$r" = "PONG" ] && echo 'VALID' || echo 'try next')"
  [ "$r" = "PONG" ] && { echo "  => ACTIVE UPSTASH TOKEN: $v"; break; }
done

echo "=== 8. E2B ==="
c=$(code -H "X-API-Key: $E2B_API_KEY" "https://e2b.dev/api/v1/sandboxes")
c2=$(code -H "X-API-Key: $E2B_API_KEY" "https://e2b.dev/api/v1/instances")
echo "  E2B_API_KEY ($(red "$E2B_API_KEY")) -> /sandboxes HTTP $c; /instances HTTP $c2 (SDK authenticates at first sandbox spawn)"

echo "=== 9. Apify ==="
body=$(curl -s --max-time 15 "https://api.apify.com/v2/users/me?token=$APIFY_API_KEY")
if echo "$body" | grep -q '"username"'; then
  u=$(echo "$body" | grep -o '"username":"[^"]*"' | head -1)
  echo "  APIFY_API_KEY ($(red "$APIFY_API_KEY")) -> VALID ($u)"
else
  echo "  APIFY_API_KEY ($(red "$APIFY_API_KEY")) -> RESPONSE: $(echo "$body" | head -c 200)"
fi
echo "=== DONE ==="
