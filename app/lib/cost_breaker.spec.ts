import { beforeEach, describe, expect, test } from "vitest";
import {
  _resetForTests,
  _setForTests,
  checkAndRecord,
} from "./cost_breaker";

describe("cost_breaker two-level ceiling", () => {
  beforeEach(() => {
    _resetForTests();
    _setForTests({ perConversation: 0.5, perTenantDay: 2.0 });
  });

  test("allows a request under both caps and returns cumulative", () => {
    // Arrange + Act
    const r = checkAndRecord({ tenantId: "A", conversationId: "c1", usd: 0.1 });

    // Assert
    expect(r.allowed).toBe(true);
    expect(r.cumulative).toEqual({ conversation_usd: 0.1, tenant_day_usd: 0.1 });
  });

  test("rejects with per_conversation reason when conversation cap would be exceeded", () => {
    // Arrange: pile up to 0.4
    checkAndRecord({ tenantId: "A", conversationId: "c1", usd: 0.4 });

    // Act: another 0.2 would push conversation to 0.6 > 0.5
    const r = checkAndRecord({ tenantId: "A", conversationId: "c1", usd: 0.2 });

    // Assert
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("per_conversation");
    expect(r.cumulative.conversation_usd).toBe(0.4);
  });

  test("rejects with per_tenant_day reason when daily cap would be exceeded", () => {
    // Arrange: spread across 5 conversations to avoid per-conv cap: 5 * 0.4 = 2.0
    for (let i = 0; i < 5; i++) {
      checkAndRecord({ tenantId: "A", conversationId: `c${i}`, usd: 0.4 });
    }

    // Act: 0.1 more pushes tenant-day to 2.1 > 2.0
    const r = checkAndRecord({ tenantId: "A", conversationId: "c-new", usd: 0.1 });

    // Assert
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("per_tenant_day");
    expect(r.cumulative.tenant_day_usd).toBeCloseTo(2.0, 5);
  });

  test("counters remain intact after a rejected request", () => {
    // Arrange
    checkAndRecord({ tenantId: "A", conversationId: "c1", usd: 0.4 });

    // Act: rejection
    checkAndRecord({ tenantId: "A", conversationId: "c1", usd: 0.5 });
    // Next legitimate small charge should still succeed and stack on 0.4, not 0.9
    const r = checkAndRecord({ tenantId: "A", conversationId: "c1", usd: 0.05 });

    // Assert
    expect(r.allowed).toBe(true);
    expect(r.cumulative.conversation_usd).toBeCloseTo(0.45, 5);
  });

  test("tracks per-conversation counters independently", () => {
    // Arrange
    checkAndRecord({ tenantId: "A", conversationId: "c1", usd: 0.4 });

    // Act: a different conversation under the same tenant
    const r = checkAndRecord({ tenantId: "A", conversationId: "c2", usd: 0.4 });

    // Assert
    expect(r.allowed).toBe(true);
    expect(r.cumulative.conversation_usd).toBe(0.4);
    expect(r.cumulative.tenant_day_usd).toBeCloseTo(0.8, 5);
  });

  test("tracks tenant-day counters independently across tenants", () => {
    // Arrange: tenant A near its daily cap
    for (let i = 0; i < 5; i++) {
      checkAndRecord({ tenantId: "A", conversationId: `a${i}`, usd: 0.4 });
    }

    // Act: tenant B should be unaffected
    const r = checkAndRecord({ tenantId: "B", conversationId: "b1", usd: 0.4 });

    // Assert
    expect(r.allowed).toBe(true);
    expect(r.cumulative.tenant_day_usd).toBe(0.4);
  });

  test("_resetForTests clears both counters and overrides", () => {
    // Arrange
    checkAndRecord({ tenantId: "A", conversationId: "c1", usd: 0.4 });

    // Act
    _resetForTests();
    _setForTests({ perConversation: 0.5, perTenantDay: 2.0 });
    const r = checkAndRecord({ tenantId: "A", conversationId: "c1", usd: 0.4 });

    // Assert: fresh — new 0.4 recorded, not stacked on previous
    expect(r.allowed).toBe(true);
    expect(r.cumulative.conversation_usd).toBe(0.4);
  });
});
