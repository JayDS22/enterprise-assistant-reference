# enterprise-assistant-reference

Agents SDK + Responses API + Next.js reference. Six moving parts: Agents SDK, Responses API, Next.js on Fly, Postgres+RLS+pgvector, OTel, evals. See `_handoff/project-1-FINAL-plan.md` for the operating plan.

## Quickstart

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

## Known trade-offs

- **Live demo first request takes ~15s cold.** Neon free-tier auto-suspends after 5 min idle. Steady-state p95 is targeted at 820ms; see `scripts/k6_latency.js` for the measurement.
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
