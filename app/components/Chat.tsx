"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ToolCallCard from "./ToolCallCard";
import CitationList from "./CitationList";

type Citation = { docId: string; title: string; score: number };
type ToolCall = { name: string; args: unknown; result?: unknown };
type Message = {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  citations?: Citation[];
  handoff?: string;
};

type Props = { initialTenantId: string; initialUserId: string };

const JWT_KEY = "jwt_token";

const EXAMPLE_PROMPTS = [
  "What's the renewal date for the customer who filed ticket tkt-A-000001?",
  "What's our refund policy for annual plans?",
  "Show me the last 5 open tickets.",
  "Create a priority-high ticket: billing portal 500s on checkout.",
];

// Decode a JWT payload client-side for display. NO verification; this is for
// showing tenant/user in the header, not for authorization. The route handler
// does the real verify.
function decodeJwtPayload(token: string): { tenant_id?: string; sub?: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || !parts[1]) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export default function Chat(_: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jwtClaims, setJwtClaims] = useState<{ tenant?: string; user?: string } | null>(
    null,
  );
  const [loadingDemo, setLoadingDemo] = useState(false);
  const conversationIdRef = useRef<string>(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()),
  );

  function syncJwtClaims() {
    const token = typeof window !== "undefined" ? localStorage.getItem(JWT_KEY) : null;
    if (!token) {
      setJwtClaims(null);
      return;
    }
    const payload = decodeJwtPayload(token);
    setJwtClaims(payload ? { tenant: payload.tenant_id, user: payload.sub } : null);
  }

  useEffect(() => {
    syncJwtClaims();
  }, []);

  async function loadDemo() {
    setLoadingDemo(true);
    setError(null);
    try {
      const resp = await fetch("/api/demo-jwt");
      if (!resp.ok) throw new Error(`demo-jwt ${resp.status}`);
      const { token } = (await resp.json()) as { token: string };
      localStorage.setItem(JWT_KEY, token);
      syncJwtClaims();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingDemo(false);
    }
  }

  function fillPrompt(p: string) {
    if (streaming) return;
    setInput(p);
  }

  async function send(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!input.trim() || streaming) return;
    setError(null);

    const token = localStorage.getItem(JWT_KEY);
    if (!token) {
      setError("No jwt_token. Click 'Load demo session' above.");
      return;
    }

    const next: Message[] = [...messages, { role: "user", content: input }];
    setMessages(next);
    setInput("");
    setStreaming(true);

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversationId: conversationIdRef.current,
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (resp.status === 429) {
        const ra = resp.headers.get("Retry-After") ?? "?";
        throw new Error(`rate-limited (retry after ${ra}s)`);
      }
      if (resp.status === 401) {
        throw new Error("auth failed. Click 'Load demo session' to refresh the JWT.");
      }
      if (!resp.ok || !resp.body) {
        throw new Error(`request failed: ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let assistant: Message = { role: "assistant", content: "" };
      setMessages((prev) => [...prev, assistant]);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const json = line.slice(5).trim();
          if (!json || json === "[DONE]") continue;
          try {
            const payload = JSON.parse(json) as Partial<Message>;
            assistant = {
              role: "assistant",
              content: (assistant.content ?? "") + (payload.content ?? ""),
              toolCalls: payload.toolCalls ?? assistant.toolCalls,
              citations: payload.citations ?? assistant.citations,
              handoff: payload.handoff ?? assistant.handoff,
            };
            setMessages((prev) => {
              const copy = prev.slice();
              copy[copy.length - 1] = assistant;
              return copy;
            });
          } catch {
            // ignore malformed frame
          }
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStreaming(false);
    }
  }

  const hasJwt = jwtClaims !== null;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          padding: "8px 12px",
          background: hasJwt ? "#f0fdf4" : "#fff8c5",
          border: `1px solid ${hasJwt ? "#86efac" : "#e0c200"}`,
          borderRadius: 6,
          fontSize: 13,
        }}
      >
        <span>
          {hasJwt ? (
            <>
              signed in <strong>·</strong> tenant <code>{jwtClaims?.tenant ?? "?"}</code>{" "}
              <strong>·</strong> user <code>{jwtClaims?.user ?? "?"}</code>
            </>
          ) : (
            <>no JWT loaded. click to mint a 1-hour tenant-A reviewer token:</>
          )}
        </span>
        {!hasJwt && (
          <button
            onClick={loadDemo}
            disabled={loadingDemo}
            style={{
              padding: "4px 10px",
              fontSize: 12,
              border: "1px solid #111",
              background: "#111",
              color: "#fff",
              borderRadius: 4,
              cursor: loadingDemo ? "wait" : "pointer",
            }}
          >
            {loadingDemo ? "..." : "Load demo session"}
          </button>
        )}
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 6,
          minHeight: 320,
          padding: 12,
          background: "#fff",
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: "#888", fontSize: 13 }}>
            Try one of the prompts below, or type your own.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            data-role={m.role}
            style={{
              margin: "12px 0",
              paddingBottom: 12,
              borderBottom: i < messages.length - 1 ? "1px dashed #eee" : "none",
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: "#777",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: 4,
              }}
            >
              {m.role}
              {m.handoff && (
                <span style={{ marginLeft: 8, color: "#2563eb" }}>
                  &rarr; handed off to {m.handoff}
                </span>
              )}
            </div>
            {m.toolCalls && m.toolCalls.length > 0 && (
              <div style={{ margin: "6px 0" }}>
                {m.toolCalls.map((tc, j) => (
                  <ToolCallCard key={j} name={tc.name} args={tc.args} result={tc.result} />
                ))}
              </div>
            )}
            <div style={{ fontSize: 14, lineHeight: 1.55 }}>
              {m.role === "assistant" ? (
                m.content === "" && streaming && i === messages.length - 1 ? (
                  <span style={{ color: "#888", fontStyle: "italic" }}>
                    thinking<span className="dots">...</span>
                  </span>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                )
              ) : (
                <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
              )}
            </div>
            {m.citations && m.citations.length > 0 && <CitationList citations={m.citations} />}
          </div>
        ))}
      </div>

      {error && (
        <div style={{ color: "#c00", fontSize: 13, marginTop: 8 }}>error: {error}</div>
      )}

      <form onSubmit={send} style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={streaming ? "streaming..." : "message..."}
          disabled={streaming}
          style={{
            flex: 1,
            padding: "8px 10px",
            border: "1px solid #ccc",
            borderRadius: 4,
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          style={{
            padding: "8px 14px",
            border: "1px solid #333",
            background: streaming ? "#eee" : "#111",
            color: streaming ? "#777" : "#fff",
            borderRadius: 4,
            cursor: streaming ? "not-allowed" : "pointer",
          }}
        >
          Send
        </button>
      </form>

      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => fillPrompt(p)}
            disabled={streaming}
            style={{
              padding: "4px 10px",
              fontSize: 12,
              background: "#f3f4f6",
              border: "1px solid #d1d5db",
              borderRadius: 999,
              cursor: streaming ? "not-allowed" : "pointer",
              color: "#374151",
            }}
          >
            {p.length > 48 ? p.slice(0, 46) + "..." : p}
          </button>
        ))}
      </div>
    </div>
  );
}
