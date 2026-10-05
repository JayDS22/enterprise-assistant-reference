import { test, expect } from "@playwright/test";

// Playwright E2E for the chat flow. Runs against a live Next dev server with
// a seeded Postgres. Skipped by default via the TEST_LIVE env guard so
// `npx playwright test` in CI without a running stack reports skipped, not
// red. Run locally with:
//   TEST_LIVE=1 BASE_URL=http://localhost:3000 JWT_TOKEN=<signed> \
//     npx playwright test tests/e2e/chat.spec.ts

const SKIP = !process.env.TEST_LIVE;

test.describe("chat flow", () => {
  test.skip(SKIP, "set TEST_LIVE=1 + BASE_URL + JWT_TOKEN to enable");

  test("renders chat page with tenant header", async ({ page }) => {
    await page.addInitScript((token) => {
      window.localStorage.setItem("jwt_token", token);
    }, process.env.JWT_TOKEN!);
    await page.goto(process.env.BASE_URL ?? "http://localhost:3000");
    await expect(page.getByText(/tenant:/i)).toBeVisible();
  });

  test("sends a message and receives a streamed reply", async ({ page }) => {
    await page.addInitScript((token) => {
      window.localStorage.setItem("jwt_token", token);
    }, process.env.JWT_TOKEN!);
    await page.goto(process.env.BASE_URL ?? "http://localhost:3000");

    const input = page.getByRole("textbox");
    await input.fill("What is the renewal date for customer cust-A-00001?");
    await page.getByRole("button", { name: /send/i }).click();

    // Wait for the first streamed assistant frame.
    const reply = page.locator('[data-role="assistant"]').first();
    await expect(reply).toBeVisible({ timeout: 10_000 });
  });

  test("tenant isolation: A cannot read B's rows", async ({ page, request }) => {
    // Direct API probe with a tenant-A JWT; response must not contain any
    // customer id starting with "cust-B-".
    const res = await request.post(
      (process.env.BASE_URL ?? "http://localhost:3000") + "/api/chat",
      {
        headers: { Authorization: `Bearer ${process.env.JWT_TOKEN}` },
        data: {
          conversationId: "e2e-tenancy-probe",
          messages: [{ role: "user", content: "List all customers you can see." }],
        },
      },
    );
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).not.toMatch(/cust-B-\d+/);
    expect(body).not.toMatch(/cust-C-\d+/);
  });
});
