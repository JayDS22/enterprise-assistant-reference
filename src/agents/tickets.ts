import { Agent, tool } from "@openai/agents";
import { SearchTicketsArgs, CreateTicketArgs } from "@/schemas/tools";
import { search_tickets } from "../tools/search_tickets";
import { create_ticket } from "../tools/create_ticket";
import { requireCtx, type AppRunContext } from "./common";

export type { AppRunContext };

const searchTool = tool<typeof SearchTicketsArgs, AppRunContext>({
  name: "search_tickets",
  description: "List tickets, optionally filtered by status, newest first.",
  parameters: SearchTicketsArgs,
  execute: async (input, runContext) => {
    const { tenantId, userId } = requireCtx(runContext, "tickets");
    return search_tickets(tenantId, userId, input);
  },
});

const createTool = tool<typeof CreateTicketArgs, AppRunContext>({
  name: "create_ticket",
  description:
    "Open a new support ticket. Caller must supply a stable idempotency_key so retries do not create duplicates.",
  parameters: CreateTicketArgs,
  execute: async (input, runContext) => {
    const { tenantId, userId } = requireCtx(runContext, "tickets");
    return create_ticket(tenantId, userId, input);
  },
});

export const ticketsAgent = new Agent<AppRunContext>({
  name: "tickets",
  model: "gpt-4o-2024-11-20",
  instructions: [
    "You handle ticket lookup and ticket creation.",
    "Before creating a ticket, confirm the customer_id and a short, specific title.",
    "Always pass an idempotency_key when creating; reuse the same key on explicit retries.",
    "When listing tickets, prefer a status filter if the user named one; cap results to 20 unless asked.",
  ].join(" "),
  tools: [searchTool, createTool],
});
