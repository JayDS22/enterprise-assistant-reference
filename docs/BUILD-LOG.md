# Build log

What shipping this reference impl actually looked like. Not a changelog; a reviewer-facing timeline that pairs each commit with the real engineering decision behind it, plus the specific bugs that surfaced along the way (also in `INCIDENTS.md`).

Dates all 2026-10-05 → 2026-10-06, one build sprint.

## Phase 1 — scaffold (37f8c0d, e4621c2)

**Shipped.** Repo skeleton; Postgres schema + RLS policies as SQL files; `withTenant(tenantId, fn)` wrapper as the single enforcement surface for tenancy; 500 synthetic markdown docs across 3 tenants with near-duplicate `refund_policy.md` to feed the cross-tenant eval; 12 eval scenario YAMLs + 20-row gold sets for the 4 judged ones; k6 load script; OTel Grafana dashboard JSON; INCIDENTS.md skeleton.

**Decision kept.** `withTenant` + RLS over any form of tenant_id filter in application code. The test suite proves the invariant; the schema is agnostic to app bugs.

**Decision rejected.** `src/tools/` as classes. Each tool is one function with a Zod input, one `withTenant()` call, one audit row in the same transaction. Interface over abstraction.

## Phase 2 — architectural core via parallel agents (f0aca74)

**Shipped.** Six content agents in parallel wrote: the 5 remaining tools (`search_tickets`, `get_subscription_status`, `search_knowledge_base`, `create_ticket`, `escalate_to_human`), 3 sub-agents (`billing`, `tickets`, `kb`), rate limiter + cost breaker libs with 13 unit tests, PII module + input/output guardrails with 23 unit tests, OTel wiring with FileSpanExporter + 4 tests, the eval harness (runner + judge + scorecard), and the Chat UI components. Supervisor glue written myself to close the integration surface. 40 passing tests, 2 skipped on DATABASE_URL.

**Integration fixes landed during assembly** (first three postmortems in `INCIDENTS.md`):
1. Zod `.optional()` broke `pnpm build` because OpenAI Structured Outputs rejects non-required fields. Fix: `.nullable()` on 4 tool fields.
2. `.js` import suffix: resolved by Vitest, failed by Next's webpack. Fix: strip the suffix at 5 call sites.
3. `AgentInputItem` is a discriminated union; the naive `{role, content}` literal fails typecheck. Fix: use the SDK's `user()`/`assistant()`/`system()` helpers.

## Phase 3 — live-stack verification against real Postgres (7de6289)

**The three-bugs-in-one-test incident.** First live run of the test suite against a seeded local Postgres (10k customers across 3 tenants) failed both `withTenant` isolation tests. Three distinct bugs in a chain — the fourth postmortem in `INCIDENTS.md`:

1. `SET LOCAL app.tenant_id = $1` syntax-errored. Postgres does not accept bind parameters on `SET LOCAL`. Fix: `SELECT set_config('app.tenant_id', $1, true)`.
2. `ENABLE ROW LEVEL SECURITY` is not enough. RLS exempts the table owner by default. Fix: add `FORCE ROW LEVEL SECURITY` on every table.
3. Superusers bypass even FORCE RLS. The seed role was superuser. Fix: create `ear_app` as `NOINHERIT NOBYPASSRLS`, grant CRUD only, point `DATABASE_URL` at it.

**One integration test caught three independent bypass paths.** The FINAL plan said "there is a test that catches the bypass"; it caught more than one, on first run.

**Middleware bugs** (next two postmortems):
4. `middleware.ts` must live at project root, not `app/middleware.ts`.
5. `NextResponse.next()` with modified response headers doesn't forward to the route handler. Must build a `Headers` from `req.headers` and pass `request: { headers }` to `next()`.

## Phase 4 — Fly deploy end-to-end (8092a52, aa74cdf, 031422d)

**Shipped.** Multi-stage `Dockerfile` with Next 15 standalone output (294MB image, 39ms boot). `fly.toml` with HTTP healthcheck + concurrency limits. `docs/DEPLOY.md` with the complete operator checklist. `.github/workflows/deploy.yml` for push-to-main CI deploy.

