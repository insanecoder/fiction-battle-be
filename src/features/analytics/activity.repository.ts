import type { Connection } from "mongoose";
import { createActivityModel, ActivityDocument, ActivityModelType } from "../../models/activity_model";
import { DbConnection } from "../../db/database-client";
import { observeDbOperation } from "../../observability/dbObservability";

type CreateActivityInput = {
  type:      "POST" | "COMMENT" | "LIKE" | "TAG";
  content:   string;
  universe?: "HP" | "GOT";
  postId?:   string;
  createdAt?: Date;
};

export class ActivityRepository {
  private readonly activityModel: ActivityModelType;

  constructor(conn: DbConnection<Connection>) {
    this.activityModel = createActivityModel(conn);
  }

  async create(input: CreateActivityInput): Promise<ActivityDocument> {
    return observeDbOperation({ operation: "create", entity: "activity" }, () =>
      this.activityModel.create({
        type:      input.type,
        content:   input.content,
        universe:  input.universe,
        postId:    input.postId,
        createdAt: input.createdAt,
      })
    );
  }

  async createMany(inputs: CreateActivityInput[]): Promise<void> {
    if (!inputs.length) return;
    await this.activityModel.insertMany(inputs, { ordered: false });
  }

  async findRecent(limit: number): Promise<ActivityDocument[]> {
    return observeDbOperation({ operation: "find", entity: "activity" }, () =>
      this.activityModel.find({}).sort({ createdAt: -1 }).limit(limit).lean()
    );
  }
}
