import { Agent, assistant, handoff, run, system, user } from "@openai/agents";
import { billingAgent } from "./billing";
import { ticketsAgent } from "./tickets";
import { kbAgent } from "./kb";

export type AppRunContext = { tenantId: string; userId: string };

export type SupervisorInput = {
  tenantId: string;
  userId: string;
  conversation: Array<{ role: "user" | "assistant" | "system"; content: string }>;
};

export type SupervisorOutput = {
  reply: string;
  handoff?: "billing" | "tickets" | "kb" | "human";
  tool_calls: Array<{ name: string; args: unknown; result_hash: string }>;
  usage: { input_tokens: number; output_tokens: number; requests: number };
};

// Pinned pricing per 1M tokens. Keep aligned with
// scripts/pricing.py in the sibling evals pack if that model is used.
const PRICING: Record<string, { in: number; out: number }> = {
  "gpt-4o-2024-11-20": { in: 2.5, out: 10.0 },
  "gpt-4o-2024-08-06": { in: 2.5, out: 10.0 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? PRICING["gpt-4o-2024-11-20"]!;
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

const supervisorAgent = new Agent<AppRunContext>({
  name: "supervisor",
  model: "gpt-4o-2024-11-20",
  instructions: [
    "You triage enterprise customer requests and route to the right specialist.",
    "Hand off to `billing` for plan/renewal/refund/subscription questions.",
    "Hand off to `tickets` for ticket lookup, status, or creation.",
    "Hand off to `kb` for policy, documentation, or how-to questions.",
    "Answer directly for small-talk and routing confirmations only.",
    "Never fabricate customer details, ticket IDs, or policy content.",
  ].join(" "),
  handoffs: [handoff(billingAgent), handoff(ticketsAgent), handoff(kbAgent)],
});

export async function runSupervisor(input: SupervisorInput): Promise<SupervisorOutput> {
  const inputItems = input.conversation.map((m) =>
    m.role === "user" ? user(m.content) : m.role === "assistant" ? assistant(m.content) : system(m.content),
  );
  const result = await run(supervisorAgent, inputItems, {
    context: { tenantId: input.tenantId, userId: input.userId },
  });

  const reply =
    typeof result.finalOutput === "string"
      ? result.finalOutput
      : JSON.stringify(result.finalOutput ?? "");

  const toolCalls: SupervisorOutput["tool_calls"] = [];
  for (const item of result.newItems ?? []) {
    const type = (item as { type?: string }).type;
    if (type === "tool_call_item") {
      const call = item as unknown as { rawItem?: { name?: string; arguments?: unknown } };
      toolCalls.push({
        name: call.rawItem?.name ?? "unknown",
        args: call.rawItem?.arguments ?? {},
        result_hash: "",
      });
    }
  }

  const lastAgent = result.lastAgent?.name;
  const handoffTarget =
    lastAgent === "supervisor" ? undefined : (lastAgent as SupervisorOutput["handoff"]);

  // Aggregate token usage across every raw model response in the run (supervisor
  // call + any sub-agent calls + any tool-emission turns).
  let inputTokens = 0;
  let outputTokens = 0;
  let requests = 0;
  for (const r of result.rawResponses ?? []) {
    const u = r.usage;
    if (!u) continue;
    inputTokens += u.inputTokens ?? 0;
    outputTokens += u.outputTokens ?? 0;
    requests += u.requests ?? 1;
  }

  return {
    reply,
    handoff: handoffTarget,
    tool_calls: toolCalls,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, requests },
  };
}
