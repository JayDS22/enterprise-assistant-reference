"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight, Sparkles, LogIn, Zap } from "lucide-react";
import ToolCallCard from "./ToolCallCard";
import CitationList from "./CitationList";
import { agentColorVar } from "../lib/ui-constants";

type Citation = { docId: string; title: string; score: number };
type ToolCall = { name: string; args: unknown; result?: unknown };
type Message = {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  citations?: Citation[];
  handoff?: string;
  latencyMs?: number;
  costUsd?: number;
};

const JWT_KEY = "jwt_token";

function decodeJwtPayload(token: string): { tenant_id?: string; sub?: string; exp?: number } | null {
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

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jwtClaims, setJwtClaims] = useState<{ tenant?: string; user?: string } | null>(null);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const conversationIdRef = useRef<string>(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()),
  );

  function syncJwtClaims() {
    const token = typeof window !== "undefined" ? localStorage.getItem(JWT_KEY) : null;
    if (!token) return setJwtClaims(null);
    const payload = decodeJwtPayload(token);
    setJwtClaims(payload ? { tenant: payload.tenant_id, user: payload.sub } : null);
  }

  useEffect(() => {
    syncJwtClaims();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Clicks from sidebar example chips land here via document delegation.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const btn = t.closest(".prompt-chip") as HTMLElement | null;
      if (btn?.dataset.prompt) {
        setInput(btn.dataset.prompt);
        document.getElementById("chat-input")?.focus();
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
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

  async function send(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!input.trim() || streaming) return;
    setError(null);

    const token = localStorage.getItem(JWT_KEY);
    if (!token) {
      setError("No session loaded. Click 'Load demo session' above.");
      return;
    }

    const next: Message[] = [...messages, { role: "user", content: input }];
    setMessages(next);
    const t0 = performance.now();
    setInput("");
    setStreaming(true);

    try {
      const resp = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
      if (!resp.ok || !resp.body) throw new Error(`request failed: ${resp.status}`);

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
            /* ignore */
          }
        }
      }

      const latencyMs = Math.round(performance.now() - t0);
      setMessages((prev) => {
        const copy = prev.slice();
        copy[copy.length - 1] = { ...copy[copy.length - 1]!, latencyMs };
        return copy;
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStreaming(false);
    }
  }

  const hasJwt = jwtClaims !== null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Session banner */}
      <div
        className={`mx-6 mt-5 rounded-lg border px-4 py-2.5 text-[13px] flex items-center justify-between ${
          hasJwt
            ? "border-success/30 bg-success/5 text-text"
            : "border-warn/40 bg-warn/5 text-text"
        }`}
      >
        <div className="flex items-center gap-2.5">
          {hasJwt ? (
            <>
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="text-text-muted">signed in as</span>
              <code className="font-mono bg-bg-input px-1.5 py-0.5 rounded">
                tenant {jwtClaims?.tenant}
              </code>
              <code className="font-mono bg-bg-input px-1.5 py-0.5 rounded">
                {jwtClaims?.user}
              </code>
            </>
          ) : (
            <>
              <Sparkles size={14} className="text-warn" />
              <span>Click to mint a 1-hour tenant-A reviewer token:</span>
            </>
          )}
        </div>
        {!hasJwt && (
          <button
            onClick={loadDemo}
            disabled={loadingDemo}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent/90 hover:bg-accent text-bg text-[12px] font-medium transition disabled:opacity-50 disabled:cursor-wait"
          >
            <LogIn size={13} />
            {loadingDemo ? "minting..." : "Load demo session"}
          </button>
        )}
      </div>

      {/* Chat log */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 pb-4 pt-5 min-h-0">
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md">
              <div className="w-14 h-14 mx-auto rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center mb-4">
                <Sparkles size={22} className="text-accent" />
              </div>
              <h2 className="text-base font-semibold mb-1">Multi-agent enterprise assistant</h2>
              <p className="text-[13px] text-text-muted leading-relaxed">
                Supervisor routes to <span style={{ color: "var(--color-agent-billing)" }}>billing</span>
                , <span style={{ color: "var(--color-agent-tickets)" }}>tickets</span>, or{" "}
                <span style={{ color: "var(--color-agent-kb)" }}>kb</span>. Each tool call hits a
                live Postgres with RLS tenant isolation.
              </p>
              <p className="text-[12px] text-text-dim mt-3">
                Try a prompt from the sidebar &rarr;
              </p>
            </div>
          </div>
        )}

        <div className="max-w-3xl mx-auto space-y-5">
          {messages.map((m, i) => (
            <MessageBubble
              key={i}
              message={m}
              isLast={i === messages.length - 1}
              streaming={streaming && i === messages.length - 1}
            />
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mb-2 px-4 py-2 text-[13px] text-error bg-error/10 border border-error/30 rounded-md">
          {error}
        </div>
      )}

      {/* Input */}
      <form onSubmit={send} className="px-6 py-4 border-t border-border bg-bg-elevated/40">
        <div className="max-w-3xl mx-auto flex gap-2 items-center">
          <input
            id="chat-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={streaming ? "streaming reply..." : hasJwt ? "Ask the supervisor..." : "Load a demo session to start"}
            disabled={streaming || !hasJwt}
            className="flex-1 px-4 py-2.5 bg-bg-input border border-border focus:border-accent/60 focus:outline-none rounded-lg text-[14px] placeholder:text-text-dim disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim() || !hasJwt}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-accent/90 hover:bg-accent text-bg text-[13px] font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Zap size={14} />
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message, isLast, streaming }: { message: Message; isLast: boolean; streaming: boolean }) {
  const isUser = message.role === "user";
  const borderColor = agentColorVar(message.handoff);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-xl rounded-tr-sm bg-bg-input border border-border px-4 py-2.5 text-[14px] whitespace-pre-wrap leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 shrink-0 rounded-md border flex items-center justify-center font-mono text-[10px] font-bold uppercase mt-0.5"
        style={{ borderColor, color: borderColor, background: `color-mix(in oklch, ${borderColor} 10%, transparent)` }}>
        {(message.handoff ?? "sup").slice(0, 3)}
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {message.handoff && (
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span>supervisor</span>
            <ArrowRight size={12} className="handoff-arrow" style={{ color: borderColor }} />
            <span className="font-mono" style={{ color: borderColor }}>{message.handoff}</span>
          </div>
        )}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="space-y-1.5">
            {message.toolCalls.map((tc, j) => (
              <ToolCallCard key={j} name={tc.name} args={tc.args} result={tc.result} color={borderColor} />
            ))}
          </div>
        )}
        <div
          className="rounded-xl rounded-tl-sm border px-4 py-3 bg-bg-elevated"
          style={{ borderColor: `color-mix(in oklch, ${borderColor} 30%, var(--color-border))` }}
        >
          {message.content === "" && streaming ? (
            <div className="text-text-muted text-[13px] flex items-center gap-2">
              <span>thinking</span>
              <span className="caret" style={{ color: borderColor }} />
            </div>
          ) : (
            <div className="prose-chat text-[14px]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              {streaming && isLast && <span className="caret" style={{ color: borderColor }} />}
            </div>
          )}
        </div>
        {message.citations && message.citations.length > 0 && (
          <CitationList citations={message.citations} />
        )}
        {message.latencyMs && (
          <div className="flex items-center gap-2 text-[10.5px] text-text-dim">
            <span className="px-1.5 py-0.5 bg-bg-input rounded font-mono">
              {(message.latencyMs / 1000).toFixed(2)}s
            </span>
            {message.costUsd !== undefined && (
              <span className="px-1.5 py-0.5 bg-bg-input rounded font-mono">
                ${message.costUsd.toFixed(4)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
