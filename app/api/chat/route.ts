import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { checkAndConsume } from "@/lib/rate_limit";
import { piiInputGuard } from "../../../src/guardrails/pii_input";
import { runSupervisor } from "../../../src/agents/supervisor";
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

  // ponytail: real streamed supervisor loop lands day 3. For now, invoke it,
  // catch the known "not implemented" throw, emit one SSE frame and close.
  let replyContent: string;
  try {
    const out = await runSupervisor({
      tenantId,
      userId,
      conversation: safeMessages as IncomingMessage[],
    });
    replyContent = out.reply;
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

  const resultHash = sha256(replyContent);

  // Audit the turn. Best-effort: a DB outage shouldn't break the stream for
  // the reviewer path. Log and continue.
  try {
    await withTenant(tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO audit_log (tenant_id, user_id, tool_name, args_hash, result_hash)
         VALUES ($1, $2, 'chat.turn', $3, $4)`,
        [tenantId, userId, argsHash, resultHash],
      );
    });
  } catch (err) {
    console.error("audit_log insert failed:", (err as Error).message);
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode(sseFrame({ role: "assistant", content: replyContent })),
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
