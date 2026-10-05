# Incidents

Two short postmortems from bugs hit during the build. Format per FINAL plan §9: TL;DR, Timeline, Root cause, Fix, What changed. 400-600 words total.

Candidates (whichever two actually land):

- RLS `SET LOCAL` leak before the `withTenant` wrapper was factored.
- Neon auto-suspend latency surprise and how the k6 numbers were measured (first-request vs steady-state p95).
- Idempotency key collision when `create_ticket` was retried under a Fly deploy restart.

---

## 1. _(TBD during build)_

**TL;DR.** _One sentence._

**Timeline.** _What happened, when._

**Root cause.** _What was wrong._

**Fix.** _What changed in code / config._

**What changed.** _Policy / test / docs added to prevent recurrence._

---

## 2. _(TBD during build)_

_(Same format.)_
