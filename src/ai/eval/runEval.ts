// Runs the tagging eval set and stores per-category results for this model + prompt.
//
//   npm run eval                                   # dev split, default model / thinking / prompt "1"
//   npm run eval -- --model gemini-3.8-flash --prompt 1 --thinking high
//   npm run eval -- --seed 7                        # default seed is 42; same seed → comparable runs
//   npm run eval -- --split holdout --note "final check before release"
//   npm run eval -- --skip-pipeline                 # raw tagger names only, no database
//
// Two scores per case:
//   - raw: the tagger's names as returned, compared as text with the expected labels
//   - pipeline: what the post would actually get. The tagger's names go through the production tag
//     resolution (TagService.resolveTags, save: false: vocabulary → map → vectors → verification), and
//     the expected labels through the vocabulary and the map. Both sides become tag ids, or
//     "review: <name>" for a name that isn't a tag yet and would go to the review queue.
//   The pipeline needs the database (read-only) and makes embedding/verification calls, which aren't cached.
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
import { aggregate, aggregateByCategory, applyConfidenceThreshold, CaseScore, EvalCase, scoreCase, ScoredCase } from "./scoring";
import { createEvalPipeline, EvalPipeline, usedVerification } from "./pipeline";
import { tagNameKey } from "../../models/tag-mapping.model";
import { PostTagging } from "../post-tagging/tagging.schema";
import type { TagName } from "../../features/tags/tag.service";
import type { TagType, Universe } from "../../types/custom-types";
import { loadPostTaggingConfig } from "../post-tagging/post-tagging.config";
import { OutputCache } from "./cache";
import { shortHash } from "../../lib/commonutils";
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
    "skip-pipeline": { type: "boolean", default: false },
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
  // Same threshold as production (TAGGING_MIN_CONFIDENCE), applied when scoring, not cached.
  const { minUniverseConfidence } = loadPostTaggingConfig();

  const evalSetRaw = fs.readFileSync(EVAL_SET_PATH, "utf8");
  const allCases: EvalCase[] = JSON.parse(evalSetRaw);
  let cases = split === "all" ? allCases : allCases.filter((c) => c.split === split);
  if (args.limit) cases = cases.slice(0, Number(args.limit));

  if (split !== "dev") {
    console.warn("⚠️  Running on holdout. Don't tune the prompt against these results, or holdout stops being a fair test.");
  }
  console.log(
    `Running ${cases.length} cases | model=${model} thinking=${thinkingLevel} seed=${seed} prompt=${prompt.version} (${prompt.hash}) split=${split} minConfidence=${minUniverseConfidence}`
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
        const run = await tagPost(llm, prompt, c.text, { seed });
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
      score: run ? scoreCase(c, applyConfidenceThreshold(run.result, minUniverseConfidence)) : null,
      expectedTagCount: c.tags.length,
      refused: run?.refused ?? false,
      belowThreshold: run ? run.result.confidence_in_universe < minUniverseConfidence : false,
      latencyMs: run?.latencyMs ?? 0,
      inputTokens: run?.usage.inputTokens ?? 0,
      outputTokens: run?.usage.outputTokens ?? 0,
    };
  });

  const overall = aggregate(scored);
  const byCategory = aggregateByCategory(scored);

  // After the pipeline: same cases, scored on tag ids.
  let pipeline: null | {
    overall: ReturnType<typeof aggregate>;
    byCategory: Record<string, ReturnType<typeof aggregate>>;
    scored: ScoredCase[];
    perCase: Record<string, PipelineCase>;
    verificationCalls: number;
  } = null;
  if (!args["skip-pipeline"]) {
    const pipe = await createEvalPipeline();
    const perCase: Record<string, PipelineCase> = {};
    let verificationCalls = 0;
    let doneP = 0;
    await runPool(cases, Number(args.concurrency), async (c) => {
      const i = cases.indexOf(c);
      const run = outputs[c.id].run;
      if (run && scored[i].score) {
        perCase[c.id] = await scorePipelineCase(pipe, c, applyConfidenceThreshold(run.result, minUniverseConfidence), scored[i].score!.universeMatch);
        if (perCase[c.id].verified) verificationCalls++;
      }
      process.stdout.write(`\rpipeline ${++doneP}/${cases.length}`);
    });
    process.stdout.write("\n");
    await pipe.close();
    const pScored = scored.map((s) => ({ ...s, score: perCase[s.id]?.score ?? null }));
    pipeline = { overall: aggregate(pScored), byCategory: aggregateByCategory(pScored), scored: pScored, perCase, verificationCalls };
  }

  const startedAt = new Date().toISOString();
  const config = {
    split,
    model,
    thinkingLevel,
    seed,
    promptVersion: prompt.version,
    promptHash: prompt.hash,
    minUniverseConfidence,
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
        pipeline: pipeline && { overall: pipeline.overall, byCategory: pipeline.byCategory, verificationCalls: pipeline.verificationCalls },
        cases: cases.map((c, i) => ({
          id: c.id,
          category: c.category,
          post: c.text,
          expected: { universe: c.universe, tags: c.tags },
          actual: outputs[c.id].run?.result ?? null, // as the model returned it, before the threshold
          belowThreshold: scored[i].belowThreshold,
          servedBy: outputs[c.id].run?.servedBy ?? null,
          cached: outputs[c.id].cached ?? false,
          error: outputs[c.id].error ?? null,
          score: scored[i].score,
          pipeline: pipeline?.perCase[c.id] ?? null,
        })),
      },
      null,
      2
    )
  );
  fs.appendFileSync(SUMMARY_PATH, JSON.stringify({ hash, runId, startedAt, note: args.note, ...config, overall, byCategory, pipeline: pipeline && { overall: pipeline.overall, byCategory: pipeline.byCategory } }) + "\n");

  printReport("Raw tagger names", overall, byCategory, scored, outputs);
  if (pipeline) {
    printReport("After the pipeline (what the post gets)", pipeline.overall, pipeline.byCategory, pipeline.scored, outputs);
    console.log(`Verification calls: ${pipeline.verificationCalls} of ${cases.length} posts`);
  }
  console.log(`\nSaved: ${path.join(RUNS_DIR, `${runId}.json`)}`);
}

