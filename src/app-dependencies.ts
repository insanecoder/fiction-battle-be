import { MongooseAdapter } from "./db/mongo-client"
import { AppDependencies, DatabaseConnPools } from "./types/custom-types"
import { buildPostModule } from "./builder/posts.builder"
import { Connection } from "mongoose"
import { buildUserModule } from "./builder/user.builder"

export async function buildDependencies(dbObjs: DatabaseConnPools<Connection>) : Promise<AppDependencies> {
    return {
        "post": buildPostModule(dbObjs),
        "user" : buildUserModule(dbObjs)
    }
}

export async function generateDBObjs():Promise<DatabaseConnPools<Connection>> {
  const mongoAdapterObj = new MongooseAdapter()
  const dbConnPools:DatabaseConnPools<Connection> = {
    "primary" : await mongoAdapterObj.connect("primary")
  }
  return dbConnPools
}