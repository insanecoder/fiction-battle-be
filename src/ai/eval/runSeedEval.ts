// Runs the tagger over the ~100 seed posts (src/data-seed.json) and measures it against the tags
// written in that file:
//   - agreement with the seed tags, raw (the tagger's names as returned) and after the vocabulary
//     step (both sides mapped to vocabulary tag ids: vocabulary → map → vector search → verification)
//   - latency per post (p50 / p95 / max) and tokens per post
//
//   npm run eval:seed                         # default model / thinking / prompt "1", seed 42
//   npm run eval:seed -- --concurrency 4 --limit 20 --skip-vocab
//
// Read-only: nothing is written to the database (no mappings saved, nothing queued for review).
// Tagger outputs are cached in results/cache.jsonl like the eval set (case ids "S<post id>").
// Results: results/runs/seed_<...>.json and a line in results/summary.jsonl.
import fs from "fs";
import path from "path";
import { parseArgs } from "util";
import { z } from "zod";
import { shortHash } from "../../lib/commonutils";
import { MongooseAdapter } from "../../db/mongo-client";
import { createLLMModel, DEFAULT_MODEL } from "../llm/model.factory";
import { getTaggingPrompt } from "../post-tagging/prompts";
import { PostTaggingSchema } from "../post-tagging/tagging.schema";
import { tagPost, TaggingRun } from "../post-tagging/tagger";
import { OutputCache } from "./cache";
import { aggregate, applyConfidenceThreshold, scoreCase, type EvalCase, type ScoredCase } from "./scoring";
import { loadPostTaggingConfig } from "../post-tagging/post-tagging.config";
import { TagRepository } from "../../features/tags/tag.repository";
import { TagMappingRepository } from "../../features/tags/tag-mapping.repository";
import { TagCandidateRepository } from "../../features/tags/tag-candidate.repository";
import { TagService, type TagName } from "../../features/tags/tag.service";
import { tagNameKey } from "../../models/tag-mapping.model";
import { createEmbedder } from "../embeddings/embedder";
import { VectorSearchService } from "../vector-search/vector-search.service";
import { TagVerificationService } from "../tag-verification/tag-verification.service";
import { TAG_TYPES, type TagType, type Universe } from "../../types/custom-types";

const SEED_PATH = path.join("src", "data-seed.json");
const RESULTS_DIR = path.join("src", "ai", "eval", "results");
const RUNS_DIR = path.join(RESULTS_DIR, "runs");
const SUMMARY_PATH = path.join(RESULTS_DIR, "summary.jsonl");

const { values: args } = parseArgs({
  options: {
    model: { type: "string" },
    thinking: { type: "string" },
    seed: { type: "string", default: "42" },
    prompt: { type: "string", default: "1" },
    concurrency: { type: "string", default: "3" },
    limit: { type: "string" },
    "skip-vocab": { type: "boolean", default: false },
    note: { type: "string", default: "" },
  },
});

type SeedCase = EvalCase & { names: TagName[] };

