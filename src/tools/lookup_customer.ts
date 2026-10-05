import { z } from "zod";
import { withTenant } from "@/db/client";

// Pattern template for all 6 tools. Every tool MUST:
//   1. Define a Zod input schema (single source of truth; feeds model's JSON Schema).
//   2. Run every DB access through withTenant(tenantId, async (tx) => {...}).
//   3. Write an audit_log row in the SAME transaction as the work.
// Deviation from this pattern is a bug caught by db.withTenant.spec.ts.

export const LookupCustomerInput = z.object({
  customer_id: z.string().min(1),
});

export const LookupCustomerOutput = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

export async function lookup_customer(
  tenantId: string,
  userId: string,
  input: z.infer<typeof LookupCustomerInput>,
) {
  return withTenant(tenantId, async (tx) => {
    const result = await tx.query(
      "SELECT id, name, email FROM customers WHERE id = $1",
      [input.customer_id],
    );
    const row = result.rows[0];
    // Audit in the same tx. args_hash + result_hash are placeholder shapes;
    // use a stable canonical JSON hash in the real impl.
    await tx.query(
      `INSERT INTO audit_log (tenant_id, user_id, tool_name, args_hash, result_hash)
       VALUES ($1, $2, 'lookup_customer', $3, $4)`,
      [tenantId, userId, JSON.stringify(input), row ? "ok" : "not_found"],
    );
    if (!row) throw new Error("customer_not_found");
    return LookupCustomerOutput.parse(row);
  });
}
