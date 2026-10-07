// Shared sub-agent types + context helpers. Was previously duplicated across
// kb.ts, billing.ts, and tickets.ts; consolidated here per hostile-review note.
//
// AppRunContext is the RunContext payload every sub-agent receives from the
// SSE route handler via Runner.run(..., { context: { tenantId, userId } }).

export type AppRunContext = { tenantId: string; userId: string };

export function requireCtx(
  ctx: { context: AppRunContext } | undefined,
  agentName: string,
): AppRunContext {
  if (!ctx) {
    throw new Error(`${agentName}: RunContext missing (tenantId/userId required)`);
  }
  return ctx.context;
}
