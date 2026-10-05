// Keeps a Neon branch warm by issuing a 1ms SELECT every N seconds.
// Optional — only wire via cron if the free-tier cold-start caveat in README
// is unacceptable for the demo window. Documented, not default.
//
// Usage:
//   DATABASE_URL=... INTERVAL_SEC=240 pnpm tsx scripts/warm_neon.ts
//
// Default interval is 240s (4 min) because Neon auto-suspends after 5 min idle.
// 240s gives a 60s margin before suspend.

import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
const INTERVAL_SEC = Number(process.env.INTERVAL_SEC ?? 240);

if (!DATABASE_URL) {
  console.error("warm_neon: DATABASE_URL not set, exiting");
  process.exit(2);
}

async function ping(): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  console.log(`warm_neon: pinging every ${INTERVAL_SEC}s`);
  for (;;) {
    const t0 = Date.now();
    try {
      await ping();
      console.log(`warm_neon: ok (${Date.now() - t0}ms)`);
    } catch (err) {
      console.error(`warm_neon: failed`, err);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_SEC * 1000));
  }
}

void main();
