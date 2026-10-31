# Credentials & Environment — PlayLiquid

All credentials from the handoff are exported and available for the rest of
the project. **Values live in two places only** (never in docs or code):

1. `/home/z/my-project/.env` — the single source of truth. Next.js auto-loads
   it; scripts source it with `set -a; . /home/z/my-project/.env; set +a`.
2. `~/.bashrc` + `~/.profile` — shell exports for interactive/login sessions
   (`~/.profile` sources the project `.env`, so values are never duplicated).

`scripts/verify-credentials.sh` re-checks every key at any time
(self-sourcing, redacted output, primary→fallback logic).

## Fallback policy (as instructed)

On failure or rate-limit, use the next key in order — never rotate manually,
always prefer the earliest working key:

| Service | Order |
| --- | --- |
| Neon | `NEON_API_KEY_1` → 2 → 3 → 4 |
| GitHub | `GITHUB_PAT` → `GITHUB_PAT_FALLBACK` (also aliased to `GITHUB_TOKEN`/`GH_TOKEN`, which the `gh` CLI auto-reads) |
| Vercel | `VERCEL_TOKEN_1` → `VERCEL_TOKEN_2` |
| Upstash | `UPSTASH_REDIS_REST_TOKEN_1` → `_TOKEN_2` (URL: `UPSTASH_REDIS_REST_URL`) |
| Composio | `COMPOSIO_API_KEY` (ak_, SDK/CLI) · `COMPOSIO_MCP_API_KEY` (ck_, MCP/agents) |
| Single-key services | `OPENROUTER_API_KEY`, `E2B_API_KEY`, `APIFY_API_KEY` |

## Verification status (2026-10-31, from this sandbox)

| Key | Result |
| --- | --- |
| `GITHUB_PAT` | ✅ HTTP 200 (`/user`) |
| `GITHUB_PAT_FALLBACK` | ✅ HTTP 200 (proactively tested; both PATs live) |
| `OPENROUTER_API_KEY` | ✅ authenticated — key info returned (`/api/v1/auth/key`) |
| `VERCEL_TOKEN_1` | ✅ HTTP 200 (`/v2/user`) |
| `VERCEL_TOKEN_2` | ⚠️ HTTP 403 — fallback token rejected; primary works, so no impact |
| `APIFY_API_KEY` | ✅ valid — user record returned (`/v2/users/me`) |
| `NEON_API_KEY_1..4` | ⏳ `api.neon.tech` does not resolve from this sandbox (DNS-blocked). Keys exported in fallback order; verify when called from an environment with Neon reachability. |
| `UPSTASH_REDIS_REST_TOKEN_1/2` | ⏳ `meet-ewe-145933.upstash.io` does not resolve from this sandbox. Both tokens exported; verify where reachable. |
| `COMPOSIO_API_KEY` (ak_) | ⏳ v1 API retired upstream ("upgrade to v3 APIs"); the v3 host `api.composio.dev` is DNS-blocked here. `backend.composio.dev` is reachable and confirms the migration. Validate via SDK at first use. |
| `COMPOSIO_MCP_API_KEY` (ck_) | ⏳ `mcp.composio.dev` reachable (Cloudflare); raw HTTP probes are inconclusive by design — MCP requires a proper client handshake. Validate when connecting apps (GitHub, Vercel, …). |
| `E2B_API_KEY` | ⏳ `e2b.dev` reachable, but the dashboard REST paths are not published guesses-friendly; the SDK authenticates at first sandbox spawn. |

## Usage notes for future sessions

- Never ask the user for these keys again — they are in the project `.env`.
- Demo app data stays on SQLite (`DATABASE_URL` in `.env`); the Neon keys are
  for serverless-Postgres use cases when the project moves past the sandbox.
- AI features in this sandbox use `z-ai-web-dev-sdk` (backend only);
  `OPENROUTER_API_KEY` is exported for environments where the gateway model
  routing is preferred.
