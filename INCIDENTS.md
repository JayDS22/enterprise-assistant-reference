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

## Not written up (yet)

Prospective incidents from the FINAL plan §9 that haven't actually happened:

- RLS `SET LOCAL` leak before `withTenant` factored (schema is correct from day 2, no leak hit yet).
- Neon auto-suspend latency surprise (DB not provisioned, k6 numbers not measured).
- Idempotency key collision on `create_ticket` retry under Fly deploy restart (not deployed).

When any of these actually happen, add them above. The incident-driven writing style outperforms the plan-driven one.
