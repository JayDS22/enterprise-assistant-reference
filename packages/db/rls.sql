-- Row-level security policies. Every table filters by current_setting('app.tenant_id').
-- The session GUC is set by withTenant() (client.ts) via SET LOCAL inside a transaction.
--
-- Pattern per FINAL plan §4: a bare pool.query bypasses this surface; withTenant() is
-- the single enforcement path. db.withTenant.spec.ts proves the bypass is detected.

ALTER TABLE customers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys  ENABLE ROW LEVEL SECURITY;
ALTER TABLE docs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_rollup_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON customers
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON subscriptions
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON tickets
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON idempotency_keys
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON docs
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY tenant_isolation ON cost_rollup_daily
  USING (tenant_id = current_setting('app.tenant_id', true));
