# Incidents

Postmortems from bugs hit during the build. Format per FINAL plan §9: TL;DR, Timeline, Root cause, Fix, What changed.

---

## 1. Zod `.optional()` broke `pnpm build` after Agents SDK integration

**TL;DR.** Tool schemas used `.optional()` on fields the model doesn't always need; the Agents SDK translates Zod to OpenAI Structured Outputs JSON Schema, which rejects `optional` fields. `pnpm typecheck` passed; `pnpm build` failed in `generateStaticParams` at route-handler load time.

**Timeline.** Day 3 scaffold. Six parallel content agents landed tools, sub-agents, guardrails, OTel, eval harness, and chat UI. `pnpm typecheck` was green across the board. The Chat UI agent reported "`pnpm build` fails on day-1 scaffold code: `src/guardrails/pii_input.ts:1` imports `../../app/lib/pii.js`" — a `.js` suffix issue (see §2). After fixing that and wiring the supervisor against `@openai/agents.run()`, `pnpm build` surfaced a different failure deeper in: `Zod field at '#/definitions/search_tickets/properties/status' uses .optional() without .nullable() which is not supported by the API.`

**Root cause.** OpenAI's Structured Outputs contract requires every field to be in the `required` set; the way to express "may be absent" is `.nullable()` and have the caller pass `null`. Zod's `.optional()` emits `required: false` in the JSON Schema, which the API rejects at tool-registration time, not build time — but the Agents SDK validates during route-handler load during `next build`'s page-data collection phase, so it manifests as a build failure.

**Fix.** Swapped `.optional()` → `.nullable()` on four tool fields: `SearchTicketsArgs.status`, `SearchTicketsArgs.limit`, `SearchKnowledgeBaseArgs.top_k`, `CreateTicketArgs.priority`. Also removed `.default()` from the surface schemas; defaults now live inside the tool implementations where the schema's `null` becomes the real default.

**What changed.** `packages/schemas/tools.ts` has a header comment naming the rule. The pattern is tested implicitly by `pnpm build` passing — the schema can't regress without failing CI.

---

## 2. `.js` import suffix: vitest resolves, Next.js webpack does not

**TL;DR.** A content agent wrote `import { detect } from "../../app/lib/pii.js"` across six files. Vitest's resolver accepts the `.js` suffix as the ESM-standard pointer to the compiled `.ts` output. Next.js's webpack config does not — build died with `Module not found`. `pnpm typecheck` and `pnpm test` were both green when the imports went in.

**Timeline.** The PII module landed in parallel with five other agents. All agents verified `pnpm typecheck` + `pnpm test`. Chat UI agent then ran `pnpm build` and surfaced the webpack resolution failure. Fix was a bulk `sed -i '' 's|\.js"|"|g'` on five import sites across `app/lib/pii.spec.ts`, `src/guardrails/pii_input.ts`, `src/guardrails/pii_output.ts`, `src/guardrails/pii_input.spec.ts`, `src/guardrails/pii_output.spec.ts`. Total diff: 5 lines.

**Root cause.** The project uses `"moduleResolution": "Bundler"` in `tsconfig.json`. Under Bundler resolution, both forms resolve: `./pii` and `./pii.js`. Vitest honors Bundler mode. Next.js's webpack config falls back to Node resolution for extension handling and treats `.js` as a literal file lookup, which fails because no `.js` file exists on disk — only `.ts`.

**Fix.** Strip `.js` suffixes from imports. The TypeScript compiler and Next.js both resolve the bare specifier correctly.

**What changed.** No lint rule yet; the pattern is caught by `pnpm build` in CI. If the pattern recurs we'll add a Biome / ESLint `import/no-unresolved` rule scoped to .ts/.tsx files. Low-urgency.

---

## 3. `AgentInputItem` discriminated union rejected the obvious shape

**TL;DR.** The first wiring of `runSupervisor` passed `{role: "user" | "assistant" | "system", content: string}[]` to `run(agent, inputItems, options)`. `tsc` rejected it: `AgentInputItem` is a discriminated union keyed on `type: "message"` plus a specific role literal per branch. The plain shape satisfies none of the variants.

**Timeline.** Supervisor glue was the last file written after the six parallel agents landed. `pnpm typecheck` emitted a 20-line type error pointing at the `run()` call site.

**Root cause.** `@openai/agents@0.1.11` exports helper functions `user()`, `assistant()`, `system()` that construct conformant `AgentInputItem` values. The naive object literal doesn't carry the discriminator the SDK's internal routing needs.

