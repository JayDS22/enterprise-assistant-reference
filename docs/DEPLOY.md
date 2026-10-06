# Deploy

Complete operator checklist for shipping to Fly.io with a hosted Postgres (Neon). Read every section; the fast path requires about 25 minutes end to end if you don't hit account-setup speedbumps.

## What's in the repo (ready to deploy)

- `Dockerfile` — multi-stage build, `node:20-alpine`, standalone output (~250MB image).
- `.dockerignore` — keeps `node_modules`, `.next`, `test-results`, seed docs, and the `_handoff` dir out of the image.
- `next.config.ts` — `output: "standalone"` + externalized `@openai/agents` and `pg`.
- `infra/fly/fly.toml` — one Fly app, single region (`sjc`), 512MB VM, HTTPS forced, auto-stop/auto-start on, HTTP healthcheck at `/`.
- `.github/workflows/deploy.yml` — CI deploys on push to `main` after typecheck + test + build pass.
- `Makefile` → `make deploy` = `flyctl deploy --remote-only --config infra/fly/fly.toml`.

## What is NOT in the repo (you do these)

Each section lists the exact commands.

### 1. Install flyctl + authenticate (one-time, ~2 min)

```bash
brew install flyctl           # macOS
flyctl auth login             # opens browser
flyctl auth whoami            # should print your email + org
```

If you don't have a Fly account yet, `flyctl auth signup` first. A credit card is required for apps using the free resources; Fly's free allowance covers this reference impl.

### 2. Provision Neon (one-time, ~3 min)

Create a project at https://console.neon.tech → copy the connection string (looks like `postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`).

The Neon default role is a superuser. For runtime, create a non-superuser app role:

```bash
# From your local machine, with psql installed OR using the Neon web SQL editor:
psql "<neon-connection-string>" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
SQL

# Apply schema (uses the superuser).
export DATABASE_URL_ADMIN="postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"
psql "$DATABASE_URL_ADMIN" -f packages/db/schema.sql

# Apply RLS. rls.sql takes the app role password as a psql variable so the
# plaintext stays out of source control AND managed Postgres (Neon, RDS) can
# enforce their password policies without the migration failing on a weak
# default. See INCIDENTS.md #4 for the catch.
APP_PW="$(openssl rand -base64 32 | tr -d '/+=\n')Aa1!X"
psql "$DATABASE_URL_ADMIN" -v app_password="'$APP_PW'" -f packages/db/rls.sql
echo "$APP_PW" > .env.neon-prod.key && chmod 600 .env.neon-prod.key

# Seed (uses the superuser — RLS bypass is fine for admin ops).
DATABASE_URL="$DATABASE_URL_ADMIN" pnpm seed
```

The app's `DATABASE_URL` points at `ear_app`:

```
postgres://ear_app:<strong-random>@ep-xxx.neon.tech/neondb?sslmode=require
```

**Why not use the superuser as the app connection?** Superusers bypass RLS unconditionally, including `FORCE ROW LEVEL SECURITY`. The whole tenant-isolation invariant collapses. INCIDENTS.md #4 is the catch; the deploy checklist exists so you don't repeat it.

### 3. Create the Fly app (one-time, ~2 min)

```bash
flyctl apps create enterprise-assistant-reference --org personal
```

Change `--org` if you're deploying to a team org. The app name must be globally unique on Fly; rename in `infra/fly/fly.toml` if needed.

### 4. Set secrets (one-time; re-run on rotation)

```bash
flyctl secrets set \
  DATABASE_URL="postgres://ear_app:...@ep-xxx.neon.tech/neondb?sslmode=require" \
  OPENAI_API_KEY="sk-proj-..." \
  OPENAI_RESPONSES_MODEL="gpt-4o-2024-11-20" \
  OPENAI_JUDGE_MODEL="gpt-4o-2024-08-06" \
  JWT_SECRET="$(openssl rand -base64 32 | tr -d '\n')" \
  JWT_ISSUER="enterprise-assistant-reference" \
  JWT_AUDIENCE="assistant.app" \
  COST_PER_CONVERSATION_USD="0.50" \
  COST_PER_TENANT_DAY_USD="50.00" \
  RATE_LIMIT_RPM="60" \
  RATE_LIMIT_BURST="20" \
  --config infra/fly/fly.toml
```

Flyctl stores these encrypted; they appear in the running VM as env vars. **Do not commit `.env`.** The repo's `.gitignore` already excludes it.

### 5. Deploy (every push to main after this)

```bash
make deploy
# or equivalently:
flyctl deploy --remote-only --config infra/fly/fly.toml
```

`--remote-only` builds on Fly's builders (your laptop doesn't need to Docker build). First build takes ~4-6 min; subsequent builds reuse layers and typically land in 1-2 min.

After deploy:

```bash
flyctl status --config infra/fly/fly.toml           # VM state
flyctl logs --config infra/fly/fly.toml             # tail
flyctl open --config infra/fly/fly.toml             # browser
curl -I https://enterprise-assistant-reference.fly.dev   # health
```

### 6. CI deploys on push to main (one-time)

Set the Fly API token in GitHub repo secrets:

```bash
flyctl auth token                      # prints token
gh secret set FLY_API_TOKEN            # paste the token
```

`.github/workflows/deploy.yml` now runs on every push to `main` / `master`: typecheck + test + build + flyctl deploy. The concurrency guard prevents overlapping deploys.

## Operational realities (honest)

- **Cold start.** `infra/fly/fly.toml` ships with `min_machines_running = 1`, so one VM stays warm (~$1.70/mo). The HA replica still idles via `auto_stop_machines = "stop"`. Drop back to `0` if the demo window closes.
- **Neon auto-suspend.** Free-tier Neon branches suspend after 5 min idle. First query after suspend adds ~5-8s. `.github/workflows/warm-neon.yml` pings every 4 min via `scripts/warm_neon.ts` (one-shot mode) — opt-in by setting `DATABASE_URL_ADMIN` as a repo secret. Without the secret the workflow fails loudly; the Fly knob above still handles the VM-side cold independently.
- **Secret rotation.** `flyctl secrets set` triggers a rolling restart. Don't rotate during the demo window.
- **Scaling.** `flyctl scale count 2` for horizontal; `flyctl scale memory 1024` for vertical. The reference impl's in-memory rate limiter + cost breaker DO NOT survive multi-instance; upgrade to Redis before scaling horizontally. Marked in `app/lib/rate_limit.ts` + `app/lib/cost_breaker.ts` with `ponytail:` comments.
- **Migrations.** Future migrations are operator-run via `psql "$DATABASE_URL_ADMIN"` against Neon. No `release_command` in `fly.toml`; mixing migrations with deploy risks a partial-rollback mismatch when the migration succeeds but the new release fails.

## Pre-deploy local smoke

```bash
docker build -t ear-local .
docker run --rm -p 3001:3000 \
  -e DATABASE_URL="postgres://ear_app:...@host.docker.internal:5433/ear?sslmode=disable" \
  -e OPENAI_API_KEY="sk-proj-..." \
  -e JWT_SECRET="$(openssl rand -base64 32 | tr -d '\n')" \
  -e JWT_ISSUER="enterprise-assistant-reference" \
  -e JWT_AUDIENCE="assistant.app" \
  ear-local
```

Confirms the production container runs locally before paying for a remote build. If this fails, the Fly deploy will too; iterate locally.

## Rollback

```bash
flyctl releases --config infra/fly/fly.toml       # list, pick N-1
flyctl deploy --image <image-ref-from-list> --config infra/fly/fly.toml
```

Image refs are stable; rolling back is seconds, not a rebuild.
