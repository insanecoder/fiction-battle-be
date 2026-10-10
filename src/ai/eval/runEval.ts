// Runs the tagging eval set and stores per-category results for this model + prompt.
//
//   npm run eval                                   # dev split, default model / thinking / prompt "1"
//   npm run eval -- --model gemini-3.8-flash --prompt 1 --thinking high
//   npm run eval -- --seed 7                        # default seed is 42; same seed → comparable runs
//   npm run eval -- --split holdout --note "final check before release"
//
// LLM outputs are cached in results/cache.jsonl (not committed), keyed by model + thinking + seed +
// prompt hash + schema hash + case qId. A cached case is reused; otherwise the model is called and
// the output is saved immediately, so a stopped run loses nothing — rerun to fill in the rest.
//
// Results:
//   src/ai/eval/results/runs/<runId>.json   full run: hash, config, metrics, every case's output
//     runId = <split>_<model>_prompt<version>-<promptHash>_<thinking>_seed<seed>_<timestamp>
//   src/ai/eval/results/summary.jsonl       one line per run, for comparing models/prompts

import fs from "fs";
import path from "path";
import { parseArgs } from "util";
import { createLLMModel, DEFAULT_MODEL } from "../llm/model.factory";
import { getTaggingPrompt } from "../post-tagging/prompts";
import { tagPost, TaggingRun } from "../post-tagging/tagger";
import { aggregate, aggregateByCategory, EvalCase, scoreCase, ScoredCase } from "./scoring";
import { OutputCache, shortHash } from "./cache";
import { PostTaggingSchema } from "../post-tagging/tagging.schema";
import { z } from "zod";

const EVAL_SET_PATH = path.join("src", "ai", "eval", "evalSet.json");
const RESULTS_DIR = path.join("src", "ai", "eval", "results");
const RUNS_DIR = path.join(RESULTS_DIR, "runs");
const SUMMARY_PATH = path.join(RESULTS_DIR, "summary.jsonl");

const { values: args } = parseArgs({
  options: {
    split: { type: "string", default: "dev" }, // dev | holdout | all
    model: { type: "string" },
    thinking: { type: "string" }, // model-specific, e.g. Gemini: low | medium | high
    seed: { type: "string", default: "42" },
    prompt: { type: "string", default: "1" },
    concurrency: { type: "string", default: "1" }, // keep low on Gemini free tier (per-minute limits)
    limit: { type: "string" },
    note: { type: "string", default: "" },
  },
});

