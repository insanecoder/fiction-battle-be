import { PostTagging } from "../post-tagging/tagging.schema";

export type EvalCase = {
  id: string;
  split: "dev" | "holdout";
  category: string;
  text: string;
  universe: string[];
  tags: { type: string; tag: string }[];
};

export type CaseScore = {
  universeMatch: boolean;
  tagsExact: boolean;
  tp: number;
  fp: number;
  fn: number;
  missing: string[];
  extra: string[];
};

export type Metrics = {
  testCount: number;
  errors: number;
  refusals: number;
  universeAccuracy: number;
  tagPrecision: number;
  tagRecall: number;
  tagF1: number;
  exactMatch: number;
  avgLatencyMs: number;
  inputTokens: number;
  outputTokens: number;
};

export type ScoredCase = {
  id: string;
  category: string;
  score: CaseScore | null; // null when the call errored
  expectedTagCount: number;
  refused: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
};

// The eval set uses "people"; the service and DB use "person".
const TYPE_ALIASES: Record<string, string> = { people: "person" };

function tagKey(type: string, tag: string): string {
  const t = TYPE_ALIASES[type] ?? type;
  const name = tag.trim().toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, " ");
  return `${t}|${name}`;
}

export function scoreCase(expected: EvalCase, actual: PostTagging): CaseScore {
  const expUniverse = new Set(expected.universe);
  const actUniverse = new Set(actual.universe);
  const universeMatch =
    expUniverse.size === actUniverse.size && [...expUniverse].every((u) => actUniverse.has(u as never));

  const expTags = new Set(expected.tags.map((t) => tagKey(t.type, t.tag)));
  const actTags = new Set(actual.tags.map((t) => tagKey(t.type, t.tag)));
  const missing = [...expTags].filter((k) => !actTags.has(k));
  const extra = [...actTags].filter((k) => !expTags.has(k));
  const tp = expTags.size - missing.length;

  return {
    universeMatch,
    tagsExact: missing.length === 0 && extra.length === 0,
    tp,
    fp: extra.length,
    fn: missing.length,
    missing,
    extra,
  };
}

// Micro-averaged over all cases, so categories with many tags weigh more in tag P/R.
export function aggregate(cases: ScoredCase[]): Metrics {
  const scored = cases.filter((c) => c.score !== null);
  const s = scored.map((c) => c.score!);
  const tp = sum(s.map((x) => x.tp));
  const fp = sum(s.map((x) => x.fp));
  // An errored case found none of its expected tags.
  const fn = sum(s.map((x) => x.fn)) + sum(cases.filter((c) => c.score === null).map((c) => c.expectedTagCount));

  // No predictions and nothing expected counts as perfect, not 0/0 — but only if something was actually scored.
  const anyScored = scored.length > 0;
  const precision = !anyScored ? 0 : tp + fp === 0 ? (fn === 0 ? 1 : 0) : tp / (tp + fp);
  const recall = !anyScored ? 0 : tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  // Errored cases count as failures in the accuracy figures.
  const testCount = cases.length;
  return {
    testCount,
    errors: testCount - scored.length,
    refusals: cases.filter((c) => c.refused).length,
    universeAccuracy: ratio(s.filter((x) => x.universeMatch).length, testCount),
    tagPrecision: round(precision),
    tagRecall: round(recall),
    tagF1: round(f1),
    exactMatch: ratio(s.filter((x) => x.universeMatch && x.tagsExact).length, testCount),
    avgLatencyMs: scored.length ? Math.round(sum(scored.map((c) => c.latencyMs)) / scored.length) : 0,
    inputTokens: sum(cases.map((c) => c.inputTokens)),
    outputTokens: sum(cases.map((c) => c.outputTokens)),
  };
}

export function aggregateByCategory(cases: ScoredCase[]): Record<string, Metrics> {
  const groups: Record<string, ScoredCase[]> = {};
  for (const c of cases) (groups[c.category] ??= []).push(c);
  return Object.fromEntries(
    Object.keys(groups)
      .sort()
      .map((cat) => [cat, aggregate(groups[cat])])
  );
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function ratio(a: number, b: number): number {
  return b === 0 ? 0 : round(a / b);
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
