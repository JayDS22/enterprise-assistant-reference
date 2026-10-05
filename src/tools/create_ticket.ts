import { z } from "zod";
import { randomUUID } from "node:crypto";
import { withTenant } from "@/db/client";
import { CreateTicketArgs } from "@/schemas/tools";

// Pattern per FINAL plan §4: INSERT the ticket, then INSERT the idempotency
// row with ON CONFLICT DO NOTHING. If the idempotency insert conflicts, the
// caller is retrying — look up the prior result_hash and return the cached
// outcome instead of double-writing.

const CreateTicketResult = z.object({
  id: z.string(),
  status: z.enum(["open", "pending", "resolved", "closed"]),
  replayed: z.boolean(),
});

export type CreateTicketResult = z.infer<typeof CreateTicketResult>;

export async function create_ticket(
  tenantId: string,
  userId: string,
  input: z.infer<typeof CreateTicketArgs>,
): Promise<CreateTicketResult> {
  const args = CreateTicketArgs.parse(input);
  return withTenant(tenantId, async (tx) => {
    // Short-circuit on retry: if the key already exists for this tool, replay.
    const prior = await tx.query(
      `SELECT result_hash FROM idempotency_keys
        WHERE key = $1 AND tool_name = 'create_ticket'`,
      [args.idempotency_key],
    );
    const priorRow = prior.rows[0];
    if (priorRow) {
      await tx.query(
        `INSERT INTO audit_log (tenant_id, user_id, tool_name, args_hash, result_hash)
         VALUES ($1, $2, 'create_ticket', $3, $4)`,
        [tenantId, userId, JSON.stringify(args), `replay:${priorRow.result_hash}`],
      );
      return CreateTicketResult.parse({
        id: priorRow.result_hash,
        status: "open",
        replayed: true,
      });
    }

    const ticketId = `T-${randomUUID().slice(0, 8)}`;
    const inserted = await tx.query(
      `INSERT INTO tickets (tenant_id, id, customer_id, title, status, priority)
       VALUES ($1, $2, $3, $4, 'open', $5)
       RETURNING id, status`,
      [tenantId, ticketId, args.customer_id, args.title, args.priority],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("create_ticket: insert returned no row");

    // ON CONFLICT guards concurrent racers that beat us between the SELECT and
    // this INSERT. If someone else wrote the key first, treat as replay.
    const keyInsert = await tx.query(
      `INSERT INTO idempotency_keys (tenant_id, key, tool_name, result_hash)
       VALUES ($1, $2, 'create_ticket', $3)
       ON CONFLICT (tenant_id, key) DO NOTHING
       RETURNING key`,
      [tenantId, args.idempotency_key, row.id],
    );
    const wonTheRace = (keyInsert.rowCount ?? 0) > 0;

    await tx.query(
      `INSERT INTO audit_log (tenant_id, user_id, tool_name, args_hash, result_hash)
       VALUES ($1, $2, 'create_ticket', $3, $4)`,
      [tenantId, userId, JSON.stringify(args), row.id],
    );

    return CreateTicketResult.parse({
      id: row.id,
      status: row.status,
      replayed: !wonTheRace,
    });
  });
}
