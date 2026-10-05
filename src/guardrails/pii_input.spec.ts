import { describe, expect, test } from "vitest";
import { piiInputGuard } from "./pii_input";

describe("piiInputGuard", () => {
  test("clean messages pass through unchanged", () => {
    const msgs = [
      { role: "system", content: "you are a helpful assistant" },
      { role: "user", content: "what is the weather" },
    ];
    const { safeMessages, found } = piiInputGuard(msgs);
    expect(found).toHaveLength(0);
    expect(safeMessages).toEqual(msgs);
  });

  test("user PII is redacted and reported", () => {
    const msgs = [
      { role: "user", content: "my email is alice@example.com please help" },
    ];
    const { safeMessages, found } = piiInputGuard(msgs);
    expect(safeMessages[0]?.content).toBe(
      "my email is [REDACTED_EMAIL] please help",
    );
    expect(found).toEqual([
      { kind: "email", originalIndex: 0, redactedCount: 1 },
    ]);
  });

  test("system message with PII is left untouched", () => {
    const msgs = [
      { role: "system", content: "contact: ops@example.com for alerts" },
      { role: "user", content: "ok" },
    ];
    const { safeMessages, found } = piiInputGuard(msgs);
    expect(safeMessages[0]?.content).toBe(
      "contact: ops@example.com for alerts",
    );
    expect(found).toHaveLength(0);
  });
});
