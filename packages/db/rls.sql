-- Row-level security policies. Every table filters by current_setting('app.tenant_id').
-- The session GUC is set by withTenant() (client.ts) via SET LOCAL inside a transaction.
--
-- Pattern per FINAL plan §4: a bare pool.query bypasses this surface; withTenant() is
-- the single enforcement path. db.withTenant.spec.ts proves the bypass is detected.
--
-- FORCE ROW LEVEL SECURITY: without this, RLS does NOT apply to the table owner (the
-- role that created the table), so a superuser bypasses every policy. The app connects
-- as the DB owner in the reference impl, so FORCE is required or the test suite proves
-- the policy is theatre. See INCIDENTS.md incident #4 for the catch.

ALTER TABLE customers         ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE subscriptions     ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE tickets           ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys  ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE docs              ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log         ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
ALTER TABLE cost_rollup_daily ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;

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

-- Non-superuser application role. The app's DATABASE_URL MUST point at this
-- role, not the DB owner. Superusers and table owners bypass RLS even with
-- FORCE ROW LEVEL SECURITY; see INCIDENTS.md #6 for the catch. The admin DB
-- role (that ran these migrations) retains ownership and can run future DDL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ear_app') THEN
    CREATE ROLE ear_app LOGIN PASSWORD 'ear_app' NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO ear_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ear_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ear_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ear_app;