type PipelineCase = {
  score: CaseScore;
  verified: boolean; // a verification call was made
  resolved: { name: string; tag: string; how: string }[];
  review: string[];
  notInUniverse: string[];
};

// Expected: each label → its tag id (vocabulary or map), or "review: <label>" when it isn't a tag yet.
// Actual: the tagger's names through the production resolution → tag ids, or "review: <name>" for names
// that would be queued. Names judged not in universe, or rejected by a reviewer before, are dropped.
async function scorePipelineCase(pipe: EvalPipeline, c: EvalCase, result: PostTagging, universeMatch: boolean): Promise<PipelineCase> {
  const reviewKey = (type: string, label: string) => `review|${type}|${tagNameKey(label)}`;
  const show = (key: string) => (key.startsWith("review|") ? `review: ${key.split("|")[2]}` : pipe.labelById.get(key) ?? key);

  // The eval set's labels carry no universe: try each of the case's universes (a crossover has two).
  const universes = (c.universe.length ? c.universe : ["HP", "GOT"]) as Universe[];
  const expectedNames: TagName[] = c.tags.flatMap((t) =>
    universes.map((universe) => ({ type: (t.type === "people" ? "person" : t.type) as TagType, label: t.tag, universe }))
  );
  const lookup = await pipe.lookupOnly.resolveTags(expectedNames, { postText: c.text }, { save: false });
  // One answer per label: its tag in whichever universe has it, else review.
  const expected = new Set(
    c.tags.map((t) => {
      const type = t.type === "people" ? "person" : t.type;
      const hit = lookup.resolved.find((r) => r.name.type === type && tagNameKey(r.name.label) === tagNameKey(t.tag));
      return hit ? hit.tagId : reviewKey(type, t.tag);
    })
  );

  const names: TagName[] = result.tags.map((t) => ({ type: t.type, label: t.tag, universe: t.universe }));
  const r = await pipe.tagService.resolveTags(names, { postText: c.text }, { save: false });
  const actual = new Set([...r.resolved.map((x) => x.tagId), ...r.toReview.map((t) => reviewKey(t.name.type, t.name.label))]);

  const missing = [...expected].filter((k) => !actual.has(k));
  const extra = [...actual].filter((k) => !expected.has(k));
  return {
    score: {
      universeMatch,
      tagsExact: !missing.length && !extra.length,
      tp: expected.size - missing.length,
      fp: extra.length,
      fn: missing.length,
      missing: missing.map(show),
      extra: extra.map(show),
    },
    verified: usedVerification(r),
    resolved: r.resolved.map((x) => ({ name: x.name.label, tag: x.tagLabel, how: x.how })),
    review: r.toReview.map((t) => `${t.name.label}${t.reason ? ` (${t.reason})` : ""}`),
    notInUniverse: r.notInUniverse.map((n) => n.label),
  };
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
  title: string,
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
  console.log(`\n${title}`);
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
      if (f.belowThreshold) parts.push("below confidence threshold");
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
