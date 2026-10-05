// Eval harness runner — entry point for `pnpm eval`.
//
// Loads every scenarios/**/*.yaml, iterates sample rows, invokes the supervisor
// (if wired), scores via deterministic dispatcher or LLM judge, writes a per-row
// log line to logs/<ISO>.jsonl, then hands off to scorecard.ts::aggregate.
//
// CLI flags:
//   --only <scenario-name>   run just one scenario
//   --dry-run                skip the supervisor; emit synthetic rows for aggregation testing
//   --log-dir <path>         override logs/ (used by tests)
//
// Design notes:
//   - Supervisor is still stubbed (throws). We catch "not implemented" and
//     emit an advisory row (pass=false, grader_meta={advisory:true}).
//   - YAML parser is a tiny purpose-built one — scenarios are flat enough
//     that pulling in `yaml` would be more install surface than code saved.
//     ponytail: hand-rolled YAML; swap for `yaml` pkg if scenarios grow nested.

import { mkdir, readFile, readdir, appendFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregate } from "./scorecard";
import { judge, type ScenarioDef as JudgeScenarioDef } from "./judge";
import { runSupervisor } from "../../src/agents/supervisor";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

type DeterministicGrader = {
  type: "deterministic";
  assertion: string;
  [key: string]: unknown;
};

type LlmJudgeGrader = {
  type: "llm_judge";
  judge_model: string;
  rubric_path: string;
};

type Scenario = {
  name: string;
  description?: string;
  category: string;
  severity: "must_pass" | "high" | "medium";
  threshold: number;
  grader: DeterministicGrader | LlmJudgeGrader;
  samples: { path: string; rows: number };
  __yamlPath: string;
};

type Row = {
  input: Array<{ role: string; content: string }>;
  ideal: string;
  fixtures?: Record<string, unknown>;
};

type GraderMeta = Record<string, unknown>;
type GraderOutcome = { pass: boolean; meta: GraderMeta };

// ──────────────────────────────────────────────────────────────────────────
// YAML — hand-rolled, scenario-shaped
// ──────────────────────────────────────────────────────────────────────────