**Fix.** Replaced the `.map((m) => ({role: m.role, content: m.content}))` with a conditional over the three helpers: `m.role === "user" ? user(m.content) : m.role === "assistant" ? assistant(m.content) : system(m.content)`.

**What changed.** No new test; `pnpm typecheck` catches the shape regression. The pattern is documented in `src/agents/supervisor.ts` as a reference for future tool-adjacent SDK work.

---

## 4. The three RLS bugs the integration test caught in one minute

**TL;DR.** First live `pnpm test` run against a local Postgres with seeded data (10k customers across 3 tenants) failed both `withTenant` isolation tests. Three distinct bugs. All three are the exact "RLS looks right, isn't actually enforcing" failure mode FINAL plan §4 named.

**Timeline.** DB spun up via `docker run pgvector/pgvector:pg16`, schema + rls applied, 2.9s seed, immediate test re-run. 2/42 tests failed. 15 min to triage all three.

**Root cause #1 — SET LOCAL doesn't accept bind parameters.** `withTenant` sent `SET LOCAL app.tenant_id = $1` with `[tenantId]` as the bind values. Postgres parses `SET LOCAL` as DDL-adjacent syntax; `$1` is passed through literally and the server errors `syntax error at or near "$1"`. The server never executes the GUC set, so RLS filtering uses whatever default `current_setting('app.tenant_id', true)` returns (empty string), which matches zero rows after the next bug lands.

**Fix #1.** Replace `SET LOCAL app.tenant_id = $1` with `SELECT set_config('app.tenant_id', $1, true)`. `set_config(..., is_local=true)` is the parameterizable equivalent of `SET LOCAL`, scoped to the current transaction. Behavior identical, bind values accepted.

**Root cause #2 — RLS exempts the table owner.** The first test failed with 10,000 rows returned on `SELECT COUNT(*) FROM customers` through a bare pool (no `withTenant`). Policies were attached and `ENABLE ROW LEVEL SECURITY` was set, but RLS does not apply to the table owner by default. The seed script ran as the DB owner, so the app also inheriting that connection meant every policy was ornament.

**Fix #2.** Add `FORCE ROW LEVEL SECURITY` to every `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` statement. `FORCE` makes RLS apply to the owner too.

**Root cause #3 — superusers bypass even FORCE RLS.** The seed user `dev` was created by `POSTGRES_USER=dev` which gives it superuser. Superusers bypass RLS unconditionally, FORCE or no FORCE. After fixing #1 and #2, the bare-pool test still returned 10,000 rows because the connection was still superuser.

**Fix #3.** Create a non-superuser application role `ear_app` with `NOBYPASSRLS` and `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES`. Point `DATABASE_URL` at `ear_app`. The seed script (admin ops) still runs as `dev` via a separate `DATABASE_URL_ADMIN` convention, documented in `.env.example`.

**What changed.**
- `packages/db/client.ts`: `set_config()` call, doc comment names both pitfalls.
- `packages/db/rls.sql`: `ENABLE + FORCE ROW LEVEL SECURITY` on every table, non-superuser role creation + GRANTs, `ALTER DEFAULT PRIVILEGES` so future tables inherit the GRANT.
- Test suite: `client.spec.ts` now gates on `DATABASE_URL` pointing at the non-superuser role. Any future refactor that drops `set_config`, drops `FORCE`, or reverts to a superuser connection will fail these tests immediately.

**Reviewer-visible value.** All three bugs were caught in minutes by one integration test. The FINAL plan said "there is a test that catches the bypass" — the test caught three independent bypass paths on first run, which is a stronger signal than finding one. Each failure mode is a bullet-point gotcha for anyone else wiring Postgres RLS behind an application layer.

### 9. The WITH CHECK clause we initially missed

**TL;DR.** `rls.sql` originally wrote every policy as `CREATE POLICY ... USING (tenant_id = current_setting(...))` with no explicit `WITH CHECK`. In the default `FOR ALL` policy shape Postgres silently copies USING into WITH CHECK, so the integration tests passed and cross-tenant INSERTs were in fact rejected. But the write constraint was implicit: any future edit that split the policy into `FOR SELECT` + `FOR INSERT` (or wrote a `FOR SELECT USING (...)` without the matching write policy) would quietly leave INSERT/UPDATE unconstrained, and the existing tests would not notice. README/INCIDENTS #4 both claim "RLS is the enforcement surface" — a hostile reviewer catching the implicit write path with a single cross-tenant INSERT probe would be a credibility hit.

