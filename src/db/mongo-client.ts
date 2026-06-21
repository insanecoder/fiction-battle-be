import mongoose, { Connection } from "mongoose";
import { DbAdapter, DbConnection } from "./database-client";
import { dbConfig } from "../config/db.env";

type MongoDbName = keyof typeof dbConfig.mongo;

export class MongooseAdapter implements DbAdapter<Connection> {
  private connections = new Map<string, DbConnection<Connection>>();

  constructor() {}

  async connect(name: MongoDbName): Promise<DbConnection<Connection>> {
    const existing = this.connections.get(name);
    if (existing) return existing;

    const config = dbConfig.mongo[name];
    const { uri, pool } = dbConfig.mongo.primary;
    if (!uri) throw new Error(`No URI for ${name}`);
    const native = await mongoose
    .createConnection(uri, {
        maxPoolSize: pool.maxPoolSize,
        minPoolSize: pool.minPoolSize,
        serverSelectionTimeoutMS: pool.serverSelectionTimeoutMS,
        socketTimeoutMS: pool.socketTimeoutMS,
        waitQueueTimeoutMS: pool.waitQueueTimeoutMS,
    })
    .asPromise();

    const connection: DbConnection<Connection> = {
      name,
      native,
    };

    this.connections.set(name, connection);
    return connection;
  }

  async disconnect(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn) return;
    await conn.native.close();
    this.connections.delete(name);
  }
}