function parseScalar(raw: string): unknown {
  const s = raw.trim();
  if (s === "") return "";
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  // strip wrapping quotes
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Minimal YAML → JS: supports nested maps (2-space indent), lists via `- `,
 * scalars with optional single/double quotes, and single-line `key: value`
 * pairs. Comments start with `#`. No anchors, aliases, folded scalars, flow
 * mappings. If a scenario YAML outgrows this, swap for the `yaml` package.
 */
function parseYaml(text: string): Record<string, unknown> {
  const lines = text.split("\n");

  // Pass 1: strip comments + blanks, record indent.
  type Tok = { indent: number; raw: string };
  const toks: Tok[] = [];
  for (const line of lines) {
    const noComment = line.replace(/\s+#.*$/, "").replace(/^#.*$/, "");
    if (noComment.trim() === "") continue;
    const indent = noComment.length - noComment.trimStart().length;
    toks.push({ indent, raw: noComment.trimEnd() });
  }

  let idx = 0;

  function parseBlock(baseIndent: number): unknown {
    // Peek: list or map?
    if (idx >= toks.length) return null;
    const first = toks[idx]!;
    if (first.indent < baseIndent) return null;
    const trimmed = first.raw.slice(first.indent);
    if (trimmed.startsWith("- ")) return parseList(baseIndent);
    return parseMap(baseIndent);
  }

  function parseMap(baseIndent: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    while (idx < toks.length) {
      const tok = toks[idx]!;
      if (tok.indent < baseIndent) break;
      if (tok.indent > baseIndent) {
        // deeper than expected — shouldn't happen unless caller passed wrong indent
        break;
      }
      const line = tok.raw.slice(tok.indent);
      if (line.startsWith("- ")) break; // list, not map
      const colon = line.indexOf(":");
      if (colon < 0) {
        idx++;
        continue;
      }
      const key = line.slice(0, colon).trim();
      const rest = line.slice(colon + 1).trim();
      idx++;
      if (rest === "") {
        // nested
        const next = toks[idx];
        if (next && next.indent > baseIndent) {
          out[key] = parseBlock(next.indent);
        } else {
          out[key] = null;
        }
      } else {
        out[key] = parseScalar(rest);
      }
    }
    return out;
  }

  function parseList(baseIndent: number): unknown[] {
    const out: unknown[] = [];
    while (idx < toks.length) {
      const tok = toks[idx]!;
      if (tok.indent < baseIndent) break;
      const line = tok.raw.slice(tok.indent);
      if (!line.startsWith("- ")) break;
      const after = line.slice(2).trim();
      idx++;
      if (after === "") {
        // nested block item
        const next = toks[idx];
        if (next && next.indent > baseIndent) {
          out.push(parseBlock(next.indent));
        } else {
          out.push(null);
        }
      } else if (after.includes(":")) {
        // inline map first entry; parse as map starting from this tok (back up idx)
        // simpler: treat this line as the first key:value, then continue reading
        // deeper indented lines as map continuation.
        idx--;
        // adjust so parseMap sees this line without the "- " prefix. Easiest: rewrite tok.
        toks[idx] = { indent: baseIndent + 2, raw: " ".repeat(baseIndent + 2) + after };
        out.push(parseMap(baseIndent + 2));
      } else {
        out.push(parseScalar(after));
      }
    }
    return out;
  }

  return parseMap(0);
}

// ──────────────────────────────────────────────────────────────────────────
// Deterministic grader dispatch
// ──────────────────────────────────────────────────────────────────────────

/**
 * Each dispatcher is intentionally boring string-ops. The YAMLs declare the
 * assertion name; the row's `fixtures` carry the context. We branch on the
 * assertion string and inspect whichever fields the YAML provides.
 */
function dispatchDeterministic(
  grader: DeterministicGrader,
  row: Row,
  completion: string
): GraderOutcome {
  const a = grader.assertion;

  if (a === "regex_match") {
    // Two variants per YAML corpus:
    //   - `pattern` + optional `flags` → completion must match
    //   - `must_not_match_patterns: [regex...]` → completion must match NONE
    if (Array.isArray(grader["must_not_match_patterns"])) {
      const bad = grader["must_not_match_patterns"] as string[];
      const hit = bad.find((p) => new RegExp(p).test(completion));
      return { pass: !hit, meta: { assertion: a, violated: hit ?? null } };
    }
    const pattern = String(grader["pattern"] ?? "");
    const flags = String(grader["flags"] ?? "");
    const re = new RegExp(pattern, flags);
    return { pass: re.test(completion), meta: { assertion: a, pattern } };
  }

  if (a === "rls_result") {
    // YAMLs: `must_not_contain_tenant: B` → completion must not mention tenant B's data.
    // Fixture-level `actual_owner_tenant` names the forbidden tenant.
    const forbidden = String(
      grader["must_not_contain_tenant"] ?? row.fixtures?.["actual_owner_tenant"] ?? ""
    );
    const forbiddenCustomer = String(row.fixtures?.["b_doc_id"] ?? row.fixtures?.["queried_customer_id"] ?? "");
    const leaked =
      (forbidden && new RegExp(`tenant[-_ ]?${forbidden}\\b`, "i").test(completion)) ||
      (forbiddenCustomer && completion.includes(forbiddenCustomer) && !/not found|zero rows/i.test(completion));
    return { pass: !leaked, meta: { assertion: a, forbidden_tenant: forbidden } };
  }

  if (a === "status_code") {
    const expected = String(grader["expected_status"] ?? row.fixtures?.["tool_response"] ?? "");
    const want = expected || String((row.fixtures?.["tool_response"] as { status?: number })?.status ?? "");
    const ok = want !== "" && completion.includes(want);
    return { pass: ok, meta: { assertion: a, expected_status: want } };
  }

  if (a === "span_sequence" || a === "tool_arg_trace") {
    // Both grade a tool-call trajectory. span_sequence uses `expected_sequence`;
    // tool_arg_trace may use `expected_sequence` or `required_args`.
    if (Array.isArray(grader["expected_sequence"])) {
      const seq = grader["expected_sequence"] as string[];
      let cursor = 0;
      let searchFrom = 0;
      for (const step of seq) {
        const found = completion.indexOf(step, searchFrom);
        if (found < 0) {
          cursor = -1;
          break;
        }
        searchFrom = found + step.length;
        cursor++;
      }
      return {
        pass: cursor === seq.length,
        meta: { assertion: a, expected_sequence: seq, matched: cursor },
      };
    }
    if (grader["required_args"] && typeof grader["required_args"] === "object") {
      const required = grader["required_args"] as Record<string, string>;
      const toolName = String(grader["tool"] ?? "");
      const toolMentioned = toolName === "" || completion.includes(toolName);
      // Substitute $fixture.<key> placeholders.
      const missing: string[] = [];
      for (const [argName, argSpec] of Object.entries(required)) {
        let expected = argSpec;
        const m = /^\$fixture\.(.+)$/.exec(argSpec);
        if (m) expected = String(row.fixtures?.[m[1]!] ?? "");
        if (!expected || !completion.includes(expected)) missing.push(`${argName}=${expected}`);
      }
      return {
        pass: toolMentioned && missing.length === 0,
        meta: { assertion: a, tool: toolName, missing },
      };
    }
    return { pass: false, meta: { assertion: a, error: "unrecognized trace spec" } };
  }

  if (a === "threshold") {
    // SLO: pass if completion emits "SLO:PASS" sentinel. The agent is expected
    // to self-report once p95 + cost are measured during its multi-turn run.
    return { pass: completion.includes("SLO:PASS"), meta: { assertion: a } };
  }

  return { pass: false, meta: { assertion: a, error: "unknown assertion" } };
}

// ──────────────────────────────────────────────────────────────────────────
// Scenario discovery + row loading
// ──────────────────────────────────────────────────────────────────────────

async function findYamlFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && (extname(e.name) === ".yaml" || extname(e.name) === ".yml"))
        out.push(p);
    }
  }
  await walk(root);
  return out.sort();
}

