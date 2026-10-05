import { detect } from "../../app/lib/pii";

// ponytail: stateless per-chunk scan. A PII token split across two chunks
// (e.g. SSN ending at a chunk boundary) is a false negative here —
// callers should buffer ~20 chars across chunk boundaries before invoking
// to close that gap. Blocking (not redacting) on hit because a model
// leaking PII from a tool result is a bug to surface, not patch.

export type PIIOutputResult = {
  safe: boolean;
  reason?: string;
};

export function piiOutputGuard(chunk: string): PIIOutputResult {
  const matches = detect(chunk);
  if (matches.length === 0) return { safe: true };
  const kinds = Array.from(new Set(matches.map((m) => m.kind))).sort();
  return {
    safe: false,
    reason: `pii_in_output:${kinds.join(",")}`,
  };
}
