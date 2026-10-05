// Two-level cost circuit breaker: per-conversation + per-tenant-day.
// See _handoff/project-1-FINAL-plan.md §1 and §4, and packages/db/schema.sql::cost_rollup_daily.
//
// ponytail: In-memory daily counters; upgrade to cost_rollup_daily table in Postgres
// when the breaker needs to survive restarts.

const conversationUsd = new Map<string, number>();
const tenantDayUsd = new Map<string, number>();

let override: { perConversation?: number; perTenantDay?: number } = {};

function perConversationCap(): number {
  if (typeof override.perConversation === "number") return override.perConversation;
  const n = Number(process.env.COST_PER_CONVERSATION_USD);
  return Number.isFinite(n) && n > 0 ? n : 0.5;
}

function perTenantDayCap(): number {
  if (typeof override.perTenantDay === "number") return override.perTenantDay;
  const n = Number(process.env.COST_PER_TENANT_DAY_USD);
  return Number.isFinite(n) && n > 0 ? n : 50.0;
}

function todayIso(now: Date = new Date()): string {
  // UTC YYYY-MM-DD. Matches cost_rollup_daily.day_utc convention.
  return now.toISOString().slice(0, 10);
}

export type CostCheckInput = {
  tenantId: string;
  conversationId: string;
  usd: number;
};

export type CostCheckResult = {
  allowed: boolean;
  reason?: "per_conversation" | "per_tenant_day";
  cumulative: {
    conversation_usd: number;
    tenant_day_usd: number;
  };
};

export function checkAndRecord(input: CostCheckInput): CostCheckResult {
  const { tenantId, conversationId, usd } = input;
  const dayKey = `${tenantId}/${todayIso()}`;

  const convCurrent = conversationUsd.get(conversationId) ?? 0;
  const dayCurrent = tenantDayUsd.get(dayKey) ?? 0;

  const convNext = convCurrent + usd;
  const dayNext = dayCurrent + usd;

  if (convNext > perConversationCap()) {
    return {
      allowed: false,
      reason: "per_conversation",
      cumulative: {
        conversation_usd: convCurrent,
        tenant_day_usd: dayCurrent,
      },
    };
  }

  if (dayNext > perTenantDayCap()) {
    return {
      allowed: false,
      reason: "per_tenant_day",
      cumulative: {
        conversation_usd: convCurrent,
        tenant_day_usd: dayCurrent,
      },
    };
  }

  conversationUsd.set(conversationId, convNext);
  tenantDayUsd.set(dayKey, dayNext);

  return {
    allowed: true,
    cumulative: {
      conversation_usd: convNext,
      tenant_day_usd: dayNext,
    },
  };
}

export function _resetForTests(): void {
  conversationUsd.clear();
  tenantDayUsd.clear();
  override = {};
}

export function _setForTests(cfg: {
  perConversation?: number;
  perTenantDay?: number;
}): void {
  override = { ...override, ...cfg };
}
