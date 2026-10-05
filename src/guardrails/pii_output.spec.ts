import { describe, expect, test } from "vitest";
import { piiOutputGuard } from "./pii_output";

describe("piiOutputGuard", () => {
  test("clean chunk is allowed", () => {
    expect(piiOutputGuard("the forecast is sunny")).toEqual({ safe: true });
  });

  test("SSN in chunk is blocked", () => {
    const r = piiOutputGuard("the SSN on file is 123-45-6789");
    expect(r.safe).toBe(false);
    expect(r.reason).toContain("ssn");
  });

  test("email in chunk is blocked", () => {
    const r = piiOutputGuard("reach out to alice@example.com");
    expect(r.safe).toBe(false);
    expect(r.reason).toContain("email");
  });
});