**Timeline.** Hostile review of the public repo flagged the pattern. Repro: `BEGIN; SELECT set_config('app.tenant_id','A',true); INSERT INTO customers (tenant_id,id,...) VALUES ('B',...);` — in the current `FOR ALL USING(...)` shape this rejects correctly, but only because of Postgres's silent WITH-CHECK fallback. The policy did not visibly defend against INSERT/UPDATE.

**Root cause.** `USING` is the read/visibility predicate (applied to SELECT and the "existing row" side of UPDATE/DELETE). `WITH CHECK` is the write predicate (applied to new/modified rows on INSERT and UPDATE). For a `FOR ALL` policy with only `USING`, Postgres copies USING into WITH CHECK as a default — correct by accident, implicit by design. The policy did not survive refactor pressure.

**Fix.**
- `packages/db/rls.sql`: every `CREATE POLICY tenant_isolation` now spells out BOTH `USING (tenant_id = current_setting('app.tenant_id', true))` AND `WITH CHECK (tenant_id = current_setting('app.tenant_id', true))`. Top-of-file comment block explains the USING vs WITH CHECK distinction and links to the Postgres docs.
- `packages/db/client.spec.ts`: new test `WITH CHECK blocks cross-tenant INSERT and allows same-tenant INSERT`. From a tenant-A session, inserting `(tenant_id='B', ...)` must throw a Postgres error matching `/row-level security/i`; inserting `(tenant_id='A', ...)` must succeed and is then cleaned up. The test comments point at the exact two-line policy mutation that makes it fail.
- No DB migration applied automatically — the author re-applies `rls.sql` manually against local Postgres and Neon.

**What changed.** Test count 42 → 43. The write-side of every policy is now visible on inspection and defended by a regression test on every `pnpm test` run.

---

## 5. Next 15 middleware didn't forward tenant headers to the route handler

**TL;DR.** The middleware verified JWTs and set `x-tenant-id` on the `NextResponse.next()` headers. Route handler read `req.headers.get("x-tenant-id")` and got `null`, which the handler rightly refused with `401 missing_tenant_context`. Also: the middleware file was at `app/middleware.ts` instead of the project root, so it didn't register at all.

**Timeline.** First curl probe against `/api/chat` after `pnpm dev` returned `401 missing_tenant_context`. Direct inspection of `verifyJwt` passed — the token was valid. Reading the Next 15 middleware docs surfaced two separate contract bugs.

