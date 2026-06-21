// src/models/UserModel.ts

import { Connection, Model, Schema, model, type InferSchemaType } from "mongoose";
import { DbConnection } from "../db/database-client";
import { trim } from "zod";

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    photo: {
      type: String,
      default: "",
      trim: true,
    },
    userName: {
      type: String,
      required: true,
      trim:true
    }
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export type UserDocument = InferSchemaType<typeof userSchema>;
export type UserModelType = Model<UserDocument>;

export function createUserModel(connection: DbConnection<Connection>): UserModelType {
  return connection.native.models.User as UserModelType || connection.native.model<UserDocument>("User", userSchema);
}