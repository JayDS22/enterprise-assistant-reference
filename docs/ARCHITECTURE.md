# Architecture

Six moving parts: Agents SDK, Responses API, Next.js on Fly, Postgres+RLS+pgvector, OTel, evals. Full diagram and justification live in `_handoff/project-1-FINAL-plan.md` §1-§2.

## Request flow

```
Browser --JWT (jose)--> Next.js 15 (App Router, SSE route handler) --> Agents SDK
                                                                            |
                                                                            v
                                                        Supervisor -> {Billing, Tickets, KB}
                                                                            |
                                                                            v
                                                        Responses API + Structured Outputs
                                                                            |
                                                                            v
                                                        Postgres (Neon) -- RLS on every table
                                                        . app tables (customers, tickets, subs)
                                                        . docs table (markdown + pgvector)
                                                        . audit_log (full trail)
                                                                            |
                                                                            v
                                                        OTel SDK -> console + file exporter
```

## Enforcement surfaces

- **Auth:** `app/lib/jwt.ts` extracts `tenant_id` + `user_id` from a JWT.
- **Tenancy:** `packages/db/client.ts::withTenant` runs every tool DB access inside `BEGIN; SET LOCAL app.tenant_id = $1; ...; COMMIT`. RLS policies in `packages/db/rls.sql` filter every table. The `withTenant` wrapper is the single enforcement surface.
- **PII:** `app/lib/pii.ts` scans input (pre-tool) and output (pre-stream) with TS regex. Named ceiling: regex-only, upgrade to Presidio when the corpus demands it.
- **Rate limit:** `app/lib/rate_limit.ts` token bucket per tenant.
- **Cost ceiling:** `app/lib/cost_breaker.ts` per-conversation + per-tenant-day caps.
- **Audit:** every tool writes an `audit_log` row in the same transaction as its work.

## Scaling notes

Not yet written. Single-region Fly + 10k rows + 500 docs is the reference impl; the shape generalizes to multi-region + partitioned Postgres + read replicas, but those paths are not implemented here.
