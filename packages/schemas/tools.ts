// Zod schemas for the 6 tools. Single source of truth: these feed the model's
// JSON Schema (via zod-to-json-schema) and gate tool returns with .parse().
// Per FINAL plan §2: Zod validates shape; SQL safety is parameterized queries.

import { z } from "zod";

export const LookupCustomerArgs = z.object({ customer_id: z.string() });
export const SearchTicketsArgs = z.object({
  status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export const GetSubscriptionStatusArgs = z.object({ customer_id: z.string() });
export const SearchKnowledgeBaseArgs = z.object({
  query: z.string().min(1),
  top_k: z.number().int().min(1).max(20).default(5),
});
export const CreateTicketArgs = z.object({
  customer_id: z.string(),
  title: z.string(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  idempotency_key: z.string().min(1),
});
export const EscalateToHumanArgs = z.object({
  conversation_id: z.string(),
  reason: z.string().min(1),
  idempotency_key: z.string().min(1),
});
