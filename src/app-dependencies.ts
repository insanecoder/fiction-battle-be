import { MongooseAdapter } from "./db/mongo-client"
import { AppDependencies, DatabaseConnPools } from "./types/custom-types"
import { buildPostModule } from "./builder/posts.builder"
import { Connection } from "mongoose"
import { buildUserModule } from "./builder/user.builder"
import { buildAnalyticsModule } from "./builder/analytics.builder"

export async function buildDependencies(dbObjs: DatabaseConnPools<Connection>) : Promise<AppDependencies> {
    const analytics = buildAnalyticsModule(dbObjs)
    return {
        "post": buildPostModule(dbObjs, analytics.analyticsService, analytics.activityRepo),
        "user" : buildUserModule(dbObjs),
        "analytics": { "analyticsController": analytics.analyticsController },
    }
}

export async function generateDBObjs():Promise<DatabaseConnPools<Connection>> {
  const mongoAdapterObj = new MongooseAdapter()
  const dbConnPools:DatabaseConnPools<Connection> = {
    "primary" : await mongoAdapterObj.connect("primary"),
    "analytics" : await mongoAdapterObj.connect("analytics"),
  }
  return dbConnPools
}