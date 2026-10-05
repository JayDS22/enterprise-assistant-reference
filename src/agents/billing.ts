import { Agent, tool } from "@openai/agents";
import { GetSubscriptionStatusArgs } from "@/schemas/tools";
import { get_subscription_status } from "../tools/get_subscription_status";

// RunContext payload for every sub-agent. tenantId + userId are plumbed from
// the SSE route handler into Runner.run(..., { context: { tenantId, userId } }).
export type AppRunContext = { tenantId: string; userId: string };

function requireCtx(ctx: { context: AppRunContext } | undefined): AppRunContext {
  if (!ctx) throw new Error("billing: RunContext missing (tenantId/userId required)");
  return ctx.context;
}

const subscriptionTool = tool<typeof GetSubscriptionStatusArgs, AppRunContext>({
  name: "get_subscription_status",
  description:
    "Fetch the active subscription for a customer: plan, status, next renewal date.",
  parameters: GetSubscriptionStatusArgs,
  execute: async (input, runContext) => {
    const { tenantId, userId } = requireCtx(runContext);
    return get_subscription_status(tenantId, userId, input);
  },
});

export const billingAgent = new Agent<AppRunContext>({
  name: "billing",
  model: "gpt-4o-2024-11-20",
  instructions: [
    "You handle billing questions: plans, renewals, cancellations, refunds.",
    "Always resolve the customer_id before answering. Use get_subscription_status to ground every answer.",
    "If the subscription is missing, say so plainly; never invent a plan or renewal date.",
    "Refund eligibility must cite policy wording from the knowledge base agent — do not improvise policy.",
  ].join(" "),
  tools: [subscriptionTool],
});
