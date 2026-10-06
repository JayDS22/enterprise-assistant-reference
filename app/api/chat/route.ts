import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { checkAndConsume } from "@/lib/rate_limit";
import { checkAndRecord } from "@/lib/cost_breaker";
import { piiInputGuard } from "../../../src/guardrails/pii_input";
import { piiOutputGuard } from "../../../src/guardrails/pii_output";
import { runSupervisor, estimateCostUsd } from "../../../src/agents/supervisor";
import { withTenant } from "@/db/client";

// SSE chat route. Spec placed this at app/(chat)/route.ts but that collides with
// the chat page (both resolve to /). Client fetches /api/chat per Chat.tsx, so
// the route lives here to match the contract.
//
// Node runtime: pg is not Edge-compatible, and this route touches audit_log.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingMessage = { role: "user" | "assistant"; content: string };
type Body = { messages: IncomingMessage[]; conversationId: string };

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function sseFrame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get("x-tenant-id");
  const userId = req.headers.get("x-user-id");
  if (!tenantId || !userId) {
    return new Response(JSON.stringify({ error: "missing_tenant_context" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rl = checkAndConsume(tenantId);
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil(rl.retry_after_ms / 1000)),
      },
    });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!Array.isArray(body?.messages) || typeof body?.conversationId !== "string") {
    return new Response(JSON.stringify({ error: "invalid_body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { safeMessages } = piiInputGuard(body.messages);
  const argsHash = sha256(JSON.stringify(safeMessages));

  // Probe cost ceilings BEFORE calling the supervisor. A $0 record is a
  // read-only check: it fails iff historical spend on this conversation or
  // this tenant-day already exceeds its cap. Guards against runaway loops
  // where a tenant keeps POSTing after they've already blown the budget.
  // Fail-closed: a module throw means we can't verify the budget → 500.
  try {
    const probe = checkAndRecord({ tenantId, conversationId: body.conversationId, usd: 0 });
    if (!probe.allowed) {
      return new Response(
        JSON.stringify({ error: "cost_cap_exceeded", reason: probe.reason }),
        {
          status: 402,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "cost_breaker_error", detail: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // ponytail: real streamed supervisor loop lands day 3. For now, invoke it,
  // catch the known "not implemented" throw, emit one SSE frame and close.
  let replyContent: string;
  let supervisorToolCalls: Array<{ name: string; args: unknown }> = [];
  let supervisorHandoff: string | undefined;
  let supervisorCost: number | undefined;
  try {
    const out = await runSupervisor({
      tenantId,
      userId,
      conversation: safeMessages as IncomingMessage[],
    });
    replyContent = out.reply;
    supervisorToolCalls = out.tool_calls.map((t) => ({ name: t.name, args: t.args }));
    supervisorHandoff = out.handoff;
    supervisorCost = estimateCostUsd(
      process.env.OPENAI_RESPONSES_MODEL ?? "gpt-4o-2024-11-20",
      out.usage.input_tokens,
      out.usage.output_tokens,
    );
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.includes("not implemented")) {
      replyContent =
        "Supervisor not wired yet. See _handoff/project-1-FINAL-plan.md §7 day 3.";
    } else {
      return new Response(JSON.stringify({ error: "supervisor_error", detail: msg }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Record actual spend post-supervisor. The OpenAI call already happened and
  // cannot be un-called — if this trips the cap, we still serve THIS response
  // and let the breaker reject the NEXT request. Warn-and-continue by design.
  if (typeof supervisorCost === "number" && supervisorCost > 0) {
    try {
      const rec = checkAndRecord({
        tenantId,
        conversationId: body.conversationId,
        usd: supervisorCost,
      });
      if (!rec.allowed) {
        console.warn(
          `cost_breaker: cap tripped post-spend tenant=${tenantId} conv=${body.conversationId} reason=${rec.reason}`,
        );
      }
    } catch (err) {
      console.warn("cost_breaker record failed:", (err as Error).message);
    }
  }

  // Scan the final reply for PII before it leaves the server. On hit, replace
  // the content with a policy message and flag the frame so Chat.tsx + eval
  // scorecard can count the block. Fail-closed on module throw → 500.
  // See src/guardrails/pii_output.ts for chunk-boundary caveat.
  let piiBlocked = false;
  try {
    const guard = piiOutputGuard(replyContent);
    if (!guard.safe) {
      piiBlocked = true;
      replyContent = `Blocked: output flagged for ${guard.reason}. Please rephrase.`;
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "pii_output_guard_error", detail: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const resultHash = sha256(replyContent);

  // Audit the turn. Best-effort: a DB outage shouldn't break the stream for
  // the reviewer path. Log and continue. Blocked turns audit with the
  // sanitized reply + a distinct tool_name so the compliance query can
  // isolate them.
  try {
    await withTenant(tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO audit_log (tenant_id, user_id, tool_name, args_hash, result_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, userId, piiBlocked ? "chat.turn.blocked" : "chat.turn", argsHash, resultHash],
      );
    });
  } catch (err) {
    console.error("audit_log insert failed:", (err as Error).message);
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      // Emit tool calls + handoff first so the UI can render them above the
      // final content frame. If the supervisor made no tool calls, this frame
      // is just {toolCalls: []} and the UI collapses it.
      controller.enqueue(
        encoder.encode(
          sseFrame({
            role: "assistant",
            content: "",
            toolCalls: supervisorToolCalls,
            handoff: supervisorHandoff,
          }),
        ),
      );
      controller.enqueue(
        encoder.encode(
          sseFrame({
            role: "assistant",
            content: replyContent,
            costUsd: supervisorCost,
            piiBlocked,
          }),
        ),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
