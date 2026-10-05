// Supervisor agent per FINAL plan §1. Triage incoming queries and hand off to
// {billing, tickets, kb} sub-agents. Owns escalate_to_human.
//
// Fill in with @openai/agents on day 3. Shape documented below so tool wiring
// and handoff tests can target it before the SDK call is complete.

export type SupervisorInput = {
  tenantId: string;
  userId: string;
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
};

export type SupervisorOutput = {
  reply: string;
  handoff?: "billing" | "tickets" | "kb" | "human";
  tool_calls: Array<{ name: string; args: unknown; result_hash: string }>;
};

export async function runSupervisor(_input: SupervisorInput): Promise<SupervisorOutput> {
  throw new Error("supervisor: not implemented (day 3 per project-1-FINAL-plan.md §7)");
}