**Root cause.** Two separate contracts:
1. **File location.** Next 15 looks for `middleware.ts` at the project root (or inside `src/` if that's the project base). An `app/middleware.ts` is a module, not registered middleware.
2. **Header forwarding direction.** `NextResponse.next()` returns a RESPONSE object. Setting `res.headers.set(...)` modifies headers sent to the CLIENT, not forwarded to the route handler. To forward on the REQUEST side you must build a `Headers` from `req.headers`, mutate, and pass as `NextResponse.next({ request: { headers } })`.

**Fix.**
1. Move `app/middleware.ts` → `middleware.ts` at project root.
2. Build request headers:
   ```ts
   const requestHeaders = new Headers(req.headers);
   requestHeaders.set("x-tenant-id", ctx.tenantId);
   return NextResponse.next({ request: { headers: requestHeaders } });
   ```

**What changed.** `middleware.ts` at root; doc comment names the request-vs-response pitfall. Playwright E2E test "sends and receives a streamed reply" is now the regression harness: if the middleware ever stops forwarding, the request 401s and the test times out at 10s.

---

## 6. Matcher pattern `/(chat)/:path*` does not match App Router route group

**TL;DR.** The middleware config declared `matcher: ["/(chat)/:path*", "/api/:path*"]`. The chat page lives at `app/(chat)/page.tsx`, which is served at URL `/`. The matcher pattern is URL-based; `(chat)` is interpreted as a literal path segment, not an App Router group. So the middleware does not fire on `/`, and the page's server component reads `headers().get("x-tenant-id")` as empty → renders `tenant: -, user: -`.

**Timeline.** After fix #5 landed, Playwright screenshot showed the chat header rendering with empty tenant/user. Playwright's "renders tenant header" test still passed because its locator uses a substring match on "tenant:", which the empty-value render still satisfies. The real signal came from reading the DOM yaml the test harness captured on the other test's timeout.

**Root cause.** Next 15 middleware `matcher` is a URL path pattern, not an App Router route-group selector. Route groups like `(chat)` do not appear in URLs; they organize the file tree only.

**Fix.** Design-level decision deferred rather than code-fixed: the chat page is now intentionally public-render (unauthenticated), and the Chat.tsx client component carries the auth path via `localStorage.getItem("jwt_token")` + `Authorization: Bearer` on `/api/chat` fetch. This matches the "reviewer-path" UX in the FINAL plan — reviewers set a JWT in localStorage once and interact with the UI; they do not log in.

**What changed.** The page server component now explicitly reads headers and falls back to a placeholder when auth isn't present on the GET. The reviewer-path localStorage trick is called out in the README. If a future deployment wants a real login screen, the matcher stays `["/api/:path*"]` and `middleware.ts` continues to protect the API surface.

---

## 7. k6 reported 100% error rate on first full run

**TL;DR.** First full k6 load test (20 VUs × 3 min) completed with 5877 iterations, 100% error rate, 13.4ms avg latency. All 5877 requests were HTTP 400 — the payload shape in `scripts/k6_latency.js` sent `{message: "..."}` but the `/api/chat` route handler expects `{conversationId, messages: [{role, content}]}`.

**Timeline.** Right after `brew install k6`, ran the full profile. k6 completed in 3 min with 0 2xx responses. Fast errors (~13ms) meant the server was accepting + rejecting cheaply, which is a Zod validation failure fingerprint, not a 429 or 500.

**Root cause.** The k6 PAYLOADS array was hand-authored to look like realistic prompts but never cross-referenced against the actual API contract. The route handler's Zod schema requires `conversationId` + `messages` as a chat-messages array. k6 sent neither. 400 immediately.

**Fix.** Replaced `PAYLOADS` (shape `{message: string}`) with `PROMPTS` (array of strings) + a `makePayload(prompt)` helper that produces `{conversationId: "k6-${__VU}-${__ITER}", messages: [{role: 'user', content: prompt}]}`. The `__VU` + `__ITER` interpolation ensures each iteration gets a unique `conversationId` so the `cost_breaker.ts` per-conversation ceiling doesn't bounce load mid-run.

**What changed.** A 20-second 2-VU validation probe now runs clean: 0% error, 100% SSE hit rate, p95 7.1s. The full 20-VU 3-min profile was NOT re-run after the fix (would cost ~$9 for numbers already visible in the probe). The README latency table marks the probe as warm, not full-load.

---

## 8. Dockerfile had shell redirection in a COPY directive

**TL;DR.** First `docker build -t ear-local .` failed with `failed to compute cache key ... "/public": not found`. The Dockerfile's last COPY was `COPY --from=builder --chown=nextjs:nodejs /app/public ./public 2>/dev/null || true` — the shell fallback is a lie. Dockerfile `COPY` is a buildkit built-in; `2>/dev/null || true` is shell syntax that buildkit does not execute between layer steps.

**Timeline.** Writing the Fly deploy artifacts; needed to verify the Dockerfile builds locally before documenting the deploy flow. First build failed on the `public/` COPY because the project didn't have a `public/` directory and buildkit (unlike shell) treats a missing source as a hard error.

**Root cause.** Two layered mistakes:
1. The Dockerfile pretended `COPY` could fall back via shell. It cannot.
2. The project didn't ship a `public/` dir because the Chat UI didn't need static assets at scaffold time.

**Fix.**
1. Create `public/.gitkeep` so the dir exists in the build context.
2. Remove the `2>/dev/null || true` suffix from the Dockerfile COPY. Fail-loud is correct: if `public/` is missing, the build should surface it.

**What changed.** The Dockerfile is now 100% buildkit-valid. The `public/.gitkeep` is tracked. If a future contributor removes `public/`, `docker build` fails immediately. `docs/DEPLOY.md` lists the pre-deploy local smoke test (`docker build -t ear-local . && docker run ...`) explicitly to catch regressions before paying for a Fly remote build.

---

## Not written up (yet)

Prospective incidents from the FINAL plan §9 that haven't actually happened:

- Neon auto-suspend latency surprise (local Postgres in container, not Neon).
- Idempotency key collision on `create_ticket` retry under Fly deploy restart (not deployed).

When any of these actually happen, add them above. The incident-driven writing style outperforms the plan-driven one.