async function main() {
  const split = args.split!;
  if (!["dev", "holdout", "all"].includes(split)) throw new Error(`--split must be dev, holdout or all`);

  const model = args.model ?? DEFAULT_MODEL;
  const llm = createLLMModel(model, args.thinking);
  // Resolved by the model class (includes its default when none was passed).
  const { thinkingLevel } = llm;
  const prompt = getTaggingPrompt(args.prompt!);
  const seed = parseSeed(args.seed!);

  const evalSetRaw = fs.readFileSync(EVAL_SET_PATH, "utf8");
  const allCases: EvalCase[] = JSON.parse(evalSetRaw);
  let cases = split === "all" ? allCases : allCases.filter((c) => c.split === split);
  if (args.limit) cases = cases.slice(0, Number(args.limit));

  if (split !== "dev") {
    console.warn("⚠️  Running on holdout. Don't tune the prompt against these results, or holdout stops being a fair test.");
  }
  console.log(
    `Running ${cases.length} cases | model=${model} thinking=${thinkingLevel} seed=${seed} prompt=${prompt.version} (${prompt.hash}) split=${split}`
  );

  const cache = new OutputCache();
  const schemaHash = shortHash(JSON.stringify(z.toJSONSchema(PostTaggingSchema)));

  const outputs: Record<string, { run?: TaggingRun; error?: string; cached?: boolean }> = {};
  let done = 0;
  await runPool(cases, Number(args.concurrency), async (c) => {
    const key = { model, thinkingLevel, seed, promptHash: prompt.hash, schemaHash, caseId: c.id };
    const cached = cache.get(key);
    if (cached) {
      outputs[c.id] = { run: cached, cached: true };
    } else {
      try {
        const run = await tagPost(llm, prompt, c.text, seed);
        outputs[c.id] = { run };
        cache.set(key, run); // saved immediately
      } catch (err) {
        outputs[c.id] = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    process.stdout.write(`\r${++done}/${cases.length}`);
  });
  process.stdout.write("\n");
  const cachedCount = cases.filter((c) => outputs[c.id].cached).length;
  console.log(`Outputs: ${cachedCount} from cache, ${cases.length - cachedCount} API calls`);

  const scored: ScoredCase[] = cases.map((c) => {
    const run = outputs[c.id].run;
    return {
      id: c.id,
      category: c.category,
      score: run ? scoreCase(c, run.result) : null,
      expectedTagCount: c.tags.length,
      refused: run?.refused ?? false,
      latencyMs: run?.latencyMs ?? 0,
      inputTokens: run?.usage.inputTokens ?? 0,
      outputTokens: run?.usage.outputTokens ?? 0,
    };
  });

  const overall = aggregate(scored);
  const byCategory = aggregateByCategory(scored);

  const startedAt = new Date().toISOString();
  const config = {
    split,
    model,
    thinkingLevel,
    seed,
    promptVersion: prompt.version,
    promptHash: prompt.hash,
    evalSetHash: shortHash(evalSetRaw),
    limit: args.limit ? Number(args.limit) : null,
  };
  // Same hash = same setup (model, prompt text, settings, eval set), so the runs are directly comparable.
  const hash = shortHash(JSON.stringify(config));
  const runId = `${split}_${model}_prompt${prompt.version}-${prompt.hash}_${thinkingLevel}_seed${seed}_${startedAt.replace(/[:.]/g, "-")}`;

  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RUNS_DIR, `${runId}.json`),
    JSON.stringify(
      {
        hash,
        runId,
        startedAt,
        note: args.note,
        config,
        overall,
        byCategory,
        cases: cases.map((c, i) => ({
          id: c.id,
          category: c.category,
          post: c.text,
          expected: { universe: c.universe, tags: c.tags },
          actual: outputs[c.id].run?.result ?? null,
          servedBy: outputs[c.id].run?.servedBy ?? null,
          cached: outputs[c.id].cached ?? false,
          error: outputs[c.id].error ?? null,
          score: scored[i].score,
        })),
      },
      null,
      2
    )
  );
  fs.appendFileSync(SUMMARY_PATH, JSON.stringify({ hash, runId, startedAt, note: args.note, ...config, overall, byCategory }) + "\n");

  printReport(overall, byCategory, scored, outputs);
  console.log(`\nSaved: ${path.join(RUNS_DIR, `${runId}.json`)}`);
}

function parseSeed(value: string): number {
  const seed = Number(value);
  if (!Number.isInteger(seed)) throw new Error(`Invalid seed "${value}". Use an integer.`);
  return seed;
}

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

function printReport(
  overall: ReturnType<typeof aggregate>,
  byCategory: Record<string, ReturnType<typeof aggregate>>,
  scored: ScoredCase[],
  outputs: Record<string, { error?: string }>
) {
  const row = (name: string, m: ReturnType<typeof aggregate>) => ({
    category: name,
    tests: m.testCount,
    universe: m.universeAccuracy,
    tagP: m.tagPrecision,
    tagR: m.tagRecall,
    tagF1: m.tagF1,
    exact: m.exactMatch,
    errors: m.errors,
    ms: m.avgLatencyMs,
  });
  console.table([...Object.entries(byCategory).map(([k, m]) => row(k, m)), row("OVERALL", overall)]);
  console.log(`Tokens: ${overall.inputTokens} in / ${overall.outputTokens} out | refusals: ${overall.refusals}`);

  const failures = scored.filter((c) => !c.score || !c.score.universeMatch || !c.score.tagsExact);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) {
      if (!f.score) {
        console.log(`  ${f.id} [${f.category}] ERROR ${outputs[f.id].error}`);
        continue;
      }
      const parts = [];
      if (!f.score.universeMatch) parts.push("universe mismatch");
      if (f.score.missing.length) parts.push(`missing ${f.score.missing.join(", ")}`);
      if (f.score.extra.length) parts.push(`extra ${f.score.extra.join(", ")}`);
      console.log(`  ${f.id} [${f.category}] ${parts.join(" | ")}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
