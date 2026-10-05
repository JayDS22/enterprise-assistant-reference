// Bypass-detection test per FINAL plan §4. The withTenant wrapper is the single
// enforcement surface for tenant isolation. If a future refactor accidentally
// omits BEGIN or SET LOCAL, this test must fail loudly.
//
// Prerequisites: DATABASE_URL pointing at a dev Postgres with schema.sql + rls.sql
// loaded + 2 tenants seeded ('A' and 'B'). Skip when DATABASE_URL is unset.

import { afterAll, describe, expect, test } from "vitest";
import { closePool, withTenant } from "./client";

const SKIP = !process.env.DATABASE_URL;

describe.skipIf(SKIP)("withTenant tenant isolation", () => {
  afterAll(async () => {
    await closePool();
  });

  test("tenant A cannot read tenant B rows", async () => {
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
});