**Operator sequence executed live** (not just documented):
- Neon branch created, schema + RLS applied, 10k customers seeded in 121.8s (vs 2.9s locally — Neon pooler latency).
- `ear_app` password rotated after Neon rejected the weak default (`CREATE ROLE ear_app PASSWORD 'ear_app'` failed with HTTP 400 "insecure password"). Follow-up: `rls.sql` now takes the password via `-v app_password='...'` psql variable.
- 10 Fly secrets staged. First deploy: 2 machines in `sjc`, HA, 2:52 build + deploy time.
- Live smoke test: GET `/` → 200/335ms. POST `/api/chat` with signed JWT → real streamed SSE from the Agents SDK, 5.8s end-to-end.

## Phase 5 — the k6 fiasco (de1da79, 036947b)

**Shipped.** k6 installed via brew. Full 20-VU 3-min load profile ran against the live stack. Returned **5877 iterations, 100% error rate, 13.4ms avg latency**. All HTTP 400.

**Root cause.** The k6 PAYLOADS array was `{message: "..."}` but the API expects `{conversationId, messages: [{role, content}]}`. The script was authored by an agent that never cross-referenced the API contract. Server was correctly rejecting every request.

**Fix.** `makePayload(prompt)` helper that produces the right shape with `conversationId: "k6-${__VU}-${__ITER}"` so the per-conversation cost ceiling doesn't bounce load. Validated on a 2-VU 20s probe: 0% error, 100% SSE hit rate, p95 7.1s. Did NOT re-run the full 20-VU 3-min profile — would cost ~$9 for numbers already visible in the probe. This is a budget-honest decision, not a shortcut.

## Phase 6 — UX from honest-plain to shippable (de1da79, e8a9713)

**First UX pass** (de1da79): one-click demo button via new `/api/demo-jwt` endpoint, example-prompt chips below the input, JWT decode for the header, markdown rendering, tool-call frames in SSE.

**Circular middleware guard caught.** `GET /api/demo-jwt` was 401 because middleware guarded `/api/*` including the demo endpoint — classic chicken-and-egg. Fix (036947b): `PUBLIC_API_PATHS` allowlist in middleware. Would have been obvious at review; wasn't obvious while writing.

**Full UI redesign** (e8a9713): Tailwind v4 with OKLCH color tokens. Dark theme. Agent-identity colors (supervisor blue, billing orange, tickets green, kb purple) applied to message bubble borders + avatar glyphs. Streaming caret in the agent color. Handoff rendered as pulsing arrow between supervisor and sub-agent name. Collapsible tool-call rows with chevron + wrench icon + 60-char args preview. Per-message latency + cost pills. Sidebar with prompt chips + agent legend + honest caveats block.

**One PostCSS gotcha.** `postcss.config.js` with ES module `export default` fails Next 15's webpack because the plugins key gets wrapped. Fix: `module.exports`. Not an incident, just a config quirk; captured here for the next person.

## What the whole arc says

- **Correctness surfaces catch bugs early when invariants are testable.** The three-bugs-in-one-test incident is the clearest signal. The alternative would have been shipping to Fly first, then discovering RLS was ornament during a reviewer click-through.
- **Agent-assisted builds surface integration bugs late.** Each agent produced locally-correct code; the breaks happened at the seams (Zod ↔ OpenAI Structured Outputs, Vitest ↔ webpack, naive object ↔ discriminated union). The fix is not "stop using agents"; it's "run the full `typecheck + test + build` chain early and often, treat its errors as the real tests."
- **Load tests are their own correctness surface.** The k6 100% error run looked identical to "the server is broken under load" but was in fact "the test sends the wrong shape." Diagnosing the right failure mode on the right side of the wire is the engineering move.
- **Rotations after rapid credential paste.** Over the course of two days, the Neon admin password, the ear_app password, the Fly token, the JWT secret, and the OpenAI key all touched the chat transcript. Three got rotated during the session; two (Neon admin + OpenAI) are called out as operator actions in the final punch list.

Full commit list in `git log`. Full postmortems in `INCIDENTS.md`. Full operator checklist in `docs/DEPLOY.md`.
