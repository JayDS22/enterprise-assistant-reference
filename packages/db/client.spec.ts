// Bypass-detection test per FINAL plan §4. The withTenant wrapper is the single
// enforcement surface for tenant isolation. If a future refactor accidentally
// omits BEGIN or SET LOCAL, this test must fail loudly.
//
// Prerequisites: DATABASE_URL pointing at a dev Postgres with schema.sql + rls.sql
// loaded + 2 tenants seeded ('A' and 'B'). Skip when DATABASE_URL is unset.

import { afterAll, describe, expect, test } from "vitest";
import { getOrCreateTrace } from "@openai/agents";
import { closePool, withTenant } from "./client";

const SKIP = !process.env.DATABASE_URL;

// withTenant wraps its work in an Agents SDK custom span (see client.ts) which
// requires an active trace in the execution context. Route handlers get this
// from the agent run; unit tests don't, so each DB test wraps its body in
// getOrCreateTrace to materialize one. Keeps prod behavior unchanged.
const withTestTrace = <T>(fn: () => Promise<T>) =>
  getOrCreateTrace(fn, { name: "db-client-spec" });

describe.skipIf(SKIP)("withTenant tenant isolation", () => {
  afterAll(async () => {
    await closePool();
  });

  test("tenant A cannot read tenant B rows", async () => {
    await withTestTrace(async () => {
      // Seed assumption: both tenants have at least one customer row.
      const aRows = await withTenant("A", async (tx) => {
        const r = await tx.query("SELECT tenant_id FROM customers LIMIT 100");
        return r.rows;
      });
      expect(aRows.every((r) => r.tenant_id === "A")).toBe(true);

      const bRows = await withTenant("B", async (tx) => {
        const r = await tx.query("SELECT tenant_id FROM customers LIMIT 100");
        return r.rows;
      });
      expect(bRows.every((r) => r.tenant_id === "B")).toBe(true);
    });
  });

  test("bare pool query without SET LOCAL returns zero rows (RLS filter engaged)", async () => {
    // Importing the pool directly simulates the bypass. RLS without a tenant GUC
    // in session scope filters everything to zero rows; this proves the policy
    // is attached to the table, not just enforced by withTenant.
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const res = await pool.query("SELECT COUNT(*) FROM customers");
      expect(Number(res.rows[0].count)).toBe(0);
    } finally {
      await pool.end();
    }
  });

  // Regression for INCIDENTS.md #4.9. The WITH CHECK clause on every policy in
  // rls.sql is what makes cross-tenant INSERTs fail. To manually prove this test
  // bites, weaken the WITH CHECK against the running DB and re-run — the
  // "cross-tenant INSERT" assertion will fail because the INSERT succeeds:
  //   psql -U dev -d ear -c "DROP POLICY tenant_isolation ON customers;
  //     CREATE POLICY tenant_isolation ON customers FOR ALL
  //       USING (tenant_id = current_setting('app.tenant_id', true))
  //       WITH CHECK (true);"
  // (Verified against the local pg container 2026-10-06; cleanup afterwards:
  // DROP POLICY + recreate from rls.sql + DELETE any leaked row.)
  test("WITH CHECK blocks cross-tenant INSERT and allows same-tenant INSERT", async () => {
    const crossId = `rls-check-cross-${Date.now()}`;
    const sameId = `rls-check-same-${Date.now()}`;

    await withTestTrace(async () => {
      // Cross-tenant INSERT from a tenant-A session must be rejected by WITH CHECK.
      await expect(
        withTenant("A", async (tx) => {
          await tx.query(
            "INSERT INTO customers (tenant_id, id, name, email) VALUES ($1, $2, $3, $4)",
            ["B", crossId, "Mallory Cross", "m@example.invalid"],
          );
        }),
      ).rejects.toThrow(/row-level security/i);

      // Same-tenant INSERT must succeed, proving the policy is not a blanket deny.
      await withTenant("A", async (tx) => {
        await tx.query(
          "INSERT INTO customers (tenant_id, id, name, email) VALUES ($1, $2, $3, $4)",
          ["A", sameId, "Alice Same", "a@example.invalid"],
        );
      });

      // Cleanup the successful row. The failed INSERT was rolled back by withTenant
      // on throw, so only the same-tenant row needs removal.
      await withTenant("A", async (tx) => {
        await tx.query("DELETE FROM customers WHERE tenant_id = $1 AND id = $2", [
          "A",
          sameId,
        ]);
      });
    });
  });
});
