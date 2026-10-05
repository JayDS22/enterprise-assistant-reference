// LLM-judge for llm_judge scenarios. Pinned to gpt-4o-2024-08-06 per FINAL plan §5.
// User's OpenAI credits are exhausted; this path is never exercised today.
// `--dry-run` in runner.ts bypasses this file entirely.
//
// ponytail: single-model judge, no ensemble; add ensemble when gold-set
// accuracy on any judged scenario drops below 0.80.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import OpenAI from "openai";

export type ScenarioDef = {
  name: string;
  category: string;
  grader: {
    type: "llm_judge";
    judge_model: string;
    rubric_path: string;
  };
  __yamlPath: string; // injected by runner
};

export type Row = {
  input: Array<{ role: string; content: string }>;
  ideal: string;
  fixtures?: Record<string, unknown>;
};

export type JudgeResult = { pass: boolean; raw: string };

const JUDGE_MODEL = "gpt-4o-2024-08-06";

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
}

function formatInput(input: Row["input"]): string {
  return input.map((m) => `[${m.role}] ${m.content}`).join("\n");
}

async function loadRubric(scenario: ScenarioDef): Promise<string> {
  const base = dirname(scenario.__yamlPath);
  const path = resolve(base, scenario.grader.rubric_path);
  return await readFile(path, "utf8");
}

/**
 * Judge one row. Returns {pass, raw}. Any parse error → fail (safer default).
 */
export async function judge(
  scenario: ScenarioDef,
  row: Row,
  completion: string
): Promise<JudgeResult> {
  const rubric = await loadRubric(scenario);
  const prompt = [
    rubric,
    "",
    "---",
    "## Input",
    formatInput(row.input),
    "",
    "## Completion",
    completion,
    "",
    "## Instructions",
    "Apply the rubric above. Reply with reasoning, then on the final non-empty line output exactly 'Y' or 'N'.",
  ].join("\n");

  const resp = await client().chat.completions.create({
    model: scenario.grader.judge_model || JUDGE_MODEL,
    temperature: 0,
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = resp.choices[0]?.message?.content ?? "";
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const last = lines[lines.length - 1] ?? "";
  const pass = last === "Y" || last.startsWith("Y ") || last.startsWith("Y.");
  return { pass, raw };
}
