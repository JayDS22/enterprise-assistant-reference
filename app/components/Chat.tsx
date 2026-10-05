"use client";

import { useEffect, useRef, useState } from "react";
import ToolCallCard from "./ToolCallCard";
import CitationList from "./CitationList";

type Citation = { docId: string; title: string; score: number };
type ToolCall = { name: string; args: unknown; result?: unknown };
type Message = {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  citations?: Citation[];
};

type Props = { initialTenantId: string; initialUserId: string };

const JWT_KEY = "jwt_token";

export default function Chat(_: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasJwt, setHasJwt] = useState<boolean>(false);
  const conversationIdRef = useRef<string>(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()),
  );

  useEffect(() => {
    setHasJwt(Boolean(localStorage.getItem(JWT_KEY)));
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || streaming) return;
    setError(null);

    const token = localStorage.getItem(JWT_KEY);
    if (!token) {
      setError("No jwt_token in localStorage.");
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
      if (!resp.ok || !resp.body) {
        throw new Error(`request failed: ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let assistant: Message = { role: "assistant", content: "" };
      setMessages((prev) => [...prev, assistant]);

      // SSE parse: split on \n\n, each frame has `data: {json}` lines.
      // ponytail: minimal parser; good enough for text/event-stream from our route.
      // Upgrade to EventSource if we need auto-reconnect.
      // (EventSource can't send Authorization headers, which is why fetch+reader here.)
      // eslint-disable-next-line no-constant-condition
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

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
      {!hasJwt && (
        <div
          style={{
            background: "#fff8c5",
            border: "1px solid #e0c200",
            padding: 8,
            marginBottom: 12,
            fontSize: 13,
            borderRadius: 4,
          }}
        >
          Set <code>jwt_token</code> in localStorage to a signed test JWT.
        </div>
      )}

      <div style={{ border: "1px solid #ddd", borderRadius: 4, minHeight: 320, padding: 12 }}>
        {messages.length === 0 && (
          <div style={{ color: "#999", fontSize: 13 }}>No messages yet.</div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ margin: "10px 0" }}>
            <div style={{ fontSize: 11, color: "#777", textTransform: "uppercase" }}>
              {m.role}
            </div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{m.content}</div>
            {m.toolCalls?.map((tc, j) => (
              <ToolCallCard key={j} name={tc.name} args={tc.args} result={tc.result} />
            ))}
            {m.citations && <CitationList citations={m.citations} />}
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
    </div>
  );
}
