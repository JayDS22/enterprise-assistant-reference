-- Schema for enterprise-assistant-reference.
-- Loaded by migrations/0001_init.sql. RLS policies live in rls.sql.
-- Every table carries tenant_id and routes through withTenant() (see client.ts).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE tenants (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  tenant_id     text NOT NULL REFERENCES tenants(id),
  id            text NOT NULL,
  name          text NOT NULL,
  email         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE subscriptions (
  tenant_id     text NOT NULL REFERENCES tenants(id),
  id            text NOT NULL,
  customer_id   text NOT NULL,
  plan          text NOT NULL,
  status        text NOT NULL CHECK (status IN ('active','cancelled','past_due','trialing')),
  renews_on     date,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id)
);

CREATE TABLE tickets (
  tenant_id     text NOT NULL REFERENCES tenants(id),
  id            text NOT NULL,
  customer_id   text NOT NULL,
  title         text NOT NULL,
  status        text NOT NULL CHECK (status IN ('open','pending','resolved','closed')),
  priority      text NOT NULL CHECK (priority IN ('low','normal','high','urgent')),
  assignee      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id)
);

-- Idempotency index per FINAL plan §4. Retries on create_ticket + escalate_to_human
-- hit the same (tenant_id, idempotency_key) and short-circuit.
CREATE TABLE idempotency_keys (
  tenant_id     text NOT NULL REFERENCES tenants(id),
  key           text NOT NULL,
  tool_name     text NOT NULL,
  result_hash   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE docs (
  tenant_id     text NOT NULL REFERENCES tenants(id),
  id            text NOT NULL,
  title         text NOT NULL,
  body          text NOT NULL,
  embedding     vector(1536),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX docs_embedding_idx ON docs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);

-- Audit log: every tool call, every tenant. Reviewer can SELECT the trail per tenant.
CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL REFERENCES tenants(id),
  user_id       text NOT NULL,
  tool_name     text NOT NULL,
  args_hash     text NOT NULL,
  result_hash   text NOT NULL,
  cost_usd      numeric(10,6),
  latency_ms    integer,
  ts            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_ts_idx ON audit_log (tenant_id, ts DESC);

-- Daily cost rollup fed by cost_breaker. Reads are per-tenant for the dashboard.
CREATE TABLE cost_rollup_daily (
  tenant_id     text NOT NULL REFERENCES tenants(id),
  day           date NOT NULL,
  spend_usd     numeric(10,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day)
);
