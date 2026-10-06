// scripts/k6_latency.js
//
// K6 load test for the /api/chat SSE endpoint.
// Entry point: `make k6` -> `k6 run scripts/k6_latency.js`.
//
// HONEST CAVEAT (see _handoff/project-1-FINAL-plan.md §10 and README):
// The first request against a freshly idle Neon branch takes ~15s because
// Neon free-tier auto-suspends after 5 min. The k6 numbers quoted in the
// README are STEADY-STATE p95, measured AFTER a warm-up loop. The warm-up
// is the `setup()` stage below: it fires 3 single-VU requests sequentially
// to wake Neon + prime the Fly container + warm the OpenAI client pool.
// Only the main stages (ramp/hold/ramp-down) feed the thresholds.
//
// If you need cold-start numbers, run with K6_SKIP_WARMUP=1 and the first
// iteration's http_req_duration will dominate the p99 tail honestly.
//
// Env:
//   BASE_URL     default http://localhost:3000
//   JWT_TOKEN    optional; if set, sent as `Authorization: Bearer <token>`
//   K6_SKIP_WARMUP  if "1", skip the setup() warm-up phase

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// --- Config ---------------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const JWT_TOKEN = __ENV.JWT_TOKEN || '';
const SKIP_WARMUP = __ENV.K6_SKIP_WARMUP === '1';
const CHAT_PATH = '/api/chat';

// Realistic enterprise chat payloads; rotated per iteration.
const PROMPTS = [
  "What's the renewal date for the customer who filed ticket T-123?",
  'Can you look up the subscription status for customer id C-00042?',
  "What's our refund policy for annual plans?",
  'Show me the last 5 open tickets for acme-corp.',
  'Create a priority-high ticket: billing portal 500s on checkout.',
  'Escalate ticket T-998 to a human; customer is a VIP.',
  'Summarize the GDPR deletion policy from our knowledge base.',
  'What tools do you have access to?',
];

// Shape per /api/chat contract. conversationId is iteration-unique so the
// per-conversation cost ceiling does not bounce load mid-run.
function makePayload(prompt) {
  const conversationId = `k6-${__VU}-${__ITER}`;
  return { conversationId, messages: [{ role: 'user', content: prompt }] };
}

// --- Custom metrics -------------------------------------------------------

const chatLatency = new Trend('chat_latency_ms', true);
const sseFrameSeen = new Rate('sse_frame_seen');

// --- k6 options -----------------------------------------------------------

export const options = {
  // Ramp 1 -> 20 VUs over 30s, hold 20 for 2m, ramp down 30s. ~3 min total.
  stages: [
    { duration: '30s', target: 20 },
    { duration: '2m',  target: 20 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'http_req_duration': ['p(95)<3000'],
    'http_req_failed':   ['rate<0.01'],
    'sse_frame_seen':    ['rate>0.95'],
  },
  // Discard body in default metrics; we read it ourselves for the SSE check.
  discardResponseBodies: false,
};

// --- Helpers --------------------------------------------------------------

function headers() {
  const h = { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' };
  if (JWT_TOKEN) h['Authorization'] = `Bearer ${JWT_TOKEN}`;
  return h;
}

function postChat(payload) {
  // k6's http.post is synchronous and buffers the full response body, which
  // for an SSE endpoint is the concatenation of all `data: ...` frames. Good
  // enough for an end-to-end latency check; we're not measuring time-to-first
  // -byte, we're measuring full-response time which is the user-perceived
  // metric for a chat turn.
  // ponytail: synchronous full-body read; swap to http.asyncRequest + stream
  // parsing if we need TTFB.
  return http.post(`${BASE_URL}${CHAT_PATH}`, JSON.stringify(payload), {
    headers: headers(),
    timeout: '30s',
  });
}

// --- Lifecycle ------------------------------------------------------------

export function setup() {
  if (SKIP_WARMUP) {
    console.log('[k6_latency] warm-up skipped (K6_SKIP_WARMUP=1)');
    return {};
  }
  console.log(`[k6_latency] warming up ${BASE_URL}${CHAT_PATH} (3 sequential requests)...`);
  for (let i = 0; i < 3; i++) {
    const r = postChat(makePayload(PROMPTS[i % PROMPTS.length]));
    console.log(`[k6_latency] warmup ${i + 1}/3: status=${r.status} dur=${r.timings.duration.toFixed(0)}ms`);
  }
  return {};
}

export default function () {
  const payload = makePayload(randomItem(PROMPTS));
  const res = postChat(payload);

  const bodyHasContent = typeof res.body === 'string' && res.body.includes('content');
  sseFrameSeen.add(bodyHasContent ? 1 : 0);
  chatLatency.add(res.timings.duration);

  check(res, {
    'status is 200':      (r) => r.status === 200,
    'duration < 3000ms':  (r) => r.timings.duration < 3000,
    'body has content':   () => bodyHasContent,
  });

  // Small think time so we don't look like a DDoS. Not scientific.
  sleep(0.5);
}

// --- Summary --------------------------------------------------------------

export function handleSummary(data) {
  const d = data.metrics.http_req_duration?.values || {};
  const f = data.metrics.http_req_failed?.values || {};
  const sse = data.metrics.sse_frame_seen?.values || {};

  const row = (label, v) => `  ${label.padEnd(12)} ${v}`;
  const num = (v, suffix = 'ms') =>
    v === undefined || v === null ? 'n/a' : `${Number(v).toFixed(1)}${suffix}`;

  const table = [
    '',
    '  === steady-state latency ===',
    row('p50',  num(d['p(50)'])),
    row('p95',  num(d['p(95)'])),
    row('p99',  num(d['p(99)'])),
    row('avg',  num(d.avg)),
    row('max',  num(d.max)),
    row('err rate', num((f.rate || 0) * 100, '%')),
    row('sse hit',  num((sse.rate || 0) * 100, '%')),
    '',
  ].join('\n');

  return {
    'stdout': table + '\n',
    'scripts/k6_latency.json': JSON.stringify({
      base_url: BASE_URL,
      p50_ms: d['p(50)'] ?? null,
      p95_ms: d['p(95)'] ?? null,
      p99_ms: d['p(99)'] ?? null,
      avg_ms: d.avg ?? null,
      max_ms: d.max ?? null,
      err_rate: f.rate ?? null,
      sse_frame_rate: sse.rate ?? null,
      iterations: data.metrics.iterations?.values?.count ?? null,
      vus_max: data.metrics.vus_max?.values?.max ?? null,
      measured_at: new Date().toISOString(),
    }, null, 2),
  };
}
