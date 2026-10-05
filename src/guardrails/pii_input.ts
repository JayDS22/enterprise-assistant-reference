import { detect, redact, type PIIKind } from "../../app/lib/pii";

// ponytail: input-side guard redacts by default and only blocks on explicit
// opt-in. User-typed PII in prompts is almost always accidental and the
// agent still needs to make progress; blocking shifts the UX cost to the
// user for the model's privacy benefit.

export type GuardMessage = { role: string; content: string };

export type PIIInputFinding = {
  kind: PIIKind;
  originalIndex: number;
  redactedCount: number;
};

export type PIIInputResult<M extends GuardMessage> = {
  safeMessages: M[];
  found: PIIInputFinding[];
};

const SCANNABLE_ROLES = new Set(["user", "tool"]);

export function piiInputGuard<M extends GuardMessage>(
  messages: M[],
): PIIInputResult<M> {
  const found: PIIInputFinding[] = [];
  const safeMessages = messages.map((msg, originalIndex) => {
    if (!SCANNABLE_ROLES.has(msg.role)) return msg;
    const matches = detect(msg.content);
    if (matches.length === 0) return msg;
    const counts = new Map<PIIKind, number>();
    for (const m of matches) counts.set(m.kind, (counts.get(m.kind) ?? 0) + 1);
    for (const [kind, redactedCount] of counts) {
      found.push({ kind, originalIndex, redactedCount });
    }
    return { ...msg, content: redact(msg.content) };
  });
  return { safeMessages, found };
}
