import { Agent, tool } from "@openai/agents";
import { SearchKnowledgeBaseArgs } from "@/schemas/tools";
import { search_knowledge_base } from "../tools/search_knowledge_base";

export type AppRunContext = { tenantId: string; userId: string };

function requireCtx(ctx: { context: AppRunContext } | undefined): AppRunContext {
  if (!ctx) throw new Error("kb: RunContext missing (tenantId/userId required)");
  return ctx.context;
}

const kbTool = tool<typeof SearchKnowledgeBaseArgs, AppRunContext>({
  name: "search_knowledge_base",
  description:
    "Search internal policy and documentation. Returns hits with id, title, snippet, and score.",
  parameters: SearchKnowledgeBaseArgs,
  execute: async (input, runContext) => {
    const { tenantId, userId } = requireCtx(runContext);
    return search_knowledge_base(tenantId, userId, input);
  },
});

export const kbAgent = new Agent<AppRunContext>({
  name: "kb",
  model: "gpt-4o-2024-11-20",
  instructions: [
    "You answer policy and documentation questions using search_knowledge_base only.",
    "Every answer MUST cite the docId(s) returned by the tool, inline, in brackets — e.g. [doc:kb-042].",
    "If no doc supports the answer, say so and refuse; do not improvise policy from training data.",
    "Keep snippets short and factual; do not restate the user's question.",
  ].join(" "),
  tools: [kbTool],
});
