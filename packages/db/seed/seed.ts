/**
 * Seed script for enterprise-assistant-reference per FINAL plan §3 (seed section).
 *
 * Idempotent: TRUNCATEs data tables then re-seeds. `tenants` is dropped+recreated
 * instead of truncated because `TRUNCATE ... CASCADE` on `tenants` would also wipe
 * `audit_log` / `cost_rollup_daily` which the plan requires preserved as empty.
 *
 * Volume (per plan):
 *   3 tenants: A (~5000 cust), B (~3500), C (~1500) — enterprise skew, not even
 *   10,000 customers · 40,000 tickets · 500 docs (200 A / 180 B / 120 C) · 4,000 subs
 *
 * Perf: COPY FROM STDIN for the big three (customers, tickets, docs).
 *   embedding stays NULL (day-6 backfill).
 *
 * Flags: --dry-run exits before touching DB. Also fires if DATABASE_URL is unset.
 *
 * ponytail: inlined doc generation + seed in one file. Keeps blast radius small
 *   and the whole flow readable top-to-bottom. Split only if docs/ generation
 *   grows past a few hundred lines of templates.
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Readable, pipeline } from "node:stream";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pipelineP = promisify(pipeline);

// ---------- Config ----------

// ESNext module → no __dirname; derive it from import.meta.url.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOCS_DIR = path.join(__dirname, "docs");

type TenantId = "A" | "B" | "C";

const TENANTS: Array<{ id: TenantId; name: string; customers: number; docs: number }> = [
  { id: "A", name: "Acme Industrial", customers: 5000, docs: 200 },
  { id: "B", name: "Bluewave Logistics", customers: 3500, docs: 180 },
  { id: "C", name: "Cedar Analytics", customers: 1500, docs: 120 },
];

const TICKETS_TOTAL = 40_000;
const SUBS_TOTAL = 4_000;

const TICKET_CATEGORIES = [
  "billing", "access", "outage", "data_export", "onboarding",
  "feature_request", "bug_report", "security", "integration", "upgrade",
  "downgrade", "cancellation", "refund", "performance", "documentation",
];

// Weighted picks via cumulative buckets. Deterministic given the seeded RNG.
const STATUS_BUCKETS: Array<[string, number]> = [
  ["resolved", 0.50], ["closed", 0.75], ["open", 0.95], ["pending", 1.00],
];
const PRIORITY_BUCKETS: Array<[string, number]> = [
  ["normal", 0.60], ["low", 0.85], ["high", 0.95], ["urgent", 1.00],
];
const PLAN_BUCKETS: Array<[string, number]> = [
  ["starter", 0.40], ["pro", 0.75], ["enterprise", 0.95], ["trial", 1.00],
];
const SUB_STATUS_BUCKETS: Array<[string, number]> = [
  ["active", 0.85], ["trialing", 0.92], ["past_due", 0.97], ["cancelled", 1.00],
];

// ---------- Deterministic RNG (mulberry32) ----------
// ponytail: inline rng, no `seedrandom` dep. One function, deterministic output.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0xC0FFEE);

function pickBucket<T extends string>(buckets: Array<[T, number]>): T {
  const r = rand();
  for (const [v, p] of buckets) if (r <= p) return v;
  return buckets[buckets.length - 1][0];
}

function randInt(lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

// ---------- Doc generation ----------
// Builds 500 real markdown files under docs/. Vary by type; some near-dup across
// tenants (refund_policy, data_retention_policy) for eval §5.7 cross-tenant leak.

type DocSpec = {
  slug: string;
  type: "policy" | "procedure" | "reference" | "faq" | "troubleshooting";
  title: string;
  // paragraphs: array of paragraph templates. {tenant}, {other} get replaced.
  paras: string[];
  shared?: boolean; // appears per tenant with slight variation
};

function buildDocCatalog(): DocSpec[] {
  // Shared across all 3 tenants (near-dup eval signal)
  const shared: DocSpec[] = [
    {
      slug: "refund_policy", type: "policy", shared: true,
      title: "Refund Policy",
      paras: [
        "This document defines how {tenant} handles refund requests across our subscription tiers.",
        "Monthly plans are refundable within 14 days of charge, pro-rated by unused days. Annual plans are refundable only within the first 30 days and are non-refundable afterward except where required by local law.",
        "Enterprise contracts follow the refund terms negotiated in the master services agreement. See [[billing_dispute_runbook]] for the escalation path.",
        "Refunds are issued to the original payment method within 5-10 business days. Store credit is offered as an alternative when the original card is no longer valid.",
        "Partial refunds are available for downgrades mid-cycle, calculated as (days remaining / days in cycle) * plan delta. Chargeback disputes bypass this policy and are handled by the finance team directly.",
      ],
    },
    {
      slug: "data_retention_policy", type: "policy", shared: true,
      title: "Data Retention Policy",
      paras: [
        "{tenant} retains customer production data for the duration of the active subscription plus 90 days after cancellation.",
        "After the 90-day grace period, all production data is purged from primary stores and derived indexes. Backups are retained encrypted for an additional 180 days then rotated out.",
        "Audit logs are retained for 7 years to meet SOC 2 and regional compliance requirements. See [[acceptable_use_policy]] and [[data_export_sop]] for related procedures.",
        "Deletion requests under GDPR Article 17 are honored within 30 days. The deletion endpoint cascades across tickets, subscriptions, and knowledge base contributions tied to the subject.",
      ],
    },
    {
      slug: "acceptable_use_policy", type: "policy", shared: true,
      title: "Acceptable Use Policy",
      paras: [
        "Users of {tenant}'s services agree not to use the platform to transmit unlawful, infringing, or harmful content.",
        "Rate limits apply per the published [[api_rate_limits]] document. Sustained abuse of the API triggers automated throttling and may lead to account suspension.",
        "Attempts to probe, scan, or test the vulnerability of the system are prohibited unless performed under a signed penetration-testing agreement. Reports of security issues should follow [[incident_response_runbook]].",
      ],
    },
  ];

  // Tenant-unique docs. Mix of all 5 types. Content varies by slug.
  const unique: Array<Omit<DocSpec, "shared">> = [
    // Policy
    { slug: "bcp_policy", type: "policy", title: "Business Continuity Policy", paras: [
      "{tenant} maintains a documented business continuity plan reviewed annually.",
      "Primary systems replicate to a secondary region with an RPO of 15 minutes and an RTO of 4 hours.",
      "Tabletop exercises are conducted twice yearly. Postmortems from live incidents feed back into this policy. See [[incident_response_runbook]].",
    ]},
    { slug: "byod_policy", type: "policy", title: "Bring Your Own Device Policy", paras: [
      "{tenant} permits employee-owned devices to access company resources under MDM enrollment.",
      "Devices must have full-disk encryption, a passcode, and automatic updates enabled. Jailbroken or rooted devices are blocked by the conditional access policy.",
      "Lost or stolen devices must be reported within 24 hours. Remote wipe may be initiated for the corporate container only; personal data is left intact.",
    ]},
    { slug: "privacy_policy", type: "policy", title: "Privacy Policy", paras: [
      "{tenant} collects only the data necessary to operate the service: account identifiers, usage telemetry, and support content submitted by the user.",
      "We do not sell personal information. Third-party processors are limited to infrastructure (hosting, email delivery, error monitoring) and are bound by DPAs.",
      "Subjects may exercise GDPR / CCPA rights via the in-app privacy center or by emailing privacy@{tenant_slug}.example. See [[data_retention_policy]] for retention windows.",
    ]},
    { slug: "vendor_security_policy", type: "policy", title: "Vendor Security Review", paras: [
      "All new third-party vendors handling production data at {tenant} undergo a security review before contracting.",
      "The review covers SOC 2 Type II attestation, data residency, subprocessor list, and incident notification SLAs.",
      "Reviews are refreshed annually or on material change (ownership, security posture, scope). The vendor registry is owned by the security team.",
    ]},
    { slug: "sla_terms", type: "policy", title: "Service Level Agreement", paras: [
      "{tenant} commits to 99.9% monthly uptime for paid customers, measured end-to-end from the public API edge.",
      "Scheduled maintenance announced at least 72 hours in advance is excluded from the SLA calculation. Unplanned degradation is credited at 10% of monthly fee per hour of downtime, capped at one month's fee.",
      "Credits are applied automatically within one billing cycle; see [[refund_policy]] for refund mechanics.",
    ]},
    // Procedure
    { slug: "onboarding_checklist", type: "procedure", title: "Customer Onboarding Checklist", paras: [
      "This checklist walks a new {tenant} customer through first-week activation.",
      "Day 1: workspace provisioning, admin invite, SSO configuration (see [[sso_setup]]).",
      "Day 2-3: API key issuance, webhook subscription, sample data import. Validate webhook signatures per [[webhook_signature_validation]].",
      "Day 4-5: user training session, success-criteria review, 30-day check-in scheduled.",
    ]},
    { slug: "offboarding_checklist", type: "procedure", title: "Customer Offboarding Checklist", paras: [
      "On churn or non-renewal, the account manager drives the {tenant} offboarding checklist.",
      "Step 1: export customer data (JSON + CSV per [[data_export_sop]]). Step 2: revoke all API keys and OAuth integrations. Step 3: confirm final invoice settlement.",
      "Step 4: start the 90-day retention clock per [[data_retention_policy]]. Step 5: schedule a 7-day post-churn exit interview if the customer agrees.",
    ]},
    { slug: "incident_response_runbook", type: "procedure", title: "Incident Response Runbook", paras: [
      "When an incident is declared at {tenant}, the on-call engineer owns coordination until a formal incident commander is appointed.",
      "Severity classification: SEV-1 (full outage or data integrity risk), SEV-2 (major feature degraded), SEV-3 (minor degradation, workaround exists), SEV-4 (cosmetic).",
      "SEV-1 and SEV-2 require status page updates within 15 minutes and 30 minutes respectively. All incidents produce a written postmortem within 5 business days.",
    ]},
    { slug: "data_export_sop", type: "procedure", title: "Data Export Standard Operating Procedure", paras: [
      "{tenant} customers can request a full data export from the account settings page.",
      "Exports include customers, tickets, subscriptions, and knowledge base documents owned by the requesting tenant. Nothing from other tenants is included; row-level security guarantees this at the DB layer.",
      "The export job runs asynchronously and emails a signed download URL to the account admin on completion. URLs expire after 24 hours.",
    ]},
    { slug: "billing_dispute_runbook", type: "procedure", title: "Billing Dispute Runbook", paras: [
      "A billing dispute at {tenant} is any customer-raised challenge to a specific line item on an invoice.",
      "Step 1: acknowledge receipt within 1 business day. Step 2: pull the audit trail for the disputed charges from the audit log. Step 3: compare against the usage report and apply [[refund_policy]] if applicable.",
      "Chargebacks received from the card network bypass this flow and are handled by finance; the account is paused pending resolution.",
    ]},
    { slug: "key_rotation_procedure", type: "procedure", title: "API Key Rotation Procedure", paras: [
      "{tenant} enforces rotation of production API keys every 180 days.",
      "The old key continues to function for a 7-day grace window after rotation to allow phased migration. Deprecation emails are sent 14 days and 24 hours before expiry.",
      "Rotation is initiated from the admin console. See [[sso_setup]] for the related SSO signing-key rotation (different cadence).",
    ]},
    // Reference
    { slug: "api_rate_limits", type: "reference", title: "API Rate Limits", paras: [
      "{tenant}'s API enforces per-tenant rate limits via a token-bucket algorithm.",
      "Starter plans: 60 requests/minute burst, 2000 requests/hour sustained. Pro plans: 300/min burst, 10000/hr sustained. Enterprise plans are negotiated and typically start at 1000/min burst.",
      "Exceeding the limit returns HTTP 429 with a Retry-After header. Clients should implement exponential backoff; see [[webhook_signature_validation]] for related client-side best practices.",
    ]},
    { slug: "sso_setup", type: "reference", title: "SSO Setup Guide", paras: [
      "{tenant} supports SAML 2.0 and OIDC for enterprise customers.",
      "The admin creates an SSO application in their identity provider (Okta, Azure AD, Google Workspace, generic SAML), uploads the metadata XML to {tenant}'s admin console, and maps attribute claims to tenant roles.",
      "SCIM 2.0 is available on the Enterprise plan for automated user provisioning. The signing certificate rotates every 2 years with a 90-day overlap window.",
    ]},
    { slug: "webhook_signature_validation", type: "reference", title: "Webhook Signature Validation", paras: [
      "{tenant} signs outbound webhooks with HMAC-SHA256 using a secret shared at subscription creation.",
      "Receivers compute the HMAC of the raw request body with the shared secret and compare it against the X-{tenant_slug}-Signature header in constant time to prevent timing attacks.",
      "The X-{tenant_slug}-Timestamp header is included to allow replay-window enforcement (recommended: reject requests older than 5 minutes).",
    ]},
    { slug: "pricing_breakdown", type: "reference", title: "Pricing Breakdown", paras: [
      "{tenant} offers four tiers: Trial (14 days, no card), Starter ($29/mo), Pro ($149/mo), Enterprise (contact sales).",
      "Starter includes 3 seats, 2k API calls/day, email support. Pro includes 10 seats, 20k API calls/day, priority support, and SSO. Enterprise adds SCIM, audit log export, and a dedicated TAM.",
      "Annual billing receives a 2-month discount. See [[refund_policy]] and [[sla_terms]] for related terms.",
    ]},
    { slug: "integration_catalog", type: "reference", title: "Integration Catalog", paras: [
      "{tenant}'s native integrations include Slack, Microsoft Teams, Jira, Zendesk, HubSpot, Salesforce, and PagerDuty.",
      "Each integration is installed from the admin console. OAuth-based integrations use short-lived tokens with refresh rotation. API-key-based integrations rotate on the [[key_rotation_procedure]] schedule.",
      "Custom integrations build against the public API; see [[api_rate_limits]] for the quotas that apply.",
    ]},
    // FAQ
    { slug: "faq_billing", type: "faq", title: "Frequently Asked Questions: Billing", paras: [
      "Q: When is my card charged? A: Monthly plans charge on the anniversary of signup. Annual plans charge up front at renewal.",
      "Q: Can I change my plan mid-cycle? A: Yes. Upgrades prorate immediately; downgrades take effect at the next renewal. See [[refund_policy]].",
      "Q: Why does my invoice show a different currency? A: {tenant} bills in your account's configured currency. FX conversion happens at the card network's rate, not ours.",
    ]},
    { slug: "faq_security", type: "faq", title: "Frequently Asked Questions: Security", paras: [
      "Q: Is my data encrypted? A: Yes. At rest with AES-256, in transit with TLS 1.3. {tenant} holds SOC 2 Type II and ISO 27001.",
      "Q: Who can access my data? A: Only authorized personnel for support and infrastructure maintenance, and only with your approval or in response to a legal process. All access is logged in the audit log.",
      "Q: Can I bring my own encryption key? A: Enterprise plans support BYOK via AWS KMS or GCP KMS. Standard plans use {tenant}-managed keys.",
    ]},
    { slug: "faq_account", type: "faq", title: "Frequently Asked Questions: Account", paras: [
      "Q: How do I invite a teammate? A: Admin > Users > Invite. The invitee gets a signup link valid for 7 days.",
      "Q: How do I enable SSO? A: Follow [[sso_setup]]. SSO is available on Pro and Enterprise plans.",
      "Q: How do I close my account? A: Contact support. We will run the [[offboarding_checklist]] and start the retention clock per [[data_retention_policy]].",
    ]},
    // Troubleshooting
    { slug: "troubleshoot_login", type: "troubleshooting", title: "Troubleshooting: Login Issues", paras: [
      "If you cannot log in to {tenant}, start by confirming you are using the correct workspace URL.",
      "Common causes: SSO signing certificate expired (admin regenerates in the IdP), password reset email filtered by spam (check junk folder), workspace suspended due to overdue invoice (see [[billing_dispute_runbook]]).",
      "If MFA is misconfigured, admins can issue a one-time recovery code from the admin console. The recovery code is single-use and expires in 15 minutes.",
    ]},
    { slug: "troubleshoot_api_errors", type: "troubleshooting", title: "Troubleshooting: API Errors", paras: [
      "{tenant}'s API returns standard HTTP status codes. 401 indicates an invalid or expired API key; rotate via the admin console (see [[key_rotation_procedure]]).",
      "429 indicates rate-limit saturation; refer to [[api_rate_limits]] and implement exponential backoff. 5xx indicates a server-side issue; retry with jitter and check the status page.",
      "Validation errors (400) include a machine-readable error code in the response body. Match on the code, not the English message, since messages may be localized.",
    ]},
    { slug: "troubleshoot_webhooks", type: "troubleshooting", title: "Troubleshooting: Webhook Delivery", paras: [
      "{tenant} retries failed webhook deliveries with exponential backoff for up to 24 hours.",
      "Common failure modes: receiver timeout (bump to >10s), signature mismatch (confirm raw body is used in HMAC, not re-serialized JSON — see [[webhook_signature_validation]]), TLS failure (ensure the receiver's cert chain is complete).",
      "Delivery logs are visible in the admin console under Integrations > Webhooks. Each attempt records the response status, response body (first 1KB), and timing.",
    ]},
    { slug: "troubleshoot_export", type: "troubleshooting", title: "Troubleshooting: Data Export Fails", paras: [
      "If a data export job never completes at {tenant}, check the admin console for the job's status.",
      "Jobs can stall if the source dataset exceeds 10GB; in that case the job is split into chunked exports delivered as separate downloads. Contact support if chunks are missing.",
      "The download URL is signed and expires after 24 hours. Re-trigger the export job if the URL has lapsed; see [[data_export_sop]] for the full procedure.",
    ]},
  ];

  // We have 3 shared + 20 unique = 23 base specs. Need 500 total = 200+180+120.
  // Expand per tenant by generating variant docs (department-scoped versions of
  // policies/procedures) until each tenant hits its target count.

  const departments = [
    "engineering", "sales", "support", "finance", "legal", "hr", "it",
    "marketing", "product", "security", "compliance", "operations",
  ];

  const result: DocSpec[] = [];

  // 1. All 3 shared docs appear once per tenant (handled in writeDocs by prefix).
  for (const d of shared) result.push(d);

  // 2. All 20 unique docs appear once per tenant.
  for (const d of unique) result.push({ ...d });

  // Target counts per tenant: 200/180/120. Shared(3) + unique(20) = 23 base per tenant.
  // Need to generate: A=177, B=157, C=97 department-scoped variants.
  // These are returned as a flat per-tenant catalog via buildPerTenantDocs below.
  return result;
}

async function writeDocs(): Promise<Array<{ tenant: TenantId; id: string; slug: string; title: string; body: string }>> {
  await mkdir(DOCS_DIR, { recursive: true });

  const base = buildDocCatalog();
  const departments = [
    "engineering", "sales", "support", "finance", "legal", "hr", "it",
    "marketing", "product", "security", "compliance", "operations",
  ];
  const docTypes: DocSpec["type"][] = ["policy", "procedure", "reference", "faq", "troubleshooting"];

  type OutDoc = { tenant: TenantId; id: string; slug: string; title: string; body: string };
  const out: OutDoc[] = [];
  let seq = 0;

  for (const t of TENANTS) {
    const target = t.docs;
    // Base catalog applied to this tenant.
    for (const d of base) {
      if (out.filter((o) => o.tenant === t.id).length >= target) break;
      const body = renderDoc(d, t);
      const filename = `${t.id}_${d.slug}.md`;
      await writeFile(path.join(DOCS_DIR, filename), body, "utf8");
      out.push({ tenant: t.id, id: `doc-${t.id}-${String(++seq).padStart(5, "0")}`, slug: d.slug, title: `${d.title} (${t.name})`, body });
    }
    // Fill the rest with department-scoped variants.
    let v = 0;
    while (out.filter((o) => o.tenant === t.id).length < target) {
      const dept = departments[v % departments.length];
      const typ = docTypes[v % docTypes.length];
      const slug = `${dept}_${typ}_v${Math.floor(v / docTypes.length) + 1}`;
      const title = `${dept[0].toUpperCase()}${dept.slice(1)} ${typ.replace("_", " ")} v${Math.floor(v / docTypes.length) + 1}`;
      const spec = synthDoc(slug, title, typ, dept);
      const body = renderDoc(spec, t);
      const filename = `${t.id}_${slug}.md`;
      await writeFile(path.join(DOCS_DIR, filename), body, "utf8");
      out.push({ tenant: t.id, id: `doc-${t.id}-${String(++seq).padStart(5, "0")}`, slug, title: `${title} (${t.name})`, body });
      v++;
    }
  }
  return out;
}

function renderDoc(spec: DocSpec, t: { id: TenantId; name: string }): string {
  const tenant_slug = t.name.toLowerCase().replace(/\s+/g, "");
  const paras = spec.paras.map((p) =>
    p.replace(/\{tenant\}/g, t.name).replace(/\{tenant_slug\}/g, tenant_slug),
  );
  const header = `# ${spec.title}\n\n_Tenant: ${t.name} (\`${t.id}\`) · Type: ${spec.type}_\n\n`;
  return header + paras.join("\n\n") + "\n";
}

function synthDoc(slug: string, title: string, type: DocSpec["type"], dept: string): DocSpec {
  // 6-7 paragraphs → ~250-400 word synthesized body. One wikilink per doc.
  const paras: string[] = [];
  const refs = ["refund_policy", "data_retention_policy", "acceptable_use_policy", "api_rate_limits", "incident_response_runbook"];
  const ref = refs[Math.floor(rand() * refs.length)];
  switch (type) {
    case "policy":
      paras.push(
        `{tenant}'s ${dept} organization maintains this policy to govern day-to-day decisions within the function. It applies to work performed in the office, remotely, or on behalf of {tenant} through third parties.`,
        `Scope: all ${dept} employees, contractors, and vendors acting on {tenant}'s behalf. Exceptions require written approval from the department head and the compliance team. Approved exceptions are time-boxed and logged in the exceptions registry with a quarterly review date.`,
        `Compliance is monitored through quarterly audits. Findings are logged, tracked to remediation, and reviewed at the department operating meeting. Repeat findings within the same calendar year are escalated to the executive sponsor. See [[${ref}]] for cross-cutting rules.`,
        `Training on this policy is mandatory on hire and on material revision. Completion is recorded in the learning management system. Managers verify completion before granting access to the production tooling associated with the ${dept} function.`,
        `Reporting a violation: contact the ${dept} compliance lead or the anonymous ethics hotline. Retaliation against good-faith reporters is itself a violation. Investigation outcomes are shared with the reporter unless the matter involves personnel confidentiality.`,
        `This policy is reviewed annually or on material change in regulation, tooling, or organizational structure. The current version supersedes all prior drafts circulated internally. Prior versions remain accessible in the policy archive for audit purposes.`,
      );
      break;
    case "procedure":
      paras.push(
        `This procedure describes how {tenant}'s ${dept} team executes the recurring workflow for its area of responsibility. It is designed to produce consistent outcomes regardless of the specific individual performing the work.`,
        `Preconditions: access to the primary tooling for the function, up-to-date training records, and acknowledgment of [[${ref}]]. If any precondition is unmet, the request is parked and the owner notified rather than attempted with partial authority.`,
        `Steps: (1) intake the request through the shared queue and assign a tracking identifier; (2) triage against the published SLAs and set the response clock; (3) execute the required actions and record each in the audit trail with a reason code; (4) notify the requester on completion and attach artifacts.`,
        `Edge cases are routed to the senior on-call for the week. The on-call maintains a running log of edge-case decisions that feeds the quarterly procedure review. If the procedure fails to apply, document the gap and raise it at the next retrospective.`,
        `Performance targets: median turnaround under 2 business days, 95th percentile under 5 business days. Deviations beyond the 95th percentile trigger a lightweight postmortem, scoped to the specific case rather than the full process.`,
        `Hand-off protocol: if the owner changes mid-request, the outgoing owner summarizes state, outstanding actions, and expected next step in the ticket before releasing. The incoming owner acknowledges receipt before the clock resumes.`,
      );
      break;
    case "reference":
      paras.push(
        `This reference captures {tenant}'s ${dept} configuration and operating parameters. It is the authoritative snapshot consulted by on-call responders, auditors, and new hires during onboarding.`,
        `Values below reflect the current production configuration and are reviewed on the standard cadence. For historical values, consult the configuration repository. The repository preserves every change along with the author, approver, and justification.`,
        `Related: [[${ref}]], and the shared engineering runbook. If a parameter is missing or stale, open a correction ticket; this document is treated as source of truth for the ${dept} function. The ticket is routed to the document owner listed in the metadata.`,
        `Default values are chosen to balance throughput, reliability, and cost. Tuning beyond the defaults is permitted but must be documented inline with the rationale. Opaque or unexplained deviations are reverted during the next review cycle.`,
        `Changes to these values require a two-person review and an entry in the change log, consistent with {tenant}'s change management policy. Emergency changes bypass the review and are reconciled within one business day under the retroactive-approval process.`,
        `Deprecation policy: parameters marked deprecated are retained for one minor version with a scheduled removal date. Consumers are notified via the standard deprecation channel at least two sprints before removal.`,
      );
      break;
    case "faq":
      paras.push(
        `Common questions from {tenant}'s ${dept} stakeholders are collected here with concise answers. Entries skew toward the questions new team members ask in their first 60 days.`,
        `Q: What is the escalation path if the standard owner is unavailable? A: Contact the ${dept} on-call via the shared paging group; coverage is 24/7 for critical incidents only. For non-critical issues outside business hours, the request is queued and acknowledged on the next business day.`,
        `Q: Where are the historical decisions recorded? A: In the ${dept} decision log, cross-indexed with the architecture repository. See [[${ref}]] for governance-wide context. Decisions older than two years are archived but remain searchable.`,
        `Q: How are new questions added? A: Submit via the team queue. Entries are reviewed monthly and merged when the answer stabilizes. Low-volume questions are kept in a staging section until they recur enough to warrant promotion.`,
        `Q: Can external vendors read this FAQ? A: Only after signing the standard NDA and being added to the vendor group. Content considered sensitive is redacted from the external view at render time.`,
        `Q: What happens when an answer becomes outdated? A: Reviewers mark the entry stale, which hides it from search for new readers while preserving it for historical reference. Updates follow the normal review flow.`,
      );
      break;
    case "troubleshooting":
      paras.push(
        `This guide walks {tenant}'s ${dept} responders through the first 15 minutes of a reported issue. It is written for the on-call engineer, not the end user, and assumes access to the production dashboards.`,
        `Step 1: confirm the symptom reproduces in a controlled environment. Step 2: check the dashboards for anomalies in the preceding 30 minutes. Step 3: review recent changes in the deployment log, giving particular attention to anything shipped in the last 2 hours.`,
        `If the issue appears systemic rather than scoped to a single tenant, escalate per [[${ref}]]. Attach the correlation ID from the audit log so downstream responders can trace the request end-to-end. Record the escalation time in the incident channel.`,
        `Common first-15-minute mistakes: assuming a reproduction case covers the full scope, trusting dashboard aggregates that smooth over short spikes, and chasing a plausible-looking cause before ruling out recent deploys. Mitigation: pause and verify before narrowing.`,
        `Document findings in the ticket as you go. Even if the issue self-resolves, record what was observed so future responders see the pattern. Self-resolution without a cause identified is treated as unresolved for the purpose of retrospectives.`,
        `Hand-off at shift change: the outgoing responder leaves a 3-line status (symptom, last action, next step) pinned in the incident channel. The incoming responder acknowledges before the outgoing responder signs off.`,
      );
      break;
  }
  return { slug, type, title, paras };
}

// ---------- Row builders ----------

function* generateCustomers(): Generator<{ tenant_id: TenantId; id: string; name: string; email: string }> {
  const firstNames = ["Alex","Sam","Jordan","Taylor","Morgan","Casey","Riley","Avery","Quinn","Reese","Blake","Drew","Emerson","Finley","Harper","Hayden","Jamie","Kai","Logan","Marley"];
  const lastNames = ["Patel","Garcia","Nguyen","Smith","Kim","Johnson","Lopez","Williams","Brown","Davis","Chen","Martinez","Walker","Hall","Young","King","Wright","Scott","Green","Baker"];
  for (const t of TENANTS) {
    for (let i = 1; i <= t.customers; i++) {
      const fn = firstNames[Math.floor(rand() * firstNames.length)];
      const ln = lastNames[Math.floor(rand() * lastNames.length)];
      const id = `cust-${t.id}-${String(i).padStart(5, "0")}`;
      yield {
        tenant_id: t.id,
        id,
        name: `${fn} ${ln}`,
        email: `${fn.toLowerCase()}.${ln.toLowerCase()}.${i}@${t.name.split(" ")[0].toLowerCase()}.example`,
      };
    }
  }
}

function* generateTickets(customerCounts: Record<TenantId, number>): Generator<{ tenant_id: TenantId; id: string; customer_id: string; title: string; status: string; priority: string; assignee: string | null }> {
  // Distribute 40k tickets proportional to customer counts.
  const totalCust = TENANTS.reduce((s, t) => s + t.customers, 0);
  let allocated = 0;
  let seq = 0;
  for (let ti = 0; ti < TENANTS.length; ti++) {
    const t = TENANTS[ti];
    const count = ti === TENANTS.length - 1
      ? TICKETS_TOTAL - allocated
      : Math.round((t.customers / totalCust) * TICKETS_TOTAL);
    allocated += count;
    for (let i = 0; i < count; i++) {
      const custIdx = randInt(1, t.customers);
      const custId = `cust-${t.id}-${String(custIdx).padStart(5, "0")}`;
      const category = TICKET_CATEGORIES[Math.floor(rand() * TICKET_CATEGORIES.length)];
      yield {
        tenant_id: t.id,
        id: `tkt-${t.id}-${String(++seq).padStart(6, "0")}`,
        customer_id: custId,
        title: ticketTitle(category),
        status: pickBucket(STATUS_BUCKETS),
        priority: pickBucket(PRIORITY_BUCKETS),
        assignee: rand() < 0.7 ? `agent-${randInt(1, 20)}` : null,
      };
    }
  }
}

function ticketTitle(category: string): string {
  const templates: Record<string, string[]> = {
    billing: ["Invoice shows unexpected charge", "Credit card declined on renewal", "Pro-rated refund calculation looks off"],
    access: ["Cannot log in after SSO change", "MFA device lost, need recovery code", "Admin role missing from new teammate"],
    outage: ["Dashboard not loading in EU region", "API returning 503 intermittently", "Webhook deliveries delayed past SLA"],
    data_export: ["Export job stuck in queued state", "Downloaded export missing custom fields", "Export URL expired before download"],
    onboarding: ["Welcome email not received", "Workspace provisioning taking over an hour", "Need help importing from previous vendor"],
    feature_request: ["Add bulk edit for tickets", "Request: SAML group-to-role mapping", "Please add a dark mode toggle"],
    bug_report: ["Date picker off by one day in Safari", "Timezone drift in reports after DST", "Cannot delete empty folders"],
    security: ["Potential CSRF on settings page", "Report of leaked API key in public repo", "Suspicious login from unknown IP"],
    integration: ["Slack integration disconnected overnight", "Jira sync skipping sub-tasks", "HubSpot contact dedupe not firing"],
    upgrade: ["Upgrade blocked by legacy plan", "Seat count not updated after upgrade", "Features from Pro tier not visible yet"],
    downgrade: ["Downgrade pending but features already removed", "Confirm downgrade will not delete data", "Downgrade credits not applied"],
    cancellation: ["Cancel subscription at end of term", "Account marked cancelled but still charging", "Reactivate recently cancelled workspace"],
    refund: ["Refund request for unused annual term", "Partial refund on seats removed mid-cycle", "Chargeback filed, needs reconciliation"],
    performance: ["Reports timing out on large date range", "Autocomplete slow with 10k+ records", "API p95 above documented SLA"],
    documentation: ["Example in webhook docs references wrong field", "Rate-limit page says 60/min but headers show 100/min", "Missing docs for new audit log endpoint"],
  };
  const arr = templates[category] ?? ["Issue reported"];
  return arr[Math.floor(rand() * arr.length)];
}

function* generateSubscriptions(): Generator<{ tenant_id: TenantId; id: string; customer_id: string; plan: string; status: string; renews_on: string | null }> {
  const totalCust = TENANTS.reduce((s, t) => s + t.customers, 0);
  let seq = 0;
  let allocated = 0;
  for (let ti = 0; ti < TENANTS.length; ti++) {
    const t = TENANTS[ti];
    const count = ti === TENANTS.length - 1
      ? SUBS_TOTAL - allocated
      : Math.round((t.customers / totalCust) * SUBS_TOTAL);
    allocated += count;
    const taken = new Set<number>();
    const effective = Math.min(count, t.customers);
    for (let i = 0; i < effective; i++) {
      // One sub per customer. Guards against infinite loop if count ever > customers.
      let idx: number;
      do { idx = randInt(1, t.customers); } while (taken.has(idx));
      taken.add(idx);
      const custId = `cust-${t.id}-${String(idx).padStart(5, "0")}`;
      const status = pickBucket(SUB_STATUS_BUCKETS);
      const renewDays = randInt(1, 365);
      const renewOn = new Date(Date.now() + renewDays * 86_400_000).toISOString().slice(0, 10);
      yield {
        tenant_id: t.id,
        id: `sub-${t.id}-${String(++seq).padStart(5, "0")}`,
        customer_id: custId,
        plan: pickBucket(PLAN_BUCKETS),
        status,
        renews_on: status === "cancelled" ? null : renewOn,
      };
    }
  }
}

// ---------- COPY helpers ----------
// pg-copy-streams takes TSV-style rows; escape tabs/newlines/backslashes.

function escapeCopy(v: string | null): string {
  if (v === null || v === undefined) return "\\N";
  return String(v)
    .replace(/\\/g, "\\\\")
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

// Typed loosely to avoid importing pg at module scope (keeps dry-run dependency-free).
async function copyRows(client: { query: (q: unknown) => NodeJS.WritableStream }, sql: string, rowsIter: Iterable<Array<string | null>>): Promise<void> {
  // Dynamic import keeps dry-run working without pg-copy-streams installed.
  const { from: copyFrom } = await import("pg-copy-streams");
  const stream = client.query(copyFrom(sql));
  const readable = Readable.from((function* () {
    for (const row of rowsIter) {
      yield row.map(escapeCopy).join("\t") + "\n";
    }
  })());
  await pipelineP(readable, stream);
}

// ---------- Main ----------

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const dbUrl = process.env.DATABASE_URL;

  // Always generate docs — the files are a deliverable even in dry-run.
  const docsExist = existsSync(DOCS_DIR) && (await readdir(DOCS_DIR)).length >= 500;
  if (!docsExist) {
    console.log("[seed] generating 500 markdown docs under packages/db/seed/docs/");
  } else {
    console.log("[seed] docs/ already populated; regenerating to stay in sync");
  }
  const docs = await writeDocs();
  console.log(`[seed] wrote ${docs.length} docs (A=${docs.filter(d => d.tenant === "A").length} B=${docs.filter(d => d.tenant === "B").length} C=${docs.filter(d => d.tenant === "C").length})`);

  // Count rows that would be inserted.
  const customers = [...generateCustomers()];
  const tickets = [...generateTickets({ A: 5000, B: 3500, C: 1500 })];
  const subs = [...generateSubscriptions()];

  console.log(`[seed] plan: tenants=${TENANTS.length} customers=${customers.length} tickets=${tickets.length} subscriptions=${subs.length} docs=${docs.length}`);

  if (dryRun) {
    console.log("[seed] --dry-run: skipping DB writes, exit 0");
    return;
  }
  if (!dbUrl) {
    console.log("[seed] DATABASE_URL unset: dry-run only, exit 0");
    return;
  }

  const { Client } = await import("pg");
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const t0 = Date.now();

  try {
    // Idempotent reset. Keep audit_log, idempotency_keys, cost_rollup_daily empty.
    // ponytail: drop+recreate tenants rather than CASCADE through audit_log.
    //   RLS is disabled during seed via session role (superuser); the schema's
    //   FKs still enforce referential integrity.
    await client.query("BEGIN");
    await client.query("TRUNCATE subscriptions, tickets, customers, docs, idempotency_keys, cost_rollup_daily RESTART IDENTITY");
    await client.query("DELETE FROM audit_log");
    await client.query("DELETE FROM tenants");

    for (const t of TENANTS) {
      await client.query("INSERT INTO tenants (id, name) VALUES ($1, $2)", [t.id, t.name]);
    }

    // Customers via COPY
    await copyRows(
      client,
      "COPY customers (tenant_id, id, name, email) FROM STDIN",
      (function* () {
        for (const c of customers) yield [c.tenant_id, c.id, c.name, c.email];
      })(),
    );

    // Tickets via COPY
    await copyRows(
      client,
      "COPY tickets (tenant_id, id, customer_id, title, status, priority, assignee) FROM STDIN",
      (function* () {
        for (const tk of tickets) yield [tk.tenant_id, tk.id, tk.customer_id, tk.title, tk.status, tk.priority, tk.assignee];
      })(),
    );

    // Docs via COPY (embedding stays NULL)
    await copyRows(
      client,
      "COPY docs (tenant_id, id, title, body) FROM STDIN",
      (function* () {
        for (const d of docs) yield [d.tenant, d.id, d.title, d.body];
      })(),
    );

    // Subscriptions via INSERT (small enough; plan says INSERT is fine).
    const subInsert = "INSERT INTO subscriptions (tenant_id, id, customer_id, plan, status, renews_on) VALUES ($1,$2,$3,$4,$5,$6)";
    for (const s of subs) {
      await client.query(subInsert, [s.tenant_id, s.id, s.customer_id, s.plan, s.status, s.renews_on]);
    }

    await client.query("COMMIT");
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[seed] DONE in ${dt}s`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[seed] FAILED:", err);
  process.exit(1);
});
