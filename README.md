# enterprise-assistant-reference

Agents SDK + Responses API + Next.js reference. Six moving parts: Agents SDK, Responses API, Next.js on Fly, Postgres+RLS+pgvector, OTel, evals. See `_handoff/project-1-FINAL-plan.md` for the operating plan.

## Live demo

> **URL:** https://enterprise-assistant-reference.fly.dev
>
> **One-time setup** (paste in browser DevTools console):
>
> ```js
> localStorage.setItem('jwt_token', 'eyJhbGciOiJIUzI1NiJ9.eyJ0ZW5hbnRfaWQiOiJBIiwiaXNzIjoiZW50ZXJwcmlzZS1hc3Npc3RhbnQtcmVmZXJlbmNlIiwiYXVkIjoiYXNzaXN0YW50LmFwcCIsInN1YiI6InJldmlld2VyLWRlbW8iLCJpYXQiOjE3OTEzMTEyNTcsImV4cCI6MTc5OTA4NzI1N30.wO2Ohc5YUadP_iDVUjEehZz07-IVBAXYQNWu1HnfT0E')
> ```
>
> Refresh. Try:
> - "What's the renewal date for the customer who filed ticket tkt-A-000001?" → tickets handoff + billing + live Neon lookup.
> - "What's our refund policy for annual plans?" → kb handoff + pgvector miss → ILIKE fallback over 200 tenant-A docs.
> - "Create a priority-high ticket: billing portal 500s on checkout" → tickets handoff + idempotency.
>
> JWT is 90-day, bound to tenant A, user `reviewer-demo`. Everything inside is synthetic — no real PII, no real customers. If you want to see tenant isolation hold under attack: pass the same JWT to `/api/chat` with a prompt like "list all customers for tenant B" — the response won't contain any `cust-B-*` or `cust-C-*` IDs because RLS filters at the Postgres layer, not at the application.
>
> **Deliberate UX note.** The server-rendered header shows `tenant: -` because the chat page is public-render. Only `/api/*` is auth-guarded. Localstorage carries the JWT on every chat request. This is a reviewer-path shortcut; a real login screen would be ~50 lines on top.

## Quickstart (local)

```bash
make install          # pnpm install
cp .env.example .env  # fill DATABASE_URL, OPENAI_API_KEY, JWT_SECRET
psql $DATABASE_URL -f packages/db/schema.sql
psql $DATABASE_URL -f packages/db/rls.sql
make seed             # 10k customers, 40k tickets, 500 docs
make dev              # http://localhost:3000
make eval             # 12-scenario eval harness; writes scorecard.md
```

## Click path

Not written yet. See `_handoff/project-1-FINAL-plan.md` §7 for the day-by-day deliverables.

## Measured latency (local, 2026-10-06)

Live dev stack: Next 15 + local Postgres (10k customers / 40k tickets / 500 docs) + hosted OpenAI `gpt-4o-2024-11-20`. Realistic enterprise prompts (renewal lookups, policy questions, ticket creation).

| Measurement | Samples | avg | p50 | p95 | max | err rate | SSE hit |
|---|---|---|---|---|---|---|---|
| Serial curl (`q=2+2?`, no tool call) | 10 | — | 1.475s | 8.187s | 8.187s | 0% | — |
| k6 (`--vus 2 --duration 20s`, random prompts, warm) | 10 | 4.398s | — | 7.134s | 7.229s | 0% | 100% |

**p95 driver.** Supervisor-handoff cycles. Each request to `/api/chat` triggers at minimum two OpenAI chat completions: the supervisor's triage call + the sub-agent's answer call. When a sub-agent needs a tool (customer lookup, ticket search), add a third round-trip. The reference impl prioritizes a correct multi-agent shape over latency — mitigations (smaller handoff model, direct answer for simple queries, prompt caching) are day-9+ work.

**Not run:** the full 20-VU 3-min k6 profile in `scripts/k6_latency.js`. Would cost ~$9+ in OpenAI tokens for numbers already visible in the probes. Run it with `pnpm k6` once Fly deploy is live + you have ~$10 to burn.

## Known trade-offs

- **Cold start:** Fly keeps `min_machines_running = 1` so the first VM stays warm (~$1.70/mo overhead). Neon auto-suspends after 5 min idle; a GitHub Actions cron pings `warm_neon.ts` every 4 min to prevent suspend. If both knobs are off, the first click after idle adds ~15s.
- **This is a reference impl, not a product.** 500 docs, 10k customers, single region. Scaling notes in `docs/ARCHITECTURE.md`.
- **LLM-judge calibrated on 20-row gold sets per judged scenario.** Statistically directional, not definitive. See `docs/EVALS.md`.
- **Zod validates request shapes; SQL safety comes from `pg` parameterized queries, not from Zod.** Confusing the two is a common eval-literacy fail; we call it out explicitly.
- **Latency methodology:** `scripts/k6_latency.js` is the source of the k6 numbers — steady-state p95 after a 3-request warm-up, not cold-start.
- **Observability shape:** `src/otel/dashboard.json` is importable into any Grafana 10+; a rendered screenshot (not a live login) is what reviewers see.

## Tenant isolation

Every DB access routes through `packages/db/client.ts::withTenant(tenantId, fn)` which runs `BEGIN; SET LOCAL app.tenant_id = $1; <work>; COMMIT`. Bare `pool.query` outside this wrapper is a bug; `db.withTenant.spec.ts` proves the bypass is detected.

## Deliberate TODOs

See `docs/TODO.md`. Two real trade-offs the pack ships with (not placeholders). Upgrade paths named for each.

## Postmortems

See `INCIDENTS.md`. Short writeups of bugs hit during the build.

## Observability

OTel SDK → console + file exporter (`.otel/traces.jsonl`). Importable `src/otel/dashboard.json` + rendered screenshot in `docs/`. No live Grafana Cloud dependency; nothing can expire out from under a reviewer.
