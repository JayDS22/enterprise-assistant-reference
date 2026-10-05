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
 *   BEGIN; SET LOCAL app.tenant_id = $1; <work>; COMMIT
 *
 * SET LOCAL is scoped to the transaction, so no leak across pool checkouts.
 * A bare `pool.query` outside this wrapper is a bug; db.withTenant.spec.ts
 * includes a bypass-detection test that fails if the pattern is omitted.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  if (!tenantId) throw new Error("withTenant: tenantId required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL app.tenant_id = $1", [tenantId]);
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