// The seed file's tags are the expected answer. Only the four tag types the app uses count;
// a post's universe is "HP", "GOT" or ["HP", "GOT"], and a tag without its own universe gets the post's first.
function loadSeedCases(): { cases: SeedCase[]; raw: string } {
  const raw = fs.readFileSync(SEED_PATH, "utf8");
  const cases = (JSON.parse(raw).posts as any[]).map((p) => {
    const universes: Universe[] = [].concat(p.universe);
    const names: TagName[] = (p.tags ?? [])
      .filter((t: any) => (TAG_TYPES as readonly string[]).includes(t.type) && t.label?.trim())
      .map((t: any) => ({ type: t.type as TagType, label: t.label.trim(), universe: (t.universe ?? universes[0]) as Universe }));
    return {
      id: `S${p.id}`,
      split: "dev" as const,
      category: universes.length > 1 ? "crossover" : universes[0],
      text: p.post,
      universe: universes,
      tags: names.map((n) => ({ type: n.type, tag: n.label })),
      names,
    };
  });
  return { cases, raw };
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
const round3 = (x: number) => Math.round(x * 1000) / 1000;

async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

// Maps names to vocabulary tag ids without writing anything: vocabulary label → map → (optionally)
// nearest tags + verification. Mirrors TagService.resolveTags, minus saving mappings and queueing.
async function resolveReadOnly(
  deps: { tagRepo: TagRepository; mappingRepo: TagMappingRepository; tagService: TagService; verification?: TagVerificationService },
  names: TagName[],
  postText: string,
  useVectors: boolean
): Promise<{ ids: Map<string, string>; verificationCalls: number }> {
  const key = (n: { type: string; universe: string; label: string }) => `${n.type}|${n.universe}|${tagNameKey(n.label)}`;
  const ids = new Map<string, string>(); // name key → tag id
  const left = new Map(names.map((n) => [key(n), n]));

  for (const t of await deps.tagRepo.findByLabels([...left.values()])) {
    if (left.has(key(t))) {
      ids.set(key(t), String(t._id));
      left.delete(key(t));
    }
  }
  for (const m of await deps.mappingRepo.findByNames([...left.values()])) {
    const k = `${m.type}|${m.universe}|${m.labelKey}`;
    if (left.has(k)) {
      ids.set(k, String(m.tagId));
      left.delete(k);
    }
  }
  if (!useVectors || !left.size || !deps.verification) return { ids, verificationCalls: 0 };

  const unknown = [...left.values()];
  const nearest = await deps.tagService.findNearestTags(unknown);
  const toVerify = unknown.map((name, i) => ({ name, candidates: nearest[i] })).filter((it) => it.candidates.length);
  if (!toVerify.length) return { ids, verificationCalls: 0 };
  const verdicts = await deps.verification.verify(toVerify, { postText });
  verdicts.forEach((v, i) => {
    if (v.decision === "match") ids.set(key(toVerify[i].name), v.tagId);
  });
  return { ids, verificationCalls: 1 };
}

async function main() {
  const model = args.model ?? DEFAULT_MODEL;
  const llm = createLLMModel(model, args.thinking);
  const { thinkingLevel } = llm;
  const prompt = getTaggingPrompt(args.prompt!);
  const seed = Number(args.seed);
  // Same threshold as production (TAGGING_MIN_CONFIDENCE): below it the post gets nothing.
  const { minUniverseConfidence } = loadPostTaggingConfig();
  const applied = (run: TaggingRun) => applyConfidenceThreshold(run.result, minUniverseConfidence);
  const { cases: allCases, raw } = loadSeedCases();
  const cases = args.limit ? allCases.slice(0, Number(args.limit)) : allCases;
  console.log(`Running ${cases.length} seed posts | model=${model} thinking=${thinkingLevel} seed=${seed} prompt=${prompt.version} (${prompt.hash}) minConfidence=${minUniverseConfidence}`);

  // 1. Tagger over every post (cached outputs are reused; their latency/tokens are from the original call)
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
        cache.set(key, run);
      } catch (err) {
        outputs[c.id] = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    process.stdout.write(`\rtagging ${++done}/${cases.length}`);
  });
  process.stdout.write("\n");
  const cachedCount = cases.filter((c) => outputs[c.id].cached).length;
  console.log(`Tagger outputs: ${cachedCount} from cache, ${cases.length - cachedCount} API calls`);

  // 2. Raw agreement: the tagger's names vs the seed labels (same scoring as the eval set)
  const scored: ScoredCase[] = cases.map((c) => {
    const run = outputs[c.id].run;
    return {
      id: c.id,
      category: c.category,
      score: run ? scoreCase(c, applied(run)) : null,
      expectedTagCount: c.tags.length,
      refused: run?.refused ?? false,
      belowThreshold: run ? run.result.confidence_in_universe < minUniverseConfidence : false,
      latencyMs: run?.latencyMs ?? 0,
      inputTokens: run?.usage.inputTokens ?? 0,
      outputTokens: run?.usage.outputTokens ?? 0,
    };
  });
  const raw_ = aggregate(scored);

  const ok = scored.filter((s) => s.score);
  const latency = { p50: percentile(ok.map((s) => s.latencyMs), 50), p95: percentile(ok.map((s) => s.latencyMs), 95), max: Math.max(0, ...ok.map((s) => s.latencyMs)) };
  const tokens = {
    avgIn: avg(ok.map((s) => s.inputTokens)),
    avgOut: avg(ok.map((s) => s.outputTokens)),
    avgTotal: avg(ok.map((s) => s.inputTokens + s.outputTokens)),
    p95Total: percentile(ok.map((s) => s.inputTokens + s.outputTokens), 95),
  };

  // 3. Agreement after the vocabulary step: both sides as vocabulary tag ids
  let vocab: null | {
    precision: number; recall: number; f1: number; exactTags: number; verificationCalls: number;
    resolveLatency: { p50: number; p95: number; max: number };
    perCase: Record<string, { missing: string[]; extra: string[] }>;
  } = null;
  if (!args["skip-vocab"]) {
    const mObj = new MongooseAdapter();
    const db = await mObj.connect("primary");
    const tagRepo = new TagRepository(db);
    const mappingRepo = new TagMappingRepository(db);
    const embedder = createEmbedder();
    const verification = process.env.LLM_API_KEY ? new TagVerificationService({ start: async () => "", succeed: async () => {}, fail: async () => {} } as any) : undefined;
    const tagService = new TagService(tagRepo, { mappingRepo, candidateRepo: new TagCandidateRepository(db), vectorSearch: new VectorSearchService(), embedder, verification });
    const deps = { tagRepo, mappingRepo, tagService, verification };
    const labelById = new Map((await tagRepo.findAll()).map((t) => [String(t._id), t.label]));

    let tp = 0, fp = 0, fn = 0, exact = 0, verificationCalls = 0;
    const resolveMs: number[] = [];
    const perCase: Record<string, { missing: string[]; extra: string[] }> = {};
    done = 0;
    await runPool(cases, Number(args.concurrency), async (c) => {
      const run = outputs[c.id].run;
      // Expected: the seed labels, resolved through the vocabulary and the map only (the seed built them).
      const expected = new Set((await resolveReadOnly(deps, c.names, c.text, false)).ids.values());
      let actual = new Set<string>();
      if (run) {
        const names = applied(run).tags.map((t) => ({ type: t.type, label: t.tag, universe: t.universe }));
        const t0 = performance.now();
        const r = await resolveReadOnly(deps, names, c.text, true);
        resolveMs.push(performance.now() - t0);
        verificationCalls += r.verificationCalls;
        actual = new Set(r.ids.values());
      }
      const missing = [...expected].filter((id) => !actual.has(id));
      const extra = [...actual].filter((id) => !expected.has(id));
      tp += expected.size - missing.length;
      fp += extra.length;
      fn += missing.length;
      if (!missing.length && !extra.length) exact++;
      if (missing.length || extra.length) {
        perCase[c.id] = { missing: missing.map((id) => labelById.get(id) ?? id), extra: extra.map((id) => labelById.get(id) ?? id) };
      }
      process.stdout.write(`\rvocabulary step ${++done}/${cases.length}`);
    });
    process.stdout.write("\n");
    const precision = tp + fp ? tp / (tp + fp) : 1;
    const recall = tp + fn ? tp / (tp + fn) : 1;
    vocab = {
      precision: round3(precision),
      recall: round3(recall),
      f1: round3(precision + recall ? (2 * precision * recall) / (precision + recall) : 0),
      exactTags: round3(exact / cases.length),
      verificationCalls,
      resolveLatency: { p50: Math.round(percentile(resolveMs, 50)), p95: Math.round(percentile(resolveMs, 95)), max: Math.round(Math.max(0, ...resolveMs)) },
      perCase,
    };
    await mObj.disconnect("primary");
  }

  // Report
  console.log("\nAgreement with the seed tags (" + cases.length + " posts)");
  console.table({
    "raw tagger names": { universe: raw_.universeAccuracy, tagP: raw_.tagPrecision, tagR: raw_.tagRecall, tagF1: raw_.tagF1, "exact post": raw_.exactMatch },
    ...(vocab ? { "after vocabulary step": { universe: raw_.universeAccuracy, tagP: vocab.precision, tagR: vocab.recall, tagF1: vocab.f1, "exact post": vocab.exactTags } } : {}),
  });
  console.log(`Tagger latency per post: p50 ${latency.p50} ms | p95 ${latency.p95} ms | max ${latency.max} ms`);
  console.log(`Tokens per post: ${tokens.avgIn} in + ${tokens.avgOut} out = ${tokens.avgTotal} avg (p95 ${tokens.p95Total}) | errors ${raw_.errors} | refusals ${raw_.refusals}`);
  if (vocab) {
    console.log(`Vocabulary step per post: p50 ${vocab.resolveLatency.p50} ms | p95 ${vocab.resolveLatency.p95} ms | ${vocab.verificationCalls} verification calls`);
  }

  const startedAt = new Date().toISOString();
  const config = { split: "seed", model, thinkingLevel, seed, promptVersion: prompt.version, promptHash: prompt.hash, minUniverseConfidence, seedFileHash: shortHash(raw), limit: args.limit ? Number(args.limit) : null };
  const hash = shortHash(JSON.stringify(config));
  const runId = `seed_${model}_prompt${prompt.version}-${prompt.hash}_${thinkingLevel}_seed${seed}_${startedAt.replace(/[:.]/g, "-")}`;
  const summary = { agreementRaw: raw_, agreementAfterVocabulary: vocab && { ...vocab, perCase: undefined }, latency, tokens };
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RUNS_DIR, `${runId}.json`),
    JSON.stringify(
      {
        hash, runId, startedAt, note: args.note, config, ...summary,
        cases: cases.map((c, i) => ({
          id: c.id,
          post: c.text,
          expected: { universe: c.universe, tags: c.tags },
          actual: outputs[c.id].run?.result ?? null, // as the model returned it, before the threshold
          belowThreshold: scored[i].belowThreshold,
          latencyMs: scored[i].latencyMs,
          tokens: { in: scored[i].inputTokens, out: scored[i].outputTokens },
          cached: outputs[c.id].cached ?? false,
          error: outputs[c.id].error ?? null,
          rawScore: scored[i].score,
          afterVocabulary: vocab?.perCase[c.id] ?? (vocab ? { missing: [], extra: [] } : null),
        })),
      },
      null,
      2
    )
  );
  fs.appendFileSync(SUMMARY_PATH, JSON.stringify({ hash, runId, startedAt, note: args.note, ...config, ...summary }) + "\n");
  console.log(`\nSaved: ${path.join(RUNS_DIR, `${runId}.json`)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
