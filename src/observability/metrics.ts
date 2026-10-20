import client from "prom-client";

export const register = new client.Registry();

client.collectDefaultMetrics({
  register,
});

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status"] as const,
  registers: [register],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

export const appErrorsTotal = new client.Counter({
  name: "app_errors_total",
  help: "Total number of application errors",
  labelNames: ["code", "route"] as const,
  registers: [register],
});

export const dbOpsTotal = new client.Counter({
  name: "db_ops_total",
  help: "Total number of database operations",
  labelNames: ["operation", "collection", "outcome"] as const,
  registers: [register],
});

export const dbOpDurationSeconds = new client.Histogram({
  name: "db_op_duration_seconds",
  help: "Database operation duration in seconds",
  labelNames: ["operation", "collection", "outcome"] as const,
  buckets: [0.001, 0.003, 0.01, 0.03, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

// outcome: success | blocked | error
export const llmRequestsTotal = new client.Counter({
  name: "llm_requests_total",
  help: "Total number of LLM calls",
  labelNames: ["provider", "model", "outcome"] as const,
  registers: [register],
});

// event: slow (succeeded but over the slow threshold) | timeout (aborted, took too long to respond)
export const llmLatencyEventsTotal = new client.Counter({
  name: "llm_latency_events_total",
  help: "LLM calls that were slow or took too long to respond",
  labelNames: ["provider", "model", "event"] as const,
  registers: [register],
});

// kind: rate_limit | auth | invalid_request | server | timeout | invalid_output | unknown
export const llmErrorsTotal = new client.Counter({
  name: "llm_errors_total",
  help: "Total number of failed LLM calls, by error kind",
  labelNames: ["provider", "model", "kind"] as const,
  registers: [register],
});

export const llmRequestDurationSeconds = new client.Histogram({
  name: "llm_request_duration_seconds",
  help: "LLM call duration in seconds, including provider-side retries",
  labelNames: ["provider", "model", "outcome"] as const,
  buckets: [0.25, 0.5, 1, 2, 4, 8, 15, 30, 60],
  registers: [register],
});

// direction: input | output
export const llmTokensTotal = new client.Counter({
  name: "llm_tokens_total",
  help: "Total LLM tokens used",
  labelNames: ["provider", "model", "direction"] as const,
  registers: [register],
});
// --- Tag resolution and the tag review queue ---

// outcome: vocabulary | map | llm (resolved to a tag) | review (queued) | not_in_universe | rejected (dropped)
export const tagResolutionsTotal = new client.Counter({
  name: "tag_resolutions_total",
  help: "Tag names from posts, by how they were resolved against the vocabulary",
  labelNames: ["outcome"] as const,
  registers: [register],
});

// +1 each time a name enters the review queue for the first time (repeat mentions don't count).
// reason: no_candidates | no_match | several_matches | contradictory | llm_failed
export const tagReviewQueueNewEntriesTotal = new client.Counter({
  name: "tag_review_queue_new_entries_total",
  help: "Names added to the tag review queue",
  labelNames: ["type", "universe", "reason"] as const,
  registers: [register],
});

// The queue gauges are read from the database at scrape time, so they're right whichever process
// changed the queue (the API, or npm run review-tags). The builder registers how to read them,
// which keeps database code out of this file.
type ReviewQueueStats = { pending(): Promise<number>; oldestPendingAgeSeconds(): Promise<number> };
let reviewQueueStats: ReviewQueueStats | undefined;
export function setReviewQueueStats(stats: ReviewQueueStats): void {
  reviewQueueStats = stats;
}

// A failed read keeps the last value, so /metrics still answers when the database is slow or down.
async function readStat(gauge: client.Gauge, read: () => Promise<number>): Promise<void> {
  try {
    gauge.set(await read());
  } catch {
    // keep the previous value
  }
}

export const tagReviewQueuePending = new client.Gauge({
  name: "tag_review_queue_pending",
  help: "Names waiting in the tag review queue (npm run review-tags)",
  registers: [register],
  async collect() {
    if (reviewQueueStats) await readStat(this, reviewQueueStats.pending);
  },
});

export const tagReviewQueueOldestPendingAgeSeconds = new client.Gauge({
  name: "tag_review_queue_oldest_pending_age_seconds",
  help: "How long the oldest name in the tag review queue has been waiting (0 when empty)",
  registers: [register],
  async collect() {
    if (reviewQueueStats) await readStat(this, reviewQueueStats.oldestPendingAgeSeconds);
  },
});
