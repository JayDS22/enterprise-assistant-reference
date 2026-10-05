// Aggregates per-row eval logs into a markdown scorecard at repo root.
// Shape mirrors Project 2's scripts/scorecard.py but with Project-1-specific
// columns (severity, threshold, judge accuracy on gold).
//
// CI logic per FINAL plan §5:
//   - FAIL if any must_pass scenario pass rate < 1.0
//   - FAIL if MORE THAN ONE high/medium scenario falls below its threshold
//   - A scenario with judge_accuracy < 0.80 on gold is 'advisory' (not gating)

import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type LogRow = {
  scenario: string;
  category: string;
  severity: "must_pass" | "high" | "medium";
  threshold: number;
  grader_type: "deterministic" | "llm_judge";
  row_index: number;
  pass: boolean;
  grader_meta?: Record<string, unknown>;
  latency_ms: number;
  cost_usd: number;
  ideal: string;
  completion: string;
  ts: string;
};

type Bucket = {
  scenario: string;
  category: string;
  severity: LogRow["severity"];
  threshold: number;
  grader_type: LogRow["grader_type"];
  rows: LogRow[];
};

const REPO_ROOT = resolve(__dirname, "..", "..");

function p50(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

async function readLog(logPath: string): Promise<LogRow[]> {
  const text = await readFile(logPath, "utf8");
  const rows: LogRow[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // skip bad line, keep aggregating
    }
  }
  return rows;
}

/** Find the newest *.jsonl in logs/ by mtime. */
export async function latestLog(logsDir: string): Promise<string> {
  const entries = await readdir(logsDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl"));
  if (files.length === 0) throw new Error(`no log files in ${logsDir}`);
  const withStats = await Promise.all(
    files.map(async (e) => {
      const path = join(logsDir, e.name);
      const { stat } = await import("node:fs/promises");
      const s = await stat(path);
      return { path, mtime: s.mtimeMs };
    })
  );
  withStats.sort((a, b) => b.mtime - a.mtime);
  return withStats[0]!.path;
}

/** Group rows into (scenario) buckets, preserving metadata from first row. */
function bucket(rows: LogRow[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    let b = map.get(r.scenario);
    if (!b) {
      b = {
        scenario: r.scenario,
        category: r.category,
        severity: r.severity,
        threshold: r.threshold,
        grader_type: r.grader_type,
        rows: [],
      };
      map.set(r.scenario, b);
    }
    b.rows.push(r);
  }
  return [...map.values()].sort((a, b) =>
    a.category === b.category
      ? a.scenario.localeCompare(b.scenario)
      : a.category.localeCompare(b.category)
  );
}

/**
 * Judge accuracy on gold set: for an llm_judge scenario, re-run the judge
 * against packages/evals/gold/<name>.jsonl where each gold row has a
 * `human_label` of "Y"/"N" and a pre-recorded `completion`. We don't actually
 * re-run the judge here — in --dry-run no calls happen. The log row records
 * `grader_meta.gold_pass` when the judge was replayed; otherwise we return
 * null (advisory-skip).
 */
function judgeAccuracy(b: Bucket): number | null {
  if (b.grader_type !== "llm_judge") return null;
  const scored = b.rows.filter(
    (r) => r.grader_meta && typeof r.grader_meta["gold_pass"] === "boolean"
  );
  if (scored.length === 0) return null;
  const correct = scored.filter((r) => r.grader_meta!["gold_pass"] === true).length;
  return correct / scored.length;
}

function verdict(buckets: Bucket[]): { pass: boolean; reason: string } {
  const failures: string[] = [];
  const belowThreshold: string[] = [];
  for (const b of buckets) {
    const passRate = mean(b.rows.map((r) => (r.pass ? 1 : 0)));
    const acc = judgeAccuracy(b);
    const advisory = acc !== null && acc < 0.8;
    if (advisory) continue; // not gating

    if (b.severity === "must_pass" && passRate < 1.0) {
      failures.push(`${b.scenario} (must_pass: ${passRate.toFixed(2)} < 1.00)`);
    } else if (passRate < b.threshold) {
      belowThreshold.push(`${b.scenario} (${passRate.toFixed(2)} < ${b.threshold})`);
    }
  }
  if (failures.length > 0) {
    return { pass: false, reason: `must_pass failures: ${failures.join(", ")}` };
  }
  if (belowThreshold.length > 1) {
    return {
      pass: false,
      reason: `${belowThreshold.length} high/medium scenarios below threshold: ${belowThreshold.join(", ")}`,
    };
  }
  return { pass: true, reason: "" };
}

function renderMarkdown(buckets: Bucket[], logPath: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# Enterprise Assistant Reference — Eval Scorecard`);
  lines.push("");
  lines.push(`Generated: ${date}`);
  lines.push(`Source log: \`${logPath}\``);
  lines.push("");
  lines.push(
    "| Scenario | Category | Rows | Grader | Severity | Threshold | Pass rate | Judge acc (gold) | p50 latency (ms) | Cost ($) |"
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const b of buckets) {
    const passRate = mean(b.rows.map((r) => (r.pass ? 1 : 0)));
    const p50Lat = p50(b.rows.map((r) => r.latency_ms));
    const avgCost = mean(b.rows.map((r) => r.cost_usd));
    const acc = judgeAccuracy(b);
    const accCell = acc === null ? "—" : acc.toFixed(2);
    const passCell =
      acc !== null && acc < 0.8
        ? `${passRate.toFixed(2)} (advisory)`
        : passRate.toFixed(2);
    lines.push(
      `| ${b.scenario} | ${b.category} | ${b.rows.length} | ${b.grader_type} | ${b.severity} | ${b.threshold} | ${passCell} | ${accCell} | ${p50Lat.toFixed(0)} | ${avgCost.toFixed(4)} |`
    );
  }
  lines.push("");

  // Category totals
  const byCat = new Map<string, number[]>();
  for (const b of buckets) {
    const pr = mean(b.rows.map((r) => (r.pass ? 1 : 0)));
    const arr = byCat.get(b.category) ?? [];
    arr.push(pr);
    byCat.set(b.category, arr);
  }
  lines.push("## Category totals");
  lines.push("");
  lines.push("| Category | Mean pass rate | Scenarios |");
  lines.push("|---|---|---|");
  for (const [cat, prs] of [...byCat.entries()].sort()) {
    lines.push(`| ${cat} | ${mean(prs).toFixed(2)} | ${prs.length} |`);
  }
  lines.push("");

  // Verdict
  const v = verdict(buckets);
  lines.push("## Verdict");
  lines.push("");
  lines.push(v.pass ? "**CI PASS**" : `**CI FAIL** — ${v.reason}`);
  lines.push("");

  return lines.join("\n");
}

/** Aggregate a log file into scorecard.md at repo root. */
export async function aggregate(logPath: string, outPath?: string): Promise<string> {
  const rows = await readLog(logPath);
  const buckets = bucket(rows);
  const md = renderMarkdown(buckets, logPath);
  const dest = outPath ?? join(REPO_ROOT, "scorecard.md");
  await writeFile(dest, md, "utf8");
  return dest;
}

// CLI entry: `tsx packages/evals/scorecard.ts [--log <path>]`
async function main() {
  const args = process.argv.slice(2);
  const logFlag = args.indexOf("--log");
  const logPath =
    logFlag >= 0 && args[logFlag + 1]
      ? resolve(args[logFlag + 1]!)
      : await latestLog(join(REPO_ROOT, "logs"));
  const out = await aggregate(logPath);
  console.log(`scorecard: ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
