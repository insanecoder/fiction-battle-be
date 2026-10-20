import type { Connection } from "mongoose";
import { DbConnection } from "../../db/database-client";
import { observeDbOperation } from "../../observability/dbObservability";
import { createLLMLogModel, LLMLogModelType } from "../../models/llm-log.model";
import { LLMCallFailure, LLMCallLogger, LLMCallStart, LLMCallSuccess } from "../llm/models/llm-model";

// The llm_logging collection. Passed to LLM models as their call logger, so every call is
// recorded: "pending" before the call, then success / blocked / error after it.
export class LLMLogRepository implements LLMCallLogger {
  private readonly model: LLMLogModelType;

  constructor(conn: DbConnection<Connection>) {
    this.model = createLLMLogModel(conn);
  }

  async start(call: LLMCallStart): Promise<string> {
    return observeDbOperation({ operation: "create", entity: "llm_logging" }, async () => {
      const doc = await this.model.create({
        task: call.task,
        status: "pending",
        postId: call.context.postId,
        requestId: call.context.requestId,
        input: { text: call.inputText, chars: call.inputText.length },
        prompt: call.context.prompt,
        schemaHash: call.schemaHash,
        model: { provider: call.provider, name: call.model },
        params: call.params,
        startedAt: new Date(),
      });
      return String(doc._id);
    });
  }

  async succeed(logId: string, result: LLMCallSuccess): Promise<void> {
    await observeDbOperation({ operation: "update", entity: "llm_logging" }, () =>
      this.model.updateOne(
        { _id: logId },
        {
          $set: {
            status: result.status,
            "model.servedBy": result.servedBy,
            output: result.output,
            usage: result.usage,
            latencyMs: result.latencyMs,
            slow: result.slow,
            completedAt: new Date(),
          },
        }
      )
    );
  }

  async fail(logId: string, failure: LLMCallFailure): Promise<void> {
    await observeDbOperation({ operation: "update", entity: "llm_logging" }, () =>
      this.model.updateOne(
        { _id: logId },
        {
          $set: {
            status: "error",
            error: { kind: failure.kind, message: failure.message },
            latencyMs: failure.latencyMs,
            completedAt: new Date(),
          },
        }
      )
    );
  }

  // Task-level: what the caller did with the output (e.g. tags applied to the post).
  async recordApplied(
    logId: string,
    applied: {
      tagCount: number;
      universe?: string[];
      skippedReason?: string;
      // How each name was mapped onto the vocabulary, the names left for review, and the names dropped
      mapped?: { label: string; tag: string; how: string }[];
      review?: { label: string; reason: string }[];
      notInUniverse?: string[];
      rejected?: string[];
    }
  ): Promise<void> {
    await observeDbOperation({ operation: "update", entity: "llm_logging" }, () =>
      this.model.updateOne({ _id: logId }, { $set: { applied } })
    );
  }
}
