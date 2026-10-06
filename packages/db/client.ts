import { Pool, PoolClient } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 10_000,
});

/**
 * withTenant is the enforcement surface for RLS tenant isolation.
 * Every tool and route handler MUST route DB access through this wrapper.
 *
 * Pattern per FINAL plan §4:
 *   BEGIN; set_config('app.tenant_id', $1, true); <work>; COMMIT
 *
 * `set_config(..., true)` is the parameterizable equivalent of SET LOCAL,
 * scoped to the current transaction. SET LOCAL does not accept bind
 * parameters (Postgres SQL syntax restriction); see INCIDENTS.md #5.
 *
 * A bare `pool.query` outside this wrapper is a bug; db.withTenant.spec.ts
 * includes a bypass-detection test that fails if the pattern is omitted.
 * The app MUST connect as a non-superuser role (ear_app) because superusers
 * bypass even FORCE ROW LEVEL SECURITY; see INCIDENTS.md #6.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  if (!tenantId) throw new Error("withTenant: tenantId required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