async function loadScenario(yamlPath: string): Promise<Scenario> {
  const text = await readFile(yamlPath, "utf8");
  const obj = parseYaml(text) as Partial<Scenario> & Record<string, unknown>;
  return { ...(obj as Scenario), __yamlPath: yamlPath };
}

async function loadRows(scenario: Scenario): Promise<Row[]> {
  const base = dirname(scenario.__yamlPath);
  const path = resolve(base, scenario.samples.path);
  const text = await readFile(path, "utf8");
  const rows: Row[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t));
    } catch {
      // skip malformed row
    }
  }
  return rows;
}

// ──────────────────────────────────────────────────────────────────────────
// Supervisor invocation (guarded)
// ──────────────────────────────────────────────────────────────────────────

type Invocation = {
  completion: string;
  latency_ms: number;
  cost_usd: number;
  advisory?: { reason: string };
};

async function invokeSupervisor(row: Row): Promise<Invocation> {
  const start = Date.now();
  try {
    const out = await runSupervisor({
      tenantId: String(row.fixtures?.["tenant_id"] ?? "A"),
      userId: "eval-runner",
      conversation: row.input
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    });
    return {
      completion: out.reply,
      latency_ms: Date.now() - start,
      cost_usd: 0, // populated by otel span once wired
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not implemented")) {
      return {
        completion: "",
        latency_ms: Date.now() - start,
        cost_usd: 0,
        advisory: { reason: "supervisor not wired" },
      };
    }
    throw err;
  }
}

function syntheticInvocation(): Invocation {
  // --dry-run path. Fixed values are fine; aggregation shape is what we're
  // smoke-testing.
  return { completion: "", latency_ms: 0, cost_usd: 0 };
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { only?: string; dryRun: boolean; logDir?: string } {
  const out: { only?: string; dryRun: boolean; logDir?: string } = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--only" && argv[i + 1]) {
      out.only = argv[i + 1];
      i++;
    } else if (a === "--log-dir" && argv[i + 1]) {
      out.logDir = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function main() {
  const repoRoot = resolve(__dirname, "..", "..");
  const scenariosRoot = join(repoRoot, "packages", "evals", "scenarios");
  const args = parseArgs(process.argv.slice(2));
  const logDir = args.logDir ?? join(repoRoot, "logs");
  await mkdir(logDir, { recursive: true });
  const logPath = join(logDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);

  const yamls = await findYamlFiles(scenariosRoot);
  const scenarios: Scenario[] = [];
  for (const y of yamls) {
    const s = await loadScenario(y);
    if (args.only && s.name !== args.only) continue;
    scenarios.push(s);
  }

  let totalRows = 0;
  let advisoryRows = 0;

  for (const scenario of scenarios) {
    const rows = await loadRows(scenario);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const inv = args.dryRun ? syntheticInvocation() : await invokeSupervisor(row);

      let pass = false;
      let graderMeta: GraderMeta = {};

      if (inv.advisory || args.dryRun) {
        pass = false;
        graderMeta = inv.advisory
          ? { advisory: true, reason: inv.advisory.reason }
          : { advisory: true, reason: "dry-run" };
        advisoryRows++;
        if (inv.advisory) {
          console.warn(`[advisory] ${scenario.name} row ${i}: ${inv.advisory.reason}`);
        }
      } else if (scenario.grader.type === "deterministic") {
        const outcome = dispatchDeterministic(scenario.grader, row, inv.completion);
        pass = outcome.pass;
        graderMeta = outcome.meta;
      } else {
        try {
          const judgeScenario: JudgeScenarioDef = {
            name: scenario.name,
            category: scenario.category,
            grader: scenario.grader,
            __yamlPath: scenario.__yamlPath,
          };
          const j = await judge(judgeScenario, row, inv.completion);
          pass = j.pass;
          graderMeta = { judge_raw: j.raw };
        } catch (err) {
          pass = false;
          graderMeta = { judge_error: err instanceof Error ? err.message : String(err) };
        }
      }

      const logRow = {
        scenario: scenario.name,
        category: scenario.category,
        severity: scenario.severity,
        threshold: scenario.threshold,
        grader_type: scenario.grader.type,
        row_index: i,
        pass,
        grader_meta: graderMeta,
        latency_ms: inv.latency_ms,
        cost_usd: inv.cost_usd,
        ideal: row.ideal,
        completion: inv.completion,
        ts: new Date().toISOString(),
      };
      await appendFile(logPath, JSON.stringify(logRow) + "\n", "utf8");
      totalRows++;
    }
  }

  const scorecardPath = await aggregate(logPath);
  console.log(
    `runner: ${totalRows} rows logged to ${logPath} (${advisoryRows} advisory). scorecard → ${scorecardPath}`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
