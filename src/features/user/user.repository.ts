import type { Connection } from "mongoose";
import { createUserModel, UserModelType } from "../../models/user.model";
import { DbConnection } from "../../db/database-client";

type CreateUserInput = {
    email : string,
    name : string,
    photo? : string
  }

export class UserRepository {

  private readonly userModel:UserModelType;
  
  constructor(conn: DbConnection<Connection>) {
    this.userModel = createUserModel(conn);
  }

  async findByIds(ids: string[]) {
    return this.userModel.find({ _id: { $in: ids } }).lean();
  }

  async findOrCreate(input: CreateUserInput): Promise<string> {
    const existingUser = await this.userModel.findOne({ email:input.email }).lean();

    if (existingUser) {
      return existingUser._id.toString();
    }

    const createdUser = await this.userModel.create({
      email: input.email,
      name: input.name,
      photo: input.photo ?? "",
      userName: this.buildUsername(input.name),
    });

    return createdUser._id.toString();
  }

  private buildUsername(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");
  }
}