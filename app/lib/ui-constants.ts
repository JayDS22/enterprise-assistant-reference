export const AGENT_COLORS: Record<string, string> = {
  supervisor: "oklch(0.72 0.17 220)",
  billing: "oklch(0.75 0.18 50)",
  tickets: "oklch(0.72 0.17 155)",
  kb: "oklch(0.72 0.17 310)",
};

export function agentColorVar(agent?: string): string {
  if (!agent) return "var(--color-agent-supervisor)";
  const key = agent.toLowerCase();
  if (key in AGENT_COLORS) return `var(--color-agent-${key})`;
  return "var(--color-agent-supervisor)";
}

export const EXAMPLE_PROMPTS: Array<{ label: string; text: string; exercises: string }> = [
  {
    label: "Renewal lookup via ticket",
    text: "What's the renewal date for the customer who filed ticket tkt-A-000001?",
    exercises: "tickets → billing handoff, 3 tool calls",
  },
  {
    label: "Refund policy",
    text: "What's our refund policy for annual plans?",
    exercises: "kb handoff, pgvector + ILIKE fallback",
  },
  {
    label: "Open tickets",
    text: "Show me the last 5 open tickets.",
    exercises: "tickets handoff, search_tickets tool",
  },
  {
    label: "Create a ticket",
    text: "Create a priority-high ticket: billing portal 500s on checkout.",
    exercises: "tickets handoff, idempotency key path",
  },
];
