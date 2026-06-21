import { dbOpsTotal, dbOpDurationSeconds } from "./metrics";

export interface DbMetricMeta {
  operation: string;
  entity: string; // generic name, even if Prom label is still "collection"
}

export async function observeDbOperation<T>(
  meta: DbMetricMeta,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();

  try {
    const result = await fn();
    const durationSeconds = (performance.now() - start) / 1000;

    dbOpsTotal.inc({
      operation: meta.operation,
      collection: meta.entity,
      outcome: "success",
    });

    dbOpDurationSeconds.observe(
      {
        operation: meta.operation,
        collection: meta.entity,
        outcome: "success",
      },
      durationSeconds
    );

    return result;
  } catch (error) {
    const durationSeconds = (performance.now() - start) / 1000;

    dbOpsTotal.inc({
      operation: meta.operation,
      collection: meta.entity,
      outcome: "failure",
    });

    dbOpDurationSeconds.observe(
      {
        operation: meta.operation,
        collection: meta.entity,
        outcome: "failure",
      },
      durationSeconds
    );

    throw error;
  }
}