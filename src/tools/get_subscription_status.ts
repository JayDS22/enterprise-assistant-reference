import { z } from "zod";
import { withTenant } from "@/db/client";
import { GetSubscriptionStatusArgs } from "@/schemas/tools";

const SubscriptionRow = z.object({
  id: z.string(),
  plan: z.string(),
  status: z.enum(["active", "cancelled", "past_due", "trialing"]),
  renews_on: z.date().nullable(),
});

export type SubscriptionStatus = z.infer<typeof SubscriptionRow> | null;

export async function get_subscription_status(
  tenantId: string,
  userId: string,
  input: z.infer<typeof GetSubscriptionStatusArgs>,
): Promise<SubscriptionStatus> {
  const args = GetSubscriptionStatusArgs.parse(input);
  return withTenant(tenantId, async (tx) => {
    const result = await tx.query(
      `SELECT id, plan, status, renews_on
         FROM subscriptions
        WHERE customer_id = $1
        ORDER BY renews_on DESC NULLS LAST
        LIMIT 1`,
      [args.customer_id],
    );
    const row = result.rows[0];
    await tx.query(
      `INSERT INTO audit_log (tenant_id, user_id, tool_name, args_hash, result_hash)
       VALUES ($1, $2, 'get_subscription_status', $3, $4)`,
      [tenantId, userId, JSON.stringify(args), row ? "ok" : "not_found"],
    );
    return row ? SubscriptionRow.parse(row) : null;
  });
}
