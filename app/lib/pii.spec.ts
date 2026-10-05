import { describe, expect, test } from "vitest";
import { detect, hasPII, redact } from "./pii";

describe("detect: email", () => {
  test("flags a plain email", () => {
    const r = detect("ping alice@example.com please");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "email", match: "alice@example.com" });
  });

  test("ignores an email inside a wikilink", () => {
    const r = detect("see [[contact alice@example.com for help]] today");
    expect(r.filter((m) => m.kind === "email")).toHaveLength(0);
  });

  test("ignores an email that is a JSON object key", () => {
    const json = '{"alice@example.com": "primary"}';
    const r = detect(json);
    expect(r.filter((m) => m.kind === "email")).toHaveLength(0);
  });

  test("still flags an email that is a JSON value", () => {
    const json = '{"owner": "alice@example.com"}';
    const r = detect(json);
    expect(r.filter((m) => m.kind === "email")).toHaveLength(1);
  });
});

describe("detect: phone", () => {
  test("US-formatted phone", () => {
    const r = detect("call (415) 555-0199 today");
    expect(r.find((m) => m.kind === "phone")?.match).toBe("(415) 555-0199");
  });

  test("E.164 phone", () => {
    const r = detect("intl line +14155550199");
    expect(r.find((m) => m.kind === "phone")?.match).toBe("+14155550199");
  });
});

describe("detect: ssn", () => {
  test("dashed SSN without context", () => {
    const r = detect("the number is 123-45-6789 for records");
    expect(r.find((m) => m.kind === "ssn")?.match).toBe("123-45-6789");
  });

  test("bare 9-digit WITH SSN context", () => {
    const r = detect("SSN: 123456789");
    expect(r.find((m) => m.kind === "ssn")?.match).toBe("123456789");
  });

  test("bare 9-digit WITHOUT context does not match as ssn", () => {
    const r = detect("account 123456789 was flagged");
    expect(r.find((m) => m.kind === "ssn")).toBeUndefined();
  });
});

describe("detect: credit card", () => {
  test("Luhn-valid 16-digit card matches", () => {
    // Valid test card number (Visa test).
    const r = detect("card 4111 1111 1111 1111 on file");
    const cc = r.find((m) => m.kind === "credit_card");
    expect(cc?.match).toBe("4111 1111 1111 1111");
  });

  test("Luhn-invalid 16-digit sequence does not match", () => {
    const r = detect("sequence 4111 1111 1111 1112 is bogus");
    expect(r.find((m) => m.kind === "credit_card")).toBeUndefined();
  });
});

describe("redact", () => {
  test("default replacement uses [REDACTED_<KIND>]", () => {
    const out = redact("email alice@example.com and SSN 123-45-6789");
    expect(out).toBe("email [REDACTED_EMAIL] and SSN [REDACTED_SSN]");
  });

  test("custom string replacement", () => {
    const out = redact("email alice@example.com", { replace: "***" });
    expect(out).toBe("email ***");
  });

  test("custom function replacement sees the kind", () => {
    const out = redact("email alice@example.com and 123-45-6789", {
      replace: (kind) => `<${kind}>`,
    });
    expect(out).toBe("email <email> and <ssn>");
  });

  test("no PII returns input unchanged", () => {
    const s = "hello world";
    expect(redact(s)).toBe(s);
  });
});

describe("hasPII", () => {
  test("true for text with email", () => {
    expect(hasPII("ping alice@example.com")).toBe(true);
  });
  test("false for clean text", () => {
    expect(hasPII("hello world")).toBe(false);
  });
});
