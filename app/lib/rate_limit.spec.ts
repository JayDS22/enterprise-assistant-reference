import { beforeEach, describe, expect, test } from "vitest";
import {
  _resetForTests,
  _setForTests,
  checkAndConsume,
} from "./rate_limit";

describe("rate_limit token bucket", () => {
  beforeEach(() => {
    _resetForTests();
    _setForTests({ rpm: 60, burst: 5 });
  });

  test("allows up to burst requests on a fresh bucket", () => {
    // Arrange
    const now = 1_000_000;

    // Act
    const results = Array.from({ length: 5 }, () => checkAndConsume("tenantA", now));

    // Assert
    expect(results.every((r) => r.allowed)).toBe(true);
    expect(results[4]!.remaining).toBe(0);
  });

  test("rejects the burst+1 request with retry_after_ms close to 1s at 60rpm", () => {
    // Arrange
    const now = 2_000_000;
    for (let i = 0; i < 5; i++) checkAndConsume("tenantA", now);

    // Act
    const rejected = checkAndConsume("tenantA", now);

    // Assert
    expect(rejected.allowed).toBe(false);
    expect(rejected.retry_after_ms).toBe(1000);
    expect(rejected.remaining).toBe(0);
  });

  test("refills tokens over simulated elapsed time and allows again", () => {
    // Arrange: drain the bucket at t0
    const t0 = 3_000_000;
    for (let i = 0; i < 5; i++) checkAndConsume("tenantA", t0);
    expect(checkAndConsume("tenantA", t0).allowed).toBe(false);

    // Act: 3 seconds later at 60rpm = 3 refilled tokens
    const t1 = t0 + 3_000;
    const r1 = checkAndConsume("tenantA", t1);
    const r2 = checkAndConsume("tenantA", t1);
    const r3 = checkAndConsume("tenantA", t1);
    const r4 = checkAndConsume("tenantA", t1);

    // Assert: 3 allowed, 4th rejected
    expect([r1.allowed, r2.allowed, r3.allowed]).toEqual([true, true, true]);
    expect(r4.allowed).toBe(false);
  });

  test("caps refill at the burst ceiling", () => {
    // Arrange: consume one token at t0
    const t0 = 4_000_000;
    checkAndConsume("tenantA", t0);

    // Act: fast-forward 10 minutes — way more than burst/rpm can refill
    const tFar = t0 + 10 * 60_000;
    const results = Array.from({ length: 6 }, () => checkAndConsume("tenantA", tFar));

    // Assert: exactly burst (5) allowed, 6th rejected
    expect(results.filter((r) => r.allowed).length).toBe(5);
    expect(results[5]!.allowed).toBe(false);
  });

  test("tracks each tenant independently", () => {
    // Arrange
    const now = 5_000_000;
    for (let i = 0; i < 5; i++) checkAndConsume("tenantA", now);

    // Act
    const bFirst = checkAndConsume("tenantB", now);
    const aNext = checkAndConsume("tenantA", now);

    // Assert
    expect(bFirst.allowed).toBe(true);
    expect(aNext.allowed).toBe(false);
  });

  test("_resetForTests clears buckets and config overrides", () => {
    // Arrange
    _setForTests({ rpm: 60, burst: 2 });
    checkAndConsume("tenantA");
    checkAndConsume("tenantA");
    expect(checkAndConsume("tenantA").allowed).toBe(false);

    // Act
    _resetForTests();
    _setForTests({ rpm: 60, burst: 2 });

    // Assert: fresh bucket, allowed again
    expect(checkAndConsume("tenantA").allowed).toBe(true);
  });
});
