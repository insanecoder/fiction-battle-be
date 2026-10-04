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