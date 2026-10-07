import { z } from "zod";
import { withTenant } from "@/db/client";
import { SearchTicketsArgs } from "@/schemas/tools";

// Pattern mirrors lookup_customer.ts. All DB access inside withTenant tx; audit
// row written in the same tx. Parameterized SQL only.

// Null-safe default + hard cap. Schema allows `limit: null` because OpenAI
// Structured Outputs requires every field to be present (defaults disallowed
// on the surface schema). Postgres treats LIMIT NULL as "unbounded", so if the
// model omits the arg we would return every ticket for the tenant. Clamp here.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function search_tickets(
  tenantId: string,
  userId: string,
  input: z.infer<typeof SearchTicketsArgs>,
) {
  const args = SearchTicketsArgs.parse(input);
  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  return withTenant(tenantId, async (tx) => {
    const result = args.status
      ? await tx.query(
          `SELECT id, customer_id, title, status, priority, created_at
             FROM tickets
            WHERE status = $1
            ORDER BY created_at DESC
            LIMIT $2`,
          [args.status, limit],
        )
      : await tx.query(
          `SELECT id, customer_id, title, status, priority, created_at
             FROM tickets
            ORDER BY created_at DESC
            LIMIT $1`,
          [limit],
        );
    await tx.query(
      `INSERT INTO audit_log (tenant_id, user_id, tool_name, args_hash, result_hash)
       VALUES ($1, $2, 'search_tickets', $3, $4)`,
      [tenantId, userId, JSON.stringify(args), `count:${result.rowCount ?? 0}`],
    );
    return result.rows as Array<{
      id: string;
      customer_id: string;
      title: string;
      status: "open" | "pending" | "resolved" | "closed";
      priority: "low" | "normal" | "high" | "urgent";
      created_at: Date;
    }>;
  });
}
