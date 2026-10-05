import { z } from "zod";
import { createHash } from "node:crypto";
import { withTenant } from "@/db/client";
import { EscalateToHumanArgs } from "@/schemas/tools";

// Day-3 scope per FINAL plan §9: no handoff queue table yet. We record the
// escalation in audit_log and use the idempotency_keys table to short-circuit
// retries. The "idempotency key collision under Fly deploy restart" postmortem
// candidate (FINAL plan §9) is the reason this path exists at all.

const EscalationResult = z.object({
  escalation_id: z.string(),
  replayed: z.boolean(),
});

export type EscalationResult = z.infer<typeof EscalationResult>;

function hashArgs(args: unknown): string {
  return createHash("sha256").update(JSON.stringify(args)).digest("hex").slice(0, 32);
}

export async function escalate_to_human(
  tenantId: string,
  userId: string,
  input: z.infer<typeof EscalateToHumanArgs>,
): Promise<EscalationResult> {
  const args = EscalateToHumanArgs.parse(input);
  const argsHash = hashArgs({
    conversation_id: args.conversation_id,
    reason: args.reason,
  });

  return withTenant(tenantId, async (tx) => {
    const prior = await tx.query(
      `SELECT result_hash FROM idempotency_keys
        WHERE key = $1 AND tool_name = 'escalate_to_human'`,
      [args.idempotency_key],
    );
    const priorRow = prior.rows[0];
    if (priorRow) {
      await tx.query(
        `INSERT INTO audit_log (tenant_id, user_id, tool_name, args_hash, result_hash)
         VALUES ($1, $2, 'escalate_to_human', $3, $4)`,
        [tenantId, userId, argsHash, `replay:${priorRow.result_hash}`],
      );
      return EscalationResult.parse({
        escalation_id: priorRow.result_hash,
        replayed: true,
      });
    }

    const auditInsert = await tx.query(
      `INSERT INTO audit_log (tenant_id, user_id, tool_name, args_hash, result_hash)
       VALUES ($1, $2, 'escalate_to_human', $3, $4)
       RETURNING id`,
      [tenantId, userId, argsHash, "escalated"],
    );
    const auditRow = auditInsert.rows[0];
    if (!auditRow) throw new Error("escalate_to_human: audit insert returned no row");
    const escalationId = String(auditRow.id);

    const keyInsert = await tx.query(
      `INSERT INTO idempotency_keys (tenant_id, key, tool_name, result_hash)
       VALUES ($1, $2, 'escalate_to_human', $3)
       ON CONFLICT (tenant_id, key) DO NOTHING
       RETURNING key`,
      [tenantId, args.idempotency_key, escalationId],
    );
    const wonTheRace = (keyInsert.rowCount ?? 0) > 0;

    return EscalationResult.parse({
      escalation_id: escalationId,
      replayed: !wonTheRace,
    });
  });
}
